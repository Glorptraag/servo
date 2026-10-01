import { HINT_STEPS } from '../types/challenge.ts';
import type { ValidationResult } from '../types/issue.ts';
import { RUN_SOUNDS, TICK_RATE } from '../types/run.ts';
import type { RunEvent, RunRecord } from '../types/run.ts';
import { readBlueprint, readPortRef } from './blueprint.ts';
import type { Catalogue } from './catalogue.ts';
import {
  DEGREES,
  FRACTION,
  POSITIVE,
  SLUG,
  TICK,
  at,
  field,
  isRecord,
  readBoolean,
  readEnum,
  readList,
  readNumber,
  readObject,
  readUuid,
  readSlug,
  readTimestamp,
  report,
  runValidator,
} from './reader.ts';
import type { Ctx } from './reader.ts';
import { indexPlacedParts } from './wiring.ts';

const PROP_PREFIX = 'arena:';

const readSubject = (ctx: Ctx, value: unknown, path: string): string | undefined => {
  if (typeof value !== 'string') {
    if (value !== undefined) report(ctx, 'value.wrong_type', path, 'Expected a string.');
    return undefined;
  }
  const id = value.startsWith(PROP_PREFIX) ? value.slice(PROP_PREFIX.length) : value;
  if (!SLUG.test(id) || id.length > 64) {
    report(ctx, 'value.bad_format', path, "Expected a placed part's id, or 'arena:' and a prop's id.");
    return undefined;
  }
  return value;
};

const PAYLOAD_KEYS = {
  value: { required: [], optional: ['volts', 'milliamps', 'charge', 'rpm', 'angle', 'light', 'signal', 'closed'] },
  motion: { required: ['x', 'y', 'heading'], optional: ['pitch', 'roll'] },
  sound: { required: ['sound', 'level'], optional: ['hz'] },
  fault: { required: ['failure', 'active'], optional: [] },
} as const;

const readPayload = (ctx: Ctx, kind: RunEvent['kind'], value: unknown, path: string): void => {
  const keys = PAYLOAD_KEYS[kind];
  const record = readObject(ctx, value, path, keys.required, keys.optional);
  if (!record) return;
  const number = (key: string, range = {}): void => void readNumber(ctx, field(record, key), at(path, key), range);
  switch (kind) {
    case 'value':
      if (Object.keys(record).length === 0) report(ctx, 'value.missing', path, 'A value event carries at least one reading.');
      for (const key of ['volts', 'milliamps', 'rpm', 'angle']) number(key);
      for (const key of ['charge', 'light', 'signal']) number(key, FRACTION);
      readBoolean(ctx, field(record, 'closed'), at(path, 'closed'));
      return;
    case 'motion':
      number('x');
      number('y');
      number('heading', DEGREES);
      number('pitch', { min: -180, max: 180 });
      number('roll', { min: -180, max: 180 });
      return;
    case 'sound':
      readEnum(ctx, field(record, 'sound'), at(path, 'sound'), RUN_SOUNDS);
      number('level', FRACTION);
      number('hz', POSITIVE);
      return;
    case 'fault':
      readSlug(ctx, field(record, 'failure'), at(path, 'failure'));
      readBoolean(ctx, field(record, 'active'), at(path, 'active'));
  }
};

const readEvent = (ctx: Ctx, value: unknown, path: string): RunEvent | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['tick', 'partId', 'kind', 'payload']);
  if (!record) return undefined;
  readNumber(ctx, field(record, 'tick'), at(path, 'tick'), TICK);
  readSubject(ctx, field(record, 'partId'), at(path, 'partId'));
  const kind = readEnum(ctx, field(record, 'kind'), at(path, 'kind'), ['value', 'motion', 'sound', 'fault'] as const);
  if (kind !== undefined) readPayload(ctx, kind, field(record, 'payload'), at(path, 'payload'));
  return ctx.issues.length === mark ? (record as unknown as RunEvent) : undefined;
};

const CHANGE_FIELDS = {
  'add-part': { required: ['kind', 'partId', 'part'], optional: [] },
  'remove-part': { required: ['kind', 'partId', 'part'], optional: [] },
  'add-wire': { required: ['kind', 'from', 'to'], optional: [] },
  'remove-wire': { required: ['kind', 'from', 'to'], optional: [] },
  'change-setting': { required: ['kind', 'partId', 'setting'], optional: ['value'] },
  'change-arena': { required: ['kind'], optional: [] },
} as const;

const CHANGE_KINDS = Object.keys(CHANGE_FIELDS) as (keyof typeof CHANGE_FIELDS)[];

const readBuildChange = (ctx: Ctx, value: unknown, path: string): unknown => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected a change object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), CHANGE_KINDS);
  if (kind === undefined) {
    if (field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
    return undefined;
  }
  const fields = CHANGE_FIELDS[kind];
  readObject(ctx, value, path, fields.required, fields.optional);
  readSlug(ctx, field(value, 'partId'), at(path, 'partId'));
  readSlug(ctx, field(value, 'part'), at(path, 'part'));
  readPortRef(ctx, field(value, 'from'), at(path, 'from'));
  readPortRef(ctx, field(value, 'to'), at(path, 'to'));
  readSlug(ctx, field(value, 'setting'), at(path, 'setting'));
  const setting = field(value, 'value');
  if (setting !== undefined && (typeof setting === 'number' ? !Number.isFinite(setting) : typeof setting !== 'string')) {
    report(ctx, 'value.wrong_type', at(path, 'value'), 'Expected a number or an option id.');
  }
  return ctx.issues.length === mark ? value : undefined;
};

/** Reports `run.event_order` where a tick goes backwards, and `run.tick_out_of_range` past the last tick. */
const checkTicks = (ctx: Ctx, items: readonly unknown[] | undefined, path: string, key: string, ticks: number | undefined): void => {
  if (!items) return;
  let previous = -1;
  items.forEach((item, index) => {
    const tick = isRecord(item) ? field(item, key) : undefined;
    if (typeof tick !== 'number') return;
    if (key === 'tick' && tick < previous) report(ctx, 'run.event_order', at(at(path, index), key), `Tick ${tick} comes after tick ${previous}.`);
    if (ticks !== undefined && tick > ticks) report(ctx, 'run.tick_out_of_range', at(at(path, index), key), `The run has ${ticks} ticks.`);
    previous = Math.max(previous, tick);
  });
};

export const readRunRecord = (ctx: Ctx, value: unknown, path: string, catalogue: Catalogue): RunRecord | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(
    ctx,
    value,
    path,
    [
      'version',
      'id',
      'blueprintId',
      'blueprint',
      'seed',
      'tickRate',
      'startedAt',
      'endedAt',
      'runNumber',
      'ticks',
      'inputs',
      'faults',
      'fixed',
      'hints',
    ],
    ['challenge', 'profile', 'events', 'goal'],
  );
  if (!record) return undefined;
  const version = field(record, 'version');
  if (version !== undefined && version !== 1) report(ctx, 'value.not_allowed', at(path, 'version'), 'This schema reads version 1 run records.');
  readUuid(ctx, field(record, 'id'), at(path, 'id'));
  const blueprintId = readUuid(ctx, field(record, 'blueprintId'), at(path, 'blueprintId'));
  const blueprint = readBlueprint(ctx, field(record, 'blueprint'), at(path, 'blueprint'), catalogue);
  if (blueprintId !== undefined && blueprint && blueprint.meta.id !== blueprintId) {
    report(ctx, 'value.inconsistent', at(path, 'blueprintId'), "blueprintId must be the id of the blueprint that ran (its meta.id).");
  }
  readSlug(ctx, field(record, 'challenge'), at(path, 'challenge'));
  readUuid(ctx, field(record, 'profile'), at(path, 'profile'));
  readNumber(ctx, field(record, 'seed'), at(path, 'seed'), { min: 0, max: 0xffffffff, integer: true });
  const tickRate = field(record, 'tickRate');
  if (tickRate !== undefined && tickRate !== TICK_RATE) {
    report(ctx, 'value.not_allowed', at(path, 'tickRate'), `Runs tick ${TICK_RATE} times per simulated second.`);
  }
  const startedAt = readTimestamp(ctx, field(record, 'startedAt'), at(path, 'startedAt'));
  const endedAt = readTimestamp(ctx, field(record, 'endedAt'), at(path, 'endedAt'));
  if (startedAt !== undefined && endedAt !== undefined && endedAt < startedAt) {
    report(ctx, 'value.inconsistent', at(path, 'endedAt'), 'endedAt must not be before startedAt.');
  }
  readNumber(ctx, field(record, 'runNumber'), at(path, 'runNumber'), { min: 1, integer: true });
  const ticks = readNumber(ctx, field(record, 'ticks'), at(path, 'ticks'), TICK);

  const inputs = readList(ctx, field(record, 'inputs'), at(path, 'inputs'), (c, v, p) => {
    const m = c.issues.length;
    const input = readObject(c, v, p, ['tick', 'partId', 'kind', 'closed']);
    if (!input) return undefined;
    readNumber(c, field(input, 'tick'), at(p, 'tick'), TICK);
    readSlug(c, field(input, 'partId'), at(p, 'partId'));
    readEnum(c, field(input, 'kind'), at(p, 'kind'), ['switch'] as const);
    readBoolean(c, field(input, 'closed'), at(p, 'closed'));
    return c.issues.length === m ? input : undefined;
  });
  checkTicks(ctx, inputs, at(path, 'inputs'), 'tick', ticks);
  const events = readList(ctx, field(record, 'events'), at(path, 'events'), readEvent);
  checkTicks(ctx, events, at(path, 'events'), 'tick', ticks);
  const faults = readList(ctx, field(record, 'faults'), at(path, 'faults'), (c, v, p) => {
    const m = c.issues.length;
    const fault = readObject(c, v, p, ['partId', 'failure', 'firstTick']);
    if (!fault) return undefined;
    readSlug(c, field(fault, 'partId'), at(p, 'partId'));
    readSlug(c, field(fault, 'failure'), at(p, 'failure'));
    readNumber(c, field(fault, 'firstTick'), at(p, 'firstTick'), TICK);
    return c.issues.length === m ? fault : undefined;
  });
  checkTicks(ctx, faults, at(path, 'faults'), 'firstTick', ticks);
  // A fixed fault's part may have been swapped out since the previous Run, so only its shape is checked.
  readList(ctx, field(record, 'fixed'), at(path, 'fixed'), (c, v, p) => {
    const m = c.issues.length;
    const fix = readObject(c, v, p, ['partId', 'failure', 'changes']);
    if (!fix) return undefined;
    readSlug(c, field(fix, 'partId'), at(p, 'partId'));
    readSlug(c, field(fix, 'failure'), at(p, 'failure'));
    readList(c, field(fix, 'changes'), at(p, 'changes'), readBuildChange);
    return c.issues.length === m ? fix : undefined;
  });
  const goal = readObject(ctx, field(record, 'goal'), at(path, 'goal'), ['met'], ['tick']);
  if (goal && field(record, 'challenge') === undefined) {
    report(ctx, 'run.goal_without_challenge', at(path, 'goal'), 'Only a run inside a challenge has a goal.');
  } else if (goal) {
    const met = readBoolean(ctx, field(goal, 'met'), at(at(path, 'goal'), 'met'));
    const tick = readNumber(ctx, field(goal, 'tick'), at(at(path, 'goal'), 'tick'), TICK);
    if (met !== undefined && met !== (field(goal, 'tick') !== undefined)) {
      report(ctx, 'value.inconsistent', at(path, 'goal'), 'A met goal gives the tick it was met; an unmet goal gives none.');
    } else if (tick !== undefined && ticks !== undefined && tick > ticks) {
      report(ctx, 'run.tick_out_of_range', at(at(path, 'goal'), 'tick'), `The run has ${ticks} ticks.`);
    }
  }
  readList(ctx, field(record, 'hints'), at(path, 'hints'), (c, v, p) => {
    const m = c.issues.length;
    const hint = readObject(c, v, p, ['at', 'step', 'trigger'], ['partId']);
    if (!hint) return undefined;
    readTimestamp(c, field(hint, 'at'), at(p, 'at'));
    readEnum(c, field(hint, 'step'), at(p, 'step'), HINT_STEPS);
    readEnum(c, field(hint, 'trigger'), at(p, 'trigger'), ['asked', 'offered'] as const);
    readSlug(c, field(hint, 'partId'), at(p, 'partId'));
    return c.issues.length === m ? hint : undefined;
  });
  if (ctx.issues.length !== mark || !blueprint) return undefined;

  // Every part named must be in the blueprint that ran, and every failure mode on that part's record.
  const run = record as unknown as RunRecord;
  const placed = indexPlacedParts(blueprint.parts);
  const propIds = new Set(blueprint.arena.props.map((prop) => prop.id));
  for (const prop of catalogue.arenas?.get(blueprint.arena.preset)?.props ?? []) propIds.add(prop.id);
  const partRecord = (partId: string, partPath: string) => {
    const part = placed.get(partId);
    if (!part) {
      report(ctx, 'ref.unknown_placed_part', partPath, `The blueprint that ran has no part '${partId}'.`);
      return undefined;
    }
    return catalogue.parts.get(part.part);
  };
  const checkFailure = (partId: string, failure: string, partPath: string, failurePath: string): void => {
    const found = partRecord(partId, partPath);
    if (found && !found.failureModes.some((mode) => mode.id === failure)) {
      report(ctx, 'ref.unknown_failure_mode', failurePath, `The ${found.identity.name} has no failure mode '${failure}'.`);
    }
  };
  run.inputs.forEach((input, index) => {
    const inputPath = at(at(path, 'inputs'), index);
    const found = partRecord(input.partId, at(inputPath, 'partId'));
    const takesInput = found?.behaviour.some((primitive) => primitive.kind === 'switch' && primitive.actuation.kind === 'manual');
    if (found && !takesInput) report(ctx, 'value.inconsistent', at(inputPath, 'partId'), `The ${found.identity.name} has no switch the child can press.`);
  });
  run.events?.forEach((event, index) => {
    const eventPath = at(at(path, 'events'), index);
    if (event.partId.startsWith(PROP_PREFIX)) {
      const propId = event.partId.slice(PROP_PREFIX.length);
      if (catalogue.arenas && !propIds.has(propId)) report(ctx, 'ref.unknown_arena_feature', at(eventPath, 'partId'), `The arena has no prop '${propId}'.`);
    } else if (event.kind === 'fault') {
      checkFailure(event.partId, event.payload.failure, at(eventPath, 'partId'), at(at(eventPath, 'payload'), 'failure'));
    } else {
      partRecord(event.partId, at(eventPath, 'partId'));
    }
  });
  const listed = new Set<string>();
  run.faults.forEach((fault, index) => {
    const faultPath = at(at(path, 'faults'), index);
    checkFailure(fault.partId, fault.failure, at(faultPath, 'partId'), at(faultPath, 'failure'));
    const key = `${fault.partId} ${fault.failure}`;
    if (listed.has(key)) report(ctx, 'value.duplicate', faultPath, `'${fault.failure}' on '${fault.partId}' is already listed.`);
    listed.add(key);
  });
  // The fault summary and the event stream agree: each fault that starts has its entry, from that tick,
  // and a fault ends only after it has started.
  if (run.events) {
    const firstStart = new Map<string, number>();
    const active = new Set<string>();
    run.events.forEach((event, index) => {
      if (event.kind !== 'fault' || event.partId.startsWith(PROP_PREFIX)) return;
      const key = `${event.partId} ${event.payload.failure}`;
      const eventPath = at(at(path, 'events'), index);
      if (!event.payload.active) {
        if (!active.delete(key)) report(ctx, 'run.unrecorded_fault', eventPath, `'${event.payload.failure}' on '${event.partId}' ends without having started.`);
        return;
      }
      active.add(key);
      if (!listed.has(key)) report(ctx, 'run.unrecorded_fault', eventPath, `No entry in faults for '${event.payload.failure}' on '${event.partId}'.`);
      if (!firstStart.has(key)) firstStart.set(key, event.tick);
    });
    run.faults.forEach((fault, index) => {
      const first = firstStart.get(`${fault.partId} ${fault.failure}`);
      const tickPath = at(at(at(path, 'faults'), index), 'firstTick');
      if (first === undefined) report(ctx, 'run.unrecorded_fault', tickPath, 'No fault event starts this fault.');
      else if (first !== fault.firstTick) report(ctx, 'run.unrecorded_fault', tickPath, `The first fault event for it is at tick ${first}.`);
    });
  }
  run.hints.forEach((hint, index) => {
    if (hint.partId !== undefined) partRecord(hint.partId, at(at(at(path, 'hints'), index), 'partId'));
  });
  return ctx.issues.length === mark ? run : undefined;
};

/**
 * Checks a run record: structure, the blueprint that ran (in full), tick order, and every part, prop
 * and failure mode it names.
 */
export const validateRunRecord = (value: unknown, catalogue: Catalogue): ValidationResult<RunRecord> =>
  runValidator(value, (ctx, root) => readRunRecord(ctx, root, '$', catalogue));

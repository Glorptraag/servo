import type { ArenaPreset } from '../types/arena.ts';
import type { PlacedPart } from '../types/blueprint.ts';
import { CHALLENGE_KINDS, HINT_STEPS, PART_STATES } from '../types/challenge.ts';
import type {
  Challenge,
  Condition,
  Goal,
  HintChange,
  HintLadder,
  HintStep,
  HintTrigger,
  PartTarget,
  PortTarget,
} from '../types/challenge.ts';
import type { ValidationResult } from '../types/issue.ts';
import type { PartRecord } from '../types/part.ts';
import type { PortSpec } from '../types/port.ts';
import { checkArenaRef, readArenaRef } from './arena.ts';
import { checkSettingValue, readBlueprint } from './blueprint.ts';
import type { Catalogue } from './catalogue.ts';
import {
  NON_NEGATIVE,
  POSITIVE,
  at,
  field,
  isRecord,
  readEnum,
  readLevel,
  readList,
  readNumber,
  readObject,
  readSlug,
  readText,
  report,
  runValidator,
} from './reader.ts';
import type { Ctx } from './reader.ts';
import { checkPortPair, indexPlacedParts } from './wiring.ts';

/** Goals and conditions nest at most this deep. */
export const MAX_GOAL_DEPTH = 8;

const tooDeep = (ctx: Ctx, path: string, depth: number): boolean => {
  if (depth <= MAX_GOAL_DEPTH) return false;
  report(ctx, 'value.too_deep', path, `Goals and conditions nest at most ${MAX_GOAL_DEPTH} levels deep.`);
  return true;
};

// ---------------------------------------------------------------------------------------------
// Structure

/** Reads the `placed` or `part` key of a target inside an object that may hold other keys. */
const readTargetKeys = (ctx: Ctx, record: Readonly<Record<string, unknown>>, path: string): void => {
  const placed = field(record, 'placed');
  const part = field(record, 'part');
  if (placed === undefined && part === undefined) {
    report(ctx, 'value.missing', at(path, 'part'), "Name a placed part ('placed') or a part type ('part').");
  } else if (placed !== undefined && part !== undefined) {
    report(ctx, 'value.inconsistent', path, "Give 'placed' or 'part', not both.");
  }
  readSlug(ctx, placed, at(path, 'placed'));
  readSlug(ctx, part, at(path, 'part'));
};

const readPartTarget = (ctx: Ctx, value: unknown, path: string): PartTarget | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, [], ['placed', 'part']);
  if (!record) return undefined;
  readTargetKeys(ctx, record, path);
  return ctx.issues.length === mark ? (record as unknown as PartTarget) : undefined;
};

const readPortTarget = (ctx: Ctx, value: unknown, path: string): PortTarget | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['port'], ['placed', 'part']);
  if (!record) return undefined;
  readTargetKeys(ctx, record, path);
  readSlug(ctx, field(record, 'port'), at(path, 'port'));
  return ctx.issues.length === mark ? (record as unknown as PortTarget) : undefined;
};

const CONDITION_KINDS = ['and', 'or', 'not', 'in-zone', 'near-wall', 'speed', 'turn-rate', 'state', 'fault'] as const;

const readCondition = (ctx: Ctx, value: unknown, path: string, depth: number): Condition | undefined => {
  if (tooDeep(ctx, path, depth)) return undefined;
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected a condition object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), CONDITION_KINDS);
  if (kind === undefined) {
    if (field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
    return undefined;
  }
  const target = (): void => void readPartTarget(ctx, field(value, 'target'), at(path, 'target'));
  switch (kind) {
    case 'and':
    case 'or':
      readObject(ctx, value, path, ['kind', 'of']);
      readList(ctx, field(value, 'of'), at(path, 'of'), (c, v, p) => readCondition(c, v, p, depth + 1), 1);
      break;
    case 'not':
      readObject(ctx, value, path, ['kind', 'of']);
      if (field(value, 'of') !== undefined) readCondition(ctx, field(value, 'of'), at(path, 'of'), depth + 1);
      break;
    case 'in-zone':
      readObject(ctx, value, path, ['kind', 'target', 'zone']);
      target();
      readSlug(ctx, field(value, 'zone'), at(path, 'zone'));
      break;
    case 'near-wall':
      readObject(ctx, value, path, ['kind', 'target', 'wall', 'withinMm']);
      target();
      readSlug(ctx, field(value, 'wall'), at(path, 'wall'));
      readNumber(ctx, field(value, 'withinMm'), at(path, 'withinMm'), POSITIVE);
      break;
    case 'speed':
    case 'turn-rate': {
      readObject(ctx, value, path, ['kind', 'target'], ['atLeast', 'atMost']);
      target();
      const low = readNumber(ctx, field(value, 'atLeast'), at(path, 'atLeast'), NON_NEGATIVE);
      const high = readNumber(ctx, field(value, 'atMost'), at(path, 'atMost'), NON_NEGATIVE);
      if (field(value, 'atLeast') === undefined && field(value, 'atMost') === undefined) {
        report(ctx, 'value.missing', at(path, 'atLeast'), "Give 'atLeast', 'atMost' or both.");
      } else if (low !== undefined && high !== undefined && low > high) {
        report(ctx, 'value.inconsistent', at(path, 'atMost'), 'atMost must not be below atLeast.');
      }
      break;
    }
    case 'state':
      readObject(ctx, value, path, ['kind', 'target', 'state']);
      target();
      readEnum(ctx, field(value, 'state'), at(path, 'state'), PART_STATES);
      break;
    case 'fault':
      readObject(ctx, value, path, ['kind', 'target', 'failure']);
      target();
      readSlug(ctx, field(value, 'failure'), at(path, 'failure'));
      break;
  }
  return ctx.issues.length === mark ? (value as unknown as Condition) : undefined;
};

const GOAL_KINDS = ['all', 'any', 'sequence', 'holds', 'uses'] as const;

const readGoal = (ctx: Ctx, value: unknown, path: string, depth: number): Goal | undefined => {
  if (tooDeep(ctx, path, depth)) return undefined;
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    if (value !== undefined) report(ctx, 'value.wrong_type', path, 'Expected a goal object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), GOAL_KINDS);
  if (kind === undefined) {
    if (field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
    return undefined;
  }
  switch (kind) {
    case 'all':
    case 'any':
    case 'sequence':
      readObject(ctx, value, path, ['kind', 'of']);
      readList(ctx, field(value, 'of'), at(path, 'of'), (c, v, p) => readGoal(c, v, p, depth + 1), 1);
      break;
    case 'holds':
      readObject(ctx, value, path, ['kind', 'when', 'forTicks']);
      if (field(value, 'when') !== undefined) readCondition(ctx, field(value, 'when'), at(path, 'when'), depth + 1);
      readNumber(ctx, field(value, 'forTicks'), at(path, 'forTicks'), { min: 1, integer: true });
      break;
    case 'uses':
      readObject(ctx, value, path, ['kind', 'part', 'count']);
      readSlug(ctx, field(value, 'part'), at(path, 'part'));
      readNumber(ctx, field(value, 'count'), at(path, 'count'), { min: 1, integer: true });
      break;
  }
  return ctx.issues.length === mark ? (value as unknown as Goal) : undefined;
};

const readSettingValue = (ctx: Ctx, value: unknown, path: string): void => {
  if (value === undefined) return;
  if (typeof value === 'number' ? !Number.isFinite(value) : typeof value !== 'string') {
    report(ctx, 'value.wrong_type', path, 'Expected a number or an option id.');
  }
};

const CHANGE_KINDS = ['add-wire', 'remove-wire', 'add-part', 'remove-part', 'set-setting'] as const;

const readHintChange = (ctx: Ctx, value: unknown, path: string): HintChange | undefined => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected a change object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), CHANGE_KINDS);
  switch (kind) {
    case 'add-wire':
    case 'remove-wire':
      readObject(ctx, value, path, ['kind', 'from', 'to']);
      readPortTarget(ctx, field(value, 'from'), at(path, 'from'));
      readPortTarget(ctx, field(value, 'to'), at(path, 'to'));
      break;
    case 'add-part':
      readObject(ctx, value, path, ['kind', 'part'], ['mountOn']);
      readSlug(ctx, field(value, 'part'), at(path, 'part'));
      readPortTarget(ctx, field(value, 'mountOn'), at(path, 'mountOn'));
      break;
    case 'remove-part':
      readObject(ctx, value, path, ['kind', 'target']);
      readPartTarget(ctx, field(value, 'target'), at(path, 'target'));
      break;
    case 'set-setting':
      readObject(ctx, value, path, ['kind', 'target', 'setting', 'value']);
      readPartTarget(ctx, field(value, 'target'), at(path, 'target'));
      readSlug(ctx, field(value, 'setting'), at(path, 'setting'));
      readSettingValue(ctx, field(value, 'value'), at(path, 'value'));
      break;
    case undefined:
      if (field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
      break;
  }
  return ctx.issues.length === mark ? (value as unknown as HintChange) : undefined;
};

const readHintStep = (ctx: Ctx, value: unknown, path: string): HintStep | undefined => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected a hint step object.');
    return undefined;
  }
  const step = readEnum(ctx, field(value, 'step'), at(path, 'step'), HINT_STEPS);
  switch (step) {
    case 'pulse-part':
      readObject(ctx, value, path, ['step', 'target', 'line']);
      readPartTarget(ctx, field(value, 'target'), at(path, 'target'));
      break;
    case 'pulse-port':
      readObject(ctx, value, path, ['step', 'target', 'line']);
      readPortTarget(ctx, field(value, 'target'), at(path, 'target'));
      break;
    case 'ghost-wire':
      readObject(ctx, value, path, ['step', 'from', 'to', 'line']);
      readPortTarget(ctx, field(value, 'from'), at(path, 'from'));
      readPortTarget(ctx, field(value, 'to'), at(path, 'to'));
      break;
    case 'do-it':
      readObject(ctx, value, path, ['step', 'changes', 'line']);
      readList(ctx, field(value, 'changes'), at(path, 'changes'), readHintChange, 1);
      break;
    case undefined:
      if (field(value, 'step') === undefined) report(ctx, 'value.missing', at(path, 'step'), "Missing 'step'.");
      break;
  }
  readText(ctx, field(value, 'line'), at(path, 'line'));
  return ctx.issues.length === mark ? (value as unknown as HintStep) : undefined;
};

const readHintTrigger = (ctx: Ctx, value: unknown, path: string): HintTrigger | undefined => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    if (value !== undefined) report(ctx, 'value.wrong_type', path, 'Expected a trigger object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), ['fault', 'missing', 'unwired'] as const);
  switch (kind) {
    case 'fault':
      readObject(ctx, value, path, ['kind', 'target', 'failure']);
      readPartTarget(ctx, field(value, 'target'), at(path, 'target'));
      readSlug(ctx, field(value, 'failure'), at(path, 'failure'));
      break;
    case 'missing':
      readObject(ctx, value, path, ['kind', 'part']);
      readSlug(ctx, field(value, 'part'), at(path, 'part'));
      break;
    case 'unwired':
      readObject(ctx, value, path, ['kind', 'port'], ['placed', 'part']);
      readTargetKeys(ctx, value, path);
      readSlug(ctx, field(value, 'port'), at(path, 'port'));
      break;
    case undefined:
      if (field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
      break;
  }
  return ctx.issues.length === mark ? (value as unknown as HintTrigger) : undefined;
};

const readHintLadder = (ctx: Ctx, value: unknown, path: string): HintLadder | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['steps'], ['when']);
  if (!record) return undefined;
  readHintTrigger(ctx, field(record, 'when'), at(path, 'when'));
  const steps = readList(ctx, field(record, 'steps'), at(path, 'steps'), readHintStep, 1);
  if (steps && steps.length > 0) {
    const ranks = steps.map((step) => HINT_STEPS.indexOf(step.step));
    const ordered = ranks.every((rank, index) => index === 0 || rank > (ranks[index - 1] ?? -1));
    if (!ordered || steps.at(-1)?.step !== 'do-it') {
      report(ctx, 'hint.bad_order', at(path, 'steps'), 'Steps go pulse part, pulse port, ghost wire, do it: in that order, each at most once, ending with do it.');
    }
  }
  return ctx.issues.length === mark ? (record as unknown as HintLadder) : undefined;
};

// ---------------------------------------------------------------------------------------------
// References

interface Scope {
  readonly catalogue: Catalogue;
  readonly placed: ReadonlyMap<string, PlacedPart> | undefined;
  readonly preset: ArenaPreset | undefined;
}

const resolveTarget = (ctx: Ctx, target: PartTarget, path: string, scope: Scope): PartRecord | undefined => {
  if ('placed' in target) {
    const placed = scope.placed?.get(target.placed);
    if (!placed) {
      report(ctx, 'ref.unknown_placed_part', at(path, 'placed'), `The starting blueprint has no part '${target.placed}'.`);
      return undefined;
    }
    return scope.catalogue.parts.get(placed.part);
  }
  const record = scope.catalogue.parts.get(target.part);
  if (!record) report(ctx, 'ref.unknown_part_type', at(path, 'part'), `No part record has the id '${target.part}'.`);
  return record;
};

const resolvePortTarget = (ctx: Ctx, target: PortTarget, path: string, scope: Scope): PortSpec | undefined => {
  const record = resolveTarget(ctx, target, path, scope);
  if (!record) return undefined;
  const spec = record.ports.find((port) => port.id === target.port);
  if (!spec) report(ctx, 'ref.unknown_port', at(path, 'port'), `The ${record.identity.name} has no port '${target.port}'.`);
  return spec;
};

const checkFailure = (ctx: Ctx, record: PartRecord | undefined, failure: string, path: string): void => {
  if (record && !record.failureModes.some((mode) => mode.id === failure)) {
    report(ctx, 'ref.unknown_failure_mode', path, `The ${record.identity.name} has no failure mode '${failure}'.`);
  }
};

const checkFeature = (ctx: Ctx, scope: Scope, list: 'zones' | 'walls', id: string, path: string): void => {
  if (scope.preset && !scope.preset[list].some((feature) => feature.id === id)) {
    report(ctx, 'ref.unknown_arena_feature', path, `The arena has no ${list === 'zones' ? 'zone' : 'wall'} '${id}'.`);
  }
};

const checkPartType = (ctx: Ctx, scope: Scope, part: string, path: string): PartRecord | undefined => {
  const record = scope.catalogue.parts.get(part);
  if (!record) report(ctx, 'ref.unknown_part_type', path, `No part record has the id '${part}'.`);
  return record;
};

const checkCondition = (ctx: Ctx, condition: Condition, path: string, scope: Scope): void => {
  switch (condition.kind) {
    case 'and':
    case 'or':
      condition.of.forEach((inner, index) => checkCondition(ctx, inner, at(at(path, 'of'), index), scope));
      return;
    case 'not':
      checkCondition(ctx, condition.of, at(path, 'of'), scope);
      return;
    case 'fault':
      checkFailure(ctx, resolveTarget(ctx, condition.target, at(path, 'target'), scope), condition.failure, at(path, 'failure'));
      return;
    default:
      resolveTarget(ctx, condition.target, at(path, 'target'), scope);
      if (condition.kind === 'in-zone') checkFeature(ctx, scope, 'zones', condition.zone, at(path, 'zone'));
      if (condition.kind === 'near-wall') checkFeature(ctx, scope, 'walls', condition.wall, at(path, 'wall'));
  }
};

const checkGoal = (ctx: Ctx, goal: Goal, path: string, scope: Scope): void => {
  switch (goal.kind) {
    case 'all':
    case 'any':
    case 'sequence':
      goal.of.forEach((inner, index) => checkGoal(ctx, inner, at(at(path, 'of'), index), scope));
      return;
    case 'holds':
      checkCondition(ctx, goal.when, at(path, 'when'), scope);
      return;
    case 'uses':
      checkPartType(ctx, scope, goal.part, at(path, 'part'));
  }
};

/** A hint's wire must be one the child could draw: the same socket rule as the canvas. */
const checkHintWire = (ctx: Ctx, from: PortTarget, to: PortTarget, path: string, scope: Scope): void => {
  const a = resolvePortTarget(ctx, from, at(path, 'from'), scope);
  const b = resolvePortTarget(ctx, to, at(path, 'to'), scope);
  if (!a || !b) return;
  const verdict = checkPortPair(a, b);
  if (!verdict.legal) report(ctx, verdict.code, path, verdict.message);
};

const checkHintChange = (ctx: Ctx, change: HintChange, path: string, scope: Scope): void => {
  switch (change.kind) {
    case 'add-wire':
    case 'remove-wire':
      checkHintWire(ctx, change.from, change.to, path, scope);
      return;
    case 'add-part': {
      checkPartType(ctx, scope, change.part, at(path, 'part'));
      if (change.mountOn) {
        const spec = resolvePortTarget(ctx, change.mountOn, at(path, 'mountOn'), scope);
        if (spec && !(spec.type === 'mechanical' && spec.role === 'mount-point')) {
          report(ctx, 'port.wrong_kind', at(at(path, 'mountOn'), 'port'), `'${change.mountOn.port}' is not a mount point.`);
        }
      }
      return;
    }
    case 'remove-part':
      resolveTarget(ctx, change.target, at(path, 'target'), scope);
      return;
    case 'set-setting': {
      const record = resolveTarget(ctx, change.target, at(path, 'target'), scope);
      if (!record) return;
      const setting = record.settings.find((candidate) => candidate.id === change.setting);
      if (!setting) report(ctx, 'ref.unknown_setting', at(path, 'setting'), `The ${record.identity.name} has no setting '${change.setting}'.`);
      else checkSettingValue(ctx, setting, change.value, at(path, 'value'));
    }
  }
};

const checkLadder = (ctx: Ctx, ladder: HintLadder, path: string, scope: Scope): void => {
  const when = ladder.when;
  if (when) {
    const whenPath = at(path, 'when');
    if (when.kind === 'fault') checkFailure(ctx, resolveTarget(ctx, when.target, at(whenPath, 'target'), scope), when.failure, at(whenPath, 'failure'));
    else if (when.kind === 'missing') checkPartType(ctx, scope, when.part, at(whenPath, 'part'));
    else resolvePortTarget(ctx, when, whenPath, scope);
  }
  ladder.steps.forEach((step, index) => {
    const stepPath = at(at(path, 'steps'), index);
    switch (step.step) {
      case 'pulse-part':
        resolveTarget(ctx, step.target, at(stepPath, 'target'), scope);
        return;
      case 'pulse-port':
        resolvePortTarget(ctx, step.target, at(stepPath, 'target'), scope);
        return;
      case 'ghost-wire':
        checkHintWire(ctx, step.from, step.to, stepPath, scope);
        return;
      case 'do-it':
        step.changes.forEach((change, c) => checkHintChange(ctx, change, at(at(stepPath, 'changes'), c), scope));
    }
  });
};

// ---------------------------------------------------------------------------------------------
// The challenge

export const readChallenge = (ctx: Ctx, value: unknown, path: string, catalogue: Catalogue): Challenge | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(
    ctx,
    value,
    path,
    ['id', 'kind', 'level', 'title', 'goalLine', 'goal', 'arena', 'kit', 'hints'],
    ['start', 'introduces'],
  );
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  const kind = readEnum(ctx, field(record, 'kind'), at(path, 'kind'), CHALLENGE_KINDS);
  readLevel(ctx, field(record, 'level'), at(path, 'level'));
  readText(ctx, field(record, 'title'), at(path, 'title'));
  readText(ctx, field(record, 'goalLine'), at(path, 'goalLine'));
  readGoal(ctx, field(record, 'goal'), at(path, 'goal'), 1);
  const arena = readArenaRef(ctx, field(record, 'arena'), at(path, 'arena'));
  readSlug(ctx, field(record, 'kit'), at(path, 'kit'));
  readList(ctx, field(record, 'hints'), at(path, 'hints'), readHintLadder);
  const introduces = readSlug(ctx, field(record, 'introduces'), at(path, 'introduces'));
  const startValue = field(record, 'start');
  const start = startValue === undefined ? undefined : readBlueprint(ctx, startValue, at(path, 'start'), catalogue);

  if ((kind === 'breakdown' || kind === 'what-if') && startValue === undefined) {
    report(ctx, 'challenge.start_required', at(path, 'start'), `A ${kind} starts from a blueprint.`);
  }
  if (kind === 'part-introduction' && field(record, 'introduces') === undefined) {
    report(ctx, 'challenge.introduces_required', at(path, 'introduces'), 'A part introduction names the part it introduces.');
  }
  if (kind !== undefined && kind !== 'part-introduction' && field(record, 'introduces') !== undefined) {
    report(ctx, 'challenge.introduces_unexpected', at(path, 'introduces'), 'Only a part introduction names a part to introduce.');
  }
  if (arena && start && start.arena.preset !== arena.preset) {
    report(ctx, 'challenge.arena_mismatch', at(at(at(path, 'start'), 'arena'), 'preset'), `The challenge runs in '${arena.preset}'.`);
  }
  if (ctx.issues.length !== mark) return undefined;

  const challenge = record as unknown as Challenge;
  const preset = checkArenaRef(ctx, challenge.arena, at(path, 'arena'), catalogue);
  if (catalogue.kits && !catalogue.kits.has(challenge.kit)) {
    report(ctx, 'ref.unknown_kit', at(path, 'kit'), `No kit has the id '${challenge.kit}'.`);
  }
  if (introduces !== undefined) checkPartType(ctx, { catalogue, placed: undefined, preset }, introduces, at(path, 'introduces'));
  const placed = start ? indexPlacedParts(start.parts) : undefined;
  const scope: Scope = { catalogue, placed, preset };
  checkGoal(ctx, challenge.goal, at(path, 'goal'), scope);
  challenge.hints.forEach((ladder, index) => checkLadder(ctx, ladder, at(at(path, 'hints'), index), scope));
  return ctx.issues.length === mark ? challenge : undefined;
};

/**
 * Checks a challenge: kind rules, the starting blueprint (in full), the goal and hint ladders, and every
 * part, port, zone, wall, failure mode, setting, kit and arena they name. Hint wires obey the socket rule.
 */
export const validateChallenge = (value: unknown, catalogue: Catalogue): ValidationResult<Challenge> =>
  runValidator(value, (ctx, root) => readChallenge(ctx, root, '$', catalogue));

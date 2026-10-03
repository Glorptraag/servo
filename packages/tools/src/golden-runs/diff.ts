// How a Run differs from its golden file, and the readable lines that say so: what changed in the Run's inputs, how many
// ticks differ, the first one with the fields that changed there (old → new), the faults, and the run record's hash.
import type { FaultSeen } from '@servo/schema';
import type { GoldenFile, GoldenTick, InputHash } from './file.ts';
import { FIELD_ORDER, NONE } from './summary.ts';
import type { TickState } from './summary.ts';

/** One field of one subject at one tick, before and after. Absent means silent, faultless or not reported. */
export interface FieldChange {
  readonly subject: string;
  readonly field: string;
  readonly was?: string;
  readonly now?: string;
}

/** The fields that differ at one tick. */
export interface TickChange {
  readonly tick: number;
  readonly changes: readonly FieldChange[];
}

export interface GoldenDiff {
  readonly id: string;
  /** What changed in what the Run reads: the blueprint, the arena, part records, the seed, ticks or switch presses. */
  readonly inputs: readonly string[];
  /** How many ticks the longer Run has, counting tick 0. */
  readonly ticks: number;
  /** Ticks whose events or summary differ, or that only one side has. */
  readonly differing: readonly number[];
  /** The first differing tick, with the summary fields that differ there (none when the change is below its precision). */
  readonly first?: TickChange;
  /** The first tick whose summary differs, when that is after `first`. */
  readonly firstVisible?: TickChange;
  readonly faults?: { readonly was: readonly FaultSeen[]; readonly now: readonly FaultSeen[] };
  readonly record?: { readonly was: string; readonly now: string };
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const subjectsOf = (was: TickState | undefined, now: TickState | undefined): string[] => [...new Set([...(now?.keys() ?? []), ...(was?.keys() ?? [])])];

const changesAt = (was: GoldenTick | undefined, now: GoldenTick | undefined): FieldChange[] =>
  subjectsOf(was?.state, now?.state).flatMap((subject) => {
    const before = was?.state.get(subject);
    const after = now?.state.get(subject);
    return FIELD_ORDER.flatMap((field): FieldChange[] => {
      const old = before?.get(field);
      const value = after?.get(field);
      if (old === value) return [];
      return [{ subject, field, ...(old === undefined ? {} : { was: old }), ...(value === undefined ? {} : { now: value }) }];
    });
  });

const inputChanges = (was: GoldenFile, now: GoldenFile): string[] => {
  const changes: string[] = [];
  if (was.blueprint !== now.blueprint) changes.push('the blueprint changed');
  if (was.arena.id !== now.arena.id) changes.push(`the arena preset is ${now.arena.id}, not ${was.arena.id}`);
  else if (was.arena.hash !== now.arena.hash) changes.push(`the arena preset ${now.arena.id} changed`);
  const before = new Map(was.parts.map((part) => [part.id, part.hash]));
  const after = new Map(now.parts.map((part) => [part.id, part.hash]));
  const named = (parts: readonly InputHash[], keep: (part: InputHash) => boolean): string[] => parts.filter(keep).map((part) => part.id);
  const changed = named(now.parts, (part) => before.has(part.id) && before.get(part.id) !== part.hash);
  const added = named(now.parts, (part) => !before.has(part.id));
  const removed = named(was.parts, (part) => !after.has(part.id));
  if (changed.length > 0) changes.push(`the part record${changed.length === 1 ? '' : 's'} ${changed.join(', ')} changed`);
  if (added.length > 0) changes.push(`it now uses ${added.join(', ')}`);
  if (removed.length > 0) changes.push(`it no longer uses ${removed.join(', ')}`);
  if (was.seed !== now.seed) changes.push(`the seed is ${now.seed}, not ${was.seed}`);
  if (was.ticks !== now.ticks) changes.push(`it runs ${now.ticks} ticks, not ${was.ticks}`);
  if (!sameJson(was.inputs, now.inputs)) changes.push('its switch presses changed');
  if (was.id !== now.id) changes.push(`the golden file is written for ${was.id}`);
  return changes;
};

/** How `now` differs from the golden file `was`; undefined when they hold the same. */
export const diffGolden = (was: GoldenFile, now: GoldenFile): GoldenDiff | undefined => {
  const ticks = Math.max(was.frames.length, now.frames.length);
  const differing: number[] = [];
  let first: TickChange | undefined;
  let firstVisible: TickChange | undefined;
  for (let tick = 0; tick < ticks; tick += 1) {
    const before = was.frames[tick];
    const after = now.frames[tick];
    const changes = changesAt(before, after);
    if (before && after && before.hash === after.hash && changes.length === 0) continue;
    differing.push(tick);
    const change = { tick, changes };
    first ??= change;
    if (!firstVisible && changes.length > 0) firstVisible = change;
  }
  const inputs = inputChanges(was, now);
  const faults = sameJson(was.faults, now.faults) ? undefined : { was: was.faults, now: now.faults };
  const record = was.record === now.record ? undefined : { was: was.record, now: now.record };
  const subjects = sameJson(was.subjects, now.subjects);
  if (differing.length === 0 && inputs.length === 0 && !faults && !record && subjects) return undefined;
  return {
    id: now.id,
    inputs,
    ticks,
    differing,
    ...(first ? { first } : {}),
    ...(firstVisible && firstVisible !== first ? { firstVisible } : {}),
    ...(faults ? { faults } : {}),
    ...(record ? { record } : {}),
  };
};

/** The most field changes shown for one tick. */
export const SHOWN_CHANGES = 12;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const shown = (value: string | undefined): string => value ?? NONE;

const tickLines = (change: TickChange): string[] => {
  if (change.changes.length === 0) return ["  every summarized field is the same: the events differ below the summary's precision"];
  const listed = change.changes.slice(0, SHOWN_CHANGES);
  const names = listed.map((each) => `${each.subject}.${each.field}`);
  const olds = listed.map((each) => shown(each.was));
  const width = Math.max(...names.map((name) => name.length));
  const oldWidth = Math.max(...olds.map((old) => old.length));
  const lines = listed.map((each, index) => `  ${(names[index] ?? '').padEnd(width)}  ${(olds[index] ?? '').padStart(oldWidth)} → ${shown(each.now)}`);
  const more = change.changes.length - listed.length;
  return more > 0 ? [...lines, `  and ${plural(more, 'more field')}`] : lines;
};

const faultText = (fault: FaultSeen): string => `${fault.partId} ${fault.failure} from tick ${fault.firstTick}`;

/** The faults that differ: each one only before (−) or only now (+). */
const faultLines = (was: readonly FaultSeen[], now: readonly FaultSeen[]): string[] => {
  const before = new Set(was.map(faultText));
  const after = new Set(now.map(faultText));
  return [
    ...was.filter((fault) => !after.has(faultText(fault))).map((fault) => `  − ${faultText(fault)}`),
    ...now.filter((fault) => !before.has(faultText(fault))).map((fault) => `  + ${faultText(fault)}`),
  ];
};

/** The diff as lines for a terminal or a CI log, to print under a line naming the case. Lines under a heading are indented. */
export const describeDiff = (diff: GoldenDiff): string[] => {
  const lines = [
    diff.inputs.length === 0
      ? 'inputs: the same blueprint, arena, part records, seed, ticks and switch presses, so the simulation changed'
      : `inputs: ${diff.inputs.join('; ')}`,
  ];
  if (diff.first) {
    lines.push(`ticks: ${diff.differing.length} of ${diff.ticks} differ, the first at tick ${diff.first.tick}:`, ...tickLines(diff.first));
    if (diff.firstVisible) lines.push(`the first summarized difference is at tick ${diff.firstVisible.tick}:`, ...tickLines(diff.firstVisible));
  } else {
    lines.push(`ticks: all ${diff.ticks} are the same`);
  }
  lines.push(diff.faults ? 'faults:' : 'faults: the same');
  if (diff.faults) lines.push(...faultLines(diff.faults.was, diff.faults.now));
  if (diff.record) lines.push(`run record: sha256 ${diff.record.was.slice(0, 12)}… → ${diff.record.now.slice(0, 12)}…`);
  return lines;
};

// The input-path parity check (task 3.8, ground rule 8): touch, pointer and the list view each build a fixture's plan
// from the same empty build, and their canonical blueprints must be the same bytes as the reference path's. What a
// path can do is found by trying it, never assumed: a step the reference cannot take yet is left out for every path,
// a path that cannot take every step left in waits, and each says which canvas task it needs. Only a real difference
// fails. Pure: the paths are passed in. See README.md, "The parity check".
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, PlacedPartId } from '@servo/schema';
import { STEP_KINDS, describeStep } from './plan.ts';
import type { BuildPlan, Step, StepKind } from './plan.ts';
import type { Verdict } from './report.ts';

export type { Verdict } from './report.ts';

export type PathFamily = 'commands' | 'touch' | 'pointer' | 'list view';

/** Whether a path can take a kind of step now, and if not, the canvas tasks it waits for. */
export type Capability = { readonly ready: true } | { readonly ready: false; readonly tasks: readonly string[] };

export const READY: Capability = { ready: true };

export interface InputPath {
  /** For the report: `touch drag`, `pointer click-click`, `list view`, `commands`. */
  readonly name: string;
  readonly family: PathFamily;
  readonly can: Readonly<Record<StepKind, Capability>>;
  /** Loads the plan's start, takes `steps` in order, and gives the build it made; stops between steps once `signal` aborts. */
  build(plan: BuildPlan, steps: readonly Step[], signal?: AbortSignal): Promise<PathBuild>;
}

export type PathBuild =
  | {
      readonly ok: true;
      readonly blueprint: Blueprint;
      /**
       * What the steps did besides the build, one line each, compared as the bytes are: the selection a step leaves,
       * a switch flip's control, the routes a tidy gives.
       */
      readonly observed?: readonly string[];
    }
  | { readonly ok: false; readonly step: number; readonly reason: string };

export interface PendingSteps {
  readonly kind: StepKind;
  readonly count: number;
  readonly tasks: readonly string[];
}

export interface ParityResult {
  readonly fixture: string;
  readonly verdict: Verdict;
  /** The steps the compared paths took, by kind. */
  readonly compared: Readonly<Record<StepKind, number>>;
  /** Steps left out for every path, by kind and the tasks they wait for. */
  readonly pending: readonly PendingSteps[];
  /** The reference first, then each path that gave its bytes. */
  readonly identical: readonly string[];
  readonly mismatches: readonly { readonly path: string; readonly detail: string }[];
  /**
   * Paths that wait, with the tasks they wait for: for a compared step they cannot take (they are not compared), or for
   * a task no pending step names (the list view before task 3.6).
   */
  readonly waiting: readonly { readonly path: string; readonly tasks: readonly string[] }[];
  /** Each compared path's canonical blueprint, by path name, for a failing assertion's diff. */
  readonly bytes: ReadonlyMap<string, string>;
}

const compareTasks = (a: string, b: string): number => {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor || (a < b ? -1 : a > b ? 1 : 0);
};

/** Task ids once each, in order. */
export const uniqueTasks = (tasks: Iterable<string>): string[] => [...new Set(tasks)].sort(compareTasks);

/**
 * Which task builds each kind of step on each path: packages/canvas/README.md, "Who builds what". Undo and Reset arena
 * are the Run bar's (task 4.4), the same button on every path.
 */
const HANDS: Readonly<Record<StepKind, string>> = {
  place: '3.2',
  setting: '3.2',
  connect: '3.3',
  refuse: '3.3',
  move: '3.2',
  turn: '3.2',
  remove: '3.2',
  disconnect: '3.3',
  'place-prop': '3.2',
  'move-prop': '7.3',
  'remove-prop': '3.4',
  'reset-arena': '4.4',
  tidy: '3.7',
  undo: '4.4',
  'clear-selection': '3.4',
  flip: '3.5',
};

export const BUILT_BY: Readonly<Record<PathFamily, Readonly<Record<StepKind, string>>>> = {
  commands: { ...HANDS, 'move-prop': '3.2', 'remove-prop': '3.2' },
  touch: HANDS,
  pointer: HANDS,
  'list view': {
    ...HANDS,
    place: '3.6',
    setting: '3.6',
    connect: '3.6',
    refuse: '3.6',
    move: '3.6',
    turn: '3.6',
    remove: '3.6',
    disconnect: '3.6',
    'place-prop': '3.6',
    'move-prop': '3.6',
    'remove-prop': '3.6',
    'clear-selection': '7.3',
    flip: '3.6',
  },
};

/** The tasks a canvas "not implemented yet" error names (`(task 3.2)`, `(tasks 3.2 and 3.3)`); undefined for any other error. */
export const pendingTasks = (error: unknown): string[] | undefined => {
  if (!(error instanceof Error)) return undefined;
  const named = /not implemented yet \(tasks? ([^)]*)\)/.exec(error.message)?.[1];
  return named === undefined ? undefined : named.split(/,|\band\b/).map((task) => task.trim()).filter((task) => task.length > 0);
};

/**
 * Tries a member a path needs for a kind of step. Ready when it works, and when it fails in any other way (the path
 * then meets that failure on the step, and the check fails). Waiting when it is not implemented yet: on the tasks
 * its error names and the task that builds the step on this path.
 */
export const attempt = (family: PathFamily, kind: StepKind, member: () => unknown): Capability => {
  try {
    member();
    return READY;
  } catch (error) {
    const tasks = pendingTasks(error);
    return tasks ? { ready: false, tasks: uniqueTasks([...tasks, BUILT_BY[family][kind]]) } : READY;
  }
};

/** Waiting on the tasks of `capability` and the task that builds `kind` on `family`; ready when `capability` is. */
export const waitingLike = (capability: Capability, family: PathFamily, kind: StepKind): Capability =>
  capability.ready ? READY : { ready: false, tasks: uniqueTasks([...capability.tasks, BUILT_BY[family][kind]]) };

/** The fixture parts a step names besides one it places itself. */
const partsNamed = (step: Step): PlacedPartId[] => {
  switch (step.kind) {
    case 'place':
      return step.attach ? [step.attach.onto.part] : [];
    case 'setting':
      return [step.ref];
    case 'connect':
    case 'refuse':
      return [step.from.part, step.to.part];
    case 'disconnect':
      return step.lines.flatMap((line) => [line.from.part, line.to.part]);
    case 'move':
    case 'turn':
    case 'remove':
    case 'clear-selection':
    case 'flip':
      return [step.ref];
    case 'place-prop':
    case 'move-prop':
    case 'remove-prop':
    case 'reset-arena':
    case 'tidy':
    case 'undo':
      return [];
  }
};

const noSteps = (): Record<StepKind, number> => Object.fromEntries(STEP_KINDS.map((kind) => [kind, 0])) as Record<StepKind, number>;

/** A path's canonical blueprint, then what it observed, one line each: the bytes compared. */
const bytesOf = (build: Extract<PathBuild, { ok: true }>): string => [serializeBlueprint(build.blueprint), ...(build.observed ?? [])].join('\n');

/**
 * Builds `plan` on the reference and on every other path that can take the same steps, and compares the canonical
 * bytes. A step the reference cannot take, or one naming a part left out, is left out for every path. Once `signal`
 * aborts (the test timed out), no path takes another step, so none sends input into a later test.
 */
export const checkParity = async (plan: BuildPlan, reference: InputPath, others: readonly InputPath[], signal?: AbortSignal): Promise<ParityResult> => {
  const taken: Step[] = [];
  const left: { readonly step: Step; readonly tasks: readonly string[] }[] = [];
  const placed = new Set<PlacedPartId>();
  const leftOut = new Map<PlacedPartId, readonly string[]>();
  for (const step of plan.steps) {
    const capability = reference.can[step.kind];
    const unplaced = partsNamed(step).filter((part) => !placed.has(part));
    if (!capability.ready || unplaced.length > 0) {
      const tasks = uniqueTasks([...(capability.ready ? [] : capability.tasks), ...unplaced.flatMap((part) => leftOut.get(part) ?? [])]);
      left.push({ step, tasks });
      if (step.kind === 'place') leftOut.set(step.ref, tasks);
      continue;
    }
    taken.push(step);
    if (step.kind === 'place') placed.add(step.ref);
  }
  const compared = noSteps();
  for (const step of taken) compared[step.kind] += 1;
  const kinds = STEP_KINDS.filter((kind) => compared[kind] > 0);

  const pending: PendingSteps[] = [];
  for (const { step, tasks } of left) {
    const same = pending.find((entry) => entry.kind === step.kind && entry.tasks.join() === tasks.join());
    if (same) pending[pending.indexOf(same)] = { ...same, count: same.count + 1 };
    else pending.push({ kind: step.kind, count: 1, tasks });
  }

  // A path waits when it cannot take a compared step, or a step of the plan for a task no pending step names.
  const named = new Set(pending.flatMap((entry) => entry.tasks));
  const planKinds = STEP_KINDS.filter((kind) => plan.steps.some((step) => step.kind === kind));
  const missing = (path: InputPath, of: readonly StepKind[]): string[] =>
    uniqueTasks(
      of.flatMap((kind) => {
        const capability = path.can[kind];
        return capability.ready ? [] : capability.tasks;
      }),
    );
  const waiting: { path: string; tasks: readonly string[] }[] = [];
  const comparing: InputPath[] = [];
  for (const path of others) {
    const blocking = missing(path, kinds);
    const tasks = uniqueTasks([...blocking, ...missing(path, planKinds).filter((task) => !named.has(task))]);
    if (tasks.length > 0) waiting.push({ path: path.name, tasks });
    if (blocking.length === 0) comparing.push(path);
  }

  const bytes = new Map<string, string>();
  const identical: string[] = [];
  const mismatches: { path: string; detail: string }[] = [];
  if (taken.length > 0 && comparing.length > 0) {
    const failure = (build: Extract<PathBuild, { ok: false }>): string => {
      if (build.step < 0) return `loading the start: ${build.reason}`;
      const step = taken[build.step];
      return step ? `step ${build.step + 1}, ${describeStep(step)}: ${build.reason}` : `after the last step: ${build.reason}`;
    };
    const expected = await reference.build(plan, taken, signal);
    if (!expected.ok) {
      mismatches.push({ path: reference.name, detail: failure(expected) });
    } else {
      const want = bytesOf(expected);
      bytes.set(reference.name, want);
      identical.push(reference.name);
      for (const path of comparing) {
        const got = await path.build(plan, taken, signal);
        if (!got.ok) {
          mismatches.push({ path: path.name, detail: failure(got) });
          continue;
        }
        const gotBytes = bytesOf(got);
        bytes.set(path.name, gotBytes);
        if (gotBytes === want) identical.push(path.name);
        else if (serializeBlueprint(got.blueprint) !== serializeBlueprint(expected.blueprint)) {
          mismatches.push({ path: path.name, detail: describeDifference(got.blueprint, expected.blueprint, reference.name) });
        } else mismatches.push({ path: path.name, detail: describeObserved(got.observed ?? [], expected.observed ?? [], reference.name) });
      }
    }
  }

  const verdict: Verdict =
    mismatches.length > 0 ? 'mismatch' : identical.length < 2 ? 'pending' : pending.length > 0 || waiting.length > 0 ? 'partial' : 'identical';
  return { fixture: plan.fixture, verdict, compared, pending, identical, mismatches, waiting, bytes };
};

const point = (value: { readonly x: number; readonly y: number }): string => `(${value.x}, ${value.y})`;

const json = (value: unknown): string => JSON.stringify(value) ?? 'undefined';

/**
 * What differs between a path's build and the reference's, part by part and wire by wire, in a few words:
 * `p3 position (40, -53) here, (40, -52.9) in commands; w5 only here`.
 */
export const describeDifference = (got: Blueprint, want: Blueprint, referenceName: string): string => {
  const differences: string[] = [];
  const there = `in ${referenceName}`;
  if (got.version !== want.version) differences.push(`version ${got.version} here, ${want.version} ${there}`);
  const fields = (label: string, a: object, b: object): void => {
    const left = a as Readonly<Record<string, unknown>>;
    const right = b as Readonly<Record<string, unknown>>;
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      if (json(left[key]) !== json(right[key])) differences.push(`${label}.${key} ${json(left[key])} here, ${json(right[key])} ${there}`);
    }
  };
  fields('arena', got.arena, want.arena);
  fields('meta', got.meta, want.meta);
  const wantParts = new Map(want.parts.map((part) => [part.id, part]));
  const gotParts = new Map(got.parts.map((part) => [part.id, part]));
  for (const part of got.parts) {
    const other = wantParts.get(part.id);
    if (!other) {
      differences.push(`${part.id} (${part.part}) only here`);
      continue;
    }
    if (part.part !== other.part) differences.push(`${part.id} is a ${part.part} here, a ${other.part} ${there}`);
    if (part.position.x !== other.position.x || part.position.y !== other.position.y) {
      differences.push(`${part.id} position ${point(part.position)} here, ${point(other.position)} ${there}`);
    }
    if (part.rotation !== other.rotation) differences.push(`${part.id} rotation ${part.rotation} here, ${other.rotation} ${there}`);
    if (json(part.settings) !== json(other.settings)) differences.push(`${part.id} settings ${json(part.settings)} here, ${json(other.settings)} ${there}`);
  }
  for (const part of want.parts) if (!gotParts.has(part.id)) differences.push(`${part.id} (${part.part}) only ${there}`);
  const wantWires = new Map(want.wires.map((wire) => [wire.id, wire]));
  const gotWires = new Map(got.wires.map((wire) => [wire.id, wire]));
  const ends = (wire: Blueprint['wires'][number]): string => `${wire.from.part}.${wire.from.port}–${wire.to.part}.${wire.to.port}`;
  for (const wire of got.wires) {
    const other = wantWires.get(wire.id);
    if (!other) differences.push(`${wire.id} (${ends(wire)}) only here`);
    else if (ends(wire) !== ends(other)) differences.push(`${wire.id} joins ${ends(wire)} here, ${ends(other)} ${there}`);
  }
  for (const wire of want.wires) if (!gotWires.has(wire.id)) differences.push(`${wire.id} (${ends(wire)}) only ${there}`);
  if (differences.length === 0) return `the same build in different bytes from ${referenceName}`;
  const shown = differences.slice(0, 4);
  return differences.length > shown.length ? `${shown.join('; ')}; and ${differences.length - shown.length} more` : shown.join('; ');
};

/** What a path observed besides the build that the reference did not, line by line: `observed "…" here, "…" in commands`. */
export const describeObserved = (got: readonly string[], want: readonly string[], referenceName: string): string => {
  const differences: string[] = [];
  for (let index = 0; index < Math.max(got.length, want.length); index += 1) {
    if (got[index] !== want[index]) differences.push(`observed ${json(got[index])} here, ${json(want[index])} in ${referenceName}`);
  }
  if (differences.length === 0) return `the same build in different bytes from ${referenceName}`;
  const shown = differences.slice(0, 2);
  return differences.length > shown.length ? `${shown.join('; ')}; and ${differences.length - shown.length} more` : shown.join('; ');
};

const NOUNS: Readonly<Record<StepKind, readonly [string, string]>> = {
  place: ['placement', 'placements'],
  setting: ['setting', 'settings'],
  connect: ['wire', 'wires'],
  refuse: ['refused drop', 'refused drops'],
  move: ['move', 'moves'],
  turn: ['turn', 'turns'],
  remove: ['removed part', 'removed parts'],
  disconnect: ['removed wire', 'removed wires'],
  'place-prop': ['placed prop', 'placed props'],
  'move-prop': ['moved prop', 'moved props'],
  'remove-prop': ['removed prop', 'removed props'],
  'reset-arena': ['arena reset', 'arena resets'],
  tidy: ['tidy', 'tidies'],
  undo: ['undo', 'undos'],
  'clear-selection': ['cleared selection', 'cleared selections'],
  flip: ['switch flip', 'switch flips'],
};

const counted = (kind: StepKind, count: number): string => `${count} ${NOUNS[kind][count === 1 ? 0 : 1]}`;

const listed = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;

const needs = (tasks: readonly string[]): string => `needs ${tasks.length === 1 ? 'task' : 'tasks'} ${listed(tasks)}`;

/**
 * One line per fixture for the report:
 * `kit-rolling-start: identical on touch drag, pointer click-click and commands (8 placements); pending: needs task
 * 3.3 (4 wires); list view needs task 3.6`.
 */
export const reportLine = (result: ParityResult): string => {
  const parts: string[] = [];
  const steps = listed(STEP_KINDS.filter((kind) => result.compared[kind] > 0).map((kind) => counted(kind, result.compared[kind])));
  if (result.verdict === 'mismatch') {
    parts.push(`MISMATCH: ${result.mismatches.map((mismatch) => `${mismatch.path}: ${mismatch.detail}`).join('; ')}`);
    if (result.identical.length > 0) parts.push(`identical on ${listed(result.identical)} (${steps})`);
  } else if (result.verdict === 'identical') {
    parts.push(`identical on ${listed(result.identical)} (${steps})`);
  } else if (result.verdict === 'partial') {
    parts.push(`partial: identical on ${listed(result.identical)} (${steps})`);
  }
  if (result.pending.length > 0) {
    const byTasks = new Map<string, PendingSteps[]>();
    for (const entry of result.pending) byTasks.set(entry.tasks.join(), [...(byTasks.get(entry.tasks.join()) ?? []), entry]);
    const groups = [...byTasks.values()].map((entries) => `${needs(entries[0]?.tasks ?? [])} (${listed(entries.map((entry) => counted(entry.kind, entry.count)))})`);
    parts.push(`pending: ${groups.join(', ')}`);
  }
  if (result.verdict === 'pending' && result.pending.length === 0) parts.push('pending: no other path could take its steps');
  for (const { path, tasks } of result.waiting) parts.push(`${path} ${needs(tasks)}`);
  return `${result.fixture}: ${parts.join('; ')}`;
};

/**
 * Strict mode (the default; `SERVO_PARITY_STRICT=0` turns it off): a fixture passes only when every path built every step to the
 * same bytes, so a step left out or a path waiting fails it as a difference would.
 */
export const passes = (result: ParityResult, strict: boolean): boolean => result.verdict !== 'mismatch' && (!strict || result.verdict === 'identical');

/**
 * Splits fixtures into `count` groups of about equal work, for the parity check's test files: each fixture, the
 * heaviest first, goes to the group with the least work so far (ties to the lowest group). `weight` is a fixture's
 * work, its plan's steps. Deterministic: the same fixtures give the same groups.
 */
export const fixtureGroups = <T>(fixtures: readonly T[], count: number, weight: (fixture: T) => number): T[][] => {
  const groups: T[][] = Array.from({ length: count }, () => []);
  const loads = Array.from({ length: count }, () => 0);
  const order = fixtures.map((fixture, index) => ({ fixture, index, weight: weight(fixture) })).sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { fixture, weight: work } of order) {
    const lightest = loads.indexOf(Math.min(...loads));
    groups[lightest]?.push(fixture);
    loads[lightest] = (loads[lightest] ?? 0) + work;
  }
  return groups;
};

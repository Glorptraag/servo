/// <reference types="vite/client" />
// @servo/content/fixtures: the Runs tests replay (tasks 2.6, 4.5, 4.7, 4.8 and 1.7's golden runs). A fixture is a
// blueprint, the challenge it is judged against, the switch presses the Run needs, how long it runs, and what it
// must show. The blueprints are bare JSON files in fixtures/blueprints/, so the content validator checks each as a
// blueprint; the rest lives in FIXTURES below, typed, because a wrapper around a blueprint would not be one.
// For tests and tools only. See ../README.md.

import { planWire, validateBlueprint } from '@servo/schema';
import type { Blueprint, ChallengeId, FailureModeId, IssueCode, PlacedPartId, PortRef, RunInput } from '@servo/schema';
import { loadContent } from './index.ts';
import type { Content, ContentIssue } from './index.ts';

/** A fault a Run shows: one of the placed part's own failure modes. */
export interface FaultExpectation {
  readonly partId: PlacedPartId;
  readonly failure: FailureModeId;
}

/** What a Run of the fixture must show. It names no ticks: golden runs (task 1.7) pin exact timing separately. */
export interface FixtureVerdict {
  /** With a challenge only: whether the Run meets its goal, compared with the run record's `goal.met`. */
  readonly goal?: { readonly met: boolean };
  /** Exactly the faults the Run shows, as its run record's `faults` lists them, in any order. Empty for a working build. */
  readonly faults: readonly FaultExpectation[];
  /** A broken fixture's one named fault (task 2.6): the fault it exists to show. It is one of `faults`. */
  readonly namedFault?: FaultExpectation;
  /** A broken fixture that is the build before an impossible drop (task 2.6): `planWire` refuses this wire with `code`. */
  readonly refused?: { readonly from: PortRef; readonly to: PortRef; readonly code: IssueCode };
}

/** One fixture as authored in FIXTURES. */
export interface FixtureSpec {
  /** One line for test names. */
  readonly description: string;
  /** A file in fixtures/blueprints/, without `.json`; several fixtures may share one. Omitted: the challenge's own `start`. */
  readonly blueprint?: string;
  /** The challenge the Run is judged against. The blueprint's arena preset must be the challenge's. */
  readonly challenge?: ChallengeId;
  /** The child's switch presses, exactly as a run record's `inputs` keeps them: tick order, each effective from the next tick. */
  readonly inputs: readonly RunInput[];
  /** How many ticks to run, the run record's `ticks`: a whole number from 1. */
  readonly ticks: number;
  /** Unsigned 32-bit. Default 1. */
  readonly seed?: number;
  readonly expect: FixtureVerdict;
}

/** One fixture as tests and golden runs use it: everything a Run needs, checked against the content. */
export interface ContentFixture {
  /** Its key in FIXTURES. */
  readonly name: string;
  readonly description: string;
  readonly blueprint: Blueprint;
  readonly challenge?: ChallengeId;
  readonly inputs: readonly RunInput[];
  readonly ticks: number;
  readonly seed: number;
  readonly expect: FixtureVerdict;
}

export interface FixtureLoad {
  /** In name order: every fixture with no issue. */
  readonly fixtures: readonly ContentFixture[];
  readonly issues: readonly ContentIssue[];
}

/** Every fixture, by name. Tasks 2.6, 4.7 and 4.8 add theirs, with their blueprints in fixtures/blueprints/. */
export const FIXTURES: Readonly<Record<string, FixtureSpec>> = {
  // Task 2.6, working builds: each Run shows no fault, except the 1-cell what-if, whose DC motors run below their range.
  'level-1-roller': {
    description: 'Level 1: two DC motors wired red to red on the 2-cell battery pack drive the robot forward.',
    blueprint: 'level-1-roller',
    inputs: [],
    ticks: 90,
    expect: { faults: [] },
  },
  'switch-in-the-line': {
    description: 'Level 1: the switch in the power line is opened at tick 30, so the robot stops, and closed at tick 60, so it drives on.',
    blueprint: 'switch-in-the-line',
    inputs: [
      { tick: 30, partId: 'switch', kind: 'switch', closed: false },
      { tick: 60, partId: 'switch', kind: 'switch', closed: true },
    ],
    ticks: 90,
    expect: { faults: [] },
  },
  'one-cell-roller': {
    description: 'Level 2 what-if: on the 1-cell battery pack the robot drives forward at about half speed, and both DC motors show low voltage.',
    blueprint: 'one-cell-roller',
    inputs: [],
    ticks: 90,
    expect: {
      faults: [
        { partId: 'motor-left', failure: 'low-voltage' },
        { partId: 'motor-right', failure: 'low-voltage' },
      ],
    },
  },
  'motor-driver-robot': {
    description: 'Level 2: the motor driver, behind the switch, runs both DC motors forward.',
    blueprint: 'motor-driver-robot',
    inputs: [],
    ticks: 90,
    expect: { faults: [] },
  },
  'bumper-stops-at-wall': {
    description: 'Level 2: the bumper switch feeds the motor driver, so the robot crosses the arena and stops when the bumper switch meets the far wall.',
    blueprint: 'bumper-stops-at-wall',
    inputs: [],
    ticks: 240,
    expect: { faults: [] },
  },
  'led-and-buzzer-robot': {
    description: 'Level 2: behind one switch, the robot drives forward with its LED lit and its buzzer sounding.',
    blueprint: 'led-and-buzzer-robot',
    inputs: [],
    ticks: 90,
    expect: { faults: [] },
  },
  'geared-robot': {
    description: 'Level 2: a gearbox between each DC motor and its large wheel, so the robot drives forward at about a third of the speed.',
    blueprint: 'geared-robot',
    inputs: [],
    ticks: 90,
    expect: { faults: [] },
  },
  'busy-workbench': {
    description: 'Level 2, 25 parts for canvas performance: the fullest direct-drive robot the chassis holds, beside a test board and a lamp on the bench.',
    blueprint: 'busy-workbench',
    inputs: [],
    ticks: 90,
    expect: { faults: [] },
  },
  // Task 2.6, broken builds: one fault each, named, or one impossible drop refused. Every other part is fault-free.
  'broken-reversed-motor': {
    description: 'Level 2 breakdown: the right DC motor is wired backwards, so the robot spins on the spot.',
    blueprint: 'broken-reversed-motor',
    inputs: [],
    ticks: 90,
    expect: { faults: [{ partId: 'motor-right', failure: 'reversed' }], namedFault: { partId: 'motor-right', failure: 'reversed' } },
  },
  'broken-missing-return-wire': {
    description: 'Level 1: the left DC motor has no wire back to the battery pack’s minus, so it stays still and the robot turns.',
    blueprint: 'broken-missing-return-wire',
    inputs: [],
    ticks: 90,
    expect: { faults: [{ partId: 'motor-left', failure: 'no-circuit' }], namedFault: { partId: 'motor-left', failure: 'no-circuit' } },
  },
  'broken-servo-without-signal': {
    description: 'Level 2: a servo motor on two 2-cell battery packs in series has power and no signal, so its arm holds and hums (D50).',
    blueprint: 'broken-servo-without-signal',
    inputs: [],
    ticks: 60,
    expect: { faults: [{ partId: 'servo', failure: 'no-signal' }], namedFault: { partId: 'servo', failure: 'no-signal' } },
  },
  'broken-underpowered-pack': {
    description: 'Level 2: the 1-cell battery pack cannot switch the motor driver on, so it gives its DC motors nothing; the fault is the driver’s.',
    blueprint: 'broken-underpowered-pack',
    inputs: [],
    ticks: 60,
    expect: { faults: [{ partId: 'driver', failure: 'low-voltage' }], namedFault: { partId: 'driver', failure: 'low-voltage' } },
  },
  'broken-top-heavy-chassis': {
    description: 'Level 2: with no caster, the geared robot’s centre of mass sits behind its wheels, outside its supports, so it tips back (D49).',
    blueprint: 'broken-top-heavy-chassis',
    inputs: [],
    ticks: 90,
    expect: { faults: [{ partId: 'chassis', failure: 'top-heavy' }], namedFault: { partId: 'chassis', failure: 'top-heavy' } },
  },
  'broken-short-circuit': {
    description: 'Level 1: a wire straight across the battery pack shorts it; the DC motors and the switch it starves show no fault of their own.',
    blueprint: 'broken-short-circuit',
    inputs: [],
    ticks: 60,
    expect: { faults: [{ partId: 'battery', failure: 'short-circuit' }], namedFault: { partId: 'battery', failure: 'short-circuit' } },
  },
  'broken-wrong-type-wire': {
    description: 'Level 2: a power line (red) dropped on the motor driver’s signal in (yellow) is refused at the socket; the build before it works.',
    blueprint: 'broken-wrong-type-wire',
    inputs: [],
    ticks: 30,
    expect: { faults: [], refused: { from: { part: 'battery', port: 'plus' }, to: { part: 'driver', port: 'in-a' }, code: 'wire.type_mismatch' } },
  },
  'broken-loose-caster': {
    description: 'Level 1: the caster lies behind the robot, not fixed to the chassis, so the chassis drags on the floor.',
    blueprint: 'broken-loose-caster',
    inputs: [],
    ticks: 90,
    expect: { faults: [{ partId: 'caster', failure: 'loose' }], namedFault: { partId: 'caster', failure: 'loose' } },
  },
};

const MANIFEST = 'src/fixtures.ts';
const FOLDER = 'fixtures/blueprints';
const UINT32 = 2 ** 32;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);
const sameFault = (a: FaultExpectation, b: FaultExpectation): boolean => a.partId === b.partId && a.failure === b.failure;

/**
 * Pure: checks every fixture against its blueprint and the content. Each blueprint file must validate and be used by
 * a fixture; each fixture's blueprint, challenge, arena, inputs, ticks, seed and verdict must agree with them. A
 * fixture with an issue is left out. `files` holds the parsed JSON in fixtures/blueprints/, keyed by path inside
 * packages/content.
 */
export const fixturesFrom = (files: Readonly<Record<string, unknown>>, specs: Readonly<Record<string, FixtureSpec>>, content: Content): FixtureLoad => {
  const issues: ContentIssue[] = [];
  const blueprints = new Map<string, Blueprint>();
  for (const file of Object.keys(files).sort(compareText)) {
    const result = validateBlueprint(own(files, file), content.catalogue);
    if (result.ok) blueprints.set(file.slice(file.lastIndexOf('/') + 1).replace(/\.json$/, ''), result.value);
    else issues.push(...result.issues.map((issue) => ({ file, ...issue })));
  }
  const used = new Set<string>();
  const fixtures: ContentFixture[] = [];
  for (const name of Object.keys(specs).sort(compareText)) {
    const spec = own(specs, name);
    if (!spec) continue;
    const found: ContentIssue[] = [];
    const at = (path: string): string => `$['${name}']${path}`;
    const report = (code: ContentIssue['code'], path: string, message: string): void => {
      found.push({ file: MANIFEST, code, path: at(path), message });
    };
    const challenge = spec.challenge === undefined ? undefined : content.challenges.find((candidate) => candidate.id === spec.challenge);
    if (spec.challenge !== undefined && !challenge) report('fixture.unknown_challenge', '.challenge', `Content has no challenge '${spec.challenge}'.`);
    if (spec.blueprint !== undefined) used.add(spec.blueprint);
    const blueprint = spec.blueprint === undefined ? challenge?.start : blueprints.get(spec.blueprint);
    if (spec.blueprint !== undefined && !blueprint) {
      report('fixture.unknown_blueprint', '.blueprint', `No valid blueprint ${FOLDER}/${spec.blueprint}.json.`);
    } else if (!blueprint) {
      report('fixture.unknown_blueprint', '', 'Name a blueprint, or a challenge that has a start.');
    }
    if (blueprint && challenge && blueprint.arena.preset !== challenge.arena.preset) {
      report('challenge.arena_mismatch', '.blueprint', `The blueprint's arena is '${blueprint.arena.preset}', the challenge's '${challenge.arena.preset}'.`);
    }
    if (!Number.isInteger(spec.ticks) || spec.ticks < 1) report('value.out_of_range', '.ticks', 'Run for a whole number of ticks, at least 1.');
    if (spec.seed !== undefined && !(Number.isInteger(spec.seed) && spec.seed >= 0 && spec.seed < UINT32)) {
      report('value.out_of_range', '.seed', 'A seed is an unsigned 32-bit whole number.');
    }
    if (spec.expect.goal && !spec.challenge) report('run.goal_without_challenge', '.expect.goal', 'Only a fixture with a challenge has a goal verdict.');
    const parts = new Map((blueprint?.parts ?? []).map((part) => [part.id, part]));
    spec.inputs.forEach((input, index) => {
      const previous = spec.inputs[index - 1];
      if (!Number.isInteger(input.tick) || input.tick < 0) report('value.out_of_range', `.inputs[${index}].tick`, 'A tick is a whole number from 0.');
      else if (input.tick > spec.ticks) report('run.tick_out_of_range', `.inputs[${index}].tick`, `The Run has ${spec.ticks} ticks.`);
      if (previous && input.tick < previous.tick) report('run.event_order', `.inputs[${index}].tick`, `Tick ${input.tick} comes after tick ${previous.tick}.`);
      const record = content.catalogue.parts.get(parts.get(input.partId)?.part ?? '');
      const manual = record?.behaviour.some((primitive) => primitive.kind === 'switch' && primitive.actuation.kind === 'manual');
      if (blueprint && !manual) report('value.not_allowed', `.inputs[${index}].partId`, `'${input.partId}' is not a placed part with a manual switch.`);
    });
    const checkFault = (fault: FaultExpectation, path: string): void => {
      const record = content.catalogue.parts.get(parts.get(fault.partId)?.part ?? '');
      if (blueprint && !record) report('ref.unknown_placed_part', `${path}.partId`, `No placed part has the id '${fault.partId}'.`);
      else if (record && !record.failureModes.some((mode) => mode.id === fault.failure)) {
        report('ref.unknown_failure_mode', `${path}.failure`, `The ${record.identity.name} has no failure mode '${fault.failure}'.`);
      }
    };
    spec.expect.faults.forEach((fault, index) => {
      checkFault(fault, `.expect.faults[${index}]`);
      if (spec.expect.faults.findIndex((other) => sameFault(other, fault)) < index) report('value.duplicate', `.expect.faults[${index}]`, 'This fault is listed twice.');
    });
    const named = spec.expect.namedFault;
    if (named && !spec.expect.faults.some((fault) => sameFault(fault, named))) {
      report('value.inconsistent', '.expect.namedFault', 'The named fault is one of `faults`.');
    }
    const refused = spec.expect.refused;
    if (refused && blueprint) {
      const plan = planWire(blueprint, content.catalogue, refused.from, refused.to);
      if (plan.legal || plan.code !== refused.code) {
        report('value.inconsistent', '.expect.refused', `planWire gives ${plan.legal ? 'a legal wire' : plan.code}, not ${refused.code}.`);
      }
    }
    issues.push(...found);
    if (found.length === 0 && blueprint) {
      const { description, challenge: id, inputs, ticks, expect } = spec;
      fixtures.push({ name, description, blueprint, ...(id === undefined ? {} : { challenge: id }), inputs, ticks, seed: spec.seed ?? 1, expect });
    }
  }
  for (const name of [...blueprints.keys()].filter((file) => !used.has(file))) {
    issues.push({ file: `${FOLDER}/${name}.json`, code: 'fixture.unused_blueprint', path: '$', message: 'No fixture in FIXTURES uses this blueprint.' });
  }
  return { fixtures, issues };
};

/** The package's fixtures, checked against its own content. Never throws; CI fails when `issues` is not empty. */
export const loadFixtures = (): FixtureLoad =>
  fixturesFrom(
    Object.fromEntries(
      Object.entries(import.meta.glob('../fixtures/blueprints/*.json', { eager: true, import: 'default' })).map(([key, value]) => [key.replace(/^\.\.\//, ''), value]),
    ),
    FIXTURES,
    loadContent().content,
  );

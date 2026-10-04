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
  // Task 2.3: each launch kit's robot (test/kits.test.ts). 360 ticks is over twice the drive to the far wall at the motors' top speed.
  'kit-circuit-crew': {
    description: 'The Circuit Crew kit robot drives through the motor driver to the far wall, where its bumper switch opens and stops it, with no fault.',
    blueprint: 'kit-circuit-crew',
    inputs: [],
    ticks: 360,
    expect: { faults: [] },
  },
  // Pressed open after 2 s; in 4 s, even at the motors' top speed, it cannot reach the floor's edge.
  'kit-rolling-start': {
    description: 'The Rolling Start kit robot drives forward on the open floor until the child opens its switch, with no fault.',
    blueprint: 'kit-rolling-start',
    inputs: [{ tick: 60, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 120,
    expect: { faults: [] },
  },
  // Task 2.6, working builds: each Run shows no fault.
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
  'small-wheel-roller': {
    description: 'Level 2: the Level 1 roller on small wheels drives forward more slowly, its chassis tilted nose down and clear of the floor.',
    blueprint: 'small-wheel-roller',
    inputs: [],
    ticks: 90,
    expect: { faults: [] },
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
    description:
      'Level 2: the 1-cell battery pack cannot switch the motor driver on, so the driver gives its DC motors nothing and holds the one fault; wired straight to the pack, both motors would show low voltage.',
    blueprint: 'broken-underpowered-pack',
    inputs: [],
    ticks: 60,
    expect: { faults: [{ partId: 'driver', failure: 'low-voltage' }], namedFault: { partId: 'driver', failure: 'low-voltage' } },
  },
  'broken-chassis-on-the-floor': {
    description:
      'Level 2: with no caster, the geared robot rocks back 8.0° onto the chassis’s rear edge and rests there, its centre of mass 85 mm inside that edge, so it drags (grounded); no Level 1–2 build on this chassis tips (D49).',
    blueprint: 'broken-chassis-on-the-floor',
    inputs: [],
    ticks: 90,
    expect: { faults: [{ partId: 'chassis', failure: 'scraping' }], namedFault: { partId: 'chassis', failure: 'scraping' } },
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
    description:
      'Level 1: the caster lies behind the robot, fixed to nothing, so the chassis rests on its rear edge and drags; the loose caster’s own fault stands for the chassis’s balance, as a motor driver stands for its motors, so it is the one fault (R-2.6 Q2).',
    blueprint: 'broken-loose-caster',
    inputs: [],
    ticks: 90,
    expect: { faults: [{ partId: 'caster', failure: 'loose' }], namedFault: { partId: 'caster', failure: 'loose' } },
  },
  // Task 2.6, extra: the battery what-if for task 4.8. Neither working nor broken, so not one of the eight and eight.
  'one-cell-roller': {
    description: 'Level 2 what-if, neither working nor broken: on the 1-cell battery pack the robot drives at about half speed, and both DC motors show low voltage.',
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
  // Task 4.7: each Level 1 challenge's passing and failing Runs. A fixture with no blueprint runs the challenge's start.
  'meet-the-battery-pack-wired': {
    description: 'Meet the battery pack, done: plus and minus both wired to the DC motor, so it turns.',
    blueprint: 'motor-on-battery-pack',
    challenge: 'meet-the-battery-pack',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-battery-pack-start': {
    description: 'Meet the battery pack as it starts: only minus is wired, so there is no loop and the DC motor stays still.',
    challenge: 'meet-the-battery-pack',
    inputs: [],
    ticks: 30,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'battery', failure: 'no-loop' },
        { partId: 'motor', failure: 'no-circuit' },
      ],
    },
  },
  'meet-the-dc-motor-wired': {
    description: 'Meet the DC motor, done: both DC motors in a loop with the one battery pack, so both turn.',
    blueprint: 'two-motors-on-battery-pack',
    challenge: 'meet-the-dc-motor',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-dc-motor-start': {
    description: 'Meet the DC motor as it starts: the second DC motor has no wires, so it stays still.',
    challenge: 'meet-the-dc-motor',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-right', failure: 'no-circuit' }] },
  },
  'meet-the-large-wheel-fitted': {
    description: 'Meet the large wheel, done: both large wheels on their shafts, so the robot drives straight.',
    blueprint: 'level-1-roller',
    challenge: 'meet-the-large-wheel',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-large-wheel-start': {
    description: 'Meet the large wheel as it starts: the right large wheel lies beside the robot, so it drags round in a circle.',
    challenge: 'meet-the-large-wheel',
    inputs: [],
    ticks: 60,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'chassis', failure: 'scraping' },
        { partId: 'wheel-right', failure: 'not-driven' },
      ],
    },
  },
  'meet-the-caster-fixed': {
    description: 'Meet the caster, done: the caster holds up the back of the chassis, so the robot rolls clear of the floor.',
    blueprint: 'level-1-roller',
    challenge: 'meet-the-caster',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-caster-start': {
    description: 'Meet the caster as it starts: with no caster, the chassis drags on the floor and the robot crawls.',
    challenge: 'meet-the-caster',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'chassis', failure: 'scraping' }] },
  },
  'meet-the-switch-pressed': {
    description: 'Meet the switch, done: wired through the switch, the DC motor turns, then stops when the switch is pressed.',
    blueprint: 'motor-through-switch',
    challenge: 'meet-the-switch',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-switch-not-pressed': {
    description: 'Meet the switch, wired through the switch and never pressed: the DC motor never stops.',
    blueprint: 'motor-through-switch',
    challenge: 'meet-the-switch',
    inputs: [],
    ticks: 75,
    expect: { goal: { met: false }, faults: [] },
  },
  'meet-the-switch-beside-the-motor': {
    description: 'Meet the switch with the DC motor also wired straight to plus: the switch is outside the loop, so pressing it changes nothing.',
    blueprint: 'switch-beside-the-motor',
    challenge: 'meet-the-switch',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: false }, faults: [{ partId: 'switch', failure: 'outside-loop' }] },
  },
  'drive-forward-both-motors': {
    description: 'Drive forward, done: both DC motors wired red to red, so the robot drives straight.',
    blueprint: 'level-1-roller',
    challenge: 'drive-forward',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'drive-forward-one-motor': {
    description: 'Drive forward with only the left DC motor wired: the robot goes round in a circle.',
    blueprint: 'one-motor-roller',
    challenge: 'drive-forward',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-right', failure: 'no-circuit' }] },
  },
  'stop-with-the-switch-pressed': {
    description: 'Stop with the switch, done: both DC motors through the switch, pressed at tick 30, so the robot drives then stops.',
    blueprint: 'switch-in-the-line',
    challenge: 'stop-with-the-switch',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: true }, faults: [] },
  },
  'stop-with-the-switch-not-pressed': {
    description: 'Stop with the switch, wired but never pressed: the robot never stops.',
    blueprint: 'switch-in-the-line',
    challenge: 'stop-with-the-switch',
    inputs: [],
    ticks: 75,
    expect: { goal: { met: false }, faults: [] },
  },
  'stop-with-the-switch-hung-off-plus': {
    description: 'Stop with the switch, its side A on plus while both DC motors still take plus directly: pressing it does not stop the robot.',
    blueprint: 'switch-hung-off-plus',
    challenge: 'stop-with-the-switch',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: false }, faults: [{ partId: 'switch', failure: 'outside-loop' }] },
  },
  'turn-in-a-circle-one-motor': {
    description: 'Turn in a circle, done: only the left DC motor is wired, so the robot goes round in a circle.',
    blueprint: 'one-motor-roller',
    challenge: 'turn-in-a-circle',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [{ partId: 'motor-right', failure: 'no-circuit' }] },
  },
  'turn-in-a-circle-start': {
    description: 'Turn in a circle as it starts: both DC motors wired, so the robot drives straight.',
    challenge: 'turn-in-a-circle',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [] },
  },
  'over-the-hill-wired': {
    description: 'Over the hill, done: the robot climbs the hill, comes down it and reaches the far side.',
    blueprint: 'roller-over-the-hill',
    challenge: 'over-the-hill',
    inputs: [],
    ticks: 150,
    expect: { goal: { met: true }, faults: [] },
  },
  'over-the-hill-start': {
    description: 'Over the hill as it starts: neither DC motor is wired back to minus, so nothing turns.',
    challenge: 'over-the-hill',
    inputs: [],
    ticks: 150,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'battery', failure: 'no-loop' },
        { partId: 'motor-left', failure: 'no-circuit' },
        { partId: 'motor-right', failure: 'no-circuit' },
      ],
    },
  },
  'push-the-box-both-motors': {
    description: 'Push the box, done: the robot pushes the box until it meets the post, where both DC motors stall.',
    blueprint: 'roller-in-bump-props',
    challenge: 'push-the-box',
    inputs: [],
    ticks: 150,
    expect: {
      goal: { met: true },
      faults: [
        { partId: 'motor-left', failure: 'overload' },
        { partId: 'motor-right', failure: 'overload' },
      ],
    },
  },
  'push-the-box-one-motor': {
    description: 'Push the box with only the left DC motor wired: the robot circles and never reaches the post.',
    blueprint: 'one-motor-roller-in-bump-props',
    challenge: 'push-the-box',
    inputs: [],
    ticks: 150,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-right', failure: 'no-circuit' }] },
  },
  'no-way-out-fixed': {
    description: 'No way out, fixed: the left DC motor wired back to minus, so the robot drives straight with no fault.',
    blueprint: 'kit-rolling-start',
    challenge: 'no-way-out',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'no-way-out-start': {
    description: 'No way out as it starts: the left DC motor has no return wire, so the robot turns.',
    challenge: 'no-way-out',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-left', failure: 'no-circuit' }], namedFault: { partId: 'motor-left', failure: 'no-circuit' } },
  },
  'switch-to-one-side-fixed': {
    description: 'Switch to one side, fixed: both DC motors take power through side B, so pressing the switch stops the robot.',
    blueprint: 'switch-in-the-line',
    challenge: 'switch-to-one-side',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: true }, faults: [] },
  },
  'switch-to-one-side-start': {
    description: 'Switch to one side as it starts: the switch hangs off plus outside the loop, so pressing it changes nothing.',
    challenge: 'switch-to-one-side',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: false }, faults: [{ partId: 'switch', failure: 'outside-loop' }], namedFault: { partId: 'switch', failure: 'outside-loop' } },
  },
  'what-if-one-wheel-off': {
    description: 'What if one wheel comes off, tried: with the right large wheel gone, the chassis drags on that side and the robot circles.',
    blueprint: 'one-wheel-roller',
    challenge: 'what-if-one-wheel',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [{ partId: 'chassis', failure: 'scraping' }] },
  },
  'what-if-one-wheel-start': {
    description: 'What if one wheel comes off, unchanged: both large wheels on, so the robot drives straight.',
    challenge: 'what-if-one-wheel',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [] },
  },
  'what-if-one-motor-on-the-switch-moved': {
    description: 'What if one DC motor skips the switch, tried: pressing the switch stops only the left DC motor, so the robot turns.',
    blueprint: 'one-motor-on-the-switch',
    challenge: 'what-if-one-motor-on-the-switch',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: true }, faults: [] },
  },
  'what-if-one-motor-on-the-switch-start': {
    description: 'What if one DC motor skips the switch, unchanged: pressing the switch stops the whole robot.',
    challenge: 'what-if-one-motor-on-the-switch',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: false }, faults: [] },
  },
  'cross-the-arena-roller': {
    description: 'Cross the arena, done: the Rolling Start robot drives straight into the far-side zone.',
    blueprint: 'roller-in-wall-stop',
    challenge: 'cross-the-arena',
    inputs: [],
    ticks: 150,
    expect: { goal: { met: true }, faults: [] },
  },
  'cross-the-arena-one-motor': {
    description: 'Cross the arena with only the left DC motor wired: the robot circles near the start.',
    blueprint: 'one-motor-roller-in-wall-stop',
    challenge: 'cross-the-arena',
    inputs: [],
    ticks: 150,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-right', failure: 'no-circuit' }] },
  },
  // Task 4.8: each Level 2 challenge's passing and failing Runs.
  'meet-the-motor-driver-wired': {
    description: 'Meet the motor driver, done: power in from the battery pack, so the DC motor on motor A turns.',
    blueprint: 'motor-on-motor-driver',
    challenge: 'meet-the-motor-driver',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-motor-driver-start': {
    description: 'Meet the motor driver as it starts: the motor driver has no plus in, so it gives the DC motor nothing.',
    challenge: 'meet-the-motor-driver',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: false }, faults: [{ partId: 'battery', failure: 'no-loop' }, { partId: 'driver', failure: 'no-power' }] },
  },
  'meet-the-motor-driver-reversed': {
    description: 'Meet the motor driver with its power in swapped: it gives the DC motor nothing.',
    blueprint: 'motor-driver-reversed',
    challenge: 'meet-the-motor-driver',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: false }, faults: [{ partId: 'driver', failure: 'reversed' }] },
  },
  'meet-the-bumper-switch-wired': {
    description: 'Meet the bumper switch, done: the robot crosses the arena and stops as the bumper switch meets the far wall.',
    blueprint: 'bumper-roller-in-wall-stop',
    challenge: 'meet-the-bumper-switch',
    inputs: [],
    ticks: 240,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-bumper-switch-start': {
    description: 'Meet the bumper switch as it starts: nothing feeds side A, so nothing turns.',
    challenge: 'meet-the-bumper-switch',
    inputs: [],
    ticks: 240,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'battery', failure: 'no-loop' },
        { partId: 'bumper', failure: 'outside-loop' },
        { partId: 'motor-left', failure: 'no-circuit' },
        { partId: 'motor-right', failure: 'no-circuit' },
      ],
    },
  },
  'meet-the-bumper-switch-beside-the-motors': {
    description: 'Meet the bumper switch with both DC motors on plus directly: the bumper switch is outside the loop, so the robot drives into the wall and both DC motors stall.',
    blueprint: 'bumper-beside-the-motors',
    challenge: 'meet-the-bumper-switch',
    inputs: [],
    ticks: 240,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'bumper', failure: 'outside-loop' },
        { partId: 'motor-left', failure: 'overload' },
        { partId: 'motor-right', failure: 'overload' },
      ],
    },
  },
  'meet-the-servo-motor-joined': {
    description: 'Meet the servo motor, done: two 2-cell battery packs one after the other power the servo motor, which holds and hums for want of a signal (D50).',
    blueprint: 'broken-servo-without-signal',
    challenge: 'meet-the-servo-motor',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: true }, faults: [{ partId: 'servo', failure: 'no-signal' }] },
  },
  'meet-the-servo-motor-start': {
    description: 'Meet the servo motor as it starts: the battery packs are not joined, so there is no loop and the servo motor is still.',
    challenge: 'meet-the-servo-motor',
    inputs: [],
    ticks: 30,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'battery-1', failure: 'no-loop' },
        { partId: 'battery-2', failure: 'no-loop' },
        { partId: 'servo', failure: 'no-circuit' },
      ],
    },
  },
  'meet-the-servo-motor-one-pack': {
    description: 'Meet the servo motor on one 2-cell battery pack: too little power as well as no signal.',
    blueprint: 'servo-on-one-battery-pack',
    challenge: 'meet-the-servo-motor',
    inputs: [],
    ticks: 30,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'battery-2', failure: 'no-loop' },
        { partId: 'servo', failure: 'no-signal' },
        { partId: 'servo', failure: 'low-voltage' },
      ],
    },
  },
  'meet-the-gearbox-fitted': {
    description: 'Meet the gearbox, done: each large wheel on a gearbox\'s output shaft, so the robot drives straight at about a third of the speed.',
    blueprint: 'geared-robot',
    challenge: 'meet-the-gearbox',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-gearbox-start': {
    description: 'Meet the gearbox as it starts: both large wheels lie beside the robot, so it rests on the chassis and does not move.',
    challenge: 'meet-the-gearbox',
    inputs: [],
    ticks: 60,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'chassis', failure: 'scraping' },
        { partId: 'wheel-left', failure: 'not-driven' },
        { partId: 'wheel-right', failure: 'not-driven' },
      ],
    },
  },
  'meet-the-gearbox-one-wheel': {
    description: 'Meet the gearbox with only the left large wheel on: the robot drags round in a circle.',
    blueprint: 'geared-robot-one-wheel',
    challenge: 'meet-the-gearbox',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'chassis', failure: 'scraping' }, { partId: 'wheel-right', failure: 'not-driven' }] },
  },
  'meet-the-small-wheel-fitted': {
    description: 'Meet the small wheel, done: both small wheels on their DC motors\' shafts, so the robot drives straight.',
    blueprint: 'small-wheel-roller',
    challenge: 'meet-the-small-wheel',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-small-wheel-start': {
    description: 'Meet the small wheel as it starts: the right small wheel lies beside the robot, so it drags round in a circle.',
    challenge: 'meet-the-small-wheel',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'chassis', failure: 'scraping' }, { partId: 'wheel-right', failure: 'not-driven' }] },
  },
  'meet-the-led-wired': {
    description: 'Meet the LED, done: plus to its long leg and its short leg back to minus, so it lights.',
    blueprint: 'led-on-battery-pack',
    challenge: 'meet-the-led',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-led-start': {
    description: 'Meet the LED as it starts: only its short leg is wired, so there is no loop and it stays dark.',
    challenge: 'meet-the-led',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: false }, faults: [{ partId: 'battery', failure: 'no-loop' }, { partId: 'led', failure: 'no-circuit' }] },
  },
  'meet-the-buzzer-wired': {
    description: 'Meet the buzzer, done: plus and minus both wired, so it sounds.',
    blueprint: 'buzzer-on-battery-pack',
    challenge: 'meet-the-buzzer',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: true }, faults: [] },
  },
  'meet-the-buzzer-start': {
    description: 'Meet the buzzer as it starts: only its minus is wired, so there is no loop and it stays silent.',
    challenge: 'meet-the-buzzer',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: false }, faults: [{ partId: 'battery', failure: 'no-loop' }, { partId: 'buzzer', failure: 'no-circuit' }] },
  },
  'meet-the-1-cell-battery-pack-wired': {
    description: 'Meet the 1-cell battery pack, done: the DC motor turns, slowly, on too little power.',
    blueprint: 'motor-on-1-cell-pack',
    challenge: 'meet-the-1-cell-battery-pack',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: true }, faults: [{ partId: 'motor', failure: 'low-voltage' }] },
  },
  'meet-the-1-cell-battery-pack-start': {
    description: 'Meet the 1-cell battery pack as it starts: only minus is wired, so the DC motor stays still.',
    challenge: 'meet-the-1-cell-battery-pack',
    inputs: [],
    ticks: 30,
    expect: { goal: { met: false }, faults: [{ partId: 'battery', failure: 'no-loop' }, { partId: 'motor', failure: 'no-circuit' }] },
  },
  'drive-and-light-wired': {
    description: 'Drive and light, done: the LED\'s long leg on side B and its short leg back to minus, so it lights while the robot drives.',
    blueprint: 'roller-with-led',
    challenge: 'drive-and-light',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'drive-and-light-start': {
    description: 'Drive and light as it starts: the LED has no wires, so the robot drives with the LED dark.',
    challenge: 'drive-and-light',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'led', failure: 'no-circuit' }] },
  },
  'drive-and-light-led-backwards': {
    description: 'Drive and light with the LED the wrong way round: it stays dark.',
    blueprint: 'led-backwards-on-robot',
    challenge: 'drive-and-light',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'led', failure: 'reversed' }] },
  },
  'stop-the-motor-driver-pressed': {
    description: 'Stop the motor driver, done: the motor driver\'s power in on side B, pressed at tick 30, so the robot drives then stops.',
    blueprint: 'motor-driver-robot',
    challenge: 'stop-the-motor-driver',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: true }, faults: [] },
  },
  'stop-the-motor-driver-start': {
    description: 'Stop the motor driver as it starts: the switch has no wires, so the motor driver has no power in and nothing moves.',
    challenge: 'stop-the-motor-driver',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: {
      goal: { met: false },
      faults: [
        { partId: 'battery', failure: 'no-loop' },
        { partId: 'driver', failure: 'no-power' },
        { partId: 'switch', failure: 'outside-loop' },
      ],
    },
  },
  'stop-the-motor-driver-hung-off-plus': {
    description: 'Stop the motor driver with its power in on plus directly: the switch is outside the loop, so pressing it does not stop the robot.',
    blueprint: 'driver-robot-switch-hung-off-plus',
    challenge: 'stop-the-motor-driver',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: false }, faults: [{ partId: 'switch', failure: 'outside-loop' }] },
  },
  'spin-on-the-spot-spinning': {
    description: 'Spin on the spot, done: motor A forward and motor B backward, so the robot spins on the spot.',
    blueprint: 'driver-robot-spinning',
    challenge: 'spin-on-the-spot',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'spin-on-the-spot-start': {
    description: 'Spin on the spot as it starts: both DC motors forward, so the robot drives straight.',
    challenge: 'spin-on-the-spot',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [] },
  },
  'spin-on-the-spot-one-motor-stopped': {
    description: 'Spin on the spot with motor B stopped: the robot turns round the stopped wheel, too slowly to spin on the spot.',
    blueprint: 'driver-robot-one-motor-stopped',
    challenge: 'spin-on-the-spot',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [] },
  },
  'drive-with-the-buzzer-pressed': {
    description: 'Drive with the buzzer, done: the buzzer\'s plus on side B, so pressing the switch stops the robot and the buzzer together.',
    blueprint: 'roller-with-buzzer',
    challenge: 'drive-with-the-buzzer',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: true }, faults: [] },
  },
  'drive-with-the-buzzer-start': {
    description: 'Drive with the buzzer as it starts: the buzzer has no wires, so it stays silent.',
    challenge: 'drive-with-the-buzzer',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: false }, faults: [{ partId: 'buzzer', failure: 'no-circuit' }] },
  },
  'drive-with-the-buzzer-on-plus': {
    description: 'Drive with the buzzer on plus directly: pressing the switch stops the robot, but the buzzer keeps sounding.',
    blueprint: 'roller-with-buzzer-on-plus',
    challenge: 'drive-with-the-buzzer',
    inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }],
    ticks: 75,
    expect: { goal: { met: false }, faults: [] },
  },
  'push-the-heavy-box-geared': {
    description: 'Push the heavy box, done: through the gearboxes the robot pushes the 160 g box into the far-side zone (D52).',
    blueprint: 'geared-robot-heavy-box',
    challenge: 'push-the-heavy-box',
    inputs: [],
    ticks: 540,
    expect: { goal: { met: true }, faults: [] },
  },
  'push-the-heavy-box-into-the-wall': {
    description: 'Push the heavy box, run on: the box meets the far wall, and both large wheels slip on the spot (R-1.7).',
    blueprint: 'geared-robot-heavy-box',
    challenge: 'push-the-heavy-box',
    inputs: [],
    ticks: 690,
    expect: { goal: { met: true }, faults: [{ partId: 'wheel-left', failure: 'slipping' }, { partId: 'wheel-right', failure: 'slipping' }] },
  },
  'push-the-heavy-box-start': {
    description: 'Push the heavy box as it starts: neither DC motor turns its gearbox, so the robot stays at the start.',
    challenge: 'push-the-heavy-box',
    inputs: [],
    ticks: 540,
    expect: { goal: { met: false }, faults: [{ partId: 'gear-left', failure: 'not-driven' }, { partId: 'gear-right', failure: 'not-driven' }] },
  },
  'push-the-heavy-box-one-gearbox': {
    description: 'Push the heavy box with only the left gearbox turning: the robot circles near the start.',
    blueprint: 'geared-robot-one-gearbox-driven',
    challenge: 'push-the-heavy-box',
    inputs: [],
    ticks: 540,
    expect: { goal: { met: false }, faults: [{ partId: 'gear-right', failure: 'not-driven' }] },
  },
  'heavy-box-direct-drive': {
    description: 'The heavy box against a robot without gearboxes: both DC motors stall against the 160 g box short of the far side, which is why push-the-heavy-box needs its gearboxes (D52; direct drive stalls from 143 g).',
    blueprint: 'direct-robot-heavy-box',
    challenge: 'push-the-heavy-box',
    inputs: [],
    ticks: 540,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-left', failure: 'overload' }, { partId: 'motor-right', failure: 'overload' }] },
  },
  'push-the-heavy-box-gearboxes-off': {
    description: 'Push the heavy box with both gearboxes taken off: the large wheels lie beside the robot, so it rests on the chassis and stays at the start.',
    blueprint: 'geared-robot-gearboxes-off',
    challenge: 'push-the-heavy-box',
    inputs: [],
    ticks: 540,
    expect: { goal: { met: false }, faults: [{ partId: 'chassis', failure: 'scraping' }, { partId: 'wheel-left', failure: 'not-driven' }, { partId: 'wheel-right', failure: 'not-driven' }] },
  },
  'light-until-the-wall-wired': {
    description: 'Light until the wall, done: the LED\'s long leg on side B of the bumper switch, so it goes dark as the robot stops at the wall.',
    blueprint: 'bumper-roller-with-led',
    challenge: 'light-until-the-wall',
    inputs: [],
    ticks: 240,
    expect: { goal: { met: true }, faults: [] },
  },
  'light-until-the-wall-start': {
    description: 'Light until the wall as it starts: the LED has no wires, so it stays dark all the way.',
    challenge: 'light-until-the-wall',
    inputs: [],
    ticks: 240,
    expect: { goal: { met: false }, faults: [{ partId: 'led', failure: 'no-circuit' }] },
  },
  'light-until-the-wall-led-on-plus': {
    description: 'Light until the wall with the LED on plus directly: the robot stops at the wall, but the LED stays lit.',
    blueprint: 'bumper-roller-led-on-plus',
    challenge: 'light-until-the-wall',
    inputs: [],
    ticks: 240,
    expect: { goal: { met: false }, faults: [] },
  },
  'one-motor-backwards-fixed': {
    description: 'One motor backwards, fixed: the right DC motor\'s plus on side B and its minus back to minus, so the robot drives straight.',
    blueprint: 'switch-in-the-line',
    challenge: 'one-motor-backwards',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'one-motor-backwards-start': {
    description: 'One motor backwards as it starts: the right DC motor is wired backwards, so the robot spins on the spot.',
    challenge: 'one-motor-backwards',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-right', failure: 'reversed' }], namedFault: { partId: 'motor-right', failure: 'reversed' } },
  },
  'weak-battery-pack-fixed': {
    description: 'Weak battery pack, fixed: a 2-cell battery pack powers the motor driver, so the robot drives straight.',
    blueprint: 'motor-driver-robot',
    challenge: 'weak-battery-pack',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'weak-battery-pack-start': {
    description: 'Weak battery pack as it starts: the 1-cell battery pack cannot switch the motor driver on, so nothing moves.',
    challenge: 'weak-battery-pack',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [{ partId: 'driver', failure: 'low-voltage' }], namedFault: { partId: 'driver', failure: 'low-voltage' } },
  },
  'what-if-one-cell-swapped': {
    description: 'What if the battery pack has one cell, tried: on the 1-cell battery pack the robot drives at about half speed.',
    blueprint: 'one-cell-roller',
    challenge: 'what-if-one-cell',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [{ partId: 'motor-left', failure: 'low-voltage' }, { partId: 'motor-right', failure: 'low-voltage' }] },
  },
  'what-if-one-cell-start': {
    description: 'What if the battery pack has one cell, unchanged: on the 2-cell battery pack the robot drives at full speed.',
    challenge: 'what-if-one-cell',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [] },
  },
  'what-if-one-small-wheel-swapped': {
    description: 'What if one wheel is smaller, tried: with a small wheel on the right, the robot curves.',
    blueprint: 'one-small-wheel-roller',
    challenge: 'what-if-one-small-wheel',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: true }, faults: [] },
  },
  'what-if-one-small-wheel-start': {
    description: 'What if one wheel is smaller, unchanged: both large wheels on, so the robot drives straight.',
    challenge: 'what-if-one-small-wheel',
    inputs: [],
    ticks: 60,
    expect: { goal: { met: false }, faults: [] },
  },
  'stop-at-the-wall-bumper': {
    description: 'Stop at the wall, done: the bumper switch feeds the motor driver, so the robot stops when the bumper switch meets the far wall.',
    blueprint: 'bumper-stops-at-wall',
    challenge: 'stop-at-the-wall',
    inputs: [],
    ticks: 240,
    expect: { goal: { met: true }, faults: [] },
  },
  'stop-at-the-wall-no-bumper': {
    description: 'Stop at the wall with no bumper switch: the robot drives into the wall and both DC motors stall, still powered.',
    blueprint: 'roller-in-wall-stop',
    challenge: 'stop-at-the-wall',
    inputs: [],
    ticks: 240,
    expect: { goal: { met: false }, faults: [{ partId: 'motor-left', failure: 'overload' }, { partId: 'motor-right', failure: 'overload' }] },
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

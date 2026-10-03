// The goal judge's rules on hand-written event streams, without sim-core: how `holds`, `all`, `any`, `sequence` and
// `uses` count ticks, how a condition on a type reads, part states, poses and walls, and a stored summary.
import { describe, expect, it } from 'vitest';
import { makeCatalogue, validateArenaPreset, validatePartRecord } from '@servo/schema';
import type { Blueprint, Challenge, Condition, Goal, RunEvent, RunRecord, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { GoalWatch, judgeRun, namedFaults } from '../../src/challenges/goal.ts';
import { RunWorld } from '../../src/challenges/world.ts';

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(' '));
  return result.value;
};

const catalogue = makeCatalogue({
  parts: exampleParts.map((part) => unwrap(validatePartRecord(part))),
  arenas: exampleArenas.map((arena) => unwrap(validateArenaPreset(arena))),
});

const blueprintOf = (name: string): Blueprint => validBlueprints.find((fixture) => fixture.name === name)?.data as Blueprint;
const board = blueprintOf('led-circuit');
const robot = blueprintOf('rolling-start');

const challengeWith = (goal: Goal, extra: Partial<Challenge> = {}): Challenge => ({
  id: 'test',
  kind: 'guided',
  level: 2,
  title: 'Test',
  goalLine: 'Test',
  goal,
  arena: { preset: 'open-floor', props: [] },
  kit: 'circuit-crew',
  hints: [],
  ...extra,
});

const light = (tick: number, level: number): RunEvent => ({ tick, partId: 'led', kind: 'value', payload: { light: level } });
const switchAt = (tick: number, closed: boolean): RunEvent => ({ tick, partId: 'switch', kind: 'value', payload: { closed } });

/** A run record of `ticks` ticks with these events, judged with no simulation. */
const recordOf = (blueprint: Blueprint, ticks: number, events: readonly RunEvent[], faults: RunRecord['faults'] = []): RunRecord => ({
  version: 1,
  id: '0b7c4f2e-9d1a-4e3b-8c5f-1a2b3c4d5e6f',
  blueprintId: blueprint.meta.id,
  blueprint,
  seed: 1,
  tickRate: 30,
  startedAt: '2026-10-03T09:00:00.000Z',
  endedAt: '2026-10-03T09:00:01.000Z',
  runNumber: 1,
  ticks,
  inputs: [],
  events,
  faults,
  fixed: [],
  hints: [],
});

const lit: Condition = { kind: 'state', target: { placed: 'led' }, state: 'lit' };
const open: Condition = { kind: 'state', target: { part: 'switch' }, state: 'open' };

describe('holds', () => {
  it('counts ticks in a row and starts again when the condition breaks', () => {
    const events = [light(0, 1), light(3, 0), light(4, 1)];
    const judged = judgeRun(challengeWith({ kind: 'holds', when: lit, forTicks: 4 }), recordOf(board, 10, events), catalogue);
    // Lit at 0–2, dark at 3, lit again from 4: four in a row end at tick 7.
    expect(judged).toEqual({ met: true, tick: 7 });
  });

  it('is not met when the Run ends first', () => {
    const judged = judgeRun(challengeWith({ kind: 'holds', when: lit, forTicks: 20 }), recordOf(board, 10, [light(0, 1)]), catalogue);
    expect(judged).toEqual({ met: false });
  });
});

describe('sequence, all, any and uses', () => {
  it('meets the steps of a sequence one after another, never on the same ticks', () => {
    const events = [light(0, 1), switchAt(0, true), switchAt(2, false)];
    const goal: Goal = {
      kind: 'sequence',
      of: [
        { kind: 'holds', when: lit, forTicks: 2 },
        { kind: 'holds', when: open, forTicks: 3 },
      ],
    };
    // Lit for 2 ticks at tick 1; then open for 3 ticks from tick 2: met at tick 4.
    expect(judgeRun(challengeWith(goal), recordOf(board, 10, events), catalogue)).toEqual({ met: true, tick: 4 });
    // A step already true while the step before runs only counts from the tick after it is met.
    const late: Goal = { kind: 'sequence', of: [{ kind: 'holds', when: open, forTicks: 3 }, { kind: 'holds', when: lit, forTicks: 1 }] };
    expect(judgeRun(challengeWith(late), recordOf(board, 10, [...events, light(5, 0)]), catalogue)).toEqual({ met: false });
  });

  it('meets all when every part is met at some tick, at the last of them, and any at the first', () => {
    const events = [light(0, 1), switchAt(0, true), switchAt(5, false)];
    const parts: Goal[] = [
      { kind: 'holds', when: lit, forTicks: 1 },
      { kind: 'holds', when: open, forTicks: 1 },
    ];
    expect(judgeRun(challengeWith({ kind: 'all', of: parts }), recordOf(board, 10, events), catalogue)).toEqual({ met: true, tick: 5 });
    expect(judgeRun(challengeWith({ kind: 'any', of: parts }), recordOf(board, 10, events), catalogue)).toEqual({ met: true, tick: 0 });
  });

  it('reads uses from the build that ran', () => {
    const run = recordOf(board, 5, []);
    expect(judgeRun(challengeWith({ kind: 'uses', part: 'led', count: 1 }), run, catalogue)).toEqual({ met: true, tick: 0 });
    expect(judgeRun(challengeWith({ kind: 'uses', part: 'led', count: 2 }), run, catalogue)).toEqual({ met: false });
  });
});

describe('conditions', () => {
  it('reads a condition on a type as any part of it, so not of a type means none shows it, and none placed means none', () => {
    const world = new RunWorld(board, catalogue, catalogue.arenas?.get('open-floor'));
    world.advance(0, [light(0, 0)]);
    expect(world.holds({ kind: 'state', target: { part: 'dc-motor' }, state: 'powered' })).toBe(false);
    expect(world.holds({ kind: 'not', of: { kind: 'state', target: { part: 'dc-motor' }, state: 'powered' } })).toBe(true);
    expect(world.holds({ kind: 'state', target: { part: 'led' }, state: 'dark' })).toBe(true);
    expect(world.holds({ kind: 'state', target: { placed: 'no-such-part' }, state: 'dark' })).toBe(false);
  });

  it('gives sounds, faults, and the switch’s state only as the events last left them', () => {
    const world = new RunWorld(board, catalogue, undefined);
    world.advance(0, [
      { tick: 0, partId: 'led', kind: 'sound', payload: { sound: 'hum', level: 0.5 } },
      { tick: 0, partId: 'led', kind: 'fault', payload: { failure: 'reversed', active: true } },
    ]);
    expect(world.inState('led', 'sounding')).toBe(true);
    expect(world.holds({ kind: 'fault', target: { part: 'led' }, failure: 'reversed' })).toBe(true);
    expect(world.inState('switch', 'open')).toBe(false);
    expect(world.inState('switch', 'closed')).toBe(false);
    world.advance(1, [
      { tick: 1, partId: 'led', kind: 'sound', payload: { sound: 'hum', level: 0 } },
      { tick: 1, partId: 'led', kind: 'fault', payload: { failure: 'reversed', active: false } },
    ]);
    expect(world.inState('led', 'silent')).toBe(true);
    expect(world.faultActive('led', 'reversed')).toBe(false);
  });

  it('places parts on their body, measures speed, heading and turning from the tick before, and tipping from the body', () => {
    const world = new RunWorld(robot, catalogue, catalogue.arenas?.get('wall-stop'));
    world.advance(0, [{ tick: 0, partId: 'chassis', kind: 'motion', payload: { x: 300, y: 600, heading: 0, pitch: 0, roll: 0 } }]);
    expect(world.motionOf('chassis')).toEqual({ speed: 0, forward: 0, turnRate: 0 });
    world.advance(1, [{ tick: 1, partId: 'chassis', kind: 'motion', payload: { x: 301, y: 600, heading: 1, pitch: 0, roll: 0 } }]);
    const moving = world.motionOf('chassis');
    expect(moving?.speed).toBeCloseTo(30);
    expect(moving?.forward).toBeCloseTo(30, 1);
    expect(moving?.turnRate).toBeCloseTo(30);
    // The left motor rides on the chassis, so it moves with it.
    const motor = world.poseOf('motor-left');
    expect(motor).toBeDefined();
    expect(motor?.x).not.toBe(301);
    world.advance(2, [{ tick: 2, partId: 'chassis', kind: 'motion', payload: { x: 301, y: 600, heading: 1, pitch: -90, roll: 0 } }]);
    expect(world.inState('motor-left', 'tipped')).toBe(true);
    expect(world.inState('chassis', 'upright')).toBe(false);
  });

  it('measures from the nearest point of the footprint to the wall’s face', () => {
    const arena = catalogue.arenas?.get('wall-stop');
    const wall = arena?.walls.find((candidate) => candidate.id === 'far-wall');
    if (!arena || !wall) throw new Error('no far wall');
    const world = new RunWorld(robot, catalogue, arena);
    const size = catalogue.parts.get('chassis')?.body.size.x ?? 0;
    // The chassis's front 10 mm short of the face: the wall's line less half its thickness.
    const x = wall.from.x - wall.thicknessMm / 2 - 10 - size / 2;
    world.advance(0, [{ tick: 0, partId: 'chassis', kind: 'motion', payload: { x, y: 600, heading: 0 } }]);
    expect(world.gapToWall('chassis', wall)).toBeCloseTo(10);
    expect(world.holds({ kind: 'near-wall', target: { part: 'chassis' }, wall: 'far-wall', withinMm: 10 })).toBe(true);
    expect(world.holds({ kind: 'near-wall', target: { part: 'chassis' }, wall: 'far-wall', withinMm: 9 })).toBe(false);
    expect(world.holds({ kind: 'near-wall', target: { part: 'chassis' }, wall: 'no-such-wall', withinMm: 1000 })).toBe(false);
  });
});

describe('breakdowns and summaries', () => {
  it('names a breakdown’s faults from its hint ladders, every fault when it names none, and none for other kinds', () => {
    const goal: Goal = { kind: 'holds', when: lit, forTicks: 1 };
    const ladder = { when: { kind: 'fault', target: { placed: 'led' }, failure: 'reversed' }, steps: [] } as const;
    expect(namedFaults(challengeWith(goal, { kind: 'breakdown', hints: [ladder] }))).toEqual([{ target: { placed: 'led' }, failure: 'reversed' }]);
    expect(namedFaults(challengeWith(goal, { kind: 'breakdown' }))).toBe('any');
    expect(namedFaults(challengeWith(goal, { hints: [ladder] }))).toEqual([]);
  });

  it('keeps a breakdown unmet once its named fault shows, even when the goal holds later', () => {
    const goal: Goal = { kind: 'holds', when: lit, forTicks: 2 };
    const breakdown = challengeWith(goal, { kind: 'breakdown' });
    const fault: RunEvent = { tick: 0, partId: 'led', kind: 'fault', payload: { failure: 'reversed', active: true } };
    const ended: RunEvent = { tick: 1, partId: 'led', kind: 'fault', payload: { failure: 'reversed', active: false } };
    const run = recordOf(board, 10, [fault, light(0, 1), ended], [{ partId: 'led', failure: 'reversed', firstTick: 0 }]);
    expect(judgeRun(breakdown, run, catalogue)).toEqual({ met: false });
    expect(judgeRun(challengeWith(goal), run, catalogue)).toEqual({ met: true, tick: 1 });
  });

  it('gives a stored summary’s own verdict, since it has no events to judge', () => {
    const full = recordOf(board, 10, [light(0, 1)]);
    const summary: RunRecord = Object.fromEntries(Object.entries(full).filter(([key]) => key !== 'events')) as unknown as RunRecord;
    const challenge = challengeWith({ kind: 'holds', when: lit, forTicks: 1 });
    expect(judgeRun(challenge, summary, catalogue)).toEqual({ met: false });
    expect(judgeRun(challenge, { ...summary, challenge: 'test', goal: { met: true, tick: 0 } }, catalogue)).toEqual({ met: true, tick: 0 });
  });

  it('gives the same verdict live, tick by tick, and stays met once met', () => {
    const challenge = challengeWith({ kind: 'holds', when: lit, forTicks: 2 });
    const watch = new GoalWatch({ challenge, blueprint: board, catalogue });
    expect(watch.push(0, [light(0, 1)])).toEqual({ met: false });
    expect(watch.push(1, [])).toEqual({ met: true, tick: 1 });
    expect(watch.push(2, [light(2, 0)])).toEqual({ met: true, tick: 1 });
  });
});

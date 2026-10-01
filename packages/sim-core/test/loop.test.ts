// The tick loop and the recorder (task 1.5) against the schema's example parts, arenas and blueprints: createSimulation's
// checks and canonical copy, tick 0, the event stream and its fold, the order of events, inputs and their replay, flows,
// faults merged from the three solvers, snapshot and restore byte for byte, the program slot, the warm-up, dispose, the
// run record and `fixed`. One file, kept short, so that the loop's tests take one of Vitest's workers for a few seconds
// and leave the others to the timing tests beside them. The many-run determinism sweeps (every schema blueprint and
// content fixture) are packages/tools/test/sim-determinism.test.ts, which runs after every other package.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RUN_SOUNDS, canonicalJson, canonicalizeBlueprint, serializeBlueprint, validateBlueprint, validateRunRecord } from '@servo/schema';
import type { Blueprint, BuildChange, RunEvent, RunRecord } from '@servo/schema';
import { invalidBlueprints, validBlueprints } from '@servo/schema/fixtures';
import { createSimulation } from '../src/index.ts';
import type { RunRecordContext, Simulation, SimulationSetupError } from '../src/index.ts';
import type { Model } from '../src/electrical/model.ts';
import { buildGraph } from '../src/graph/index.ts';
import { initMechanics } from '../src/mechanical/index.ts';
import { blockRuleRuntime } from '../src/program/index.ts';
import { buildChanges, fixedFaults } from '../src/recorder/index.ts';
import { eventsOf, liveOf } from '../src/loop/frame.ts';
import { buildModels } from '../src/loop/models.ts';
import { solveTick, startState } from '../src/loop/tick.ts';
import { warmControls } from '../src/loop/warm.ts';
import { CONTEXT, arenaOf, arenas, brainBench, catalogue, failureOrder, fixture, flips, fold, frameText, make, sameBytes, stepTo, unlinked, unwrap, without } from './loop-support.ts';

// Whole Runs, stepped tick by tick: generous for a busy machine.
vi.setConfig({ testTimeout: 120_000 });

beforeAll(() => initMechanics());

const refusal = async (promise: Promise<unknown>): Promise<SimulationSetupError> => {
  try {
    await promise;
  } catch (error) {
    return error as SimulationSetupError;
  }
  throw new Error('Expected createSimulation to refuse.');
};

describe('createSimulation', () => {
  it.each(validBlueprints.map((entry) => entry.name))('simulates %s, however wrong it is', async (name) => {
    const simulation = await make(fixture(name));
    expect(simulation.tick).toBe(0);
    expect(simulation.frame.tick).toBe(0);
    expect(simulation.seed).toBe(7);
    simulation.dispose();
  });

  it.each(invalidBlueprints.map((entry) => [entry.name, entry] as const))('refuses the invalid blueprint %s with the graph builder’s issues', async (_, entry) => {
    const blueprint = entry.data as Blueprint;
    const error = await refusal(createSimulation({ blueprint, catalogue, arena: arenas[0] as never, seed: 1 }));
    expect(error.name).toBe('SimulationSetupError');
    expect(error).toBeInstanceOf(Error);
    let issues: unknown;
    try {
      buildGraph(blueprint, catalogue);
    } catch (graphError) {
      issues = (graphError as { issues: unknown }).issues;
    }
    expect(error.issues).toEqual(issues);
    expect(error.issues).toContainEqual(expect.objectContaining(entry.expect));
  });

  it('refuses an arena preset that does not validate, or is not the one the blueprint names', async () => {
    const blueprint = fixture('rolling-start');
    const broken = await refusal(createSimulation({ blueprint, catalogue, arena: { ...arenaOf(blueprint), friction: -1 }, seed: 1 }));
    expect(broken.name).toBe('SimulationSetupError');
    expect(broken.issues.map((issue) => issue.code)).toContain('value.out_of_range');
    const other = arenas.find((arena) => arena.id === 'wall-stop');
    if (!other) throw new Error('No wall-stop arena.');
    const mismatch = await refusal(createSimulation({ blueprint, catalogue, arena: other, seed: 1 }));
    expect(mismatch.issues).toEqual([{ code: 'value.inconsistent', path: '$.id', message: "The blueprint names the arena preset 'open-floor', not 'wall-stop'." }]);
  });

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('refuses the seed %s', async (seed) => {
    const error = await refusal(createSimulation({ blueprint: fixture('led-circuit'), catalogue, arena: arenaOf(fixture('led-circuit')), seed }));
    expect(error.name).toBe('SimulationSetupError');
    expect(error.issues[0]?.path).toBe('$');
  });

  it('accepts every unsigned 32-bit seed', async () => {
    for (const seed of [0, 1, 0xffffffff]) {
      const simulation = await make(fixture('led-circuit'), seed);
      expect(simulation.seed).toBe(seed);
      simulation.dispose();
    }
  });

  it('copies the blueprint in canonical form and never touches the caller’s', async () => {
    const base = fixture('rolling-start');
    // The same build, written the way another input path might: parts and wires reversed, a power wire the other way round.
    const messy: Blueprint = {
      ...base,
      parts: [...base.parts].reverse(),
      wires: [...base.wires].reverse().map((wire) => (wire.id === 'w8' ? { ...wire, from: wire.to, to: wire.from } : wire)),
    };
    expect(validateBlueprint(messy, catalogue).ok).toBe(true);
    const before = JSON.stringify(messy);
    const simulation = await make(messy);
    stepTo(simulation, 30);
    expect(JSON.stringify(messy)).toBe(before);
    expect(serializeBlueprint(simulation.blueprint)).toBe(serializeBlueprint(canonicalizeBlueprint(base, catalogue)));
    expect(simulation.blueprint).not.toBe(base);
    expect(Object.isFrozen(simulation.blueprint)).toBe(true);
    expect(Object.isFrozen(simulation.blueprint.parts[0]?.position)).toBe(true);
    // The same build, however it was written, is the same Run.
    const plain = await make(base);
    stepTo(plain, 30);
    expect(JSON.stringify(simulation.record(CONTEXT))).toBe(JSON.stringify(plain.record(CONTEXT)));
  });
});

describe('tick 0', () => {
  it('gives every subject’s starting state, before anything moves', async () => {
    const blueprint = fixture('bumper-robot');
    const simulation = await make(blueprint);
    const { frame } = simulation;
    const parts = [...blueprint.parts.map((part) => part.id)].sort();
    const props = [...arenaOf(blueprint).props, ...blueprint.arena.props].map((prop) => `arena:${prop.id}`).sort();
    expect([...frame.live.keys()]).toEqual([...parts, ...props]);
    expect(frame.events.every((event) => event.tick === 0)).toBe(true);
    // Bodies: the robot's root part, the buzzer (fixed to nothing, so it lies where it was placed, D19) and each prop.
    // Parts on the robot ride with it.
    expect(frame.events.filter((event) => event.kind === 'motion').map((event) => event.partId)).toEqual(['buzzer', 'chassis', ...props]);
    expect(frame.live.get('chassis')?.motion).toMatchObject({ x: 300, y: 600, heading: 0 });
    expect(frame.live.get('battery')?.values).toMatchObject({ volts: expect.any(Number), milliamps: expect.any(Number), charge: 1 });
    expect(frame.live.get('bumper')?.values.closed).toBe(true);
    expect(frame.live.get('caster')).toEqual({ values: {}, sounds: [], faults: [] });
    // The example servo motor starts at 3.5 V, above a 2-cell pack: it is low from tick 0 (docs/electrical.md).
    expect(frame.live.get('servo')?.faults).toEqual(['low-voltage']);
    simulation.dispose();
  });

  it('places loose parts where they lie when no part holds another', async () => {
    const simulation = await make(fixture('led-circuit'));
    const motions = simulation.frame.events.filter((event) => event.kind === 'motion').map((event) => event.partId);
    expect(motions).toEqual(['battery', 'led', 'switch']);
    simulation.dispose();
  });
});

describe('the event stream', () => {
  it.each(validBlueprints.map((entry) => entry.name))('folds to frame.live at every tick of %s', async (name) => {
    const blueprint = fixture(name);
    const simulation = await make(blueprint);
    const order = failureOrder(blueprint);
    const events: RunEvent[] = [];
    for (const frame of stepTo(simulation, 30, flips(blueprint))) {
      events.push(...frame.events);
      const folded = fold(events, order);
      for (const [subject, live] of frame.live) expect(folded.get(subject) ?? { values: {}, sounds: [], faults: [] }).toEqual(live);
      expect([...folded.keys()].every((subject) => frame.live.has(subject))).toBe(true);
    }
    simulation.dispose();
  });

  it.each(validBlueprints.map((entry) => entry.name))('keeps the documented order within each tick of %s', async (name) => {
    const blueprint = fixture(name);
    const simulation = await make(blueprint);
    const subjects = [...simulation.frame.live.keys()];
    const order = failureOrder(blueprint);
    const KINDS = ['value', 'motion', 'sound', 'fault'];
    const rank = (event: RunEvent): number[] => [
      subjects.indexOf(event.partId),
      KINDS.indexOf(event.kind),
      event.kind === 'sound' ? RUN_SOUNDS.indexOf(event.payload.sound) : event.kind === 'fault' ? (order.get(event.partId) ?? []).indexOf(event.payload.failure) : 0,
    ];
    /** Whether `a` comes strictly before `b`, comparing ranks in turn. */
    const before = (a: readonly number[], b: readonly number[]): boolean => {
      for (const [at, value] of a.entries()) if (value !== b[at]) return value < (b[at] ?? 0);
      return false;
    };
    for (const frame of stepTo(simulation, 30, flips(blueprint))) {
      const ranks = frame.events.map(rank);
      for (const [index, current] of ranks.entries()) {
        expect(current.every((value) => value >= 0)).toBe(true);
        const previous = ranks[index - 1];
        if (previous) expect(before(previous, current)).toBe(true);
      }
      expect(frame.events.every((event) => event.tick === frame.tick)).toBe(true);
    }
    simulation.dispose();
  });

  it('sends only the readouts that changed, and stops a sound at level 0', async () => {
    const blueprint = fixture('rolling-start');
    const simulation = await make(blueprint);
    const frames = stepTo(simulation, 30, flips(blueprint));
    // The switch opens at tick 11: its `closed` readout changes there and nowhere else until it closes at tick 21.
    const closed = frames.flatMap((frame) => frame.events.filter((event) => event.partId === 'switch' && event.kind === 'value' && event.payload.closed !== undefined));
    expect(closed.map((event) => [event.tick, event.kind === 'value' ? event.payload.closed : undefined])).toEqual([
      [0, true],
      [11, false],
      [21, true],
    ]);
    // The motors whir while driven, and wind down to silence once the switch is open.
    const motor = frames.flatMap((frame) => frame.events.filter((event) => event.partId === 'motor-left' && event.kind === 'sound'));
    const stop = motor.find((event) => event.kind === 'sound' && event.payload.level === 0);
    expect(stop?.tick).toBeGreaterThan(11);
    expect(stop?.tick).toBeLessThan(21);
    expect(frames[20]?.live.get('motor-left')?.sounds).toEqual([]);
    simulation.dispose();
  });
});

describe('inputs', () => {
  it('records a flip at the current tick, and it takes effect in the next step', async () => {
    const simulation = await make(fixture('led-circuit'));
    stepTo(simulation, 5);
    expect(simulation.input({ partId: 'switch', kind: 'switch', closed: false })).toBe(true);
    expect(simulation.frame.live.get('switch')?.values.closed).toBe(true);
    expect(simulation.frame.live.get('led')?.values.light).toBeGreaterThan(0);
    const next = simulation.step();
    expect(next.live.get('switch')?.values.closed).toBe(false);
    expect(next.live.get('led')?.values.light).toBe(0);
    expect(simulation.record(CONTEXT).inputs).toEqual([{ tick: 5, partId: 'switch', kind: 'switch', closed: false }]);
    simulation.dispose();
  });

  it('refuses a part with no manual switch, and a switch already that way, recording nothing', async () => {
    const simulation = await make(fixture('bumper-robot'));
    expect(simulation.input({ partId: 'bumper', kind: 'switch', closed: false })).toBe(false);
    expect(simulation.input({ partId: 'battery', kind: 'switch', closed: false })).toBe(false);
    expect(simulation.input({ partId: 'nothing-here', kind: 'switch', closed: false })).toBe(false);
    const led = await make(fixture('led-circuit'));
    expect(led.input({ partId: 'switch', kind: 'switch', closed: true })).toBe(false);
    expect(led.input({ partId: 'switch', kind: 'switch', closed: false })).toBe(true);
    expect(led.input({ partId: 'switch', kind: 'switch', closed: false })).toBe(false);
    expect(led.input({ partId: 'switch', kind: 'switch', closed: true })).toBe(true);
    expect(simulation.record(CONTEXT).inputs).toEqual([]);
    expect(led.record(CONTEXT).inputs).toEqual([
      { tick: 0, partId: 'switch', kind: 'switch', closed: false },
      { tick: 0, partId: 'switch', kind: 'switch', closed: true },
    ]);
    simulation.dispose();
    led.dispose();
  });

  it('replays exactly from the run record’s inputs', async () => {
    const blueprint = fixture('reversed-motor');
    const first = await make(blueprint, 99);
    stepTo(first, 45, flips(blueprint));
    const record = first.record(CONTEXT);
    const again = await make(record.blueprint, record.seed);
    stepTo(again, record.ticks, record.inputs);
    expect(JSON.stringify(again.record(CONTEXT))).toBe(JSON.stringify(record));
    first.dispose();
    again.dispose();
  });
});

describe('faults', () => {
  it('merges the electrical solver’s faults', async () => {
    const shorted = await make(fixture('short-circuit'));
    expect(shorted.frame.live.get('battery')?.faults).toEqual(['short-circuit']);
    const reversed = await make(fixture('reversed-motor'));
    expect(reversed.frame.live.get('motor-right')?.faults).toEqual(['reversed']);
    shorted.dispose();
    reversed.dispose();
  });

  it('merges the behaviour runtime’s faults', async () => {
    // The left wheel's hub is linked to nothing, so it is not driven.
    const simulation = await make(unlinked('rolling-start', ['w6']));
    expect(simulation.frame.live.get('wheel-left')?.faults).toEqual(['not-driven']);
    simulation.dispose();
  });

  it('merges the mechanical solver’s faults', async () => {
    const simulation = await make(without('rolling-start', ['caster']));
    stepTo(simulation, 10);
    expect(simulation.frame.live.get('chassis')?.faults).toEqual(['scraping']);
    expect(simulation.record(CONTEXT).faults).toContainEqual({ partId: 'chassis', failure: 'scraping', firstTick: 0 });
    simulation.dispose();
  });

  it('keeps a short the child closes for as long as it lasts, and lists it once', async () => {
    const simulation = await make(fixture('switch-across-pack'));
    expect(simulation.frame.live.get('switch')?.faults).toEqual(['across-the-pack']);
    expect(simulation.frame.live.get('battery')?.faults).toEqual(['short-circuit']);
    const inputs = [
      { tick: 5, partId: 'switch', kind: 'switch' as const, closed: false },
      { tick: 10, partId: 'switch', kind: 'switch' as const, closed: true },
    ];
    const frames = stepTo(simulation, 15, inputs);
    expect(frames[6]?.events.filter((event) => event.kind === 'fault').map((event) => [event.partId, event.kind === 'fault' && event.payload.active])).toEqual([
      ['battery', false],
      ['switch', false],
    ]);
    expect(frames[11]?.live.get('switch')?.faults).toEqual(['across-the-pack']);
    expect(simulation.record(CONTEXT).faults).toEqual([
      { partId: 'battery', failure: 'short-circuit', firstTick: 0 },
      { partId: 'switch', failure: 'across-the-pack', firstTick: 0 },
    ]);
    simulation.dispose();
  });

  it('records no fault for what a flip leaves unmet', async () => {
    const blueprint = fixture('rolling-start');
    const simulation = await make(blueprint);
    stepTo(simulation, 30, flips(blueprint));
    expect(simulation.record(CONTEXT).faults).toEqual([]);
    simulation.dispose();
  });
});

describe('flows', () => {
  it('gives each power line, signal line and drive linkage its flow, in wire id order, and mounts none', async () => {
    const blueprint = fixture('bumper-robot');
    const simulation = await make(blueprint);
    const frame = simulation.step();
    const graph = buildGraph(simulation.blueprint, catalogue);
    const carrying = [...graph.powerLines.map((line) => line.wire), ...graph.signals.map((link) => link.wire), ...graph.drives.map((link) => link.wire)].sort();
    expect([...frame.flows.keys()]).toEqual(carrying);
    for (const line of graph.powerLines) expect(Object.keys(frame.flows.get(line.wire) ?? {})).toEqual(['milliamps']);
    for (const link of graph.drives) expect(Object.keys(frame.flows.get(link.wire) ?? {})).toEqual(['rpm']);
    // No brain drives the signal lines in v1 (D41).
    for (const link of graph.signals) expect(frame.flows.get(link.wire)).toEqual({});
    simulation.dispose();
  });

  it('counts a power line’s current from its from port to its to port', async () => {
    const simulation = await make(fixture('led-circuit'));
    const frame = simulation.step();
    const led = frame.live.get('led')?.values.milliamps ?? 0;
    expect(led).toBeGreaterThan(1);
    const graph = buildGraph(simulation.blueprint, catalogue);
    // Into the LED's plus along a line written to it, out of its minus along a line written from it.
    for (const line of graph.powerLines.filter((each) => each.to.part === 'led' || each.from.part === 'led')) {
      const end = line.to.part === 'led' ? line.to : line.from;
      const into = end.port === 'plus' ? led : -led;
      expect(frame.flows.get(line.wire)?.milliamps).toBeCloseTo(line.to.part === 'led' ? into : -into, 9);
    }
    simulation.dispose();
  });
});

describe('snapshot and restore', () => {
  it('restores tick 0 byte for byte on Stop, and the next Run plays the same', async () => {
    const blueprint = fixture('bumper-robot');
    const simulation = await make(blueprint);
    const start = simulation.snapshot();
    const tick0 = frameText(simulation.frame);
    const first = stepTo(simulation, 30).map(frameText);
    const restored = simulation.restore(start);
    expect(simulation.tick).toBe(0);
    expect(frameText(restored)).toBe(tick0);
    expect(sameBytes(simulation.snapshot().bytes, start.bytes)).toBe(true);
    expect(stepTo(simulation, 30).map(frameText)).toEqual(first);
    expect(simulation.record(CONTEXT).ticks).toBe(30);
    simulation.dispose();
  });

  it('resumes mid-Run exactly, inputs, faults and all', async () => {
    const blueprint = fixture('switch-across-pack');
    const inputs = [
      { tick: 6, partId: 'switch', kind: 'switch' as const, closed: false },
      { tick: 20, partId: 'switch', kind: 'switch' as const, closed: true },
    ];
    const unbroken = await make(blueprint);
    stepTo(unbroken, 30, inputs);
    const simulation = await make(blueprint);
    stepTo(simulation, 12, inputs);
    const middle = simulation.snapshot();
    const tail = stepTo(simulation, 30, inputs).map(frameText);
    simulation.restore(middle);
    expect(simulation.tick).toBe(12);
    expect(stepTo(simulation, 30, inputs).map(frameText)).toEqual(tail);
    expect(JSON.stringify(simulation.record(CONTEXT))).toBe(JSON.stringify(unbroken.record(CONTEXT)));
    // A snapshot holds the whole state, so equal states are equal bytes.
    simulation.restore(middle);
    expect(sameBytes(simulation.snapshot().bytes, middle.bytes)).toBe(true);
    unbroken.dispose();
    simulation.dispose();
  });

  it('gives equal bytes for equal states, in any Simulation of the same Run', async () => {
    const blueprint = fixture('rolling-start');
    const one = await make(blueprint);
    const two = await make(blueprint);
    stepTo(one, 30, flips(blueprint));
    stepTo(two, 30, flips(blueprint));
    expect(sameBytes(one.snapshot().bytes, two.snapshot().bytes)).toBe(true);
    // So a snapshot of one restores into the other: the same blueprint, part records, arena and seed are the same Run.
    two.restore(one.snapshot());
    expect(frameText(two.frame)).toBe(frameText(one.frame));
    one.dispose();
    two.dispose();
  });

  it('throws for a snapshot from another Simulation', async () => {
    const simulation = await make(fixture('rolling-start'));
    const otherBuild = await make(fixture('reversed-motor'));
    const otherSeed = await make(fixture('rolling-start'), 8);
    expect(() => simulation.restore(otherBuild.snapshot())).toThrow(/another Simulation/);
    expect(() => simulation.restore(otherSeed.snapshot())).toThrow(/another Simulation/);
    const mine = simulation.snapshot();
    expect(() => simulation.restore({ tick: 3, bytes: mine.bytes })).toThrow(/another Simulation/);
    expect(() => simulation.restore({ tick: 0, bytes: mine.bytes.slice(0, 40) })).toThrow(/another Simulation/);
    simulation.dispose();
    otherBuild.dispose();
    otherSeed.dispose();
  });
});

describe('the program slot', () => {
  it('runs the Run’s ProgramRuntime each tick, from tick 0, and keeps its state in snapshots', async () => {
    const blueprint = brainBench();
    const line = blueprint.wires.find((wire) => wire.to.part === 'servo' && wire.to.port === 'signal');
    if (!line) throw new Error('No signal line to the servo motor.');
    // "Always set out-1 to a quarter": the servo motor turns to 45°.
    const program = blockRuleRuntime(new Map([['brain', { rules: [{ when: { kind: 'always' }, then: [{ kind: 'set', output: 'out-1', level: 0.25 }] }] }]]));
    const simulation = await make(blueprint, 7, program);
    const frames = stepTo(simulation, 30);
    expect(frames[0]?.flows.get(line.id)).toEqual({ signal: 0.25 });
    expect(frames[0]?.live.get('servo')?.faults).toEqual([]);
    expect(frames[30]?.live.get('servo')?.values.angle).toBe(45);
    // With no program, the v1 no-op brain drives nothing (D41): the servo motor holds and hums, with no signal.
    const plain = await make(blueprint);
    expect(plain.frame.flows.get(line.id)).toEqual({});
    expect(plain.frame.live.get('servo')?.faults).toEqual(['no-signal']);
    expect(plain.frame.live.get('servo')?.sounds.map((sound) => sound.sound)).toEqual(['hum']);
    plain.dispose();
    const middle = await make(blueprint, 7, program);
    stepTo(middle, 1);
    const snapshot = middle.snapshot();
    stepTo(middle, 30);
    middle.restore(snapshot);
    stepTo(middle, 30);
    expect(JSON.stringify(middle.record(CONTEXT))).toBe(JSON.stringify(simulation.record(CONTEXT)));
    simulation.dispose();
    middle.dispose();
  });
});

describe('the warm-up', () => {
  it('searches every switch position before tick 0, so no tick searches the wiring', async () => {
    const blueprint = fixture('bumper-robot');
    const graph = buildGraph(canonicalizeBlueprint(blueprint, catalogue), catalogue);
    // The wall-stop arena with the robot starting 330 mm from the far wall's face, and no props.
    const models = buildModels(graph, { ...arenaOf(blueprint), start: { x: 1450, y: 600, heading: 0 }, props: [] }, undefined);
    warmControls(models);
    const wired = (models.electrical as Model).wired;
    expect([...wired.keys()].sort()).toEqual(['closed,1,1', 'open,1,1']);
    // Drive into the wall: the bumper switch opens, and no new wiring search runs inside a tick.
    let state = startState(models);
    let opened = false;
    for (let tick = 0; tick <= 600 && !opened; tick += 1) {
      const solved = solveTick(models, state, tick);
      state = { ...solved.state, live: liveOf(models, solved.readouts, state.live, eventsOf(models, tick, solved.readouts, state.live)) };
      opened = state.contact['bumper/contacts'] === false;
    }
    expect(opened).toBe(true);
    // The next tick solves with the bumper switch open.
    expect(solveTick(models, state, state.tick + 1).state.contact).toEqual({ 'bumper/contacts': false });
    expect([...wired.keys()].sort()).toEqual(['closed,1,1', 'open,1,1']);
  });
});

describe('dispose', () => {
  it('frees the Run: nothing can be done with it afterwards', async () => {
    const simulation: Simulation = await make(fixture('led-circuit'));
    simulation.dispose();
    expect(() => simulation.step()).toThrow(/disposed/);
    expect(() => simulation.input({ partId: 'switch', kind: 'switch', closed: false })).toThrow(/disposed/);
    expect(() => simulation.snapshot()).toThrow(/disposed/);
    expect(() => simulation.record(CONTEXT)).toThrow(/disposed/);
    expect(simulation.tick).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The recorder.

/** A Run of `blueprint` for `ticks`, with each manual switch flipped at 10 and back at 20, recorded with `extra`. */
const recordOf = async (blueprint: Blueprint, ticks: number, extra: Partial<RunRecordContext> = {}): Promise<RunRecord> => {
  const simulation = await make(blueprint);
  stepTo(simulation, ticks, flips(blueprint));
  const record = simulation.record({ ...CONTEXT, ...extra });
  simulation.dispose();
  return record;
};

/** The record as the store would keep it: JSON, read back. */
const stored = (record: RunRecord): unknown => JSON.parse(JSON.stringify(record));

describe('record', () => {
  it.each(validBlueprints.map((entry) => entry.name))('records a Run of %s that validates', async (name) => {
    const record = await recordOf(fixture(name), 30);
    const result = validateRunRecord(stored(record), catalogue);
    expect(result.ok ? [] : result.issues).toEqual([]);
    expect(record.ticks).toBe(30);
    expect(record.tickRate).toBe(30);
    expect(record.seed).toBe(7);
    expect(record.blueprintId).toBe(fixture(name).meta.id);
    expect(record.events?.[0]?.tick).toBe(0);
    expect(record.events?.at(-1)?.tick).toBeLessThanOrEqual(30);
  });

  it('takes the identity, wall-clock times, run number, profile, challenge, goal and hints from the app, as given', async () => {
    const hints = [{ at: '2026-10-01T08:59:00.000Z', step: 'pulse-part' as const, trigger: 'asked' as const, partId: 'motor-right' }];
    const record = await recordOf(fixture('reversed-motor'), 30, {
      runNumber: 3,
      profile: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      challenge: 'one-motor-backwards',
      goal: { met: false },
      hints,
    });
    expect(record).toMatchObject({
      version: 1,
      id: CONTEXT.id,
      startedAt: CONTEXT.startedAt,
      endedAt: CONTEXT.endedAt,
      runNumber: 3,
      profile: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      challenge: 'one-motor-backwards',
      goal: { met: false },
      hints,
    });
    expect(record.faults).toEqual([{ partId: 'motor-right', failure: 'reversed', firstTick: 0 }]);
    // validateRunRecord checks the challenge only as an id, so the record still validates.
    const result = validateRunRecord(stored(record), catalogue);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('records a summary without events when asked, and keeps every event otherwise', async () => {
    const simulation = await make(fixture('rolling-start'));
    stepTo(simulation, 30);
    const summary = simulation.record({ ...CONTEXT, events: 'drop' });
    expect('events' in summary).toBe(false);
    const full = simulation.record({ ...CONTEXT, events: 'keep' });
    expect(full.events?.length).toBeGreaterThan(30);
    expect(simulation.record(CONTEXT)).toEqual(full);
    simulation.dispose();
  });

  it('records the ticks so far, and leaves the Run’s own logs alone', async () => {
    const simulation = await make(fixture('switch-across-pack'));
    stepTo(simulation, 10);
    const early = simulation.record(CONTEXT);
    (early.events as unknown[]).length = 0;
    stepTo(simulation, 20);
    const later = simulation.record(CONTEXT);
    expect(early.ticks).toBe(10);
    expect(later.ticks).toBe(20);
    expect(later.events?.[0]?.tick).toBe(0);
    expect(Object.isFrozen(later.events?.[0])).toBe(true);
    simulation.dispose();
  });

  it('is the same bytes on every Run of the same blueprint, seed and inputs', async () => {
    const blueprint = fixture('bumper-robot');
    const first = canonicalJson(await recordOf(blueprint, 45));
    const second = canonicalJson(await recordOf(blueprint, 45));
    expect(second).toBe(first);
  });
});

/** The reversed-motor build with its right motor's wires swapped back: the rolling-start robot, under the reversed one's id. */
const mended = (): Blueprint => {
  const broken = fixture('reversed-motor');
  const working = fixture('rolling-start');
  return unwrap(validateBlueprint({ ...working, meta: broken.meta }, catalogue));
};

describe('fixed (D31)', () => {
  it('lists each fault of the previous Run this Run did not show, with the changes that touch its part', async () => {
    const previous = await recordOf(fixture('reversed-motor'), 30);
    expect(previous.faults).toEqual([{ partId: 'motor-right', failure: 'reversed', firstTick: 0 }]);
    const simulation = await make(mended());
    stepTo(simulation, 30);
    const record = simulation.record({ ...CONTEXT, runNumber: 2, previous });
    simulation.dispose();
    expect(record.faults).toEqual([]);
    const changes = buildChanges(previous.blueprint, record.blueprint);
    expect(changes.length).toBeGreaterThan(0);
    expect(record.fixed).toEqual([{ partId: 'motor-right', failure: 'reversed', changes: changes.filter((change) => 'from' in change && (change.from.part === 'motor-right' || change.to.part === 'motor-right')) }]);
    expect(record.fixed[0]?.changes.map((change) => change.kind).sort()).toEqual(['add-wire', 'add-wire', 'remove-wire', 'remove-wire']);
    const result = validateRunRecord(stored(record), catalogue);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('lists nothing for a fault this Run shows again, or with no previous Run', async () => {
    const previous = await recordOf(fixture('reversed-motor'), 10);
    const simulation = await make(fixture('reversed-motor'));
    stepTo(simulation, 10);
    expect(simulation.record({ ...CONTEXT, previous }).fixed).toEqual([]);
    expect(simulation.record(CONTEXT).fixed).toEqual([]);
    simulation.dispose();
  });

  it('lists a fault that went with no change touching its part with no changes, in the previous record’s order', async () => {
    const run = await recordOf(fixture('led-circuit'), 5);
    const previous: RunRecord = {
      ...run,
      faults: [
        { partId: 'switch', failure: 'across-the-pack', firstTick: 2 },
        { partId: 'battery', failure: 'short-circuit', firstTick: 2 },
      ],
    };
    const blueprint: Blueprint = { ...run.blueprint, parts: run.blueprint.parts.map((part) => (part.id === 'led' ? { ...part, settings: { colour: 'green' } } : part)) };
    expect(fixedFaults(previous, [], blueprint)).toEqual([
      { partId: 'switch', failure: 'across-the-pack', changes: [] },
      { partId: 'battery', failure: 'short-circuit', changes: [] },
    ]);
    expect(fixedFaults(previous, [{ partId: 'battery', failure: 'short-circuit', firstTick: 0 }], blueprint)).toEqual([{ partId: 'switch', failure: 'across-the-pack', changes: [] }]);
  });
});

describe('buildChanges', () => {
  const base = fixture('rolling-start');
  const changed = (edit: (blueprint: Blueprint) => Blueprint): BuildChange[] => buildChanges(base, edit(base));

  it('finds nothing between a blueprint and itself, however its lists are ordered', () => {
    expect(buildChanges(base, base)).toEqual([]);
    expect(changed((blueprint) => ({ ...blueprint, parts: [...blueprint.parts].reverse(), wires: [...blueprint.wires].reverse() }))).toEqual([]);
    // A power wire written the other way round joins the same two ports.
    expect(changed((blueprint) => ({ ...blueprint, wires: blueprint.wires.map((wire) => (wire.id === 'w8' ? { ...wire, from: wire.to, to: wire.from } : wire)) }))).toEqual([]);
  });

  it('lists parts added and removed, wires added and removed, then settings, in that order', () => {
    const changes = changed((blueprint) => ({
      ...blueprint,
      parts: [
        ...blueprint.parts.filter((part) => part.id !== 'caster').map((part) => (part.id === 'motor-left' ? { ...part, settings: { direction: 'backward' } } : part)),
        { id: 'led', part: 'led', position: { x: 0, y: 200 }, rotation: 0, settings: {} },
      ],
      wires: [...blueprint.wires.filter((wire) => wire.id !== 'w5'), { id: 'w13', from: { part: 'battery', port: 'plus' }, to: { part: 'led', port: 'plus' } }],
    }));
    expect(changes).toEqual([
      { kind: 'add-part', partId: 'led', part: 'led' },
      { kind: 'remove-part', partId: 'caster', part: 'caster' },
      { kind: 'add-wire', from: { part: 'battery', port: 'plus' }, to: { part: 'led', port: 'plus' } },
      { kind: 'remove-wire', from: { part: 'caster', port: 'mount' }, to: { part: 'chassis', port: 'caster' } },
      { kind: 'change-setting', partId: 'motor-left', setting: 'direction', value: 'backward' },
    ]);
  });

  it('writes a setting that went back to its default with no value, and a part whose type changed as removed and added', () => {
    const before: Blueprint = { ...base, parts: base.parts.map((part) => (part.id === 'motor-left' ? { ...part, settings: { direction: 'backward' } } : part)) };
    expect(buildChanges(before, base)).toEqual([{ kind: 'change-setting', partId: 'motor-left', setting: 'direction' }]);
    const retyped: Blueprint = { ...base, parts: base.parts.map((part) => (part.id === 'battery' ? { ...part, part: 'battery-pack-1-cell' } : part)) };
    expect(buildChanges(base, retyped)).toEqual([
      { kind: 'add-part', partId: 'battery', part: 'battery-pack-1-cell' },
      { kind: 'remove-part', partId: 'battery', part: 'battery-pack-2-cell' },
    ]);
  });
});

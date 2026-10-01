// The program slot (task 1.6) against the schema's example parts and blueprints only. The v1 no-op brain (D41)
// runs with the graph and the behaviour runtime without error and with no effect, on power and off it; the slot
// runs a brain from its onVolts, starts it again when power returns and reads its inputs a tick late; and the
// block-rule runtime carries Level 3 rules through the same step, so the loop never changes for them.
// The electrical solver (task 1.2) is not on this branch, so each tick's volts are written by hand, per net.
import { describe, expect, it } from 'vitest';
import { canonicalJson, makeCatalogue, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type { Blueprint, PartRecord, PortRef, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { behaviourModel, behaviourTick, startBehaviour } from '../src/behaviour/index.ts';
import type { BehaviourTick, DriverOutput, PartBehaviour, PartPower, PositionOutput, PowerReading, ProgramOutput } from '../src/behaviour/index.ts';
import { buildGraph } from '../src/graph/index.ts';
import type { SimGraph } from '../src/graph/index.ts';
import type { BrainTick, ProgramRuntime, ProgramState } from '../src/interface.ts';
import { NO_OP_BRAIN, blockRuleRuntime, programModel, programTick, routeSignals, startProgram } from '../src/program/index.ts';
import type { BlockProgram, ProgramSlotState, ProgramTick, SignalLevels } from '../src/program/index.ts';

// ---------------------------------------------------------------------------------------------
// Helpers: the example catalogue, bench builds, hand-written volts per net, and a loop that runs the program slot
// and the behaviour runtime together as the tick loop (task 1.5) will: power → program → behaviour.

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const examples: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
const arenas = exampleArenas.map((arena) => unwrap(validateArenaPreset(arena)));

const record = (id: string): PartRecord => {
  const found = examples.find((part) => part.id === id);
  if (!found) throw new Error(`No example part '${id}'.`);
  return found;
};

// The microcontroller under another id and name: the slot must treat it exactly as the microcontroller (ground rule 1).
const renamed = unwrap(
  validatePartRecord({ ...record('microcontroller'), id: 'renamed-board', identity: { ...record('microcontroller').identity, name: 'control board', art: 'part/renamed-board' } }),
);

const catalogue = makeCatalogue({ parts: [...examples, renamed], arenas });

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name)?.data;
  if (!found) throw new Error(`No valid blueprint fixture '${name}'.`);
  return found as Blueprint;
};

const ref = (end: string): PortRef => {
  const [part = '', port = ''] = end.split('.');
  return { part, port };
};

type Placed = readonly [id: string, type: string];

/** A bench build: parts in a row, unmounted, and wires as ['part.port', 'part.port'], numbered w1, w2… in order. */
const bench = (placed: readonly Placed[], wires: readonly (readonly [string, string])[]): Blueprint => {
  const base = fixture('motor-off-pin');
  return unwrap(
    validateBlueprint(
      {
        ...base,
        parts: placed.map(([id, type], index) => ({ id, part: type, position: { x: index * 100, y: 0 }, rotation: 0, settings: {} })),
        wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
        meta: { ...base.meta, highWater: { parts: 0, wires: wires.length } },
      },
      catalogue,
    ),
  );
};

const PACKS: readonly (readonly [string, string])[] = [['pack-a.plus', 'pack-b.minus']];
const BRAIN_POWER: readonly (readonly [string, string])[] = [
  ['pack-b.plus', 'brain.plus'],
  ['pack-a.minus', 'brain.minus'],
];
const OTHERS_POWER: readonly (readonly [string, string])[] = [
  ['pack-b.plus', 'servo.plus'],
  ['pack-a.minus', 'servo.minus'],
  ['pack-b.plus', 'driver.plus'],
  ['pack-a.minus', 'driver.minus'],
  ['driver.a-plus', 'motor.plus'],
  ['driver.a-minus', 'motor.minus'],
];
const SIGNALS: readonly (readonly [string, string])[] = [
  ['brain.out-1', 'servo.signal'],
  ['brain.out-2', 'driver.in-a'],
  ['brain.out-2', 'brain.in-1'],
];

/**
 * Two 2-cell packs in series (6 V), a microcontroller, a servo motor on its out 1, and a motor driver whose channel
 * a takes its out 2 and runs a DC motor. Out 2 also comes back to the brain's own in 1. Wires w1–w9 are power,
 * w10–w12 the signal lines in SIGNALS' order. `signals: false` leaves the signal lines out; `brain: false` leaves
 * the microcontroller and its wires out.
 */
const brainBench = (options: { readonly type?: string; readonly signals?: boolean; readonly brain?: boolean } = {}): Blueprint => {
  const brain = options.brain !== false;
  const parts: Placed[] = [
    ['driver', 'motor-driver'],
    ['motor', 'dc-motor'],
    ['pack-a', 'battery-pack-2-cell'],
    ['pack-b', 'battery-pack-2-cell'],
    ['servo', 'servo-motor'],
  ];
  return bench(brain ? [['brain', options.type ?? 'microcontroller'], ...parts] : parts, [
    ...PACKS,
    ...(brain ? BRAIN_POWER : []),
    ...OTHERS_POWER,
    ...(brain && options.signals !== false ? SIGNALS : []),
  ]);
};

/** The bench's volts: the series packs give `volts` (5.6 V is 6 V sagging under load) and the driver passes channel a on. */
const benchVolts = (volts: number): Readonly<Record<string, number>> => ({ 'pack-a.plus': volts / 2, 'pack-b.plus': volts, 'driver.a-plus': volts - 0.3 });

/**
 * Each power port's net volts, by hand: every port in the net of a named port reads its volts, and the rest 0 V.
 * Currents are left at 0: the slot reads none, and the comparisons below never depend on them.
 */
const powerOf = (graph: SimGraph, volts: Readonly<Record<string, number>>): ReadonlyMap<string, PartPower> => {
  const byNet = new Map<number, number>();
  for (const [end, value] of Object.entries(volts)) {
    const { part, port } = ref(end);
    const net = graph.parts.get(part)?.ports.get(port)?.net;
    if (net !== undefined) byNet.set(net, value);
  }
  const power = new Map<string, PartPower>();
  for (const part of graph.parts.values()) {
    const ports = new Map<string, PowerReading>();
    for (const [id, port] of part.ports) if (port.net !== undefined) ports.set(id, { volts: byNet.get(port.net) ?? 0, milliamps: 0 });
    power.set(part.id, { ports });
  }
  return power;
};

interface Frame {
  readonly program: ProgramTick;
  readonly behaviour: BehaviourTick;
}

interface Loop {
  /** The Run's program; left out, the no-op brain runs. */
  readonly runtime?: ProgramRuntime;
  /** False runs no program step, so the behaviour runtime gets no signals at all. */
  readonly slot?: boolean;
  /** What a Level 3 sensor would have sampled at the end of the previous tick. */
  readonly samples?: (tick: number) => SignalLevels;
}

/** Ticks 0 to `last` of the program slot and the behaviour runtime together, with `volts(tick)` per net. Tick 0 passes no time. */
const runTogether = (blueprint: Blueprint, volts: (tick: number) => Readonly<Record<string, number>>, last: number, loop: Loop = {}): Frame[] => {
  const graph = buildGraph(blueprint, catalogue);
  const behaviour = behaviourModel(graph);
  const program = programModel(graph, loop.runtime);
  let slot = startProgram(program);
  let arms = startBehaviour(behaviour);
  const frames: Frame[] = [];
  for (let tick = 0; tick <= last; tick += 1) {
    const power = powerOf(graph, volts(tick));
    const samples = loop.samples?.(tick);
    const brains = programTick(program, slot, { tick, power, ...(samples ? { samples } : {}) });
    const parts = behaviourTick(behaviour, arms, { power, ...(loop.slot === false ? {} : { signals: brains.signals }), ...(tick === 0 ? { seconds: 0 } : {}) });
    frames.push({ program: brains, behaviour: parts });
    slot = brains.state;
    arms = parts.state;
  }
  return frames;
};

const partOf = (tick: BehaviourTick, id: string): PartBehaviour => {
  const found = tick.parts.get(id);
  if (!found) throw new Error(`No part '${id}' in the tick.`);
  return found;
};

const armOf = (part: PartBehaviour): PositionOutput => part.primitives.find((output): output is PositionOutput => output.kind === 'actuator' && output.mode === 'position') as PositionOutput;
const brainOf = (part: PartBehaviour): ProgramOutput => part.primitives.find((output): output is ProgramOutput => output.kind === 'program') as ProgramOutput;
const channelOf = (part: PartBehaviour, primitive: string): DriverOutput =>
  part.primitives.find((output): output is DriverOutput => output.kind === 'driver' && output.primitive === primitive) as DriverOutput;

/** Map-free pictures of a tick, for comparing ticks as text. */
const behaviourText = (tick: BehaviourTick): string => JSON.stringify({ parts: [...tick.parts], drives: [...tick.drives], state: tick.state });
const programText = (tick: ProgramTick): string => JSON.stringify({ brains: tick.brains, signals: [...tick.signals], lines: [...tick.lines], state: tick.state });

/** A stand-in for a Level 3 program: counts the ticks it runs in its state, drives what `drive` gives, and records each call. */
const counting = (drive: (tick: BrainTick) => Readonly<Record<string, number>> = () => ({})) => {
  const calls: { readonly tick: number; readonly partId: string; readonly inputs: Readonly<Record<string, number>>; readonly state: ProgramState }[] = [];
  const runtime: ProgramRuntime = {
    start: () => 0,
    run: (tick, state) => {
      calls.push({ tick: tick.tick, partId: tick.partId, inputs: tick.inputs, state });
      return { outputs: drive(tick), state: (typeof state === 'number' ? state : 0) + 1 };
    },
  };
  return { runtime, calls };
};

const brainOutOf = (frame: Frame) => frame.program.brains[0];

// ---------------------------------------------------------------------------------------------

describe('the program slot’s model', () => {
  it('makes one brain per program primitive, in part id order, run by the no-op brain unless the Run passes a program', () => {
    const graph = buildGraph(fixture('motor-off-pin'), catalogue);
    const model = programModel(graph);
    expect(model.runtime).toBe(NO_OP_BRAIN);
    expect(model.brains.map(({ partId, primitive, spec }) => ({ partId, primitive, onVolts: spec.onVolts, inputs: spec.inputs, outputs: spec.outputs }))).toEqual([
      { partId: 'brain', primitive: 'brain', onVolts: 3, inputs: ['in-1', 'in-2'], outputs: ['out-1', 'out-2'] },
    ]);
    const { runtime } = counting();
    expect(programModel(graph, runtime).runtime).toBe(runtime);
    const two = bench([['zeta', 'microcontroller'], ['alpha', 'renamed-board'], ['led', 'led']], []);
    expect(programModel(buildGraph(two, catalogue)).brains.map((brain) => brain.partId)).toEqual(['alpha', 'zeta']);
  });

  it('runs a build with no brain as nothing', () => {
    const model = programModel(buildGraph(fixture('rolling-start'), catalogue));
    expect(model.brains).toEqual([]);
    const tick = programTick(model, startProgram(model), { tick: 0 });
    expect(programText(tick)).toBe(JSON.stringify({ brains: [], signals: [], lines: [], state: { programs: [], driven: [] } }));
  });
});

describe('the no-op brain (D41)', () => {
  it('starts at null, drives nothing and keeps its state', () => {
    const brain = { partId: 'brain', primitive: 'brain' };
    expect(NO_OP_BRAIN.start(brain)).toBeNull();
    expect(NO_OP_BRAIN.run({ ...brain, tick: 7, inputs: { 'in-1': 0.4 } }, null)).toEqual({ outputs: {}, state: null });
    expect(NO_OP_BRAIN.run({ ...brain, tick: 8, inputs: {} }, { kept: [1, 'two'] })).toEqual({ outputs: {}, state: { kept: [1, 'two'] } });
    expect(Object.isFrozen(NO_OP_BRAIN)).toBe(true);
  });
});

describe('the motor-off-pin fixture: a microcontroller with a servo motor on its out 1', () => {
  const blueprint = fixture('motor-off-pin');
  // One net joins the battery's plus, the brain's plus and the servo's plus; the 3V pin's net feeds the DC motor.
  const on = (): Readonly<Record<string, number>> => ({ 'battery.plus': 5, 'brain.pin-3v': 3.3 });

  it('runs without error and with no effect, the brain on: its outputs carry no signal, so the servo motor holds and hums', () => {
    const frames = runTogether(blueprint, on, 60);
    for (const { program, behaviour } of frames) {
      expect(program.brains).toEqual([{ partId: 'brain', primitive: 'brain', on: true, inputs: {}, outputs: {} }]);
      expect(program.signals.size).toBe(0);
      expect(program.lines.size).toBe(0);
      expect(program.state).toEqual({ programs: [null], driven: [{}] });
      expect(brainOf(partOf(behaviour, 'brain'))).toMatchObject({ working: true });
      expect(partOf(behaviour, 'brain').effects).toEqual([]);
      const servo = partOf(behaviour, 'servo');
      expect(armOf(servo)).toMatchObject({ state: 'holding', angle: 90 });
      expect(servo.effects).toEqual(['hold', 'hum']);
      expect(servo.faults).toEqual(['no-signal']);
    }
  });

  it('changes nothing: every tick is the same with the program step as without it, and as with no signal line at all', () => {
    const unwired = { ...blueprint, wires: blueprint.wires.filter((wire) => wire.id !== 'w7') };
    for (const volts of [on, () => ({ 'battery.plus': 2.9, 'brain.pin-3v': 2.7 })]) {
      const withSlot = runTogether(blueprint, volts, 30).map((frame) => behaviourText(frame.behaviour));
      expect(runTogether(blueprint, volts, 30, { slot: false }).map((frame) => behaviourText(frame.behaviour))).toEqual(withSlot);
      expect(runTogether(unwired, volts, 30).map((frame) => behaviourText(frame.behaviour))).toEqual(withSlot);
    }
  });

  it('keeps the brain off below its onVolts: its program never runs, it drives nothing, and the servo motor stays still', () => {
    const { runtime, calls } = counting(() => ({ 'out-1': 1 }));
    for (const volts of [2.9, 0]) {
      const frames = runTogether(blueprint, () => ({ 'battery.plus': volts }), 10, { runtime });
      for (const { program, behaviour } of frames) {
        expect(program.brains).toEqual([{ partId: 'brain', primitive: 'brain', on: false, inputs: {}, outputs: {} }]);
        expect(program.signals.size).toBe(0);
        expect(program.state).toEqual({ programs: [0], driven: [{}] });
        expect(partOf(behaviour, 'brain').effects).toEqual(['off']);
        expect(armOf(partOf(behaviour, 'servo'))).toMatchObject({ state: 'idle', angle: 90 });
        expect(partOf(behaviour, 'servo').faults).toEqual([]);
      }
    }
    expect(calls).toEqual([]);
  });
});

describe('a brain on the bench, powered and unpowered', () => {
  it('runs without error and with no effect: the parts it is wired to behave as they do with no brain in the build', () => {
    const volts = () => benchVolts(5.6);
    const frames = runTogether(brainBench(), volts, 30);
    const bare = runTogether(brainBench({ brain: false }), volts, 30);
    frames.forEach(({ program, behaviour }, tick) => {
      expect(program.brains).toEqual([{ partId: 'brain', primitive: 'brain', on: true, inputs: {}, outputs: {} }]);
      expect(program.signals.size + program.lines.size).toBe(0);
      expect(partOf(behaviour, 'servo').effects).toEqual(['hold', 'hum']);
      expect(channelOf(partOf(behaviour, 'driver'), 'channel-a').command).toBe(1);
      for (const id of ['driver', 'motor', 'pack-a', 'pack-b', 'servo']) expect(partOf(behaviour, id)).toEqual(partOf((bare[tick] as Frame).behaviour, id));
    });
    expect(runTogether(brainBench({ signals: false }), volts, 30).map((frame) => behaviourText(frame.behaviour))).toEqual(frames.map((frame) => behaviourText(frame.behaviour)));
  });

  it('runs the program from exactly its onVolts, by the behaviour runtime’s rule, and not below them or the wrong way round', () => {
    const graph = buildGraph(brainBench(), catalogue);
    const behaviour = behaviourModel(graph);
    const cases: readonly (readonly [Readonly<Record<string, number>>, boolean])[] = [
      [{ 'pack-b.plus': 0 }, false],
      [{ 'pack-b.plus': 2.9 }, false],
      [{ 'pack-b.plus': 2.999 }, false],
      [{ 'pack-b.plus': 3 }, true],
      [{ 'pack-b.plus': 3.01 }, true],
      [{ 'pack-b.plus': 6 }, true],
      [{ 'pack-b.plus': Number.NaN }, false],
      [{ 'pack-b.plus': Number.POSITIVE_INFINITY }, false],
      [{ 'pack-a.minus': 6 }, false],
    ];
    for (const [volts, expected] of cases) {
      const { runtime, calls } = counting();
      const program = programModel(graph, runtime);
      const power = powerOf(graph, volts);
      const tick = programTick(program, startProgram(program), { tick: 0, power });
      expect(tick.brains[0]?.on).toBe(expected);
      expect(brainOf(partOf(behaviourTick(behaviour, startBehaviour(behaviour), { power }), 'brain')).working).toBe(expected);
      expect(calls.length).toBe(expected ? 1 : 0);
    }
  });

  it('gives the program each tick and the state its last step gave, and starts it again from its start state when power returns', () => {
    const { runtime, calls } = counting(() => ({ 'out-1': 0.5 }));
    const volts = (tick: number) => benchVolts(tick >= 5 && tick <= 7 ? 2.5 : 5.6);
    const frames = runTogether(brainBench(), volts, 10, { runtime });
    expect(calls.map((call) => [call.tick, call.state])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [8, 0],
      [9, 1],
      [10, 2],
    ]);
    expect(frames.map((frame) => brainOutOf(frame)?.on)).toEqual([true, true, true, true, true, false, false, false, true, true, true]);
    expect(frames.map((frame) => frame.program.state.programs)).toEqual([[1], [2], [3], [4], [5], [0], [0], [0], [1], [2], [3]]);
    for (const tick of [5, 6, 7]) {
      const frame = frames[tick] as Frame;
      expect(brainOutOf(frame)?.outputs).toEqual({});
      expect(frame.program.signals.size + frame.program.lines.size).toBe(0);
    }
    const back = frames[8] as Frame;
    expect(brainOutOf(back)?.outputs).toEqual({ 'out-1': 0.5 });
    expect([...back.program.lines]).toEqual([['w10', 0.5]]);
    expect([...back.program.signals]).toEqual([['servo', { signal: 0.5 }]]);
  });

  it('reads its inputs as they were at the end of the previous tick: out 2, wired back to in 1, arrives a tick later', () => {
    const { runtime, calls } = counting((tick) => ({ 'out-2': tick.tick / 10 }));
    const frames = runTogether(brainBench(), () => benchVolts(5.6), 4, {
      runtime,
      // in-2 has no wire on the bench: a level on it stands in for what a Level 3 sensor sampled at the end of the previous tick.
      samples: (tick) => new Map([['brain', { 'in-2': tick / 100 }]]),
    });
    expect(calls.map((call) => call.inputs)).toEqual([
      { 'in-2': 0 },
      { 'in-1': 0, 'in-2': 0.01 },
      { 'in-1': 0.1, 'in-2': 0.02 },
      { 'in-1': 0.2, 'in-2': 0.03 },
      { 'in-1': 0.3, 'in-2': 0.04 },
    ]);
    const last = frames[4] as Frame;
    expect([...last.program.lines]).toEqual([
      ['w11', 0.4],
      ['w12', 0.4],
    ]);
    expect([...last.program.signals]).toEqual([
      ['brain', { 'in-1': 0.4 }],
      ['driver', { 'in-a': 0.4 }],
    ]);
    expect(channelOf(partOf(last.behaviour, 'driver'), 'channel-a').command).toBe(0.4);
  });
});

describe('the block-rule interface: Level 3 plugs in rules as data, through the same loop', () => {
  // "When in 1 reads more than 0.5, set out 1 to 0.25 (the servo motor to 45°)", and "always set out 2 to 0.5" (channel a at half).
  const programs = new Map<string, BlockProgram>([
    [
      'brain',
      {
        rules: [
          { when: { kind: 'reading', input: 'in-2', compare: 'above', level: 0.5 }, then: [{ kind: 'set', output: 'out-1', level: 0.25 }] },
          { when: { kind: 'always' }, then: [{ kind: 'set', output: 'out-2', level: 0.5 }] },
        ],
      },
    ],
  ]);
  // A sensor on in-2: what it sampled at the end of the previous tick is nothing for ticks 0–2, 0.8 for ticks 3–19, then 0.2.
  const sensor = (tick: number): SignalLevels => new Map(tick >= 3 ? [['brain', { 'in-2': tick >= 20 ? 0.2 : 0.8 }]] : []);

  it('sweeps the servo motor to 45° once the reading passes 0.5, and drives the motor driver at half', () => {
    const frames = runTogether(brainBench(), () => benchVolts(5.6), 40, { runtime: blockRuleRuntime(programs), samples: sensor });
    const servo = (tick: number): PartBehaviour => partOf((frames[tick] as Frame).behaviour, 'servo');
    for (const tick of [0, 1, 2]) {
      expect(brainOutOf(frames[tick] as Frame)?.outputs).toEqual({ 'out-2': 0.5 });
      expect(armOf(servo(tick))).toMatchObject({ state: 'holding', angle: 90 });
      expect(servo(tick).faults).toEqual(['no-signal']);
    }
    expect(brainOutOf(frames[3] as Frame)?.outputs).toEqual({ 'out-1': 0.25, 'out-2': 0.5 });
    expect(armOf(servo(3))).toMatchObject({ state: 'sweeping', commanded: 45 });
    expect(servo(3).faults).toEqual([]);
    expect(armOf(servo(19))).toMatchObject({ state: 'settled', angle: 45 });
    expect(channelOf(partOf((frames[19] as Frame).behaviour, 'driver'), 'channel-a').command).toBe(0.5);
    // The reading falls back below 0.5 at tick 20: out 1 keeps its level, as a real pin does, so the servo motor stays at 45°.
    expect(brainOutOf(frames[40] as Frame)?.outputs).toEqual({ 'out-1': 0.25, 'out-2': 0.5 });
    expect(armOf(servo(40))).toMatchObject({ state: 'settled', angle: 45 });
    expect((frames[40] as Frame).program.state.programs).toEqual([{ levels: { 'out-1': 0.25, 'out-2': 0.5 } }]);
  });

  it('runs rules in order, so a later action on the same output wins; a reading on an input with no signal holds neither way', () => {
    const runtime = blockRuleRuntime(
      new Map<string, BlockProgram>([
        [
          'brain',
          {
            rules: [
              { when: { kind: 'always' }, then: [{ kind: 'set', output: 'out-1', level: 0.2 }, { kind: 'set', output: 'out-1', level: 0.7 }] },
              { when: { kind: 'reading', input: 'in-1', compare: 'below', level: 0.5 }, then: [{ kind: 'set', output: 'out-2', level: 1 }] },
              { when: { kind: 'reading', input: 'in-2', compare: 'below', level: 0.5 }, then: [{ kind: 'set', output: 'out-2', level: 0 }] },
              { when: { kind: 'reading', input: 'in-2', compare: 'above', level: 0.5 }, then: [{ kind: 'set', output: 'out-2', level: 0 }] },
            ],
          },
        ],
      ]),
    );
    const brain = { partId: 'brain', primitive: 'brain' };
    const state = runtime.start(brain);
    expect(state).toEqual({ levels: {} });
    expect(runtime.run({ ...brain, tick: 0, inputs: { 'in-1': 0.3 } }, state)).toEqual({ outputs: { 'out-1': 0.7, 'out-2': 1 }, state: { levels: { 'out-1': 0.7, 'out-2': 1 } } });
    expect(runtime.run({ ...brain, tick: 0, inputs: { 'in-1': 0.5 } }, state).outputs).toEqual({ 'out-1': 0.7 });
    // Levels held from earlier ticks stay until an action sets them again.
    expect(runtime.run({ ...brain, tick: 1, inputs: {} }, { levels: { 'out-2': 0.4 } }).outputs).toEqual({ 'out-1': 0.7, 'out-2': 0.4 });
  });

  it('drives nothing for a brain with no program, like the no-op brain, and nothing on what it cannot read', () => {
    const blueprint = fixture('motor-off-pin');
    const volts = () => ({ 'battery.plus': 5 });
    const empty = runTogether(blueprint, volts, 10, { runtime: blockRuleRuntime(new Map()) });
    const noOp = runTogether(blueprint, volts, 10);
    expect(empty.map((frame) => behaviourText(frame.behaviour))).toEqual(noOp.map((frame) => behaviourText(frame.behaviour)));
    expect(empty.every((frame) => frame.program.signals.size === 0)).toBe(true);
    const odd = blockRuleRuntime(
      new Map<string, BlockProgram>([
        [
          'brain',
          {
            rules: [
              { when: { kind: 'always' }, then: [{ kind: 'set', output: 'out-1', level: Number.NaN }] },
              { when: { kind: 'reading', input: 'constructor', compare: 'above', level: -1 }, then: [{ kind: 'set', output: 'out-2', level: 1 }] },
              { when: { kind: 'later' } as never, then: [{ kind: 'set', output: 'out-2', level: 1 }] },
              { when: { kind: 'always' }, then: [{ kind: 'wait', seconds: 1 } as never] },
            ],
          },
        ],
      ]),
    );
    expect(odd.run({ partId: 'brain', primitive: 'brain', tick: 0, inputs: {} }, odd.start({ partId: 'brain', primitive: 'brain' }))).toEqual({ outputs: {}, state: { levels: {} } });
  });

  it('starts again with nothing held when the brain loses power', () => {
    const volts = (tick: number) => benchVolts(tick === 25 ? 2 : 5.6);
    const frames = runTogether(brainBench(), volts, 26, { runtime: blockRuleRuntime(programs), samples: sensor });
    expect((frames[24] as Frame).program.state.programs).toEqual([{ levels: { 'out-1': 0.25, 'out-2': 0.5 } }]);
    expect((frames[25] as Frame).program.state.programs).toEqual([{ levels: {} }]);
    // Back on at tick 26 with the reading at 0.2: only the rule that always holds sets a level.
    expect(brainOutOf(frames[26] as Frame)?.outputs).toEqual({ 'out-2': 0.5 });
    expect(partOf((frames[26] as Frame).behaviour, 'servo').faults).toEqual(['no-signal']);
  });
});

describe('determinism and odd inputs', () => {
  // The sensor on in-2 swings the servo motor from end to end; once it passes 0.5, out 2 starts toggling through the
  // brain's own in 1, a tick late each time.
  const reading = (tick: number): SignalLevels => new Map([['brain', { 'in-2': (tick % 5) / 4 }]]);
  const loop: Loop = {
    runtime: blockRuleRuntime(
      new Map<string, BlockProgram>([
        [
          'brain',
          {
            rules: [
              { when: { kind: 'reading', input: 'in-2', compare: 'above', level: 0.5 }, then: [{ kind: 'set', output: 'out-1', level: 1 }, { kind: 'set', output: 'out-2', level: 0.9 }] },
              { when: { kind: 'reading', input: 'in-2', compare: 'below', level: 0.5 }, then: [{ kind: 'set', output: 'out-1', level: 0 }] },
              { when: { kind: 'reading', input: 'in-1', compare: 'above', level: 0.5 }, then: [{ kind: 'set', output: 'out-2', level: 0.1 }] },
              { when: { kind: 'reading', input: 'in-1', compare: 'below', level: 0.5 }, then: [{ kind: 'set', output: 'out-2', level: 0.9 }] },
            ],
          },
        ],
      ]),
    ),
    samples: reading,
  };

  it('gives the same ticks for the same build, volts and program, and never changes what it is given', () => {
    const twice = [0, 1].map(() => runTogether(brainBench(), () => benchVolts(5.6), 20, loop).map((frame) => programText(frame.program) + behaviourText(frame.behaviour)));
    expect(twice[1]).toEqual(twice[0]);
    expect(new Set(twice[0]).size).toBeGreaterThan(10);
    const graph = buildGraph(brainBench(), catalogue);
    const model = programModel(graph, loop.runtime);
    const state: ProgramSlotState = Object.freeze({ programs: Object.freeze([Object.freeze({ levels: Object.freeze({ 'out-2': 0.9 }) })]), driven: Object.freeze([Object.freeze({ 'out-2': 0.9 })]) });
    const inputs = Object.freeze({ tick: 3, power: powerOf(graph, benchVolts(5.6)) });
    expect(programText(programTick(model, state, inputs))).toBe(programText(programTick(model, state, inputs)));
    expect(state).toEqual({ programs: [{ levels: { 'out-2': 0.9 } }], driven: [{ 'out-2': 0.9 }] });
  });

  it('keeps its state as plain JSON: restored from its canonical bytes, the slot runs on exactly as before', () => {
    const graph = buildGraph(brainBench(), catalogue);
    const model = programModel(graph, loop.runtime);
    const power = powerOf(graph, benchVolts(5.6));
    let state = startProgram(model);
    for (let tick = 0; tick < 7; tick += 1) state = programTick(model, state, { tick, power, samples: reading(tick) }).state;
    expect(state.programs).toEqual([{ levels: { 'out-1': 0, 'out-2': 0.1 } }]);
    const bytes = canonicalJson(state);
    let live = state;
    let restored = JSON.parse(bytes) as ProgramSlotState;
    for (let tick = 7; tick < 14; tick += 1) {
      const a = programTick(model, live, { tick, power, samples: reading(tick) });
      const b = programTick(model, restored, { tick, power, samples: reading(tick) });
      expect(programText(b)).toBe(programText(a));
      expect(canonicalJson(b.state)).toBe(canonicalJson(a.state));
      live = a.state;
      restored = b.state;
    }
  });

  it('reads only the records: a renamed microcontroller gives the same ticks (ground rule 1)', () => {
    const run = (type: string) => runTogether(brainBench({ type }), () => benchVolts(5.6), 12, loop).map((frame) => programText(frame.program));
    expect(run('renamed-board')).toEqual(run('microcontroller'));
  });

  it('never throws on odd inputs: it keeps a runtime’s levels to the primitive’s outputs and to 0–1, and reads NaN as no signal', () => {
    const graph = buildGraph(brainBench(), catalogue);
    const wild: ProgramRuntime = {
      start: () => null,
      run: () => ({ outputs: { 'out-1': 7, 'out-2': -0, 'in-1': 0.5, 'pin-3v': 1, constructor: 1, elsewhere: 0.3 }, state: null }),
    };
    const model = programModel(graph, wild);
    const power = powerOf(graph, benchVolts(5.6));
    const tick = programTick(model, startProgram(model), { tick: 0, power, samples: new Map([['brain', { 'in-2': 7 }]]) });
    expect(tick.brains).toEqual([{ partId: 'brain', primitive: 'brain', on: true, inputs: { 'in-2': 1 }, outputs: { 'out-1': 1, 'out-2': 0 } }]);
    expect(Object.is(tick.brains[0]?.outputs['out-2'], 0)).toBe(true);
    expect(programTick(model, startProgram(model), { tick: 0, power, samples: new Map([['brain', { 'in-2': Number.NaN }]]) }).brains[0]?.inputs).toEqual({});
    const nan = { 'out-1': Number.NaN, 'out-2': Number.POSITIVE_INFINITY };
    const quiet = programModel(graph, { start: () => null, run: () => ({ outputs: nan, state: null }) });
    expect(programTick(quiet, { programs: [], driven: [] }, { tick: 1, power: powerOf(graph, benchVolts(5.6)) }).brains[0]?.outputs).toEqual({});
    expect(programTick(quiet, startProgram(quiet), { tick: 1, power: new Map() }).brains[0]?.on).toBe(false);
  });
});

describe('routeSignals', () => {
  it('carries each signal out to every signal in it feeds: lines in wire id order, signal ins in part id order', () => {
    const graph = buildGraph(brainBench(), catalogue);
    const routed = routeSignals(graph, new Map([['brain', { 'out-2': 0.3, 'out-1': Number.NaN }]]));
    expect([...routed.lines]).toEqual([
      ['w11', 0.3],
      ['w12', 0.3],
    ]);
    expect([...routed.signals]).toEqual([
      ['brain', { 'in-1': 0.3 }],
      ['driver', { 'in-a': 0.3 }],
    ]);
    expect(routeSignals(graph, new Map()).signals.size).toBe(0);
  });
});

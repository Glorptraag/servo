// The behaviour runtime (task 1.3) against the schema's example parts and blueprints only: each primitive kind's
// rule, the needs it judges, the failure modes they make active, and the effects a child sees. The content
// records' own fixtures live in packages/tools/test/behaviour-content.test.ts.
import { describe, expect, it } from 'vitest';
import { EFFECTS, PRIMITIVE_KINDS, makeCatalogue, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type { Blueprint, ControlState, PartRecord, PortRef, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { BEHAVIOUR_EFFECTS, behaviourModel, behaviourTick, effectsOf, startBehaviour } from '../src/behaviour/index.ts';
import type {
  BehaviourInputs,
  BehaviourModel,
  BehaviourState,
  BehaviourTick,
  PartBehaviour,
  PartPower,
  PositionOutput,
  PowerReading,
  PrimitiveOutput,
  SpeedOutput,
} from '../src/behaviour/index.ts';
import { buildGraph } from '../src/graph/index.ts';

// ---------------------------------------------------------------------------------------------
// Helpers: the example catalogue, bench builds, and per-tick inputs written as 'part.port' → value.

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

/** An example record with some of one primitive's parameters changed, under a new id. */
const variant = (id: string, newId: string, primitive: string, change: Readonly<Record<string, unknown>>): PartRecord =>
  unwrap(
    validatePartRecord({
      ...record(id),
      id: newId,
      identity: { ...record(id).identity, art: `part/${newId}` },
      behaviour: record(id).behaviour.map((spec) => (spec.id === primitive ? { ...spec, ...change } : spec)),
    }),
  );

const variants: readonly PartRecord[] = [
  variant('dc-motor', 'blocking-motor', 'motor', { whenReversed: 'blocks' }),
  variant('led', 'two-way-lamp', 'light', { whenReversed: 'works' }),
  // The DC motor under another id and name: the runtime must treat it exactly as the DC motor (ground rule 1).
  unwrap(validatePartRecord({ ...record('dc-motor'), id: 'renamed-motor', identity: { ...record('dc-motor').identity, name: 'motor', art: 'part/renamed-motor' } })),
];

const catalogue = makeCatalogue({ parts: [...examples, ...variants], arenas });

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name)?.data;
  if (!found) throw new Error(`No valid blueprint fixture '${name}'.`);
  return found as Blueprint;
};

const ref = (end: string): PortRef => {
  const [part = '', port = ''] = end.split('.');
  return { part, port };
};

type Placed = readonly [id: string, type: string, settings?: Readonly<Record<string, string | number>>];

/** A bench build: parts in a row, unmounted, and wires as ['part.port', 'part.port'], written source first. */
const bench = (placed: readonly Placed[], wires: readonly (readonly [string, string])[] = []): Blueprint => {
  const base = fixture('led-circuit');
  return unwrap(
    validateBlueprint(
      {
        ...base,
        parts: placed.map(([id, type, settings], index) => ({ id, part: type, position: { x: index * 100, y: 0 }, rotation: 0, settings: settings ?? {} })),
        wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
        meta: { ...base.meta, level: 2, highWater: { parts: 0, wires: wires.length } },
      },
      catalogue,
    ),
  );
};

const modelOf = (blueprint: Blueprint): BehaviourModel => behaviourModel(buildGraph(blueprint, catalogue));

/** Power ports as 'part.port' → volts, and currents as 'part.port' → milliamps into the part. */
const power = (volts: Readonly<Record<string, number>>, milliamps: Readonly<Record<string, number>> = {}): ReadonlyMap<string, PartPower> => {
  const byPart = new Map<string, Map<string, PowerReading>>();
  for (const end of new Set([...Object.keys(volts), ...Object.keys(milliamps)])) {
    const { part, port } = ref(end);
    const ports = byPart.get(part) ?? new Map<string, PowerReading>();
    ports.set(port, { volts: volts[end] ?? 0, milliamps: milliamps[end] ?? 0 });
    byPart.set(part, ports);
  }
  return new Map([...byPart].map(([part, ports]) => [part, { ports }]));
};

/** 'part.key' → value, as per-part records: signal levels by port, or loads by primitive. */
const perPart = (values: Readonly<Record<string, number>>): ReadonlyMap<string, Readonly<Record<string, number>>> => {
  const byPart = new Map<string, Record<string, number>>();
  for (const [end, value] of Object.entries(values)) {
    const { part, port } = ref(end);
    byPart.set(part, { ...byPart.get(part), [port]: value });
  }
  return byPart;
};

interface Scene {
  readonly volts?: Readonly<Record<string, number>>;
  readonly milliamps?: Readonly<Record<string, number>>;
  readonly signals?: Readonly<Record<string, number>>;
  readonly loads?: Readonly<Record<string, number>>;
  readonly controls?: ControlState;
  readonly seconds?: number;
}

const inputsOf = (scene: Scene): BehaviourInputs => ({
  power: power(scene.volts ?? {}, scene.milliamps ?? {}),
  ...(scene.signals ? { signals: perPart(scene.signals) } : {}),
  ...(scene.loads ? { loads: perPart(scene.loads) } : {}),
  ...(scene.controls ? { controls: scene.controls } : {}),
  ...(scene.seconds === undefined ? {} : { seconds: scene.seconds }),
});

/** Runs `ticks` ticks with the same inputs, from `state` or the start, and gives the last tick. */
const run = (model: BehaviourModel, scene: Scene = {}, ticks = 1, state?: BehaviourState): BehaviourTick => {
  const inputs = inputsOf(scene);
  let tick = behaviourTick(model, state ?? startBehaviour(model), inputs);
  for (let step = 1; step < ticks; step += 1) tick = behaviourTick(model, tick.state, inputs);
  return tick;
};

const partOf = (tick: BehaviourTick, id: string): PartBehaviour => {
  const found = tick.parts.get(id);
  if (!found) throw new Error(`No part '${id}' in the tick.`);
  return found;
};

/** One part alone on the bench, run for `ticks` ticks. */
const alone = (type: string, scene: Scene = {}, ticks = 1, settings?: Readonly<Record<string, string | number>>): PartBehaviour =>
  partOf(run(modelOf(bench([[type, type, settings]])), scene, ticks), type);

const speedOf = (part: PartBehaviour): SpeedOutput => part.primitives.find((output): output is SpeedOutput => output.kind === 'actuator' && output.mode === 'speed') as SpeedOutput;
const armOf = (part: PartBehaviour): PositionOutput => part.primitives.find((output): output is PositionOutput => output.kind === 'actuator' && output.mode === 'position') as PositionOutput;

/** The DC motor at `volts` across plus and minus (negative: the wires swapped). */
const motorAt = (volts: number, extra: Omit<Scene, 'volts'> = {}, settings?: Readonly<Record<string, string | number>>, type = 'dc-motor'): PartBehaviour =>
  alone(type, { ...extra, volts: volts >= 0 ? { [`${type}.plus`]: volts } : { [`${type}.minus`]: -volts } }, 1, settings);

const servoAt = (volts: number, extra: Omit<Scene, 'volts'> = {}, ticks = 1, settings?: Readonly<Record<string, string | number>>): PartBehaviour =>
  alone('servo-motor', { ...extra, volts: volts >= 0 ? { 'servo-motor.plus': volts } : { 'servo-motor.minus': -volts } }, ticks, settings);

/** A Map-free picture of a tick, for comparing ticks as text. */
const text = (tick: BehaviourTick): string => JSON.stringify({ parts: [...tick.parts], drives: [...tick.drives], state: tick.state });

// ---------------------------------------------------------------------------------------------

describe('a speed actuator (the DC motor: 200 rpm and 39 N·mm at its rated 6 V, from 1 V)', () => {
  it('turns at no-load rpm at its rated volts, showing nothing wrong', () => {
    const motor = motorAt(6);
    expect(speedOf(motor)).toMatchObject({ state: 'turning', rpm: 200, ratedRpm: 200, reversed: false, capacityNmm: 39, working: true });
    expect(motor.values).toEqual({ rpm: 200 });
    expect(motor.sounds).toEqual([{ sound: 'motor', level: 1 }]);
    expect(motor.effects).toEqual([]);
    expect(motor.faults).toEqual([]);
  });

  it('turns in proportion to its volts: half as fast on a 1-cell pack as on a 2-cell pack, and slow below its rated volts', () => {
    expect(speedOf(motorAt(3)).rpm).toBe(100);
    expect(speedOf(motorAt(1.5)).rpm).toBe(50);
    expect(speedOf(motorAt(1.5)).rpm / speedOf(motorAt(3)).rpm).toBe(0.5);
    expect(motorAt(1.5).effects).toEqual(['slow']);
    expect(motorAt(1.5).sounds).toEqual([{ sound: 'motor', level: 0.25 }]);
  });

  it('slows under load, and stalls and hums once the load reaches the torque it can give at its volts', () => {
    expect(speedOf(motorAt(6, { loads: { 'dc-motor.motor': 19.5 } })).rpm).toBe(100);
    expect(speedOf(motorAt(3, { loads: { 'dc-motor.motor': 19 } })).rpm).toBeCloseTo(2.564, 3);
    const stalled = motorAt(3, { loads: { 'dc-motor.motor': 19.5 } });
    expect(speedOf(stalled)).toMatchObject({ state: 'stalled', rpm: 0, capacityNmm: 19.5, working: true });
    expect(stalled.effects).toEqual(['stall', 'hum']);
    expect(stalled.sounds).toEqual([{ sound: 'hum', level: 0.5 }]);
    expect(stalled.needs).toEqual([{ need: 'load', kind: 'torque', unmet: 'exceeded' }]);
    expect(stalled.faults).toEqual(['overload']);
  });

  it('stalls against a wall, an unbounded load', () => {
    expect(motorAt(6, { loads: { 'dc-motor.motor': Number.POSITIVE_INFINITY } }).faults).toEqual(['overload']);
  });

  it('stays still and silent below its start volts, with no torque need to judge', () => {
    const motor = motorAt(0.9, { loads: { 'dc-motor.motor': 30 } });
    expect(speedOf(motor)).toMatchObject({ state: 'idle', rpm: 0, capacityNmm: 0, working: false });
    expect(motor.effects).toEqual(['still', 'off']);
    expect(motor.sounds).toEqual([]);
    expect(motor.needs).toEqual([{ need: 'load', kind: 'torque' }]);
    expect(motor.faults).toEqual([]);
  });

  it('turns the other way with its wires swapped', () => {
    const motor = motorAt(-6);
    expect(speedOf(motor)).toMatchObject({ state: 'turning', rpm: -200, ratedRpm: 200, reversed: true });
    expect(motor.effects).toEqual(['reverse']);
  });

  it('follows its direction and speed settings: backward is not a fault to show, and a lower speed setting is not slow', () => {
    const backward = motorAt(6, {}, { direction: 'backward' });
    expect(speedOf(backward)).toMatchObject({ rpm: -200, ratedRpm: -200, reversed: false });
    expect(backward.effects).toEqual([]);
    const crossed = motorAt(-6, {}, { direction: 'backward' });
    expect(speedOf(crossed)).toMatchObject({ rpm: 200, reversed: true });
    expect(crossed.effects).toEqual(['reverse']);
    const half = motorAt(6, {}, { speed: 50 });
    expect(speedOf(half)).toMatchObject({ rpm: 100, ratedRpm: 100 });
    expect(half.effects).toEqual([]);
  });

  it('does not turn at all when it blocks reversed volts', () => {
    expect(motorAt(-6, {}, undefined, 'blocking-motor').effects).toEqual(['still', 'off']);
    expect(speedOf(motorAt(6, {}, undefined, 'blocking-motor')).rpm).toBe(200);
  });

  it('reads only the record: the same parameters under another id and name give the same outputs (ground rule 1)', () => {
    for (const [volts, load] of [[6, 0], [1.5, 0], [3, 19.5], [-6, 0], [0.5, 0]] as const) {
      const scene = (type: string): Scene => ({ volts: volts >= 0 ? { [`${type}.plus`]: volts } : { [`${type}.minus`]: -volts }, loads: { [`${type}.motor`]: load } });
      const renamed = alone('renamed-motor', scene('renamed-motor'));
      expect({ ...renamed, id: 'dc-motor' }).toEqual(alone('dc-motor', scene('dc-motor')));
    }
  });
});

describe('a position actuator (the servo motor: 0–180°, rests at 90°, 600°/s and 176 N·mm at its rated 5 V, from 3.5 V)', () => {
  it('with power and no signal, holds where it is and hums: the no-signal failure (D41: the v1 brain drives nothing)', () => {
    const servo = servoAt(5, {}, 3);
    expect(armOf(servo)).toMatchObject({ state: 'holding', angle: 90, sweep: 0, rpm: 0, capacityNmm: 176, working: true });
    expect(servo.values).toEqual({ angle: 90 });
    expect(servo.effects).toEqual(['hold', 'hum']);
    expect(servo.sounds).toEqual([{ sound: 'hum', level: 1 }]);
    expect(servo.needs).toEqual([
      { need: 'signal', kind: 'signal', unmet: 'absent' },
      { need: 'load', kind: 'torque' },
    ]);
    expect(servo.faults).toEqual(['no-signal']);
  });

  it('sweeps to the angle its signal commands at its rated rate, then settles there quietly', () => {
    const first = servoAt(5, { signals: { 'servo-motor.signal': 1 } });
    expect(armOf(first)).toMatchObject({ state: 'sweeping', angle: 110, commanded: 180, sweep: 600, ratedSweep: 600, rpm: 100 });
    expect(first.effects).toEqual([]);
    expect(first.sounds).toEqual([{ sound: 'motor', level: 1 }]);
    expect(first.faults).toEqual([]);
    expect(armOf(servoAt(5, { signals: { 'servo-motor.signal': 1 } }, 5))).toMatchObject({ state: 'sweeping', angle: 180 });
    const settled = servoAt(5, { signals: { 'servo-motor.signal': 1 } }, 6);
    expect(armOf(settled)).toMatchObject({ state: 'settled', angle: 180, sweep: 0, rpm: 0 });
    expect(settled.effects).toEqual([]);
    expect(settled.sounds).toEqual([]);
    expect(armOf(servoAt(5, { signals: { 'servo-motor.signal': 0 } }))).toMatchObject({ angle: 70, commanded: 0, rpm: -100 });
    expect(armOf(servoAt(5, { signals: { 'servo-motor.signal': 0.5 } }))).toMatchObject({ state: 'settled', angle: 90 });
  });

  it('sweeps slowly below its rated volts', () => {
    const low = servoAt(4.75, { signals: { 'servo-motor.signal': 1 } });
    expect(armOf(low)).toMatchObject({ state: 'sweeping', sweep: 570, ratedSweep: 600 });
    expect(low.effects).toEqual(['slow']);
  });

  it('stays still with no power, and then its missing signal is not judged: it cannot hold or hum', () => {
    for (const volts of [0, 3, -5]) {
      const servo = servoAt(volts, {}, 2);
      expect(armOf(servo)).toMatchObject({ state: 'idle', angle: 90, capacityNmm: 0, working: false });
      expect(servo.effects).toEqual(['still', 'off']);
      expect(servo.sounds).toEqual([]);
      expect(servo.faults).toEqual([]);
    }
  });

  it('stalls and hums against a load it cannot push, signal or not', () => {
    const stalled = servoAt(5, { signals: { 'servo-motor.signal': 1 }, loads: { 'servo-motor.servo': 176 } });
    expect(armOf(stalled)).toMatchObject({ state: 'stalled', angle: 90 });
    expect(stalled.effects).toEqual(['stall', 'hum']);
    expect(stalled.faults).toEqual(['overload']);
    expect(servoAt(5, { loads: { 'servo-motor.servo': 176 } }).faults).toEqual(['no-signal', 'overload']);
    expect(armOf(servoAt(5, { signals: { 'servo-motor.signal': 1 }, loads: { 'servo-motor.servo': 88 } }))).toMatchObject({ sweep: 300, ratedSweep: 300 });
  });

  it('moves nothing at tick 0, when no time passes, and carries its angle from tick to tick', () => {
    const model = modelOf(bench([['servo', 'servo-motor']]));
    const scene: Scene = { volts: { 'servo.plus': 5 }, signals: { 'servo.signal': 1 } };
    const zero = run(model, { ...scene, seconds: 0 });
    expect(armOf(partOf(zero, 'servo'))).toMatchObject({ state: 'sweeping', angle: 90, rpm: 0 });
    expect(zero.state).toEqual({ arms: [90] });
    const later = run(model, scene, 1, { arms: [150] });
    expect(armOf(partOf(later, 'servo')).angle).toBe(170);
    expect(later.state).toEqual({ arms: [170] });
  });

  it('on the motor-off-pin build, holds at rest whatever its angle setting, until the brain drives its signal', () => {
    const model = modelOf(fixture('motor-off-pin'));
    expect(model.parts.find((part) => part.id === 'servo')?.primitives[0]).toMatchObject({ kind: 'actuator', target: 45 });
    const idle = partOf(run(model, { volts: { 'servo.plus': 5 } }, 3), 'servo');
    expect(armOf(idle)).toMatchObject({ state: 'holding', angle: 90 });
    expect(idle.effects).toEqual(['hold', 'hum']);
    const driven = partOf(run(model, { volts: { 'servo.plus': 5 }, signals: { 'servo.signal': 0.25 } }, 4), 'servo');
    expect(armOf(driven)).toMatchObject({ state: 'settled', angle: 45 });
  });
});

describe('a load (the LED: on from 1.8 V, full at its rated 3 V; the buzzer: on from 1.5 V, full at 5 V, 2400 Hz)', () => {
  const led = (volts: number, settings?: Readonly<Record<string, string | number>>, type = 'led'): PartBehaviour =>
    alone(type, { volts: volts >= 0 ? { [`${type}.plus`]: volts } : { [`${type}.minus`]: -volts } }, 1, settings);
  const buzzer = (volts: number): PartBehaviour => alone('buzzer', { volts: volts >= 0 ? { 'buzzer.plus': volts } : { 'buzzer.minus': -volts } });

  it('gives light that follows its current: full at its rated volts and above, dim below, dark from its on volts down', () => {
    expect(led(3).values).toEqual({ light: 1 });
    expect(led(3).effects).toEqual([]);
    expect(led(6).values).toEqual({ light: 1 });
    expect(led(2.4).values.light).toBeCloseTo(0.5, 12);
    expect(led(2.4).effects).toEqual(['dim']);
    expect(led(1.9).effects).toEqual(['dim']);
    for (const volts of [1.8, 1, 0]) {
      expect(led(volts).values).toEqual({ light: 0 });
      expect(led(volts).effects).toEqual(['dark', 'off']);
    }
  });

  it('stays dark the wrong way round when it blocks, and lights either way when it works', () => {
    expect(led(-3).effects).toEqual(['dark', 'off']);
    expect(led(-3, undefined, 'two-way-lamp').values).toEqual({ light: 1 });
  });

  it('takes its colour from its setting', () => {
    expect(led(3).primitives[0]).toMatchObject({ kind: 'load', emits: 'light', colour: '#ff3b30' });
    expect(led(3, { colour: 'green' }).primitives[0]).toMatchObject({ colour: '#34c759' });
  });

  it('buzzes at its pitch, quietly below its rated volts, and is silent the wrong way round', () => {
    expect(buzzer(5).sounds).toEqual([{ sound: 'buzz', level: 1, hz: 2400 }]);
    expect(buzzer(5).effects).toEqual([]);
    expect(buzzer(2.9).sounds[0]?.level).toBeCloseTo(0.4, 12);
    expect(buzzer(2.9).effects).toEqual(['quiet']);
    expect(buzzer(-5).sounds).toEqual([]);
    expect(buzzer(-5).effects).toEqual(['silent', 'off']);
    expect(buzzer(1.5).effects).toEqual(['silent', 'off']);
  });
});

describe('a switch and a battery pack', () => {
  it('reports a switch closed or open as the controls set it, at rest when they leave it out', () => {
    expect(alone('switch').values).toEqual({ closed: true });
    expect(alone('switch', { controls: { switches: { 'switch/contacts': false } } }).values).toEqual({ closed: false });
    expect(alone('bumper-switch').values).toEqual({ closed: true });
    expect(alone('bumper-switch', { controls: { switches: { 'bumper-switch/contacts': false } } }).values).toEqual({ closed: false });
  });

  it('shows a switch that carries no current as off, and one in a working loop as nothing wrong', () => {
    expect(alone('switch').effects).toEqual(['off']);
    expect(alone('switch', { milliamps: { 'switch.a': 120, 'switch.b': -120 } }).effects).toEqual([]);
    expect(alone('switch', { milliamps: { 'switch.a': 0.0005 } }).effects).toEqual(['off']);
  });

  it('shows a battery pack that gives no current as off', () => {
    expect(alone('battery-pack-2-cell', { volts: { 'battery-pack-2-cell.plus': 3 } }).effects).toEqual(['off']);
    expect(alone('battery-pack-2-cell', { volts: { 'battery-pack-2-cell.plus': 2.9 }, milliamps: { 'battery-pack-2-cell.plus': -240 } }).effects).toEqual([]);
  });

  it('judges no loop, isolation or power need: those are the electrical solver’s', () => {
    for (const type of ['switch', 'bumper-switch', 'battery-pack-2-cell', 'battery-pack-1-cell', 'motor-driver', 'microcontroller']) expect(alone(type).needs).toEqual([]);
  });
});

describe('a motor driver (two channels, on from 2.5 V) and a microcontroller (a brain from 3 V, a 3.3 V pin)', () => {
  const driver = (volts: number, scene: Omit<Scene, 'volts'> = {}, settings?: Readonly<Record<string, string | number>>): PartBehaviour =>
    alone('motor-driver', { ...scene, volts: { 'motor-driver.plus': volts } }, 1, settings);
  const commands = (part: PartBehaviour): number[] => part.primitives.map((output) => (output.kind === 'driver' ? output.command : Number.NaN));

  it('works from its on volts and is off below them', () => {
    expect(driver(3).effects).toEqual([]);
    expect(driver(2.5).effects).toEqual([]);
    expect(driver(2.4).effects).toEqual(['off']);
    expect(driver(0).effects).toEqual(['off']);
  });

  it('commands each channel from its setting, from the controls, or from a driven signal', () => {
    expect(commands(driver(3))).toEqual([1, 1]);
    expect(commands(driver(3, {}, { 'motor-a': 'stop', 'motor-b': 'backward' }))).toEqual([0, -1]);
    expect(commands(driver(3, { controls: { channels: { 'motor-driver/channel-a': -1, 'motor-driver/channel-b': Number.NaN } } }))).toEqual([-1, 0]);
    expect(commands(driver(3, { signals: { 'motor-driver.in-a': 0.5 } }))).toEqual([0.5, 1]);
  });

  it('runs the brain from its on volts; below them the brain is off and the pin cannot hold its volts', () => {
    const brain = (volts: number): PartBehaviour => alone('microcontroller', { volts: { 'microcontroller.plus': volts } });
    expect(brain(5).primitives.map((output) => [output.kind, 'working' in output && output.working])).toEqual([
      ['program', true],
      ['regulator', true],
    ]);
    expect(brain(5).effects).toEqual([]);
    expect(brain(3.2).effects).toEqual([]);
    expect(brain(2.9).effects).toEqual(['off']);
    expect(brain(0).effects).toEqual(['off']);
  });
});

describe('gearboxes and wheels', () => {
  const bumper = modelOf(fixture('bumper-robot'));
  const motors: Scene = { volts: { 'motor-left.plus': 6, 'motor-right.plus': 6 } };

  it('routes each wheel to the motor that turns it, through the gearbox: a third the speed, 2.4 times the torque', () => {
    const wheel = bumper.parts.find((part) => part.id === 'wheel-left');
    expect(wheel?.routes.get('hub')).toMatchObject({ part: 'motor-left', primitive: 'motor', speed: 1 / 3 });
    expect(wheel?.routes.get('hub')?.torque).toBeCloseTo(2.4, 12);
    expect(bumper.parts.find((part) => part.id === 'motor-left')?.routes.get('shaft')).toEqual({ part: 'motor-left', primitive: 'motor', speed: 1, torque: 1 });
  });

  it('turns the gearbox output and the wheel at the motor’s speed over the ratio, along every drive linkage', () => {
    const tick = run(bumper, motors);
    expect(partOf(tick, 'gear-left').values.rpm).toBeCloseTo(200 / 3, 12);
    expect(partOf(tick, 'wheel-left').values.rpm).toBeCloseTo(200 / 3, 12);
    expect(partOf(tick, 'gear-left').primitives[0]).toMatchObject({ kind: 'ratio', driven: true, fixed: true });
    expect(partOf(tick, 'gear-left').effects).toEqual([]);
    expect(partOf(tick, 'wheel-left').effects).toEqual([]);
    expect([...tick.drives].map(([wire, rpm]) => [wire, Math.round(rpm * 1000) / 1000])).toEqual([
      ['w10', 200],
      ['w11', 66.667],
      ['w12', 200],
      ['w13', 66.667],
    ]);
  });

  it('takes its ratio from its setting', () => {
    const blueprint = fixture('bumper-robot');
    const five = modelOf({ ...blueprint, parts: blueprint.parts.map((part) => (part.id === 'gear-left' ? { ...part, settings: { ratio: 'five-to-one' } } : part)) });
    expect(partOf(run(five, motors), 'wheel-left').values.rpm).toBe(40);
  });

  it('stays still while loose: the housing turns instead, so the wheel on it stays still too', () => {
    const tick = run(modelOf(bench([['motor', 'dc-motor'], ['gearbox', 'gearbox'], ['wheel', 'wheel-large']], [['motor.shaft', 'gearbox.input'], ['gearbox.output', 'wheel.hub']])), { volts: { 'motor.plus': 6 } });
    expect(partOf(tick, 'gearbox').primitives[0]).toMatchObject({ rpm: 0, driven: true, fixed: false });
    expect(partOf(tick, 'gearbox').effects).toEqual(['still']);
    expect(partOf(tick, 'gearbox').faults).toEqual(['loose']);
    expect(partOf(tick, 'wheel').effects).toEqual(['still']);
    expect(partOf(tick, 'wheel').faults).toEqual([]);
    expect(partOf(tick, 'motor').values.rpm).toBe(200);
    expect([...tick.drives]).toEqual([
      ['w1', 200],
      ['w2', 0],
    ]);
  });

  it('stays still with nothing in its input or hub', () => {
    expect(alone('gearbox').faults).toEqual(['not-driven', 'loose']);
    expect(alone('gearbox').effects).toEqual(['still']);
    expect(alone('wheel-large').faults).toEqual(['not-driven']);
    expect(alone('wheel-large').effects).toEqual(['still']);
  });

  it('turns a wheel on a servo motor’s arm as the arm sweeps', () => {
    const tick = run(modelOf(bench([['servo', 'servo-motor'], ['wheel', 'wheel-large']], [['servo.arm', 'wheel.hub']])), { volts: { 'servo.plus': 5 }, signals: { 'servo.signal': 1 } });
    expect(partOf(tick, 'wheel').values.rpm).toBe(100);
    expect([...tick.drives]).toEqual([['w1', 100]]);
  });
});

describe('the rolling-start robot', () => {
  const model = modelOf(fixture('rolling-start'));

  it('has every mount fixed and every hub driven: no fault from the needs this runtime judges', () => {
    const tick = run(model, { volts: { 'motor-left.plus': 2.8, 'motor-right.plus': 2.8 }, milliamps: { 'battery.plus': -300, 'switch.a': 300 } });
    expect([...tick.parts.values()].flatMap((part) => part.faults)).toEqual([]);
    expect(partOf(tick, 'caster').primitives).toEqual([{ kind: 'support', primitive: 'roller', fixed: true }]);
    expect(partOf(tick, 'wheel-left').values.rpm).toBeCloseTo(200 * (2.8 / 6), 12);
  });

  it('shows a loose caster as its mount fault; the drag it causes is the mechanical solver’s', () => {
    const caster = alone('caster');
    expect(caster.needs).toEqual([{ need: 'fixed', kind: 'mount', unmet: 'absent' }]);
    expect(caster.faults).toEqual(['loose']);
    expect(caster.effects).toEqual([]);
  });
});

describe('the runtime as a whole', () => {
  const every = bench(examples.map((part): Placed => [part.id, part.id]));

  it('runs every primitive kind of the closed vocabulary', () => {
    const kinds = new Set([...run(modelOf(every)).parts.values()].flatMap((part) => part.primitives.map((output: PrimitiveOutput) => output.kind)));
    expect([...kinds].sort()).toEqual([...PRIMITIVE_KINDS].sort());
  });

  it('shows only its own effects, in EFFECTS order', () => {
    expect(BEHAVIOUR_EFFECTS.every((effect) => EFFECTS.includes(effect))).toBe(true);
    expect([...BEHAVIOUR_EFFECTS]).toEqual(EFFECTS.filter((effect) => (BEHAVIOUR_EFFECTS as readonly string[]).includes(effect)));
    expect(effectsOf([], [])).toEqual([]);
  });

  it('gives every part, in id order, and starts every arm at rest', () => {
    const model = modelOf(every);
    expect([...run(model).parts.keys()]).toEqual(examples.map((part) => part.id).sort());
    expect(model.arms).toEqual([{ part: 'servo-motor', primitive: 'servo' }]);
    expect(startBehaviour(model)).toEqual({ arms: [90] });
  });

  it('gives the same ticks for the same model, state and inputs, and never changes what it is given', () => {
    const scene: Scene = {
      volts: { 'motor-left.plus': 2.9, 'motor-right.minus': 2.9, 'servo.plus': 5, 'buzzer.plus': 2.9, 'driver.plus': 3 },
      milliamps: { 'battery.plus': -500, 'bumper.a': 500 },
      signals: { 'servo.signal': 0.8 },
      loads: { 'motor-left.motor': 5, 'servo.servo': 20 },
    };
    const first = modelOf(fixture('bumper-robot'));
    const second = modelOf(fixture('bumper-robot'));
    const inputs = inputsOf(scene);
    const state = Object.freeze({ arms: Object.freeze([90]) });
    const once = behaviourTick(first, state, inputs);
    expect(text(behaviourTick(second, state, inputs))).toBe(text(once));
    expect(state).toEqual({ arms: [90] });
    let a = startBehaviour(first);
    let b = startBehaviour(second);
    const seen: string[] = [];
    for (let tick = 0; tick < 12; tick += 1) {
      const x = behaviourTick(first, a, inputs);
      const y = behaviourTick(second, b, inputs);
      expect(text(x)).toBe(text(y));
      seen.push(text(x));
      a = x.state;
      b = y.state;
    }
    expect(new Set(seen).size).toBeGreaterThan(1);
  });

  it('never throws on odd inputs: NaN reads as nothing, and a short or missing state starts at rest', () => {
    const model = modelOf(fixture('bumper-robot'));
    const odd: BehaviourInputs = {
      power: power({ 'motor-left.plus': Number.NaN, 'servo.plus': Number.POSITIVE_INFINITY, 'buzzer.plus': 4 }, { 'battery.plus': Number.NaN }),
      signals: perPart({ 'servo.signal': Number.NaN, 'driver.in-a': 7 }),
      loads: perPart({ 'motor-right.motor': Number.NaN, 'servo.servo': -3 }),
      controls: { switches: { 'bumper/contacts': true }, channels: { 'driver/channel-b': Number.NaN } },
      seconds: Number.NaN,
    };
    const tick = behaviourTick(model, { arms: [] }, odd);
    expect(partOf(tick, 'motor-left').effects).toEqual(['still', 'off']);
    expect(partOf(tick, 'servo').effects).toEqual(['still', 'off']);
    expect(partOf(tick, 'driver').primitives.map((output) => (output.kind === 'driver' ? output.command : undefined))).toEqual([1, 0]);
    expect(tick.state).toEqual({ arms: [90] });
    expect(JSON.stringify(tick.state)).not.toContain('null');
  });
});

// The mechanical solver (task 1.4) against the schema's example parts, blueprints and arenas only. Each Run steps the
// behaviour runtime (task 1.3) and the mechanical solver in the tick loop's order, with an ideal battery standing in for
// the electrical solver (task 1.2): a 2-cell pack at its 2.8 V under load, a motor driver passing it on less its drop.
// Every Run happens twice and must give the same frames and the same state bytes (ground rule 2).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { arenaPoseOf, controlId, cosSin, makeCatalogue, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type { ArenaPreset, Blueprint, ControlState, PartRecord, PlacedPartId, Prop, ValidationResult, Wire } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { behaviourModel, behaviourTick, startBehaviour } from '../src/behaviour/index.ts';
import type { BehaviourTick, PartPower, PowerReading, SpeedOutput } from '../src/behaviour/index.ts';
import { buildGraph, liveAt } from '../src/graph/index.ts';
import type { SimGraph } from '../src/graph/index.ts';
import type { ActuatorState } from '../src/electrical/index.ts';
import {
  atanDegrees,
  driveStep,
  electricalActuators,
  initMechanics,
  loadingOf,
  mechanicalModel,
  mechanicalSnapshot,
  mechanicalTick,
  mechanicsReady,
  modelPrint,
  restoreMechanics,
  stanceOf,
  stancePoints,
  startMechanics,
  TOUCH_MM,
} from '../src/mechanical/index.ts';
import type { MechanicalModel, MechanicalState, MechanicalTick, RobotModel } from '../src/mechanical/index.ts';
import { buildWorld, obstacleBoxes, openWorld, probeTouches } from '../src/mechanical/world.ts';

// Robots driven through the physics world for hundreds of ticks take seconds each on a machine running many agents'
// tests, past Vitest's 5 s default; generous for that.
vi.setConfig({ testTimeout: 120_000 });

// ---------------------------------------------------------------------------------------------
// The example catalogue, three test variants and two test arenas.

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const examples: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));

const record = (id: string): PartRecord => {
  const found = examples.find((part) => part.id === id);
  if (!found) throw new Error(`No example part '${id}'.`);
  return found;
};

/** An example record under a new id, with some of its fields changed. */
const variant = (id: string, newId: string, change: (base: PartRecord) => Partial<PartRecord>): PartRecord =>
  unwrap(validatePartRecord({ ...record(id), id: newId, identity: { ...record(id).identity, art: `part/${newId}` }, ...change(record(id)) }));

const variants: readonly PartRecord[] = [
  // A bumper switch whose probe reaches 25 mm past its body: a whisker that leads the robot.
  variant('bumper-switch', 'whisker-switch', (base) => ({
    behaviour: base.behaviour.map((spec) =>
      spec.kind === 'switch' && spec.actuation.kind === 'contact' ? { ...spec, actuation: { ...spec.actuation, probe: { from: { x: 35, y: -20 }, to: { x: 35, y: 20 } } } } : spec,
    ),
  })),
  // A bumper switch whose probe lies off to one side, 5 to 30 mm to its left: on a mirrored mount it lies to the right.
  variant('bumper-switch', 'offset-bumper', (base) => ({
    behaviour: base.behaviour.map((spec) =>
      spec.kind === 'switch' && spec.actuation.kind === 'contact' ? { ...spec, actuation: { ...spec.actuation, probe: { from: { x: 10, y: 5 }, to: { x: 10, y: 30 } } } } : spec,
    ),
  })),
  // A tall, heavy battery pack (600 g, its centre of mass 250 mm up): the high mass a top-heavy build needs, since no
  // example part is tall or heavy enough. A far stronger DC motor and a far grippier wheel push it over on a fast start.
  variant('battery-pack-2-cell', 'tall-battery-pack', () => ({ body: { grams: 600, size: { x: 40, y: 40, z: 500 }, centreOfMass: { x: 0, y: 0, z: 250 } } })),
  variant('dc-motor', 'strong-motor', (base) => ({ behaviour: base.behaviour.map((spec) => (spec.kind === 'actuator' && spec.mode === 'speed' ? { ...spec, stallTorqueNmm: 400 } : spec)) })),
  variant('wheel-large', 'grippy-wheel', (base) => ({ behaviour: base.behaviour.map((spec) => (spec.kind === 'wheel' ? { ...spec, grip: 3 } : spec)) })),
  // The wheel under another id and name: the solver must treat it exactly as the wheel (ground rule 1).
  variant('wheel-large', 'renamed-wheel', (base) => ({ identity: { ...base.identity, name: 'tyre', art: 'part/renamed-wheel' } })),
  // The content's small wheel (radius 24 mm), which the example parts lack: the same tyre, smaller.
  variant('wheel-large', 'small-wheel', (base) => ({
    body: { grams: 15, size: { x: 48, y: 20, z: 48 }, centreOfMass: { x: 0, y: 0, z: 24 } },
    ports: base.ports.map((port) => (port.id === 'hub' ? { ...port, at: { x: 0, y: -10, z: 24 } } : port)),
    behaviour: base.behaviour.map((spec) => (spec.kind === 'wheel' ? { ...spec, radiusMm: 24, widthMm: 20 } : spec)),
  })),
];

const preset = (data: unknown): ArenaPreset => unwrap(validateArenaPreset(data));

/** The content ramp's shape: a full-width hill whose two slopes meet at a ridge. */
const ridge = preset({
  id: 'ridge',
  name: 'Ridge',
  size: { x: 2000, y: 1200 },
  friction: 0.8,
  start: { x: 300, y: 600, heading: 0 },
  walls: [],
  zones: [],
  lines: [],
  ramps: [
    { id: 'up', from: { x: 600, y: 0 }, to: { x: 880, y: 1200 }, riseMm: 40, uphill: '+x' },
    { id: 'down', from: { x: 880, y: 0 }, to: { x: 1440, y: 1200 }, riseMm: 40, uphill: '-x' },
  ],
  props: [],
});

/** A thin wall, 1 mm thick, for the probe's sweep. */
const thin = preset({
  id: 'thin',
  name: 'Thin wall',
  size: { x: 2000, y: 1200 },
  friction: 0.8,
  start: { x: 300, y: 600, heading: 0 },
  walls: [{ id: 'sheet', from: { x: 1000, y: 100 }, to: { x: 1000, y: 1100 }, thicknessMm: 1 }],
  zones: [],
  lines: [],
  ramps: [],
  props: [],
});

/** The example wall-stop arena with the robot starting 250 mm from the far wall's face (at x = 1780), and no box. */
const nearWall = preset({ ...(exampleArenas.find((each) => (each as ArenaPreset).id === 'wall-stop') as ArenaPreset), id: 'near-wall', start: { x: 1450, y: 600, heading: 0 }, props: [] });

const arenas: readonly ArenaPreset[] = [...exampleArenas.map(preset), ridge, thin, nearWall];
const catalogue = makeCatalogue({ parts: [...examples, ...variants], arenas });

const arena = (id: string): ArenaPreset => {
  const found = arenas.find((each) => each.id === id);
  if (!found) throw new Error(`No arena '${id}'.`);
  return found;
};

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name)?.data;
  if (!found) throw new Error(`No valid blueprint fixture '${name}'.`);
  return found as Blueprint;
};

interface Edit {
  readonly removeWires?: readonly string[];
  readonly removeParts?: readonly string[];
  readonly addParts?: Blueprint['parts'];
  readonly wires?: (wires: readonly Wire[]) => readonly Wire[];
  readonly retype?: Readonly<Record<string, string>>;
  readonly move?: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly preset?: string;
  readonly props?: readonly Prop[];
}

/** A fixture with one change, validated. Wire ids `w<n>` it adds raise the blueprint's high-water mark. */
const edited = (name: string, edit: Edit): Blueprint => {
  const base = fixture(name);
  const kept = base.wires.filter((wire) => !(edit.removeWires ?? []).includes(wire.id));
  const wires = edit.wires ? edit.wires(kept) : kept;
  const highest = Math.max(base.meta.highWater.wires, ...wires.map((wire) => Number(/^w(\d+)$/.exec(wire.id)?.[1] ?? 0)));
  return unwrap(
    validateBlueprint(
      {
        ...base,
        parts: [...base.parts.filter((part) => !(edit.removeParts ?? []).includes(part.id)), ...(edit.addParts ?? [])].map((part) => ({
          ...part,
          ...(edit.retype?.[part.id] ? { part: edit.retype[part.id] as string } : {}),
          ...(edit.move?.[part.id] ? { position: edit.move[part.id] as { readonly x: number; readonly y: number } } : {}),
        })),
        wires,
        arena: { preset: edit.preset ?? base.arena.preset, props: edit.props ?? base.arena.props },
        meta: { ...base.meta, highWater: { ...base.meta.highWater, wires: highest } },
      },
      catalogue,
    ),
  );
};

/** The geared bumper robot with its motor driver fed straight from the battery pack: the bumper switch stops nothing. */
const gearedWithoutBumper = (presetId: string): Blueprint =>
  edited('bumper-robot', {
    preset: presetId,
    props: [],
    wires: (wires) => wires.map((wire) => (wire.id === 'w15' ? { ...wire, from: { part: 'battery', port: 'plus' }, to: { part: 'driver', port: 'plus' } } : wire)),
  });

/** The Rolling Start robot with a gearbox between each DC motor and its wheel, the motors moved to the inner mounts. */
const gearedRollingStart = (props: readonly Prop[] = []): Blueprint =>
  edited('rolling-start', {
    props,
    addParts: [
      { id: 'gear-left', part: 'gearbox', position: { x: 40, y: -53 }, rotation: 0, settings: {} },
      { id: 'gear-right', part: 'gearbox', position: { x: 40, y: 53 }, rotation: 0, settings: {} },
    ],
    move: { 'motor-left': { x: 30, y: -29 }, 'motor-right': { x: 30, y: 29 } },
    wires: (wires) => [
      ...wires.map((wire) => {
        if (wire.id === 'w1') return { ...wire, to: { part: 'chassis', port: 'motor-left-inner' } };
        if (wire.id === 'w2') return { ...wire, to: { part: 'chassis', port: 'motor-right-inner' } };
        if (wire.id === 'w6') return { ...wire, to: { part: 'gear-left', port: 'input' } };
        if (wire.id === 'w7') return { ...wire, to: { part: 'gear-right', port: 'input' } };
        return wire;
      }),
      { id: 'w13', from: { part: 'gear-left', port: 'output' }, to: { part: 'wheel-left', port: 'hub' } },
      { id: 'w14', from: { part: 'gear-right', port: 'output' }, to: { part: 'wheel-right', port: 'hub' } },
      { id: 'w15', from: { part: 'gear-left', port: 'mount' }, to: { part: 'chassis', port: 'gear-left' } },
      { id: 'w16', from: { part: 'gear-right', port: 'mount' }, to: { part: 'chassis', port: 'gear-right' } },
    ],
  });

/** A box on the open floor 200 mm ahead of the robot's start, of the given mass. */
const boxAhead = (grams: number): Prop => ({ id: 'box', shape: 'box', size: { x: 60, y: 60, z: 40 }, grams, at: { x: 500, y: 600, heading: 0 }, fixed: false });

// ---------------------------------------------------------------------------------------------
// The tick loop in miniature: an ideal battery, the behaviour runtime, then the mechanical solver.

/** 2.8 V: a 2-cell pack under a DC motor's load. */
const PACK_VOLTS = 2.8;

/**
 * Port volts as an ideal battery gives them: each pack's − node at 0 V and its + node at PACK_VOLTS; each motor-driver
 * channel switched on passes its supply × its command less its drop. Currents are not needed here.
 */
const idealPower = (graph: SimGraph, controls: ControlState): ReadonlyMap<PlacedPartId, PartPower> => {
  const live = liveAt(graph, controls);
  const volts = new Map<number, number>();
  const node = (net: number): number => live.nodes[net] as number;
  for (const source of graph.sources) {
    if (source.spec.kind !== 'source' || node(source.pos) === node(source.neg)) continue;
    volts.set(node(source.neg), volts.get(node(source.neg)) ?? 0);
    volts.set(node(source.pos), (volts.get(node(source.neg)) ?? 0) + PACK_VOLTS);
  }
  graph.sources.forEach((source, index) => {
    if (source.spec.kind !== 'driver' || !live.sources[index] || !source.feeder) return;
    const supply = (volts.get(node(source.feeder.pos)) ?? 0) - (volts.get(node(source.feeder.neg)) ?? 0);
    if (supply < source.spec.onVolts) return;
    const id = controlId(source.part, source.primitive);
    const rest = graph.controls.find((control) => control.id === id)?.rest;
    const command = controls.channels?.[id] ?? (typeof rest === 'number' ? rest : source.spec.command);
    const out = Math.max(0, supply * Math.abs(command) - source.spec.dropVolts) * Math.sign(command);
    volts.set(node(source.neg), volts.get(node(source.neg)) ?? 0);
    volts.set(node(source.pos), (volts.get(node(source.neg)) ?? 0) + out);
  });
  const power = new Map<PlacedPartId, PartPower>();
  for (const part of graph.parts.values()) {
    const ports = new Map<string, PowerReading>();
    for (const [id, port] of part.ports) if (port.net !== undefined) ports.set(id, { volts: volts.get(node(port.net)) ?? 0, milliamps: 0 });
    power.set(part.id, { ports });
  }
  return power;
};

interface Frame {
  readonly tick: number;
  readonly behaviour: BehaviourTick;
  readonly mechanics: MechanicalTick;
}

interface Run {
  readonly model: MechanicalModel;
  readonly frames: readonly Frame[];
  readonly last: Frame;
}

/** A tick's answer as text, Maps and Infinity written out, so two Runs compare exactly. The state's bytes are compared on their own. */
const text = (tick: MechanicalTick): string =>
  JSON.stringify(
    { ...tick, bodies: [...tick.bodies], wheels: [...tick.wheels], actuators: [...tick.actuators], loads: [...tick.loads], parts: [...tick.parts], state: undefined },
    (_, value: unknown) => (value === Number.POSITIVE_INFINITY ? 'Infinity' : value),
  );

/** The child opens a switch: it is open from the tick after `tick` on. */
interface Press {
  readonly control: string;
  readonly tick: number;
}

/** One Run of `ticks` ticks after tick 0, from `start` when given. */
const simulate = (blueprint: Blueprint, presetId: string, ticks: number, start?: { readonly bytes: Uint8Array; readonly from: Frame }, press?: Press): Run => {
  const graph = buildGraph(blueprint, catalogue);
  const bmodel = behaviourModel(graph);
  const model = mechanicalModel(bmodel, arena(presetId));
  let bstate = start ? start.from.behaviour.state : startBehaviour(bmodel);
  let mstate: MechanicalState = start ? restoreMechanics(model, start.bytes) : startMechanics(model);
  let loads: MechanicalTick['loads'] | undefined = start?.from.mechanics.loads;
  let contact: Readonly<Record<string, boolean>> = start?.from.mechanics.switches ?? {};
  const first = start ? start.from.tick + 1 : 0;
  const frames: Frame[] = [];
  for (let tick = first; tick <= first + ticks - (start ? 1 : 0); tick += 1) {
    const controls: ControlState = { switches: { ...contact, ...(press && tick > press.tick ? { [press.control]: false } : {}) } };
    const seconds = tick === 0 ? { seconds: 0 } : {};
    const b = behaviourTick(bmodel, bstate, { power: idealPower(graph, controls), controls, ...(loads ? { loads } : {}), ...seconds });
    bstate = b.state;
    const m = mechanicalTick(model, mstate, { behaviour: b, ...seconds });
    mstate = m.state;
    loads = m.loads;
    contact = m.switches;
    frames.push({ tick, behaviour: b, mechanics: m });
  }
  return { model, frames, last: frames[frames.length - 1] as Frame };
};

/** A Run, done twice: both must give the same frames and end in the same bytes. */
const run = (blueprint: Blueprint, presetId: string, ticks: number, press?: Press): Run => {
  const first = simulate(blueprint, presetId, ticks, undefined, press);
  const second = simulate(blueprint, presetId, ticks, undefined, press);
  expect(second.frames.map((frame) => text(frame.mechanics))).toEqual(first.frames.map((frame) => text(frame.mechanics)));
  expect(mechanicalSnapshot(second.last.mechanics.state)).toEqual(mechanicalSnapshot(first.last.mechanics.state));
  return first;
};

const robotOf = (frame: Frame) => {
  const robot = frame.mechanics.robot;
  if (!robot) throw new Error(`No robot at tick ${frame.tick}.`);
  return robot;
};

const wheelOf = (frame: Frame, id: string) => {
  const wheel = frame.mechanics.wheels.get(id);
  if (!wheel) throw new Error(`No wheel '${id}' at tick ${frame.tick}.`);
  return wheel;
};

const partOf = (frame: Frame, id: string) => {
  const part = frame.mechanics.parts.get(id);
  if (!part) throw new Error(`No part '${id}' at tick ${frame.tick}.`);
  return part;
};

const speedOutput = (frame: Frame, id: string): SpeedOutput =>
  frame.behaviour.parts.get(id)?.primitives.find((output): output is SpeedOutput => output.kind === 'actuator' && output.mode === 'speed') as SpeedOutput;

/** Every fault of the Run, behaviour's and the mechanics', as 'part: failure', each once, sorted. */
const faultsOf = (run: Run): string[] =>
  [
    ...new Set(
      run.frames.flatMap((frame) => [
        ...[...frame.behaviour.parts.values()].flatMap((part) => part.faults.map((fault) => `${part.id}: ${fault}`)),
        ...[...frame.mechanics.parts.values()].flatMap((part) => part.faults.map((fault) => `${part.id}: ${fault}`)),
      ]),
    ),
  ].sort();

/** The free speed of a DC motor's tyre at `volts`: 200 rpm at 6 V on a 32.5 mm wheel, mm/s. */
const freeRim = (volts: number, gear = 1): number => (((200 * volts) / 6 / gear) * 2 * Math.PI * 32.5) / 60;

beforeAll(async () => {
  await initMechanics();
});

// ---------------------------------------------------------------------------------------------

describe('the model', () => {
  it('is the robot of the schema geometry: every part on the chassis, its wheels pushing forward, its centre of mass between wheels and caster', () => {
    const model = mechanicalModel(behaviourModel(buildGraph(fixture('rolling-start'), catalogue)), arena('open-floor'));
    const robot = model.robot as RobotModel;
    expect(robot.root).toBe('chassis');
    expect(robot.parts).toEqual(['battery', 'caster', 'chassis', 'motor-left', 'motor-right', 'switch', 'wheel-left', 'wheel-right']);
    expect(robot.kilograms).toBeCloseTo(0.288, 12);
    expect(robot.centreOfMass.x).toBeGreaterThan(0);
    expect(robot.centreOfMass.x).toBeLessThan(40);
    expect(robot.centreOfMass.y).toBe(0);
    expect(robot.wheels.map((wheel) => [wheel.part, wheel.contact, wheel.roll, wheel.push, wheel.drive?.part])).toEqual([
      ['wheel-left', { x: 40, y: 79, z: -16.5 }, { x: 1, y: 0 }, 1, 'motor-left'],
      ['wheel-right', { x: 40, y: -79, z: -16.5 }, { x: 1, y: 0 }, 1, 'motor-right'],
    ]);
    expect(robot.supports).toEqual([{ part: 'caster', primitive: 'roller', contact: { x: -70, y: 0, z: -16.5 }, rollingFriction: 0.02 }]);
    expect(robot.bottom).toBe(-16.5);
    expect(model.loose).toEqual([]);
    // The floor's four edges are walls; a flat floor has no ledges.
    expect(model.arena.solids.map((solid) => `${solid.kind} ${solid.id}`)).toEqual(['edge east', 'edge north', 'edge south', 'edge west']);
  });

  it('is pure: the same build and arena give the same model, and building it needs no physics engine', () => {
    const make = (): string => JSON.stringify(mechanicalModel(behaviourModel(buildGraph(fixture('bumper-robot'), catalogue)), arena('wall-stop')), (key, value: unknown) =>
      key === 'behaviour' ? undefined : value instanceof Set ? [...value] : value,
    );
    expect(make()).toEqual(make());
  });

  it('reads ramps: a drop past a lone ramp’s high edge or beside it is a ledge (a wall); slopes meeting at a ridge make none', () => {
    const lone = mechanicalModel(behaviourModel(buildGraph(edited('rolling-start', { preset: 'ramp' }), catalogue)), arena('ramp'));
    expect(lone.arena.solids.filter((solid) => solid.kind === 'ledge').map((solid) => solid.id)).toEqual(['slope-east-0', 'slope-north-0', 'slope-south-0']);
    const high = lone.arena.solids.find((solid) => solid.id === 'slope-east-0');
    expect(high?.corners.map((corner) => corner.x).sort((a, b) => a - b)).toEqual([1498, 1498, 1502, 1502]);
    const hill = mechanicalModel(behaviourModel(buildGraph(edited('rolling-start', { preset: 'ridge' }), catalogue)), arena('ridge'));
    expect(hill.arena.solids.filter((solid) => solid.kind === 'ledge')).toEqual([]);
  });

  it('asks for the engine before the first world', () => {
    expect(mechanicsReady()).toBe(true);
  });
});

describe('a two-motor robot drives', () => {
  it('straight: both wheels at one speed, its heading and its line unchanged', () => {
    const { frames, last } = run(fixture('rolling-start'), 'open-floor', 60);
    const start = robotOf(frames[0] as Frame);
    expect(start.pose).toEqual({ x: 300, y: 600, heading: 0, pitch: 0, roll: 0 });
    const end = robotOf(last);
    expect(end.pose.x).toBeGreaterThan(800);
    expect(end.pose.y).toBe(600);
    expect(end.pose.heading).toBe(0);
    expect(end.stance).toBe('upright');
    // At full speed it runs a little under the motors' free speed: the caster's rolling drag is the only load.
    expect(end.forwardMmPerSecond).toBeGreaterThan(0.95 * freeRim(PACK_VOLTS));
    expect(end.forwardMmPerSecond).toBeLessThan(freeRim(PACK_VOLTS));
    expect(end.turnDegPerSecond).toBe(0);
    for (const id of ['wheel-left', 'wheel-right']) {
      const wheel = wheelOf(last, id);
      expect(wheel).toMatchObject({ onFloor: true, slipping: false, slipMmPerSecond: 0 });
      expect(wheel.groundMmPerSecond).toBeCloseTo(end.forwardMmPerSecond, 6);
      expect(wheel.rpm).toBeCloseTo((wheel.groundMmPerSecond * 60) / (2 * Math.PI * 32.5), 9);
    }
    // Tick by tick it only ever gains ground, and its speed rises to its steady speed.
    for (let i = 1; i < frames.length; i += 1) expect(robotOf(frames[i] as Frame).pose.x).toBeGreaterThan(robotOf(frames[i - 1] as Frame).pose.x);
    expect(robotOf(frames[1] as Frame).forwardMmPerSecond).toBeLessThan(robotOf(frames[10] as Frame).forwardMmPerSecond);
    expect([...last.mechanics.parts.values()].flatMap((part) => [...part.faults, ...part.effects, ...part.sounds.map((sound) => sound.sound)])).toEqual([]);
  });

  it('feeds its loads back: the behaviour runtime turns each motor at the speed the wheels actually went, one tick later', () => {
    const { frames } = run(fixture('rolling-start'), 'open-floor', 30);
    const before = frames[29] as Frame;
    const after = frames[30] as Frame;
    for (const motor of ['motor-left', 'motor-right']) {
      const motion = before.mechanics.actuators.get(motor)?.motor;
      expect(motion?.held).toBe(false);
      expect(motion?.loadNmm).toBeGreaterThan(0);
      expect(before.mechanics.loads.get(motor)?.motor).toBe(motion?.loadNmm);
      expect(speedOutput(after, motor).rpm).toBeCloseTo(motion?.rpm ?? Number.NaN, 9);
    }
    // And the electrical solver reads the same motions, one for each of the graph's power uses (review R-1.4 finding 8).
    const graph = buildGraph(fixture('rolling-start'), catalogue);
    const states: readonly (ActuatorState | undefined)[] = electricalActuators(graph.uses, before.mechanics.actuators);
    expect(states).toHaveLength(graph.uses.length);
    graph.uses.forEach((use, index) => {
      const motion = before.mechanics.actuators.get(use.part)?.[use.primitive];
      expect(states[index]).toBe(use.spec.kind === 'actuator' ? motion : undefined);
    });
    expect(states.filter((state) => state !== undefined)).toHaveLength(2);
  });

  it('turns on the spot when one motor is wired the other way: clockwise, about the middle of its axle', () => {
    const { frames, last } = run(fixture('reversed-motor'), 'open-floor', 60);
    const axle = (frame: Frame): { x: number; y: number } => {
      const pose = robotOf(frame).pose;
      const [cos, sin] = cosSin(pose.heading);
      return { x: pose.x + 40 * cos, y: pose.y + 40 * sin };
    };
    const end = robotOf(last);
    // The tyres meet the floor 79 mm either side of the middle, so it turns at about their speed over 79 mm.
    expect(end.turnDegPerSecond).toBeLessThan(-0.9 * ((freeRim(PACK_VOLTS) / 79) * 180) / Math.PI);
    expect(Math.abs(end.forwardMmPerSecond)).toBeLessThan(1);
    const [from, to] = [axle(frames[0] as Frame), axle(last)];
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThan(2);
    expect(wheelOf(last, 'wheel-left').groundMmPerSecond).toBeGreaterThan(0);
    expect(wheelOf(last, 'wheel-right').groundMmPerSecond).toBeLessThan(0);
    // The caster's drag, behind the axle, keeps the two a hair apart.
    expect(wheelOf(last, 'wheel-left').groundMmPerSecond).toBeCloseTo(-wheelOf(last, 'wheel-right').groundMmPerSecond, 0);
    // It turned well over a full turn, clockwise all the way.
    const turned = frames.slice(1).reduce((sum, frame) => sum + robotOf(frame).turnDegPerSecond / 30, 0);
    expect(turned).toBeLessThan(-360);
  });

  it('spins its wheels at launch when its motors push past the tyres’ grip, and speeds up only as fast as the grip lets it', () => {
    const strong = run(edited('rolling-start', { retype: { 'motor-left': 'strong-motor', 'motor-right': 'strong-motor' } }), 'open-floor', 30);
    const first = strong.frames[1] as Frame;
    // The stall push at each tyre, 400 N·mm × 2.8 / 6 over 32.5 mm = 5.7 N, is far past grip × floor friction × its weight.
    expect((400 * (PACK_VOLTS / 6)) / 32.5).toBeGreaterThan(5 * strong.model.arena.friction * wheelOf(first, 'wheel-left').loadNewtons);
    expect(wheelOf(first, 'wheel-left').slipping).toBe(true);
    expect(partOf(first, 'wheel-left').effects).toEqual(['slip']);
    // So its first tick gains less than friction on its whole weight could give it, μ g × 1/30 s; unchecked, the push would
    // take it to the motors' free speed within the tick.
    expect(robotOf(first).forwardMmPerSecond).toBeLessThan((strong.model.arena.friction * 9810) / 30);
    expect(robotOf(first).forwardMmPerSecond).toBeGreaterThan(100);
    // Once its speed takes the push within the grip, the tyres roll: no slip after the first tick, and the free speed.
    expect(strong.frames.slice(2).every((frame) => !wheelOf(frame, 'wheel-left').slipping && !wheelOf(frame, 'wheel-right').slipping)).toBe(true);
    expect(robotOf(strong.last).forwardMmPerSecond).toBeGreaterThan(0.99 * freeRim(PACK_VOLTS));
  });

  it('comes to rest exactly: its switch opened, it coasts to a stop and its pose never changes again (review R-1.4)', () => {
    const stopped = run(fixture('rolling-start'), 'open-floor', 300, { control: controlId('switch', 'contacts'), tick: 20 });
    const rest = stopped.frames.findIndex((frame) => frame.tick > 20 && robotOf(frame).forwardMmPerSecond === 0);
    expect(rest).toBeGreaterThan(21);
    expect(rest).toBeLessThan(60);
    const pose = robotOf(stopped.frames[rest] as Frame).pose;
    for (const frame of stopped.frames.slice(rest)) expect(robotOf(frame).pose).toEqual(pose);
    expect(pose.x).toBeGreaterThan(robotOf(stopped.frames[21] as Frame).pose.x);
  });

  it('pivots about a wheel whose motor has no power: its gear train drags it to a creep', () => {
    const { last } = run(edited('rolling-start', { removeWires: ['w10'] }), 'open-floor', 45);
    expect(wheelOf(last, 'wheel-left').groundMmPerSecond).toBeGreaterThan(100);
    expect(Math.abs(wheelOf(last, 'wheel-right').groundMmPerSecond)).toBeLessThan(0.02 * wheelOf(last, 'wheel-left').groundMmPerSecond);
    expect(robotOf(last).turnDegPerSecond).toBeLessThan(-30);
  });

  it('reads only the records: a renamed wheel gives the same Run (ground rule 1)', () => {
    const renamed = edited('rolling-start', { retype: { 'wheel-left': 'renamed-wheel', 'wheel-right': 'renamed-wheel' } });
    expect(run(renamed, 'open-floor', 20).frames.map((frame) => text(frame.mechanics))).toEqual(run(fixture('rolling-start'), 'open-floor', 20).frames.map((frame) => text(frame.mechanics)));
  });
});

describe('at a wall', () => {
  it('stops with its front at the wall and, with direct drive, stalls its motors: their push is under the tyres’ grip', () => {
    const { model, frames, last } = run(edited('rolling-start', { preset: 'near-wall' }), 'near-wall', 60);
    const end = robotOf(last);
    // The chassis's front is 80 mm ahead of its centre; the wall's face is at x = 1800 − 40 / 2.
    expect(end.pose.x).toBeGreaterThan(1700 - 0.5);
    expect(end.pose.x).toBeLessThan(1700 + 0.5);
    expect(end.pose.y).toBeCloseTo(600, 3);
    expect(Math.abs(end.forwardMmPerSecond)).toBeLessThan(0.5);
    expect(last.mechanics.contacts).toEqual([{ kind: 'wall', id: 'far-wall' }]);
    // The numbers: the stall push at the tyre, 39 N·mm × 2.8 / 6 over 32.5 mm, is under grip × floor friction × the weight on the wheel.
    const wheel = wheelOf(last, 'wheel-left');
    const push = (39 * (PACK_VOLTS / 6)) / 32.5;
    expect(push).toBeLessThan(1 * model.arena.friction * wheel.loadNewtons);
    expect(wheel).toMatchObject({ onFloor: true, slipping: false });
    for (const motor of ['motor-left', 'motor-right']) {
      expect(last.mechanics.actuators.get(motor)?.motor).toEqual({ held: true, rpm: 0, loadNmm: 39 * (PACK_VOLTS / 6) });
      expect(last.mechanics.loads.get(motor)?.motor).toBe(Number.POSITIVE_INFINITY);
      expect(speedOutput(last, motor).state).toBe('stalled');
    }
    // One knock, on the chassis, as it reaches the wall; the stall is the motors' overload, and nothing else is wrong.
    const knocks = frames.filter((frame) => partOf(frame, 'chassis').sounds.some((sound) => sound.sound === 'knock'));
    expect(knocks).toHaveLength(1);
    expect(knocks[0]?.mechanics.contacts).toEqual([{ kind: 'wall', id: 'far-wall' }]);
    expect(faultsOf({ model, frames, last })).toEqual(['motor-left: overload', 'motor-right: overload']);
  });

  it('with gearboxes slips instead: the push is past the grip, so the wheels spin, squeal and show slipping', () => {
    const { model, frames, last } = run(gearedWithoutBumper('near-wall'), 'near-wall', 120);
    const end = robotOf(last);
    // Its bumper switch's body leads: 90 mm ahead of the chassis's centre.
    expect(end.pose.x).toBeGreaterThan(1690 - 0.5);
    expect(end.pose.x).toBeLessThan(1690 + 0.5);
    const wheel = wheelOf(last, 'wheel-left');
    const push = (39 * ((PACK_VOLTS - 0.3) / 6) * 3 * 0.8) / 32.5;
    expect(push).toBeGreaterThan(1 * model.arena.friction * wheel.loadNewtons);
    expect(wheel.slipping).toBe(true);
    expect(wheel.slipMmPerSecond).toBeGreaterThan(10);
    expect(Math.abs(wheel.groundMmPerSecond)).toBeLessThan(0.5);
    expect(partOf(last, 'wheel-left').effects).toEqual(['slip']);
    expect(partOf(last, 'wheel-left').sounds.map((sound) => sound.sound)).toEqual(['squeal']);
    expect(partOf(last, 'wheel-left').faults).toEqual(['slipping']);
    for (const motor of ['motor-left', 'motor-right']) {
      const motion = last.mechanics.actuators.get(motor)?.motor;
      expect(motion?.held).toBe(false);
      // The grip's drag at the motor: its share of the friction torque, through the gearbox.
      expect(motion?.loadNmm).toBeCloseTo((1 * model.arena.friction * wheel.loadNewtons * 32.5) / (3 * 0.8), 6);
      expect(speedOutput(last, motor).state).toBe('turning');
    }
    // The servo motor starts at 3.5 V, above the pack's 2.8 V, so it stays still: no fault of its own.
    expect(faultsOf({ model, frames, last })).toEqual(['wheel-left: slipping', 'wheel-right: slipping']);
  });

  it('pushes a light prop along, and stops at a fixed one as at a wall', () => {
    const crate: Prop = { id: 'crate', shape: 'box', size: { x: 60, y: 60, z: 40 }, grams: 50, at: { x: 700, y: 600, heading: 0 }, fixed: false };
    const pushed = run(edited('rolling-start', { props: [crate] }), 'open-floor', 75);
    const box = pushed.last.mechanics.bodies.get('arena:crate');
    expect(box?.x).toBeGreaterThan(900);
    expect(box?.y).toBeCloseTo(600, 0);
    expect(pushed.last.mechanics.contacts).toEqual([{ kind: 'prop', id: 'crate' }]);
    const robot = robotOf(pushed.last);
    expect(robot.forwardMmPerSecond).toBeLessThan(robotOf(run(fixture('rolling-start'), 'open-floor', 75).last).forwardMmPerSecond);
    expect(robot.pose.x + 80).toBeGreaterThan((box?.x ?? 0) - 30 - 1);
    const post = run(edited('rolling-start', { props: [{ ...crate, id: 'post', fixed: true }] }), 'open-floor', 75);
    expect(post.last.mechanics.bodies.get('arena:post')).toEqual({ x: 700, y: 600, heading: 0 });
    expect(robotOf(post.last).pose.x).toBeCloseTo(700 - 30 - 80, 0);
    expect(post.last.mechanics.actuators.get('motor-left')?.motor?.held).toBe(true);
  });

  it('meets a heavy prop’s floor friction as it pushes: a 2 kg box stalls direct drive and slips geared drive, and neither moves it (review R-1.4)', () => {
    // μ m g = 0.8 × 2 kg × 9.81 = 15.7 N, against the bare motors' 2 × 39 N·mm × 2.8 / 6 ÷ 32.5 mm = 1.12 N at a stall.
    const direct = run(edited('rolling-start', { props: [boxAhead(2000)] }), 'open-floor', 90);
    expect(direct.last.mechanics.bodies.get('arena:box')).toEqual({ x: 500, y: 600, heading: 0 });
    expect(robotOf(direct.last).pose.x + 80).toBeCloseTo(500 - 30, 1);
    expect(direct.last.mechanics.contacts).toEqual([{ kind: 'prop', id: 'box' }]);
    for (const motor of ['motor-left', 'motor-right']) {
      expect(direct.last.mechanics.actuators.get(motor)?.motor).toEqual({ held: true, rpm: 0, loadNmm: 39 * (PACK_VOLTS / 6) });
      expect(speedOutput(direct.last, motor).state).toBe('stalled');
    }
    expect(direct.frames.every((frame) => !wheelOf(frame, 'wheel-left').slipping)).toBe(true);
    expect(faultsOf(direct)).toEqual(['motor-left: overload', 'motor-right: overload']);
    // Geared, the push at the tyres (1.3 N each) is past their grip, so they spin against the box instead.
    const geared = run(gearedRollingStart([boxAhead(2000)]), 'open-floor', 90);
    expect(geared.last.mechanics.bodies.get('arena:box')).toEqual({ x: 500, y: 600, heading: 0 });
    expect(wheelOf(geared.last, 'wheel-left')).toMatchObject({ slipping: true, groundMmPerSecond: 0 });
    expect(geared.last.mechanics.actuators.get('motor-left')?.motor?.held).toBe(false);
    expect(faultsOf(geared)).toEqual(['wheel-left: slipping', 'wheel-right: slipping']);
  });

  it('teaches the gearbox (D52): a box its bare motors stall against, the same robot pushes once geared', () => {
    // 160 g: μ m g = 1.26 N, past the bare motors' 1.12 N at a stall but inside what the geared tyres can grip.
    const friction = arena('open-floor').friction * 0.16 * 9.81;
    expect(friction).toBeGreaterThan((2 * 39 * (PACK_VOLTS / 6)) / 32.5);
    const direct = run(edited('rolling-start', { props: [boxAhead(160)] }), 'open-floor', 150);
    // It knocks the box a little way as it hits, then the box's friction holds it: it stops dead, its motors stalled.
    const nudged = direct.last.mechanics.bodies.get('arena:box')?.x ?? 0;
    expect(nudged).toBeGreaterThan(500);
    expect(nudged).toBeLessThan(530);
    for (const frame of direct.frames.slice(-60)) expect(frame.mechanics.bodies.get('arena:box')?.x).toBe(nudged);
    expect(direct.last.mechanics.actuators.get('motor-left')?.motor?.held).toBe(true);
    expect(faultsOf(direct)).toEqual(['motor-left: overload', 'motor-right: overload']);
    const geared = run(gearedRollingStart([boxAhead(160)]), 'open-floor', 150);
    const box = (frame: Frame): number => frame.mechanics.bodies.get('arena:box')?.x ?? 0;
    // It pushes the box along at its own speed, its tyres gripping, slower than it drives alone.
    const speed = (box(geared.last) - box(geared.frames[geared.frames.length - 31] as Frame)) / 1;
    expect(speed).toBeGreaterThan(40);
    expect(speed).toBeCloseTo(robotOf(geared.last).forwardMmPerSecond, 0);
    expect(robotOf(geared.last).forwardMmPerSecond).toBeLessThan(0.6 * robotOf(run(gearedRollingStart(), 'open-floor', 60).last).forwardMmPerSecond);
    expect(geared.frames.every((frame) => !wheelOf(frame, 'wheel-left').slipping && !wheelOf(frame, 'wheel-right').slipping)).toBe(true);
    expect(faultsOf(geared)).toEqual([]);
  });

  it('stays exactly where a wall stops it: stalled against it, or stopped short by its bumper switch (review R-1.4)', () => {
    for (const blueprint of [edited('rolling-start', { preset: 'near-wall' }), edited('bumper-robot', { preset: 'near-wall' })]) {
      const held = run(blueprint, 'near-wall', 600);
      const rest = held.frames.findIndex((frame) => frame.tick > 0 && robotOf(frame).forwardMmPerSecond === 0);
      expect(rest).toBeGreaterThan(0);
      expect(rest).toBeLessThan(120);
      const pose = robotOf(held.frames[rest] as Frame).pose;
      for (const frame of held.frames.slice(rest)) expect(robotOf(frame).pose).toEqual(pose);
      // One knock, as it arrives.
      expect(held.frames.filter((frame) => partOf(frame, 'chassis').sounds.some((sound) => sound.sound === 'knock'))).toHaveLength(1);
    }
  });
});

describe('balance', () => {
  it('drags its frame when the caster is loose: grounded, explained by the caster, so the caster’s is the only fault', () => {
    const loose = run(edited('rolling-start', { removeWires: ['w5'] }), 'open-floor', 60);
    const end = robotOf(loose.last);
    expect(end.stance).toBe('grounded');
    // It rests on its wheels and the rear edge of its frame: tilted back by 16.5 mm over the 120 mm from axle to tail.
    expect(end.pose.pitch).toBeCloseTo(atanDegrees(16.5 / 120), 9);
    expect(end.pose.roll).toBe(0);
    expect(partOf(loose.last, 'chassis').needs).toEqual([{ need: 'upright', kind: 'balance', unmet: 'grounded', explainedBy: { by: 'support', parts: ['caster'] } }]);
    expect(partOf(loose.last, 'chassis').faults).toEqual([]);
    // The frame drags, and so the loose caster's own claim shows; the rest of the robot shows nothing of it.
    expect(partOf(loose.last, 'chassis').effects).toEqual(['drag']);
    expect(partOf(loose.last, 'caster').effects).toEqual(['drag']);
    for (const id of ['battery', 'motor-left', 'wheel-left', 'switch']) expect(partOf(loose.last, id).effects).toEqual([]);
    // The caster lies where it was placed (D19), held by nothing.
    expect(loose.last.mechanics.bodies.get('caster')).toEqual({ x: 230, y: 600, heading: 0 });
    expect(faultsOf(loose)).toEqual(['caster: loose']);
    // The frame's drag holds it well under its speed on the caster.
    expect(end.forwardMmPerSecond).toBeLessThan(0.6 * robotOf(run(fixture('rolling-start'), 'open-floor', 60).last).forwardMmPerSecond);
    expect(end.forwardMmPerSecond).toBeGreaterThan(0);
  });

  it('starts at once while its frame drags: the frame slides with at most μN, so with no caster or a loose one it shows that one fault and never slips (review R-1.4)', () => {
    const geared = (edit: Edit): Blueprint =>
      edited('bumper-robot', {
        preset: 'open-floor',
        props: [],
        ...edit,
        wires: (wires) => wires.map((wire) => (wire.id === 'w15' ? { ...wire, from: { part: 'battery', port: 'plus' }, to: { part: 'driver', port: 'plus' } } : wire)),
      });
    const small: Edit = { retype: { 'wheel-left': 'small-wheel', 'wheel-right': 'small-wheel' }, move: { 'wheel-left': { x: 40, y: -76 }, 'wheel-right': { x: 40, y: 76 } } };
    const cases = [
      { build: geared({ removeWires: ['w8'], removeParts: ['caster'] }), faults: ['chassis: scraping'] },
      { build: geared({ removeWires: ['w8'] }), faults: ['caster: loose'] },
      { build: edited('rolling-start', { ...small, removeWires: ['w5'] }), faults: ['caster: loose'] },
    ];
    for (const { build, faults } of cases) {
      const dragged = run(build, 'open-floor', 60);
      expect(robotOf(dragged.last).stance).toBe('grounded');
      expect(dragged.frames.every((frame) => [...frame.mechanics.wheels.values()].every((wheel) => !wheel.slipping))).toBe(true);
      expect(faultsOf(dragged)).toEqual(faults);
      // Well on its way in its first tick: a drag that grew past μN as it sped up held it back for two.
      expect(robotOf(dragged.frames[1] as Frame).forwardMmPerSecond).toBeGreaterThan(0.5 * robotOf(dragged.last).forwardMmPerSecond);
    }
    // In the solve itself: from a creep, the drive pushing hard, the floor drags the frame's resting edge with exactly μ × the
    // weight on it, however fast the substep leaves it.
    const model = mechanicalModel(behaviourModel(buildGraph(cases[0]?.build as Blueprint, catalogue)), arena('open-floor'));
    const robot = model.robot as RobotModel;
    const points = stancePoints(robot);
    const stance = stanceOf(robot, points, loadingOf(robot, points, { x: 300, y: 600, cos: 1, sin: 0 }, [], { x: 0, y: 0 }));
    const motor = { driven: true, sense: 1, capacity: 100, freeRpm: 100, stallForce: 0.9, damping: 0, perRpm: 1 } as const;
    const step = driveStep(robot, stance, robot.wheels.map(() => motor), model.arena.friction, { forward: 1, left: 0, turn: 0 }, 1 / 120);
    const onFrame = stance.contacts.filter((contact) => contact.point.kind === 'body').reduce((sum, contact) => sum + contact.load, 0);
    expect(onFrame).toBeGreaterThan(0);
    expect(step.velocity.forward).toBeGreaterThan(10);
    const wheels = step.wheels.reduce((sum, wheel) => sum + (wheel?.roll ?? 0), 0);
    expect(wheels - step.floorForce.x).toBeCloseTo(model.arena.friction * onFrame, 9);
  });

  it('drags its frame when the caster is fixed where it cannot reach the floor: explained by the caster’s own lifted fault, the only one', () => {
    // On the bumper mount the caster hangs 6 mm short of the floor, ahead of the axle; the robot rocks back onto its tail.
    const short = run(
      edited('rolling-start', {
        move: { caster: { x: 80, y: 0 } },
        wires: (wires) => wires.map((wire) => (wire.id === 'w5' ? { ...wire, to: { part: 'chassis', port: 'bumper' } } : wire)),
      }),
      'open-floor',
      30,
    );
    expect(robotOf(short.last).stance).toBe('grounded');
    expect(partOf(short.last, 'chassis').needs).toEqual([{ need: 'upright', kind: 'balance', unmet: 'grounded', explainedBy: { by: 'support', parts: ['caster'] } }]);
    expect(partOf(short.last, 'caster').needs).toEqual([{ need: 'on-floor', kind: 'floor', unmet: 'lifted' }]);
    expect(partOf(short.last, 'caster').effects).toEqual(['drag']);
    expect(partOf(short.last, 'chassis').effects).toEqual(['drag']);
    expect(faultsOf(short)).toEqual(['caster: lifted']);
  });

  it('with no caster at all rocks back onto its tail and drags: grounded, the chassis’s own scraping, and it still drives (review 2.6)', () => {
    const tail = run(edited('rolling-start', { removeWires: ['w5'], removeParts: ['caster'] }), 'open-floor', 60);
    const end = robotOf(tail.last);
    // About 8° back, onto the rear edge of its frame, its weight still inside its wheels and that edge: no tip.
    expect(end.stance).toBe('grounded');
    expect(end.pose.pitch).toBeCloseTo(atanDegrees(16.5 / 120), 9);
    expect(partOf(tail.last, 'chassis').needs).toEqual([{ need: 'upright', kind: 'balance', unmet: 'grounded' }]);
    expect(partOf(tail.last, 'chassis').effects).toEqual(['drag']);
    expect(faultsOf(tail)).toEqual(['chassis: scraping']);
    expect(end.forwardMmPerSecond).toBeGreaterThan(0.3 * freeRim(PACK_VOLTS));
    // With the caster on its mount it rides level, and nothing is wrong.
    expect(faultsOf(run(fixture('rolling-start'), 'open-floor', 30))).toEqual([]);
  });

  it('tips with a top-heavy build: a tall, heavy load on the bumper mount rocks it onto its nose and over, and it stays down with its wheels spinning', () => {
    const top = edited('rolling-start', {
      addParts: [{ id: 'load', part: 'tall-battery-pack', position: { x: 80, y: 0 }, rotation: 0, settings: {} }],
      wires: (wires) => [...wires, { id: 'w13', from: { part: 'load', port: 'mount' }, to: { part: 'chassis', port: 'bumper' } }],
    });
    const tipped = run(top, 'open-floor', 30);
    const robot = tipped.model.robot as RobotModel;
    // Its centre of mass is ahead of its axle (x = 40) and high up: rocked onto the load's front edge, its weight swings past it.
    expect(robot.centreOfMass.x).toBeGreaterThan(40);
    expect(robot.centreOfMass.z - robot.bottom).toBeGreaterThan(150);
    for (const frame of tipped.frames) expect(robotOf(frame).stance).toBe('fallen');
    const end = robotOf(tipped.last);
    // On its front, where it fell at the start: it no longer drives.
    expect([end.pose.pitch, end.pose.roll]).toEqual([-90, 0]);
    expect([end.pose.x, end.pose.y]).toEqual([300, 600]);
    expect(partOf(tipped.last, 'chassis').needs).toEqual([{ need: 'upright', kind: 'balance', unmet: 'lost' }]);
    expect(partOf(tipped.last, 'chassis').effects).toEqual(['tip']);
    // Its driven wheels spin in the air, pushing nothing; the tip stands for what it lifts, so they show no fault.
    for (const id of ['wheel-left', 'wheel-right']) {
      expect(wheelOf(tipped.last, id)).toMatchObject({ onFloor: false, slipping: false, loadNewtons: 0 });
      expect(wheelOf(tipped.last, id).rpm).toBeGreaterThan(0);
      expect(partOf(tipped.last, id).effects).toEqual(['slip']);
      expect(partOf(tipped.last, id).needs).toEqual([{ need: 'on-floor', kind: 'floor' }]);
    }
    expect(tipped.last.mechanics.actuators.get('motor-left')?.motor).toMatchObject({ held: false, loadNmm: 0 });
    expect(faultsOf(tipped)).toEqual(['chassis: top-heavy']);
  });

  it('falls right over on a fast start when strong, grippy drive pushes a tall load’s weight back past its tail, and stays down', () => {
    const fallen = run(
      edited('rolling-start', {
        retype: { 'motor-left': 'strong-motor', 'motor-right': 'strong-motor', 'wheel-left': 'grippy-wheel', 'wheel-right': 'grippy-wheel' },
        addParts: [{ id: 'load', part: 'tall-battery-pack', position: { x: 0, y: 0 }, rotation: 0, settings: {} }],
        wires: (wires) => [...wires, { id: 'w13', from: { part: 'load', port: 'mount' }, to: { part: 'chassis', port: 'deck-middle' } }],
      }),
      'open-floor',
      30,
    );
    // It stands at rest; the floor's push as it starts leans its weight back over its tail.
    expect(robotOf(fallen.frames[0] as Frame).stance).toBe('upright');
    const end = robotOf(fallen.last);
    expect(end.stance).toBe('fallen');
    expect([end.pose.pitch, end.pose.roll]).toEqual([90, 0]);
    expect(faultsOf(fallen)).toEqual(['chassis: top-heavy']);
    const first = fallen.frames.findIndex((frame) => frame.mechanics.robot?.stance === 'fallen');
    expect(first).toBe(1);
    expect(fallen.frames.slice(first).every((frame) => frame.mechanics.robot?.stance === 'fallen')).toBe(true);
  });

  it('finds where the weight falls: inside its wheels and caster it stands, outside it tips about the edge it crossed, past everything it falls', () => {
    const model = mechanicalModel(behaviourModel(buildGraph(fixture('rolling-start'), catalogue)), arena('open-floor'));
    const robot = model.robot as RobotModel;
    const points = stancePoints(robot);
    const at = { x: 1000, y: 600, cos: 1, sin: 0 };
    const weight = robot.kilograms * 9.81;
    const height = robot.centreOfMass.z - robot.bottom;
    // A floor force F moves the weight h × F ÷ W the other way, so a push of W × d ÷ h moves it d back.
    const pushed = (d: number) => stanceOf(robot, points, loadingOf(robot, points, at, [], { x: (weight * d) / height, y: 0 }));
    const level = pushed(0);
    expect(level.state).toBe('upright');
    expect(level.contacts.map((contact) => contact.point.kind)).toEqual(['wheel', 'wheel', 'support']);
    expect(level.contacts.reduce((sum, contact) => sum + contact.load, 0)).toBeCloseTo(weight, 12);
    // Hard braking moves the weight forward past the axle: the robot pitches onto the front of its frame.
    const nose = pushed(-(40 - robot.centreOfMass.x) - 5);
    expect(nose.state).toBe('grounded');
    expect(nose.contacts.some((contact) => contact.point.kind === 'support')).toBe(false);
    expect(nose.tilt.x).toBeCloseTo(-16.5 / 40, 12);
    // Past the front of the frame it falls on its front.
    const over = pushed(-(80 - robot.centreOfMass.x) - 5);
    expect(over.state).toBe('fallen');
    expect(over.fall?.x).toBeGreaterThan(0);
  });

  it('climbs a slope tilted to it, slower than on the flat, and stops at the ramp’s high edge rather than driving off', () => {
    const { model, frames, last } = run(edited('rolling-start', { preset: 'ramp' }), 'ramp', 150);
    const climbing = frames.find((frame) => robotOf(frame).pose.x > 1100 && robotOf(frame).pose.x < 1300) as Frame;
    expect(robotOf(climbing).pose.pitch).toBeCloseTo(atanDegrees(60 / 600), 9);
    expect(robotOf(climbing).forwardMmPerSecond).toBeLessThan(0.9 * freeRim(PACK_VOLTS));
    expect(robotOf(climbing).forwardMmPerSecond).toBeGreaterThan(0.5 * freeRim(PACK_VOLTS));
    // Its front stops at the ledge along the high edge (1500 − 4 / 2), still on the slope.
    expect(robotOf(last).pose.x + 80).toBeCloseTo(1498, 0);
    expect(last.mechanics.contacts).toEqual([{ kind: 'ledge', id: 'slope-east-0' }]);
    expect(robotOf(last).pose.pitch).toBeCloseTo(atanDegrees(60 / 600), 9);
    expect(model.arena.ramps).toHaveLength(1);
    // Over the content ramp's ridge it goes up and comes back down.
    const hill = run(edited('rolling-start', { preset: 'ridge' }), 'ridge', 150);
    const pitches = hill.frames.map((frame) => robotOf(frame).pose.pitch ?? 0);
    expect(Math.max(...pitches)).toBeCloseTo(atanDegrees(40 / 280), 9);
    expect(Math.min(...pitches)).toBeCloseTo(-atanDegrees(40 / 560), 9);
    // Its caster, 70 mm behind its centre, is back on the flat past the foot of the far slope.
    expect(robotOf(hill.last).pose.x - 70).toBeGreaterThan(1440);
    expect(robotOf(hill.last).pose.pitch).toBe(0);
    expect(faultsOf(hill)).toEqual([]);
  });
});

describe('a bumper switch', () => {
  it('flips at the wall: it opens in the very tick its probe meets the wall, cuts the motor driver, and the robot stops with its chassis 10 mm short', () => {
    const bumped = run(edited('bumper-robot', { preset: 'near-wall' }), 'near-wall', 100);
    const control = controlId('bumper', 'contacts');
    const opened = bumped.frames.findIndex((frame) => frame.mechanics.switches[control] === false);
    const touched = bumped.frames.findIndex((frame) => frame.mechanics.contacts.length > 0);
    expect(opened).toBeGreaterThan(0);
    expect(bumped.frames.slice(0, opened).every((frame) => frame.mechanics.switches[control] === true)).toBe(true);
    expect(bumped.frames.slice(opened).every((frame) => frame.mechanics.switches[control] === false)).toBe(true);
    // The probe lies on the front of the bumper switch's own body, so the two meet the wall together: never the body first.
    expect(touched).toBe(opened);
    const end = robotOf(bumped.last);
    expect(end.pose.x + 80).toBeCloseTo(1780 - 10, 1);
    expect(end.forwardMmPerSecond).toBeCloseTo(0, 3);
    // The next tick the motors have no power: they are never held, so the bumper's stop is no overload.
    const after = bumped.frames[opened + 1] as Frame;
    expect(speedOutput(after, 'motor-left').state).toBe('idle');
    expect(bumped.frames.every((frame) => !frame.mechanics.actuators.get('motor-left')?.motor?.held || frame.tick === opened)).toBe(true);
    expect(faultsOf(bumped)).toEqual([]);
  });

  it('registers along its whole travel: a whisker that leads the body opens before the body arrives, and the robot never touches the wall', () => {
    const whiskered = run(edited('bumper-robot', { preset: 'near-wall', retype: { bumper: 'whisker-switch' } }), 'near-wall', 100);
    const control = controlId('bumper', 'contacts');
    const opened = whiskered.frames.findIndex((frame) => frame.mechanics.switches[control] === false);
    expect(opened).toBeGreaterThan(0);
    expect(whiskered.frames.every((frame) => frame.mechanics.contacts.length === 0)).toBe(true);
    // The whisker reaches 35 mm past the switch's centre, 115 mm ahead of the chassis's; it opened as it came within touch.
    const at = robotOf(whiskered.frames[opened] as Frame).pose.x + 115;
    expect(at).toBeGreaterThanOrEqual(1780 - TOUCH_MM);
    expect(at).toBeLessThan(1780 + 3.2);
    expect(robotOf(whiskered.last).pose.x + 90).toBeLessThan(1780);
  });

  it('lying loose on a mirrored mount, has its probe mirrored too (review R-1.4)', () => {
    // A second chassis lies on the floor, held by nothing, with the switch on its mirrored right motor mount.
    const lying = (y: number): Blueprint =>
      edited('rolling-start', {
        addParts: [
          { id: 'frame', part: 'chassis', position: { x: 600, y: 0 }, rotation: 0, settings: {} },
          { id: 'feeler', part: 'offset-bumper', position: { x: 630, y: 53 }, rotation: 0, settings: {} },
        ],
        wires: (wires) => [...wires, { id: 'w13', from: { part: 'feeler', port: 'mount' }, to: { part: 'frame', port: 'motor-right' } }],
        props: [{ id: 'post', shape: 'cylinder', size: { x: 10, y: 10, z: 40 }, grams: 50, at: { x: 940, y, heading: 0 }, fixed: true }],
      });
    const control = controlId('feeler', 'contacts');
    const probe = simulate(lying(525), 'open-floor', 0).model.probes.find((each) => each.part === 'feeler');
    // The switch lies at (930, 547): its probe, 5 to 30 mm to its left as drawn, reaches 5 to 30 mm to its right.
    expect(probe).toMatchObject({ onRobot: false, from: { x: 940, y: 542 }, to: { x: 940, y: 517 } });
    expect(simulate(lying(525), 'open-floor', 0).last.mechanics.switches[control]).toBe(false);
    expect(simulate(lying(565), 'open-floor', 0).last.mechanics.switches[control]).toBe(true);
  });

  it('sweeps its probe through each substep: a thin wall it passes between two checks still counts', () => {
    const model = mechanicalModel(behaviourModel(buildGraph(edited('bumper-robot', { preset: 'thin' }), catalogue)), arena('thin'));
    const { bytes, layout } = buildWorld(model, 1 / 120);
    const world = openWorld(bytes, 1 / 120);
    try {
      const boxes = obstacleBoxes(world, model, layout);
      const segment = (x: number) => [{ x, y: 580 }, { x, y: 620 }] as const;
      // The sheet spans x 999.5–1000.5: 4 mm either side of it the probe is clear, but it swept across it.
      expect(probeTouches(world, layout, boxes, segment(996), segment(996))).toBe(false);
      expect(probeTouches(world, layout, boxes, segment(1004), segment(1004))).toBe(false);
      expect(probeTouches(world, layout, boxes, segment(996), segment(1004))).toBe(true);
      expect(probeTouches(world, layout, boxes, segment(999), segment(999))).toBe(true);
    } finally {
      world.free();
    }
  });
});

describe('loose parts and no robot', () => {
  it('lie where they were placed, as bodies of their own, when no part holds another (D19)', () => {
    const blueprint = fixture('led-circuit');
    const { model, last } = run(blueprint, 'open-floor', 10);
    expect(model.robot).toBeUndefined();
    expect(last.mechanics.robot).toBeUndefined();
    const start = arena('open-floor').start;
    const expected = blueprint.parts.map((part) => [part.id, arenaPoseOf(start, { x: 0, y: 0, rotation: 0 }, { x: part.position.x, y: part.position.y, rotation: part.rotation })] as const);
    expect([...last.mechanics.bodies].filter(([subject]) => !subject.startsWith('arena:'))).toEqual(
      expected.map(([id, pose]) => [id, { ...pose, heading: pose.heading }]).sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
    );
    expect(last.mechanics.wheels.size).toBe(0);
  });
});

describe('tick 0 and snapshots', () => {
  it('moves nothing at tick 0, and loads no motor', () => {
    const { frames } = run(fixture('rolling-start'), 'open-floor', 1);
    const zero = frames[0] as Frame;
    expect(robotOf(zero).pose).toEqual({ x: 300, y: 600, heading: 0, pitch: 0, roll: 0 });
    expect([...zero.mechanics.loads.values()].flatMap((loads) => Object.values(loads))).toEqual([0, 0]);
    expect(robotOf(frames[1] as Frame).pose.x).toBeGreaterThan(300);
  });

  it('restores exactly: from a snapshot taken mid-Run, the rest of the Run is the same, bit for bit', () => {
    // Snapshotted on its way to the wall, and resumed through the impact and the stall.
    const blueprint = edited('rolling-start', { preset: 'near-wall' });
    const whole = simulate(blueprint, 'near-wall', 60);
    const middle = whole.frames[20] as Frame;
    const bytes = mechanicalSnapshot(middle.mechanics.state);
    // Equal states give equal bytes.
    expect(mechanicalSnapshot(restoreMechanics(whole.model, bytes))).toEqual(bytes);
    const resumed = simulate(blueprint, 'near-wall', 40, { bytes, from: middle });
    expect(resumed.frames.map((frame) => text(frame.mechanics))).toEqual(whole.frames.slice(21).map((frame) => text(frame.mechanics)));
    expect(mechanicalSnapshot(resumed.last.mechanics.state)).toEqual(mechanicalSnapshot(whole.last.mechanics.state));
    expect(whole.frames.some((frame) => frame.tick > 20 && frame.mechanics.contacts.length > 0)).toBe(true);
  });

  it('refuses a snapshot from another Run', () => {
    const one = simulate(fixture('rolling-start'), 'open-floor', 1);
    const other = simulate(edited('rolling-start', { preset: 'near-wall' }), 'near-wall', 1);
    expect(() => restoreMechanics(one.model, mechanicalSnapshot(other.last.mechanics.state))).toThrow('another Run');
    expect(() => restoreMechanics(one.model, new Uint8Array(16))).toThrow();
    // The same arena, so as many props and walls, but another robot: the model's fingerprint tells them apart (review R-1.4).
    const geared = simulate(gearedRollingStart(), 'open-floor', 1);
    expect(geared.model.arena).toEqual(one.model.arena);
    expect(() => restoreMechanics(one.model, mechanicalSnapshot(geared.last.mechanics.state))).toThrow('another Run');
    expect(modelPrint(one.model)).toBe(modelPrint(simulate(fixture('rolling-start'), 'open-floor', 1).model));
  });
});

/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import {
  arenaPoseOf,
  canonicalizeBlueprint,
  canvasPoseOf,
  checkPortPair,
  controlId,
  controlsOf,
  drivePushes,
  explainByControls,
  indexPlacedParts,
  mountPlacement,
  placeParts,
  placePoint,
  planWire,
  resolvePort,
  robotRoot,
  serializeBlueprint,
  validateBlueprint,
  wiredNeeds,
} from '@servo/schema';
import type {
  Blueprint,
  CanvasPose,
  ControlState,
  MountPointPort,
  MountPort,
  PartRecord,
  PlacedPart,
  PortRef,
  PowerNeed,
  Primitive,
  SpeedActuator,
  Vec3,
  WheelPrimitive,
  Wire,
} from '@servo/schema';
import { FIXTURES, loadFixtures } from '../src/fixtures.ts';
import type { ContentFixture, FaultExpectation } from '../src/fixtures.ts';
import { loadArenas, loadCatalogue } from '../src/index.ts';

// Task 2.6: eight working and eight broken fixture blueprints for the simulation and canvas teams, and the battery
// what-if for task 4.8. sim-core's tick loop (task 1.5) is not here yet, so this file reproduces each verdict
// statically with the schema's own rules:
// - the wiring: `wiredNeeds` decides power and loop `open` and isolation `shorted`, and says what explains each;
// - the voltages: nominal volts (batteries at full charge, no sag), judged for `low`, `high` and `reversed` and
//   explained in the schema's order with `explainByControls`, then by an unpowered motor driver feeding the part;
// - the links: signal, mount and drive needs from the wires;
// - balance: the centre of mass against the wheels and supports, and off them, where the robot lands once a chassis
//   edge meets the floor (the orchestrator's ruling after review R-2.6): resting on it is grounded, over it is lost.
// The load torque and the floor (stall, slip, lifted) are left to the mechanical solver (task 1.4), and the
// golden-run harness (task 1.7) replays every fixture in sim-core against its recorded verdict.

const WORKING = [
  'level-1-roller',
  'switch-in-the-line',
  'small-wheel-roller',
  'motor-driver-robot',
  'bumper-stops-at-wall',
  'led-and-buzzer-robot',
  'geared-robot',
  'busy-workbench',
] as const;

const BROKEN = [
  'broken-reversed-motor',
  'broken-missing-return-wire',
  'broken-servo-without-signal',
  'broken-underpowered-pack',
  'broken-chassis-on-the-floor',
  'broken-short-circuit',
  'broken-wrong-type-wire',
  'broken-loose-caster',
] as const;

/** Neither working nor broken, and not one of the eight and eight: the battery what-if, kept for task 4.8. */
const WHAT_IF = ['one-cell-roller'] as const;

const TASK_FIXTURES: readonly string[] = [...WORKING, ...BROKEN, ...WHAT_IF];

const catalogue = loadCatalogue();
const load = loadFixtures();

const fixture = (name: string): ContentFixture => {
  const found = load.fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No valid fixture '${name}'; the loader test lists why.`);
  return found;
};

/** Each blueprint file's text exactly as committed, by name. */
const texts = new Map(
  Object.entries(import.meta.glob<string>('../fixtures/blueprints/*.json', { query: '?raw', import: 'default', eager: true })).map(([path, text]) => [
    path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, ''),
    text,
  ]),
);

const record = (id: string): PartRecord => {
  const found = catalogue.parts.get(id);
  if (!found) throw new Error(`Content has no part record '${id}'.`);
  return found;
};

const typeOf = (blueprint: Blueprint, id: string): PartRecord => record(blueprint.parts.find((part) => part.id === id)?.part ?? '');

const named = ({ partId, failure }: FaultExpectation): string => `${partId}: ${failure}`;

// ---------------------------------------------------------------------------------------------
// The static judge.

const portKey = (ref: PortRef): string => `${ref.part}.${ref.port}`;

const primitivesOf = (blueprint: Blueprint): { readonly part: string; readonly primitive: Primitive }[] =>
  blueprint.parts.flatMap((part) => typeOf(blueprint, part.id).behaviour.map((primitive) => ({ part: part.id, primitive })));

/** A control's setting at `state`, or at rest when `state` leaves it out. */
const settingOf = (blueprint: Blueprint, state: ControlState, id: string): boolean | number | undefined => {
  const control = controlsOf(blueprint, catalogue).find((candidate) => candidate.id === id);
  if (!control) return undefined;
  return (control.kind === 'switch' ? state.switches?.[id] : state.channels?.[id]) ?? control.rest;
};

interface Circuit {
  /** The net a power port is on, with every closed switch joined. */
  readonly net: (part: string, port: string) => string;
  /** Volts from `neg` to `pos` where batteries and motor-driver outputs fix both; undefined elsewhere or on a short. */
  readonly across: (pos: string, neg: string) => number | undefined;
}

/**
 * The circuit at one setting of the controls, with each battery at its full volts and no sag: power wires and
 * closed switches join ports into nets, batteries fix the volts between nets, and each motor-driver channel then
 * gives its supply × command less its drop, or nothing below its onVolts.
 */
const circuitAt = (blueprint: Blueprint, state: ControlState): Circuit => {
  const parts = indexPlacedParts(blueprint.parts);
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let top = key;
    for (let up = parent.get(top); up !== undefined; up = parent.get(top)) top = up;
    return top;
  };
  const join = (a: string, b: string): void => {
    const [x, y] = [find(a), find(b)];
    if (x !== y) parent.set(x, y);
  };
  for (const wire of blueprint.wires) {
    const [a, b] = [resolvePort(parts, catalogue, wire.from), resolvePort(parts, catalogue, wire.to)];
    if (a.found && b.found && a.spec.type === 'power' && b.spec.type === 'power') join(portKey(wire.from), portKey(wire.to));
  }
  const primitives = primitivesOf(blueprint);
  for (const { part, primitive } of primitives) {
    if (primitive.kind === 'regulator' || primitive.kind === 'program') throw new Error(`No static judge for a ${primitive.kind} (Level 3).`);
    if (primitive.kind === 'switch' && settingOf(blueprint, state, controlId(part, primitive.id)) === true) {
      join(`${part}.${primitive.terminals[0]}`, `${part}.${primitive.terminals[1]}`);
    }
  }
  const net = (part: string, port: string): string => find(`${part}.${port}`);

  interface Push {
    readonly pos: string;
    readonly neg: string;
    readonly volts: number;
  }
  /** Each net's potential and component. A component whose loops of sources do not cancel is a short: left out. */
  const solve = (pushes: readonly Push[]) => {
    const potential = new Map<string, number>();
    const component = new Map<string, number>();
    const touching = new Map<string, Push[]>();
    for (const push of pushes) for (const end of [push.pos, push.neg]) touching.set(end, [...(touching.get(end) ?? []), push]);
    let count = 0;
    for (const start of touching.keys()) {
      if (potential.has(start)) continue;
      count += 1;
      const members = [start];
      let shorted = false;
      potential.set(start, 0);
      component.set(start, count);
      for (let head = 0; head < members.length; head += 1) {
        const here = members[head] as string;
        for (const push of touching.get(here) ?? []) {
          const there = push.pos === here ? push.neg : push.pos;
          const expected = (potential.get(here) as number) + (push.pos === here ? -push.volts : push.volts);
          const known = potential.get(there);
          if (known === undefined) {
            potential.set(there, expected);
            component.set(there, count);
            members.push(there);
          } else if (Math.abs(known - expected) > 1e-9) {
            shorted = true;
          }
        }
      }
      if (shorted) for (const member of members) potential.delete(member);
    }
    return (pos: string, neg: string): number | undefined => {
      const [p, n] = [potential.get(pos), potential.get(neg)];
      return p === undefined || n === undefined || component.get(pos) !== component.get(neg) ? undefined : p - n;
    };
  };
  const batteries: Push[] = primitives.flatMap(({ part, primitive }) =>
    primitive.kind === 'source' ? [{ pos: net(part, primitive.output.pos), neg: net(part, primitive.output.neg), volts: primitive.volts }] : [],
  );
  const fromBatteries = solve(batteries);
  const outputs: Push[] = primitives.flatMap(({ part, primitive }) => {
    if (primitive.kind !== 'driver') return [];
    const supply = fromBatteries(net(part, primitive.supply.pos), net(part, primitive.supply.neg)) ?? 0;
    const command = Number(settingOf(blueprint, state, controlId(part, primitive.id)) ?? primitive.command);
    const on = supply >= primitive.onVolts && command !== 0;
    const volts = on ? Math.sign(command) * (supply * Math.abs(command) - primitive.dropVolts) : 0;
    return [{ pos: net(part, primitive.output.pos), neg: net(part, primitive.output.neg), volts }];
  });
  return { net, across: solve([...batteries, ...outputs]) };
};

const powerNeedsOf = (blueprint: Blueprint): { readonly part: string; readonly need: PowerNeed }[] =>
  blueprint.parts.flatMap((part) => typeOf(blueprint, part.id).needs.flatMap((need) => (need.kind === 'power' ? [{ part: part.id, need }] : [])));

/** The way the volts across a supply leave a power need unmet, if they do. */
const voltageWay = (volts: number, need: PowerNeed): 'reversed' | 'low' | 'high' | undefined =>
  volts < 0 ? 'reversed' : volts < need.minVolts ? 'low' : volts > need.maxVolts ? 'high' : undefined;

/** The volts across a part's supply at `state`, or undefined where the nominal circuit cannot say. */
const supplyVolts = (blueprint: Blueprint, state: ControlState, part: string, need: PowerNeed): number | undefined => {
  const circuit = circuitAt(blueprint, state);
  return circuit.across(circuit.net(part, need.supply.pos), circuit.net(part, need.supply.neg));
};

/** Whether a power need is met at `state`: by the wiring (`wiredNeeds`), then by the volts. */
const powerMet = (blueprint: Blueprint, state: ControlState, part: string, need: PowerNeed): boolean => {
  const wired = wiredNeeds(blueprint, catalogue, state).find((verdict) => verdict.partId === part && verdict.need === need.id);
  if (wired?.unmet !== undefined) return false;
  const volts = supplyVolts(blueprint, state, part, need);
  return volts !== undefined && voltageWay(volts, need) === undefined;
};

/** The motor driver whose channel output is exactly this part's supply, if one feeds it. */
const feederOf = (blueprint: Blueprint, state: ControlState, part: string, need: PowerNeed): string | undefined => {
  const circuit = circuitAt(blueprint, state);
  const ends = [circuit.net(part, need.supply.pos), circuit.net(part, need.supply.neg)].sort().join('|');
  return primitivesOf(blueprint).find(
    ({ part: other, primitive }) =>
      primitive.kind === 'driver' && [circuit.net(other, primitive.output.pos), circuit.net(other, primitive.output.neg)].sort().join('|') === ends,
  )?.part;
};

/** The voltage faults: unmet ways the controls cannot fix and no unpowered motor driver explains. */
const voltageFaults = (blueprint: Blueprint, state: ControlState): string[] => {
  const wired = wiredNeeds(blueprint, catalogue, state);
  const controls = controlsOf(blueprint, catalogue);
  return powerNeedsOf(blueprint).flatMap(({ part, need }) => {
    if (wired.find((verdict) => verdict.partId === part && verdict.need === need.id)?.unmet !== undefined) return [];
    const volts = supplyVolts(blueprint, state, part, need);
    if (volts === undefined) throw new Error(`The nominal circuit cannot say what '${part}' gets.`);
    const way = voltageWay(volts, need);
    if (way === undefined) return [];
    if (explainByControls(controls, state, (then) => powerMet(blueprint, then, part, need)) !== undefined) return [];
    const feeder = feederOf(blueprint, state, part, need);
    const feederNeed = feeder === undefined ? undefined : powerNeedsOf(blueprint).find((candidate) => candidate.part === feeder);
    if (feeder !== undefined && feederNeed !== undefined && !powerMet(blueprint, state, feeder, feederNeed.need)) return [];
    const mode = typeOf(blueprint, part).failureModes.find((candidate) => candidate.need === need.id && candidate.unmet === way);
    return mode ? [`${part}: ${mode.id}`] : [];
  });
};

/** The faults the wiring decides: power and loop `open` and isolation `shorted` that nothing explains. */
const wiringFaults = (blueprint: Blueprint, state: ControlState): string[] =>
  wiredNeeds(blueprint, catalogue, state).flatMap((verdict) => {
    if (verdict.unmet === undefined || verdict.explainedBy !== undefined) return [];
    const mode = typeOf(blueprint, verdict.partId).failureModes.find((candidate) => candidate.need === verdict.need && candidate.unmet === verdict.unmet);
    return mode ? [`${verdict.partId}: ${mode.id}`] : [];
  });

/** Whether some wire of `kind` ends at this port. */
const linked = (blueprint: Blueprint, part: string, port: string, kind: 'signal' | 'mount' | 'drive'): boolean => {
  const parts = indexPlacedParts(blueprint.parts);
  return blueprint.wires.some((wire) => {
    if (portKey(wire.from) !== `${part}.${port}` && portKey(wire.to) !== `${part}.${port}`) return false;
    const [a, b] = [resolvePort(parts, catalogue, wire.from), resolvePort(parts, catalogue, wire.to)];
    if (!a.found || !b.found) return false;
    const pair = checkPortPair(a.spec, b.spec);
    return pair.legal && pair.kind === kind;
  });
};

/** Signal, mount and drive needs: no Level 1–2 part gives a signal, so a signal in with no line is absent. */
const linkFaults = (blueprint: Blueprint): string[] =>
  blueprint.parts.flatMap((part) => {
    const type = typeOf(blueprint, part.id);
    return type.needs.flatMap((need) => {
      if (need.kind === 'signal' && linked(blueprint, part.id, need.port, 'signal')) throw new Error('No static judge for a driven signal line (Level 3).');
      const absent =
        (need.kind === 'signal' && !linked(blueprint, part.id, need.port, 'signal')) ||
        (need.kind === 'mount' && !linked(blueprint, part.id, need.port, 'mount')) ||
        (need.kind === 'drive' && !linked(blueprint, part.id, need.port, 'drive'));
      const mode = absent ? type.failureModes.find((candidate) => candidate.need === need.id && candidate.unmet === 'absent') : undefined;
      return mode ? [`${part.id}: ${mode.id}`] : [];
    });
  });

interface Robot {
  /** The part whose balance need it is: the chassis, at the root of the robot. */
  readonly root: string;
  readonly grams: number;
  /** The centre of mass in the root's frame. */
  readonly centre: { readonly x: number; readonly y: number; readonly z: number };
  /** Where each wheel and support on the robot meets the floor: its footprint's centre, in the root's frame. */
  readonly contacts: readonly { readonly id: string; readonly x: number; readonly y: number; readonly z: number }[];
}

/** The robot each part with a balance need carries: every part mounted on it or carried by it. */
const robotsOf = (blueprint: Blueprint): Robot[] => {
  const placements = placeParts(blueprint, catalogue);
  return blueprint.parts
    .filter((part) => typeOf(blueprint, part.id).needs.some((need) => need.kind === 'balance'))
    .map((host) => {
      let grams = 0;
      let [x, y, z] = [0, 0, 0];
      const contacts: Robot['contacts'][number][] = [];
      for (const part of blueprint.parts) {
        const where = placements.get(part.id);
        if (where?.root !== host.id) continue;
        const { body, behaviour } = typeOf(blueprint, part.id);
        const centre = placePoint(where.placement, body.centreOfMass);
        grams += body.grams;
        [x, y, z] = [x + body.grams * centre.x, y + body.grams * centre.y, z + body.grams * centre.z];
        if (behaviour.some((primitive) => primitive.kind === 'wheel' || primitive.kind === 'support')) {
          contacts.push({ id: part.id, ...placePoint(where.placement, { x: 0, y: 0, z: 0 }) });
        }
      }
      return { root: host.id, grams, centre: { x: x / grams, y: y / grams, z: z / grams }, contacts };
    });
};

const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scaled = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const crossed = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/**
 * The floor a robot rests on: the plane through its three wheels and supports, as a point on it and its upward unit
 * normal, in the robot's frame. It tilts when they sit at different heights, as small wheels do beside the caster.
 * Undefined with fewer than three.
 */
const floorOf = (robot: Robot): { readonly at: Vec3; readonly up: Vec3 } | undefined => {
  if (robot.contacts.length > 3) throw new Error('No static judge for more than three wheels and supports.');
  const [a, b, c] = robot.contacts;
  if (!a || !b || !c) return undefined;
  const normal = crossed(minus(b, a), minus(c, a));
  return { at: a, up: scaled(normal, Math.sign(normal.z) / Math.sqrt(dot(normal, normal))) };
};

/**
 * Whether the robot rides upright: its centre of mass, dropped onto its floor, lands inside the triangle of its three
 * wheels and supports, edges included. On two alone it stays up only over the line between them, seen from above.
 */
const upright = (robot: Robot): boolean => {
  const floor = floorOf(robot);
  const { centre, contacts } = robot;
  if (!floor) {
    const [a, b] = contacts;
    if (!a || !b) return false;
    const between = (centre.x - a.x) * (centre.x - b.x) + (centre.y - a.y) * (centre.y - b.y) <= 0;
    return between && Math.abs((b.x - a.x) * (centre.y - a.y) - (b.y - a.y) * (centre.x - a.x)) < 1e-9;
  }
  const dropped = minus(centre, scaled(floor.up, dot(minus(centre, floor.at), floor.up)));
  const sides = contacts.map((corner, index) => dot(crossed(minus(contacts[(index + 1) % 3] as Vec3, corner), minus(dropped, corner)), floor.up));
  return sides.every((side) => side >= -1e-9) || sides.every((side) => side <= 1e-9);
};

/** How far the lowest body on a robot, its wheels and supports left out, stands above its floor. */
const clearance = (blueprint: Blueprint, robot: Robot): number => {
  const floor = floorOf(robot);
  if (!floor) throw new Error(`The ${robot.root} rests on fewer than three wheels and supports.`);
  const placements = placeParts(blueprint, catalogue);
  const touching = new Set(robot.contacts.map((contact) => contact.id));
  const heights = blueprint.parts.flatMap((part) => {
    const where = placements.get(part.id);
    if (where?.root !== robot.root || touching.has(part.id)) return [];
    const { size } = typeOf(blueprint, part.id).body;
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => placePoint(where.placement, { x: (sx * size.x) / 2, y: (sy * size.y) / 2, z: 0 })));
    return corners.map((corner) => dot(minus(corner, floor.at), floor.up));
  });
  return Math.min(...heights);
};

/** Where a robot that has left its wheels and supports comes to rest, along the floor from its wheels' contact. */
interface Landing {
  /** How far it rocks about the axle before a bottom edge of the chassis meets the floor, in degrees. */
  readonly degrees: number;
  /** Signed along the robot's heading: negative behind the wheels' contact. */
  readonly edge: number;
  readonly centre: number;
  /** Whether the centre of mass lands over the new base, the wheels to the chassis's edge: it rests and drags. */
  readonly rests: boolean;
}

/**
 * The orchestrator's ruling for a robot whose centre of mass leaves the polygon of its wheels and supports (given to
 * task 1.4 too): it rocks until a chassis edge touches the floor. Landing over the new base (the wheels and that edge),
 * it rests and drags: balance · grounded. Landing beyond it, it falls over with its wheels in the air: balance · lost, a
 * tip. Judged here for a robot left on its two wheels, which rocks about their axle; rocking by t toward an edge
 * (dx, dz) from the axle lowers it to dz·cos t − |dx|·sin t, and it lands once that is −radius.
 */
const landingOf = (blueprint: Blueprint, robot: Robot): Landing => {
  if (robot.contacts.length !== 2) throw new Error('No static judge for a robot that leaves a base of three.');
  const placements = placeParts(blueprint, catalogue);
  const axles = blueprint.parts.flatMap((part) => {
    const where = placements.get(part.id);
    const type = typeOf(blueprint, part.id);
    const wheel = type.behaviour.find((primitive): primitive is WheelPrimitive => primitive.kind === 'wheel');
    const hub = type.ports.find((port) => port.id === wheel?.hub);
    if (where?.root !== robot.root || !wheel || hub?.type !== 'mechanical' || !('at' in hub)) return [];
    const at = placePoint(where.placement, hub.at);
    return [{ x: at.x, z: at.z, radius: wheel.radiusMm }];
  });
  const [axle] = axles;
  if (!axle || axles.some((other) => other.x !== axle.x || other.z !== axle.z || other.radius !== axle.radius)) throw new Error('No static judge for wheels off one axle.');
  const { size } = typeOf(blueprint, robot.root).body;
  const back = robot.centre.x < axle.x ? -1 : 1;
  const rocked = (dx: number, dz: number, t: number) => ({
    along: dx * Math.cos(t) + back * dz * Math.sin(t),
    up: dz * Math.cos(t) - back * dx * Math.sin(t),
  });
  const [ex, ez] = [(back * size.x) / 2 - axle.x, -axle.z];
  let [low, high] = [0, Math.PI / 2];
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (rocked(ex, ez, mid).up > -axle.radius) low = mid;
    else high = mid;
  }
  // The chassis's edge must be the first body down: every other body on the robot still clears the floor.
  for (const part of blueprint.parts) {
    const where = placements.get(part.id);
    if (where?.root !== robot.root || part.id === robot.root || robot.contacts.some((contact) => contact.id === part.id)) continue;
    const box = typeOf(blueprint, part.id).body.size;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const corner = placePoint(where.placement, { x: (sx * box.x) / 2, y: (sy * box.y) / 2, z: 0 });
        if (rocked(corner.x - axle.x, corner.z - axle.z, low).up < -axle.radius) throw new Error(`The ${part.id} meets the floor before the chassis.`);
      }
    }
  }
  const edge = rocked(ex, ez, low).along;
  const centre = rocked(robot.centre.x - axle.x, robot.centre.z - axle.z, low).along;
  const rests = Math.sign(centre) === Math.sign(edge) && Math.abs(centre) <= Math.abs(edge) && Math.abs(robot.centre.y) <= size.y / 2;
  return { degrees: (low * 180) / Math.PI, edge, centre, rests };
};

/**
 * Balance: the robot rides upright while its centre of mass lies over its wheels and supports. When it does not, it
 * lands as `landingOf` says: resting on the chassis's edge (grounded) or over it (lost). A support of the build that is
 * not fixed stands for either with its own fault, as broken-loose-caster's description records; otherwise the fault
 * is the chassis's. The mechanical solver (task 1.4) decides it in a Run.
 */
const balanceFaults = (blueprint: Blueprint): string[] =>
  robotsOf(blueprint).flatMap((robot) => {
    if (upright(robot)) return [];
    const looseSupport = blueprint.parts.some(
      (part) =>
        typeOf(blueprint, part.id).behaviour.some((primitive) => primitive.kind === 'support') &&
        typeOf(blueprint, part.id).needs.some((need) => need.kind === 'mount' && !linked(blueprint, part.id, need.port, 'mount')),
    );
    if (looseSupport) return [];
    const way = landingOf(blueprint, robot).rests ? 'grounded' : 'lost';
    const mode = typeOf(blueprint, robot.root).failureModes.find((candidate) => candidate.unmet === way);
    return mode ? [`${robot.root}: ${mode.id}`] : [];
  });

/** Every fault the static judge finds at one setting of the controls, sorted. */
const judge = (blueprint: Blueprint, state: ControlState = {}): string[] =>
  [...wiringFaults(blueprint, state), ...voltageFaults(blueprint, state), ...linkFaults(blueprint), ...balanceFaults(blueprint)].sort();

/** The faults a fixture records, as the judge writes them, sorted. */
const recorded = (name: string): string[] => fixture(name).expect.faults.map(named).sort();

/** A speed actuator's `reverse` as its placed part sets it: the value of the setting bound to it (the DC motor's Direction), else the record's. */
const reverseOf = (blueprint: Blueprint, part: string, primitive: SpeedActuator): boolean => {
  const setting = typeOf(blueprint, part).settings.find((candidate) => candidate.binds.primitive === primitive.id && candidate.binds.param === 'reverse');
  if (setting?.kind !== 'choice') return primitive.reverse;
  const chosen = blueprint.parts.find((candidate) => candidate.id === part)?.settings[setting.id] ?? setting.default;
  const value = setting.options.find((option) => option.id === chosen)?.value;
  return typeof value === 'boolean' ? value : primitive.reverse;
};

/** Which way each speed actuator turns at `state`: the sign of its supply's volts, flipped when it is set to reverse. */
const turning = (blueprint: Blueprint, state: ControlState = {}): ReadonlyMap<string, number> => {
  const signs = new Map<string, number>();
  for (const { part, primitive } of primitivesOf(blueprint)) {
    if (primitive.kind !== 'actuator' || primitive.mode !== 'speed') continue;
    const need = powerNeedsOf(blueprint).find((candidate) => candidate.part === part)?.need;
    const wired = need && wiredNeeds(blueprint, catalogue, state).find((verdict) => verdict.partId === part && verdict.need === need.id);
    const volts = need && wired?.unmet === undefined ? (supplyVolts(blueprint, state, part, need) ?? 0) : 0;
    signs.set(part, Math.abs(volts) < primitive.startVolts ? 0 : Math.sign(volts) * (reverseOf(blueprint, part, primitive) ? -1 : 1));
  }
  return signs;
};

/** How the robot moves at `state`, from each drive wheel's push and its motor's turning. */
const motion = (blueprint: Blueprint, state: ControlState = {}): string => {
  const signs = turning(blueprint, state);
  const pushes = drivePushes(blueprint, catalogue).map(({ actuator, push }) => push * (signs.get(actuator) ?? 0));
  if (pushes.every((push) => push === 0)) return 'still';
  if (pushes.every((push) => push > 0)) return 'forward';
  if (pushes.some((push) => push > 0) && pushes.some((push) => push < 0)) return 'spin';
  return pushes.some((push) => push > 0) ? 'turn' : 'backward';
};

// ---------------------------------------------------------------------------------------------
// Editing a fixture, to show that each named fault goes when the build is fixed.

type Ends = readonly [from: string, to: string];

const ref = (end: string): PortRef => {
  const [part = '', port = ''] = end.split('.');
  return { part, port };
};

const sameWire = (wire: Wire, [a, b]: Ends): boolean =>
  (portKey(wire.from) === a && portKey(wire.to) === b) || (portKey(wire.from) === b && portKey(wire.to) === a);

interface Edit {
  readonly remove?: readonly Ends[];
  readonly add?: readonly Ends[];
  readonly parts?: (parts: readonly PlacedPart[]) => PlacedPart[];
}

const edited = (blueprint: Blueprint, { remove = [], add = [], parts }: Edit): Blueprint => {
  const kept = blueprint.wires.filter((wire) => !remove.some((ends) => sameWire(wire, ends)));
  expect(kept).toHaveLength(blueprint.wires.length - remove.length);
  const high = blueprint.meta.highWater.wires;
  const wires = [...kept, ...add.map(([from, to], index): Wire => ({ id: `w${high + index + 1}`, from: ref(from), to: ref(to) }))];
  const result = validateBlueprint(
    { ...blueprint, parts: parts ? parts(blueprint.parts) : blueprint.parts, wires, meta: { ...blueprint.meta, highWater: { ...blueprint.meta.highWater, wires: high + add.length } } },
    catalogue,
  );
  if (!result.ok) throw new Error(`The edit does not validate: ${result.issues.map(({ code, path }) => `${code} at ${path}`).join('; ')}`);
  return result.value;
};

const mountPointOf = (part: PartRecord, id: string): MountPointPort => {
  const port = part.ports.find((candidate) => candidate.id === id);
  if (port?.type !== 'mechanical' || port.role !== 'mount-point') throw new Error(`The ${part.identity.name} has no mount point '${id}'.`);
  return port;
};

const mountOf = (part: PartRecord): MountPort => {
  const port = part.ports.find((candidate) => candidate.type === 'mechanical' && candidate.role === 'mount');
  if (port?.type !== 'mechanical' || port.role !== 'mount') throw new Error(`The ${part.identity.name} has no mount.`);
  return port;
};

/** A part where a chassis mount point puts it, for a chassis at the canvas origin. */
const onChassis = (id: string, type: string, point: string): PlacedPart => {
  const pose = canvasPoseOf({ x: 0, y: 0, rotation: 0 }, mountPlacement(mountPointOf(record('chassis'), point), mountOf(record(type))));
  return { id, part: type, position: { x: pose.x, y: pose.y }, rotation: pose.rotation, settings: {} };
};

/** The caster where the chassis's caster mount puts it. */
const casterOnItsMount = (): PlacedPart => onChassis('caster', 'caster', 'caster');

// ---------------------------------------------------------------------------------------------

describe('task 2.6 fixtures', () => {
  it('holds eight working and eight broken fixtures and the battery what-if, each on its own blueprint, all valid against the content', () => {
    expect(load.issues.map(({ file, code, path }) => `${file} ${code} at ${path}`)).toEqual([]);
    expect([WORKING.length, BROKEN.length, WHAT_IF.length]).toEqual([8, 8, 1]);
    for (const name of TASK_FIXTURES) {
      expect(FIXTURES[name]?.blueprint).toBe(name);
      expect(fixture(name).seed).toBe(1);
    }
    expect(new Set(TASK_FIXTURES.map((name) => fixture(name).blueprint.meta.id)).size).toBe(TASK_FIXTURES.length);
  });

  it.each(TASK_FIXTURES)('%s is committed in canonical form', (name) => {
    const { blueprint } = fixture(name);
    expect(texts.get(name)).toBe(serializeBlueprint(canonicalizeBlueprint(blueprint, catalogue)));
  });

  it('builds from content part records introduced at or below each build’s level, across Levels 1 and 2', () => {
    for (const name of TASK_FIXTURES) {
      const { blueprint } = fixture(name);
      for (const part of blueprint.parts) expect(typeOf(blueprint, part.id).identity.level).toBeLessThanOrEqual(blueprint.meta.level);
    }
    const levels = (names: readonly string[]): number[] => [...new Set(names.map((name) => fixture(name).blueprint.meta.level))].sort();
    expect(levels(WORKING)).toEqual([1, 2]);
    expect(levels(BROKEN)).toEqual([1, 2]);
  });

  it('names exactly one fault in each broken fixture, or one refused drop, and none in a working one', () => {
    for (const name of BROKEN) {
      const { expect: verdict } = fixture(name);
      const one = verdict.faults.length === 1 && verdict.namedFault !== undefined && verdict.refused === undefined;
      const refusal = verdict.faults.length === 0 && verdict.namedFault === undefined && verdict.refused !== undefined;
      expect(one || refusal, name).toBe(true);
      if (one) expect(verdict.faults[0]).toEqual(verdict.namedFault);
    }
    for (const name of WORKING) expect(fixture(name).expect, name).toEqual({ faults: [] });
  });

  it('keeps the 1-cell roller as the battery what-if: both DC motors low, no named fault, so neither working nor broken', () => {
    expect(fixture('one-cell-roller').expect).toEqual({
      faults: [
        { partId: 'motor-left', failure: 'low-voltage' },
        { partId: 'motor-right', failure: 'low-voltage' },
      ],
    });
  });

  it('presses a switch only in switch-in-the-line, and gives every Run time to show its behaviour', () => {
    for (const name of TASK_FIXTURES) {
      const { inputs, ticks } = fixture(name);
      expect(inputs.length > 0, name).toBe(name === 'switch-in-the-line');
      expect(ticks).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('each fixture’s verdict, judged statically with the schema’s rules', () => {
  it.each(TASK_FIXTURES)('%s shows exactly the faults it records', (name) => {
    expect(judge(fixture(name).blueprint)).toEqual(recorded(name));
  });

  it('treats each switch press in switch-in-the-line as an input: open, the stopped parts are explained by the switch', () => {
    const { blueprint, inputs } = fixture('switch-in-the-line');
    for (const input of inputs) {
      const state: ControlState = { switches: { [controlId(input.partId, 'contacts')]: input.closed } };
      expect(judge(blueprint, state)).toEqual([]);
      expect(motion(blueprint, state)).toBe(input.closed ? 'forward' : 'still');
    }
    const opened = wiredNeeds(blueprint, catalogue, { switches: { 'switch/contacts': false } });
    expect(opened.filter((verdict) => verdict.explainedBy?.by === 'controls').map((verdict) => verdict.partId)).toEqual(['battery', 'motor-left', 'motor-right']);
  });

  it('stops the bumper robot with no fault: pressed against the wall, its bumper switch is a control', () => {
    const { blueprint } = fixture('bumper-stops-at-wall');
    const pressed: ControlState = { switches: { 'bumper/contacts': false } };
    expect(judge(blueprint, pressed)).toEqual([]);
    expect([motion(blueprint), motion(blueprint, pressed)]).toEqual(['forward', 'still']);
    const verdicts = wiredNeeds(blueprint, catalogue, pressed).filter((verdict) => verdict.unmet !== undefined);
    expect(verdicts.every((verdict) => verdict.explainedBy?.by === 'controls')).toBe(true);
  });

  it('turns the bench motor that busy-workbench’s driver runs backward by that channel’s setting, never as a fault', () => {
    const { blueprint } = fixture('busy-workbench');
    const need = powerNeedsOf(blueprint).find((candidate) => candidate.part === 'bench-motor-b')?.need;
    if (!need) throw new Error('No bench motor b.');
    expect(voltageWay(supplyVolts(blueprint, {}, 'bench-motor-b', need) ?? 0, need)).toBe('reversed');
    expect(explainByControls(controlsOf(blueprint, catalogue), {}, (then) => powerMet(blueprint, then, 'bench-motor-b', need))).toEqual([
      'bench-driver/channel-b',
    ]);
  });
});

describe('each broken fixture’s named fault reproduces, and fixing the build clears it', () => {
  it('broken-reversed-motor: the right DC motor turns backwards, which no control fixes, so the robot spins on the spot (D23)', () => {
    const { blueprint } = fixture('broken-reversed-motor');
    const need = powerNeedsOf(blueprint).find((candidate) => candidate.part === 'motor-right')?.need;
    if (!need) throw new Error('No right motor.');
    expect(wiringFaults(blueprint, {})).toEqual([]);
    expect(voltageWay(supplyVolts(blueprint, {}, 'motor-right', need) ?? 0, need)).toBe('reversed');
    expect(explainByControls(controlsOf(blueprint, catalogue), {}, (then) => powerMet(blueprint, then, 'motor-right', need))).toBeUndefined();
    expect(judge(blueprint)).toEqual(['motor-right: reversed']);
    expect(motion(blueprint)).toBe('spin');
    const fixed = edited(blueprint, {
      remove: [
        ['switch.b', 'motor-right.minus'],
        ['battery.minus', 'motor-right.plus'],
      ],
      add: [
        ['switch.b', 'motor-right.plus'],
        ['battery.minus', 'motor-right.minus'],
      ],
    });
    expect([judge(fixed), motion(fixed)]).toEqual([[], 'forward']);
  });

  it('broken-missing-return-wire: the left DC motor has no complete circuit, so only the right wheel drives', () => {
    const { blueprint } = fixture('broken-missing-return-wire');
    const verdict = wiredNeeds(blueprint, catalogue).find((candidate) => candidate.partId === 'motor-left' && candidate.need === 'power');
    expect(verdict).toMatchObject({ unmet: 'open' });
    expect(verdict?.explainedBy).toBeUndefined();
    expect(judge(blueprint)).toEqual(['motor-left: no-circuit']);
    expect(motion(blueprint)).toBe('turn');
    const fixed = edited(blueprint, { add: [['battery.minus', 'motor-left.minus']] });
    expect([judge(fixed), motion(fixed)]).toEqual([[], 'forward']);
  });

  it('broken-servo-without-signal: two 2-cell battery packs in series leave only the signal missing (D50)', () => {
    const { blueprint } = fixture('broken-servo-without-signal');
    const need = powerNeedsOf(blueprint).find((candidate) => candidate.part === 'servo')?.need;
    if (!need) throw new Error('No servo motor.');
    expect(wiringFaults(blueprint, {})).toEqual([]);
    expect(supplyVolts(blueprint, {}, 'servo', need)).toBe(6);
    expect(voltageWay(6, need)).toBeUndefined();
    expect(linkFaults(blueprint)).toEqual(['servo: no-signal']);
    expect(judge(blueprint)).toEqual(['servo: no-signal']);
    // No Level 1–2 part gives a signal, so the servo motor's own fault stands at Level 2 (D41).
    const signalOuts = [...catalogue.parts.values()].flatMap((part) => part.ports.filter((port) => port.type === 'signal' && port.direction === 'out'));
    expect(signalOuts).toEqual([]);
    // On one pack the servo motor would be low as well: the second pack is what leaves the signal alone missing.
    const onePack = edited(blueprint, {
      remove: [
        ['battery-1.plus', 'battery-2.minus'],
        ['battery-2.plus', 'servo.plus'],
      ],
      add: [['battery-1.plus', 'servo.plus']],
      parts: (parts) => parts.filter((part) => part.id !== 'battery-2'),
    });
    expect(judge(onePack)).toEqual(['servo: low-voltage', 'servo: no-signal']);
  });

  it('broken-underpowered-pack: the 1-cell battery pack leaves the motor driver low, and the driver stands for its motors', () => {
    const { blueprint } = fixture('broken-underpowered-pack');
    const driverNeed = powerNeedsOf(blueprint).find((candidate) => candidate.part === 'driver')?.need;
    if (!driverNeed) throw new Error('No motor driver.');
    expect(wiringFaults(blueprint, {})).toEqual([]);
    expect(supplyVolts(blueprint, {}, 'driver', driverNeed)).toBe(1.5);
    expect(voltageWay(1.5, driverNeed)).toBe('low');
    expect(explainByControls(controlsOf(blueprint, catalogue), {}, (then) => powerMet(blueprint, then, 'driver', driverNeed))).toBeUndefined();
    for (const motor of ['motor-left', 'motor-right']) {
      const need = powerNeedsOf(blueprint).find((candidate) => candidate.part === motor)?.need;
      if (!need) throw new Error(`No ${motor}.`);
      expect(supplyVolts(blueprint, {}, motor, need)).toBe(0);
      expect(feederOf(blueprint, {}, motor, need)).toBe('driver');
    }
    expect(judge(blueprint)).toEqual(['driver: low-voltage']);
    expect(motion(blueprint)).toBe('still');
    const fixed = edited(blueprint, { parts: (parts) => parts.map((part) => (part.id === 'battery' ? { ...part, part: 'battery-pack-2-cell' } : part)) });
    expect([judge(fixed), motion(fixed)]).toEqual([[], 'forward']);
  });

  it('broken-chassis-on-the-floor: with no caster it rocks back onto the chassis’s rear edge and rests there, so it scrapes', () => {
    const { blueprint } = fixture('broken-chassis-on-the-floor');
    const [robot] = robotsOf(blueprint);
    if (!robot) throw new Error('No robot.');
    expect(robot.contacts.map((contact) => contact.id)).toEqual(['wheel-left', 'wheel-right']);
    expect(upright(robot)).toBe(false);
    // By hand. The axle is 40 mm ahead of the chassis's centre and 16 mm above its underside, on large wheels of radius
    // 32.5 mm. The underside's rear edge, 120 mm behind the axle and 16 mm below it, meets the floor once the robot has
    // rocked back by t with 120·sin t + 16·cos t = 32.5: t = asin(32.5 / √(120² + 16²)) − atan(16 / 120) = 7.98°.
    const [behind, below, radius] = [120, 16, 32.5];
    const t = Math.asin(radius / Math.hypot(behind, below)) - Math.atan2(below, behind);
    // The edge lands 120·cos t − 16·sin t behind the wheels' contact. The centre of mass, dx behind the axle and dz below
    // it, lands dx·cos t − dz·sin t behind it: inside the edge, so the robot rests on it and drags.
    const edge = behind * Math.cos(t) - below * Math.sin(t);
    const [dx, dz] = [40 - robot.centre.x, 16 - robot.centre.z];
    const centre = dx * Math.cos(t) - dz * Math.sin(t);
    expect([(t * 180) / Math.PI, edge, dx, dz, centre, edge - centre].map((value) => Number(value.toFixed(1)))).toEqual([8, 116.6, 32.6, 4.1, 31.8, 84.9]);
    const landing = landingOf(blueprint, robot);
    expect(landing.rests).toBe(true);
    expect([landing.degrees, landing.edge, landing.centre].map((value) => Number(value.toFixed(6)))).toEqual(
      [(t * 180) / Math.PI, -edge, -centre].map((value) => Number(value.toFixed(6))),
    );
    expect([...wiringFaults(blueprint, {}), ...voltageFaults(blueprint, {}), ...linkFaults(blueprint)]).toEqual([]);
    expect(judge(blueprint)).toEqual(['chassis: scraping']);
    const fixed = edited(blueprint, { add: [['caster.mount', 'chassis.caster']], parts: (parts) => [...parts, casterOnItsMount()] });
    const [steady] = robotsOf(fixed);
    expect(steady && upright(steady)).toBe(true);
    expect([judge(fixed), motion(fixed)]).toEqual([[], 'forward']);
  });

  it('no Level 1–2 load tips this chassis, on the floor or on any slope a robot could drive, so no fixture shows top-heavy (D49)', () => {
    // A search of every Level 1–2 part, or none, on every free mount point, with either drive, either wheel size and the
    // caster on or off (2,152,008 builds), found none that tips on the floor: without the caster each lands at least
    // 76 mm inside the rear edge, and with it none leaves its base. The most front-heavy is this one: both 2-cell
    // battery packs forward, on the front deck and the bumper mount, with gearboxes.
    const heavy = edited(fixture('broken-chassis-on-the-floor').blueprint, {
      remove: [
        ['battery.mount', 'chassis.deck-rear'],
        ['switch.mount', 'chassis.deck-front'],
        ['battery.plus', 'switch.a'],
        ['switch.b', 'motor-left.plus'],
        ['switch.b', 'motor-right.plus'],
      ],
      add: [
        ['battery.mount', 'chassis.bumper'],
        ['battery-2.mount', 'chassis.deck-front'],
        ['battery.plus', 'motor-left.plus'],
        ['battery.plus', 'motor-right.plus'],
        ['battery-2.plus', 'battery.plus'],
        ['battery-2.minus', 'battery.minus'],
        ['caster.mount', 'chassis.caster'],
      ],
      parts: (parts) => [
        ...parts.filter((part) => part.id !== 'switch').map((part) => (part.id === 'battery' ? onChassis('battery', part.part, 'bumper') : part)),
        onChassis('battery-2', 'battery-pack-2-cell', 'deck-front'),
        casterOnItsMount(),
      ],
    });
    expect([judge(heavy), motion(heavy)]).toEqual([[], 'forward']);
    const [robot] = robotsOf(heavy);
    if (!robot) throw new Error('No robot.');
    // Its centre of mass, x mm ahead of the chassis's centre, still sits behind the axle at 40, so on the floor nothing
    // ever pitches it onto its nose. Facing downhill at a, it pitches onto its nose once the slope carries its centre of
    // mass past the axle: a = atan((40 − x) / h), h its height above the floor. Nose down, it lands on the chassis's front
    // edge (40 mm ahead of the axle, 16 mm below it) once 40·sin u + 16·cos u = 32.5. There it rests until the slope
    // carries its centre of mass past that edge. (The overhanging pack meets the floor first, which only makes the tip
    // later.) The steepest slope any preset has is the ramp's 1 in 7.
    const [ahead, under, radius] = [40, 16, 32.5];
    const nose = Math.atan2(40 - robot.centre.x, robot.centre.z - (under - radius));
    const u = Math.asin(radius / Math.hypot(ahead, under)) - Math.atan2(under, ahead);
    const [dx, dz] = [robot.centre.x - 40, robot.centre.z - 16];
    const along = dx * Math.cos(u) + dz * Math.sin(u);
    const height = dz * Math.cos(u) - dx * Math.sin(u) + radius;
    const edge = ahead * Math.cos(u) - under * Math.sin(u);
    const tip = Math.atan2(edge - along, height);
    const degrees = (angle: number): number => Number(((angle * 180) / Math.PI).toFixed(1));
    expect([Number(robot.centre.x.toFixed(1)), degrees(nose), degrees(u), degrees(tip)]).toEqual([30.9, 18, 27.2, 49.7]);
    const ramp = loadArenas().find((arena) => arena.id === 'ramp');
    const slopes = (ramp?.ramps ?? []).map((slope) => degrees(Math.atan2(slope.riseMm, slope.to.x - slope.from.x)));
    expect(slopes).toEqual([8.1, 4.1]);
  });

  it('broken-short-circuit: the wire across the battery pack is its fault, and the parts it starves are explained by it', () => {
    const { blueprint } = fixture('broken-short-circuit');
    const verdicts = wiredNeeds(blueprint, catalogue).filter((verdict) => verdict.unmet !== undefined);
    expect(verdicts.filter((verdict) => verdict.explainedBy === undefined).map((verdict) => `${verdict.partId} ${verdict.need} ${verdict.unmet}`)).toEqual([
      'battery no-short shorted',
    ]);
    expect(
      verdicts.filter((verdict) => verdict.explainedBy !== undefined).map((verdict) => `${verdict.partId} ${JSON.stringify(verdict.explainedBy)}`),
    ).toEqual([
      'motor-left {"by":"short","parts":["battery"]}',
      'motor-right {"by":"short","parts":["battery"]}',
      'switch {"by":"short","parts":["battery"]}',
    ]);
    expect(judge(blueprint)).toEqual(['battery: short-circuit']);
    expect(motion(blueprint)).toBe('still');
    const fixed = edited(blueprint, { remove: [['battery.minus', 'battery.plus']] });
    expect([judge(fixed), motion(fixed)]).toEqual([[], 'forward']);
  });

  it('broken-wrong-type-wire: a power line on a signal in is refused at the socket, while the build before it works', () => {
    const fixtureRun = fixture('broken-wrong-type-wire');
    const { blueprint } = fixtureRun;
    const refused = fixtureRun.expect.refused;
    if (!refused) throw new Error('No refused drop.');
    const plan = planWire(blueprint, catalogue, refused.from, refused.to);
    expect(plan).toMatchObject({ legal: false, code: 'wire.type_mismatch' });
    const parts = indexPlacedParts(blueprint.parts);
    const [from, to] = [resolvePort(parts, catalogue, refused.from), resolvePort(parts, catalogue, refused.to)];
    if (!from.found || !to.found) throw new Error('The refused drop names a port the build lacks.');
    expect([from.spec.type, to.spec.type]).toEqual(['power', 'signal']);
    expect(checkPortPair(from.spec, to.spec)).toMatchObject({ legal: false, code: 'wire.type_mismatch' });
    // The same red line on a red port lands: legal, even where it is wrong.
    expect(planWire(blueprint, catalogue, refused.from, { part: 'motor', port: 'minus' })).toMatchObject({ legal: true, kind: 'power' });
    expect(judge(blueprint)).toEqual([]);
  });

  it('broken-loose-caster: the caster is fixed to nothing, so the chassis rests on its rear edge, and the caster holds the one fault', () => {
    const { blueprint } = fixture('broken-loose-caster');
    expect(linked(blueprint, 'caster', 'mount', 'mount')).toBe(false);
    expect(placeParts(blueprint, catalogue).get('caster')?.by).toBe('root');
    const [robot] = robotsOf(blueprint);
    if (!robot) throw new Error('No robot.');
    expect(robot.contacts.map((contact) => contact.id)).toEqual(['wheel-left', 'wheel-right']);
    expect(upright(robot)).toBe(false);
    // Grounded, as broken-chassis-on-the-floor is; the fixture's description gives that to the caster's own `loose`.
    expect(landingOf(blueprint, robot).rests).toBe(true);
    expect(judge(blueprint)).toEqual(['caster: loose']);
    const fixed = edited(blueprint, {
      add: [['caster.mount', 'chassis.caster']],
      parts: (parts) => parts.map((part) => (part.id === 'caster' ? casterOnItsMount() : part)),
    });
    expect([judge(fixed), motion(fixed)]).toEqual([[], 'forward']);
  });
});

describe('motion and balance', () => {
  it.each([
    ['level-1-roller', 'forward'],
    ['switch-in-the-line', 'forward'],
    ['small-wheel-roller', 'forward'],
    ['motor-driver-robot', 'forward'],
    ['bumper-stops-at-wall', 'forward'],
    ['led-and-buzzer-robot', 'forward'],
    ['geared-robot', 'forward'],
    ['busy-workbench', 'forward'],
    ['broken-reversed-motor', 'spin'],
    ['broken-missing-return-wire', 'turn'],
    ['broken-underpowered-pack', 'still'],
    ['broken-chassis-on-the-floor', 'forward'],
    ['broken-short-circuit', 'still'],
    ['broken-loose-caster', 'forward'],
    ['one-cell-roller', 'forward'],
  ])('%s moves %s at rest', (name, expected) => {
    expect(motion(fixture(name).blueprint)).toBe(expected);
  });

  it('follows the DC motor’s Direction setting: backward turns a motor round with no fault, and cannot hide a wiring fault (D48)', () => {
    const backward = (blueprint: Blueprint): Blueprint =>
      edited(blueprint, { parts: (parts) => parts.map((part) => (part.id === 'motor-right' ? { ...part, settings: { direction: 'backward' } } : part)) });
    const roller = backward(fixture('small-wheel-roller').blueprint);
    expect([judge(roller), motion(roller)]).toEqual([[], 'spin']);
    const breakdown = backward(fixture('broken-reversed-motor').blueprint);
    expect([judge(breakdown), motion(breakdown)]).toEqual([['motor-right: reversed'], 'forward']);
  });

  it('rests every robot with a fixed caster on its wheels and caster, upright and with its chassis clear of the floor', () => {
    for (const name of TASK_FIXTURES) {
      const { blueprint } = fixture(name);
      for (const robot of robotsOf(blueprint).filter((candidate) => candidate.contacts.length === 3)) {
        expect(upright(robot), name).toBe(true);
        expect(clearance(blueprint, robot), name).toBeGreaterThan(2);
      }
    }
  });

  it('tilts the small-wheel roller nose down onto its caster, clear of the floor, where large wheels keep it level', () => {
    const [tilted] = robotsOf(fixture('small-wheel-roller').blueprint);
    const [level] = robotsOf(fixture('level-1-roller').blueprint);
    if (!tilted || !level) throw new Error('No robot.');
    const [tiltedFloor, levelFloor] = [floorOf(tilted), floorOf(level)];
    if (!tiltedFloor || !levelFloor) throw new Error('No robot on three wheels and supports.');
    expect(Math.abs(levelFloor.up.x) + Math.abs(levelFloor.up.y)).toBe(0);
    // The floor's normal leans back in the robot's frame: the chassis's front is nearer the floor than its rear.
    expect(tiltedFloor.up.x).toBeLessThan(0);
    expect(clearance(fixture('small-wheel-roller').blueprint, tilted)).toBeGreaterThan(4);
    expect(clearance(fixture('level-1-roller').blueprint, level)).toBe(16.5);
  });

  it('starts every loose part on the arena floor, clear of the path its robot drives (D19)', () => {
    const arenas = new Map(loadArenas().map((arena) => [arena.id, arena]));
    for (const name of TASK_FIXTURES) {
      const { blueprint } = fixture(name);
      const arena = arenas.get(blueprint.arena.preset);
      if (!arena) throw new Error(`No arena '${blueprint.arena.preset}'.`);
      const placements = placeParts(blueprint, catalogue);
      const root = robotRoot(placements);
      const poseOf = (part: PlacedPart): CanvasPose => ({ x: part.position.x, y: part.position.y, rotation: part.rotation });
      const rootPart = blueprint.parts.find((part) => part.id === root);
      const rootPose: CanvasPose = rootPart ? poseOf(rootPart) : { x: 0, y: 0, rotation: 0 };
      const robotParts = blueprint.parts.filter((part) => root !== undefined && placements.get(part.id)?.root === root);
      // The robot's reach to either side, and back, in its own frame.
      const reach = robotParts.flatMap((part) => {
        const where = placements.get(part.id);
        const { size } = typeOf(blueprint, part.id).body;
        if (!where) return [];
        return [-1, 1].flatMap((sx) => [-1, 1].map((sy) => placePoint(where.placement, { x: (sx * size.x) / 2, y: (sy * size.y) / 2, z: 0 })));
      });
      const side = Math.max(0, ...reach.map((corner) => Math.abs(corner.y)));
      const back = Math.min(0, ...reach.map((corner) => corner.x));
      for (const part of blueprint.parts.filter((candidate) => !robotParts.includes(candidate))) {
        const at = arenaPoseOf(arena.start, rootPose, poseOf(part));
        const { size } = typeOf(blueprint, part.id).body;
        const radius = Math.max(size.x, size.y) / 2;
        expect(at.x - radius >= 0 && at.x + radius <= arena.size.x && at.y - radius >= 0 && at.y + radius <= arena.size.y, `${name} ${part.id}`).toBe(true);
        if (root === undefined) continue;
        const behind = at.x + radius < arena.start.x + back;
        const beside = Math.abs(at.y - arena.start.y) - radius > side;
        expect(behind || beside, `${name} ${part.id}`).toBe(true);
      }
    }
  });
});

describe('the 25-part build for canvas performance (D51)', () => {
  it('fills every chassis mount point direct drive leaves free and puts the rest on the bench, since the chassis holds no more', () => {
    const { blueprint } = fixture('busy-workbench');
    expect(blueprint.parts).toHaveLength(25);
    const placements = placeParts(blueprint, catalogue);
    const onRobot = blueprint.parts.filter((part) => placements.get(part.id)?.root === 'chassis');
    expect([onRobot.length, blueprint.parts.length - onRobot.length]).toEqual([12, 13]);
    const points = record('chassis')
      .ports.filter((port) => port.type === 'mechanical' && port.role === 'mount-point')
      .map((port) => port.id);
    const used = new Set(blueprint.wires.filter((wire) => wire.to.part === 'chassis').map((wire) => wire.to.port));
    expect(points.filter((point) => !used.has(point))).toEqual(['gear-left', 'gear-right']);
    // Both free mount points lie under the outer DC motors' bodies, so nothing else can be fixed there.
    for (const [point, motor] of [
      ['gear-left', 'motor-left'],
      ['gear-right', 'motor-right'],
    ] as const) {
      const where = placements.get(motor)?.placement;
      if (!where) throw new Error(`No ${motor}.`);
      const { size } = record('dc-motor').body;
      const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => placePoint(where, { x: (sx * size.x) / 2, y: (sy * size.y) / 2, z: 0 })));
      const { at } = mountPointOf(record('chassis'), point);
      expect(at.x).toBeGreaterThan(Math.min(...corners.map((corner) => corner.x)));
      expect(at.x).toBeLessThan(Math.max(...corners.map((corner) => corner.x)));
      expect(at.y).toBeGreaterThan(Math.min(...corners.map((corner) => corner.y)));
      expect(at.y).toBeLessThan(Math.max(...corners.map((corner) => corner.y)));
    }
  });
});

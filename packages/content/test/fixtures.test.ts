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
  Vec2,
  Wire,
} from '@servo/schema';
import { FIXTURES, loadFixtures } from '../src/fixtures.ts';
import type { ContentFixture, FaultExpectation } from '../src/fixtures.ts';
import { loadArenas, loadCatalogue } from '../src/index.ts';

// Task 2.6: eight working and eight broken fixture blueprints for the simulation and canvas teams. sim-core's tick
// loop (task 1.5) is not here yet, so this file reproduces each verdict statically with the schema's own rules:
// - the wiring: `wiredNeeds` decides power and loop `open` and isolation `shorted`, and says what explains each;
// - the voltages: nominal volts (batteries at full charge, no sag), judged for `low`, `high` and `reversed` and
//   explained in the schema's order with `explainByControls`, then by an unpowered motor driver feeding the part;
// - the links: signal, mount and drive needs from the wires; balance from the centre of mass against the supports.
// The load torque and the floor (stall, slip, lifted) are left to the mechanical solver (task 1.4), and the
// golden-run harness (task 1.7) replays every fixture in sim-core against its recorded verdict.

const WORKING = [
  'level-1-roller',
  'switch-in-the-line',
  'one-cell-roller',
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
  'broken-top-heavy-chassis',
  'broken-short-circuit',
  'broken-wrong-type-wire',
  'broken-loose-caster',
] as const;

const TASK_FIXTURES: readonly string[] = [...WORKING, ...BROKEN];

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

const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The convex hull of points on the floor, anticlockwise (Andrew's monotone chain). */
const hull = (points: readonly Vec2[]): Vec2[] => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const half = (list: readonly Vec2[]): Vec2[] => {
    const chain: Vec2[] = [];
    for (const point of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2] as Vec2, chain[chain.length - 1] as Vec2, point) <= 0) chain.pop();
      chain.push(point);
    }
    return chain.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.toReversed())];
};

/** Whether a point lies over the polygon the supports make (a segment for two, a point for one), edges included. */
const over = (supports: readonly Vec2[], point: Vec2): boolean => {
  const polygon = hull(supports);
  if (polygon.length === 0) return false;
  if (polygon.length === 1) return polygon[0]?.x === point.x && polygon[0]?.y === point.y;
  if (polygon.length === 2) {
    const [a, b] = polygon as [Vec2, Vec2];
    const within = (point.x - a.x) * (point.x - b.x) + (point.y - a.y) * (point.y - b.y) <= 0;
    return Math.abs(cross(a, b, point)) < 1e-9 && within;
  }
  return polygon.every((corner, index) => cross(corner, polygon[(index + 1) % polygon.length] as Vec2, point) >= -1e-9);
};

/**
 * Balance: the robot rides upright while its centre of mass lies over the polygon its wheels and supports make.
 * When it does not, a support of the build that is not fixed (a loose caster) stands for it with its own fault, as
 * an unpowered motor driver stands for its motors; otherwise the chassis is top-heavy (balance · lost). This is the
 * reading these fixtures take for task 1.4 (see the report on D49).
 */
const balanceFaults = (blueprint: Blueprint): string[] =>
  robotsOf(blueprint).flatMap((robot) => {
    if (new Set(robot.contacts.map((contact) => contact.z)).size > 1) throw new Error(`The ${robot.root}'s wheels and supports do not share one floor.`);
    if (over(robot.contacts, robot.centre)) return [];
    const looseSupport = blueprint.parts.some(
      (part) =>
        typeOf(blueprint, part.id).behaviour.some((primitive) => primitive.kind === 'support') &&
        typeOf(blueprint, part.id).needs.some((need) => need.kind === 'mount' && !linked(blueprint, part.id, need.port, 'mount')),
    );
    if (looseSupport) return [];
    const mode = typeOf(blueprint, robot.root).failureModes.find((candidate) => candidate.unmet === 'lost');
    return mode ? [`${robot.root}: ${mode.id}`] : [];
  });

/** Every fault the static judge finds at one setting of the controls, sorted. */
const judge = (blueprint: Blueprint, state: ControlState = {}): string[] =>
  [...wiringFaults(blueprint, state), ...voltageFaults(blueprint, state), ...linkFaults(blueprint), ...balanceFaults(blueprint)].sort();

/** The faults a fixture records, as the judge writes them, sorted. */
const recorded = (name: string): string[] => fixture(name).expect.faults.map(named).sort();

/** Which way each speed actuator turns at `state`: the sign of its supply's volts, flipped by its reverse setting. */
const turning = (blueprint: Blueprint, state: ControlState = {}): ReadonlyMap<string, number> => {
  const signs = new Map<string, number>();
  for (const { part, primitive } of primitivesOf(blueprint)) {
    if (primitive.kind !== 'actuator' || primitive.mode !== 'speed') continue;
    const need = powerNeedsOf(blueprint).find((candidate) => candidate.part === part)?.need;
    const wired = need && wiredNeeds(blueprint, catalogue, state).find((verdict) => verdict.partId === part && verdict.need === need.id);
    const volts = need && wired?.unmet === undefined ? (supplyVolts(blueprint, state, part, need) ?? 0) : 0;
    signs.set(part, Math.abs(volts) < primitive.startVolts ? 0 : Math.sign(volts) * (primitive.reverse ? -1 : 1));
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

/** The caster where the chassis's caster mount puts it, for a chassis at the canvas origin. */
const casterOnItsMount = (): PlacedPart => {
  const pose = canvasPoseOf({ x: 0, y: 0, rotation: 0 }, mountPlacement(mountPointOf(record('chassis'), 'caster'), mountOf(record('caster'))));
  return { id: 'caster', part: 'caster', position: { x: pose.x, y: pose.y }, rotation: pose.rotation, settings: {} };
};

// ---------------------------------------------------------------------------------------------

describe('task 2.6 fixtures', () => {
  it('holds eight working and eight broken fixtures, each on its own blueprint, all valid against the content', () => {
    expect(load.issues.map(({ file, code, path }) => `${file} ${code} at ${path}`)).toEqual([]);
    for (const name of TASK_FIXTURES) {
      expect(FIXTURES[name]?.blueprint).toBe(name);
      expect(fixture(name).seed).toBe(1);
    }
    expect(new Set(TASK_FIXTURES.map((name) => fixture(name).blueprint.meta.id)).size).toBe(16);
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

  it('names exactly one fault in each broken fixture, or one refused drop, and none in a working one but the 1-cell what-if', () => {
    for (const name of BROKEN) {
      const { expect: verdict } = fixture(name);
      const one = verdict.faults.length === 1 && verdict.namedFault !== undefined && verdict.refused === undefined;
      const refusal = verdict.faults.length === 0 && verdict.namedFault === undefined && verdict.refused !== undefined;
      expect(one || refusal, name).toBe(true);
      if (one) expect(verdict.faults[0]).toEqual(verdict.namedFault);
    }
    for (const name of WORKING) {
      const { expect: verdict } = fixture(name);
      expect([verdict.namedFault, verdict.refused, verdict.goal]).toEqual([undefined, undefined, undefined]);
      expect(verdict.faults.length === 0 || name === 'one-cell-roller', name).toBe(true);
    }
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

  it('broken-top-heavy-chassis: with no caster, the centre of mass sits behind the axle, off the supports (D49)', () => {
    const { blueprint } = fixture('broken-top-heavy-chassis');
    const [robot] = robotsOf(blueprint);
    if (!robot) throw new Error('No robot.');
    expect(robot.contacts.map((contact) => contact.id)).toEqual(['wheel-left', 'wheel-right']);
    const axle = robot.contacts[0]?.x ?? 0;
    expect(robot.centre.x).toBeLessThan(axle);
    expect(over(robot.contacts, robot.centre)).toBe(false);
    expect([...wiringFaults(blueprint, {}), ...voltageFaults(blueprint, {}), ...linkFaults(blueprint)]).toEqual([]);
    expect(judge(blueprint)).toEqual(['chassis: top-heavy']);
    const fixed = edited(blueprint, { add: [['caster.mount', 'chassis.caster']], parts: (parts) => [...parts, casterOnItsMount()] });
    const [steady] = robotsOf(fixed);
    expect(steady && over(steady.contacts, steady.centre)).toBe(true);
    expect([judge(fixed), motion(fixed)]).toEqual([[], 'forward']);
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

  it('broken-loose-caster: the caster is fixed to nothing, so it holds up no end of the chassis', () => {
    const { blueprint } = fixture('broken-loose-caster');
    expect(linked(blueprint, 'caster', 'mount', 'mount')).toBe(false);
    expect(placeParts(blueprint, catalogue).get('caster')?.by).toBe('root');
    const [robot] = robotsOf(blueprint);
    if (!robot) throw new Error('No robot.');
    expect(robot.contacts.map((contact) => contact.id)).toEqual(['wheel-left', 'wheel-right']);
    expect(over(robot.contacts, robot.centre)).toBe(false);
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
    ['one-cell-roller', 'forward'],
    ['motor-driver-robot', 'forward'],
    ['bumper-stops-at-wall', 'forward'],
    ['led-and-buzzer-robot', 'forward'],
    ['geared-robot', 'forward'],
    ['busy-workbench', 'forward'],
    ['broken-reversed-motor', 'spin'],
    ['broken-missing-return-wire', 'turn'],
    ['broken-underpowered-pack', 'still'],
    ['broken-top-heavy-chassis', 'forward'],
    ['broken-short-circuit', 'still'],
    ['broken-loose-caster', 'forward'],
  ])('%s moves %s at rest', (name, expected) => {
    expect(motion(fixture(name).blueprint)).toBe(expected);
  });

  it('stands every robot with a fixed caster level on its wheels and caster, its centre of mass over them', () => {
    for (const name of TASK_FIXTURES) {
      for (const robot of robotsOf(fixture(name).blueprint)) {
        expect(new Set(robot.contacts.map((contact) => contact.z)).size, name).toBe(1);
        if (robot.contacts.length === 3) expect(over(robot.contacts, robot.centre), name).toBe(true);
      }
    }
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

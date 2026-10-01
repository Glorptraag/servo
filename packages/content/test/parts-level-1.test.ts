/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import {
  SPEC_CARD_LAYERS,
  canvasPoseOf,
  carriedPlacement,
  cosSin,
  drivePushes,
  makeCatalogue,
  mountPlacement,
  placeParts,
  placePoint,
  robotRoot,
  validateArenaPreset,
  validateBlueprint,
  validatePartRecord,
  wiredNeeds,
} from '@servo/schema';
import type {
  ArenaPreset,
  Blueprint,
  CanvasPose,
  ControlState,
  DrivePort,
  MountPointPort,
  MountPort,
  PartRecord,
  PlacedPart,
  Primitive,
  Ramp,
  RatioPrimitive,
  SourcePrimitive,
  SpecCardLayer,
  SpeedActuator,
  SupportPrimitive,
  ValidationResult,
  WheelPrimitive,
} from '@servo/schema';
import { exampleParts } from '@servo/schema/fixtures';

// Every record in packages/content/parts/level-1/, read as text and parsed here, with no loader in between.
const files = Object.entries(
  import.meta.glob<string>('../parts/level-1/*.json', { query: '?raw', import: 'default', eager: true }),
).map(([path, text]) => ({ file: path.slice(path.lastIndexOf('/') + 1), text }));

// The Level 1 roster. The LED (D47), 1-cell pack, small wheel, bumper switch, gearbox, motor driver, buzzer and servo
// are Level 2 parts, in parts/level-2/.
const ROSTER = ['battery-pack-2-cell', 'caster', 'chassis', 'dc-motor', 'switch', 'wheel-large'];

const valid = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`${what} does not validate: ${result.issues.map(({ code, path }) => `${code} at ${path}`).join('; ')}`);
  return result.value;
};

const records: readonly PartRecord[] = files.flatMap(({ text }) => {
  const result = validatePartRecord(JSON.parse(text));
  return result.ok ? [result.value] : [];
});

// Task 2.4's arena presets, which the reference robot runs in and the tuning estimates measure.
const arenas: readonly ArenaPreset[] = Object.entries(
  import.meta.glob<string>('../arenas/*.json', { query: '?raw', import: 'default', eager: true }),
).map(([path, text]) => valid(validateArenaPreset(JSON.parse(text)), path));

const arena = (id: string): ArenaPreset => {
  const found = arenas.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`packages/content/arenas/${id}.json is missing.`);
  return found;
};

const catalogue = makeCatalogue({ parts: records, arenas });

const record = (id: string): PartRecord => {
  const found = records.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No valid Level 1 record '${id}'; the validation test lists why.`);
  return found;
};

describe('Level 1 part record files', () => {
  it('hold the Level 1 roster, one record per file', () => {
    expect(files.map(({ file }) => file).sort()).toEqual(ROSTER.map((id) => `${id}.json`));
  });

  it.each(files)('$file validates as a part record', ({ text }) => {
    const result = validatePartRecord(JSON.parse(text));
    expect(result.ok ? [] : result.issues.map(({ code, path, message }) => `${code} at ${path}: ${message}`)).toEqual([]);
  });

  it.each(files)('$file is named after its id, introduced at Level 1 and keyed for art by its id', ({ file, text }) => {
    const part = valid(validatePartRecord(JSON.parse(text)), file);
    expect(`${part.id}.json`).toBe(file);
    expect(part.identity.level).toBe(1);
    expect(part.identity.art).toBe(`part/${part.id}`);
  });
});

/** The authored text behind each spec-card layer that has a level of its own. */
const LAYER_TEXT: Partial<Record<SpecCardLayer, (part: PartRecord) => readonly string[]>> = {
  name: (part) => [part.identity.name],
  picture: (part) => [part.identity.art],
  does: (part) => [part.card.does],
  'needs-gives': (part) => [part.card.needs, part.card.gives],
  'popular-mechanics': (part) => [part.card.popularMechanics],
};

const LAUNCH_LAYERS = SPEC_CARD_LAYERS.flatMap(({ layer, from }) => (typeof from === 'number' && from <= 2 ? [layer] : []));

const systemText = (part: PartRecord): string[] => [
  part.identity.name,
  ...part.ports.map((port) => port.label),
  ...part.settings.flatMap((setting) => [setting.label, ...(setting.kind === 'choice' ? setting.options.map((option) => option.label) : [])]),
  ...part.failureModes.flatMap((mode) => [mode.teachingNote, mode.cardLine, ...(mode.hint === undefined ? [] : [mode.hint])]),
  ...[part.card.does, part.card.needs, part.card.gives, part.card.popularMechanics, part.card.specLine, part.card.safetyNote].filter(
    (text): text is string => text !== undefined,
  ),
];

/** Whether a hint names the part (the last word of its name) or one of its ports (its label before any mark or note). */
const namesPartOrPort = (part: PartRecord, hint: string): boolean => {
  const names = [part.identity.name.split(' ').at(-1), ...part.ports.map((port) => port.label.replace(/ \(.*$/, '').replace(/,.*$/, ''))];
  return names.some((name) => name !== undefined && new RegExp(`\\b${name}\\b`, 'i').test(hint));
};

describe.each(ROSTER)('%s', (id) => {
  it('has at least two failure modes, each with a teaching note, a card line and a hint', () => {
    const { failureModes } = record(id);
    expect(failureModes.length).toBeGreaterThanOrEqual(2);
    for (const mode of failureModes) {
      expect(mode.teachingNote.length).toBeGreaterThan(0);
      // The brief's card-line form: the condition, then what the child sees. `No signal: the arm stays where it is and hums.`
      expect(mode.cardLine).toMatch(/^[^:]+: .+\.$/);
      // A hint is one line that names the part or a port, and ends without a full stop (brief Section 12).
      expect(mode.hint).toBeDefined();
      expect(mode.hint).not.toMatch(/\.$/);
      expect(namesPartOrPort(record(id), mode.hint ?? '')).toBe(true);
    }
  });

  it('fills every spec-card layer that shows at Levels 1 and 2, with a popular-mechanics line', () => {
    const part = record(id);
    for (const layer of LAUNCH_LAYERS) {
      const text = LAYER_TEXT[layer];
      expect(text, `no authored text for the '${layer}' layer`).toBeDefined();
      for (const line of text?.(part) ?? []) expect(line.length).toBeGreaterThan(0);
    }
    expect(part.card.needs).toMatch(/^Needs: /);
    expect(part.card.gives).toMatch(/^Gives: /);
    expect(part.card.popularMechanics.length).toBeGreaterThan(0);
  });

  it('asks no questions in its system text', () => {
    expect(systemText(record(id)).filter((text) => text.includes('?'))).toEqual([]);
  });

  it('unlocks no setting at Level 1, and steps number settings in child-sized steps with a real unit', () => {
    for (const setting of record(id).settings) {
      expect(setting.unlockLevel).toBeGreaterThanOrEqual(2);
      if (setting.kind === 'number') {
        expect((setting.max - setting.min) / setting.step).toBeLessThanOrEqual(12);
        expect(setting.unit.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('settings and safety notes', () => {
  it('turns the DC motor the other way from Level 2 and sets its speed from Level 3 (brief Section 5)', () => {
    expect(record('dc-motor').settings.map(({ id, unlockLevel }) => `${id} from Level ${unlockLevel}`)).toEqual([
      'direction from Level 2',
      'speed from Level 3',
    ]);
  });

  it('carries an adult-supervision note on the battery pack and on each small part (brief Section 13)', () => {
    expect(records.filter((part) => part.card.safetyNote !== undefined).map((part) => part.id)).toEqual(['battery-pack-2-cell', 'caster', 'switch']);
  });
});

// ---------------------------------------------------------------------------------------------
// The reference Level 1 robot (the Rolling Start kit): the 2-cell pack and switch on the chassis's decks, two DC
// motors on its outer motor mounts, each turning a large wheel, and the caster underneath. Mounted parts sit where
// their mounts put them on the canvas; each wheel is drawn where its motor's shaft carries it.

const mountPoint = (part: PartRecord, id: string): MountPointPort => {
  const port = part.ports.find((candidate) => candidate.id === id);
  if (port?.type !== 'mechanical' || port.role !== 'mount-point') throw new Error(`The ${part.identity.name} has no mount point '${id}'.`);
  return port;
};

const mountOf = (part: PartRecord): MountPort => {
  const port = part.ports.find((candidate) => candidate.type === 'mechanical' && candidate.role === 'mount');
  if (port?.type !== 'mechanical' || port.role !== 'mount') throw new Error(`The ${part.identity.name} has no mount.`);
  return port;
};

const drivePort = (part: PartRecord, id: string): DrivePort => {
  const port = part.ports.find((candidate) => candidate.id === id);
  if (port?.type !== 'mechanical' || (port.role !== 'drive-out' && port.role !== 'drive-in')) throw new Error(`The ${part.identity.name} has no drive port '${id}'.`);
  return port;
};

const on = (host: CanvasPose, hostType: string, point: string, childType: string): CanvasPose =>
  canvasPoseOf(host, mountPlacement(mountPoint(record(hostType), point), mountOf(record(childType))));

const carried = (host: CanvasPose, hostType: string, shaft: string, childType: string, hub: string): CanvasPose => {
  const placement = carriedPlacement(drivePort(record(hostType), shaft), drivePort(record(childType), hub));
  if (!placement) throw new Error(`The ${childType} cannot ride on the ${hostType}'s ${shaft}.`);
  return canvasPoseOf(host, placement);
};

const placed = (id: string, part: string, pose: CanvasPose): PlacedPart => ({
  id,
  part,
  position: { x: pose.x, y: pose.y },
  rotation: pose.rotation,
  settings: {},
});

type Ends = readonly [from: string, to: string];

const blueprintOf = (parts: readonly PlacedPart[], wires: readonly Ends[]): unknown => ({
  version: 1,
  parts,
  wires: wires.map(([from, to], index) => {
    const [fromPart = '', fromPort = ''] = from.split('.');
    const [toPart = '', toPort = ''] = to.split('.');
    return { id: `w${index + 1}`, from: { part: fromPart, port: fromPort }, to: { part: toPart, port: toPort } };
  }),
  arena: { preset: 'open-floor', props: [] },
  meta: {
    id: '5d1f0c2e-7a4b-4c9d-8e3f-2b6a1c0d9e8f',
    name: 'Rolling robot',
    level: 1,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    highWater: { parts: 0, wires: wires.length },
  },
});

const CHASSIS_AT: CanvasPose = { x: 0, y: 0, rotation: 0 };
const LEFT_MOTOR_AT = on(CHASSIS_AT, 'chassis', 'motor-left', 'dc-motor');
const RIGHT_MOTOR_AT = on(CHASSIS_AT, 'chassis', 'motor-right', 'dc-motor');

const ROBOT_PARTS: readonly PlacedPart[] = [
  placed('battery', 'battery-pack-2-cell', on(CHASSIS_AT, 'chassis', 'deck-rear', 'battery-pack-2-cell')),
  placed('caster', 'caster', on(CHASSIS_AT, 'chassis', 'caster', 'caster')),
  placed('chassis', 'chassis', CHASSIS_AT),
  placed('motor-left', 'dc-motor', LEFT_MOTOR_AT),
  placed('motor-right', 'dc-motor', RIGHT_MOTOR_AT),
  placed('switch', 'switch', on(CHASSIS_AT, 'chassis', 'deck-front', 'switch')),
  placed('wheel-left', 'wheel-large', carried(LEFT_MOTOR_AT, 'dc-motor', 'shaft', 'wheel-large', 'hub')),
  placed('wheel-right', 'wheel-large', carried(RIGHT_MOTOR_AT, 'dc-motor', 'shaft', 'wheel-large', 'hub')),
];

const MECHANICAL: readonly Ends[] = [
  ['motor-left.mount', 'chassis.motor-left'],
  ['motor-right.mount', 'chassis.motor-right'],
  ['battery.mount', 'chassis.deck-rear'],
  ['switch.mount', 'chassis.deck-front'],
  ['caster.mount', 'chassis.caster'],
  ['motor-left.shaft', 'wheel-left.hub'],
  ['motor-right.shaft', 'wheel-right.hub'],
];

// Wired alike, red to red: plus through the switch to each motor's plus, and each motor's minus back to minus.
const POWER: readonly Ends[] = [
  ['battery.plus', 'switch.a'],
  ['switch.b', 'motor-left.plus'],
  ['switch.b', 'motor-right.plus'],
  ['battery.minus', 'motor-left.minus'],
  ['battery.minus', 'motor-right.minus'],
];

// The right motor's two wires swapped: the Level 2 breakdown.
const POWER_ONE_SWAPPED: readonly Ends[] = [
  ['battery.plus', 'switch.a'],
  ['switch.b', 'motor-left.plus'],
  ['switch.b', 'motor-right.minus'],
  ['battery.minus', 'motor-left.minus'],
  ['battery.minus', 'motor-right.plus'],
];

const robot = (power: readonly Ends[] = POWER): Blueprint =>
  valid(validateBlueprint(blueprintOf(ROBOT_PARTS, [...MECHANICAL, ...power]), catalogue), 'The reference robot');

const primitivesOf = (part: PlacedPart): readonly Primitive[] => catalogue.parts.get(part.part)?.behaviour ?? [];

/**
 * Which way each speed actuator turns from its wiring, with every switch at rest: +1 when its plus side traces to a
 * pack's plus and its minus side to that pack's minus, −1 when crossed, 0 with no such loop.
 */
const turningSigns = (blueprint: Blueprint): ReadonlyMap<string, number> => {
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
  for (const wire of blueprint.wires) join(`${wire.from.part}.${wire.from.port}`, `${wire.to.part}.${wire.to.port}`);
  for (const part of blueprint.parts) {
    for (const primitive of primitivesOf(part)) {
      if (primitive.kind === 'switch' && primitive.actuation.kind === 'manual' && primitive.actuation.initially === 'closed') {
        join(`${part.id}.${primitive.terminals[0]}`, `${part.id}.${primitive.terminals[1]}`);
      }
    }
  }
  const packs = blueprint.parts.flatMap((part) =>
    primitivesOf(part).flatMap((primitive) =>
      primitive.kind === 'source' ? [{ pos: find(`${part.id}.${primitive.output.pos}`), neg: find(`${part.id}.${primitive.output.neg}`) }] : [],
    ),
  );
  const signs = new Map<string, number>();
  for (const part of blueprint.parts) {
    for (const primitive of primitivesOf(part)) {
      if (primitive.kind !== 'actuator' || primitive.mode !== 'speed') continue;
      const pos = find(`${part.id}.${primitive.supply.pos}`);
      const neg = find(`${part.id}.${primitive.supply.neg}`);
      const pack = packs.find((candidate) => (candidate.pos === pos && candidate.neg === neg) || (candidate.pos === neg && candidate.neg === pos));
      signs.set(part.id, pack === undefined ? 0 : (pack.pos === pos ? 1 : -1) * (primitive.reverse ? -1 : 1));
    }
  }
  return signs;
};

const motionOf = (blueprint: Blueprint): string => {
  const signs = turningSigns(blueprint);
  const pushes = drivePushes(blueprint, catalogue).map((push) => push.push * (signs.get(push.actuator) ?? 0));
  if (pushes.length > 0 && pushes.every((push) => push > 0)) return 'forward';
  if (pushes.some((push) => push > 0) && pushes.some((push) => push < 0)) return 'spin';
  return 'other';
};

const placementOf = (blueprint: Blueprint, id: string) => {
  const where = placeParts(blueprint, catalogue).get(id);
  if (!where) throw new Error(`No placement for '${id}'.`);
  return where.placement;
};

const typeOf = (blueprint: Blueprint, id: string): PartRecord => record(blueprint.parts.find((part) => part.id === id)?.part ?? '');

/** How far a part's body box reaches from the chassis's centre line: nearest and furthest. */
const reach = (blueprint: Blueprint, id: string): readonly [number, number] => {
  const where = placementOf(blueprint, id);
  const half = typeOf(blueprint, id).body.size.y / 2;
  const ys = [-half, half].map((y) => Math.abs(placePoint(where, { x: 0, y, z: 0 }).y));
  return [Math.min(...ys), Math.max(...ys)];
};

const axle = (blueprint: Blueprint, wheel: string) => placePoint(placementOf(blueprint, wheel), drivePort(record('wheel-large'), 'hub').at);

describe('the reference Level 1 robot', () => {
  it('validates as a blueprint against a catalogue of the Level 1 records and the arena presets', () => {
    expect(validateBlueprint(blueprintOf(ROBOT_PARTS, [...MECHANICAL, ...POWER]), catalogue).ok).toBe(true);
    expect(validateBlueprint({ ...(blueprintOf(ROBOT_PARTS, [...MECHANICAL, ...POWER]) as object), arena: { preset: 'moon', props: [] } }, catalogue).ok).toBe(false);
  });

  it('lays out on the canvas as its mounts say: the right motor drawn as its mirror image', () => {
    expect(LEFT_MOTOR_AT).toEqual({ x: 19, y: -53, rotation: 0, mirrored: false });
    expect(RIGHT_MOTOR_AT).toEqual({ x: 19, y: 53, rotation: 0, mirrored: true });
    expect(Object.fromEntries(ROBOT_PARTS.map((part) => [part.id, [part.position.x, part.position.y]]))).toEqual({
      battery: [-45, 0],
      caster: [-70, 0],
      chassis: [0, 0],
      'motor-left': [19, -53],
      'motor-right': [19, 53],
      switch: [55, 0],
      'wheel-left': [40, -79],
      'wheel-right': [40, 79],
    });
  });

  it('roots every part on the chassis, mounted or carried', () => {
    const placements = placeParts(robot(), catalogue);
    expect(robotRoot(placements)).toBe('chassis');
    expect(Object.fromEntries([...placements].map(([id, where]) => [id, `${where.by} ${where.root}`]))).toEqual({
      battery: 'mount chassis',
      caster: 'mount chassis',
      chassis: 'root chassis',
      'motor-left': 'mount chassis',
      'motor-right': 'mount chassis',
      switch: 'mount chassis',
      'wheel-left': 'carried chassis',
      'wheel-right': 'carried chassis',
    });
  });

  it('turns its wheels on coaxial axles, clear of the chassis plate, with the motors on the plate', () => {
    const blueprint = robot();
    const [left, right] = [axle(blueprint, 'wheel-left'), axle(blueprint, 'wheel-right')];
    expect(left).toEqual({ x: 40, y: 66, z: 16 });
    expect(right).toEqual({ x: 40, y: -66, z: 16 });
    const edge = record('chassis').body.size.y / 2;
    for (const wheel of ['wheel-left', 'wheel-right']) expect(reach(blueprint, wheel)[0]).toBeGreaterThan(edge);
    for (const motor of ['motor-left', 'motor-right']) expect(reach(blueprint, motor)[1]).toBeLessThanOrEqual(edge);
  });

  it('stands its caster on the floor the wheels roll on', () => {
    const blueprint = robot();
    const floors = ['wheel-left', 'wheel-right', 'caster'].map((id) => placementOf(blueprint, id).z);
    expect(new Set(floors).size).toBe(1);
  });

  it('drives forward with both motors wired red to red, and spins with one motor’s wires swapped (D23)', () => {
    expect(drivePushes(robot(), catalogue).map(({ wheel, push }) => `${wheel} ${push}`)).toEqual(['wheel-left 1', 'wheel-right 1']);
    expect(motionOf(robot())).toBe('forward');
    expect(motionOf(robot(POWER_ONE_SWAPPED))).toBe('spin');
  });
});

// ---------------------------------------------------------------------------------------------
// The failure modes the wiring decides, produced on the workbench: each is a fault, since no switch setting fixes it.

const bench = (parts: readonly (readonly [id: string, type: string])[], wires: readonly Ends[]): Blueprint =>
  valid(
    validateBlueprint(
      blueprintOf(
        parts.map(([id, type], index) => placed(id, type, { x: index * 100, y: 0, rotation: 0 })),
        wires,
      ),
      catalogue,
    ),
    'A bench build',
  );

/** `part: failure mode` for every unmet need the controls do not explain, sorted. */
const faults = (blueprint: Blueprint, state: ControlState = {}): string[] =>
  wiredNeeds(blueprint, catalogue, state)
    .filter((verdict) => verdict.unmet !== undefined && verdict.explainedBy === undefined)
    .map((verdict) => {
      const mode = typeOf(blueprint, verdict.partId).failureModes.find((failure) => failure.need === verdict.need && failure.unmet === verdict.unmet);
      return `${verdict.partId}: ${mode?.id ?? `${verdict.need} ${verdict.unmet ?? ''}`}`;
    })
    .sort();

describe('failure modes the wiring decides', () => {
  it('leaves the reference robot without faults, and an open switch explains what it stops', () => {
    expect(faults(robot())).toEqual([]);
    const opened: ControlState = { switches: { 'switch/contacts': false } };
    expect(faults(robot(), opened)).toEqual([]);
    expect(wiredNeeds(robot(), catalogue, opened).filter((verdict) => verdict.explainedBy?.by === 'controls').map((verdict) => verdict.partId)).toEqual(
      expect.arrayContaining(['battery', 'motor-left', 'motor-right']),
    );
  });

  it.each([
    ['one wire to a DC motor', [['battery', 'battery-pack-2-cell'], ['motor', 'dc-motor']], [['battery.plus', 'motor.plus']], ['battery: no-loop', 'motor: no-circuit']],
    ['a DC motor wired only at minus', [['battery', 'battery-pack-2-cell'], ['motor', 'dc-motor']], [['battery.minus', 'motor.minus']], ['battery: no-loop', 'motor: no-circuit']],
    ['a switch across the pack', [['battery', 'battery-pack-2-cell'], ['switch', 'switch']], [['battery.plus', 'switch.a'], ['switch.b', 'battery.minus']], ['battery: short-circuit', 'switch: across-the-pack']],
    [
      'a switch off to one side of a DC motor’s loop',
      [['battery', 'battery-pack-2-cell'], ['motor', 'dc-motor'], ['switch', 'switch']],
      [['battery.plus', 'motor.plus'], ['motor.minus', 'battery.minus'], ['battery.plus', 'switch.a']],
      ['switch: outside-loop'],
    ],
  ] as const)('%s', (_name, parts, wires, expected) => {
    expect(faults(bench(parts, wires))).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// First-order estimates behind the tuning. sim-core's solvers (tasks 1.2 to 1.4) decide the real runs; these record
// the intent with a plain lumped model:
// - a speed actuator's no-load rpm and stall torque scale with its terminal volts over ratedVolts, and it turns at
//   no-load rpm × (1 − load / stall torque); its current rises in a straight line from noLoadMilliamps to the
//   stall current at that voltage;
// - a pack sags by the current through it × internalOhms, and both motors share it;
// - the wheels and the caster share the robot's weight by where its centre of mass lies between the axle and the
//   caster; the caster drags by rollingFriction × its share, and the wheels roll free;
// - a slope adds weight × sin(angle) to the push the two wheels must give;
// - a tyre grips up to its grip × the floor's friction × the weight on it.
// Distances, slopes and friction come from task 2.4's presets. The 1-cell pack and the gearbox are the schema's
// example records, standing in for task 2.2's.

const GRAVITY = 9.81;

/** How far ahead of a preset's start pose a floor point lies, along the start heading (mm). */
const aheadOf = (preset: ArenaPreset, x: number, y: number): number => {
  const [cos, sin] = cosSin(preset.start.heading);
  return (x - preset.start.x) * cos + (y - preset.start.y) * sin;
};

/** How far the robot reaches ahead of its chassis's centre: the furthest corner of any part's body box (mm). */
const frontOf = (blueprint: Blueprint): number => {
  const placements = placeParts(blueprint, catalogue);
  return Math.max(
    ...blueprint.parts.flatMap((part) => {
      const where = placements.get(part.id);
      const { size } = typeOf(blueprint, part.id).body;
      if (!where) return [];
      return [-1, 1].flatMap((sx) => [-1, 1].map((sy) => placePoint(where.placement, { x: (sx * size.x) / 2, y: (sy * size.y) / 2, z: 0 }).x));
    }),
  );
};

/** The wall stop preset's drive: from the start pose until the robot's front meets the far wall (mm). */
const driveToWall = (preset: ArenaPreset, front: number): number => {
  const wall = preset.walls.find((candidate) => candidate.id === 'far-wall');
  if (!wall) throw new Error(`The '${preset.id}' preset has no far wall.`);
  return Math.min(aheadOf(preset, wall.from.x, wall.from.y), aheadOf(preset, wall.to.x, wall.to.y)) - wall.thicknessMm / 2 - front;
};

const UPHILL: Readonly<Record<Ramp['uphill'], readonly [number, number]>> = { '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] };

/** The steepest slope the robot climbs, driving straight from the preset's start pose: rise over run. */
const steepestClimb = (preset: ArenaPreset): number => {
  const [cos, sin] = cosSin(preset.start.heading);
  const grades = preset.ramps
    .filter((ramp) => UPHILL[ramp.uphill][0] * cos + UPHILL[ramp.uphill][1] * sin > 0)
    .map((ramp) => ramp.riseMm / (ramp.uphill.endsWith('x') ? ramp.to.x - ramp.from.x : ramp.to.y - ramp.from.y));
  if (grades.length === 0) throw new Error(`The '${preset.id}' preset has no slope to climb.`);
  return Math.max(...grades);
};

const primitive = <K extends Primitive['kind']>(part: PartRecord, kind: K): Extract<Primitive, { kind: K }> => {
  const found = part.behaviour.find((candidate): candidate is Extract<Primitive, { kind: K }> => candidate.kind === kind);
  if (!found) throw new Error(`The ${part.identity.name} has no ${kind} primitive.`);
  return found;
};

const example = (id: string): PartRecord => {
  const found = exampleParts.flatMap((data) => {
    const result = validatePartRecord(data);
    return result.ok && result.value.id === id ? [result.value] : [];
  })[0];
  if (!found) throw new Error(`No schema example part '${id}'.`);
  return found;
};

interface Operating {
  readonly volts: number;
  readonly rpm: number;
  readonly stallNmm: number;
}

/** Two motors in parallel on one pack, each turning against `loadNmm`, settled to a steady terminal voltage. */
const operate = (pack: SourcePrimitive, motor: SpeedActuator, loadNmm: number): Operating => {
  let volts = pack.volts;
  let rpm = 0;
  let stallNmm = 0;
  for (let step = 0; step < 100; step += 1) {
    const scale = volts / motor.ratedVolts;
    stallNmm = motor.stallTorqueNmm * scale;
    const share = Math.min(1, loadNmm / stallNmm);
    const milliamps = motor.noLoadMilliamps + (motor.stallMilliamps * scale - motor.noLoadMilliamps) * share;
    rpm = volts < motor.startVolts ? 0 : motor.noLoadRpm * scale * (1 - share);
    volts = pack.volts - ((2 * milliamps) / 1000) * pack.internalOhms;
  }
  return { volts, rpm, stallNmm };
};

/** The reference robot's weight (N), and how it splits between the two drive wheels and the caster. */
const weighRobot = () => {
  const blueprint = robot();
  const placements = placeParts(blueprint, catalogue);
  let grams = 0;
  let moment = 0;
  for (const part of blueprint.parts) {
    const where = placements.get(part.id);
    const { body } = typeOf(blueprint, part.id);
    if (!where) throw new Error(`No placement for '${part.id}'.`);
    grams += body.grams;
    moment += body.grams * placePoint(where.placement, body.centreOfMass).x;
  }
  const axleX = axle(blueprint, 'wheel-left').x;
  const casterX = placementOf(blueprint, 'caster').x;
  const onWheels = (moment / grams - casterX) / (axleX - casterX);
  return { weight: (grams / 1000) * GRAVITY, onWheels, onCaster: 1 - onWheels };
};

describe('the reference robot by first-order estimate', () => {
  const motor = primitive(record('dc-motor'), 'actuator') as SpeedActuator;
  const wheel: WheelPrimitive = primitive(record('wheel-large'), 'wheel');
  const caster: SupportPrimitive = primitive(record('caster'), 'support');
  const twoCell: SourcePrimitive = primitive(record('battery-pack-2-cell'), 'source');
  const oneCell: SourcePrimitive = primitive(example('battery-pack-1-cell'), 'source');
  const gearbox: RatioPrimitive = primitive(example('gearbox'), 'ratio');
  const { weight, onWheels, onCaster } = weighRobot();
  const drag = caster.rollingFriction * onCaster * weight;
  /** The torque each drive wheel's motor must give to push `newtons` along with the other. */
  const perWheel = (newtons: number): number => (newtons / 2) * wheel.radiusMm;
  /** The most torque a drive wheel can pass to the floor before its tyre slips, on a floor of `friction`. */
  const gripPerWheel = (friction: number, cosine = 1): number => wheel.grip * friction * ((onWheels * weight * cosine) / 2) * wheel.radiusMm;
  const mmPerSecond = (rpm: number): number => (rpm / 60) * 2 * Math.PI * wheel.radiusMm;
  const toWall = driveToWall(arena('wall-stop'), frontOf(robot()));

  it('drives from the start pose to the far wall in a few seconds on the 2-cell pack, far from stalling', () => {
    const run = operate(twoCell, motor, perWheel(drag));
    expect(perWheel(drag)).toBeLessThan(run.stallNmm / 4);
    const seconds = toWall / mmPerSecond(run.rpm);
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(6);
  });

  it('runs at under 60% of that speed on a 1-cell pack, still turning', () => {
    const fast = operate(twoCell, motor, perWheel(drag));
    const slow = operate(oneCell, motor, perWheel(drag));
    expect(slow.rpm).toBeGreaterThan(0);
    expect(slow.rpm / fast.rpm).toBeLessThan(0.6);
  });

  it('climbs the ramp preset’s slope in direct drive, with torque and grip to spare (D33)', () => {
    const preset = arena('ramp');
    const grade = steepestClimb(preset);
    const climbNmm = perWheel((weight * grade) / Math.sqrt(1 + grade * grade) + drag);
    const run = operate(twoCell, motor, climbNmm);
    expect(climbNmm).toBeLessThan(run.stallNmm * 0.6);
    expect(run.rpm).toBeGreaterThan(0);
    expect(gripPerWheel(preset.friction, 1 / Math.sqrt(1 + grade * grade))).toBeGreaterThan(climbNmm * 2);
  });

  it('stalls its motors at the far wall in direct drive, and slips its tyres there through a 3:1 gearbox', () => {
    const grip = gripPerWheel(arena('wall-stop').friction);
    const stalled = operate(twoCell, motor, Number.POSITIVE_INFINITY);
    // Direct drive: the motors stop and hum before the tyres let go.
    expect(stalled.stallNmm).toBeLessThan(grip);
    // Through a gearbox the tyres let go first, at a wall or on a standing start: the squeal.
    expect(stalled.stallNmm * gearbox.ratio * gearbox.efficiency).toBeGreaterThan(grip);
  });
});

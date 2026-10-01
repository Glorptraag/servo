/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import {
  SPEC_CARD_LAYERS,
  canvasPoseOf,
  carriedPlacement,
  controlsOf,
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
  DriverPrimitive,
  LoadPrimitive,
  MountPointPort,
  MountPort,
  PartRecord,
  PlacedPart,
  PositionActuator,
  PowerNeed,
  Primitive,
  Ramp,
  RatioPrimitive,
  SettingValue,
  SourcePrimitive,
  SpecCardLayer,
  SpeedActuator,
  SupportPrimitive,
  ValidationResult,
  Vec3,
  WheelPrimitive,
} from '@servo/schema';

const named = (files: Record<string, string>) => Object.entries(files).map(([path, text]) => ({ file: path.slice(path.lastIndexOf('/') + 1), text }));

// Every record in packages/content/parts/level-2/, read as text and parsed here, with no loader in between: the seven
// task 2.2 parts and the LED, which task 2.1 introduced at Level 2 (D47).
const files = named(import.meta.glob<string>('../parts/level-2/*.json', { query: '?raw', import: 'default', eager: true }));
const levelOneFiles = named(import.meta.glob<string>('../parts/level-1/*.json', { query: '?raw', import: 'default', eager: true }));

const ROSTER = ['battery-pack-1-cell', 'bumper-switch', 'buzzer', 'gearbox', 'led', 'motor-driver', 'servo-motor', 'wheel-small'];

const valid = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`${what} does not validate: ${result.issues.map(({ code, path }) => `${code} at ${path}`).join('; ')}`);
  return result.value;
};

const parsed = (list: readonly { readonly text: string }[]): PartRecord[] =>
  list.flatMap(({ text }) => {
    const result = validatePartRecord(JSON.parse(text));
    return result.ok ? [result.value] : [];
  });

const records: readonly PartRecord[] = parsed(files);
const levelOne: readonly PartRecord[] = parsed(levelOneFiles);

// Task 2.4's arena presets, which the reference robot runs in and the estimates measure.
const arenas: readonly ArenaPreset[] = named(import.meta.glob<string>('../arenas/*.json', { query: '?raw', import: 'default', eager: true })).map(({ file, text }) =>
  valid(validateArenaPreset(JSON.parse(text)), file),
);

const arena = (id: string): ArenaPreset => {
  const found = arenas.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`packages/content/arenas/${id}.json is missing.`);
  return found;
};

const catalogue = makeCatalogue({ parts: [...levelOne, ...records], arenas });

const record = (id: string): PartRecord => {
  const found = [...records, ...levelOne].find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No valid Level 1 or Level 2 record '${id}'; the validation tests list why.`);
  return found;
};

// The qualifiers a part's name may hold beside its real name (task 2.5's terminology list).
const [componentsText] = Object.values(import.meta.glob<string>('../terminology/components.json', { query: '?raw', import: 'default', eager: true }));
if (componentsText === undefined) throw new Error('packages/content/terminology/components.json is missing.');
const QUALIFIERS = new Set((JSON.parse(componentsText) as { readonly qualifiers: readonly string[] }).qualifiers);

describe('Level 2 part record files', () => {
  it('hold the Level 2 roster, one record per file, the LED included', () => {
    expect(files.map(({ file }) => file).sort()).toEqual(ROSTER.map((id) => `${id}.json`));
  });

  it.each(files)('$file validates as a part record', ({ text }) => {
    const result = validatePartRecord(JSON.parse(text));
    expect(result.ok ? [] : result.issues.map(({ code, path, message }) => `${code} at ${path}: ${message}`)).toEqual([]);
  });

  it.each(files)('$file is named after its id, introduced at Level 2 and keyed for art by its id', ({ file, text }) => {
    const part = valid(validatePartRecord(JSON.parse(text)), file);
    expect(`${part.id}.json`).toBe(file);
    expect(part.identity.level).toBe(2);
    expect(part.identity.art).toBe(`part/${part.id}`);
  });

  it('share no id or art key with a Level 1 record', () => {
    const levelOneKeys = new Set(levelOne.flatMap((part) => [part.id, part.identity.art]));
    expect(records.flatMap((part) => [part.id, part.identity.art]).filter((key) => levelOneKeys.has(key))).toEqual([]);
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

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a hint names the part or one of its ports: a word of the part's name other than a qualifier (so `servo`
 * names the servo motor, as in the brief's own hint), or a port's label before any mark or note.
 */
const namesPartOrPort = (part: PartRecord, hint: string): boolean => {
  const names = [
    ...part.identity.name.split(' ').filter((word) => !QUALIFIERS.has(word)),
    ...part.ports.map((port) => port.label.replace(/ \(.*$/, '').replace(/,.*$/, '')),
  ];
  return names.some((name) => new RegExp(`\\b${escaped(name)}\\b`, 'i').test(hint));
};

/** The small-parts cylinder (31.7 mm across, 57.1 mm deep at most): a part whose body box fits inside it is a small part. */
const isSmallPart = (part: PartRecord): boolean => {
  const [a = 0, b = 0, c = 0] = [part.body.size.x, part.body.size.y, part.body.size.z].sort((p, q) => p - q);
  return Math.sqrt(a * a + b * b) <= 31.7 && c <= 57.1;
};

const isBatteryPack = (part: PartRecord): boolean => part.behaviour.some((primitive) => primitive.kind === 'source');

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
    expect(part.card.popularMechanics).toMatch(/^[A-Z].+\.$/);
  });

  it('asks no questions in its system text', () => {
    expect(systemText(record(id)).filter((text) => text.includes('?'))).toEqual([]);
  });

  it('unlocks no setting before Level 2, and steps number settings in child-sized steps with a real unit', () => {
    for (const setting of record(id).settings) {
      expect(setting.unlockLevel).toBeGreaterThanOrEqual(2);
      if (setting.kind === 'number') {
        expect((setting.max - setting.min) / setting.step).toBeLessThanOrEqual(12);
        expect(setting.unit.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries an adult-supervision note exactly when it is a battery pack or a small part (brief Section 13)', () => {
    const part = record(id);
    expect(part.card.safetyNote !== undefined).toBe(isBatteryPack(part) || isSmallPart(part));
  });
});

// ---------------------------------------------------------------------------------------------
// Settings and values

const primitive = <K extends Primitive['kind']>(part: PartRecord, kind: K): Extract<Primitive, { kind: K }> => {
  const found = part.behaviour.find((candidate): candidate is Extract<Primitive, { kind: K }> => candidate.kind === kind);
  if (!found) throw new Error(`The ${part.identity.name} has no ${kind} primitive.`);
  return found;
};

const powerNeed = (part: PartRecord): PowerNeed => {
  const need = part.needs.find((candidate): candidate is PowerNeed => candidate.kind === 'power');
  if (!need) throw new Error(`The ${part.identity.name} has no power need.`);
  return need;
};

describe('settings', () => {
  it('unlocks each setting at its own level: the motor driver’s channels at Level 2 (D15), the servo motor’s angle and the LED’s colour at Level 3', () => {
    expect(Object.fromEntries(records.map((part) => [part.id, part.settings.map(({ id, unlockLevel }) => `${id} from Level ${unlockLevel}`)]))).toEqual({
      'battery-pack-1-cell': [],
      'bumper-switch': [],
      buzzer: [],
      gearbox: [],
      led: ['colour from Level 3'],
      'motor-driver': ['motor-a from Level 2', 'motor-b from Level 2'],
      'servo-motor': ['angle from Level 3'],
      'wheel-small': [],
    });
  });

  it('sets each motor-driver channel forward, stop or backward, forward by default, as one of the controls', () => {
    const driver = record('motor-driver');
    for (const setting of driver.settings) {
      expect(setting.kind).toBe('choice');
      if (setting.kind !== 'choice') continue;
      expect(setting.options.map(({ id, value }) => `${id} ${String(value)}`)).toEqual(['forward 1', 'stop 0', 'backward -1']);
      expect(setting.default).toBe('forward');
      expect(setting.binds.param).toBe('command');
    }
    const controls = controlsOf(bench([['driver', 'motor-driver']], []), catalogue);
    expect(controls.map(({ id, kind, rest }) => `${id} ${kind} ${String(rest)}`)).toEqual(['driver/channel-a channel 1', 'driver/channel-b channel 1']);
  });

  it('turns the servo motor’s arm from 0° to 180° in 15° steps, from where it rests (brief Sections 10 and 12)', () => {
    const servo = record('servo-motor');
    const arm = primitive(servo, 'actuator') as PositionActuator;
    const [angle] = servo.settings;
    expect(angle?.kind).toBe('number');
    if (angle?.kind !== 'number') return;
    expect([angle.min, angle.max, angle.step, angle.unit]).toEqual([0, 180, 15, '°']);
    expect([angle.default, arm.target, arm.restDeg]).toEqual([90, 90, 90]);
  });
});

describe('values that tie the Level 2 parts to the Level 1 parts', () => {
  const twoCell: SourcePrimitive = primitive(record('battery-pack-2-cell'), 'source');
  const oneCell: SourcePrimitive = primitive(record('battery-pack-1-cell'), 'source');

  it('makes the 1-cell battery pack one of the 2-cell pack’s cells: half its volts, the same charge', () => {
    expect(oneCell.volts * 2).toBe(twoCell.volts);
    expect(oneCell.emptyVolts * 2).toBe(twoCell.emptyVolts);
    expect(oneCell.internalOhms * 2).toBe(twoCell.internalOhms);
    expect(oneCell.capacityMah).toBe(twoCell.capacityMah);
  });

  it('empties either pack in seconds through a short circuit', () => {
    for (const pack of [oneCell, twoCell]) {
      const seconds = (pack.capacityMah / ((pack.volts / pack.internalOhms) * 1000)) * 3600;
      expect(seconds).toBeLessThan(60);
    }
  });

  it('leaves the LED dark on one cell, and the buzzer sounding quietly there (brief Section 5’s what-if)', () => {
    const led: LoadPrimitive = primitive(record('led'), 'load');
    const buzzer: LoadPrimitive = primitive(record('buzzer'), 'load');
    expect(oneCell.volts).toBeLessThan(led.onVolts);
    expect(oneCell.volts).toBeGreaterThan(buzzer.onVolts);
    expect(oneCell.volts).toBeLessThan(powerNeed(record('buzzer')).minVolts);
  });

  it('switches the motor driver on a 2-cell pack and not on one cell, within the DC motor’s range once its drop is taken', () => {
    const channel: DriverPrimitive = primitive(record('motor-driver'), 'driver');
    expect(oneCell.volts).toBeLessThan(channel.onVolts);
    expect(twoCell.volts).toBeGreaterThan(channel.onVolts);
    expect(powerNeed(record('motor-driver')).minVolts).toBe(channel.onVolts);
    expect(twoCell.volts - channel.dropVolts).toBeGreaterThan(powerNeed(record('dc-motor')).minVolts);
  });

  it('wakes the servo motor on one 2-cell pack below its range, so it holds and hums weakly, and runs it in range on two in series', () => {
    const servo = primitive(record('servo-motor'), 'actuator') as PositionActuator;
    const range = powerNeed(record('servo-motor'));
    expect([range.minVolts, range.maxVolts]).toEqual([4.8, 6]);
    expect(twoCell.volts).toBeGreaterThan(servo.startVolts);
    expect(twoCell.volts).toBeLessThan(range.minVolts);
    expect(2 * twoCell.volts).toBeGreaterThanOrEqual(range.minVolts);
    expect(2 * twoCell.volts).toBeLessThanOrEqual(range.maxVolts);
  });

  it('has no Level 1 or Level 2 part that gives a signal, so a servo motor at Level 2 always shows its no-signal mode (D41)', () => {
    const signalOuts = [...levelOne, ...records].flatMap((part) =>
      part.ports.filter((port) => port.type === 'signal' && port.direction === 'out').map((port) => `${part.id}.${port.id}`),
    );
    expect(signalOuts).toEqual([]);
    const noSignal = record('servo-motor').failureModes.find((mode) => mode.need === 'signal');
    expect(noSignal?.shows).toEqual(['hold', 'hum']);
  });

  it('gears down 3 to 1, driving only while mounted, and makes the small wheel smaller than the large one', () => {
    const gears: RatioPrimitive = primitive(record('gearbox'), 'ratio');
    expect(gears.ratio).toBe(3);
    expect(record('gearbox').needs.map(({ id, kind }) => `${id} ${kind}`)).toEqual(['driven drive', 'fixed mount']);
    const loose = record('gearbox').failureModes.find((mode) => mode.need === 'fixed');
    expect(loose?.shows).toEqual(['still']);
    const small: WheelPrimitive = primitive(record('wheel-small'), 'wheel');
    const large: WheelPrimitive = primitive(record('wheel-large'), 'wheel');
    expect(small.radiusMm).toBeLessThan(large.radiusMm);
  });
});

// ---------------------------------------------------------------------------------------------
// The reference Level 2 robot: the 2-cell pack on the chassis's rear deck, through the bumper switch at the front,
// to the motor driver on the middle deck, whose two channels run the DC motors on the outer motor mounts, each
// turning a large wheel. The LED on the front deck and the buzzer on the left inner motor mount share the bumper
// switch's side of the loop, so a bump at the wall stops everything.

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

const placed = (id: string, part: string, pose: CanvasPose, settings: Readonly<Record<string, SettingValue>> = {}): PlacedPart => ({
  id,
  part,
  position: { x: pose.x, y: pose.y },
  rotation: pose.rotation,
  settings,
});

type Ends = readonly [from: string, to: string];

const blueprintOf = (parts: readonly PlacedPart[], wires: readonly Ends[], preset = 'wall-stop'): unknown => ({
  version: 1,
  parts,
  wires: wires.map(([from, to], index) => {
    const [fromPart = '', fromPort = ''] = from.split('.');
    const [toPart = '', toPort = ''] = to.split('.');
    return { id: `w${index + 1}`, from: { part: fromPart, port: fromPort }, to: { part: toPart, port: toPort } };
  }),
  arena: { preset, props: [] },
  meta: {
    id: '7c2e9a41-3b6d-4f8e-9a1c-5d0b2e4f6a8c',
    name: 'Bumper robot',
    level: 2,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    highWater: { parts: 0, wires: wires.length },
  },
});

const build = (parts: readonly PlacedPart[], wires: readonly Ends[], what: string, preset?: string): Blueprint =>
  valid(validateBlueprint(blueprintOf(parts, wires, preset), catalogue), what);

const CHASSIS_AT: CanvasPose = { x: 0, y: 0, rotation: 0 };
const LEFT_MOTOR_AT = on(CHASSIS_AT, 'chassis', 'motor-left', 'dc-motor');
const RIGHT_MOTOR_AT = on(CHASSIS_AT, 'chassis', 'motor-right', 'dc-motor');

const BODY: readonly PlacedPart[] = [
  placed('battery', 'battery-pack-2-cell', on(CHASSIS_AT, 'chassis', 'deck-rear', 'battery-pack-2-cell')),
  placed('bumper', 'bumper-switch', on(CHASSIS_AT, 'chassis', 'bumper', 'bumper-switch')),
  placed('caster', 'caster', on(CHASSIS_AT, 'chassis', 'caster', 'caster')),
  placed('chassis', 'chassis', CHASSIS_AT),
  placed('driver', 'motor-driver', on(CHASSIS_AT, 'chassis', 'deck-middle', 'motor-driver')),
];

const LIGHTS: readonly PlacedPart[] = [
  placed('buzzer', 'buzzer', on(CHASSIS_AT, 'chassis', 'motor-left-inner', 'buzzer')),
  placed('led', 'led', on(CHASSIS_AT, 'chassis', 'deck-front', 'led')),
];

const directDrive = (left = 'wheel-large', right = 'wheel-large', driver: Record<string, string> = {}): readonly PlacedPart[] => [
  ...BODY.map((part) => (part.id === 'driver' ? { ...part, settings: driver } : part)),
  ...LIGHTS,
  placed('motor-left', 'dc-motor', LEFT_MOTOR_AT),
  placed('motor-right', 'dc-motor', RIGHT_MOTOR_AT),
  placed('wheel-left', left, carried(LEFT_MOTOR_AT, 'dc-motor', 'shaft', left, 'hub')),
  placed('wheel-right', right, carried(RIGHT_MOTOR_AT, 'dc-motor', 'shaft', right, 'hub')),
];

const BODY_MOUNTS: readonly Ends[] = [
  ['battery.mount', 'chassis.deck-rear'],
  ['bumper.mount', 'chassis.bumper'],
  ['caster.mount', 'chassis.caster'],
  ['driver.mount', 'chassis.deck-middle'],
];

const DIRECT_MECHANICAL: readonly Ends[] = [
  ...BODY_MOUNTS,
  ['buzzer.mount', 'chassis.motor-left-inner'],
  ['led.mount', 'chassis.deck-front'],
  ['motor-left.mount', 'chassis.motor-left'],
  ['motor-right.mount', 'chassis.motor-right'],
  ['motor-left.shaft', 'wheel-left.hub'],
  ['motor-right.shaft', 'wheel-right.hub'],
];

// Plus through the bumper switch to the motor driver, which runs each motor red to red; the LED and the buzzer
// hang off the bumper switch's far side, beside the driver.
const DRIVE_POWER: readonly Ends[] = [
  ['battery.plus', 'bumper.a'],
  ['bumper.b', 'driver.plus'],
  ['battery.minus', 'driver.minus'],
  ['driver.a-plus', 'motor-left.plus'],
  ['driver.a-minus', 'motor-left.minus'],
  ['driver.b-plus', 'motor-right.plus'],
  ['driver.b-minus', 'motor-right.minus'],
];

const LIGHT_POWER: readonly Ends[] = [
  ['bumper.b', 'led.plus'],
  ['battery.minus', 'led.minus'],
  ['bumper.b', 'buzzer.plus'],
  ['battery.minus', 'buzzer.minus'],
];

const robot = (parts: readonly PlacedPart[] = directDrive()): Blueprint =>
  build(parts, [...DIRECT_MECHANICAL, ...DRIVE_POWER, ...LIGHT_POWER], 'The reference robot');

const primitivesOf = (part: PlacedPart): readonly Primitive[] => catalogue.parts.get(part.part)?.behaviour ?? [];

/**
 * Which way each speed actuator turns from its wiring, with every switch and driver channel at rest: +1 when its
 * plus side traces to the plus of what feeds it (a pack, or a driver channel commanded forward whose own supply is
 * the right way round) and its minus side to that minus, −1 for each crossing or backward command, 0 when nothing
 * feeds it.
 */
const turningSigns = (blueprint: Blueprint): ReadonlyMap<string, number> => {
  const rest = new Map(controlsOf(blueprint, catalogue).map((control) => [control.id, control.rest] as const));
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
    for (const p of primitivesOf(part)) {
      if (p.kind === 'switch' && rest.get(`${part.id}/${p.id}`) === true) join(`${part.id}.${p.terminals[0]}`, `${part.id}.${p.terminals[1]}`);
    }
  }
  const feeds: { readonly pos: string; readonly neg: string; readonly sign: number }[] = [];
  const signFrom = (part: string, pos: string, neg: string): number => {
    const [plus, minus] = [find(`${part}.${pos}`), find(`${part}.${neg}`)];
    const feed = feeds.find((candidate) => (candidate.pos === plus && candidate.neg === minus) || (candidate.pos === minus && candidate.neg === plus));
    return feed === undefined ? 0 : (feed.pos === plus ? 1 : -1) * feed.sign;
  };
  for (const part of blueprint.parts) {
    for (const p of primitivesOf(part)) {
      if (p.kind === 'source') feeds.push({ pos: find(`${part.id}.${p.output.pos}`), neg: find(`${part.id}.${p.output.neg}`), sign: 1 });
    }
  }
  for (const part of blueprint.parts) {
    for (const p of primitivesOf(part)) {
      if (p.kind !== 'driver') continue;
      const command = Math.sign(Number(rest.get(`${part.id}/${p.id}`) ?? p.command));
      feeds.push({ pos: find(`${part.id}.${p.output.pos}`), neg: find(`${part.id}.${p.output.neg}`), sign: command * signFrom(part.id, p.supply.pos, p.supply.neg) });
    }
  }
  const signs = new Map<string, number>();
  for (const part of blueprint.parts) {
    for (const p of primitivesOf(part)) {
      if (p.kind === 'actuator' && p.mode === 'speed') signs.set(part.id, signFrom(part.id, p.supply.pos, p.supply.neg) * (p.reverse ? -1 : 1));
    }
  }
  return signs;
};

/** Each drive wheel's push along the robot's +x in a Run with the controls at rest: 1 forward, −1 backward, 0 none. */
const pushes = (blueprint: Blueprint): string[] => {
  const signs = turningSigns(blueprint);
  return drivePushes(blueprint, catalogue).map(({ wheel, actuator, push }) => `${wheel} ${String(push * (signs.get(actuator) ?? 0))}`);
};

const placementOf = (blueprint: Blueprint, id: string) => {
  const where = placeParts(blueprint, catalogue).get(id);
  if (!where) throw new Error(`No placement for '${id}'.`);
  return where.placement;
};

const typeOf = (blueprint: Blueprint, id: string): PartRecord => record(blueprint.parts.find((part) => part.id === id)?.part ?? '');

/** Where a wheel's tyre meets the floor (the centre of its footprint), and where its hub turns, in the chassis's frame. */
const contactOf = (blueprint: Blueprint, id: string): Vec3 => placePoint(placementOf(blueprint, id), { x: 0, y: 0, z: 0 });
const axleOf = (blueprint: Blueprint, wheel: string): Vec3 =>
  placePoint(placementOf(blueprint, wheel), drivePort(typeOf(blueprint, wheel), primitive(typeOf(blueprint, wheel), 'wheel').hub).at);

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

describe('the reference Level 2 robot', () => {
  it('validates as a blueprint against a catalogue of the Level 1 and Level 2 records and the arena presets', () => {
    const wires = [...DIRECT_MECHANICAL, ...DRIVE_POWER, ...LIGHT_POWER];
    expect(validateBlueprint(blueprintOf(directDrive(), wires), catalogue).ok).toBe(true);
    expect(validateBlueprint(blueprintOf(directDrive(), wires, 'moon'), catalogue).ok).toBe(false);
  });

  it('lays out on the canvas as its mounts say, each wheel where its motor’s shaft carries it', () => {
    expect(Object.fromEntries(directDrive().map((part) => [part.id, [part.position.x, part.position.y]]))).toEqual({
      battery: [-45, 0],
      bumper: [80, 0],
      buzzer: [30, -29],
      caster: [-70, 0],
      chassis: [0, 0],
      driver: [0, 0],
      led: [55, 0],
      'motor-left': [19, -53],
      'motor-right': [19, 53],
      'wheel-left': [40, -79],
      'wheel-right': [40, 79],
    });
  });

  it('roots every part on the chassis, mounted or carried', () => {
    const placements = placeParts(robot(), catalogue);
    expect(robotRoot(placements)).toBe('chassis');
    const held = [...placements].filter(([id]) => id !== 'chassis').map(([id, where]) => `${id} ${where.by} ${where.root}`);
    expect(held).toEqual(expect.arrayContaining(['bumper mount chassis', 'driver mount chassis', 'wheel-left carried chassis', 'wheel-right carried chassis']));
    expect(held.every((line) => line.endsWith(' chassis'))).toBe(true);
  });

  it('drives forward through the motor driver, spins with one channel backward, and pivots with one at stop', () => {
    expect(pushes(robot())).toEqual(['wheel-left 1', 'wheel-right 1']);
    expect(pushes(robot(directDrive('wheel-large', 'wheel-large', { 'motor-a': 'backward' })))).toEqual(['wheel-left -1', 'wheel-right 1']);
    expect(pushes(robot(directDrive('wheel-large', 'wheel-large', { 'motor-b': 'stop' })))).toEqual(['wheel-left 1', 'wheel-right 0']);
  });

  it('meets the far wall with its bumper switch first: the probe is the robot’s front, across its middle', () => {
    const blueprint = robot();
    const contacts = primitive(record('bumper-switch'), 'switch');
    if (contacts.actuation.kind !== 'contact') throw new Error('The bumper switch is not a contact switch.');
    expect(contacts.actuation.normally).toBe('closed');
    const where = placementOf(blueprint, 'bumper');
    const ends = [contacts.actuation.probe.from, contacts.actuation.probe.to].map((end) => placePoint(where, { x: end.x, y: end.y, z: 0 }));
    for (const end of ends) expect(end.x).toBe(frontOf(blueprint));
    expect(Math.min(...ends.map((end) => end.y))).toBeLessThan(0);
    expect(Math.max(...ends.map((end) => end.y))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The failure modes the wiring decides. A fault is what the controls cannot fix: a pressed bumper switch and a
// driver channel at stop are behaviour, and a motor driver without power stands for the motors behind it.

const bench = (parts: readonly (readonly [id: string, type: string])[], wires: readonly Ends[]): Blueprint =>
  build(
    parts.map(([id, type], index) => placed(id, type, { x: index * 100, y: 0, rotation: 0 })),
    wires,
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

/** The parts whose unmet power or loop needs the given controls explain. */
const explainedBy = (blueprint: Blueprint, state: ControlState): string[] => [
  ...new Set(
    wiredNeeds(blueprint, catalogue, state)
      .filter((verdict) => verdict.explainedBy?.by === 'controls')
      .map((verdict) => verdict.partId),
  ),
];

describe('failure modes the wiring decides', () => {
  it('leaves the reference robot without faults, and a pressed bumper switch explains everything it stops', () => {
    expect(faults(robot())).toEqual([]);
    const pressed: ControlState = { switches: { 'bumper/contacts': false } };
    expect(faults(robot(), pressed)).toEqual([]);
    expect(explainedBy(robot(), pressed).sort()).toEqual(['battery', 'buzzer', 'driver', 'led', 'motor-left', 'motor-right']);
  });

  it('explains a motor stopped by its driver channel by that channel, never as a fault', () => {
    const stopped = robot(directDrive('wheel-large', 'wheel-large', { 'motor-a': 'stop' }));
    expect(faults(stopped)).toEqual([]);
    const verdict = wiredNeeds(stopped, catalogue).find((candidate) => candidate.partId === 'motor-left' && candidate.unmet !== undefined);
    expect(verdict?.explainedBy).toEqual({ by: 'controls', controls: ['driver/channel-a'] });
  });

  it('stands a motor driver without power for the motors behind it (the feeder step)', () => {
    const blueprint = bench(
      [
        ['battery', 'battery-pack-2-cell'],
        ['driver', 'motor-driver'],
        ['motor', 'dc-motor'],
      ],
      [
        ['battery.plus', 'driver.plus'],
        ['driver.a-plus', 'motor.plus'],
        ['driver.a-minus', 'motor.minus'],
      ],
    );
    expect(faults(blueprint)).toEqual(['battery: no-loop', 'driver: no-power']);
    expect(wiredNeeds(blueprint, catalogue).find((verdict) => verdict.partId === 'motor')?.explainedBy).toEqual({ by: 'feeder', part: 'driver' });
  });

  it.each([
    ['one wire to an LED', [['battery', 'battery-pack-2-cell'], ['led', 'led']], [['battery.plus', 'led.plus']], ['battery: no-loop', 'led: no-circuit']],
    [
      'a switch off to one side of an LED’s loop',
      [['battery', 'battery-pack-2-cell'], ['led', 'led'], ['switch', 'switch']],
      [['battery.plus', 'led.plus'], ['led.minus', 'battery.minus'], ['battery.plus', 'switch.a']],
      ['switch: outside-loop'],
    ],
    ['a bumper switch across the pack', [['battery', 'battery-pack-2-cell'], ['bumper', 'bumper-switch']], [['battery.plus', 'bumper.a'], ['bumper.b', 'battery.minus']], ['battery: short-circuit', 'bumper: across-the-pack']],
    [
      'a bumper switch off to one side of a DC motor’s loop',
      [['battery', 'battery-pack-2-cell'], ['bumper', 'bumper-switch'], ['motor', 'dc-motor']],
      [['battery.plus', 'motor.plus'], ['motor.minus', 'battery.minus'], ['battery.plus', 'bumper.a']],
      ['bumper: outside-loop'],
    ],
    [
      'a 1-cell pack wired beside the 2-cell pack',
      [['one', 'battery-pack-1-cell'], ['two', 'battery-pack-2-cell']],
      [['one.plus', 'two.plus'], ['one.minus', 'two.minus']],
      ['one: short-circuit', 'two: short-circuit'],
    ],
    ['a 1-cell pack with one wire to a buzzer', [['battery', 'battery-pack-1-cell'], ['buzzer', 'buzzer']], [['battery.plus', 'buzzer.plus']], ['battery: no-loop', 'buzzer: no-circuit']],
    ['a servo motor wired only at minus', [['battery', 'battery-pack-2-cell'], ['servo', 'servo-motor']], [['battery.minus', 'servo.minus']], ['battery: no-loop', 'servo: no-circuit']],
    [
      'a servo motor on two 2-cell packs in series',
      [['low', 'battery-pack-2-cell'], ['high', 'battery-pack-2-cell'], ['servo', 'servo-motor']],
      [['low.plus', 'high.minus'], ['high.plus', 'servo.plus'], ['servo.minus', 'low.minus']],
      [],
    ],
  ] as const)('%s', (_name, parts, wires, expected) => {
    expect(faults(bench(parts, wires))).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// The drivetrain variants: 3:1 gearboxes between the motors and the wheels, and the small wheel.

const LEFT_INNER_AT = on(CHASSIS_AT, 'chassis', 'motor-left-inner', 'dc-motor');
const RIGHT_INNER_AT = on(CHASSIS_AT, 'chassis', 'motor-right-inner', 'dc-motor');
const LEFT_GEARBOX_AT = on(CHASSIS_AT, 'chassis', 'gear-left', 'gearbox');
const RIGHT_GEARBOX_AT = on(CHASSIS_AT, 'chassis', 'gear-right', 'gearbox');

const GEARED_PARTS: readonly PlacedPart[] = [
  ...BODY,
  placed('gear-left', 'gearbox', LEFT_GEARBOX_AT),
  placed('gear-right', 'gearbox', RIGHT_GEARBOX_AT),
  placed('motor-left', 'dc-motor', LEFT_INNER_AT),
  placed('motor-right', 'dc-motor', RIGHT_INNER_AT),
  placed('wheel-left', 'wheel-large', carried(LEFT_GEARBOX_AT, 'gearbox', 'output', 'wheel-large', 'hub')),
  placed('wheel-right', 'wheel-large', carried(RIGHT_GEARBOX_AT, 'gearbox', 'output', 'wheel-large', 'hub')),
];

const GEARED_MECHANICAL: readonly Ends[] = [
  ...BODY_MOUNTS,
  ['gear-left.mount', 'chassis.gear-left'],
  ['gear-right.mount', 'chassis.gear-right'],
  ['motor-left.mount', 'chassis.motor-left-inner'],
  ['motor-right.mount', 'chassis.motor-right-inner'],
  ['motor-left.shaft', 'gear-left.input'],
  ['motor-right.shaft', 'gear-right.input'],
  ['gear-left.output', 'wheel-left.hub'],
  ['gear-right.output', 'wheel-right.hub'],
];

const geared = (mechanical: readonly Ends[] = GEARED_MECHANICAL): Blueprint => build(GEARED_PARTS, [...mechanical, ...DRIVE_POWER], 'The geared robot');

describe('the robot with gearboxes', () => {
  it('validates with its motors on the inner mounts and its gearboxes on the gearbox mounts, with the axles where direct drive puts them', () => {
    const blueprint = geared();
    const direct = robot();
    for (const wheel of ['wheel-left', 'wheel-right']) expect(axleOf(blueprint, wheel)).toEqual(axleOf(direct, wheel));
    for (const part of ['gear-left', 'gear-right', 'motor-left', 'motor-right']) expect(placeParts(blueprint, catalogue).get(part)?.by).toBe('mount');
  });

  it('drives forward through its mounted gearboxes, and a loose gearbox drives nothing', () => {
    expect(pushes(geared())).toEqual(['wheel-left 1', 'wheel-right 1']);
    const loose = geared(GEARED_MECHANICAL.filter(([from]) => from !== 'gear-left.mount'));
    expect(pushes(loose)).toEqual(['wheel-right 1']);
  });
});

/** The floor under a robot resting on three contacts, as the floor's height at (x, y) in the chassis's frame. */
const floorThrough = (a: Vec3, b: Vec3, c: Vec3): ((x: number, y: number) => number) => {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  return (x, y) => a.z - (n.x * (x - a.x) + n.y * (y - a.y)) / n.z;
};

/** The least height of any body box above the floor the robot rests on, leaving out the parts that touch it. */
const clearance = (blueprint: Blueprint): number => {
  const floor = floorThrough(contactOf(blueprint, 'wheel-left'), contactOf(blueprint, 'wheel-right'), contactOf(blueprint, 'caster'));
  const placements = placeParts(blueprint, catalogue);
  return Math.min(
    ...blueprint.parts
      .filter((part) => !['wheel-left', 'wheel-right', 'caster'].includes(part.id))
      .flatMap((part) => {
        const where = placements.get(part.id);
        const { size } = typeOf(blueprint, part.id).body;
        if (!where) return [];
        return [-1, 1].flatMap((sx) =>
          [-1, 1].map((sy) => {
            const corner = placePoint(where.placement, { x: (sx * size.x) / 2, y: (sy * size.y) / 2, z: 0 });
            return corner.z - floor(corner.x, corner.y);
          }),
        );
      }),
  );
};

describe('the small wheel', () => {
  it('curves the robot towards the small wheel when it replaces one large wheel, the midpoint of its wheels on a circle about 515 mm in radius, narrower than the open floor (the what-if)', () => {
    const blueprint = robot(directDrive('wheel-large', 'wheel-small'));
    expect(pushes(blueprint)).toEqual(['wheel-left 1', 'wheel-right 1']);
    const [left, right] = ['wheel-left', 'wheel-right'].map((wheel) => primitive(typeOf(blueprint, wheel), 'wheel').radiusMm);
    const track = contactOf(blueprint, 'wheel-left').y - contactOf(blueprint, 'wheel-right').y;
    // Both motors turn alike, so each wheel rolls its radius times as far: the right one less far, so the robot turns right.
    const yawRate = ((right ?? 0) - (left ?? 0)) / track;
    expect(yawRate).toBeLessThan(0);
    // The radius of the path the point midway between the two tyres' contacts follows. Only that path is checked: from the
    // preset's start pose the turn meets the floor's side edge part-way round, which task 4.8 must allow for (R-2.2).
    const radius = ((track / 2) * ((left ?? 0) + (right ?? 0))) / ((left ?? 0) - (right ?? 0));
    expect(radius).toBeGreaterThan(500);
    expect(radius).toBeLessThan(530);
    expect(2 * radius).toBeLessThan(arena('open-floor').size.y);
  });

  it('touches the floor higher on the same axle by the difference in radius, so the robot leans towards it', () => {
    const blueprint = robot(directDrive('wheel-large', 'wheel-small'));
    expect(axleOf(blueprint, 'wheel-left').z).toBe(axleOf(blueprint, 'wheel-right').z);
    const lift = contactOf(blueprint, 'wheel-right').z - contactOf(blueprint, 'wheel-left').z;
    expect(lift).toBe(primitive(record('wheel-large'), 'wheel').radiusMm - primitive(record('wheel-small'), 'wheel').radiusMm);
  });

  it('keeps the chassis clear of the floor on two small wheels, tilted nose down', () => {
    expect(clearance(robot())).toBeGreaterThan(10);
    expect(clearance(robot(directDrive('wheel-small', 'wheel-small')))).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------------------------
// First-order estimates behind the values, in the Level 1 test's lumped model: a speed actuator's no-load rpm and
// stall torque scale with its terminal volts over ratedVolts, and it turns at no-load rpm × (1 − load / stall torque),
// its current rising in a straight line from noLoadMilliamps to the stall current at that voltage; a driver channel
// gives its supply less dropVolts, or nothing below onVolts; a load draws in a straight line from onVolts to its
// rated point; the pack sags by its current × internalOhms; the wheels and caster share the weight by where the
// centre of mass lies between them; a slope adds weight × sin(angle) to the push; a tyre grips up to its grip × the
// floor's friction × the weight on it. Distances, slopes and friction come from task 2.4's presets. sim-core's
// solvers decide the real runs.

const GRAVITY = 9.81;

/** How far ahead of a preset's start pose a floor point lies, along the start heading (mm). */
const aheadOf = (preset: ArenaPreset, x: number, y: number): number => {
  const [cos, sin] = cosSin(preset.start.heading);
  return (x - preset.start.x) * cos + (y - preset.start.y) * sin;
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

interface Drive {
  readonly pack: SourcePrimitive;
  readonly motor: SpeedActuator;
  /** The motor-driver channel between the pack and each motor; none for direct drive. */
  readonly channel?: DriverPrimitive;
  /** Other loads straight across the pack. */
  readonly loads?: readonly LoadPrimitive[];
}

interface Operating {
  readonly packVolts: number;
  readonly motorVolts: number;
  readonly rpm: number;
  readonly stallNmm: number;
}

const loadMilliamps = (load: LoadPrimitive, volts: number): number =>
  volts <= load.onVolts ? 0 : (load.ratedMilliamps * (volts - load.onVolts)) / (load.ratedVolts - load.onVolts);

/** Two motors on one pack, each turning against `loadNmm`, settled to a steady terminal voltage. */
const operate = ({ pack, motor, channel, loads = [] }: Drive, loadNmm: number): Operating => {
  let packVolts = pack.volts;
  let motorVolts = 0;
  let rpm = 0;
  let stallNmm = 0;
  for (let step = 0; step < 100; step += 1) {
    motorVolts = channel === undefined ? packVolts : packVolts >= channel.onVolts ? packVolts * channel.command - channel.dropVolts : 0;
    const scale = motorVolts / motor.ratedVolts;
    const turning = motorVolts >= motor.startVolts;
    stallNmm = motor.stallTorqueNmm * scale;
    const share = stallNmm > 0 ? Math.min(1, loadNmm / stallNmm) : 1;
    const milliamps = turning ? motor.noLoadMilliamps + (motor.stallMilliamps * scale - motor.noLoadMilliamps) * share : 0;
    rpm = turning ? motor.noLoadRpm * scale * (1 - share) : 0;
    const others = loads.reduce((sum, load) => sum + loadMilliamps(load, packVolts), 0) + (channel === undefined ? 0 : 2 * channel.idleMilliamps);
    packVolts = pack.volts - ((2 * milliamps + others) / 1000) * pack.internalOhms;
  }
  return { packVolts, motorVolts, rpm, stallNmm };
};

/** A robot's weight (N), and how it splits between its two drive wheels and the caster. */
const weigh = (blueprint: Blueprint) => {
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
  const axleX = axleOf(blueprint, 'wheel-left').x;
  const casterX = placementOf(blueprint, 'caster').x;
  const onWheels = (moment / grams - casterX) / (axleX - casterX);
  return { weight: (grams / 1000) * GRAVITY, onWheels, onCaster: 1 - onWheels };
};

describe('the reference Level 2 robot by first-order estimate', () => {
  const motor = primitive(record('dc-motor'), 'actuator') as SpeedActuator;
  const channel: DriverPrimitive = primitive(record('motor-driver'), 'driver');
  const gears: RatioPrimitive = primitive(record('gearbox'), 'ratio');
  const wheel: WheelPrimitive = primitive(record('wheel-large'), 'wheel');
  const caster: SupportPrimitive = primitive(record('caster'), 'support');
  const twoCell: SourcePrimitive = primitive(record('battery-pack-2-cell'), 'source');
  const oneCell: SourcePrimitive = primitive(record('battery-pack-1-cell'), 'source');
  const led: LoadPrimitive = primitive(record('led'), 'load');
  const buzzer: LoadPrimitive = primitive(record('buzzer'), 'load');
  const viaDriver = (pack: SourcePrimitive): Drive => ({ pack, motor, channel, loads: [led, buzzer] });

  const robotWeight = weigh(robot());
  const gearedWeight = weigh(geared());
  const drag = ({ weight, onCaster }: { weight: number; onCaster: number }): number => caster.rollingFriction * onCaster * weight;
  /** The torque each drive wheel must give to push `newtons` along with the other. */
  const perWheel = (newtons: number): number => (newtons / 2) * wheel.radiusMm;
  /** The most torque a drive wheel can pass to the floor before its tyre slips. */
  const gripPerWheel = ({ weight, onWheels }: { weight: number; onWheels: number }, friction: number, cosine = 1): number =>
    wheel.grip * friction * ((onWheels * weight * cosine) / 2) * wheel.radiusMm;
  /** The torque each drive wheel needs to climb a slope of `sine` with this robot. */
  const climbing = (load: { weight: number; onCaster: number }, sine: number): number => perWheel(load.weight * sine + drag(load));
  const mmPerSecond = (rpm: number): number => (rpm / 60) * 2 * Math.PI * wheel.radiusMm;

  it('drives from the start pose to the far wall in a few seconds through the motor driver, every part in its range', () => {
    const run = operate(viaDriver(twoCell), perWheel(drag(robotWeight)));
    expect(run.packVolts).toBeGreaterThan(channel.onVolts);
    expect(run.motorVolts).toBeGreaterThan(powerNeed(record('dc-motor')).minVolts);
    for (const part of ['led', 'buzzer']) expect(run.packVolts).toBeGreaterThan(powerNeed(record(part)).minVolts);
    const seconds = driveToWall(arena('wall-stop'), frontOf(robot())) / mmPerSecond(run.rpm);
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(8);
  });

  it('gives its motors nothing on a 1-cell pack, where the Level 1 direct-drive robot still turns at about half speed', () => {
    expect(operate(viaDriver(oneCell), perWheel(drag(robotWeight))).rpm).toBe(0);
    const fast = operate({ pack: twoCell, motor }, perWheel(drag(robotWeight)));
    const slow = operate({ pack: oneCell, motor }, perWheel(drag(robotWeight)));
    expect(slow.rpm / fast.rpm).toBeGreaterThan(0.4);
    expect(slow.rpm / fast.rpm).toBeLessThan(0.6);
  });

  it('stalls its motors at the far wall in direct drive, and slips its tyres there through the 3:1 gearboxes', () => {
    const friction = arena('wall-stop').friction;
    const stalled = operate(viaDriver(twoCell), Number.POSITIVE_INFINITY);
    // Direct drive: the motors stop and hum before the tyres let go.
    expect(stalled.stallNmm).toBeLessThan(gripPerWheel(robotWeight, friction));
    // Through the gearboxes the tyres let go first, at a wall or on a standing start.
    expect(stalled.stallNmm * gears.ratio * gears.efficiency).toBeGreaterThan(gripPerWheel(gearedWeight, friction));
  });

  it('climbs the ramp preset in direct drive (D33, D46), and through the gearboxes a steeper slope that stalls direct drive', () => {
    const preset = arena('ramp');
    const sineOf = (grade: number): number => grade / Math.sqrt(1 + grade * grade);
    const rampSine = sineOf(steepestClimb(preset));
    const onRamp = operate(viaDriver(twoCell), climbing(robotWeight, rampSine));
    expect(onRamp.rpm).toBeGreaterThan(0);
    expect(climbing(robotWeight, rampSine)).toBeLessThan(onRamp.stallNmm * 0.6);
    // The gentlest slope on which direct drive stalls, by halving the interval.
    let [turns, stalls] = [rampSine, 1];
    for (let step = 0; step < 40; step += 1) {
      const sine = (turns + stalls) / 2;
      if (operate(viaDriver(twoCell), climbing(robotWeight, sine)).rpm > 0) turns = sine;
      else stalls = sine;
    }
    const cosine = Math.sqrt(1 - stalls * stalls);
    const atWheel = climbing(gearedWeight, stalls);
    const throughGears = operate(viaDriver(twoCell), atWheel / (gears.ratio * gears.efficiency));
    expect(throughGears.rpm).toBeGreaterThan(0);
    expect(atWheel / (gears.ratio * gears.efficiency)).toBeLessThan(throughGears.stallNmm * 0.6);
    expect(gripPerWheel(gearedWeight, preset.friction, cosine)).toBeGreaterThan(atWheel * 1.2);
  });
});

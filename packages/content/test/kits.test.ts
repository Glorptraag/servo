/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import {
  PART_FAMILIES,
  TICK_RATE,
  canonicalJson,
  canonicalizeBlueprint,
  canvasPoseOf,
  controlsOf,
  cosSin,
  drivePushes,
  makeCatalogue,
  placeParts,
  placePoint,
  robotRoot,
  serializeBlueprint,
  validateBlueprint,
  validateKit,
  wiredNeeds,
} from '@servo/schema';
import type { ArenaPreset, Blueprint, CanvasPose, ControlState, Kit, PartRecord, PlacedPart, PowerNeed, Primitive, ValidationResult, Vec3 } from '@servo/schema';
import { FIXTURES, loadFixtures } from '../src/fixtures.ts';
import type { ContentFixture } from '../src/fixtures.ts';
import { loadContent } from '../src/index.ts';

const named = (files: Record<string, string>) => Object.entries(files).map(([path, text]) => ({ file: path.slice(path.lastIndexOf('/') + 1), text }));

// The kit files and the kit robots' blueprints, read as text: the tests parse the bytes that ship.
const kitFiles = named(import.meta.glob<string>('../kits/*.json', { query: '?raw', import: 'default', eager: true }));
const robotFiles = named(import.meta.glob<string>('../fixtures/blueprints/kit-*.json', { query: '?raw', import: 'default', eager: true }));

const { content } = loadContent();
const { catalogue } = content;
const partsAndArenas = makeCatalogue({ parts: content.parts, arenas: content.arenas });

const valid = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`${what} does not validate: ${result.issues.map(({ code, path }) => `${code} at ${path}`).join('; ')}`);
  return result.value;
};

const kit = (id: string): Kit => {
  const found = kitFiles.find(({ file }) => file === `${id}.json`);
  if (!found) throw new Error(`packages/content/kits/${id}.json is missing.`);
  return valid(validateKit(JSON.parse(found.text), partsAndArenas), found.file);
};

const record = (id: string): PartRecord => {
  const found = catalogue.parts.get(id);
  if (!found) throw new Error(`No part record '${id}'.`);
  return found;
};

const arena = (id: string): ArenaPreset => {
  const found = catalogue.arenas?.get(id);
  if (!found) throw new Error(`No arena preset '${id}'.`);
  return found;
};

const contents = (bag: Kit): Record<string, number> => Object.fromEntries(bag.parts.map(({ part, quantity }) => [part, quantity]));

// The qualifiers a part's name may hold beside its real name (task 2.5's terminology list).
const [componentsText] = Object.values(import.meta.glob<string>('../terminology/components.json', { query: '?raw', import: 'default', eager: true }));
if (componentsText === undefined) throw new Error('packages/content/terminology/components.json is missing.');
const QUALIFIERS = new Set((JSON.parse(componentsText) as { readonly qualifiers: readonly string[] }).qualifiers);

/** A part's real name without its qualifiers: `battery pack` for the 2-cell battery pack, `wheel` for the large wheel. */
const realName = (part: PartRecord): string =>
  part.identity.name
    .split(' ')
    .filter((word) => !QUALIFIERS.has(word))
    .join(' ');

describe('kit files', () => {
  it('hold the two launch kits, one per file, each named after its id', () => {
    expect(kitFiles.map(({ file }) => file).sort()).toEqual(['circuit-crew.json', 'rolling-start.json']);
    for (const { file, text } of kitFiles) expect(`${(JSON.parse(text) as { readonly id: string }).id}.json`).toBe(file);
  });

  it.each(kitFiles)('$file validates against the content parts and arenas', ({ text }) => {
    const result = validateKit(JSON.parse(text), partsAndArenas);
    expect(result.ok ? [] : result.issues.map(({ code, path, message }) => `${code} at ${path}: ${message}`)).toEqual([]);
  });

  it.each(kitFiles)('$file is stored in canonical form', ({ text }) => {
    expect(canonicalJson(JSON.parse(text))).toBe(text);
  });

  it('load through the content loader into the catalogue', () => {
    expect(content.kits.map((bag) => bag.id)).toEqual(['circuit-crew', 'rolling-start']);
    expect([...(catalogue.kits?.keys() ?? [])].sort()).toEqual(['circuit-crew', 'rolling-start']);
  });
});

describe('Rolling Start (Level 1)', () => {
  it('holds brief Section 4’s kit: a 2-cell battery pack, a switch, 2 DC motors, 2 large wheels, a caster and the chassis, with no LED (D47)', () => {
    const bag = kit('rolling-start');
    expect([bag.name, bag.level]).toEqual(['Rolling Start', 1]);
    expect(contents(bag)).toEqual({ 'battery-pack-2-cell': 1, switch: 1, 'dc-motor': 2, 'wheel-large': 2, chassis: 1, caster: 1 });
  });

  it('holds every part Level 1 introduces, and none from a later level', () => {
    const levelOne = content.parts.filter((part) => part.identity.level === 1).map((part) => part.id);
    expect(Object.keys(contents(kit('rolling-start'))).sort()).toEqual(levelOne);
  });
});

describe('Circuit Crew (Level 2, a placeholder name: D5)', () => {
  it('holds brief Section 5’s kit and what the Level 2 challenges need (D53), with the chassis to build on', () => {
    const bag = kit('circuit-crew');
    expect([bag.name, bag.level]).toEqual(['Circuit Crew', 2]);
    expect(contents(bag)).toEqual({
      // Brief Section 5: battery pack, switch, 2 DC motors, motor driver, 2 wheels, caster, LED and buzzer.
      'battery-pack-2-cell': 2, // and a second one for the servo motor's introduction (D50)
      'battery-pack-1-cell': 1,
      switch: 1,
      'motor-driver': 1,
      'bumper-switch': 1,
      'dc-motor': 2,
      'servo-motor': 1,
      'wheel-large': 2,
      'wheel-small': 2,
      gearbox: 2,
      chassis: 1,
      caster: 1,
      led: 1,
      buzzer: 1,
    });
  });

  it('holds every part Level 2 introduces, beside every Level 1 part', () => {
    const upToLevelTwo = content.parts.filter((part) => part.identity.level <= 2).map((part) => part.id);
    expect(content.parts.some((part) => part.identity.level === 2)).toBe(true);
    expect(Object.keys(contents(kit('circuit-crew'))).sort()).toEqual(upToLevelTwo);
  });

  it('runs the servo motor in its range on two of its 2-cell battery packs in series, for the servo motor’s introduction (D50)', () => {
    const range = record('servo-motor').needs.find((need): need is PowerNeed => need.kind === 'power');
    const cells = record('battery-pack-2-cell').behaviour.find((primitive) => primitive.kind === 'source');
    expect(contents(kit('circuit-crew'))['battery-pack-2-cell']).toBe(2);
    expect(2 * (cells?.kind === 'source' ? cells.volts : 0)).toBeGreaterThanOrEqual(range?.minVolts ?? Number.POSITIVE_INFINITY);
    expect(2 * (cells?.kind === 'source' ? cells.volts : 0)).toBeLessThanOrEqual(range?.maxVolts ?? 0);
  });
});

describe('the tray', () => {
  const tiles = (bag: Kit): string[] => bag.tray.flatMap((group) => group.parts);

  it.each(['rolling-start', 'circuit-crew'])('%s groups its tiles by family, in the Library’s family order', (id) => {
    const order: readonly string[] = PART_FAMILIES.map((family) => family.id);
    const families = kit(id).tray.map((group) => group.family);
    expect(families).toEqual(families.toSorted((a, b) => order.indexOf(a) - order.indexOf(b)));
    for (const group of kit(id).tray) for (const part of group.parts) expect(`${part} ${record(part).identity.family}`).toBe(`${part} ${group.family}`);
  });

  it.each(['rolling-start', 'circuit-crew'])('%s puts the sizes of one part side by side, so a child can compare them', (id) => {
    for (const group of kit(id).tray) {
      const names = group.parts.map((part) => realName(record(part)));
      const runs = names.filter((name, index) => name !== names[index - 1]);
      expect(runs).toEqual([...new Set(names)]);
    }
  });

  it('keeps the Rolling Start tiles in the Circuit Crew tray in the same order, so familiar parts stay where they were', () => {
    const familiar = new Set(tiles(kit('rolling-start')));
    expect(tiles(kit('circuit-crew')).filter((part) => familiar.has(part))).toEqual(tiles(kit('rolling-start')));
  });

  it('shows each kit as tray groups: Rolling Start in four, Circuit Crew in six', () => {
    const shown = (bag: Kit): string[] => bag.tray.map((group) => `${group.family}: ${group.parts.join(', ')}`);
    expect(shown(kit('rolling-start'))).toEqual(['power: battery-pack-2-cell, switch', 'actuators: dc-motor', 'drivetrain: wheel-large', 'structure-and-ride: chassis, caster']);
    expect(shown(kit('circuit-crew'))).toEqual([
      'power: battery-pack-2-cell, battery-pack-1-cell, switch, motor-driver',
      'sense: bumper-switch',
      'actuators: dc-motor, servo-motor',
      'drivetrain: wheel-large, wheel-small, gearbox',
      'structure-and-ride: chassis, caster',
      'output: led, buzzer',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// The kit robots: one working fixture robot per kit, in fixtures/blueprints/ and registered in FIXTURES. sim-core's
// tick loop (task 1.5) is not here yet, so these tests judge the wiring with the schema's need judging (wiredNeeds)
// and the motion with its geometry (drivePushes); the golden-run harness (task 1.7) replays each fixture and asserts
// its `expect`.

const ROBOTS = [
  { name: 'kit-rolling-start', kit: 'rolling-start' },
  { name: 'kit-circuit-crew', kit: 'circuit-crew' },
] as const;

const fixtures = loadFixtures();

const fixture = (name: string): ContentFixture => {
  const found = fixtures.fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No valid content fixture '${name}'; the fixture tests list why.`);
  return found;
};

const robot = (name: string): Blueprint => fixture(name).blueprint;

const primitivesOf = (part: PlacedPart): readonly Primitive[] => record(part.part).behaviour;

/** `part: failure mode` for every unmet need the controls do not explain, sorted. */
const faults = (blueprint: Blueprint, state: ControlState = {}): string[] =>
  wiredNeeds(blueprint, catalogue, state)
    .filter((verdict) => verdict.unmet !== undefined && verdict.explainedBy === undefined)
    .map((verdict) => {
      const type = blueprint.parts.find((part) => part.id === verdict.partId)?.part ?? '';
      const mode = record(type).failureModes.find((failure) => failure.need === verdict.need && failure.unmet === verdict.unmet);
      return `${verdict.partId}: ${mode?.id ?? `${verdict.need} ${verdict.unmet ?? ''}`}`;
    })
    .sort();

/** The parts with a need left unmet at this state that the given control explains. */
const stoppedBy = (blueprint: Blueprint, state: ControlState, control: string): string[] => [
  ...new Set(
    wiredNeeds(blueprint, catalogue, state)
      .filter((verdict) => verdict.explainedBy?.by === 'controls' && verdict.explainedBy.controls.includes(control))
      .map((verdict) => verdict.partId),
  ),
];

/**
 * Which way each speed actuator turns at a control state, read from the wiring: 1 when its plus traces to the plus of
 * what feeds it (a battery pack, or a motor-driver channel commanded forward whose own plus does), −1 when it traces
 * the other way, 0 when nothing feeds it. Settings are at their defaults in these robots (a test checks it).
 */
const turning = (blueprint: Blueprint, state: ControlState = {}): ReadonlyMap<string, number> => {
  const rest = new Map(controlsOf(blueprint, catalogue).map((control) => [control.id, control.rest] as const));
  const closed = (control: string): boolean => state.switches?.[control] ?? rest.get(control) === true;
  const command = (control: string): number => state.channels?.[control] ?? Number(rest.get(control) ?? 0);
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
    for (const p of primitivesOf(part)) if (p.kind === 'switch' && closed(`${part.id}/${p.id}`)) join(`${part.id}.${p.terminals[0]}`, `${part.id}.${p.terminals[1]}`);
  }
  const feeds: { readonly pos: string; readonly neg: string; readonly sign: number }[] = [];
  const signOf = (part: string, supply: { readonly pos: string; readonly neg: string }): number => {
    const [plus, minus] = [find(`${part}.${supply.pos}`), find(`${part}.${supply.neg}`)];
    const feed = feeds.find((candidate) => (candidate.pos === plus && candidate.neg === minus) || (candidate.pos === minus && candidate.neg === plus));
    return feed === undefined ? 0 : (feed.pos === plus ? 1 : -1) * feed.sign;
  };
  for (const part of blueprint.parts) {
    for (const p of primitivesOf(part)) if (p.kind === 'source') feeds.push({ pos: find(`${part.id}.${p.output.pos}`), neg: find(`${part.id}.${p.output.neg}`), sign: 1 });
  }
  for (const part of blueprint.parts) {
    for (const p of primitivesOf(part)) {
      if (p.kind !== 'driver') continue;
      const sign = Math.sign(command(`${part.id}/${p.id}`)) * signOf(part.id, p.supply);
      feeds.push({ pos: find(`${part.id}.${p.output.pos}`), neg: find(`${part.id}.${p.output.neg}`), sign });
    }
  }
  return new Map(
    blueprint.parts.flatMap((part) =>
      primitivesOf(part).flatMap((p) => (p.kind === 'actuator' && p.mode === 'speed' ? [[part.id, signOf(part.id, p.supply) * (p.reverse ? -1 : 1)] as const] : [])),
    ),
  );
};

/** Each drive wheel's push along the robot's +x at a control state: 1 forward, −1 backward, 0 none. */
const pushes = (blueprint: Blueprint, state: ControlState = {}): string[] => {
  const signs = turning(blueprint, state);
  return drivePushes(blueprint, catalogue).map(({ wheel, actuator, push }) => `${wheel} ${String(push * (signs.get(actuator) ?? 0) || 0)}`);
};

interface Box {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Each part's body box in its robot's frame. A part frame's origin is the centre of its footprint on its base. */
const boxesOf = (blueprint: Blueprint): Box[] => {
  const placements = placeParts(blueprint, catalogue);
  return blueprint.parts.map((part) => {
    const where = placements.get(part.id);
    if (!where) throw new Error(`No placement for '${part.id}'.`);
    const { size } = record(part.part).body;
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sy) => [0, 1].map((sz) => placePoint(where.placement, { x: (sx * size.x) / 2, y: (sy * size.y) / 2, z: sz * size.z }))),
    );
    const least = (axis: keyof Vec3): number => Math.min(...corners.map((corner) => corner[axis]));
    const most = (axis: keyof Vec3): number => Math.max(...corners.map((corner) => corner[axis]));
    return { id: part.id, min: { x: least('x'), y: least('y'), z: least('z') }, max: { x: most('x'), y: most('y'), z: most('z') } };
  });
};

/** How far the robot reaches ahead of its chassis's centre: the front of its furthest body box (mm). */
const frontOf = (blueprint: Blueprint): number => Math.max(...boxesOf(blueprint).map((box) => box.max.x));

/** How far ahead of a preset's start pose a floor point lies, along the start heading (mm). */
const aheadOf = (preset: ArenaPreset, x: number, y: number): number => {
  const [cos, sin] = cosSin(preset.start.heading);
  return (x - preset.start.x) * cos + (y - preset.start.y) * sin;
};

/** How far the start pose's heading runs before it leaves the floor, which the floor's edge stops as a wall (D19). */
const toFloorEdge = (preset: ArenaPreset): number => {
  const [cos, sin] = cosSin(preset.start.heading);
  const along = (from: number, size: number, step: number): number =>
    step > 1e-9 ? (size - from) / step : step < -1e-9 ? -from / step : Number.POSITIVE_INFINITY;
  return Math.min(along(preset.start.x, preset.size.x, cos), along(preset.start.y, preset.size.y, sin));
};

/** The ground a wheel covers each second at its motor's no-load speed on these volts: no robot goes faster (mm/s). */
const topSpeed = (blueprint: Blueprint, volts: number): number => {
  const behaviourOf = (id: string): readonly Primitive[] => record(blueprint.parts.find((part) => part.id === id)?.part ?? '').behaviour;
  const speeds = drivePushes(blueprint, catalogue).map(({ wheel, actuator }) => {
    const motor = behaviourOf(actuator).find((p) => p.kind === 'actuator');
    const tyre = behaviourOf(wheel).find((p) => p.kind === 'wheel');
    if (motor?.kind !== 'actuator' || motor.mode !== 'speed' || tyre?.kind !== 'wheel') throw new Error(`'${wheel}' is not a wheel on a DC motor.`);
    return ((motor.noLoadRpm * volts) / motor.ratedVolts / 60) * 2 * Math.PI * tyre.radiusMm;
  });
  return Math.max(...speeds);
};

const freshVolts = (): number => {
  const cells = record('battery-pack-2-cell').behaviour.find((p) => p.kind === 'source');
  if (cells?.kind !== 'source') throw new Error('The 2-cell battery pack has no source.');
  return cells.volts;
};

describe('the kit robots', () => {
  it('are one content fixture per kit, named after it', () => {
    expect(Object.keys(FIXTURES).filter((name) => name.startsWith('kit-')).sort()).toEqual(content.kits.map((bag) => `kit-${bag.id}`).sort());
    expect(robotFiles.map(({ file }) => file).sort()).toEqual(['kit-circuit-crew.json', 'kit-rolling-start.json']);
  });
});

describe.each(ROBOTS)('the $kit kit robot ($name)', ({ name, kit: kitId }) => {
  it('loads as a content fixture with no issues, at its kit’s level, and expects a Run with no fault', () => {
    expect(fixtures.issues.filter((issue) => issue.file.includes(name) || issue.path.includes(name)).map(({ file, code, path }) => `${file} ${code} at ${path}`)).toEqual([]);
    const loaded = fixture(name);
    expect(loaded.blueprint.meta.level).toBe(kit(kitId).level);
    expect(loaded.challenge).toBeUndefined();
    expect(loaded.expect).toEqual({ faults: [] });
  });

  it('is a valid blueprint, stored in canonical form', () => {
    const found = robotFiles.find(({ file }) => file === `${name}.json`);
    if (!found) throw new Error(`packages/content/fixtures/blueprints/${name}.json is missing.`);
    const blueprint = valid(validateBlueprint(JSON.parse(found.text), catalogue), found.file);
    expect(serializeBlueprint(canonicalizeBlueprint(blueprint, catalogue))).toBe(found.text);
  });

  it('is built only from its kit’s parts, no more of each than the kit holds, each at its default settings', () => {
    const used: Record<string, number> = {};
    for (const part of robot(name).parts) used[part.part] = (used[part.part] ?? 0) + 1;
    const held = contents(kit(kitId));
    expect(Object.entries(used).filter(([part, count]) => count > (held[part] ?? 0))).toEqual([]);
    expect(robot(name).parts.filter((part) => Object.keys(part.settings).length > 0)).toEqual([]);
  });

  it('holds every part on the chassis, each on the canvas where its mount or its motor’s shaft puts it', () => {
    const blueprint = robot(name);
    const placements = placeParts(blueprint, catalogue);
    expect(robotRoot(placements)).toBe('chassis');
    expect([...placements].filter(([, where]) => where.root !== 'chassis').map(([id]) => id)).toEqual([]);
    const poses = new Map<string, CanvasPose & { readonly mirrored: boolean }>();
    const poseOf = (id: string): CanvasPose & { readonly mirrored: boolean } => {
      const known = poses.get(id);
      if (known) return known;
      const where = placements.get(id);
      const part = blueprint.parts.find((candidate) => candidate.id === id);
      if (!where || !part) throw new Error(`No placement for '${id}'.`);
      const pose = where.parent === undefined ? { ...part.position, rotation: part.rotation, mirrored: false } : canvasPoseOf(poseOf(where.parent), where.local);
      poses.set(id, pose);
      return pose;
    };
    for (const part of blueprint.parts) {
      const { x, y, rotation } = poseOf(part.id);
      expect([part.id, x, y, rotation]).toEqual([part.id, part.position.x, part.position.y, part.rotation]);
    }
  });

  it('keeps every part’s body clear of every other part’s body', () => {
    const boxes = boxesOf(robot(name));
    const overlapping = boxes.flatMap((a, index) =>
      boxes
        .slice(index + 1)
        .filter((b) => (['x', 'y', 'z'] as const).every((axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 0.01))
        .map((b) => `${a.id} and ${b.id}`),
    );
    expect(overlapping).toEqual([]);
  });

  it('meets every power, loop and isolation need at rest, so it has no fault (wiredNeeds)', () => {
    expect(wiredNeeds(robot(name), catalogue).filter((verdict) => verdict.unmet !== undefined)).toEqual([]);
    expect(faults(robot(name))).toEqual([]);
  });

  it('drives forward at rest: both drive wheels push the robot ahead', () => {
    expect(pushes(robot(name))).toEqual(['wheel-left 1', 'wheel-right 1']);
  });
});

describe('the Rolling Start kit robot', () => {
  const name = 'kit-rolling-start';

  it('runs on the open floor, where the child opens its switch after 2 seconds', () => {
    expect(robot(name).arena.preset).toBe('open-floor');
    expect(fixture(name).inputs).toEqual([{ tick: 2 * TICK_RATE, partId: 'switch', kind: 'switch', closed: false }]);
  });

  it('stops with no fault when the child opens the switch: an open switch is an input, and it explains everything it stops', () => {
    const pressed: ControlState = { switches: { 'switch/contacts': false } };
    expect(faults(robot(name), pressed)).toEqual([]);
    expect(stoppedBy(robot(name), pressed, 'switch/contacts').sort()).toEqual(['battery', 'motor-left', 'motor-right']);
    expect(pushes(robot(name), pressed)).toEqual(['wheel-left 0', 'wheel-right 0']);
  });

  it('cannot reach the floor’s edge in its Run, even driving the whole Run at its motors’ top speed on a fresh battery pack', () => {
    const { ticks } = fixture(name);
    const room = toFloorEdge(arena('open-floor')) - frontOf(robot(name));
    expect((ticks / TICK_RATE) * topSpeed(robot(name), freshVolts())).toBeLessThan(room);
  });
});

describe('the Circuit Crew kit robot', () => {
  const name = 'kit-circuit-crew';

  it('runs through the motor driver, with the bumper switch at its front, in the wall stop arena', () => {
    expect(robot(name).arena.preset).toBe('wall-stop');
    expect(robot(name).parts.map((part) => part.part)).toEqual(expect.arrayContaining(['motor-driver', 'bumper-switch']));
    expect(fixture(name).inputs).toEqual([]);
  });

  it('meets the far wall with its bumper switch first: the probe is the robot’s front, across its middle', () => {
    const blueprint = robot(name);
    const bumper = blueprint.parts.find((part) => part.part === 'bumper-switch');
    const contacts = record('bumper-switch').behaviour.find((p) => p.kind === 'switch');
    if (!bumper || contacts?.kind !== 'switch' || contacts.actuation.kind !== 'contact') throw new Error('The robot has no bumper switch.');
    expect(contacts.actuation.normally).toBe('closed');
    const where = placeParts(blueprint, catalogue).get(bumper.id)?.placement;
    if (!where) throw new Error('No placement for the bumper switch.');
    const ends = [contacts.actuation.probe.from, contacts.actuation.probe.to].map((end) => placePoint(where, { x: end.x, y: end.y, z: 0 }));
    for (const end of ends) expect(end.x).toBe(frontOf(blueprint));
    expect(Math.min(...ends.map((end) => end.y))).toBeLessThan(0);
    expect(Math.max(...ends.map((end) => end.y))).toBeGreaterThan(0);
  });

  it('stops at the wall with no fault: the pressed bumper switch explains everything it stops, LED and buzzer too', () => {
    const pressed: ControlState = { switches: { 'bumper/contacts': false } };
    expect(faults(robot(name), pressed)).toEqual([]);
    expect(stoppedBy(robot(name), pressed, 'bumper/contacts').sort()).toEqual(['battery', 'buzzer', 'driver', 'led', 'motor-left', 'motor-right', 'switch']);
    expect(pushes(robot(name), pressed)).toEqual(['wheel-left 0', 'wheel-right 0']);
  });

  it('shows no fault at any setting of its controls: either switch, and each motor-driver channel forward, stop or backward', () => {
    const controls = controlsOf(robot(name), catalogue);
    expect(controls.map((control) => `${control.id} ${control.kind}`)).toEqual(['bumper/contacts switch', 'driver/channel-a channel', 'driver/channel-b channel', 'switch/contacts switch']);
    const states: ControlState[] = [];
    for (const bumper of [true, false]) {
      for (const power of [true, false]) {
        for (const a of [1, 0, -1]) {
          for (const b of [1, 0, -1]) {
            states.push({ switches: { 'bumper/contacts': bumper, 'switch/contacts': power }, channels: { 'driver/channel-a': a, 'driver/channel-b': b } });
          }
        }
      }
    }
    expect(states.flatMap((state) => faults(robot(name), state).map((fault) => `${JSON.stringify(state)}: ${fault}`))).toEqual([]);
    // Channel A backward turns the left motor the other way, so the robot spins on the spot: behaviour, not a fault.
    expect(pushes(robot(name), { channels: { 'driver/channel-a': -1 } })).toEqual(['wheel-left -1', 'wheel-right 1']);
  });

  it('runs at least twice as long as its drive to the far wall takes at its motors’ top speed, so the Run always reaches the stop', () => {
    const preset = arena('wall-stop');
    const wall = preset.walls.find((candidate) => candidate.id === 'far-wall');
    if (!wall) throw new Error('The wall stop preset has no far wall.');
    const toWall = Math.min(aheadOf(preset, wall.from.x, wall.from.y), aheadOf(preset, wall.to.x, wall.to.y)) - wall.thicknessMm / 2 - frontOf(robot(name));
    const channel = record('motor-driver').behaviour.find((p) => p.kind === 'driver');
    if (channel?.kind !== 'driver') throw new Error('The motor driver has no channel.');
    const seconds = toWall / topSpeed(robot(name), freshVolts() - channel.dropVolts);
    expect(fixture(name).ticks / TICK_RATE).toBeGreaterThanOrEqual(2 * seconds);
  });
});

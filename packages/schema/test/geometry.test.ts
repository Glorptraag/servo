import { describe, expect, it } from 'vitest';
import { validBlueprints } from '../src/fixtures.ts';
import {
  arenaPoseOf,
  canvasPoseOf,
  composePlacements,
  drivePushes,
  makeCatalogue,
  mountPlacement,
  placeParts,
  placePoint,
  robotRoot,
  spin,
  validateBlueprint,
} from '../src/index.ts';
import type { Blueprint, Catalogue, MountPointPort, MountPort, PartRecord, Placement, Vec3 } from '../src/index.ts';
import { arenas, catalogue, copy, part, parts, unwrap } from './support.ts';

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name);
  if (!found) throw new Error(`No fixture ${name}`);
  return unwrap(validateBlueprint(found.data, catalogue));
};

const portOf = <T>(record: PartRecord, id: string): T => {
  const found = record.ports.find((port) => port.id === id);
  if (!found) throw new Error(`No port ${id} on ${record.id}`);
  return found as T;
};

const chassis = part('chassis');
const motor = part('dc-motor');
const motorMount = portOf<MountPort>(motor, 'mount');

describe('the turning rule and mirrored mount points', () => {
  it('turns a shaft right-handed about its axis at positive speed', () => {
    const upright: Placement = { x: 0, y: 0, z: 0, yaw: 0, mirrored: false };
    expect(spin(upright, '+y')).toEqual({ x: 0, y: 1, z: 0 });
    expect(spin({ ...upright, yaw: 90 }, '+x')).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('flips the turning sense on a mirrored mount point', () => {
    const left = mountPlacement(portOf<MountPointPort>(chassis, 'motor-left'), motorMount);
    const right = mountPlacement(portOf<MountPointPort>(chassis, 'motor-right'), motorMount);
    expect(right.mirrored).toBe(true);
    // The shafts point opposite ways, yet both motors turn the same way in the chassis frame.
    expect(placePoint(left, { x: 0, y: 1, z: 0 }).y - left.y).toBe(1);
    expect(placePoint(right, { x: 0, y: 1, z: 0 }).y - right.y).toBe(-1);
    expect(spin(left, '+y')).toEqual(spin(right, '+y'));
  });

  it('keeps mirrors and quarter turns exact through composition', () => {
    const a: Placement = { x: 10, y: 0, z: 0, yaw: 90, mirrored: true };
    const b: Placement = { x: 0, y: 5, z: 1, yaw: 90, mirrored: false };
    const p: Vec3 = { x: 1, y: 2, z: 3 };
    expect(placePoint(composePlacements(a, b), p)).toEqual(placePoint(a, placePoint(b, p)));
    expect(composePlacements(a, b)).toMatchObject({ yaw: 0, mirrored: true });
  });
});

describe('placing the fixture robots', () => {
  const drives = (name: string) => {
    const blueprint = fixture(name);
    const placements = placeParts(blueprint, catalogue);
    return drivePushes(blueprint, catalogue).map((push) => {
      const wheel = placements.get(push.wheel);
      const hub = portOf<{ at: Vec3 }>(part('wheel-large'), 'hub');
      if (!wheel) throw new Error(`No placement for ${push.wheel}`);
      return { ...push, axle: placePoint(wheel.placement, hub.at), floor: wheel.placement.z };
    });
  };

  it.each(['rolling-start', 'reversed-motor', 'bumper-robot'])('%s: the drive axles are coaxial', (name) => {
    const [left, right] = drives(name);
    expect(left?.axle.x).toBe(right?.axle.x);
    expect(left?.axle.z).toBe(right?.axle.z);
    expect(left?.axle.y).toBe(-(right?.axle.y ?? 0));
  });

  it.each(['rolling-start', 'bumper-robot'])('%s: the drive wheels clear the chassis plate, and the drive parts sit on it', (name) => {
    const blueprint = fixture(name);
    const placements = placeParts(blueprint, catalogue);
    const edge = chassis.body.size.y / 2;
    // How far the part's body box reaches from the chassis's centre line: nearest and furthest.
    const reach = (id: string): [number, number] => {
      const where = placements.get(id);
      const record = catalogue.parts.get(blueprint.parts.find((placed) => placed.id === id)?.part ?? '');
      if (!where || !record) throw new Error(`No placement for ${id}`);
      const ys = [-1, 1].map((side) => Math.abs(placePoint(where.placement, { x: 0, y: (side * record.body.size.y) / 2, z: 0 }).y));
      return [Math.min(...ys), Math.max(...ys)];
    };
    for (const wheel of ['wheel-left', 'wheel-right']) expect(reach(wheel)[0]).toBeGreaterThan(edge);
    const onPlate = name === 'bumper-robot' ? ['motor-left', 'motor-right', 'gear-left', 'gear-right'] : ['motor-left', 'motor-right'];
    for (const id of onPlate) expect(reach(id)[1]).toBeLessThanOrEqual(edge);
  });

  it.each(['rolling-start', 'bumper-robot'])('%s: the caster reaches the same floor as the wheels', (name) => {
    const placements = placeParts(fixture(name), catalogue);
    const floors = drives(name).map((drive) => drive.floor);
    expect(new Set(floors).size).toBe(1);
    expect(placements.get('caster')?.placement.z).toBe(floors[0]);
  });

  it('roots every part of rolling-start on the chassis, mounted or carried', () => {
    const placements = placeParts(fixture('rolling-start'), catalogue);
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

  it('pushes both rolling-start wheels forward when their motors turn at positive speed', () => {
    expect(drivePushes(fixture('rolling-start'), catalogue)).toEqual([
      { wheel: 'wheel-left', actuator: 'motor-left', root: 'chassis', push: 1 },
      { wheel: 'wheel-right', actuator: 'motor-right', root: 'chassis', push: 1 },
    ]);
  });

  it('would spin a robot with alike wiring if the right motor mount were not mirrored', () => {
    const plain = copy(chassis) as unknown as { ports: { id: string; yaw: number; mirrored: boolean }[] };
    const right = plain.ports.find((port) => port.id === 'motor-right');
    if (right) Object.assign(right, { yaw: 180, mirrored: false });
    const unmirrored: Catalogue = makeCatalogue({ parts: [plain as unknown as PartRecord, ...parts], arenas });
    expect(drivePushes(fixture('rolling-start'), unmirrored).map((push) => push.push)).toEqual([1, -1]);
  });

  it('places parts the same whatever the wire order', () => {
    const blueprint = fixture('bumper-robot');
    const reversed = { ...blueprint, wires: [...blueprint.wires].reverse() };
    expect([...placeParts(reversed, catalogue)].sort()).toEqual([...placeParts(blueprint, catalogue)].sort());
  });

  it('ends on a mount loop, dropping the link that closes it', () => {
    const bracket = {
      ...copy(part('caster')),
      id: 'bracket',
      ports: [
        { id: 'mount', type: 'mechanical', label: 'mount', role: 'mount', at: { x: 0, y: 0, z: 0 }, yaw: 0 },
        { id: 'point', type: 'mechanical', label: 'mount point', role: 'mount-point', at: { x: 0, y: 0, z: 14 }, yaw: 0, mirrored: false },
      ],
    } as unknown as PartRecord;
    const withBracket = makeCatalogue({ parts: [bracket, ...parts], arenas });
    const placed = (id: string) => ({ id, part: 'bracket', position: { x: 0, y: 0 }, rotation: 0, settings: {} });
    const looped: Blueprint = {
      ...fixture('led-circuit'),
      parts: [placed('one'), placed('two')],
      wires: [
        { id: 'w1', from: { part: 'one', port: 'mount' }, to: { part: 'two', port: 'point' } },
        { id: 'w2', from: { part: 'two', port: 'mount' }, to: { part: 'one', port: 'point' } },
      ],
    };
    const placements = placeParts(looped, withBracket);
    expect([...placements.values()].map((where) => where.by).sort()).toEqual(['mount', 'root']);
  });

  it('stops a gearbox driving once it is loose', () => {
    const blueprint = fixture('bumper-robot');
    const loose = { ...blueprint, wires: blueprint.wires.filter((wire) => !(wire.from.part === 'gear-left' && wire.from.port === 'mount')) };
    expect(drivePushes(loose, catalogue).map((push) => push.wheel)).toEqual(['wheel-right']);
  });
});

/**
 * Which way an actuator turns from its wiring, by the power need's rule: every switch counts as closed.
 * +1 when its plus side traces to a source's plus and its minus side to that source's minus, −1 when
 * crossed, 0 with no such loop. A driver channel counts as a source whose sign is its command, when its
 * own supply traces the right way round.
 */
const turningSign = (blueprint: Blueprint, actuatorId: string): number => {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
    return root;
  };
  const join = (a: string, b: string): void => {
    if (find(a) !== find(b)) parent.set(find(a), find(b));
  };
  const recordOf = (id: string): PartRecord | undefined =>
    catalogue.parts.get(blueprint.parts.find((placed) => placed.id === id)?.part ?? '');
  for (const wire of blueprint.wires) join(`${wire.from.part}.${wire.from.port}`, `${wire.to.part}.${wire.to.port}`);
  for (const placed of blueprint.parts) {
    for (const primitive of recordOf(placed.id)?.behaviour ?? []) {
      if (primitive.kind === 'switch') join(`${placed.id}.${primitive.terminals[0]}`, `${placed.id}.${primitive.terminals[1]}`);
    }
  }
  const same = (a: string, b: string): boolean => find(a) === find(b);
  const sources: { pos: string; neg: string; sign: number }[] = [];
  for (const placed of blueprint.parts) {
    for (const primitive of recordOf(placed.id)?.behaviour ?? []) {
      if (primitive.kind === 'source') sources.push({ pos: `${placed.id}.${primitive.output.pos}`, neg: `${placed.id}.${primitive.output.neg}`, sign: 1 });
    }
  }
  const polarity = (pos: string, neg: string, among: readonly { pos: string; neg: string; sign: number }[]): number => {
    for (const source of among) {
      if (same(pos, source.pos) && same(neg, source.neg)) return source.sign;
      if (same(pos, source.neg) && same(neg, source.pos)) return -source.sign;
    }
    return 0;
  };
  const channels: { pos: string; neg: string; sign: number }[] = [];
  for (const placed of blueprint.parts) {
    const record = recordOf(placed.id);
    for (const primitive of record?.behaviour ?? []) {
      if (primitive.kind !== 'driver') continue;
      const setting = record?.settings.find((candidate) => candidate.binds.primitive === primitive.id && candidate.binds.param === 'command');
      const chosen = setting?.kind === 'choice' ? setting.options.find((option) => option.id === (placed.settings[setting.id] ?? setting.default)) : undefined;
      const command = typeof chosen?.value === 'number' ? chosen.value : primitive.command;
      const powered = polarity(`${placed.id}.${primitive.supply.pos}`, `${placed.id}.${primitive.supply.neg}`, sources) > 0;
      channels.push({ pos: `${placed.id}.${primitive.output.pos}`, neg: `${placed.id}.${primitive.output.neg}`, sign: powered ? Math.sign(command) : 0 });
    }
  }
  const actuator = recordOf(actuatorId)?.behaviour.find((primitive) => primitive.kind === 'actuator');
  if (!actuator || actuator.mode !== 'speed') return 0;
  const wiring = polarity(`${actuatorId}.${actuator.supply.pos}`, `${actuatorId}.${actuator.supply.neg}`, [...sources, ...channels]);
  return actuator.reverse ? -wiring : wiring;
};

const motionOf = (blueprint: Blueprint): string => {
  const pushes = drivePushes(blueprint, catalogue).map((push) => push.push * turningSign(blueprint, push.actuator));
  if (pushes.length === 0) return 'none';
  if (pushes.every((push) => push > 0)) return 'forward';
  if (pushes.some((push) => push > 0) && pushes.some((push) => push < 0)) return 'spin';
  return 'other';
};

describe('every valid fixture moves as its label says', () => {
  it.each(validBlueprints)('$name: $motion', ({ name, motion }) => {
    expect(motionOf(fixture(name))).toBe(motion);
  });

  it('drives rolling-start straight and spins reversed-motor', () => {
    expect(motionOf(fixture('rolling-start'))).toBe('forward');
    expect(motionOf(fixture('reversed-motor'))).toBe('spin');
  });
});

describe('the canvas and the arena', () => {
  it('derives a mounted part’s canvas pose from its host’s, as the validator requires', () => {
    const host = { x: 100, y: 50, rotation: 90 };
    const placement = mountPlacement(portOf<MountPointPort>(chassis, 'motor-left'), motorMount);
    // Turned a quarter clockwise, the chassis's left (+y) points to the canvas's right (+x).
    expect(canvasPoseOf(host, placement)).toEqual({ x: 153, y: 80, rotation: 90, mirrored: false });
  });

  it('draws a part on a mirrored mount point as its mirror image', () => {
    const host = { x: 100, y: 50, rotation: 90 };
    const placement = mountPlacement(portOf<MountPointPort>(chassis, 'motor-right'), motorMount);
    expect(canvasPoseOf(host, placement)).toEqual({ x: 47, y: 80, rotation: 90, mirrored: true });
    // Under a mirrored parent the child's left points the other way and its turns run the other way;
    // a second mirror cancels the first.
    const mirroredHost = { x: 0, y: 0, rotation: 0, mirrored: true };
    expect(canvasPoseOf(mirroredHost, { x: 10, y: 5, z: 0, yaw: 90, mirrored: false })).toEqual({ x: 10, y: 5, rotation: 90, mirrored: true });
    expect(canvasPoseOf(mirroredHost, { x: 10, y: 5, z: 0, yaw: 0, mirrored: true })).toMatchObject({ mirrored: false });
  });

  it('places a part the same in one step or through its mirrored host', () => {
    const root = { x: 12, y: -7, rotation: 30 };
    const outer: Placement = { x: 30, y: -53, z: 6, yaw: 90, mirrored: true };
    const inner: Placement = { x: 10, y: 26, z: -22.5, yaw: 270, mirrored: false };
    const direct = canvasPoseOf(root, composePlacements(outer, inner));
    const stepwise = canvasPoseOf(canvasPoseOf(root, outer), inner);
    expect(stepwise.rotation).toBe(direct.rotation);
    expect(stepwise.mirrored).toBe(direct.mirrored);
    expect(Math.abs(stepwise.x - direct.x)).toBeLessThan(1e-9);
    expect(Math.abs(stepwise.y - direct.y)).toBeLessThan(1e-9);
  });

  it('starts the root part at the arena start, and loose parts where they lie relative to it', () => {
    const start = { x: 300, y: 600, heading: 90 };
    const root = { x: 10, y: 10, rotation: 0 };
    expect(arenaPoseOf(start, root, root)).toEqual(start);
    // 50 mm to the canvas's right is 50 mm ahead of the root; with the root facing +y, that is +y in the arena.
    expect(arenaPoseOf(start, root, { x: 60, y: 10, rotation: 0 })).toEqual({ x: 300, y: 650, heading: 90 });
    // 20 mm up the canvas is 20 mm to the root's left: −x in the arena.
    expect(arenaPoseOf(start, root, { x: 10, y: -10, rotation: 270 })).toEqual({ x: 280, y: 600, heading: 180 });
  });
});

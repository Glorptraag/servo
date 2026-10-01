// The command layer (task 3.2): applyEdit for every command but wiring, and batches. Each success is checked to be a
// blueprint validateBlueprint accepts, in canonical form. See docs/placement.md and docs/commands.md.
import { describe, expect, it } from 'vitest';
import { canonicalizeBlueprint, canvasPoseOf, makeCatalogue, serializeBlueprint, validateBlueprint } from '@servo/schema';
import type { Blueprint, Catalogue, PartRecord, PlacedPart, PortSpec } from '@servo/schema';
import { applyEdit } from '../../src/index.ts';
import type { EditCommand, EditResult } from '../../src/interface.ts';
import { separation, FREE_GAP_MM } from '../../src/placement/free-spot.ts';
import { tileOutline } from '../../src/placement/rules.ts';
import { blueprintOf, catalogue, fixture, parts, record } from '../helpers/catalogue.ts';
import { fixtureNames, placeCommands, placedFixture, planFor, settingCommands, startOf } from '../helpers/plans.ts';

/** Applies a command that must succeed, and checks what it gives: valid, canonical, and new. */
const ok = (build: Blueprint, command: EditCommand, against: Catalogue = catalogue): Blueprint => {
  const before = serializeBlueprint(build);
  const result = applyEdit(build, command, against);
  if (!result.ok) throw new Error(`${command.kind} refused: ${result.refusal.code} ${result.refusal.message}`);
  expect(serializeBlueprint(build), 'the input is untouched').toBe(before);
  const checked = validateBlueprint(result.blueprint, against);
  expect(checked.ok && serializeBlueprint(canonicalizeBlueprint(checked.value, against))).toBe(serializeBlueprint(result.blueprint));
  expect(result.blueprint.parts.map((part) => part.id)).toEqual([...result.blueprint.parts.map((part) => part.id)].sort());
  return result.blueprint;
};

const refused = (build: Blueprint, command: EditCommand, against: Catalogue = catalogue): Extract<EditResult, { ok: false }>['refusal'] => {
  const result = applyEdit(build, command, against);
  if (result.ok) throw new Error(`${command.kind} was not refused`);
  return result.refusal;
};

const run = (build: Blueprint, commands: readonly EditCommand[], against: Catalogue = catalogue): Blueprint =>
  commands.reduce((current, command) => ok(current, command, against), build);

const part = (build: Blueprint, id: string): PlacedPart => {
  const found = build.parts.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no part ${id}`);
  return found;
};

const at = (build: Blueprint, id: string): [number, number, number] => {
  const { position, rotation } = part(build, id);
  return [position.x, position.y, rotation];
};

const wireBetween = (build: Blueprint, a: string, b: string): boolean =>
  build.wires.some((wire) => (wire.from.part === a && wire.to.part === b) || (wire.from.part === b && wire.to.part === a));

const empty = (arena: Blueprint['arena'] = { preset: 'open-floor', props: [] }): Blueprint => blueprintOf({ parts: [], wires: [], arena });

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
};

describe('the schema fixtures, built by commands (byte-identical)', () => {
  it.each(fixtureNames)('%s: every part placed as the fixture has it, then its arena, name and settings', (name) => {
    const plan = planFor(name);
    // A new build, as the store makes one: the fixture's identity, a placeholder name, the open floor.
    const start: Blueprint = { ...startOf(plan), arena: { preset: 'open-floor', props: [] }, meta: { ...startOf(plan).meta, name: 'New build' } };
    const commands: EditCommand[] = [
      { kind: 'rename', name: plan.fixture.meta.name },
      { kind: 'set-arena', arena: plan.fixture.arena },
      ...placeCommands(plan),
      ...settingCommands(plan),
    ];
    const built = run(start, commands);
    expect(serializeBlueprint(built)).toBe(serializeBlueprint(placedFixture(plan)));
  });

  it('gives the same bytes when the same commands run again, and as one batch', () => {
    const plan = planFor('bumper-robot');
    const commands = [...placeCommands(plan), ...settingCommands(plan)];
    const once = run(startOf(plan), commands);
    const again = run(startOf(plan), commands);
    const batched = ok(startOf(plan), { kind: 'batch', commands });
    expect(serializeBlueprint(again)).toBe(serializeBlueprint(once));
    expect(serializeBlueprint(batched)).toBe(serializeBlueprint(once));
  });

  it('never changes its input, even a frozen one', () => {
    const frozen = deepFreeze(fixture('rolling-start'));
    expect(() => {
      for (const command of [
        { kind: 'move-part', partId: 'chassis', position: { x: 50, y: 50 } },
        { kind: 'remove-part', partId: 'motor-right' },
        { kind: 'rename', name: 'Frozen' },
        { kind: 'place-part', part: 'led' },
      ] as const) {
        expect(applyEdit(frozen, command, catalogue).ok).toBe(true);
      }
    }).not.toThrow();
  });
});

describe('place-part', () => {
  it('places a part loose where it is told, with the next p<n> id and default settings', () => {
    const build = ok(empty(), { kind: 'place-part', part: 'dc-motor', position: { x: 12.5, y: -40 }, rotation: 90 });
    expect(build.parts).toEqual([{ id: 'p1', part: 'dc-motor', position: { x: 12.5, y: -40 }, rotation: 90, settings: {} }]);
    expect(build.meta.highWater).toEqual({ parts: 1, wires: 0 });
  });

  it('never gives an id out again, even after the part with it is removed', () => {
    const build = run(empty(), [
      { kind: 'place-part', part: 'led', position: { x: 0, y: 0 } },
      { kind: 'remove-part', partId: 'p1' },
      { kind: 'place-part', part: 'led', position: { x: 0, y: 0 } },
    ]);
    expect(build.parts.map((placed) => placed.id)).toEqual(['p2']);
  });

  it('without a spot, lands at the canvas origin on an empty canvas', () => {
    expect(at(ok(empty(), { kind: 'place-part', part: 'switch' }), 'p1')).toEqual([0, 0, 0]);
  });

  it('without a spot, lands at the free spot nearest the middle of the build, clear of every tile, the same every time', () => {
    const robot = fixture('rolling-start');
    const first = ok(robot, { kind: 'place-part', part: 'battery-pack-2-cell' });
    const second = ok(robot, { kind: 'place-part', part: 'battery-pack-2-cell' });
    expect(serializeBlueprint(first)).toBe(serializeBlueprint(second));
    const placed = part(first, 'p1');
    const tile = tileOutline(record(placed.part), { ...placed.position, rotation: 0, mirrored: false });
    for (const other of first.parts.filter((candidate) => candidate.id !== 'p1')) {
      const pose = { ...other.position, rotation: other.rotation, mirrored: false };
      expect(separation(tile, tileOutline(record(other.part), pose)), other.id).toBeGreaterThanOrEqual(FREE_GAP_MM - 1e-9);
    }
    expect(Math.hypot(placed.position.x, placed.position.y)).toBeLessThan(200);
  });

  it('attaches by its mount onto a free mount point, where the mount puts it', () => {
    const chassis = ok(empty(), { kind: 'place-part', part: 'chassis', position: { x: 0, y: 0 } });
    const build = ok(chassis, { kind: 'place-part', part: 'dc-motor', position: { x: 999, y: 999 }, rotation: 45, attach: { port: 'mount', onto: { part: 'p1', port: 'motor-left' } } });
    expect(at(build, 'p2')).toEqual([30, -53, 0]);
    expect(build.wires).toEqual([{ id: 'w1', from: { part: 'p2', port: 'mount' }, to: { part: 'p1', port: 'motor-left' } }]);
    expect(build.meta.highWater).toEqual({ parts: 2, wires: 1 });
  });

  it('attaches by its hub onto a free shaft, where the shaft carries it, mirrored side and all', () => {
    const robot = run(empty(), [
      { kind: 'place-part', part: 'chassis', position: { x: 0, y: 0 } },
      { kind: 'place-part', part: 'dc-motor', attach: { port: 'mount', onto: { part: 'p1', port: 'motor-right' } } },
      { kind: 'place-part', part: 'wheel-large', attach: { port: 'hub', onto: { part: 'p2', port: 'shaft' } } },
    ]);
    // The right motor mount is mirrored (D23), so the wheel sits on the motor's far side: the chassis's right.
    expect(at(robot, 'p3')).toEqual([40, 79, 0]);
    expect(robot.wires.find((wire) => wire.id === 'w2')).toEqual({ id: 'w2', from: { part: 'p2', port: 'shaft' }, to: { part: 'p3', port: 'hub' } });
  });

  it('joins a hub to a shaft it cannot line up with, and lands it loose where it was dropped', () => {
    const build = run(empty(), [
      { kind: 'place-part', part: 'servo-motor', position: { x: 0, y: 0 } },
      { kind: 'place-part', part: 'wheel-large', position: { x: 120, y: 0 }, attach: { port: 'hub', onto: { part: 'p1', port: 'arm' } } },
    ]);
    expect(at(build, 'p2')).toEqual([120, 0, 0]);
    expect(wireBetween(build, 'p1', 'p2')).toBe(true);
  });

  it('refuses an unknown part type, an unknown or unattachable port, and impossible drops with the schema codes', () => {
    const robot = fixture('rolling-start');
    expect(refused(robot, { kind: 'place-part', part: 'flux-capacitor' }).code).toBe('ref.unknown_part_type');
    expect(refused(robot, { kind: 'place-part', part: 'battery-pack-2-cell', attach: { port: 'lid', onto: { part: 'chassis', port: 'deck-middle' } } }).code).toBe('ref.unknown_port');
    expect(refused(robot, { kind: 'place-part', part: 'battery-pack-2-cell', attach: { port: 'plus', onto: { part: 'switch', port: 'a' } } }).code).toBe('port.wrong_kind');
    expect(refused(robot, { kind: 'place-part', part: 'battery-pack-2-cell', attach: { port: 'mount', onto: { part: 'chassis', port: 'deck-front' } } }).code).toBe('wire.port_full');
    expect(refused(robot, { kind: 'place-part', part: 'battery-pack-2-cell', attach: { port: 'mount', onto: { part: 'motor-left', port: 'shaft' } } }).code).toBe('wire.mechanical_mismatch');
    expect(refused(robot, { kind: 'place-part', part: 'wheel-large', attach: { port: 'hub', onto: { part: 'battery', port: 'plus' } } }).code).toBe('wire.type_mismatch');
    expect(refused(robot, { kind: 'place-part', part: 'wheel-large', attach: { port: 'hub', onto: { part: 'ghost', port: 'shaft' } } }).code).toBe('ref.unknown_placed_part');
    expect(refused(robot, { kind: 'place-part', part: 'led', rotation: 360 }).code).toBe('value.out_of_range');
  });
});

describe('move-part and rotate-part (D34)', () => {
  it('moves a loose part and keeps its turn', () => {
    expect(at(ok(fixture('led-circuit'), { kind: 'move-part', partId: 'led', position: { x: 90, y: 40 } }), 'led')).toEqual([90, 40, 0]);
  });

  it('carries everything on the chassis with it: moving the chassis moves the robot', () => {
    const robot = fixture('rolling-start');
    const moved = ok(robot, { kind: 'move-part', partId: 'chassis', position: { x: 100, y: 20 } });
    for (const placed of robot.parts) {
      expect(at(moved, placed.id), placed.id).toEqual([placed.position.x + 100, placed.position.y + 20, 0]);
    }
    expect(moved.wires).toEqual(robot.wires);
  });

  it('turns the robot with the chassis, each part where its mount or shaft puts it', () => {
    const turned = ok(fixture('rolling-start'), { kind: 'rotate-part', partId: 'chassis', rotation: 90 });
    expect(at(turned, 'chassis')).toEqual([0, 0, 90]);
    expect(at(turned, 'motor-left')).toEqual([53, 30, 90]);
    expect(at(turned, 'wheel-left')).toEqual([79, 40, 90]);
    expect(at(turned, 'battery')).toEqual([0, -45, 90]);
  });

  it('takes a mounted part off its mount; what it carries goes with it', () => {
    const moved = ok(fixture('rolling-start'), { kind: 'move-part', partId: 'motor-left', position: { x: 30, y: -150 } });
    expect(wireBetween(moved, 'motor-left', 'chassis')).toBe(false);
    expect(at(moved, 'motor-left')).toEqual([30, -150, 0]);
    expect(at(moved, 'wheel-left')).toEqual([40, -176, 0]);
    expect(wireBetween(moved, 'motor-left', 'wheel-left')).toBe(true);
  });

  it('draws a part taken off a mirrored mount point as itself, so its wheel moves to its shaft side', () => {
    const moved = ok(fixture('rolling-start'), { kind: 'move-part', partId: 'motor-right', position: { x: 30, y: 150 } });
    expect(at(moved, 'wheel-right')).toEqual([40, 124, 0]);
  });

  it('takes a carried part off its shaft', () => {
    const moved = ok(fixture('rolling-start'), { kind: 'move-part', partId: 'wheel-left', position: { x: 40, y: -150 } });
    expect(wireBetween(moved, 'motor-left', 'wheel-left')).toBe(false);
    expect(at(moved, 'wheel-left')).toEqual([40, -150, 0]);
  });

  it('takes a gearbox fully off: its mount, then the motor shaft that would carry it instead', () => {
    const moved = ok(fixture('bumper-robot'), { kind: 'move-part', partId: 'gear-left', position: { x: 40, y: -160 } });
    expect(wireBetween(moved, 'gear-left', 'chassis')).toBe(false);
    expect(wireBetween(moved, 'gear-left', 'motor-left')).toBe(false);
    expect(at(moved, 'gear-left')).toEqual([40, -160, 0]);
    expect(at(moved, 'wheel-left')).toEqual([40, -186, 0]);
  });

  it('turns a mounted part about its own origin, off its mount', () => {
    const turned = ok(fixture('rolling-start'), { kind: 'rotate-part', partId: 'battery', rotation: 270 });
    expect(at(turned, 'battery')).toEqual([-45, 0, 270]);
    expect(wireBetween(turned, 'battery', 'chassis')).toBe(false);
    expect(wireBetween(turned, 'battery', 'switch')).toBe(true);
  });

  it('refuses a part that is not placed, and a turn outside [0, 360)', () => {
    expect(refused(fixture('led-circuit'), { kind: 'move-part', partId: 'ghost', position: { x: 0, y: 0 } }).code).toBe('ref.unknown_placed_part');
    expect(refused(fixture('led-circuit'), { kind: 'rotate-part', partId: 'ghost', rotation: 90 }).code).toBe('ref.unknown_placed_part');
    expect(refused(fixture('led-circuit'), { kind: 'rotate-part', partId: 'led', rotation: 360 }).code).toBe('value.out_of_range');
    expect(refused(fixture('led-circuit'), { kind: 'move-part', partId: 'led', position: undefined as never }).code).toBe('value.wrong_type');
  });
});

describe('remove-part (D35)', () => {
  it('removes the part and every wire on its ports', () => {
    const build = ok(fixture('led-circuit'), { kind: 'remove-part', partId: 'switch' });
    expect(build.parts.map((placed) => placed.id)).toEqual(['battery', 'led']);
    expect(build.wires.map((wire) => wire.id)).toEqual(['w3']);
    expect(build.meta.highWater).toEqual(fixture('led-circuit').meta.highWater);
  });

  it('leaves what was mounted on it where it was, loose', () => {
    const robot = fixture('rolling-start');
    const build = ok(robot, { kind: 'remove-part', partId: 'chassis' });
    for (const id of ['battery', 'switch', 'caster', 'motor-left', 'motor-right']) expect(at(build, id), id).toEqual(at(robot, id));
    expect(build.wires.some((wire) => wire.to.part === 'chassis' || wire.from.part === 'chassis')).toBe(false);
    // The motors still carry their wheels; the right motor is no longer on a mirrored mount point, so its shaft and
    // its wheel are on its other side.
    expect(at(build, 'wheel-left')).toEqual([40, -79, 0]);
    expect(at(build, 'wheel-right')).toEqual([40, 27, 0]);
  });

  it('refuses a part that is not placed', () => {
    expect(refused(fixture('led-circuit'), { kind: 'remove-part', partId: 'ghost' }).code).toBe('ref.unknown_placed_part');
  });
});

describe('mount and unmount', () => {
  it('mounts a loose part and moves it, with what it carries, to where the mount puts it', () => {
    const loose = ok(fixture('rolling-start'), { kind: 'move-part', partId: 'motor-left', position: { x: 0, y: -150 } });
    const build = ok(loose, { kind: 'mount', partId: 'motor-left', port: 'mount', onto: { part: 'chassis', port: 'motor-left-inner' } });
    expect(at(build, 'motor-left')).toEqual([30, -29, 0]);
    expect(at(build, 'wheel-left')).toEqual([40, -55, 0]);
    expect(build.wires.find((wire) => wire.from.part === 'motor-left' && wire.from.port === 'mount')?.id).toBe('w13');
  });

  it('replaces a mount already on that port, so a re-snap is one change', () => {
    const build = ok(fixture('rolling-start'), { kind: 'mount', partId: 'battery', port: 'mount', onto: { part: 'chassis', port: 'deck-middle' } });
    const mounts = build.wires.filter((wire) => wire.from.part === 'battery' && wire.from.port === 'mount');
    expect(mounts).toEqual([{ id: 'w13', from: { part: 'battery', port: 'mount' }, to: { part: 'chassis', port: 'deck-middle' } }]);
    expect(at(build, 'battery')).toEqual([0, 0, 0]);
  });

  it('changes nothing when the part is already on that mount point', () => {
    const robot = fixture('rolling-start');
    const build = ok(robot, { kind: 'mount', partId: 'battery', port: 'mount', onto: { part: 'chassis', port: 'deck-rear' } });
    expect(serializeBlueprint(build)).toBe(serializeBlueprint(robot));
  });

  it('refuses a full mount point, a port that is not a mount, and a mount loop', () => {
    const robot = fixture('rolling-start');
    expect(refused(robot, { kind: 'mount', partId: 'battery', port: 'mount', onto: { part: 'chassis', port: 'deck-front' } }).code).toBe('wire.port_full');
    expect(refused(robot, { kind: 'mount', partId: 'battery', port: 'plus', onto: { part: 'chassis', port: 'deck-middle' } }).code).toBe('port.wrong_kind');
    expect(refused(robot, { kind: 'mount', partId: 'battery', port: 'lid', onto: { part: 'chassis', port: 'deck-middle' } }).code).toBe('ref.unknown_port');
    expect(refused(robot, { kind: 'mount', partId: 'battery', port: 'mount', onto: { part: 'motor-left', port: 'shaft' } }).code).toBe('wire.mechanical_mismatch');
    // A plate that both mounts and holds: two of them cannot each be mounted on the other.
    const base = record('switch');
    const ports: PortSpec[] = [
      { id: 'mount', label: 'mount', type: 'mechanical', role: 'mount', at: { x: 0, y: 0, z: 0 }, yaw: 0 },
      { id: 'top', label: 'top', type: 'mechanical', role: 'mount-point', at: { x: 0, y: 0, z: 10 }, yaw: 0, mirrored: false },
    ];
    const plate: PartRecord = { ...base, id: 'plate', ports, needs: [], behaviour: [], settings: [], failureModes: [] };
    const withPlate = makeCatalogue({ parts: [...parts, plate], arenas: [...(catalogue.arenas?.values() ?? [])] });
    const stacked = run(
      empty(),
      [
        { kind: 'place-part', part: 'plate', position: { x: 0, y: 0 } },
        { kind: 'place-part', part: 'plate', attach: { port: 'mount', onto: { part: 'p1', port: 'top' } } },
      ],
      withPlate,
    );
    expect(refused(stacked, { kind: 'mount', partId: 'p1', port: 'mount', onto: { part: 'p2', port: 'top' } }, withPlate).code).toBe('mount.cycle');
  });

  it('unmounts a part where it is', () => {
    const build = ok(fixture('rolling-start'), { kind: 'unmount', partId: 'battery', port: 'mount' });
    expect(at(build, 'battery')).toEqual([-45, 0, 0]);
    expect(wireBetween(build, 'battery', 'chassis')).toBe(false);
    expect(refused(build, { kind: 'unmount', partId: 'battery', port: 'mount' }).code).toBe('edit.unknown_wire');
    expect(refused(build, { kind: 'unmount', partId: 'switch', port: 'a' }).code).toBe('edit.unknown_wire');
  });
});

describe('set-setting', () => {
  const robot = fixture('rolling-start');

  it('sets a value, and the default or no value goes back to the default', () => {
    const backward = ok(robot, { kind: 'set-setting', partId: 'motor-left', setting: 'direction', value: 'backward' });
    expect(part(backward, 'motor-left').settings).toEqual({ direction: 'backward' });
    expect(part(ok(backward, { kind: 'set-setting', partId: 'motor-left', setting: 'direction', value: 'forward' }), 'motor-left').settings).toEqual({});
    expect(part(ok(backward, { kind: 'set-setting', partId: 'motor-left', setting: 'direction' }), 'motor-left').settings).toEqual({});
    expect(part(ok(robot, { kind: 'set-setting', partId: 'motor-left', setting: 'speed', value: 60 }), 'motor-left').settings).toEqual({ speed: 60 });
  });

  it('checks the value as validateBlueprint does', () => {
    expect(refused(robot, { kind: 'set-setting', partId: 'motor-left', setting: 'speed', value: 55 }).code).toBe('setting.off_step');
    expect(refused(robot, { kind: 'set-setting', partId: 'motor-left', setting: 'speed', value: 150 }).code).toBe('setting.out_of_range');
    expect(refused(robot, { kind: 'set-setting', partId: 'motor-left', setting: 'speed', value: 'fast' }).code).toBe('setting.wrong_type');
    expect(refused(robot, { kind: 'set-setting', partId: 'motor-left', setting: 'direction', value: 'sideways' }).code).toBe('ref.unknown_option');
    expect(refused(robot, { kind: 'set-setting', partId: 'motor-left', setting: 'colour', value: 'red' }).code).toBe('ref.unknown_setting');
    expect(refused(robot, { kind: 'set-setting', partId: 'ghost', setting: 'speed', value: 60 }).code).toBe('ref.unknown_placed_part');
  });
});

describe('the arena: set-arena and props (D29, D36)', () => {
  const robot = fixture('rolling-start');
  const cone = { shape: 'cylinder', size: { x: 60, y: 60, z: 90 }, grams: 40, fixed: false } as const;

  it('replaces the arena, and Reset arena drops the child’s props', () => {
    const walled = ok(robot, { kind: 'set-arena', arena: { preset: 'wall-stop', props: [] } });
    expect(walled.arena).toEqual({ preset: 'wall-stop', props: [] });
    expect(walled.parts).toEqual(robot.parts);
    const withProp = ok(walled, { kind: 'place-prop', prop: cone, at: { x: 900, y: 300, heading: 0 } });
    expect(ok(withProp, { kind: 'set-arena', arena: { preset: 'wall-stop', props: [] } }).arena.props).toEqual([]);
  });

  it('refuses an unknown preset, a prop off the floor and an id the preset uses', () => {
    expect(refused(robot, { kind: 'set-arena', arena: { preset: 'moon', props: [] } }).code).toBe('ref.unknown_arena');
    const offFloor = { id: 'prop-1', ...cone, at: { x: 5000, y: 0, heading: 0 } };
    expect(refused(robot, { kind: 'set-arena', arena: { preset: 'open-floor', props: [offFloor] } }).code).toBe('arena.outside');
    const clash = { id: 'box', ...cone, at: { x: 500, y: 500, heading: 0 } };
    expect(refused(robot, { kind: 'set-arena', arena: { preset: 'wall-stop', props: [clash] } }).code).toBe('id.duplicate');
  });

  it('places a prop with the next prop-<n> id, where it is told', () => {
    const one = ok(robot, { kind: 'place-prop', prop: cone, at: { x: 900, y: 300, heading: 0 } });
    const two = ok(one, { kind: 'place-prop', prop: cone, at: { x: 1200, y: 300, heading: 30 } });
    expect(two.arena.props.map((prop) => [prop.id, prop.at.x, prop.at.heading])).toEqual([
      ['prop-1', 900, 0],
      ['prop-2', 1200, 30],
    ]);
    expect(refused(robot, { kind: 'place-prop', prop: cone, at: { x: -10, y: 300, heading: 0 } }).code).toBe('arena.outside');
    expect(refused(robot, { kind: 'place-prop', prop: { ...cone, shape: 'pyramid' as never } }).code).toBe('value.wrong_type');
  });

  it('without a spot, puts the prop wholly on the floor, clear of the robot, the walls and the other props', () => {
    const walled = ok(robot, { kind: 'set-arena', arena: { preset: 'wall-stop', props: [] } });
    const build = ok(walled, { kind: 'place-prop', prop: { shape: 'box', size: { x: 300, y: 300, z: 60 }, grams: 100, fixed: false } });
    const [prop] = build.arena.props;
    if (!prop) throw new Error('no prop');
    expect(prop.at.x - 150).toBeGreaterThanOrEqual(0);
    expect(prop.at.y - 150).toBeGreaterThanOrEqual(0);
    expect(prop.at.x + 150).toBeLessThanOrEqual(2000);
    expect(prop.at.y + 150).toBeLessThanOrEqual(1200);
    // Clear of the preset's box at (1000, 950), 80 mm across.
    expect(Math.abs(prop.at.x - 1000) >= 190 || Math.abs(prop.at.y - 950) >= 190).toBe(true);
    expect(serializeBlueprint(ok(walled, { kind: 'place-prop', prop: { shape: 'box', size: { x: 300, y: 300, z: 60 }, grams: 100, fixed: false } }))).toBe(
      serializeBlueprint(build),
    );
  });

  it('moves and removes only the child’s props; the preset’s stay where the preset puts them', () => {
    const walled = ok(robot, { kind: 'set-arena', arena: { preset: 'wall-stop', props: [] } });
    const placed = ok(walled, { kind: 'place-prop', prop: cone, at: { x: 900, y: 300, heading: 0 } });
    expect(ok(placed, { kind: 'move-prop', propId: 'prop-1', at: { x: 950, y: 320, heading: 90 } }).arena.props[0]?.at).toEqual({ x: 950, y: 320, heading: 90 });
    expect(ok(placed, { kind: 'remove-prop', propId: 'prop-1' }).arena.props).toEqual([]);
    expect(refused(placed, { kind: 'move-prop', propId: 'box', at: { x: 0, y: 0, heading: 0 } }).code).toBe('edit.unknown_prop');
    expect(refused(placed, { kind: 'remove-prop', propId: 'box' }).code).toBe('edit.unknown_prop');
  });

  it('gives a removed highest prop id out again, as the contract allows', () => {
    const one = ok(robot, { kind: 'place-prop', prop: cone, at: { x: 900, y: 300, heading: 0 } });
    const gone = ok(one, { kind: 'remove-prop', propId: 'prop-1' });
    expect(ok(gone, { kind: 'place-prop', prop: cone, at: { x: 900, y: 300, heading: 0 } }).arena.props[0]?.id).toBe('prop-1');
  });
});

describe('rename', () => {
  it('names the build: child text, one line of 1–60 characters', () => {
    expect(ok(fixture('led-circuit'), { kind: 'rename', name: 'Night light 2' }).meta.name).toBe('Night light 2');
    for (const name of ['', ' padded', 'two\nlines', 'x'.repeat(61)]) {
      expect(refused(fixture('led-circuit'), { kind: 'rename', name }).code, JSON.stringify(name)).toBe('value.bad_format');
    }
  });
});

describe('batch', () => {
  it('applies its commands in order as one change, naming earlier parts by the ids claimPartId predicts', () => {
    const build = ok(empty(), {
      kind: 'batch',
      commands: [
        { kind: 'place-part', part: 'chassis', position: { x: 0, y: 0 } },
        { kind: 'place-part', part: 'battery-pack-2-cell', attach: { port: 'mount', onto: { part: 'p1', port: 'deck-rear' } } },
        { kind: 'rename', name: 'Two parts' },
      ],
    });
    expect(build.parts.map((placed) => [placed.id, placed.part])).toEqual([
      ['p1', 'chassis'],
      ['p2', 'battery-pack-2-cell'],
    ]);
    expect(build.meta.name).toBe('Two parts');
  });

  it('is all or nothing: the first refusal comes back with its index', () => {
    const result = applyEdit(
      empty(),
      {
        kind: 'batch',
        commands: [
          { kind: 'place-part', part: 'chassis', position: { x: 0, y: 0 } },
          { kind: 'place-part', part: 'dc-motor', attach: { port: 'mount', onto: { part: 'p1', port: 'nowhere' } } },
          { kind: 'rename', name: 'Never' },
        ],
      },
      catalogue,
    );
    expect(result).toEqual({ ok: false, refusal: expect.objectContaining({ code: 'ref.unknown_port', index: 1 }) });
  });

  it('refuses a batch inside a batch, and an empty batch changes nothing', () => {
    const build = fixture('led-circuit');
    const nested = applyEdit(build, { kind: 'batch', commands: [{ kind: 'batch', commands: [] } as never] }, catalogue);
    expect(!nested.ok && [nested.refusal.code, nested.refusal.index]).toEqual(['value.not_allowed', 0]);
    expect(serializeBlueprint(ok(build, { kind: 'batch', commands: [] }))).toBe(serializeBlueprint(build));
  });
});

describe('what applyEdit refuses outright', () => {
  it('refuses a command it does not know, and one that is not a command', () => {
    expect(refused(fixture('led-circuit'), { kind: 'teleport' } as never).code).toBe('value.not_allowed');
    expect(refused(fixture('led-circuit'), null as never).code).toBe('value.wrong_type');
  });

  it('leaves connect and disconnect to task 3.3, naming it', () => {
    const build = fixture('led-circuit');
    expect(() => applyEdit(build, { kind: 'connect', from: { part: 'led', port: 'plus' }, to: { part: 'battery', port: 'plus' } }, catalogue)).toThrow(/task 3\.3/);
  });

  it('stores a held part where its holder puts it, by canvasPoseOf', () => {
    const turned = ok(fixture('rolling-start'), { kind: 'move-part', partId: 'chassis', position: { x: 7.5, y: -3.2 } });
    const chassis = part(turned, 'chassis');
    const expected = canvasPoseOf(
      { x: chassis.position.x, y: chassis.position.y, rotation: chassis.rotation },
      { x: 30, y: 53, z: 6, yaw: 0, mirrored: false },
    );
    expect(at(turned, 'motor-left')).toEqual([expected.x, expected.y, expected.rotation]);
  });
});

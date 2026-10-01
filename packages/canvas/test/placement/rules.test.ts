// Where a part may land (task 3.2): snap targets from port roles and geometry alone (ground rule 1), the free-spot
// rule, and props on the floor. These are the rules every input path and the list view share.
import { describe, expect, it } from 'vitest';
import { canvasPoseOf, mountPlacement } from '@servo/schema';
import type { Blueprint, MountPointPort, MountPort, Vec2 } from '@servo/schema';
import { applyEdit } from '../../src/index.ts';
import { FREE_GAP_MM, SPOT_STEP_MM, freeSpot, isFree, roundMm, separation } from '../../src/placement/free-spot.ts';
import type { Outline } from '../../src/placement/free-spot.ts';
import { canvasToArena, nextPropId, onProp, propSpot } from '../../src/placement/props.ts';
import { movedPartSpot, moveTargets, nearestTarget, newPartSpot, placeTargets, tileOutline } from '../../src/placement/rules.ts';
import type { SnapTarget } from '../../src/placement/rules.ts';
import { arenaToCanvas, layArena } from '../../src/scene/arena.ts';
import { buildScene } from '../../src/scene/scene.ts';
import { catalogue, fixture, record } from '../helpers/catalogue.ts';

const square = (x: number, y: number, half: number): Outline => [
  { x: x - half, y: y - half },
  { x: x + half, y: y - half },
  { x: x + half, y: y + half },
  { x: x - half, y: y + half },
];

const keyOf = (target: SnapTarget): string => `${target.kind} ${target.port} → ${target.onto.part}.${target.onto.port}`;

const without = (build: Blueprint, ids: readonly string[]): Blueprint => {
  const result = ids.reduce<Blueprint>((current, partId) => {
    const next = applyEdit(current, { kind: 'remove-part', partId }, catalogue);
    if (!next.ok) throw new Error(next.refusal.code);
    return next.blueprint;
  }, build);
  return result;
};

describe('snap targets for a part from the tray', () => {
  it('are the free mount points its mount fits, each with the pose the mount gives', () => {
    const robot = fixture('rolling-start');
    const targets = placeTargets(robot, catalogue, 'switch');
    // The deck front, deck rear, both motor mounts and the caster mount are taken.
    expect(targets.map(keyOf)).toEqual(
      ['motor-left-inner', 'motor-right-inner', 'gear-left', 'gear-right', 'deck-middle', 'bumper'].map((port) => `mount mount → chassis.${port}`),
    );
    const chassis = record('chassis');
    for (const target of targets) {
      const point = chassis.ports.find((port) => port.id === target.onto.port) as MountPointPort;
      const expected = canvasPoseOf({ x: 0, y: 0, rotation: 0 }, mountPlacement(point, record('switch').ports.find((port) => port.id === 'mount') as MountPort));
      expect(target.pose).toEqual(expected);
      expect(target.at).toEqual({ x: point.at.x, y: -point.at.y + 0 });
    }
  });

  it('are the free shafts a hub fits, and never one it cannot line up with (a servo arm turns about +z)', () => {
    const build = without(fixture('rolling-start'), ['wheel-left']);
    const extra = applyEdit(build, { kind: 'place-part', part: 'servo-motor', position: { x: 0, y: -150 } }, catalogue);
    if (!extra.ok) throw new Error(extra.refusal.code);
    expect(placeTargets(extra.blueprint, catalogue, 'wheel-large').map(keyOf)).toEqual(['shaft hub → motor-left.shaft']);
  });

  it('come from port roles alone: the same for any part with a mount', () => {
    const robot = fixture('rolling-start');
    const where = (type: string): string[] => placeTargets(robot, catalogue, type).map((target) => `${target.onto.part}.${target.onto.port}`);
    expect(where('battery-pack-1-cell')).toEqual(where('switch'));
    expect(where('led')).toEqual([]);
    expect(placeTargets(robot, catalogue, 'flux-capacitor')).toEqual([]);
  });
});

describe('snap targets for a part being moved (D34)', () => {
  it('include its own mount point, and none on itself or on what it holds', () => {
    const robot = fixture('rolling-start');
    const motor = moveTargets(robot, catalogue, 'motor-left').map((target) => target.onto.port);
    expect(motor).toContain('motor-left');
    expect(motor).toContain('gear-left');
    expect(motor).not.toContain('deck-rear');
    expect(moveTargets(robot, catalogue, 'chassis')).toEqual([]);
    expect(moveTargets(robot, catalogue, 'wheel-left')).toEqual([]);
  });
});

describe('the nearest target', () => {
  const targets: SnapTarget[] = [
    { kind: 'shaft', port: 'input', onto: { part: 'm', port: 'shaft' }, at: { x: 0, y: 0 }, pose: { x: 0, y: 0, rotation: 0, mirrored: false } },
    { kind: 'mount', port: 'mount', onto: { part: 'c', port: 'gear' }, at: { x: 0, y: 0 }, pose: { x: 0, y: 0, rotation: 0, mirrored: false } },
    { kind: 'mount', port: 'mount', onto: { part: 'c', port: 'far' }, at: { x: 30, y: 0 }, pose: { x: 30, y: 0, rotation: 0, mirrored: false } },
  ];

  it('is the closest within reach; a mount wins a tie with a shaft', () => {
    expect(nearestTarget(targets, () => ({ x: 0, y: 0.001 }), 10)?.onto.port).toBe('gear');
    expect(nearestTarget(targets, () => ({ x: 25, y: 0 }), 10)?.onto.port).toBe('far');
    expect(nearestTarget(targets, () => ({ x: 15, y: 40 }), 10)).toBeUndefined();
  });
});

describe('the free-spot rule', () => {
  const obstacle = square(0, 0, 20);

  it('measures the gap between outlines, negative when they overlap', () => {
    expect(separation(square(50, 0, 10), obstacle)).toBeCloseTo(20, 12);
    expect(separation(square(5, 5, 10), obstacle)).toBeLessThan(0);
  });

  it('keeps a free drop exactly where it was let go, to a tenth of a millimetre', () => {
    const query = { from: { x: 100, y: 7.3 }, shape: [square(0, 0, 10)], obstacles: [obstacle] };
    expect(freeSpot(query)).toEqual({ x: 100, y: 7.3 });
    expect(roundMm(-80.00000001)).toBe(-80);
    expect(Object.is(roundMm(-0.01), 0)).toBe(true);
  });

  it('slides a drop on top of another part to the nearest spot that keeps a socket’s reach from it', () => {
    const query = { from: { x: 0, y: 0 }, shape: [square(0, 0, 10)], obstacles: [obstacle] };
    const spot = freeSpot(query) as Vec2;
    expect(isFree(query, spot)).toBe(true);
    const reach = 20 + 10 + FREE_GAP_MM;
    expect(Math.max(Math.abs(spot.x), Math.abs(spot.y))).toBeGreaterThanOrEqual(reach);
    expect(Math.hypot(spot.x, spot.y)).toBeLessThan(reach + SPOT_STEP_MM * 1.5);
    expect(freeSpot(query)).toEqual(spot);
  });

  it('places a new part and a moved group clear of everything else', () => {
    const robot = fixture('rolling-start');
    const spot = newPartSpot(robot, catalogue, record('led'), 0, { x: 0, y: 0 });
    expect(Math.hypot(spot.x, spot.y)).toBeGreaterThan(60);
    const moved = movedPartSpot(fixture('led-circuit'), catalogue, 'led', { x: -80, y: 0 });
    const tile = tileOutline(record('led'), { ...moved, rotation: 0, mirrored: false });
    const battery = tileOutline(record('battery-pack-2-cell'), { x: -80, y: 0, rotation: 0, mirrored: false });
    expect(separation(tile, battery)).toBeGreaterThanOrEqual(FREE_GAP_MM - 1e-9);
    // Nothing in the way: the spot it was dropped on.
    expect(movedPartSpot(fixture('led-circuit'), catalogue, 'led', { x: 80, y: 60 })).toEqual({ x: 80, y: 60 });
  });
});

describe('props on the floor', () => {
  it('number new props one past the highest prop-<n> among the preset and the child’s props', () => {
    const preset = catalogue.arenas?.get('wall-stop');
    expect(nextPropId(preset, [])).toBe('prop-1');
    const prop = { id: 'prop-7', shape: 'box', size: { x: 10, y: 10, z: 10 }, grams: 5, at: { x: 1, y: 1, heading: 0 }, fixed: false } as const;
    expect(nextPropId(preset, [prop])).toBe('prop-8');
  });

  it('map the canvas onto the floor and back', () => {
    const robot = fixture('rolling-start');
    const arena = layArena(robot, catalogue, buildScene(robot, catalogue));
    if (!arena) throw new Error('no arena');
    const point = { x: 123.5, y: -45 };
    const back = arenaToCanvas(arena.matrix, canvasToArena(arena.matrix, point));
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
    // The root starts at the preset's start pose.
    expect(canvasToArena(arena.matrix, { x: 0, y: 0 })).toEqual({ x: 300, y: 600 });
  });

  it('find a spot on the floor clear of the robot', () => {
    const robot = fixture('rolling-start');
    const spot = propSpot(robot, catalogue, { shape: 'cylinder', size: { x: 60, y: 60, z: 90 } }, { x: 300, y: 600 });
    if (!spot) throw new Error('no spot');
    expect(Math.hypot(spot.x - 300, spot.y - 600)).toBeGreaterThan(80);
    expect(onProp({ id: 'p', shape: 'cylinder', size: { x: 60, y: 60, z: 90 }, grams: 1, at: spot, fixed: false }, spot)).toBe(true);
  });
});

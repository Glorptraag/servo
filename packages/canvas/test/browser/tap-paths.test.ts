// Task 7.9 (review R-7.6): two gaps on the tap-then-tap path. A wheel moved off its shaft by its Move handle can land on
// its free spot when that spot lies on its own tile, as a drag and the list view put it there; and a power line wholly
// under sockets is drawn with a bend a press reaches, so touch and pointer select and remove it as the list view does.
// Real input through CDP in the iPad profile, reduced motion throughout.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, PlacedPartId, Vec2 } from '@servo/schema';
import { roundPoint } from '../../src/placement/free-spot.ts';
import { movedPartSpot } from '../../src/placement/rules.ts';
import type { HandleKind } from '../../src/placement/overlays.ts';
import { blueprintOf, catalogue, fixture } from '../helpers/catalogue.ts';
import { listen, unmountAll } from './helpers.ts';
import { clientOf, drag, middleOf, mountWorkbench, tap } from './placing.ts';
import type { Hand, Workbench } from './placing.ts';

let bench: Workbench;

beforeAll(async () => {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  bench = await mountWorkbench();
  bench.surface.setRemoveTargets([bench.tray]);
}, 300_000);

afterAll(async () => {
  bench.unmount();
  unmountAll();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const load = (build: Blueprint, centre: Vec2, zoom = 1): void => {
  bench.surface.canvas.focus();
  bench.surface.setMode('build');
  bench.surface.select(null);
  expect(bench.surface.load(build).ok).toBe(true);
  Object.assign(bench.surface.camera, { centreX: centre.x, centreY: centre.y, zoom });
  bench.surface.requestFrame();
};

const client = (world: Vec2): Vec2 => clientOf(bench.surface, world);
const hitAt = (world: Vec2) => bench.surface.hitAt(bench.surface.camera.worldToScreen(world));
const partHandle = (kind: HandleKind): Vec2 => {
  const place = bench.surface.placement.handlePlaces.places.get(kind);
  if (!place) throw new Error(`no ${kind} handle`);
  return place;
};
const bytes = (): string => serializeBlueprint(bench.surface.blueprint as Blueprint);

describe('a wheel moved off its shaft by tap-then-tap (R-7.6 finding 3)', () => {
  const robot = fixture('rolling-start');
  const WHEEL: PlacedPartId = 'wheel-left';
  const centre = robot.parts.find((part) => part.id === WHEEL)?.position as Vec2;

  /**
   * A point on the wheel's own tile, clear of its hub's socket, where the wheel off its shaft would be free: a spot it
   * can go, as a drag or the command puts it there. On the content fixtures the list view's free spot lies there.
   */
  const ownSpot = (): Vec2 => {
    load(robot, centre);
    const [c0, c1, , c3] = bench.surface.scene.partById.get(WHEEL)?.corners as readonly Vec2[];
    for (let i = 1; i < 20; i++) {
      for (let j = 1; j < 20; j++) {
        const s = i / 20;
        const t = j / 20;
        const p = roundPoint({ x: (c0 as Vec2).x + s * ((c1 as Vec2).x - (c0 as Vec2).x) + t * ((c3 as Vec2).x - (c0 as Vec2).x), y: (c0 as Vec2).y + s * ((c1 as Vec2).y - (c0 as Vec2).y) + t * ((c3 as Vec2).y - (c0 as Vec2).y) });
        const hit = hitAt(p);
        const free = movedPartSpot(robot, catalogue, WHEEL, p);
        if (hit?.kind === 'part' && hit.part.id === WHEEL && free.x === p.x && free.y === p.y) return p;
      }
    }
    throw new Error('no free spot on the wheel’s own tile');
  };

  it('lands on a free spot on its own tile by touch and by mouse, as the command and a drag put it there', async () => {
    const spot = ownSpot();
    load(robot, centre);
    expect(bench.surface.apply({ kind: 'move-part', partId: WHEEL, position: spot }).ok).toBe(true);
    const reference = bytes();
    for (const hand of ['touch', 'mouse'] as const satisfies readonly Hand[]) {
      load(robot, centre);
      const edits = listen(bench.surface, 'edit');
      await tap(hand, client(spot));
      expect(bench.surface.placement.selectedPart).toBe(WHEEL);
      await tap(hand, client(partHandle('move')));
      expect(bench.surface.placement.moving).toBe(WHEEL);
      await tap(hand, client(spot));
      expect(edits.map((edit) => edit.command), hand).toEqual([{ kind: 'move-part', partId: WHEEL, position: spot }]);
      expect(bench.surface.placement.moving).toBeUndefined();
      expect(bytes(), hand).toBe(reference);
    }
    load(robot, centre);
    await drag('mouse', client(centre), client(spot));
    expect(bytes()).toBe(reference);
  });

  it('stays on its shaft when the tap on its own tile is no spot it can go', async () => {
    for (const hand of ['touch', 'mouse'] as const satisfies readonly Hand[]) {
      const spot = ownSpot();
      load(robot, centre);
      const before = bytes();
      const edits = listen(bench.surface, 'edit');
      await tap(hand, client(spot));
      await tap(hand, client(partHandle('move')));
      // Its middle, beside the hub's socket and too close to the DC motor: no spot the wheel can go.
      const off = centre;
      const hit = hitAt(off);
      expect(hit?.kind === 'part' && hit.part.id).toBe(WHEEL);
      expect(movedPartSpot(robot, catalogue, WHEEL, off)).not.toEqual(roundPoint(off));
      await tap(hand, client(off));
      expect(bench.surface.placement.moving, hand).toBeUndefined();
      expect(edits, hand).toEqual([]);
      expect(bytes(), hand).toBe(before);
    }
  });

  it('leaves a mounted part where it is when its own middle is tapped (placement.md decision 7)', async () => {
    load(robot, { x: 0, y: 0 });
    const edits = listen(bench.surface, 'edit');
    const before = bytes();
    await tap('touch', client({ x: -45, y: 0 }));
    expect(bench.surface.placement.selectedPart).toBe('battery');
    await tap('touch', client(partHandle('move')));
    await tap('touch', client({ x: -45, y: 0 }));
    expect(bench.surface.placement.moving).toBeUndefined();
    expect(edits).toEqual([]);
    expect(bytes()).toBe(before);
  });
});

describe('a loose part tapped on its own tile after Move (R-7.9 finding 3)', () => {
  it('stays where it is by touch and by mouse, never nudged by the tap’s offset', async () => {
    const robot = fixture('rolling-start');
    for (const hand of ['touch', 'mouse'] as const satisfies readonly Hand[]) {
      load(robot, { x: 0, y: 0 });
      const before = bytes();
      const edits = listen(bench.surface, 'edit');
      await tap(hand, client({ x: -45, y: 40 }));
      expect(bench.surface.placement.selectedPart).toBe('chassis');
      await tap(hand, client(partHandle('move')));
      expect(bench.surface.placement.moving).toBe('chassis');
      await tap(hand, client({ x: -40, y: 44 }));
      expect(bench.surface.placement.moving, hand).toBeUndefined();
      expect(edits, hand).toEqual([]);
      expect(bytes(), hand).toBe(before);
    }
  });
});

describe('a line wholly under sockets (R-7.6 finding 2)', () => {
  // A battery pack with a DC motor beside it, wired minus to minus: straight, the line runs past the pack's plus socket
  // and sockets cover all of it.
  const buried = blueprintOf({
    parts: [
      { id: 'p1', part: 'battery-pack-1-cell', position: { x: 0, y: 0 }, rotation: 0, settings: {} },
      { id: 'p2', part: 'dc-motor', position: { x: -6, y: -30 }, rotation: 0, settings: {} },
    ],
    wires: [{ id: 'w1', from: { part: 'p1', port: 'minus' }, to: { part: 'p2', port: 'minus' } }],
  });

  /** The middle of the bend, where its whole hit area reaches the line. */
  const bendMiddle = (): Vec2 => {
    const route = bench.surface.routing.routeOf('w1');
    expect(route, 'the bend').toHaveLength(4);
    const [, a, b] = route as readonly Vec2[];
    return { x: ((a as Vec2).x + (b as Vec2).x) / 2, y: ((a as Vec2).y + (b as Vec2).y) / 2 };
  };

  it('is drawn with a bend a press reaches', () => {
    load(buried, { x: -20, y: -10 });
    const hit = hitAt(bendMiddle());
    expect(hit?.kind === 'wire' && hit.wire.id).toBe('w1');
  });

  it('is selected and removed by its bin by touch and by mouse, and dragged to the tray, as the list view removes it', async () => {
    load(buried, { x: -20, y: -10 });
    expect(bench.surface.apply({ kind: 'disconnect', wireId: 'w1' }).ok).toBe(true);
    const reference = bytes();
    for (const hand of ['touch', 'mouse'] as const satisfies readonly Hand[]) {
      load(buried, { x: -20, y: -10 });
      await tap(hand, client(bendMiddle()));
      expect(bench.surface.selection, hand).toEqual({ kind: 'wire', wireId: 'w1' });
      const bin = bench.surface.wiring.binPlace;
      if (!bin) throw new Error('no bin');
      await tap(hand, client(bin));
      expect(bytes(), hand).toBe(reference);
    }
    load(buried, { x: -20, y: -10 });
    await drag('touch', client(bendMiddle()), middleOf(bench.tray));
    expect(bytes()).toBe(reference);
  });
});

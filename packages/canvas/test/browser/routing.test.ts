// Tidy wires and the zoom limits on a real canvas (task 3.7), in the iPad profile: tidying through the one command
// layer (the app's button calls `tidyWires`, the list view performs the same command), routed wires drawn and hit
// along their routes, routes kept while they fit the build, and fit, zoom and the limits working in the canvas the
// safe area leaves uncovered (D66, D70). One canvas serves every test here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Vec2 } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { paletteFor } from '../../src/renderer/style.ts';
import { TIDY_WIRES_ACTION } from '../../src/routing/commands.ts';
import { routeWires } from '../../src/routing/router.ts';
import { KEEP_ON_SCREEN_PX, NO_SAFE_AREA, screenCentre } from '../../src/routing/view.ts';
import { distance, distanceToSegment, rectCentre } from '../../src/scene/geometry.ts';
import type { Rect } from '../../src/scene/geometry.ts';
import { WIRE_HIT_MM } from '../../src/scene/units.ts';
import { fixture, twentyFiveParts } from '../helpers/catalogue.ts';
import { PREFS, colourDistance, describeRgb, listen, mount, pointer, reset, rgbOf, settle, shoot, unmountAll } from './helpers.ts';

/** The app shell's room in landscape: a header, a spec card on the right and the Run bar below (D66, D70). */
const PANELS = { top: 64, right: 340, bottom: 96, left: 0 };

let surface: CanvasSurface;

/** A software GPU on a busy machine can take a minute to mount a canvas. */
const MOUNT_MS = 120_000;

beforeAll(async () => {
  ({ surface } = await mount());
}, MOUNT_MS);

beforeEach(() => {
  reset(surface);
  surface.setSafeArea(NO_SAFE_AREA);
});

afterAll(unmountAll);

const plain = (routes: ReadonlyMap<string, readonly Vec2[]>): string => JSON.stringify([...routes].sort(([a], [b]) => (a < b ? -1 : 1)));

/** A fresh load of a build that drops every route left by an earlier test: load another build first. */
const loadFresh = (name: 'rolling-start' | 'twenty-five'): void => {
  surface.load(name === 'twenty-five' ? fixture('rolling-start') : twentyFiveParts);
  surface.load(name === 'twenty-five' ? twentyFiveParts : fixture('rolling-start'));
  expect(surface.routing.routes.size).toBe(0);
};

describe('tidy wires', () => {
  it('tidies through the one command layer: no edit, the build unchanged, every crossing wire routed', () => {
    loadFresh('twenty-five');
    const edits = listen(surface, 'edit');
    const before = surface.blueprint;
    surface.tidyWires();
    expect(edits).toEqual([]);
    expect(surface.blueprint).toBe(before);
    const routes = plain(surface.routing.routes);
    expect(surface.routing.routes.size).toBeGreaterThan(0);
    expect(routes).toBe(plain(routeWires(surface.scene)));
    // The list view's action and the app's apply give the same routes (ground rule 8).
    loadFresh('twenty-five');
    const action = TIDY_WIRES_ACTION.does;
    if (action.kind !== 'edit') throw new Error('tidy wires is an edit');
    expect(surface.apply(action.command)).toEqual({ ok: true, blueprint: before });
    expect(plain(surface.routing.routes)).toBe(routes);
    expect(edits).toEqual([]);
  });

  it('draws and hits a tidied wire along its route, not along the straight line', async () => {
    loadFresh('rolling-start');
    surface.tidyWires();
    const [id, route] = [...surface.routing.routes][0] ?? [];
    if (!id || !route) throw new Error('nothing routed on Rolling Start');
    const wire = surface.scene.wires.find((each) => each.id === id);
    if (!wire) throw new Error(id);
    // A point on the route well away from the straight line and from every socket.
    let probe: Vec2 | undefined;
    for (let k = 1; k < route.length && !probe; k++) {
      const a = route[k - 1] as Vec2;
      const b = route[k] as Vec2;
      for (let t = 0.2; t <= 0.8 && !probe; t += 0.05) {
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const clearOfLine = distanceToSegment(at, wire.from.at, wire.to.at) > WIRE_HIT_MM;
        const clearOfSockets = surface.scene.parts.every((part) => part.ports.every((port) => distance(port.at, at) > WIRE_HIT_MM));
        const screen = surface.camera.worldToScreen(at);
        if (clearOfLine && clearOfSockets && surface.hitAt(screen)?.kind === 'wire') probe = at;
      }
    }
    if (!probe) throw new Error(`no clear point on ${id}'s route`);
    const screen = surface.camera.worldToScreen(probe);
    const hit = surface.hitAt(screen);
    expect(hit?.kind === 'wire' && hit.wire.id).toBe(id);
    await settle(surface);
    const shot = await shoot(surface.canvas);
    const colour = rgbOf(paletteFor(PREFS).types[wire.type].colour);
    const seen = shot.at(screen);
    expect(colourDistance(seen, colour), `${describeRgb(seen)} where the wire's ${describeRgb(colour)} was expected`).toBeLessThanOrEqual(24);
  });

  it('is refused in Run mode like every edit, and leaves the wires as they were', () => {
    loadFresh('rolling-start');
    surface.setMode('run');
    const result = surface.apply({ kind: 'tidy-wires' });
    expect(result.ok === false && result.refusal.code).toBe('edit.locked');
    surface.tidyWires();
    expect(surface.routing.routes.size).toBe(0);
  });

  it('keeps routes while their sockets stay put; a moved part’s wires go back to straight lines', () => {
    loadFresh('rolling-start');
    surface.tidyWires();
    const routed = [...surface.routing.routes.keys()];
    expect(routed.length).toBeGreaterThan(0);
    expect(surface.apply({ kind: 'rename', name: 'Tidy robot' }).ok).toBe(true);
    expect([...surface.routing.routes.keys()]).toEqual(routed);
    const wire = surface.scene.wires.find((each) => each.id === routed[0]);
    if (!wire) throw new Error('no wire');
    const moved = wire.from.ref.part;
    expect(surface.apply({ kind: 'move-part', partId: moved, position: { x: -300, y: -200 } }).ok).toBe(true);
    for (const each of surface.scene.wires) {
      if (each.from.ref.part === moved || each.to.ref.part === moved) expect(surface.routing.routeOf(each.id), each.id).toBeUndefined();
    }
  });
});

/** Screen pixels of `target` in the uncovered canvas, across and down. */
const onScreen = (target: Rect): { x: number; y: number } => {
  const shown = surface.camera.uncovered();
  const a = surface.camera.worldToScreen({ x: target.minX, y: target.minY });
  const b = surface.camera.worldToScreen({ x: target.maxX, y: target.maxY });
  return { x: Math.min(b.x, shown.x + shown.width) - Math.max(a.x, shown.x), y: Math.min(b.y, shown.y + shown.height) - Math.max(a.y, shown.y) };
};

describe('the safe area', () => {
  it('fit centres the build in the canvas the panels leave uncovered', () => {
    surface.load(twentyFiveParts);
    surface.setSafeArea(PANELS);
    surface.fit();
    const bounds = surface.scene.bounds as Rect;
    const centre = surface.camera.worldToScreen(rectCentre(bounds));
    expect(centre.x).toBeCloseTo((1180 - PANELS.right) / 2, 6);
    expect(centre.y).toBeCloseTo(PANELS.top + (820 - PANELS.top - PANELS.bottom) / 2, 6);
    for (const part of surface.scene.parts) {
      const seen = onScreen(part.bounds);
      expect(seen.x, part.id).toBeCloseTo((part.bounds.maxX - part.bounds.minX) * surface.camera.scale, 6);
      expect(seen.y, part.id).toBeCloseTo((part.bounds.maxY - part.bounds.minY) * surface.camera.scale, 6);
    }
  });

  it('setZoom zooms about the centre of the uncovered canvas', () => {
    surface.load(fixture('rolling-start'));
    surface.setSafeArea(PANELS);
    const middle = screenCentre(surface.camera.uncovered());
    const under = surface.camera.screenToWorld(middle);
    surface.setZoom(2);
    const after = surface.camera.worldToScreen(under);
    expect(after.x).toBeCloseTo(middle.x, 9);
    expect(after.y).toBeCloseTo(middle.y, 9);
  });

  it('moves nothing itself, and refuses an inset that is not a finite number from 0', () => {
    surface.load(fixture('rolling-start'));
    const before = [surface.camera.centreX, surface.camera.centreY, surface.zoom];
    surface.setSafeArea(PANELS);
    expect([surface.camera.centreX, surface.camera.centreY, surface.zoom]).toEqual(before);
    expect(() => surface.setSafeArea({ ...PANELS, left: -4 })).toThrow(RangeError);
    expect(() => surface.setSafeArea({ ...PANELS, top: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('a fling far across the canvas still leaves the build on screen beside the panels', () => {
    surface.load(twentyFiveParts);
    surface.setSafeArea(PANELS);
    surface.fit();
    surface.setZoom(4);
    const from = { x: 300, y: 400 };
    for (const to of [{ x: 300 + 6000, y: 400 }, { x: 300 - 9000, y: 400 + 5000 }, { x: 300, y: 400 - 8000 }]) {
      pointer(surface.canvas, 'pointerdown', from);
      pointer(surface.canvas, 'pointermove', to);
      pointer(surface.canvas, 'pointerup', to);
      const kept = surface.scene.parts.some((part) => {
        const seen = onScreen(part.bounds);
        return seen.x >= KEEP_ON_SCREEN_PX - 1e-6 && seen.y >= Math.min(KEEP_ON_SCREEN_PX, (part.bounds.maxY - part.bounds.minY) * surface.camera.scale) - 1e-6;
      });
      expect(kept, `after a fling to ${to.x}, ${to.y}`).toBe(true);
    }
  });
});

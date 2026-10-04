// Tidy wires and the zoom limits on a real canvas (task 3.7), in the iPad profile: tidying through the one command
// layer (the app's button calls `tidyWires`; the list view's button, by finger, mouse or Enter, performs the same
// command) with identical routes, routed wires drawn and hit along their routes, the body as the renderer draws it,
// routes kept while they fit the build, and fit, zoom and the limits working in the canvas the safe area leaves
// uncovered (D66, D70), re-held on a resize or a new safe area.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { makeCatalogue } from '@servo/schema';
import type { Blueprint, Catalogue, Vec2 } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { paletteFor } from '../../src/renderer/style.ts';
import { TIDY_WIRES_ACTION } from '../../src/routing/commands.ts';
import { crossesBodies, routeWires } from '../../src/routing/router.ts';
import { bodyShape, shapeOf } from '../../src/routing/shapes.ts';
import type { Shape } from '../../src/routing/shapes.ts';
import { NO_SAFE_AREA, screenCentre } from '../../src/routing/view.ts';
import type { Polygon } from '../../src/routing/view.ts';
import { distance, distanceToSegment, rectCentre } from '../../src/scene/geometry.ts';
import type { Rect } from '../../src/scene/geometry.ts';
import { WIRE_HIT_MM } from '../../src/scene/units.ts';
import { placeholderResolver } from '../helpers/art.ts';
import { benchCatalogue, busyWorkbench } from '../helpers/busy-workbench.ts';
import { catalogue, fixture, twentyFiveParts } from '../helpers/catalogue.ts';
import { crewCatalogue, crewRobot } from '../helpers/circuit-crew.ts';
import { findable } from '../helpers/findable.ts';
import { PREFS, colourDistance, describeRgb, listen, mount, mouse, pointer, reset, rgbOf, settle, shoot, touch, unmountAll } from './helpers.ts';

/** The app shell's room in landscape: a header, a spec card on the right and the Run bar below (D66, D70). */
const PANELS = { top: 64, right: 340, bottom: 96, left: 0 };

let surface: CanvasSurface;

/** A software GPU on a busy machine can take a minute to mount a canvas, and minutes for many gestures. */
// Five minutes: at load 200–350 with many agents running, mounting has run past two (review: list-view hook timeout).
const MOUNT_MS = 300_000;
const LONG_MS = 360_000;

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
  expect(surface.routing.tidied.size).toBe(0);
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
    expect(surface.routing.tidied.size).toBeGreaterThan(0);
    expect(plain(surface.routing.tidied)).toBe(plain(routeWires(surface.scene)));
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
    const [id, route] = [...surface.routing.tidied][0] ?? [];
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
    try {
      const result = surface.apply({ kind: 'tidy-wires' });
      expect(result.ok === false && result.refusal.code).toBe('edit.locked');
      surface.tidyWires();
      expect(surface.routing.tidied.size).toBe(0);
    } finally {
      surface.setMode('build');
    }
  });

  it('keeps routes while their sockets stay put; a moved part’s wires go back to straight lines', () => {
    loadFresh('rolling-start');
    surface.tidyWires();
    const routed = [...surface.routing.tidied.keys()];
    expect(routed.length).toBeGreaterThan(0);
    expect(surface.apply({ kind: 'rename', name: 'Tidy robot' }).ok).toBe(true);
    expect([...surface.routing.tidied.keys()]).toEqual(routed);
    const wire = surface.scene.wires.find((each) => each.id === routed[0]);
    if (!wire) throw new Error('no wire');
    const moved = wire.from.ref.part;
    expect(surface.apply({ kind: 'move-part', partId: moved, position: { x: -300, y: -200 } }).ok).toBe(true);
    for (const each of surface.scene.wires) {
      if (each.from.ref.part === moved || each.to.ref.part === moved) expect(surface.routing.tidied.get(each.id), each.id).toBeUndefined();
    }
  });
});

describe('the selected wire’s label on a tidied route (task 3.4)', () => {
  it('sits on the wire’s route, before and after tidying, and moves off the straight line with it', () => {
    loadFresh('twenty-five');
    const onPath = (at: Vec2, path: readonly Vec2[]): number =>
      Math.min(...path.slice(1).map((point, k) => distanceToSegment(at, path[k] as Vec2, point)));
    let offTheLine = 0;
    let checked = 0;
    const routes = routeWires(surface.scene);
    for (const wire of surface.scene.wires) {
      const route = routes.get(wire.id);
      if (!route) continue;
      surface.select({ kind: 'wire', wireId: wire.id });
      const straight = surface.selecting.wireLabelBox?.at;
      surface.tidyWires();
      const routed = surface.selecting.wireLabelBox?.at;
      if (!straight || !routed) throw new Error(`${wire.id} has no label`);
      // Untidied, on the straight line; tidied, on the route, unless no stop on it is clear of the sockets.
      const besideRoute = onPath(routed, route) > 1e-6;
      if (!besideRoute) {
        checked++;
        if (distanceToSegment(routed, wire.from.at, wire.to.at) > 1) offTheLine++;
      }
      expect(surface.wireView(wire.id)?.path, wire.id).toEqual(route);
      loadFresh('twenty-five');
    }
    surface.select(null);
    expect(checked).toBeGreaterThan(5);
    expect(offTheLine).toBeGreaterThan(0);
  }, LONG_MS);
});

describe('one tidy for every hand (ground rule 8)', () => {
  /** The list view's tidy button on wire `id`, opened as a child opens it. */
  const tidyButton = async (id: string): Promise<HTMLButtonElement> => {
    const list = surface.listDom.element;
    const key = (k: string): HTMLButtonElement | null => list.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(k)}"]`);
    const toggle = key(`toggle:wire:${id}`);
    if (!toggle) throw new Error(`no ${id} in the list view`);
    toggle.focus();
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    await vi.waitFor(() => {
      if (!key(`action:tidy-wires:${id}`)) throw new Error('no tidy button yet');
    });
    return key(`action:tidy-wires:${id}`) as HTMLButtonElement;
  };
  const centreOf = (element: Element): Vec2 => {
    const box = element.getBoundingClientRect();
    return { x: box.width / 2, y: box.height / 2 };
  };

  it('gives identical routes by the app’s button (tidyWires), and by the list view’s button with a finger, a mouse and Enter', async () => {
    loadFresh('twenty-five');
    surface.tidyWires();
    const expected = plain(surface.routing.routes);
    expect(plain(surface.routing.tidied)).toBe(plain(routeWires(surface.scene)));
    const wireId = surface.scene.wires.find((wire) => surface.routing.tidied.has(wire.id))?.id;
    if (!wireId) throw new Error('nothing routed');
    const ways: [string, (button: HTMLButtonElement) => Promise<void>][] = [
      [
        'touch',
        async (button) => {
          await touch(button, 'touchStart', [centreOf(button)]);
          await touch(button, 'touchEnd', []);
        },
      ],
      [
        'pointer',
        async (button) => {
          await mouse(button, 'mousePressed', centreOf(button));
          await mouse(button, 'mouseReleased', centreOf(button));
        },
      ],
      [
        'keyboard',
        async (button) => {
          button.focus();
          await userEvent.keyboard('{Enter}');
        },
      ],
    ];
    for (const [way, press] of ways) {
      loadFresh('twenty-five');
      const edits = listen(surface, 'edit');
      await press(await tidyButton(wireId));
      await vi.waitFor(() => expect(plain(surface.routing.routes), way).toBe(expected));
      expect(edits, way).toEqual([]);
      await vi.waitFor(() => expect(surface.listDom.element.querySelector('[role="status"]')?.textContent).toBe('Tidied the wires round the parts'));
    }
  }, LONG_MS);

  it('the list view counts a tidy that moved wires as a change, and one that moved none as no change', () => {
    loadFresh('rolling-start');
    const wire = surface.list.wires.find((each) => each.kind === 'power');
    if (!wire) throw new Error('no power line');
    const action = surface.list.actionsFor({ kind: 'wire', wireId: wire.wireId }).find((each) => each.id === `tidy-wires:${wire.wireId}`);
    if (!action) throw new Error('no tidy action');
    expect(action.does).toEqual(TIDY_WIRES_ACTION.does);
    expect(surface.list.perform(action)).toBe(true);
    expect(surface.list.perform(action)).toBe(false);
  });
});

describe('the body a route keeps off: the picture Pixi draws', () => {
  // The five fixtures' part types: the schema's examples (the 25-part fixture holds Rolling Start, the bumper robot,
  // the LED circuit and a microcontroller) and content's records (the busy workbench and the Circuit Crew robot),
  // each drawn with its real placeholder picture.
  const sets: readonly [string, Catalogue, readonly Blueprint[]][] = [
    ['the schema’s parts', catalogue, [twentyFiveParts, fixture('bumper-robot'), fixture('rolling-start')]],
    [
      'content’s parts',
      makeCatalogue({ parts: [...benchCatalogue.parts.values()], arenas: [...(benchCatalogue.arenas?.values() ?? []), ...(crewCatalogue.arenas?.values() ?? [])] }),
      [busyWorkbench, crewRobot],
    ],
  ];

  it.each(sets)('is where Pixi draws each picture, for every part type of %s, and tidied wires keep off it', async (_name, parts, builds) => {
    const { surface: drawn, unmount } = await mount({ catalogue: parts, resolveArt: placeholderResolver(parts) });
    try {
      const seen = new Set<string>();
      for (const build of builds) {
        expect(drawn.load(build).ok).toBe(true);
        drawn.fit();
        await settle(drawn);
        // Each picture's box as Pixi draws it, back on the plane: measured from the display object, not from the router.
        const measured = new Map<string, Shape>();
        for (const part of drawn.scene.parts) {
          const box = drawn.partView(part.id)?.pictureBounds;
          if (!box) throw new Error(`${part.id} shows no picture`);
          seen.add(part.record.id);
          const a = drawn.camera.screenToWorld({ x: box.x, y: box.y });
          const b = drawn.camera.screenToWorld({ x: box.x + box.width, y: box.y + box.height });
          if (part.frame) continue;
          // What the router keeps clear of, through the canvas's own pictures, on screen.
          const body = bodyShape(part, drawn.artOf(part)).corners.map((corner) => drawn.camera.worldToScreen(corner));
          const xs = body.map((p) => p.x);
          const ys = body.map((p) => p.y);
          const what = `${part.id} (${part.record.id})`;
          expect(Math.min(...xs), what).toBeCloseTo(box.x, 0);
          expect(Math.max(...xs), what).toBeCloseTo(box.x + box.width, 0);
          expect(Math.min(...ys), what).toBeCloseTo(box.y, 0);
          expect(Math.max(...ys), what).toBeCloseTo(box.y + box.height, 0);
          // Bounding boxes are the drawn picture itself for parts turned by quarter turns, as every fixture's are.
          if (part.pose.rotation % 90 === 0) measured.set(part.id, squareOf(a, b));
        }
        drawn.tidyWires();
        const pictures = [...measured.values()];
        for (const wire of drawn.scene.wires) {
          const route = drawn.routing.tidied.get(wire.id);
          // Routed exactly when its straight line crosses a picture as drawn; never crossing one once routed.
          expect(route !== undefined, wire.id).toBe(crossesBodies([wire.from.at, wire.to.at], pictures));
          if (route) expect(crossesBodies(route, pictures), wire.id).toBe(false);
        }
      }
      const types = new Set(builds.flatMap((build) => build.parts.map((part) => part.part)));
      expect(seen).toEqual(types);
    } finally {
      unmount();
    }
  }, LONG_MS);
});

/** An upright box on the plane from two opposite corners. */
const squareOf = (a: Vec2, b: Vec2): Shape =>
  shapeOf([
    { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
    { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) },
  ]);

/** Each part's drawn tile, turned with it: what the limits keep on screen. */
const tiles = (): Polygon[] => surface.scene.parts.map((part) => part.corners);

describe('the safe area', () => {
  it('fit centres the build in the canvas the panels leave uncovered', () => {
    surface.load(twentyFiveParts);
    surface.setSafeArea(PANELS);
    surface.fit();
    const bounds = surface.scene.bounds as Rect;
    const centre = surface.camera.worldToScreen(rectCentre(bounds));
    expect(centre.x).toBeCloseTo((1180 - PANELS.right) / 2, 6);
    expect(centre.y).toBeCloseTo(PANELS.top + (820 - PANELS.top - PANELS.bottom) / 2, 6);
    const shown = surface.camera.uncovered();
    for (const part of surface.scene.parts) {
      for (const corner of part.corners) {
        const at = surface.camera.worldToScreen(corner);
        expect(at.x, part.id).toBeGreaterThanOrEqual(shown.x);
        expect(at.x, part.id).toBeLessThanOrEqual(shown.x + shown.width);
        expect(at.y, part.id).toBeGreaterThanOrEqual(shown.y);
        expect(at.y, part.id).toBeLessThanOrEqual(shown.y + shown.height);
      }
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

  it('moves nothing while the build stays in view, and refuses an inset that is not a finite number from 0', () => {
    surface.load(fixture('rolling-start'));
    const before = [surface.camera.centreX, surface.camera.centreY, surface.zoom];
    surface.setSafeArea(PANELS);
    expect([surface.camera.centreX, surface.camera.centreY, surface.zoom]).toEqual(before);
    expect(() => surface.setSafeArea({ ...PANELS, left: -4 })).toThrow(RangeError);
    expect(() => surface.setSafeArea({ ...PANELS, top: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('brings the view back when a panel slides over the build, or the canvas shrinks under it', async () => {
    surface.load(fixture('rolling-start'));
    surface.setZoom(4);
    surface.camera.panBy(9000, 0, surface.limits());
    // The build now sits at the right of the canvas, where a spec card slides in.
    expect(findable(surface.camera, tiles())).toBe(true);
    surface.setSafeArea({ top: 0, right: 500, bottom: 0, left: 0 });
    expect(findable(surface.camera, tiles())).toBe(true);
    surface.setSafeArea(NO_SAFE_AREA);
    const host = surface.canvas.parentElement as HTMLElement;
    const width = host.style.width;
    try {
      host.style.width = '500px';
      await vi.waitFor(() => expect(surface.camera.width).toBe(500));
      expect(findable(surface.camera, tiles())).toBe(true);
    } finally {
      host.style.width = width;
      await vi.waitFor(() => expect(surface.camera.width).toBe(1180));
    }
  }, MOUNT_MS);

  it('a fling far across the canvas still leaves 96 px of a drawn part beside the panels', () => {
    surface.load(twentyFiveParts);
    surface.setSafeArea(PANELS);
    surface.fit();
    surface.setZoom(4);
    const from = { x: 300, y: 400 };
    for (const to of [{ x: 300 + 6000, y: 400 }, { x: 300 - 9000, y: 400 + 5000 }, { x: 300, y: 400 - 8000 }]) {
      pointer(surface.canvas, 'pointerdown', from);
      pointer(surface.canvas, 'pointermove', to);
      pointer(surface.canvas, 'pointerup', to);
      expect(findable(surface.camera, tiles()), `after a fling to ${to.x}, ${to.y}`).toBe(true);
    }
  });
});

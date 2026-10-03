// Tidy wires and the zoom limits on a real canvas (task 3.7), in the iPad profile: tidying through the one command
// layer (the app's button calls `tidyWires`; the list view's button, by finger, mouse or Enter, performs the same
// command) with identical routes, routed wires drawn and hit along their routes, the body as the renderer draws it,
// routes kept while they fit the build, and fit, zoom and the limits working in the canvas the safe area leaves
// uncovered (D66, D70), re-held on a resize or a new safe area.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Vec2 } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { drawnBodySize, pictureSize } from '../../src/renderer/picture.ts';
import { paletteFor } from '../../src/renderer/style.ts';
import { TIDY_WIRES_ACTION } from '../../src/routing/commands.ts';
import { routeWires } from '../../src/routing/router.ts';
import { NO_SAFE_AREA, screenCentre } from '../../src/routing/view.ts';
import type { Polygon } from '../../src/routing/view.ts';
import { distance, distanceToSegment, rectCentre } from '../../src/scene/geometry.ts';
import type { Rect } from '../../src/scene/geometry.ts';
import { WIRE_HIT_MM } from '../../src/scene/units.ts';
import { fixture, twentyFiveParts } from '../helpers/catalogue.ts';
import { findable } from '../helpers/findable.ts';
import { PREFS, colourDistance, describeRgb, listen, mount, mouse, pointer, reset, rgbOf, settle, shoot, svgArt, touch, unmountAll } from './helpers.ts';

/** The app shell's room in landscape: a header, a spec card on the right and the Run bar below (D66, D70). */
const PANELS = { top: 64, right: 340, bottom: 96, left: 0 };

let surface: CanvasSurface;

/** A software GPU on a busy machine can take a minute to mount a canvas, and minutes for many gestures. */
const MOUNT_MS = 120_000;
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
    try {
      const result = surface.apply({ kind: 'tidy-wires' });
      expect(result.ok === false && result.refusal.code).toBe('edit.locked');
      surface.tidyWires();
      expect(surface.routing.routes.size).toBe(0);
    } finally {
      surface.setMode('build');
    }
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
    expect(expected).toBe(plain(routeWires(surface.scene)));
    const wireId = surface.scene.wires.find((wire) => surface.routing.routeOf(wire.id))?.id;
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

describe('the body a route keeps off', () => {
  it('is the picture as the renderer draws it, at the size `drawnBodySize` gives', async () => {
    const art = svgArt('#3a7');
    const { surface: drawn, unmount } = await mount({ resolveArt: () => ({ src: art, isPlaceholder: true }) });
    try {
      drawn.load(fixture('rolling-start'));
      await settle(drawn);
      for (const part of drawn.scene.parts) {
        const picture = drawn.partView(part.id)?.drawnPicture;
        if (!picture) throw new Error(`${part.id} shows no picture`);
        // The test picture is 160 × 100; placeholder art keeps the footprint's proportions, which drawnBodySize uses.
        const expected = pictureSize(part.tile, { width: 160, height: 100 });
        expect(picture.w, part.id).toBeCloseTo(expected.w, 6);
        expect(picture.h, part.id).toBeCloseTo(expected.h, 6);
        const body = drawnBodySize(part.record, part.tile);
        expect(body).toEqual(pictureSize(part.tile, { width: part.record.body.size.x, height: part.record.body.size.y }));
      }
    } finally {
      unmount();
    }
  }, MOUNT_MS);
});

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

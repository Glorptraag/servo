import { describe, expect, it } from 'vitest';
import { Camera, FIT_PADDING_PX, fittingZoom, limitsFor } from '../src/renderer/camera.ts';
import type { ViewLimits } from '../src/renderer/camera.ts';
import type { Vec2 } from '@servo/schema';
import { KEEP_ON_SCREEN_PX, MIN_UNCOVERED_SHARE, checkSafeArea, screenCentre, uncovered } from '../src/routing/view.ts';
import type { Polygon } from '../src/routing/view.ts';
import type { Rect } from '../src/scene/geometry.ts';
import { buildScene } from '../src/scene/scene.ts';
import { PX_PER_MM } from '../src/scene/units.ts';
import { benchCatalogue, busyWorkbench } from './helpers/busy-workbench.ts';
import { blueprintOf, catalogue } from './helpers/catalogue.ts';
import { findable } from './helpers/findable.ts';

const camera = (width = 1000, height = 700): Camera => {
  const view = new Camera();
  view.resize(width, height);
  return view;
};

const open: ViewLimits = {
  minZoom: 0.01,
  maxZoom: 4,
  targets: [
    [
      { x: -1e6, y: -1e6 },
      { x: 1e6, y: -1e6 },
      { x: 1e6, y: 1e6 },
      { x: -1e6, y: 1e6 },
    ],
  ],
};
const build = { minX: -100, minY: -80, maxX: 100, maxY: 80 };

describe('the camera', () => {
  it('puts the canvas origin in the middle at zoom 1, at 2.5 px per mm', () => {
    const view = camera();
    expect(view.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 500, y: 350 });
    expect(view.worldToScreen({ x: 10, y: -4 })).toEqual({ x: 500 + 10 * PX_PER_MM, y: 350 - 4 * PX_PER_MM });
  });

  it('maps screen to plane and back', () => {
    const view = camera();
    view.centreX = 37;
    view.centreY = -12;
    view.zoom = 1.7;
    for (const point of [{ x: 0, y: 0 }, { x: 123.5, y: 77 }, { x: 999, y: 699 }]) {
      const back = view.worldToScreen(view.screenToWorld(point));
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it('pans with the drag: the plane follows the finger', () => {
    const view = camera();
    const under = view.screenToWorld({ x: 200, y: 300 });
    view.panBy(40, -25, open);
    const moved = view.worldToScreen(under);
    expect(moved.x).toBeCloseTo(240, 9);
    expect(moved.y).toBeCloseTo(275, 9);
  });

  it('zooms about a point, keeping what is under it there', () => {
    const view = camera();
    const screen = { x: 812, y: 133 };
    const under = view.screenToWorld(screen);
    view.zoomAbout(screen, 2.5, open);
    expect(view.zoom).toBe(2.5);
    const after = view.worldToScreen(under);
    expect(after.x).toBeCloseTo(screen.x, 9);
    expect(after.y).toBeCloseTo(screen.y, 9);
  });

  it('keeps the centre where it was when the host resizes', () => {
    const view = camera();
    view.centreX = 50;
    view.resize(600, 400);
    expect(view.screenToWorld({ x: 300, y: 200 })).toEqual({ x: 50, y: 0 });
  });
});

describe('fit', () => {
  it('centres the build and shows all of it inside the padding', () => {
    const view = camera();
    view.fit({ minX: 0, minY: 0, maxX: 600, maxY: 200 }, limitsFor([], 1000, 700));
    expect(view.screenToWorld({ x: 500, y: 350 })).toEqual({ x: 300, y: 100 });
    expect(view.zoom).toBeCloseTo((1000 - 2 * FIT_PADDING_PX) / (600 * PX_PER_MM), 9);
    expect(view.worldToScreen({ x: 0, y: 0 }).x).toBeCloseTo(FIT_PADDING_PX, 9);
  });

  it('never zooms in past the default zoom', () => {
    const view = camera();
    view.fit({ minX: -5, minY: -5, maxX: 5, maxY: 5 }, limitsFor([], 1000, 700));
    expect(view.zoom).toBe(1);
  });

  it('with nothing placed, returns to the canvas origin at zoom 1', () => {
    const view = camera();
    view.centreX = 900;
    view.zoom = 3;
    view.fit(undefined, limitsFor([], 1000, 700));
    expect([view.centreX, view.centreY, view.zoom]).toEqual([0, 0, 1]);
  });

  it('centres the build in the canvas the safe area leaves uncovered (D70)', () => {
    const view = camera();
    // A spec card 300 px wide on the right and a Run bar 100 px tall at the bottom.
    view.safeArea = { top: 0, right: 300, bottom: 100, left: 0 };
    const content = { minX: 0, minY: 0, maxX: 600, maxY: 200 };
    view.fit(content, limitsFor([box(content)], 700, 600));
    const centre = view.worldToScreen({ x: 300, y: 100 });
    expect(centre.x).toBeCloseTo(350, 9);
    expect(centre.y).toBeCloseTo(300, 9);
    expect(view.zoom).toBeCloseTo((700 - 2 * FIT_PADDING_PX) / (600 * PX_PER_MM), 9);
    expect(view.worldToScreen({ x: 600, y: 0 }).x).toBeCloseTo(700 - FIT_PADDING_PX, 9);
  });
});

describe('the safe area', () => {
  it('leaves the canvas less its insets', () => {
    expect(uncovered(1000, 700, { top: 20, right: 300, bottom: 100, left: 10 })).toEqual({ x: 10, y: 20, width: 690, height: 580 });
  });

  it('always leaves at least half of each side uncovered, whatever it is told', () => {
    const view = uncovered(1000, 700, { top: 0, right: 900, bottom: 700, left: 300 });
    expect(view.width).toBeCloseTo(1000 * MIN_UNCOVERED_SHARE, 9);
    expect(view.height).toBeCloseTo(700 * MIN_UNCOVERED_SHARE, 9);
    expect(view.x).toBeCloseTo(125, 9);
    expect(view.y).toBe(0);
  });

  it('refuses an inset that is not a finite number from 0', () => {
    expect(() => checkSafeArea({ top: -1, right: 0, bottom: 0, left: 0 })).toThrow(RangeError);
    expect(() => checkSafeArea({ top: 0, right: Number.NaN, bottom: 0, left: 0 })).toThrow(RangeError);
    expect(checkSafeArea({ top: 1, right: 2, bottom: 3, left: 4 })).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  it('zooms about the centre of the uncovered canvas, as setZoom does', () => {
    const view = camera();
    view.safeArea = { top: 0, right: 300, bottom: 0, left: 0 };
    const focus = view.focus();
    view.zoomAbout(screenCentre(view.uncovered()), 2, limitsFor([box(build)], 700, 700));
    expect(view.focus().x).toBeCloseTo(focus.x, 9);
    expect(view.focus().y).toBeCloseTo(focus.y, 9);
    expect(screenCentre(view.uncovered())).toEqual({ x: 350, y: 350 });
  });
});

/** A shape's four corners in order: a part's turned tile in the scene's terms. */
const box = (rect: Rect): Polygon => [
  { x: rect.minX, y: rect.minY },
  { x: rect.maxX, y: rect.minY },
  { x: rect.maxX, y: rect.maxY },
  { x: rect.minX, y: rect.maxY },
];

/** A tile `w` × `h` mm centred on `centre`, turned `degrees` clockwise. */
const turned = (centre: Vec2, w: number, h: number, degrees: number): Polygon => {
  const a = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: centre.x + c * (x as number) - s * (y as number), y: centre.y + s * (x as number) + c * (y as number) }));
};

describe('zoom and pan limits', () => {
  it('stops at 400%', () => {
    const view = camera();
    view.zoomAbout({ x: 500, y: 350 }, 9, limitsFor([box(build)], 1000, 700));
    expect(view.zoom).toBe(4);
  });

  it('stops zooming out at half the fitting zoom, or half the default for a small build', () => {
    const small = limitsFor([box(build)], 1000, 700);
    expect(small.minZoom).toBe(0.5);
    const large = { minX: -2000, minY: -1000, maxX: 2000, maxY: 1000 };
    const limits = limitsFor([box(large)], 1000, 700);
    expect(limits.minZoom).toBeCloseTo(fittingZoom(large, 1000, 700) / 2, 12);
    const view = camera();
    view.zoomAbout({ x: 500, y: 350 }, 0.001, limits);
    expect(view.zoom).toBeCloseTo(limits.minZoom, 12);
  });

  it('keeps a 96 px piece of the build on screen however far the child pans', () => {
    const view = camera();
    view.panBy(-1e6, 1e6, limitsFor([box(build)], 1000, 700));
    const a = view.worldToScreen({ x: build.maxX, y: build.minY });
    // The build's top right corner sits 96 px in from the view's bottom left.
    expect(a.x).toBeCloseTo(KEEP_ON_SCREEN_PX, 6);
    expect(a.y).toBeCloseTo(700 - KEEP_ON_SCREEN_PX, 6);
    expect(findable(view, [box(build)])).toBe(true);
  });

  it('lets a view that is already outside move back without jumping', () => {
    const view = camera();
    view.centreX = 500;
    const limits = limitsFor([box(build)], 1000, 700);
    view.panBy(10 * PX_PER_MM, 0, limits);
    expect(view.centreX).toBeCloseTo(490, 9);
    view.panBy(-20 * PX_PER_MM, 0, limits);
    expect(view.centreX).toBeCloseTo(490, 9);
  });

  it('zooming in on the empty workbench between two parts slides the view onto a part', () => {
    const left = { minX: -400, minY: -20, maxX: -360, maxY: 20 };
    const right = { minX: 360, minY: -20, maxX: 400, maxY: 20 };
    const limits = limitsFor([box(left), box(right)], 1000, 700);
    const view = camera();
    view.fit({ minX: -400, minY: -20, maxX: 400, maxY: 20 }, limits);
    expect(findable(view, [box(left), box(right)])).toBe(true);
    for (let step = 0; step < 40; step++) view.zoomAbout({ x: 500, y: 350 }, view.zoom * 1.1, limits);
    expect(view.zoom).toBe(4);
    expect(findable(view, [box(left), box(right)])).toBe(true);
  });

  it('keeps a lone chassis in view at 400%, panned to a corner beside the panels (review R-3.7, finding 3)', () => {
    const scene = buildScene(blueprintOf({ parts: [{ id: 'p1', part: 'chassis', position: { x: 0, y: 0 }, rotation: 0, settings: {} }], wires: [] }), catalogue);
    const targets = scene.parts.map((part) => part.corners);
    const view = camera(1180, 820);
    view.safeArea = { top: 64, right: 340, bottom: 96, left: 0 };
    const shown = view.uncovered();
    const limits = limitsFor(targets, shown.width, shown.height);
    view.fit(scene.bounds, limits);
    view.zoomAbout(screenCentre(shown), 4, limits);
    view.panBy(-1e6, 1e6, limits);
    expect(view.zoom).toBe(4);
    expect(findable(view, targets)).toBe(true);
  });

  it('keeps a turned part in view: a chassis at 45 degrees in every corner, and a small part at 45 degrees at 400%', () => {
    for (const [w, h, zoom] of [
      [160, 130, 1],
      [58, 32, 4],
      [38.4, 38.4, 4],
    ] as const) {
      const target = turned({ x: 0, y: 0 }, w, h, 45);
      const view = camera(1180, 820);
      view.safeArea = { top: 64, right: 340, bottom: 96, left: 0 };
      const shown = view.uncovered();
      const limits = limitsFor([target], shown.width, shown.height);
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        view.centreX = 0;
        view.centreY = 0;
        view.zoom = 1;
        view.zoomAbout(screenCentre(shown), zoom, limits);
        view.panBy(dx * 1e6, dy * 1e6, limits);
        expect(findable(view, [target]), `${w} × ${h} at ${zoom}, panned ${dx}, ${dy}`).toBe(true);
      }
    }
  });

  it('brings a view back when a new safe area leaves the build covered', () => {
    const view = camera(1180, 820);
    const targets = [box(build)];
    const shown = view.uncovered();
    view.panBy(1e6, 0, limitsFor(targets, shown.width, shown.height));
    // A spec card slides in over the right of the canvas, where the build is.
    view.safeArea = { top: 0, right: 600, bottom: 0, left: 0 };
    const covered = view.uncovered();
    expect(findable(view, targets)).toBe(false);
    view.reHold(limitsFor(targets, covered.width, covered.height));
    expect(findable(view, targets)).toBe(true);
  });

  it('never loses the 25-part busy workbench, whatever the child does with a panel covering the canvas', () => {
    const scene = buildScene(busyWorkbench, benchCatalogue);
    const targets = scene.parts.map((part) => part.corners);
    const view = camera(1180, 820);
    view.safeArea = { top: 64, right: 340, bottom: 96, left: 0 };
    const shown = view.uncovered();
    const limits = limitsFor(targets, shown.width, shown.height);
    view.fit(scene.bounds, limits);
    expect(findable(view, targets)).toBe(true);
    // A fixed pseudo-random run of pans, flings, pinches and wheel turns anywhere on the canvas.
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let step = 0; step < 2000; step++) {
      const at = { x: random() * 1180, y: random() * 820 };
      const roll = random();
      if (roll < 0.45) view.panBy((random() - 0.5) * 1600, (random() - 0.5) * 1200, limits);
      else view.zoomAbout(at, view.zoom * (roll < 0.75 ? 0.5 + random() : 1 + 3 * random()), limits);
      expect(view.zoom).toBeGreaterThanOrEqual(limits.minZoom - 1e-12);
      expect(view.zoom).toBeLessThanOrEqual(limits.maxZoom);
      expect(findable(view, targets), `after step ${step}`).toBe(true);
    }
  }, 120_000);
});

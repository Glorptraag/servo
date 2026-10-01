import { describe, expect, it } from 'vitest';
import { Camera, FIT_PADDING_PX, fittingZoom, limitsFor } from '../src/renderer/camera.ts';
import type { ViewLimits } from '../src/renderer/camera.ts';
import { PX_PER_MM } from '../src/scene/units.ts';

const camera = (width = 1000, height = 700): Camera => {
  const view = new Camera();
  view.resize(width, height);
  return view;
};

const open: ViewLimits = { minZoom: 0.01, maxZoom: 4, area: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 } };
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
    view.fit({ minX: 0, minY: 0, maxX: 600, maxY: 200 }, limitsFor(undefined, 1000, 700));
    expect(view.screenToWorld({ x: 500, y: 350 })).toEqual({ x: 300, y: 100 });
    expect(view.zoom).toBeCloseTo((1000 - 2 * FIT_PADDING_PX) / (600 * PX_PER_MM), 9);
    expect(view.worldToScreen({ x: 0, y: 0 }).x).toBeCloseTo(FIT_PADDING_PX, 9);
  });

  it('never zooms in past the default zoom', () => {
    const view = camera();
    view.fit({ minX: -5, minY: -5, maxX: 5, maxY: 5 }, limitsFor(undefined, 1000, 700));
    expect(view.zoom).toBe(1);
  });

  it('with nothing placed, returns to the canvas origin at zoom 1', () => {
    const view = camera();
    view.centreX = 900;
    view.zoom = 3;
    view.fit(undefined, limitsFor(undefined, 1000, 700));
    expect([view.centreX, view.centreY, view.zoom]).toEqual([0, 0, 1]);
  });
});

describe('zoom and pan limits', () => {
  it('stops at 400%', () => {
    const view = camera();
    view.zoomAbout({ x: 500, y: 350 }, 9, limitsFor(build, 1000, 700));
    expect(view.zoom).toBe(4);
  });

  it('stops zooming out at half the fitting zoom, or half the default for a small build', () => {
    const small = limitsFor(build, 1000, 700);
    expect(small.minZoom).toBe(0.5);
    const large = { minX: -2000, minY: -1000, maxX: 2000, maxY: 1000 };
    const limits = limitsFor(large, 1000, 700);
    expect(limits.minZoom).toBeCloseTo(fittingZoom(large, 1000, 700) / 2, 12);
    const view = camera();
    view.zoomAbout({ x: 500, y: 350 }, 0.001, limits);
    expect(view.zoom).toBeCloseTo(limits.minZoom, 12);
  });

  it('keeps the view centre over the build, so the build is never lost', () => {
    const view = camera();
    view.panBy(-1e6, 1e6, limitsFor(build, 1000, 700));
    expect(view.centreX).toBe(build.maxX);
    expect(view.centreY).toBe(build.minY);
  });

  it('lets a view that is already outside move back without jumping', () => {
    const view = camera();
    view.centreX = 500;
    const limits = limitsFor(build, 1000, 700);
    view.panBy(10 * PX_PER_MM, 0, limits);
    expect(view.centreX).toBeCloseTo(490, 9);
    view.panBy(-20 * PX_PER_MM, 0, limits);
    expect(view.centreX).toBeCloseTo(490, 9);
  });
});

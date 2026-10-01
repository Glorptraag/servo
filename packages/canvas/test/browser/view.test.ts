// Pan, zoom, fit, the zoom limits and the grid that fades at rest, through the input paths a child uses: a mouse
// drag, a wheel, a one-finger drag and a two-finger pinch (brief Section 10). One canvas serves every test here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { PX_PER_MM } from '../../src/scene/units.ts';
import { fixture, twentyFiveParts } from '../helpers/catalogue.ts';
import { PREFS, frames, listen, mount, mouseDrag, pointer, reset, settle, touch, unmountAll } from './helpers.ts';

/** An empty spot of workbench at the default view of the Rolling Start robot. */
const EMPTY = { x: 150, y: 150 };

let surface: CanvasSurface;

beforeAll(async () => {
  ({ surface } = await mount());
});

beforeEach(() => reset(surface));

afterAll(unmountAll);

describe('fit and setZoom', () => {
  it('starts at the default zoom with the canvas origin in the middle', async () => {
    const { surface: fresh, unmount } = await mount();
    expect(fresh.zoom).toBe(1);
    expect(fresh.camera.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 590, y: 410 });
    unmount();
  });

  it('fits a Level 1 build on a 10-inch tablet without scrolling, at the default zoom (brief Section 9)', () => {
    surface.load(fixture('rolling-start'));
    surface.fit();
    expect(surface.zoom).toBe(1);
  });

  it('fits the 25-part build: every tile and socket on screen, at most the default zoom, and fires zoom', () => {
    const seen = listen(surface, 'zoom');
    surface.load(twentyFiveParts);
    surface.fit();
    expect(surface.zoom).toBeLessThan(1);
    expect(seen).toEqual([{ zoom: surface.zoom }]);
    for (const part of surface.scene.parts) {
      const a = surface.camera.worldToScreen({ x: part.bounds.minX, y: part.bounds.minY });
      const b = surface.camera.worldToScreen({ x: part.bounds.maxX, y: part.bounds.maxY });
      expect(Math.min(a.x, a.y), part.id).toBeGreaterThanOrEqual(0);
      expect(b.x, part.id).toBeLessThanOrEqual(1180);
      expect(b.y, part.id).toBeLessThanOrEqual(820);
    }
  });

  it('in Run mode, fits the arena around the build too', () => {
    surface.load(fixture('rolling-start'));
    surface.setMode('run');
    surface.fit();
    const arena = surface.arena;
    if (!arena) throw new Error('no arena');
    for (const corner of arena.corners) {
      const at = surface.camera.worldToScreen(corner);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThanOrEqual(1180);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThanOrEqual(820);
    }
  });

  it('zooms about the centre up to 400%, and says so only when the zoom changes', () => {
    surface.load(fixture('rolling-start'));
    const seen = listen(surface, 'zoom');
    const centre = surface.camera.screenToWorld({ x: 590, y: 410 });
    surface.setZoom(2);
    surface.setZoom(2);
    surface.setZoom(9);
    expect(seen.map((event) => event.zoom)).toEqual([2, 4]);
    expect(surface.zoom).toBe(4);
    const after = surface.camera.screenToWorld({ x: 590, y: 410 });
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.y).toBeCloseTo(centre.y, 9);
    expect(() => surface.setZoom(Number.NaN)).toThrow(RangeError);
  });

  it('keeps the build findable: zooming out stops at half the default zoom for a small build', () => {
    surface.load(fixture('rolling-start'));
    surface.setZoom(0.01);
    expect(surface.zoom).toBe(0.5);
  });
});

describe('pan', () => {
  it('follows a mouse drag on empty canvas', async () => {
    surface.load(fixture('rolling-start'));
    await settle(surface);
    expect(surface.hitAt(EMPTY)).toBeNull();
    const grabbed = surface.camera.screenToWorld(EMPTY);
    await mouseDrag(surface.canvas, EMPTY, { x: EMPTY.x + 120, y: EMPTY.y + 60 });
    const now = surface.camera.worldToScreen(grabbed);
    expect(now.x).toBeCloseTo(EMPTY.x + 120, 6);
    expect(now.y).toBeCloseTo(EMPTY.y + 60, 6);
    expect(surface.zoom).toBe(1);
  });

  it('follows a one-finger drag on empty canvas', async () => {
    surface.load(fixture('rolling-start'));
    const grabbed = surface.camera.screenToWorld(EMPTY);
    await touch(surface.canvas, 'touchStart', [EMPTY]);
    for (let i = 1; i <= 6; i++) await touch(surface.canvas, 'touchMove', [{ x: EMPTY.x + 15 * i, y: EMPTY.y - 10 * i }]);
    await touch(surface.canvas, 'touchEnd', []);
    const now = surface.camera.worldToScreen(grabbed);
    expect(now.x).toBeCloseTo(EMPTY.x + 90, 6);
    expect(now.y).toBeCloseTo(EMPTY.y - 60, 6);
  });

  it('does not pan from a drag that starts on a part: that drag is the part’s (task 3.2)', async () => {
    surface.load(fixture('rolling-start'));
    const onChassis = surface.camera.worldToScreen({ x: -45, y: 40 });
    expect(surface.hitAt(onChassis)?.kind).toBe('part');
    await mouseDrag(surface.canvas, onChassis, { x: onChassis.x + 100, y: onChassis.y });
    expect([surface.camera.centreX, surface.camera.centreY]).toEqual([0, 0]);
  });

  it('waits for the drag threshold, which drag sensitivity scales (D44)', () => {
    surface.load(fixture('rolling-start'));
    surface.setPrefs({ ...PREFS, dragSensitivity: 0.5 });
    pointer(surface.canvas, 'pointerdown', EMPTY);
    try {
      pointer(surface.canvas, 'pointermove', { x: EMPTY.x + 12, y: EMPTY.y });
      expect(surface.camera.centreX).toBe(0);
      pointer(surface.canvas, 'pointermove', { x: EMPTY.x + 20, y: EMPTY.y });
      expect(surface.camera.centreX).toBeCloseTo(-20 / PX_PER_MM, 9);
    } finally {
      pointer(surface.canvas, 'pointerup', { x: EMPTY.x + 20, y: EMPTY.y });
    }
  });

  it('stops with the view centre still over the build', () => {
    surface.load(fixture('rolling-start'));
    pointer(surface.canvas, 'pointerdown', EMPTY);
    pointer(surface.canvas, 'pointermove', { x: EMPTY.x + 5000, y: EMPTY.y + 5000 });
    pointer(surface.canvas, 'pointerup', { x: EMPTY.x + 5000, y: EMPTY.y + 5000 });
    const bounds = surface.scene.bounds;
    if (!bounds) throw new Error('no bounds');
    expect(surface.camera.centreX).toBe(bounds.minX);
    expect(surface.camera.centreY).toBe(bounds.minY);
  });
});

describe('zoom by hand', () => {
  it('zooms with the wheel about the pointer', async () => {
    surface.load(fixture('rolling-start'));
    const seen = listen(surface, 'zoom');
    const box = surface.canvas.getBoundingClientRect();
    const target = { x: box.width / 2, y: box.height / 2 };
    const under = surface.camera.screenToWorld(target);
    await userEvent.wheel(surface.canvas, { delta: { y: -200 } });
    await expect.poll(() => surface.zoom).toBeGreaterThan(1);
    expect(seen.length).toBeGreaterThan(0);
    const after = surface.camera.worldToScreen(under);
    expect(after.x).toBeCloseTo(target.x, 3);
    expect(after.y).toBeCloseTo(target.y, 3);
  });

  it('zooms with a pinch and pans with two fingers, about the point between them', async () => {
    surface.load(fixture('rolling-start'));
    const under = surface.camera.screenToWorld({ x: 500, y: 410 });
    await touch(surface.canvas, 'touchStart', [
      { x: 400, y: 410 },
      { x: 600, y: 410 },
    ]);
    // Spread to twice the distance while the pair moves 40 px down.
    for (let i = 1; i <= 5; i++) {
      const spread = 100 + 20 * i;
      const y = 410 + 8 * i;
      await touch(surface.canvas, 'touchMove', [
        { x: 500 - spread, y },
        { x: 500 + spread, y },
      ]);
    }
    await touch(surface.canvas, 'touchEnd', []);
    expect(surface.zoom).toBeCloseTo(2, 6);
    const after = surface.camera.worldToScreen(under);
    expect(after.x).toBeCloseTo(500, 3);
    expect(after.y).toBeCloseTo(450, 3);
  });

  it('pinches even when the fingers land on parts: two fingers always move the view', async () => {
    surface.load(fixture('rolling-start'));
    const left = surface.camera.worldToScreen({ x: -45, y: 40 });
    const right = surface.camera.worldToScreen({ x: 60, y: 40 });
    await touch(surface.canvas, 'touchStart', [left, right]);
    await touch(surface.canvas, 'touchMove', [
      { x: left.x - 50, y: left.y },
      { x: right.x + 50, y: right.y },
    ]);
    await touch(surface.canvas, 'touchEnd', []);
    expect(surface.zoom).toBeGreaterThan(1);
  });
});

describe('the grid', () => {
  it('shows while the view moves and fades out at rest', async () => {
    surface.load(fixture('rolling-start'));
    await settle(surface);
    expect(surface.gridOpacity).toBe(0);
    pointer(surface.canvas, 'pointerdown', EMPTY);
    try {
      pointer(surface.canvas, 'pointermove', { x: EMPTY.x + 30, y: EMPTY.y });
      await frames(12);
      expect(surface.gridOpacity).toBe(1);
      // Still held: still showing.
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(surface.gridOpacity).toBe(1);
    } finally {
      pointer(surface.canvas, 'pointerup', { x: EMPTY.x + 30, y: EMPTY.y });
    }
    await settle(surface);
    expect(surface.gridOpacity).toBe(0);
  });

  it('draws nothing at rest: no frames once the canvas has settled (no idle animation)', async () => {
    surface.load(fixture('rolling-start'));
    surface.fit();
    await settle(surface);
    const original = window.requestAnimationFrame;
    let requests = 0;
    window.requestAnimationFrame = (callback) => {
      requests++;
      return original.call(window, callback);
    };
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(surface.settled).toBe(true);
      expect(requests).toBe(0);
    } finally {
      window.requestAnimationFrame = original;
    }
  });
});

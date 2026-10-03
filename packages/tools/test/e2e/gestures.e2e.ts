// The harness's hands on the canvas as it stands: real touch and mouse input through CDP, in page coordinates, reaches
// the canvas as a child's would. A one-finger drag and a mouse drag on empty canvas move the view exactly with the
// hand, a pinch zooms about the point between the fingers, the wheel zooms about the pointer, and none of them
// changes the build (brief Section 10). The parity check's touch and pointer paths are built from these gestures. A
// canvas smaller than the profile at half the default zoom: every move redraws it, and a software GPU (CI) draws a
// small one much faster.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import type { EditEvent } from '@servo/canvas';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, Vec2 } from '@servo/schema';
import { mountBench, pageOf, setView, settle } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { drag, pinch, tap, wheel } from '../../src/e2e/input.ts';

const fixture = loadFixtures().fixtures.find((candidate) => candidate.name === 'kit-rolling-start');

const CANVAS = { width: 640, height: 480 };
const ZOOM = 0.5;

let bench: Bench;
let edits: EditEvent[] = [];

beforeAll(async () => {
  bench = await mountBench({ trayWidth: 0, size: CANVAS });
  bench.handle.on('edit', (event) => edits.push(event));
});

afterAll(() => bench.destroy());

beforeEach(async () => {
  if (!fixture) throw new Error('No kit-rolling-start fixture.');
  expect(bench.handle.load(fixture.blueprint).ok).toBe(true);
  setView(bench, { x: 0, y: 0 }, ZOOM);
  await settle(bench);
  edits = [];
});

/** The canvas point under a page point, at the current view. */
const worldAt = (page: Vec2): Vec2 => {
  const box = bench.hooks.canvas.getBoundingClientRect();
  return bench.hooks.camera.screenToWorld({ x: page.x - box.left, y: page.y - box.top });
};

/** Bare workbench up and left of the Rolling Start robot, in page coordinates. */
const empty = (): Vec2 => pageOf(bench, { x: -220, y: -160 });

const unchanged = (before: Blueprint | undefined): void => {
  expect(edits).toEqual([]);
  expect(bench.handle.blueprint && serializeBlueprint(bench.handle.blueprint)).toBe(before && serializeBlueprint(before));
};

const expectNear = (actual: Vec2, expected: Vec2, digits = 3): void => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
};

describe('touch', () => {
  it('pans the view with a one-finger drag on empty canvas, keeping the canvas under the finger', async () => {
    const before = bench.handle.blueprint;
    const from = empty();
    const grabbed = worldAt(from);
    const to = { x: from.x + 90.5, y: from.y + 60.25 };
    await drag('touch', from, to, 3);
    expectNear(pageOf(bench, grabbed), to);
    unchanged(before);
  });

  it('zooms with a pinch about the point between the fingers, which follows the pair', async () => {
    const before = bench.handle.blueprint;
    const centre = pageOf(bench, { x: 0, y: 0 });
    const under = worldAt(centre);
    await pinch(centre, 200, 400, { x: 0, y: 40 });
    expect(bench.handle.zoom).toBeCloseTo(2 * ZOOM, 6);
    expectNear(pageOf(bench, under), { x: centre.x, y: centre.y + 40 });
    unchanged(before);
  });

  it('taps without changing the build', async () => {
    const before = bench.handle.blueprint;
    await tap('touch', pageOf(bench, { x: 0, y: 0 }));
    await tap('touch', empty());
    unchanged(before);
  });
});

describe('pointer', () => {
  it('pans the view with a mouse drag on empty canvas', async () => {
    const before = bench.handle.blueprint;
    const from = empty();
    const grabbed = worldAt(from);
    const to = { x: from.x + 100.75, y: from.y + 60.5 };
    await drag('mouse', from, to, 3);
    expectNear(pageOf(bench, grabbed), to);
    unchanged(before);
  });

  it('zooms with the wheel about the pointer', async () => {
    const before = bench.handle.blueprint;
    // Whole pixels: the browser reports a wheel event's position in whole pixels.
    const near = pageOf(bench, { x: 30, y: -20 });
    const at = { x: Math.round(near.x), y: Math.round(near.y) };
    const under = worldAt(at);
    await wheel(at, -200);
    expect(bench.handle.zoom).toBeGreaterThan(ZOOM);
    expectNear(pageOf(bench, under), at);
    unchanged(before);
  });

  it('clicks without changing the build', async () => {
    const before = bench.handle.blueprint;
    await tap('mouse', pageOf(bench, { x: 0, y: 0 }));
    await tap('mouse', empty());
    unchanged(before);
  });
});

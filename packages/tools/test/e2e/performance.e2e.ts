// Frame time on content's 25-part fixture (busy-workbench, "for canvas performance") with its real placeholder
// pictures, in the iPad profile with the CPU slowed 4× (task 3.1's budget: 60 fps on a 2020 iPad with 25 parts).
// A hand pans, wheels and pinches one input per frame; the median and the p95 frame's main-thread work must be
// within 16 ms, and on a hardware GPU frames must arrive at 50 fps or better. A software GPU (CI) draws this frame
// size far below 60 fps whatever the page does, so there fewer frames run and the frame rate is only printed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import { mountBench, settle } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { describeStats, gpuName, isSoftwareGpu, measureFrames, panGesture, pinchGesture, wheelGesture } from '../../src/e2e/performance.ts';
import { FRAME_BUDGET_MS, IPAD } from '../../src/e2e/profile.ts';

/** Frames delivered on a hardware GPU, allowing for a machine busy with other work. */
const MIN_FPS = 50;

const busy = loadFixtures().fixtures.find((fixture) => fixture.name === 'busy-workbench');

let bench: Bench;

beforeAll(async () => {
  bench = await mountBench({ trayWidth: 0, size: IPAD });
});

afterAll(() => bench.destroy());

describe('frame time in the iPad profile', () => {
  it('pans, wheels and pinches the 25-part busy-workbench with its pictures within a 16 ms frame budget', async () => {
    if (!busy) throw new Error('No busy-workbench fixture.');
    expect(busy.blueprint.parts).toHaveLength(25);
    expect(bench.handle.load(busy.blueprint).ok).toBe(true);
    bench.handle.fit();
    await settle(bench);
    const software = isSoftwareGpu(gpuName());
    const frames = software ? 20 : 60;
    const { canvas } = bench.hooks;
    // Inside the fit's padding: bare workbench, where a drag pans.
    const stats = await measureFrames([panGesture(canvas, { x: 24, y: 24 }), wheelGesture(canvas, { x: IPAD.width / 2, y: IPAD.height / 2 }, frames), pinchGesture(canvas, { x: IPAD.width / 2, y: IPAD.height / 2 })], frames);
    console.log(describeStats('busy-workbench, with pictures', stats));
    expect(stats.frames).toBe(3 * frames);
    expect(stats.median, 'median frame').toBeLessThanOrEqual(FRAME_BUDGET_MS);
    expect(stats.p95, 'p95 frame').toBeLessThanOrEqual(FRAME_BUDGET_MS);
    if (!software) expect(stats.fps, 'frames delivered per second').toBeGreaterThanOrEqual(MIN_FPS);
  });
});

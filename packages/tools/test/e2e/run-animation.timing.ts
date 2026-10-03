// Run mode at 60 fps (task 3.5): the 25-part `busy-workbench` content fixture runs through createSimulation, and its
// frames play into the canvas at 30 ticks a second, one every other display frame, with the canvas tweening between
// them, in the iPad profile with the CPU slowed 4× through CDP. Each frame's main-thread work is timed: every
// requestAnimationFrame callback, the canvas's own included, summed per frame. The simulation is stepped beforehand,
// since stepping is the app's run loop's cost, not the canvas's. The median and p95 frame must be within 16 ms, and on
// a hardware GPU frames must arrive at 50 fps or better; the figures are printed.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { loadFixtures } from '@servo/content/fixtures';
import type { RunFrame } from '@servo/sim-core';
import { frameOn, frames, mountBench, playTo, simulationOf } from './run-animation-bench.ts';
import type { Bench } from './run-animation-bench.ts';

const SIZE = { width: 1180, height: 820 } as const;
const CPU_SLOWDOWN = 4;
const BUDGET_MS = 16;
const MIN_FPS = 50;

const gpu = (): string => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
};

const GPU = gpu();
const SOFTWARE_GPU = /swiftshader|llvmpipe|software/i.test(GPU);

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;

let bench: Bench;

beforeAll(async () => {
  bench = await mountBench(SIZE);
});

afterAll(() => bench.destroy());

it('plays the 25-part build in Run mode within a 16 ms frame', async () => {
  const fixture = loadFixtures().fixtures.find((candidate) => candidate.name === 'busy-workbench');
  if (!fixture) throw new Error('No busy-workbench fixture.');
  expect(fixture.blueprint.parts).toHaveLength(25);
  const simulation = await simulationOf(fixture);
  const start = simulation.frame;
  const ticks: RunFrame[] = playTo(simulation, fixture, fixture.ticks);
  simulation.dispose();

  const { handle, hooks } = bench;
  expect(handle.load(fixture.blueprint).ok).toBe(true);
  handle.setMode('run');
  handle.applyRunFrame(start);
  frameOn(bench, fixture.blueprint.parts.map((part) => part.position), SIZE, 1, 160);
  // Tick 0 held is the spin-up, whose dots flow until the next tick: it never settles, so a few frames do.
  await frames(10);

  const work = new Map<number, number>();
  const original = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    original.call(window, (time) => {
      const begin = performance.now();
      try {
        callback(time);
      } finally {
        work.set(time, (work.get(time) ?? 0) + performance.now() - begin);
      }
    });
  const session = cdp();
  const driven: number[] = [];
  const frameCount = SOFTWARE_GPU ? 60 : 2 * ticks.length;
  try {
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    await new Promise<void>((resolve) => {
      let frame = 0;
      const step = (time: number): void => {
        driven.push(time);
        // 30 ticks a second at 60 frames a second: a new tick every other frame, tweened between.
        const tick = ticks[Math.floor(frame / 2)];
        if (frame % 2 === 0 && tick) handle.applyRunFrame(tick);
        frame += 1;
        if (frame < frameCount) window.requestAnimationFrame(step);
        else resolve();
      };
      window.requestAnimationFrame(step);
    });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  } finally {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    window.requestAnimationFrame = original;
  }
  const times = driven.map((time) => work.get(time) ?? 0).sort((a, b) => a - b);
  const intervals = driven
    .slice(1)
    .map((time, index) => time - (driven[index] as number))
    .sort((a, b) => a - b);
  const median = quantile(times, 0.5);
  const p95 = quantile(times, 0.95);
  const fps = 1000 / quantile(intervals, 0.5);
  console.log(
    `[run frame time] busy-workbench: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, worst ${(times[times.length - 1] ?? 0).toFixed(2)} ms ` +
      `over ${times.length} frames at ${CPU_SLOWDOWN}× CPU slowdown; GPU ${GPU}, drawn at ${fps.toFixed(0)} fps`,
  );
  expect(hooks.run.state?.tick).toBeGreaterThan(0);
  expect(median, 'median frame').toBeLessThanOrEqual(BUDGET_MS);
  expect(p95, 'p95 frame').toBeLessThanOrEqual(BUDGET_MS);
  if (!SOFTWARE_GPU) expect(fps, 'frames delivered per second').toBeGreaterThanOrEqual(MIN_FPS);
});

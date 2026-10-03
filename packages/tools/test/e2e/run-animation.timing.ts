// Run mode at 60 fps (task 3.5): the 25-part `busy-workbench` content fixture runs through createSimulation, and its
// frames play into the canvas at 30 ticks a second, one every other display frame, with the canvas tweening between
// them, in the iPad profile with the CPU slowed 4× through CDP. Each frame's main-thread work is timed: every
// requestAnimationFrame callback, the canvas's own included, summed per frame. The simulation is stepped beforehand,
// since stepping is the app's run loop's cost, not the canvas's. The median and p95 frame must be within 16 ms, and on
// a hardware GPU frames must arrive at 50 fps or better; the figures are printed. The Run plays SAMPLES times from tick
// 0; every sample is printed and the median sample is held to the budget, since on a shared CI runner with SwiftShader
// one run's p95 is one noisy sample (packages/tools/src/e2e/README.md, "frame time").
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { loadFixtures } from '@servo/content/fixtures';
import type { RunFrame } from '@servo/sim-core';
import { frameOn, frames, mountBench, playTo, simulationOf } from './run-animation-bench.ts';
import type { Bench } from './run-animation-bench.ts';

const SIZE = { width: 1180, height: 820 } as const;
const CPU_SLOWDOWN = 4;
const BUDGET_MS = 16;
const MIN_FPS = 50;
/** Independent plays of the Run; the median of them is held to the budget. */
const SAMPLES = 5;

// Five samples take minutes on CI's software GPU, past the config's four-minute test timeout.
vi.setConfig({ testTimeout: 900_000 });

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
  const samples: Sample[] = [];
  for (let index = 1; index <= SAMPLES; index += 1) {
    // A fresh Run each time: Stop, then Run from tick 0.
    handle.setMode('build');
    handle.setMode('run');
    handle.applyRunFrame(start);
    frameOn(bench, fixture.blueprint.parts.map((part) => part.position), SIZE, 1, 160);
    // Tick 0 held is the spin-up, whose dots flow until the next tick: it never settles, so a few frames do.
    await frames(10);
    const sample = await play(handle, ticks);
    log(`busy-workbench, sample ${index} of ${SAMPLES}`, sample);
    samples.push(sample);
  }
  const middle = (values: readonly number[]): number => quantile([...values].sort((a, b) => a - b), 0.5);
  const median = middle(samples.map((sample) => sample.median));
  const p95 = middle(samples.map((sample) => sample.p95));
  const fps = middle(samples.map((sample) => sample.fps));
  log(`busy-workbench, median of ${SAMPLES} samples`, { frames: samples.reduce((sum, sample) => sum + sample.frames, 0), median, p95, worst: Math.max(...samples.map((sample) => sample.worst)), fps });
  expect(hooks.run.state?.tick).toBeGreaterThan(0);
  expect(median, 'median frame').toBeLessThanOrEqual(BUDGET_MS);
  expect(p95, 'p95 frame').toBeLessThanOrEqual(BUDGET_MS);
  if (!SOFTWARE_GPU) expect(fps, 'frames delivered per second').toBeGreaterThanOrEqual(MIN_FPS);
});

interface Sample {
  readonly frames: number;
  readonly median: number;
  readonly p95: number;
  readonly worst: number;
  readonly fps: number;
}

const log = (label: string, sample: Sample): void => {
  console.log(
    `[run frame time] ${label}: median ${sample.median.toFixed(2)} ms, p95 ${sample.p95.toFixed(2)} ms, worst ${sample.worst.toFixed(2)} ms ` +
      `over ${sample.frames} frames at ${CPU_SLOWDOWN}× CPU slowdown; GPU ${GPU}, drawn at ${sample.fps.toFixed(0)} fps`,
  );
};

/** Plays the ticks into the canvas, a new one every other frame, with the CPU slowed, timing each frame's work. */
const play = async (handle: Bench['handle'], ticks: readonly RunFrame[]): Promise<Sample> => {
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
  return { frames: times.length, median: quantile(times, 0.5), p95: quantile(times, 0.95), worst: times[times.length - 1] ?? 0, fps: 1000 / quantile(intervals, 0.5) };
};

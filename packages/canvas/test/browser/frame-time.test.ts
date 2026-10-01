// Done-when for task 3.1: 60 fps, a 16 ms frame budget, on a 25-part build in the iPad profile (vitest.config.ts:
// 1180 × 820 CSS pixels at device scale factor 2), with the CPU slowed 4× through CDP to stand in for a 2020 iPad.
//
// A frame's time is the main-thread work the canvas does for it: handling that frame's input (pointer and wheel
// events, dispatched once a frame as a hand would) and drawing (Pixi's render call). Every requestAnimationFrame
// callback is timed, and the callbacks that share a frame's timestamp are summed. The median must be within 16 ms;
// the median, p95 and worst frame are printed, with the GPU and the frame rate the browser achieved. A software GPU
// (SwiftShader, as on CI) draws a frame this size far below 60 fps whatever the page does, so there the gestures
// run fewer frames: the main-thread time is still what is measured.
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import type { Vec2 } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { parts, twentyFiveParts } from '../helpers/catalogue.ts';
import { artFrom, mount, pointer, settle, svgArt, unmountAll } from './helpers.ts';

afterEach(unmountAll);

const CPU_SLOWDOWN = 4;
const BUDGET_MS = 16;

/** The GPU the browser renders WebGL with. */
const gpu = (): string => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
};

const GPU = gpu();
const SOFTWARE_GPU = /swiftshader|llvmpipe|software/i.test(GPU);
const FRAMES_PER_GESTURE = SOFTWARE_GPU ? 20 : 60;

interface Stats {
  readonly frames: number;
  readonly median: number;
  readonly p95: number;
  readonly worst: number;
  readonly fps: number;
}

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;

/** One gesture step per frame: what the hand does in that frame. */
type Step = (surface: CanvasSurface, frame: number, last: boolean) => void;

const emptySpot = (surface: CanvasSurface): Vec2 => {
  for (let y = 40; y < surface.camera.height; y += 40) {
    for (let x = 40; x < surface.camera.width; x += 40) if (!surface.hitAt({ x, y })) return { x, y };
  }
  throw new Error('no empty canvas to pan from');
};

/** Drag on empty canvas: down, a wandering path, up. */
const pan =
  (start: Vec2): Step =>
  (surface, frame, last) => {
    const at = { x: start.x + 160 * Math.sin(frame / 15), y: start.y + 90 * Math.sin(frame / 11) };
    if (frame === 0) pointer(surface.canvas, 'pointerdown', start, { id: 1 });
    pointer(surface.canvas, last ? 'pointerup' : 'pointermove', at, { id: 1 });
  };

/** The wheel, in and then out, about a point that drifts. */
const wheel: Step = (surface, frame) => {
  const box = surface.canvas.getBoundingClientRect();
  surface.canvas.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: frame < FRAMES_PER_GESTURE / 2 ? -12 : 12,
      clientX: box.left + 590 + 200 * Math.sin(frame / 20),
      clientY: box.top + 410,
      bubbles: true,
      cancelable: true,
    }),
  );
};

/** Two fingers: spreading and closing while the pair drifts, so the view zooms and pans at once. */
const pinch: Step = (surface, frame, last) => {
  const mid = { x: 590 + 120 * Math.sin(frame / 25), y: 410 + 60 * Math.sin(frame / 18) };
  const spread = 140 + 90 * Math.sin(frame / 12);
  [
    { x: mid.x - spread, y: mid.y },
    { x: mid.x + spread, y: mid.y },
  ].forEach((at, index) => {
    const options = { id: 21 + index, kind: 'touch' as const, primary: index === 0 };
    if (frame === 0) pointer(surface.canvas, 'pointerdown', at, options);
    pointer(surface.canvas, last ? 'pointerup' : 'pointermove', at, options);
  });
};

/**
 * Runs the gestures one step per animation frame with the CPU slowed, timing every frame's work. Every
 * requestAnimationFrame callback on the page is wrapped, so the canvas's own frames are timed as they really run.
 */
const measure = async (surface: CanvasSurface, gestures: readonly Step[]): Promise<Stats> => {
  const work = new Map<number, number>();
  const original = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    original.call(window, (time) => {
      const start = performance.now();
      try {
        callback(time);
      } finally {
        work.set(time, (work.get(time) ?? 0) + performance.now() - start);
      }
    });
  const session = cdp();
  const driven: number[] = [];
  try {
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    for (const gesture of gestures) {
      await new Promise<void>((resolve) => {
        let frame = 0;
        const step = (time: number): void => {
          driven.push(time);
          gesture(surface, frame, frame === FRAMES_PER_GESTURE - 1);
          frame += 1;
          if (frame < FRAMES_PER_GESTURE) window.requestAnimationFrame(step);
          else resolve();
        };
        window.requestAnimationFrame(step);
      });
    }
    // The frame that draws the last input.
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
  return {
    frames: times.length,
    median: quantile(times, 0.5),
    p95: quantile(times, 0.95),
    worst: times[times.length - 1] as number,
    fps: 1000 / quantile(intervals, 0.5),
  };
};

const report = (label: string, stats: Stats): void => {
  console.log(
    `[frame time] ${label}: median ${stats.median.toFixed(2)} ms, p95 ${stats.p95.toFixed(2)} ms, worst ${stats.worst.toFixed(2)} ms ` +
      `over ${stats.frames} frames at ${CPU_SLOWDOWN}× CPU slowdown; GPU ${GPU}, drawn at ${stats.fps.toFixed(0)} fps`,
  );
};

const artForEveryPart = artFrom(
  Object.fromEntries(parts.map((part) => [part.identity.art, svgArt(part.identity.colours.main, part.identity.colours.accent)])),
);

describe('frame time on the 25-part fixture, iPad profile', () => {
  it('pans, wheels and pinches within a 16 ms frame budget, with pictures', async () => {
    const { surface } = await mount({ resolveArt: artForEveryPart });
    surface.load(twentyFiveParts);
    surface.fit();
    await settle(surface);
    expect(surface.scene.parts).toHaveLength(25);
    expect(surface.scene.parts.every((part) => surface.partView(part.id)?.shows.picture)).toBe(true);
    const stats = await measure(surface, [pan(emptySpot(surface)), wheel, pinch]);
    report('pictures', stats);
    expect(stats.frames).toBe(3 * FRAMES_PER_GESTURE);
    expect(stats.median).toBeLessThanOrEqual(BUDGET_MS);
  });

  it('pans, wheels and pinches within a 16 ms frame budget, with neutral tiles and names', async () => {
    const { surface } = await mount();
    surface.load(twentyFiveParts);
    surface.fit();
    await settle(surface);
    expect(surface.partView('mc')?.shows.name).toBe('microcontroller');
    const stats = await measure(surface, [pan(emptySpot(surface)), wheel, pinch]);
    report('neutral tiles', stats);
    expect(stats.median).toBeLessThanOrEqual(BUDGET_MS);
  });
});

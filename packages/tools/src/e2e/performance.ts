// Frame time in the iPad profile (task 3.1's measurement, generalised): the CPU slowed through CDP to stand a fast
// machine in for a 2020 iPad, a hand that acts once per frame, and every frame's main-thread work timed. A frame's
// work is everything its requestAnimationFrame callbacks do (the hand's input and the canvas's drawing); callbacks
// sharing a timestamp are summed. The hand dispatches pointer and wheel events itself, inside the frame, because
// CDP input arrives on its own schedule and would split a frame's input from its drawing. Runs in the browser.
import { cdp } from 'vitest/browser';
import type { Vec2 } from '@servo/schema';
import { IPAD_CPU_SLOWDOWN } from './profile.ts';

/** The GPU the browser renders WebGL with. */
export const gpuName = (): string => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
};

/** SwiftShader (as on CI) or another software rasteriser: frames arrive far below 60 fps whatever the page does. */
export const isSoftwareGpu = (name: string): boolean => /swiftshader|llvmpipe|software/i.test(name);

/** What the hand does in one frame of a gesture. */
export type FrameStep = (frame: number, last: boolean) => void;

export interface Gesture {
  readonly name: string;
  readonly step: FrameStep;
}

export interface FrameStats {
  readonly frames: number;
  /** Main-thread work per frame, ms. */
  readonly median: number;
  readonly p95: number;
  readonly worst: number;
  /** Frames delivered per second, from the median interval. */
  readonly fps: number;
  readonly gpu: string;
  readonly slowdown: number;
}

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

/** Runs `fn` with the CPU slowed `rate` times through CDP, and always restores it. */
export const withCpuSlowdown = async <T>(rate: number, fn: () => Promise<T>): Promise<T> => {
  const session = cdp();
  await session.send('Emulation.setCPUThrottlingRate', { rate });
  try {
    return await fn();
  } finally {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
};

/**
 * Plays each gesture for `framesPerGesture` frames, one step per frame, with the CPU slowed, and times every frame's
 * main-thread work. Every requestAnimationFrame callback on the page is wrapped, so the canvas's own frames are timed
 * as they really run.
 */
export const measureFrames = async (gestures: readonly Gesture[], framesPerGesture: number, slowdown = IPAD_CPU_SLOWDOWN): Promise<FrameStats> => {
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
  const driven: number[] = [];
  try {
    await withCpuSlowdown(slowdown, async () => {
      for (const gesture of gestures) {
        await new Promise<void>((resolve) => {
          let frame = 0;
          const step = (time: number): void => {
            driven.push(time);
            gesture.step(frame, frame === framesPerGesture - 1);
            frame += 1;
            if (frame < framesPerGesture) window.requestAnimationFrame(step);
            else resolve();
          };
          window.requestAnimationFrame(step);
        });
      }
      // The frame that draws the last input.
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
  } finally {
    window.requestAnimationFrame = original;
  }
  const times = driven.map((time) => work.get(time) ?? 0).sort((a, b) => a - b);
  const intervals = driven
    .slice(1)
    .map((time, index) => time - (driven[index] ?? time))
    .sort((a, b) => a - b);
  return {
    frames: times.length,
    median: quantile(times, 0.5),
    p95: quantile(times, 0.95),
    worst: times[times.length - 1] ?? 0,
    fps: 1000 / Math.max(quantile(intervals, 0.5), 1e-6),
    gpu: gpuName(),
    slowdown,
  };
};

export const describeStats = (label: string, stats: FrameStats): string =>
  `[frame time] ${label}: median ${stats.median.toFixed(2)} ms, p95 ${stats.p95.toFixed(2)} ms, worst ${stats.worst.toFixed(2)} ms ` +
  `over ${stats.frames} frames at ${stats.slowdown}× CPU slowdown; GPU ${stats.gpu}, drawn at ${stats.fps.toFixed(0)} fps`;

/** A pointer event at a point in CSS pixels from `element`'s top left, dispatched in this frame. */
const pointer = (
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: Vec2,
  id: number,
  kind: 'mouse' | 'touch',
  primary: boolean,
): void => {
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      pointerType: kind,
      isPrimary: primary,
      clientX: box.left + at.x,
      clientY: box.top + at.y,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true,
      cancelable: true,
    }),
  );
};

/** A finger dragged on empty canvas from `start` along a wandering path: the view pans. */
export const panGesture = (element: Element, start: Vec2): Gesture => ({
  name: 'pan',
  step: (frame, last) => {
    const at = { x: start.x + 160 * Math.sin(frame / 15), y: start.y + 90 * Math.sin(frame / 11) };
    if (frame === 0) pointer(element, 'pointerdown', start, 1, 'touch', true);
    pointer(element, last ? 'pointerup' : 'pointermove', at, 1, 'touch', true);
  },
});

/** The wheel, in and then out over `frames` frames, about a point that drifts round `centre`. */
export const wheelGesture = (element: Element, centre: Vec2, frames: number): Gesture => ({
  name: 'wheel',
  step: (frame) => {
    const box = element.getBoundingClientRect();
    element.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: frame < frames / 2 ? -12 : 12,
        clientX: box.left + centre.x + 200 * Math.sin(frame / 20),
        clientY: box.top + centre.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  },
});

/** Two fingers spreading and closing while the pair drifts round `centre`: the view zooms and pans at once. */
export const pinchGesture = (element: Element, centre: Vec2): Gesture => ({
  name: 'pinch',
  step: (frame, last) => {
    const mid = { x: centre.x + 120 * Math.sin(frame / 25), y: centre.y + 60 * Math.sin(frame / 18) };
    const spread = 140 + 90 * Math.sin(frame / 12);
    [
      { x: mid.x - spread, y: mid.y },
      { x: mid.x + spread, y: mid.y },
    ].forEach((at, index) => {
      if (frame === 0) pointer(element, 'pointerdown', at, 21 + index, 'touch', index === 0);
      pointer(element, last ? 'pointerup' : 'pointermove', at, 21 + index, 'touch', index === 0);
    });
  },
});

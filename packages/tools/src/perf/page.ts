/// <reference lib="dom" />
// What the measurement runs inside the app's page (task 6.1): each function is handed to Playwright's page.evaluate,
// so it is self-contained and names nothing outside itself.
//
// A frame's work is timed two ways, both under the CPU slowdown:
// - `work`: the frame's requestAnimationFrame callbacks (the hand's input, the run loop's step, the canvas's drawing),
//   summed, as the canvas harness times it (packages/tools/src/e2e/performance.ts);
// - `busy`: from the frame's first callback until every task its callbacks queued has run, which takes in the React
//   renders the frame's updates schedule (the spec card's readouts, the Run bar), that the first misses.
// `interval` is the time between the frames the page was given, and `fps` the frames it was given a second over the
// whole gesture or Run, so a dropped frame counts: what a child would see.

export type Gesture = 'none' | 'wheel' | 'pinch';

export interface FrameSample {
  readonly frames: number;
  readonly workP50: number;
  readonly workP95: number;
  readonly busyP50: number;
  readonly busyP95: number;
  readonly busyWorst: number;
  /** Frames whose busy time passed 16 ms. */
  readonly over16: number;
  readonly intervalP50: number;
  readonly intervalP95: number;
  readonly fps: number;
  /** Every frame's busy time in the order the frames came, ms to 0.1. */
  readonly busy: readonly number[];
}

/** Plays `gesture` on the app's canvas for `frames` frames, one step per frame, and times every frame. */
export const timeFrames = async ({ frames, gesture }: { readonly frames: number; readonly gesture: Gesture }): Promise<FrameSample> => {
  const canvases = [...document.querySelectorAll('canvas')];
  const area = (element: Element): number => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
  const canvas = canvases.sort((a, b) => area(b) - area(a))[0];
  if (!canvas) throw new Error('The page has no canvas.');
  const box = canvas.getBoundingClientRect();
  const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, id: number, primary: boolean): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: 'touch',
        isPrimary: primary,
        clientX: x,
        clientY: y,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  const step = (frame: number, last: boolean): void => {
    if (gesture === 'wheel') {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: frame < frames / 2 ? -12 : 12,
          clientX: centre.x + (box.width / 6) * Math.sin(frame / 20),
          clientY: centre.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    } else if (gesture === 'pinch') {
      const mid = { x: centre.x + (box.width / 10) * Math.sin(frame / 25), y: centre.y + (box.height / 14) * Math.sin(frame / 18) };
      const spread = box.width / 8 + (box.width / 13) * Math.sin(frame / 12);
      [mid.x - spread, mid.x + spread].forEach((x, index) => {
        if (frame === 0) pointer('pointerdown', x, mid.y, 21 + index, index === 0);
        pointer(last ? 'pointerup' : 'pointermove', x, mid.y, 21 + index, index === 0);
      });
    }
  };

  const work = new Map<number, number>();
  const started = new Map<number, number>();
  const busy = new Map<number, number>();
  const original = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    original.call(window, (time) => {
      const start = performance.now();
      if (!started.has(time)) started.set(time, start);
      try {
        callback(time);
      } finally {
        const end = performance.now();
        work.set(time, (work.get(time) ?? 0) + end - start);
        // A task queued now runs after every task this frame queued before it, and after its microtasks.
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          busy.set(time, Math.max(busy.get(time) ?? 0, performance.now() - (started.get(time) ?? start)));
          channel.port1.close();
        };
        channel.port2.postMessage(0);
      }
    });
  const driven: number[] = [];
  try {
    await new Promise<void>((resolve) => {
      let frame = 0;
      const tick = (time: number): void => {
        driven.push(time);
        step(frame, frame === frames - 1);
        frame += 1;
        if (frame < frames) window.requestAnimationFrame(tick);
        else resolve();
      };
      window.requestAnimationFrame(tick);
    });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    window.requestAnimationFrame = original;
  }
  const sorted = (values: number[]): number[] => values.sort((a, b) => a - b);
  const quantile = (values: readonly number[], q: number): number => values[Math.min(values.length - 1, Math.floor(q * values.length))] ?? 0;
  const inOrder = driven.map((time) => Math.round((busy.get(time) ?? 0) * 10) / 10);
  const works = sorted(driven.map((time) => work.get(time) ?? 0));
  const busies = sorted(driven.map((time) => busy.get(time) ?? 0));
  const intervals = sorted(driven.slice(1).map((time, index) => time - (driven[index] ?? time)));
  return {
    frames: driven.length,
    workP50: quantile(works, 0.5),
    workP95: quantile(works, 0.95),
    busyP50: quantile(busies, 0.5),
    busyP95: quantile(busies, 0.95),
    busyWorst: busies[busies.length - 1] ?? 0,
    over16: busies.filter((value) => value > 16).length,
    intervalP50: quantile(intervals, 0.5),
    intervalP95: quantile(intervals, 0.95),
    busy: inOrder,
    fps: ((driven.length - 1) * 1000) / Math.max((driven[driven.length - 1] ?? 0) - (driven[0] ?? 0), 1e-6),
  };
};

/** First contentful paint and the app's `servo:interactive` mark, ms from navigation, once both are there. */
export const startTimes = (): { readonly firstPaint: number; readonly interactive: number } | undefined => {
  const interactive = performance.getEntriesByName('servo:interactive')[0]?.startTime;
  const firstPaint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
  if (interactive === undefined || firstPaint === undefined) return undefined;
  return { firstPaint, interactive };
};

/** The GPU the page draws WebGL with. */
export const gpuName = (): string => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
};

/**
 * Presses Run as a click does and resolves with the time until the shell is in Run mode, ms: at the first Run that takes
 * in loading sim-core and the physics engine's WebAssembly (D11).
 */
export const pressRun = async (): Promise<number> => {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Run');
  const shell = document.querySelector('.servo-shell');
  if (!button || !shell) throw new Error('The page has no Run button or no shell.');
  const start = performance.now();
  button.click();
  await new Promise<void>((resolve) => {
    const check = (): void => {
      if (shell.getAttribute('data-mode') === 'run') resolve();
      else setTimeout(check, 1);
    };
    check();
  });
  return performance.now() - start;
};

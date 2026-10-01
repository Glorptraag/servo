// The real app page (index.html, src/main.tsx) in a frame the size of a target screen. The frame is the page's
// viewport, so the layout sees the screen's real size and orientation, and a reload is a real reload: the page and
// all its modules start again and read the tuck states back from localStorage.
import { vi } from 'vitest';
import { cdp } from 'vitest/browser';

export interface Screen {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** The screens task 4.1 names, in CSS pixels: a 10-inch tablet in landscape, a 13-inch screen, a tablet in portrait. */
export const SCREENS: readonly Screen[] = [
  { name: '10-inch landscape', width: 1180, height: 820 },
  { name: '13-inch', width: 1366, height: 1024 },
  { name: 'tablet portrait', width: 820, height: 1180 },
];

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export const boxOf = (element: Element): Box => {
  const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
  return { left, top, right, bottom, width, height };
};

export const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

export type Rgb = readonly [number, number, number];

/** The largest difference in any channel. */
export const colourDistance = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** A real screenshot of the page in the frame, as the compositor shows it. */
export interface Shot {
  /** The colour at a point in the page's CSS pixels. */
  at(point: { readonly x: number; readonly y: number }): Rgb;
}

export interface AppFrame {
  readonly screen: Screen;
  readonly element: HTMLIFrameElement;
  /** The page's document now; a reload replaces it. */
  readonly doc: Document;
  /** A region by its `data-region`: header, tray, stage, canvas (the seen canvas), specCard, arenaStrip, runBar. */
  region(name: string): HTMLElement;
  /** The tab that tucks an edge away and brings it back. */
  tab(edge: string): HTMLButtonElement;
  /** The canvas element the canvas package draws in. */
  canvasElement(): HTMLCanvasElement;
  /** Clicks a control, as a tap does, and waits for every panel to finish moving. */
  press(element: HTMLElement): Promise<void>;
  /** Waits until nothing in the page is animating. */
  settle(): Promise<void>;
  /** Takes a screenshot of the frame, which also makes the browser draw a frame. */
  shoot(): Promise<Shot>;
  /**
   * Holds back the page's animation-frame callbacks until the returned function releases them, so whatever the page
   * draws meanwhile it draws at once: the canvas, for one, then draws only as it resizes.
   */
  holdAnimationFrames(): () => void;
  reload(): Promise<void>;
  close(): void;
}

const frames: HTMLIFrameElement[] = [];

const appReady = async (frame: HTMLIFrameElement): Promise<void> => {
  await vi.waitFor(
    () => {
      const doc = frame.contentDocument;
      if (!doc?.querySelector('[data-region="stage"] canvas') || !doc.querySelector('[data-region="header"]')) {
        throw new Error('the app has not mounted yet');
      }
    },
    { timeout: 30_000, interval: 50 },
  );
};

const settleFrame = async (frame: HTMLIFrameElement): Promise<void> => {
  await vi.waitFor(
    async () => {
      const doc = frame.contentDocument;
      if (!doc) throw new Error('no document');
      // getAnimations() brings styles up to date first, so a transition a click has just started is already listed.
      const running = doc.getAnimations().filter((animation) => animation.playState === 'running');
      if (running.length > 0) {
        await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
        throw new Error('still moving');
      }
    },
    { timeout: 10_000, interval: 20 },
  );
};

/**
 * Opens the app page at the screen's size and waits for the canvas. The frame is scaled to fit the test page, which
 * leaves the page inside it exactly the screen's size: every measurement is taken inside the frame.
 */
export const openApp = async (screen: Screen): Promise<AppFrame> => {
  const frame = document.createElement('iframe');
  frame.title = `Servo at ${screen.name}`;
  const scale = Math.min(1, innerWidth / screen.width, innerHeight / screen.height);
  frame.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    `width: ${screen.width}px`,
    `height: ${screen.height}px`,
    'border: 0',
    'margin: 0',
    'transform-origin: 0 0',
    `transform: scale(${scale})`,
  ].join('; ');
  frame.src = '/index.html';
  document.body.appendChild(frame);
  frames.push(frame);
  await appReady(frame);
  await settleFrame(frame);
  const doc = (): Document => {
    const current = frame.contentDocument;
    if (!current) throw new Error('the frame has no document');
    return current;
  };
  const one = <T extends Element>(selector: string): T => {
    const found = doc().querySelector<T>(selector);
    if (!found) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  return {
    screen,
    element: frame,
    get doc() {
      return doc();
    },
    region: (name) => one<HTMLElement>(`[data-region="${name}"]`),
    tab: (edge) => one<HTMLButtonElement>(`button.shell-tab[data-edge="${edge}"]`),
    canvasElement: () => one<HTMLCanvasElement>('[data-region="stage"] canvas'),
    press: async (element) => {
      element.click();
      // React commits a click's update in a microtask; let it land before looking for the transitions it starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await settleFrame(frame);
    },
    settle: () => settleFrame(frame),
    holdAnimationFrames: () => {
      const view = frame.contentWindow;
      if (!view) throw new Error('the frame has no window');
      const original = { request: view.requestAnimationFrame, cancel: view.cancelAnimationFrame };
      const held = new Map<number, FrameRequestCallback>();
      let next = 1;
      view.requestAnimationFrame = (callback) => {
        held.set(next, callback);
        return next++;
      };
      view.cancelAnimationFrame = (handle) => void held.delete(handle);
      return () => {
        view.requestAnimationFrame = original.request;
        view.cancelAnimationFrame = original.cancel;
        for (const callback of held.values()) view.requestAnimationFrame(callback);
      };
    },
    shoot: async () => {
      // Straight from the compositor through CDP, which draws a fresh frame for it. CDP measures from the top of the
      // browser's own page, where the test page is itself a frame.
      const outer = window.frameElement?.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      const clip = { x: (outer?.left ?? 0) + box.left, y: (outer?.top ?? 0) + box.top, width: box.width, height: box.height, scale: 1 };
      const png = (await cdp().send('Page.captureScreenshot', { format: 'png', clip })) as { readonly data: string };
      const blob = await (await fetch(`data:image/png;base64,${png.data}`)).blob();
      const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2D context');
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      // Screenshot pixels per CSS pixel of the page inside the frame: the frame's scale and the device's ratio together.
      const ratio = bitmap.width / screen.width;
      return {
        at: ({ x, y }) => {
          const px = Math.min(bitmap.width - 1, Math.max(0, Math.floor(x * ratio)));
          const py = Math.min(bitmap.height - 1, Math.max(0, Math.floor(y * ratio)));
          const index = (py * bitmap.width + px) * 4;
          return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
        },
      };
    },
    reload: async () => {
      const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
      frame.contentWindow?.location.reload();
      await loaded;
      await appReady(frame);
      await settleFrame(frame);
    },
    close: () => frame.remove(),
  };
};

export const closeAll = (): void => {
  for (const frame of frames.splice(0)) frame.remove();
};

// Shared by the browser tests: mounting a canvas in the iPad profile (vitest.config.ts), waiting for it to settle,
// and reading pixels from a real screenshot of it. Task 3.8 generalises this into the e2e harness.
import { onTestFinished, vi } from 'vitest';
import { cdp, page } from 'vitest/browser';
import type { AssetKey, Vec2 } from '@servo/schema';
import type { ArtSource, CanvasEventMap, CanvasOptions, CanvasPrefs } from '../../src/interface.ts';
import { mountCanvas } from '../../src/index.ts';
import { CanvasSurface } from '../../src/renderer/surface.ts';
import { catalogue } from '../helpers/catalogue.ts';

/** The iPad profile of vitest.config.ts: a 1180 × 820 CSS-pixel viewport at device scale factor 2. */
export const IPAD = { width: 1180, height: 820, deviceScaleFactor: 2 } as const;

export const PREFS: CanvasPrefs = { dragSensitivity: 1, leftHanded: false, highContrast: false, typeface: 'standard' };

const hosts: HTMLElement[] = [];
const surfaces: CanvasSurface[] = [];

export interface Mounted {
  readonly host: HTMLElement;
  readonly surface: CanvasSurface;
  /** Destroys this canvas and takes its host out of the page, so it no longer covers others. */
  unmount(): void;
}

export const mount = async (
  options: Partial<CanvasOptions> = {},
  size: { readonly width: number; readonly height: number } = IPAD,
): Promise<Mounted> => {
  const host = document.createElement('div');
  host.style.cssText = `position: fixed; left: 0; top: 0; width: ${size.width}px; height: ${size.height}px; margin: 0; padding: 0;`;
  document.body.appendChild(host);
  hosts.push(host);
  const handle = mountCanvas(host, {
    catalogue,
    resolveArt: () => undefined,
    level: 2,
    prefs: PREFS,
    ...options,
  });
  if (!(handle instanceof CanvasSurface)) throw new Error('mountCanvas did not return the renderer surface');
  surfaces.push(handle);
  await handle.ready;
  return {
    host,
    surface: handle,
    unmount: () => {
      handle.destroy();
      host.remove();
    },
  };
};

/** Destroys every canvas and host the tests made. */
export const unmountAll = (): void => {
  for (const surface of surfaces.splice(0)) surface.destroy();
  for (const host of hosts.splice(0)) host.remove();
};

/**
 * Puts a canvas that tests share back to its first state: Build mode, default prefs and level, nothing emphasised,
 * the canvas origin in the middle at zoom 1. Sharing one canvas per file saves a GPU context per test, which a
 * software GPU takes seconds to tear down.
 */
export const reset = (surface: CanvasSurface): void => {
  if (surface.mode === 'run') surface.setMode('build');
  surface.setPrefs(PREFS);
  surface.setLevel(2);
  surface.setEmphasis(null);
  Object.assign(surface.camera, { centreX: 0, centreY: 0, zoom: 1 });
  surface.requestFrame();
};

/** Listens for the rest of the test only. */
export const listen = <K extends keyof CanvasEventMap>(surface: CanvasSurface, type: K): CanvasEventMap[K][] => {
  const seen: CanvasEventMap[K][] = [];
  onTestFinished(surface.on(type, (event) => seen.push(event)));
  return seen;
};

export const frames = (count: number): Promise<void> =>
  new Promise((resolve) => {
    let left = count;
    const tick = (): void => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** Waits until every picture has loaded, every fade has finished and the grid is at rest, then for two frames more. */
export const settle = async (surface: CanvasSurface): Promise<void> => {
  await vi.waitFor(
    () => {
      if (!surface.settled || surface.gridOpacity > 0) throw new Error('the canvas is still moving');
    },
    { timeout: 10_000, interval: 25 },
  );
  await frames(2);
};

/** A solid picture as an SVG data URL, optionally with a second colour on its lower half. */
export const svgArt = (fill: string, lower?: string): string => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100">',
    `<rect width="160" height="100" fill="${fill}"/>`,
    lower ? `<rect y="50" width="160" height="50" fill="${lower}"/>` : '',
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** A resolveArt giving each art key in `table` its picture, and nothing for the rest. */
export const artFrom =
  (table: Readonly<Record<AssetKey, string>>) =>
  (key: AssetKey): ArtSource | undefined => {
    const src = table[key];
    return src ? { src, isPlaceholder: true } : undefined;
  };

export type Rgb = readonly [number, number, number];

export const rgbOf = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

export interface Shot {
  readonly width: number;
  readonly height: number;
  /** The colour at a point given in CSS pixels from the element's top left. */
  at(point: Vec2): Rgb;
}

/** A real screenshot of `element`, as the compositor shows it, decoded for reading pixels. */
export const shoot = async (element: Element): Promise<Shot> => {
  const base64 = await page.screenshot({ element, save: false });
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D context');
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const box = element.getBoundingClientRect();
  const ratio = bitmap.width / box.width;
  return {
    width: bitmap.width,
    height: bitmap.height,
    at: ({ x, y }) => {
      const px = Math.min(bitmap.width - 1, Math.max(0, Math.floor(x * ratio)));
      const py = Math.min(bitmap.height - 1, Math.max(0, Math.floor(y * ratio)));
      const i = (py * bitmap.width + px) * 4;
      return [data[i] as number, data[i + 1] as number, data[i + 2] as number];
    },
  };
};

// Real input through the Chrome DevTools Protocol: trusted mouse and touch events, as a hand or a mouse sends them.

/** Where the test page sits in the browser's own viewport, which CDP coordinates are measured in. */
const pageOffset = (): Vec2 => {
  const frame = window.frameElement?.getBoundingClientRect();
  return { x: frame?.left ?? 0, y: frame?.top ?? 0 };
};

/** A point given in CSS pixels from `element`'s top left, in CDP coordinates. */
const viewportPoint = (element: Element, at: Vec2): Vec2 => {
  const box = element.getBoundingClientRect();
  const offset = pageOffset();
  return { x: offset.x + box.left + at.x, y: offset.y + box.top + at.y };
};

export const mouse = async (element: Element, type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', at: Vec2): Promise<void> => {
  const point = viewportPoint(element, at);
  await cdp().send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
};

/** A mouse drag from `from` to `to` in `steps` moves. */
export const mouseDrag = async (element: Element, from: Vec2, to: Vec2, steps = 8): Promise<void> => {
  await mouse(element, 'mousePressed', from);
  for (let i = 1; i <= steps; i++) {
    await mouse(element, 'mouseMoved', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  await mouse(element, 'mouseReleased', to);
};

/** Touch points down, moved or lifted together; ids keep each finger the same finger. */
export const touch = async (element: Element, type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly Vec2[]): Promise<void> => {
  await cdp().send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : points.map((point, id) => ({ ...viewportPoint(element, point), id })),
  });
};

/** A synthetic pointer event at a point in CSS pixels from the element's top left. */
export const pointer = (
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  at: Vec2,
  options: { readonly id?: number; readonly kind?: 'mouse' | 'touch' | 'pen'; readonly primary?: boolean } = {},
): void => {
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new PointerEvent(type, {
      pointerId: options.id ?? 1,
      pointerType: options.kind ?? 'mouse',
      isPrimary: options.primary ?? true,
      clientX: box.left + at.x,
      clientY: box.top + at.y,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true,
      cancelable: true,
    }),
  );
};

/** The largest difference in any channel. */
export const colourDistance = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

export const describeRgb = (rgb: Rgb): string => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

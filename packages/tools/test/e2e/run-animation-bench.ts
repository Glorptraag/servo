// The bench for Run mode's e2e proof (task 3.5): the real canvas with the content catalogue and the pictures
// `pnpm art` generated, a content fixture run through sim-core's createSimulation with its own seed and inputs, and
// its frames fed to the canvas as the app's run loop would. Runs in the browser (Vitest browser mode).
/// <reference lib="dom" />
/// <reference types="@vitest/browser-playwright" />
import { page } from 'vitest/browser';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, CanvasPrefs, ResolveArt } from '@servo/canvas';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import type { ContentFixture } from '@servo/content/fixtures';
import type { PlacedPartId, PortType, RunSound, Vec2, WireId } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame, Simulation } from '@servo/sim-core';

export const PREFS: CanvasPrefs = { dragSensitivity: 1, leftHanded: false, highContrast: false, typeface: 'standard' };

/** Where a part's Run-mode drawing shows (canvas mm), as the canvas reports it. */
export interface Tells {
  readonly treads?: readonly Vec2[];
  readonly arm?: Vec2;
  readonly glow?: readonly Vec2[];
  readonly charge?: { readonly full: Vec2; readonly empty?: Vec2 };
  readonly sounds?: Readonly<Partial<Record<RunSound, readonly Vec2[]>>>;
}

/**
 * What the proof reads from the canvas beyond its interface: the renderer's hooks (packages/canvas/docs/renderer.md)
 * and Run mode's (docs/run-animation.md). Read at run time, never imported, so tools stays inside the package map.
 */
export interface Hooks {
  readonly ready: Promise<void>;
  readonly settled: boolean;
  readonly canvas: HTMLCanvasElement;
  readonly camera: { centreX: number; centreY: number; zoom: number; worldToScreen(point: Vec2): Vec2 };
  readonly scene: {
    readonly wires: readonly { readonly id: WireId; readonly type: PortType; readonly from: { readonly at: Vec2 }; readonly to: { readonly at: Vec2 } }[];
    readonly partById: ReadonlyMap<PlacedPartId, { readonly placed: { readonly position: Vec2; readonly rotation: number } }>;
  };
  readonly run: {
    readonly moving: boolean;
    readonly state:
      | {
          readonly tick: number;
          readonly treads: ReadonlyMap<PlacedPartId, number>;
          readonly bodies: ReadonlyMap<PlacedPartId, { readonly x: number; readonly y: number; readonly rotation: number }>;
          readonly charges: ReadonlyMap<PlacedPartId, number>;
        }
      | undefined;
    partPoint(id: PlacedPartId, point: Vec2): Vec2;
    endsOf(id: WireId): readonly [Vec2, Vec2] | undefined;
    tellsOf(id: PlacedPartId): Tells | undefined;
    readonly dots: { dotsOn(id: WireId): readonly Vec2[]; fillOf(type: PortType): number | undefined; colourOf(type: PortType): number | undefined };
    readonly marks: { scratches(id: PlacedPartId): readonly (readonly Vec2[])[] };
  };
  requestFrame(): void;
}

let checked: Content | undefined;

/** The content, checked, with a picture for every part: run `pnpm art` first, or every part draws as the same tile. */
export const benchContent = (): Content => {
  if (checked) return checked;
  const { content, issues } = loadContent();
  if (issues.length > 0) throw new Error(`Content has issues: ${issues.map((issue) => `${issue.file} ${issue.code}`).join('; ')}.`);
  const missing = content.parts.filter((part) => !content.art.has(part.identity.art)).map((part) => part.identity.art);
  if (missing.length > 0) throw new Error(`No picture for ${missing.join(', ')} in the art registry. Run pnpm art first.`);
  checked = content;
  return content;
};

const registryArt: ResolveArt = (key) => benchContent().art.get(key);

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

export interface Bench {
  readonly handle: CanvasHandle;
  readonly hooks: Hooks;
  readonly host: HTMLElement;
  destroy(): void;
}

/** The canvas filling the iPad viewport, with the content catalogue and its pictures. */
export const mountBench = async (size: { readonly width: number; readonly height: number }, readOnly = false): Promise<Bench> => {
  const content = benchContent();
  const host = document.createElement('div');
  host.style.cssText = `position: fixed; left: 0; top: 0; width: ${size.width}px; height: ${size.height}px; margin: 0; padding: 0;`;
  document.body.append(host);
  const handle = mountCanvas(host, { catalogue: content.catalogue, resolveArt: registryArt, level: 2, prefs: PREFS, readOnly });
  const hooks = handle as unknown as Hooks;
  for (const key of ['ready', 'settled', 'canvas', 'camera', 'scene', 'run', 'requestFrame'] as const) {
    if (!(key in handle)) throw new Error(`The canvas handle has no '${key}' hook (packages/canvas/docs/run-animation.md).`);
  }
  await hooks.ready;
  await frames(2);
  return {
    handle,
    hooks,
    host,
    destroy: () => {
      handle.destroy();
      host.remove();
    },
  };
};

/** Waits until nothing is loading, fading, tweening or waiting to be drawn. */
export const settle = async (bench: Bench, timeoutMs = 60_000): Promise<void> => {
  const start = performance.now();
  await frames(2);
  while (!bench.hooks.settled) {
    if (performance.now() - start > timeoutMs) throw new Error('The canvas did not settle.');
    await frames(1);
  }
};

/** A fixture's Simulation, from its own blueprint, arena and seed. */
export const simulationOf = async (fixture: ContentFixture): Promise<Simulation> => {
  const { catalogue } = benchContent();
  const arena = catalogue.arenas?.get(fixture.blueprint.arena.preset);
  if (!arena) throw new Error(`No arena preset '${fixture.blueprint.arena.preset}'.`);
  return createSimulation({ blueprint: fixture.blueprint, catalogue, arena, seed: fixture.seed });
};

/** Steps on to `tick`, making the fixture's inputs at their ticks, and gives every frame from the simulation's tick on. */
export const playTo = (simulation: Simulation, fixture: ContentFixture, tick: number): RunFrame[] => {
  const out: RunFrame[] = [];
  while (simulation.tick < tick) {
    for (const input of fixture.inputs) if (input.tick === simulation.tick) simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
    out.push(simulation.step());
  }
  return out;
};

/** Frames the camera on a set of canvas points at a zoom no greater than `maxZoom`, leaving `margin` px around them. */
export const frameOn = (bench: Bench, points: readonly Vec2[], size: { width: number; height: number }, maxZoom = 1.3, margin = 80): void => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pxPerMm = 2.5;
  const zoom = Math.min(maxZoom, (size.width - 2 * margin) / ((maxX - minX) * pxPerMm), (size.height - 2 * margin) / ((maxY - minY) * pxPerMm));
  Object.assign(bench.hooks.camera, { centreX: (minX + maxX) / 2, centreY: (minY + maxY) / 2, zoom });
  bench.hooks.requestFrame();
};

// ---------------------------------------------------------------------------------------------------------
// Screenshots

export type Rgb = readonly [number, number, number];

export const rgbOf = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

export const colourDistance = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

export const describeRgb = (rgb: Rgb): string => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

export interface Shot {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** The colour at a point given in CSS pixels from the element's top left. */
  at(point: Vec2): Rgb;
  /** The colours in a square `radius` CSS pixels either side of `point`. */
  around(point: Vec2, radius: number): Rgb[];
}

/** A real screenshot of `element`, decoded for pixel probes. */
export const shoot = async (element: Element): Promise<Shot> => {
  const base64 = await page.screenshot({ element, save: false });
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D context to decode the screenshot in.');
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const box = element.getBoundingClientRect();
  const ratio = bitmap.width / box.width;
  const pixel = (px: number, py: number): Rgb => {
    const x = Math.min(bitmap.width - 1, Math.max(0, px));
    const y = Math.min(bitmap.height - 1, Math.max(0, py));
    const i = (y * bitmap.width + x) * 4;
    return [data[i] as number, data[i + 1] as number, data[i + 2] as number];
  };
  return {
    width: bitmap.width,
    height: bitmap.height,
    data,
    at: ({ x, y }) => pixel(Math.floor(x * ratio), Math.floor(y * ratio)),
    around: ({ x, y }, radius) => {
      const out: Rgb[] = [];
      const cx = Math.floor(x * ratio);
      const cy = Math.floor(y * ratio);
      const r = Math.max(0, Math.round(radius * ratio));
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push(pixel(cx + dx, cy + dy));
      return out;
    },
  };
};

/** The share of pixels, sampled every `step` device pixels, whose colours differ by more than `tolerance` in a channel. */
export const differingShare = (a: Shot, b: Shot, step = 3, tolerance = 24): number => {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let differing = 0;
  let total = 0;
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      const i = (y * a.width + x) * 4;
      total += 1;
      const d = Math.max(
        Math.abs((a.data[i] as number) - (b.data[i] as number)),
        Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)),
        Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number)),
      );
      if (d > tolerance) differing += 1;
    }
  }
  return differing / total;
};

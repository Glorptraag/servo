// The bench: the real canvas, mounted in the page as the app lays it out (brief Section 9) with a part tray at its
// left, drawing the real content records with the pictures `pnpm art` generated. Generalised from tasks 3.1's and
// 3.2's browser helpers. Runs in the browser (Vitest browser mode). See README.md.
import { vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, CanvasPrefs, PropTemplate, ResolveArt } from '@servo/canvas';
import { probeCanvas } from '@servo/canvas/testing';
import type { CanvasProbe } from '@servo/canvas/testing';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import type { Level, PartTypeId, Vec2 } from '@servo/schema';
import { IPAD } from './profile.ts';

export const PREFS: CanvasPrefs = { dragSensitivity: 1, leftHanded: false, highContrast: false, typeface: 'standard' };

/** The tray's width at the canvas's left edge, in CSS pixels. */
export const TRAY_WIDTH = 200;

let checked: Content | undefined;

/**
 * The package's content, checked: no record with an issue, and a picture in the art registry for every part. Throws
 * otherwise, since a missing picture draws a neutral tile and every screenshot would change: run `pnpm art` first.
 */
export const benchContent = (): Content => {
  if (checked) return checked;
  const { content, issues } = loadContent();
  if (issues.length > 0) throw new Error(`Content has issues: ${issues.map((issue) => `${issue.file} ${issue.code}`).join('; ')}.`);
  const missing = content.parts.filter((part) => !content.art.has(part.identity.art)).map((part) => part.identity.art);
  if (missing.length > 0) throw new Error(`No picture for ${missing.join(', ')} in the art registry. Run pnpm art first.`);
  checked = content;
  return content;
};

/** The swap registry, as the app injects it (packages/content README, "The art registry"). */
export const registryArt: ResolveArt = (key) => benchContent().art.get(key);

/**
 * What the harness reads from the canvas beyond its interface (packages/canvas/src/interface.ts): members of the
 * renderer's surface as built (task 3.1's `CanvasSurface`). renderer.md lists `scene` and `requestFrame` among its
 * hooks for later canvas tasks; the rest are the surface's own. The handle has no way yet to say where a canvas point
 * or a socket is on screen, or when a frame is final, and a hand needs all three: review R-3.8 (finding 5) asks for a
 * tools-only testing entry on the canvas, which a later canvas task gives. Until then they are read at run time
 * through one cast, never imported, so the harness stays inside the package map; `hooksOf` names any that go missing,
 * and the view is moved by writing the camera's centre and zoom (`setView`).
 */
export interface RendererHooks {
  /** Resolves once the GPU renderer is up. */
  readonly ready: Promise<void>;
  /** Nothing is loading, fading or waiting to be drawn. */
  readonly settled: boolean;
  readonly gridOpacity: number;
  readonly canvas: HTMLCanvasElement;
  readonly camera: {
    centreX: number;
    centreY: number;
    zoom: number;
    readonly width: number;
    readonly height: number;
    worldToScreen(point: Vec2): Vec2;
    screenToWorld(point: Vec2): Vec2;
  };
  readonly scene: {
    /** Every socket by `<part>.<port>`, with where it sits on the canvas (mm). */
    readonly portByKey: ReadonlyMap<string, SceneSocket>;
    /** In draw order: a later part's tile covers an earlier one's. */
    readonly parts: readonly SceneTile[];
    /** Power and signal lines, drawn above every part and under every socket. */
    readonly wires: readonly SceneLine[];
    /** Mechanical linkages, drawn under every part but a frame. */
    readonly linkages: readonly SceneLine[];
  };
  requestFrame(): void;
  /**
   * Wiring's state, when the canvas has it (task 3.3): where the sockets of a crowd that fanned out went, by port key
   * (mm). A press that cannot tell overlapping sockets apart fans them out, and the hand goes on to the one it meant.
   * Optional: read only when present.
   */
  readonly wiring?: { readonly fanned?: ReadonlyMap<string, Vec2> };
}

/** A socket as the scene places it. `ports` sockets draw above every part and wire; a frame's mount points under its parts. */
export interface SceneSocket {
  readonly key: string;
  readonly at: Vec2;
  readonly layer: string;
}

/** A part's tile as the scene lays it out: its size and its corners on the canvas (mm), clockwise from the back left. */
export interface SceneTile {
  readonly id: string;
  readonly tile: { readonly w: number; readonly h: number };
  readonly corners: readonly Vec2[];
  readonly record: { readonly id: string };
  readonly ports: readonly SceneSocket[];
}

/** A line between two sockets: power or signal, or a mechanical linkage. */
export interface SceneLine {
  readonly id: string;
  readonly type: string;
  readonly from: SceneSocket;
  readonly to: SceneSocket;
}

const HOOKS: readonly (keyof RendererHooks)[] = ['ready', 'settled', 'gridOpacity', 'canvas', 'camera', 'scene', 'requestFrame'];

export const hooksOf = (handle: CanvasHandle): RendererHooks => {
  const missing = HOOKS.filter((key) => !(key in handle));
  if (missing.length > 0) {
    throw new Error(`The canvas handle has no ${missing.join(', ')}: the harness reads these renderer hooks (packages/canvas/docs/renderer.md).`);
  }
  return handle as unknown as RendererHooks;
};

export interface BenchOptions {
  /** The canvas's size in CSS pixels. Default: the iPad viewport less the tray. */
  readonly size?: { readonly width: number; readonly height: number };
  /** The tray's width; 0 for no tray. Default TRAY_WIDTH. */
  readonly trayWidth?: number;
  readonly level?: Level;
  readonly prefs?: CanvasPrefs;
  /** Default: the art registry. */
  readonly resolveArt?: ResolveArt;
  readonly readOnly?: boolean;
}

export interface Bench {
  readonly handle: CanvasHandle;
  readonly hooks: RendererHooks;
  /** The canvas's tools-only testing entry (`@servo/canvas/testing`): handles, wires' routes, Run-mode places. */
  readonly probe: CanvasProbe;
  readonly host: HTMLElement;
  /**
   * The app's part tray, and its arena strip: pressing it with a part offered hands that pointer to `beginPlacement`
   * (a drag from the tray), with a prop offered to `beginPropPlacement`. It is the canvas's remove target, as the
   * app's tray and strip are: a part, wire or prop let go over it is removed.
   */
  readonly tray: HTMLElement;
  /** What the tray holds for the next press; undefined holds nothing. */
  offer(item: PartTypeId | PropTemplate | undefined): void;
  /** Errors the tray met handing a pointer over, oldest first; reading empties the list. */
  trayErrors(): unknown[];
  destroy(): void;
}

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

/** Mounts the canvas with the content catalogue, beside a tray, and waits for its renderer. */
export const mountBench = async (options: BenchOptions = {}): Promise<Bench> => {
  const trayWidth = options.trayWidth ?? TRAY_WIDTH;
  const size = options.size ?? { width: IPAD.width - trayWidth, height: IPAD.height };
  const content = benchContent();
  const tray = document.createElement('div');
  // Not selectable, as in the app's shell: a mouse drag from a selectable tray selects the list view's text, and the
  // next press inside that selection drags it, so the browser cancels the pointer the canvas was carrying.
  tray.style.cssText = `position: fixed; left: 0; top: 0; width: ${trayWidth}px; height: ${size.height}px; touch-action: none; user-select: none; background: #d8d4cc;`;
  const host = document.createElement('div');
  host.style.cssText = `position: fixed; left: ${trayWidth}px; top: 0; width: ${size.width}px; height: ${size.height}px; margin: 0; padding: 0;`;
  document.body.append(tray, host);
  const handle = mountCanvas(host, {
    catalogue: content.catalogue,
    resolveArt: options.resolveArt ?? registryArt,
    level: options.level ?? 2,
    prefs: options.prefs ?? PREFS,
    ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
  });
  const hooks = hooksOf(handle);
  if (trayWidth > 0) handle.setRemoveTargets([tray]);
  let offered: PartTypeId | PropTemplate | undefined;
  let errors: unknown[] = [];
  tray.addEventListener('pointerdown', (event) => {
    if (offered === undefined) return;
    try {
      if (typeof offered === 'string') handle.beginPlacement(offered, event);
      else handle.beginPropPlacement(offered, event);
    } catch (error) {
      errors.push(error);
    }
  });
  await hooks.ready;
  // A new host settles its size on the next frame: the camera must know the canvas's real size before any gesture.
  await frames(2);
  return {
    handle,
    hooks,
    probe: probeCanvas(handle),
    host,
    tray,
    offer: (item) => {
      offered = item;
    },
    trayErrors: () => {
      const seen = errors;
      errors = [];
      return seen;
    },
    destroy: () => {
      handle.destroy();
      host.remove();
      tray.remove();
    },
  };
};

/**
 * Waits until every picture has loaded, every fade has finished and the grid is at rest, then for two frames more.
 * The first build a bench shows rasterises every picture, which a software GPU on a loaded machine takes a while over.
 */
export const settle = async (bench: Bench): Promise<void> => {
  await vi.waitFor(
    () => {
      if (!bench.hooks.settled || bench.hooks.gridOpacity > 0) throw new Error('the canvas is still moving');
    },
    { timeout: 60_000, interval: 25 },
  );
  await frames(2);
};

/** Screen pixels per canvas millimetre at zoom 1, read from the view. */
const pixelsPerMm = (bench: Bench): number => {
  const { camera } = bench.hooks;
  return (camera.worldToScreen({ x: 1, y: 0 }).x - camera.worldToScreen({ x: 0, y: 0 }).x) / camera.zoom;
};

/**
 * Moves the view as a hand would pan and zoom between steps: `centre` (canvas mm) in the middle of the canvas at
 * `zoom`. The view is not part of the build, so it changes nothing a path builds.
 */
export const setView = (bench: Bench, centre: Vec2, zoom: number): void => {
  Object.assign(bench.hooks.camera, { centreX: centre.x, centreY: centre.y, zoom });
  bench.hooks.requestFrame();
};

/**
 * Frames `points` (canvas mm) in the middle of the canvas, at `maxZoom` (the default zoom unless given) or less, with
 * `margin` pixels to spare.
 */
export const showPoints = (bench: Bench, points: readonly Vec2[], margin = 64, maxZoom = 1): void => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const { width, height } = bench.hooks.camera;
  const perMm = pixelsPerMm(bench);
  const room = (span: number, pixels: number): number => (span <= 0 ? 1 : Math.max(pixels - 2 * margin, pixels / 2) / (span * perMm));
  setView(bench, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, Math.min(maxZoom, room(maxX - minX, width), room(maxY - minY, height)));
};

/** A canvas point (mm) in page coordinates (CSS pixels from the test page's top left), at the current view. */
export const pageOf = (bench: Bench, world: Vec2): Vec2 => {
  const screen = bench.hooks.camera.worldToScreen(world);
  const box = bench.hooks.canvas.getBoundingClientRect();
  return { x: box.left + screen.x, y: box.top + screen.y };
};

/** The middle of an element, in page coordinates. */
export const middleOf = (element: Element): Vec2 => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

/** Where a socket (`<part>.<port>`) sits on the canvas now, in mm. Throws when the scene has no such socket. */
export const socketAt = (bench: Bench, key: string): Vec2 => {
  const socket = bench.hooks.scene.portByKey.get(key);
  if (!socket) throw new Error(`The canvas shows no socket ${key}.`);
  return socket.at;
};

/** Where a socket takes a press now, in mm: where its crowd fanned it out (task 3.3), or where the scene draws it. */
export const pressPlaceOf = (bench: Bench, key: string): Vec2 => bench.hooks.wiring?.fanned?.get(key) ?? socketAt(bench, key);

/** Whether a socket sits in a crowd that is fanned out now (task 3.3). */
export const fannedOut = (bench: Bench, key: string): boolean => bench.hooks.wiring?.fanned?.has(key) === true;

/**
 * Emulates `prefers-reduced-motion: reduce` (true) or stops emulating it (false), so fades and slides are instant
 * and the canvas draws only when something changes: fewer frames for a software GPU to draw.
 */
export const reduceMotion = async (on: boolean): Promise<void> => {
  await cdp().send('Emulation.setEmulatedMedia', { features: on ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] });
};

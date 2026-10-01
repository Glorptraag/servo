// Shared by the placement browser tests: a canvas with a part tray beside it, as the app lays them out (brief Section
// 9), and real input through the Chrome DevTools Protocol in page coordinates: trusted mouse events, and trusted touch
// events, the touchscreen Playwright emulates. The tray plays the app's part (and the arena strip's, for props): a
// drag from its tile hands the pointer to `beginPlacement`, and a tap on it calls it with none (tap-then-tap). Task
// 3.8 generalises this into the harness.
import { cdp } from 'vitest/browser';
import type { PartTypeId, Vec2 } from '@servo/schema';
import type { CanvasOptions, PropTemplate } from '../../src/interface.ts';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { parts } from '../helpers/catalogue.ts';
import { artFrom, mount, svgArt } from './helpers.ts';
import type { Mounted } from './helpers.ts';

/** The tray's width: the canvas fills the rest of the iPad profile's 1180 × 820 viewport. */
export const TRAY_WIDTH = 200;

export type Hand = 'mouse' | 'touch';

export interface Workbench extends Mounted {
  readonly tray: HTMLElement;
  /** What the tray's tile holds (a part, or a prop as the arena strip offers one), and whether pressing it starts a drag or waits for the tap on the canvas. */
  tile(item: PartTypeId | PropTemplate, how: 'drag' | 'tap'): void;
  /** Every pointer type the page saw since the last `pointerTypes()` call. */
  pointerTypes(): readonly string[];
}

/** A flat picture for every part, in its own colours, as the placeholder art gives (ground rule 12). */
export const pictures = artFrom(Object.fromEntries(parts.map((part) => [part.identity.art, svgArt(part.identity.colours.main, part.identity.colours.accent)])));

export const mountWorkbench = async (
  size: { readonly width: number; readonly height: number } = { width: 1180 - TRAY_WIDTH, height: 820 },
  options: Partial<CanvasOptions> = { resolveArt: pictures },
): Promise<Workbench> => {
  const mounted = await mount(options, size);
  mounted.host.style.left = `${TRAY_WIDTH}px`;
  const tray = document.createElement('div');
  tray.style.cssText = `position: fixed; left: 0; top: 0; width: ${TRAY_WIDTH}px; height: 820px; touch-action: none; background: #ddd;`;
  document.body.appendChild(tray);
  let item: PartTypeId | PropTemplate = '';
  let how: 'drag' | 'tap' = 'drag';
  let pressed: number | undefined;
  const begin = (pointer?: PointerEvent): void => {
    if (typeof item === 'string') mounted.surface.beginPlacement(item, pointer);
    else mounted.surface.beginPropPlacement(item, pointer);
  };
  tray.addEventListener('pointerdown', (event) => {
    pressed = event.pointerId;
    if (how === 'drag') begin(event);
  });
  tray.addEventListener('pointerup', (event) => {
    if (how === 'tap' && pressed === event.pointerId) begin();
    pressed = undefined;
  });
  let seen: string[] = [];
  const record = (event: PointerEvent): void => {
    seen.push(event.pointerType);
  };
  window.addEventListener('pointerdown', record, true);
  window.addEventListener('pointerup', record, true);
  // Resized hosts settle on the next frame; the camera must know the canvas's real size before any test reads it.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return {
    ...mounted,
    tray,
    tile: (next, nextHow) => {
      item = next;
      how = nextHow;
    },
    pointerTypes: () => {
      const types = seen;
      seen = [];
      return types;
    },
    unmount: () => {
      window.removeEventListener('pointerdown', record, true);
      window.removeEventListener('pointerup', record, true);
      tray.remove();
      mounted.unmount();
    },
  };
};

/** Where the test page sits in the browser's own viewport, which CDP coordinates are measured in. */
const pageOffset = (): Vec2 => {
  const frame = window.frameElement?.getBoundingClientRect();
  return { x: frame?.left ?? 0, y: frame?.top ?? 0 };
};

/** A canvas point (mm) in page coordinates, at the current view. */
export const clientOf = (surface: CanvasSurface, world: Vec2): Vec2 => {
  const screen = surface.camera.worldToScreen(world);
  const box = surface.canvas.getBoundingClientRect();
  return { x: box.left + screen.x, y: box.top + screen.y };
};

/** The middle of an element, in page coordinates. */
export const middleOf = (element: Element): Vec2 => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

const send = async (hand: Hand, phase: 'down' | 'move' | 'up', at: Vec2): Promise<void> => {
  const offset = pageOffset();
  const point = { x: offset.x + at.x, y: offset.y + at.y };
  if (hand === 'mouse') {
    const type = phase === 'down' ? 'mousePressed' : phase === 'up' ? 'mouseReleased' : 'mouseMoved';
    await cdp().send('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      buttons: phase === 'up' ? 0 : 1,
      clickCount: phase === 'move' ? 0 : 1,
    });
    return;
  }
  const type = phase === 'down' ? 'touchStart' : phase === 'up' ? 'touchEnd' : 'touchMove';
  await cdp().send('Input.dispatchTouchEvent', { type, touchPoints: phase === 'up' ? [] : [{ ...point, id: 0 }] });
};

/** A tap (a touch) or a click (a mouse) at a page point. */
export const tap = async (hand: Hand, at: Vec2): Promise<void> => {
  await send(hand, 'down', at);
  await send(hand, 'up', at);
};

/** Down at `from`, through `steps` moves, up at `to`, in page coordinates. */
export const drag = async (hand: Hand, from: Vec2, to: Vec2, steps = 2): Promise<void> => {
  await send(hand, 'down', from);
  for (let i = 1; i <= steps; i++) {
    await send(hand, 'move', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  await send(hand, 'up', to);
};

/** Down, then moves, without lifting: for checking what a drag shows on the way. */
export const press = async (hand: Hand, from: Vec2, through: readonly Vec2[]): Promise<void> => {
  await send(hand, 'down', from);
  for (const at of through) await send(hand, 'move', at);
};

export const lift = async (hand: Hand, at: Vec2): Promise<void> => {
  await send(hand, 'up', at);
};

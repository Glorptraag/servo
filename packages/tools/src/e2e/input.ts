// Real input through the Chrome DevTools Protocol: trusted touch events, as Playwright's touchscreen emulation sends
// them, and trusted mouse events, as a mouse or trackpad sends them (brief Section 10: touch first, pointer equal).
// Points are page coordinates, CSS pixels from the test page's top left; fractions are kept. A CDP call can return
// before the page has handled its event, touch especially on a loaded machine, so each gesture resolves only once the
// page has seen the pointer (or wheel) events it causes. Runs in the browser.
import { vi } from 'vitest';
import { cdp } from 'vitest/browser';
import type { Vec2 } from '@servo/schema';

export type Hand = 'touch' | 'mouse';

/** How long a gesture waits for the page to handle its events: a software GPU on a loaded two-core machine is slow. */
const HANDLED_MS = 30_000;

interface Seen {
  /** Counts every event seen, so a wait never loses its place when old events are dropped. */
  readonly n: number;
  readonly type: string;
  readonly x: number;
  readonly y: number;
}

/** The last few hundred pointer and wheel events the page has handled, oldest first. */
const seen: Seen[] = [];
let count = 0;
let tracking = false;

const track = (event: Event): void => {
  const { type, clientX: x, clientY: y } = event as MouseEvent;
  seen.push({ n: count, type, x, y });
  count += 1;
  if (seen.length > 512) seen.splice(0, seen.length - 256);
};

const startTracking = (): void => {
  if (tracking) return;
  tracking = true;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
    window.addEventListener(type, track, { capture: true, passive: true });
  }
};

/** Dispatches through CDP, then waits until the page has handled an event of each expected type at its point. */
const dispatch = async (send: () => Promise<unknown>, expected: readonly { readonly type: string; readonly at: Vec2 }[]): Promise<void> => {
  startTracking();
  const from = count;
  await send();
  await vi.waitFor(
    () => {
      const since = seen.filter((event) => event.n >= from);
      const missing = expected.filter(({ type, at }) => !since.some((event) => event.type === type && Math.abs(event.x - at.x) <= 1 && Math.abs(event.y - at.y) <= 1));
      if (missing.length > 0) throw new Error(`The page has not handled ${missing.map(({ type, at }) => `${type} at (${at.x}, ${at.y})`).join(', ')}.`);
    },
    { timeout: HANDLED_MS, interval: 5 },
  );
};

/** Where the test page sits in the browser's own viewport, which CDP coordinates are measured in. */
const viewportOf = (at: Vec2): Vec2 => {
  const frame = window.frameElement?.getBoundingClientRect();
  return { x: (frame?.left ?? 0) + at.x, y: (frame?.top ?? 0) + at.y };
};

/**
 * Fingers down, moved or lifted together; a finger keeps its place in the list from start to end. Lifting, `points`
 * are where the fingers were: CDP lifts every finger, and the page must see a pointerup at each.
 */
export const touches = async (type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly Vec2[]): Promise<void> => {
  const pointer = type === 'touchStart' ? 'pointerdown' : type === 'touchMove' ? 'pointermove' : 'pointerup';
  await dispatch(
    () =>
      cdp().send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : points.map((point, id) => ({ ...viewportOf(point), id })),
      }),
    points.map((at) => ({ type: pointer, at })),
  );
};

export const mouse = async (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', at: Vec2): Promise<void> => {
  const pointer = type === 'mousePressed' ? 'pointerdown' : type === 'mouseMoved' ? 'pointermove' : 'pointerup';
  await dispatch(
    () =>
      cdp().send('Input.dispatchMouseEvent', {
        type,
        ...viewportOf(at),
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      }),
    [{ type: pointer, at }],
  );
};

/** One finger or the mouse button: down, moved, or up at a page point (for a finger, where it last was). */
export const press = async (hand: Hand, at: Vec2): Promise<void> => (hand === 'touch' ? touches('touchStart', [at]) : mouse('mousePressed', at));
export const move = async (hand: Hand, at: Vec2): Promise<void> => (hand === 'touch' ? touches('touchMove', [at]) : mouse('mouseMoved', at));
export const lift = async (hand: Hand, at: Vec2): Promise<void> => (hand === 'touch' ? touches('touchEnd', [at]) : mouse('mouseReleased', at));

/**
 * Lets go of whatever a gesture that failed half way may have left down, without waiting for the page: a finger left
 * on the canvas would make the next touch or click the second finger of a pinch.
 */
export const releaseAll = async (): Promise<void> => {
  const ignore = (): void => undefined;
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(ignore);
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...viewportOf({ x: 0, y: 0 }), button: 'left', buttons: 0, clickCount: 1 }).catch(ignore);
};

/** Runs a gesture that presses, and lets everything go if it fails before lifting. */
export const holding = async (gesture: () => Promise<void>): Promise<void> => {
  try {
    await gesture();
  } catch (error) {
    await releaseAll();
    throw error;
  }
};

/** A tap (touch) or a click (mouse) at a page point. */
export const tap = (hand: Hand, at: Vec2): Promise<void> =>
  holding(async () => {
    await press(hand, at);
    await lift(hand, at);
  });

/**
 * Down at `from`, through `steps` even moves, up at `to`. One move to `to` passes the canvas's 8 px drag threshold
 * when the points are further apart, and every event costs a frame, so one is the default.
 */
export const drag = (hand: Hand, from: Vec2, to: Vec2, steps = 1): Promise<void> =>
  holding(async () => {
    await press(hand, from);
    for (let i = 1; i <= steps; i++) await move(hand, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    await lift(hand, to);
  });

/**
 * Two fingers about `centre`, side by side, spreading from `from` to `to` pixels apart (a zoom in when `to` is wider)
 * while their midpoint travels by `pan`.
 */
export const pinch = (centre: Vec2, from: number, to: number, pan: Vec2 = { x: 0, y: 0 }, steps = 5): Promise<void> =>
  holding(async () => {
    const fingers = (spread: number, at: Vec2): Vec2[] => [
      { x: at.x - spread / 2, y: at.y },
      { x: at.x + spread / 2, y: at.y },
    ];
    let last = fingers(from, centre);
    await touches('touchStart', last);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      last = fingers(from + (to - from) * k, { x: centre.x + pan.x * k, y: centre.y + pan.y * k });
      await touches('touchMove', last);
    }
    await touches('touchEnd', last);
  });

/** The mouse wheel over a page point; a negative `deltaY` scrolls up, which zooms the canvas in. */
export const wheel = async (at: Vec2, deltaY: number): Promise<void> => {
  await dispatch(() => cdp().send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...viewportOf(at), deltaX: 0, deltaY }), [{ type: 'wheel', at }]);
};

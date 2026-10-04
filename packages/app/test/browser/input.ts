// Real input for the three paths of ground rule 8, as a hand, a mouse and a keyboard send it. Touch and mouse go
// through the Chrome DevTools Protocol, so the browser makes trusted events from them: a touch's pointer events and
// its click, a mouse's pointer events and its click. A synthetic `element.click()` is none of the three (review
// R-6.4, APP-3), so nothing here uses it.
import { cdp, userEvent } from 'vitest/browser';

export type Path = 'touch' | 'pointer' | 'keyboard';

export const PATHS: readonly Path[] = ['touch', 'pointer', 'keyboard'];

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A point in `view`'s CSS pixels as a point on the browser's page, where CDP input lands: through every frame between,
 * the test page's own frame included, and any scale a frame is drawn at.
 */
export const pageOf = (view: Window, at: Point): Point => {
  let { x, y } = at;
  let current: Window = view;
  while (current.frameElement) {
    const frame = current.frameElement as HTMLElement;
    const box = frame.getBoundingClientRect();
    const scale = frame.clientWidth > 0 ? box.width / frame.clientWidth : 1;
    x = box.left + (frame.clientLeft + x) * scale;
    y = box.top + (frame.clientTop + y) * scale;
    current = current.parent;
  }
  return { x, y };
};

/**
 * A point on `element`, as a fraction of its box (the middle by default), on the browser's page. A panel that scrolls
 * (a Level 2 spec card does) is scrolled to it first, as a hand scrolls before it taps and as Playwright does.
 */
export const pointOn = (element: Element, fx = 0.5, fy = 0.5): Point => {
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error('the element is in no window');
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const box = element.getBoundingClientRect();
  return pageOf(view, { x: box.left + box.width * fx, y: box.top + box.height * fy });
};

/** A finger down and up at a point on the page. */
export const touchAt = async (at: Point): Promise<void> => {
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

/** A mouse moved to a point on the page, then its left button pressed and released there. */
export const clickAt = async (at: Point): Promise<void> => {
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await cdp().send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
};

/** A finger on `element`. */
export const touch = (element: Element, fx?: number, fy?: number): Promise<void> => touchAt(pointOn(element, fx, fy));

/** A mouse click on `element`. */
export const pointer = (element: Element, fx?: number, fy?: number): Promise<void> => clickAt(pointOn(element, fx, fy));

/**
 * Keys pressed with `element` focused, as a keyboard or a screen reader's activation sends them: Enter by default
 * (Space is Run and Stop, D42), in `userEvent.keyboard`'s notation.
 */
export const keyboard = async (element: HTMLElement, keys = '{Enter}'): Promise<void> => {
  element.focus();
  if (element.ownerDocument.activeElement !== element) throw new Error('the element took no focus');
  await userEvent.keyboard(keys);
};

/** `element` pressed by one path. */
export const pressBy = (path: Path, element: HTMLElement, keys?: string): Promise<void> =>
  path === 'touch' ? touch(element) : path === 'pointer' ? pointer(element) : keyboard(element, keys);

/** Lets React commit what an input scheduled. */
export const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

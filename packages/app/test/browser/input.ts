// Real input for the three paths of ground rule 8, as a hand, a mouse and a keyboard send it. Touch and mouse go
// through the Chrome DevTools Protocol, so the browser makes trusted events from them: a touch's pointer events and
// its click, a mouse's pointer events and its click. A synthetic `element.click()` is none of the three (review
// R-6.4, APP-3), so nothing here uses it. The keyboard path reaches its control by Tab, as a keyboard does (R-7.4 F2).
import { vi } from 'vitest';
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

/** An element, or a way to find it again: a control a panel draws again on each change is a new element each time. */
export type Target = HTMLElement | (() => HTMLElement);

const find = (target: Target): HTMLElement => (typeof target === 'function' ? target() : target);

const describe = (element: Element): string => element.outerHTML.slice(0, 120);

/** Whether Tab can land on `element` now: attached, shown, enabled, not inert, and the chosen radio of its group. */
export const tabbable = (element: Element): element is HTMLElement => {
  const html = element as HTMLElement;
  if (!element.isConnected || typeof html.focus !== 'function' || html.tabIndex < 0) return false;
  if (element.closest('[inert]') || (element as HTMLButtonElement).disabled) return false;
  if (!element.checkVisibility()) return false;
  if (element.matches('input[type="radio"]') && !(element as HTMLInputElement).checked) {
    const name = CSS.escape((element as HTMLInputElement).name);
    if (element.ownerDocument.querySelector(`input[type="radio"][name="${name}"]:checked`)) return false;
  }
  return true;
};

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]';

/** The screen `element` is on: its open dialog, or else its block under the page's body. */
export const screenOf = (element: Element): Element => {
  const dialog = element.closest('dialog[open]');
  if (dialog) return dialog;
  let block = element;
  while (block.parentElement && block.parentElement !== element.ownerDocument.body) block = block.parentElement;
  return block;
};

/** The first place Tab lands on a screen. */
export const startOf = (screen: ParentNode): HTMLElement => {
  const first = [...screen.querySelectorAll(TABBABLE)].find(tabbable);
  if (!first) throw new Error('nothing on the screen takes Tab');
  return first;
};

/**
 * Focus on `target`, for setting a page up rather than testing a path: waits until it is attached, shown and
 * focusable, finding it again each try (a panel that draws again replaces its buttons), focuses it, and checks
 * focus stayed.
 */
export const focusOn = (target: Target): Promise<HTMLElement> =>
  vi.waitFor(
    () => {
      const element = find(target);
      if (!tabbable(element)) throw new Error(`not focusable yet: ${describe(element)}`);
      element.focus();
      if (element.ownerDocument.activeElement !== element) throw new Error(`took no focus: ${describe(element)}`);
      return element;
    },
    { timeout: 30_000, interval: 20 },
  );

/** Keys pressed on `target` once it holds focus (focusOn), for setting a page up. */
export const keysOn = async (target: Target, keys = '{Enter}'): Promise<void> => {
  await focusOn(target);
  await userEvent.keyboard(keys);
};

/** The places Tab lands on, in order, from `start` until it leaves the screen or comes round again. */
export const tabOrder = async (start: HTMLElement, max = 400): Promise<HTMLElement[]> => {
  await focusOn(start);
  const doc = start.ownerDocument;
  const order: HTMLElement[] = [start];
  for (let step = 0; step < max; step += 1) {
    await userEvent.keyboard('{Tab}');
    const active = doc.activeElement;
    if (!active || active === doc.body || !active.matches(TABBABLE) || order.includes(active as HTMLElement)) break;
    order.push(active as HTMLElement);
  }
  return order;
};

/**
 * The keyboard path: Tab from the first control of `target`'s screen until focus is on it, then the keys, as a
 * keyboard or a screen reader's activation sends them. Enter by default (Space is Run and Stop, D42), in
 * `userEvent.keyboard`'s notation. Fails if Tab never reaches it.
 */
export const keyboard = async (target: Target, keys = '{Enter}', max = 400): Promise<void> => {
  const first = await vi.waitFor(
    () => {
      const element = find(target);
      if (!tabbable(element)) throw new Error(`Tab cannot land on ${describe(element)}`);
      return element;
    },
    { timeout: 30_000, interval: 20 },
  );
  const doc = first.ownerDocument;
  await focusOn(startOf(screenOf(first)));
  for (let step = 0; doc.activeElement !== find(target); step += 1) {
    if (step >= max) throw new Error(`Tab did not reach ${describe(find(target))} in ${max} presses`);
    await userEvent.keyboard('{Tab}');
  }
  await userEvent.keyboard(keys);
};

/** `element` pressed by one path. */
export const pressBy = (path: Path, element: HTMLElement, keys?: string): Promise<void> =>
  path === 'touch' ? touch(element) : path === 'pointer' ? pointer(element) : keyboard(element, keys);

/** Lets React commit what an input scheduled. */
export const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

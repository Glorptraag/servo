// The list view by touch and pointer (ground rule 8), in WebKit as well as Chromium. Safari on iPadOS and macOS does
// not focus a button it is pressing: focus leaves the open panel for the body as the press begins, and the panel used
// to hide before the press ended, so the action never happened. The panel must stay open through the press and the
// action must happen; a press elsewhere still hides it. Real input through Playwright (a tap needs the touchscreen
// context the `hands` projects give, vitest.config.ts), never CDP, so the file runs in every engine.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { fixture } from '../helpers/catalogue.ts';
import { listen, mount, unmountAll } from './helpers.ts';
import type { Mounted } from './helpers.ts';

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** A touchscreen tap on the element `selector` names. */
    tap(selector: string): Promise<void>;
    /** A touchscreen tap at a point in the page. */
    tapAt(x: number, y: number): Promise<void>;
    /** A mouse click at a point in the page. */
    clickAt(x: number, y: number): Promise<void>;
  }
}

type Hand = 'click' | 'tap';

let bench: Mounted;

beforeAll(async () => {
  bench = await mount({}, { width: 820, height: 600 });
}, 120_000);

afterAll(() => {
  unmountAll();
});

const list = (): HTMLElement => bench.surface.listDom.element;
const selectorOf = (key: string): string => `[data-key="${CSS.escape(key)}"]`;
const byKey = (key: string): HTMLButtonElement => {
  const found = list().querySelector<HTMLButtonElement>(selectorOf(key));
  if (!found) throw new Error(`no ${key} in the list view`);
  return found;
};
const isOpen = (): boolean => list().hasAttribute('data-open');

const press = async (hand: Hand, key: string): Promise<void> => {
  if (hand === 'click') await userEvent.click(byKey(key));
  else await commands.tap(selectorOf(key));
};

/** A press on the canvas's far corner, away from the panel: empty canvas, no part under it. */
const pressCanvas = async (hand: Hand): Promise<void> => {
  const box = bench.surface.canvas.getBoundingClientRect();
  const x = box.right - 20;
  const y = box.bottom - 20;
  if (hand === 'click') await commands.clickAt(x, y);
  else await commands.tapAt(x, y);
};

/** A fresh Rolling Start, every subject closed, the panel open as a keyboard user opens it: focus lands inside. */
const start = (): void => {
  const { surface } = bench;
  expect(surface.load(fixture('rolling-start')).ok).toBe(true);
  const toggle = byKey('toggle:part:switch');
  toggle.focus();
  if (toggle.getAttribute('aria-expanded') === 'true') toggle.click();
  expect(byKey('toggle:part:switch').getAttribute('aria-expanded')).toBe('false');
  expect(isOpen()).toBe(true);
};

describe.each<Hand>(['click', 'tap'])('the open list view, by %s', (hand) => {
  it('stays open while a subject opens and an action is done', async () => {
    start();
    const edits = listen(bench.surface, 'edit');

    await press(hand, 'toggle:part:switch');
    await vi.waitFor(() => expect(byKey('toggle:part:switch').getAttribute('aria-expanded')).toBe('true'));
    expect(isOpen()).toBe(true);

    await press(hand, 'action:turn:switch:clockwise');
    await vi.waitFor(() => expect(edits.map((edit) => edit.command)).toEqual([{ kind: 'rotate-part', partId: 'switch', rotation: 90 }]));
    expect(isOpen()).toBe(true);
    expect(list().querySelector('[role="status"]')?.textContent).toBe('Turned switch. Switch is loose now');
    // Focus is on the pressed button, where a keyboard would carry on from, in every engine.
    expect(document.activeElement?.getAttribute('data-key')).toBe('action:turn:switch:clockwise');
  });

  it('hides when the canvas is pressed', async () => {
    start();
    await pressCanvas(hand);
    await vi.waitFor(() => expect(isOpen()).toBe(false));
    expect(list().contains(document.activeElement)).toBe(false);
  });
});

describe('the open list view, by keyboard', () => {
  it('hides on Escape, and shows again when focus comes back', async () => {
    start();
    await userEvent.keyboard('{Escape}');
    expect(isOpen()).toBe(false);
    expect(list().contains(document.activeElement)).toBe(false);
    byKey('toggle:part:switch').focus();
    expect(isOpen()).toBe(true);
  });
});

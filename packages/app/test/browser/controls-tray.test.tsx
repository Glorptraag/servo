// The tray's controls, its places list and the Parts Library, each by touch, pointer and keyboard on the real App
// (ground rule 8, review R-6.4 APP-4). A tile places its part by each path: tap it then tap the canvas, click it then
// click the canvas, or Enter for the places list (the keyboard and screen-reader path, D84) and a choice in it.
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { SOON, listedParts, mountApp, unmountApps } from './app-harness.tsx';
import type { MountedApp } from './app-harness.tsx';
import { threePaths } from './controls.ts';
import { clickAt, keyboard, pageOf, pressBy, touchAt } from './input.ts';
import type { Point } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(unmountApps);

const PART = 'switch';

const tile = (app: MountedApp, part = PART): HTMLButtonElement => app.one<HTMLButtonElement>(`[data-region="tray"] button.tray-tile[data-part="${part}"]`);

/** A spot on the workbench clear of the panels and the build: below the arena strip, beside the tray. */
const freeSpot = (app: MountedApp): Point => {
  const tray = app.one('[data-region="tray"]').getBoundingClientRect();
  const strip = app.one('[data-region="arenaStrip"]').getBoundingClientRect();
  return pageOf(window, { x: tray.right + 60, y: strip.bottom + 60 });
};

interface Opened {
  readonly app: MountedApp;
  readonly parts: number;
}

const withPlaces = async (): Promise<Opened> => {
  const app = await mountApp();
  const parts = listedParts(app).length;
  await keyboard(tile(app));
  await vi.waitFor(() => app.one('dialog.tray-places button.tray-place'), SOON);
  return { app, parts };
};

threePaths('tray-tile', {
  open: async () => {
    const app = await mountApp();
    return { app, parts: listedParts(app).length };
  },
  control: ({ app }) => tile(app),
  press: async (path, control, { app }) => {
    if (path === 'keyboard') {
      await keyboard(control);
      await keyboard(await vi.waitFor(() => app.one('dialog.tray-places button.tray-place'), SOON));
      return;
    }
    await pressBy(path, control);
    await vi.waitFor(() => expect(tile(app).getAttribute('aria-pressed')).toBe('true'), SOON);
    await (path === 'touch' ? touchAt(freeSpot(app)) : clickAt(freeSpot(app)));
  },
  then: async ({ app, parts }) => {
    await vi.waitFor(() => expect(listedParts(app)).toHaveLength(parts + 1), SOON);
    expect(tile(app).getAttribute('aria-pressed')).toBe('false');
  },
});

threePaths('places-choice', {
  open: withPlaces,
  control: ({ app }) => app.one('dialog.tray-places button.tray-place'),
  then: async ({ app, parts }) => {
    await vi.waitFor(() => expect(app.host.querySelector('dialog.tray-places')).toBeNull(), SOON);
    await vi.waitFor(() => expect(listedParts(app)).toHaveLength(parts + 1), SOON);
    expect(app.one('.tray-said').textContent).toBe('Placed the switch.');
    expect(document.activeElement).toBe(tile(app));
  },
});

threePaths('places-close', {
  open: withPlaces,
  control: ({ app }) => app.button('Close', 'dialog.tray-places'),
  then: async ({ app, parts }) => {
    await vi.waitFor(() => expect(app.host.querySelector('dialog.tray-places')).toBeNull(), SOON);
    expect(listedParts(app)).toHaveLength(parts);
    expect(document.activeElement).toBe(tile(app));
  },
});

threePaths('library', {
  open: () => mountApp(),
  control: (app) => app.one('button.tray-library'),
  then: async (app) => {
    const library = await vi.waitFor(() => app.one<HTMLDialogElement>('dialog.library'), SOON);
    expect(library.open).toBe(true);
    expect(library.querySelector('h2')?.textContent).toBe('Parts Library');
  },
});

const withLibrary = async (): Promise<MountedApp> => {
  const app = await mountApp();
  await keyboard(app.one('button.tray-library'));
  await vi.waitFor(() => app.one('dialog.library'), SOON);
  return app;
};

/** The family filter's second chip: the first family after All families. */
const family = (app: MountedApp): HTMLInputElement => {
  const found = app.host.querySelectorAll<HTMLInputElement>('dialog.library fieldset')[0]?.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1];
  if (!found) throw new Error('no family to choose');
  return found;
};

let allCount = '';
threePaths('library-filter', {
  open: async () => {
    const app = await withLibrary();
    allCount = app.one('.library-count').textContent ?? '';
    return app;
  },
  control: (app) => family(app),
  // A radio group: a finger or a mouse on the chip, or the arrow key from the chosen one.
  press: async (path, control, app) => {
    if (path !== 'keyboard') return pressBy(path, control);
    const all = app.host.querySelector<HTMLInputElement>('dialog.library fieldset input[type="radio"]:checked');
    if (!all) throw new Error('no chosen chip');
    await keyboard(all, '{ArrowRight}');
  },
  then: async (app) => {
    await vi.waitFor(() => expect(family(app).checked).toBe(true), SOON);
    expect(app.one('.library-count').textContent).not.toBe(allCount);
    const shelves = [...app.host.querySelectorAll<HTMLElement>('dialog.library .library-shelf')].map((shelf) => shelf.dataset.family);
    expect(shelves).toEqual([family(app).value]);
  },
});

threePaths('library-close', {
  open: withLibrary,
  control: (app) => app.button('Close', 'dialog.library'),
  then: async (app) => {
    await vi.waitFor(() => expect(app.host.querySelector('dialog.library')).toBeNull(), SOON);
    expect(document.activeElement).toBe(app.one('button.tray-library'));
  },
});

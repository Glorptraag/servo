// The spec card's and the arena strip's controls, each by touch, pointer and keyboard on the real App (ground rule 8,
// review R-6.4 APP-2 and APP-4): Read aloud, a Level 2 card's setting, an arena preset, and a prop brought in by
// tap-then-tap, click-then-click or Enter (the keyboard and screen-reader path: the nearest free spot).
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { SOON, listedProps, mountApp, openChallenge, selectPart, unmountApps } from './app-harness.tsx';
import type { MountedApp } from './app-harness.tsx';
import { threePaths } from './controls.ts';
import { clickAt, keyboard, pageOf, pressBy, touchAt } from './input.ts';
import type { Point } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(() => {
  unmountApps();
  vi.restoreAllMocks();
});

let said: string[] = [];

threePaths('read-aloud', {
  open: async () => {
    said = [];
    vi.spyOn(window.speechSynthesis, 'speak').mockImplementation((utterance) => void said.push(utterance.text));
    vi.spyOn(window.speechSynthesis, 'cancel').mockImplementation(() => undefined);
    const app = await mountApp();
    await selectPart(app);
    return app;
  },
  control: (app) => app.one('button.spec-card-speak'),
  then: async (app) => {
    const title = app.one('.spec-card-name').textContent ?? '';
    await vi.waitFor(() => expect(said.join(' ')).toContain(title), SOON);
  },
});

/** The first setting's option after the chosen one: the one ArrowRight moves to. */
const nextOption = (app: MountedApp): HTMLInputElement => {
  const options = [...app.one('.spec-card-setting').querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const chosen = options.findIndex((option) => option.checked);
  const next = options[(chosen + 1) % options.length];
  if (!next || options.length < 2) throw new Error('no other option');
  return next;
};

let target = '';
threePaths('card-choice', {
  open: async () => {
    const app = await mountApp();
    await openChallenge(app, 'Meet the motor driver');
    await selectPart(app);
    target = nextOption(app).value;
    expect(app.button('Undo', '[data-region="runBar"]').disabled).toBe(true);
    return app;
  },
  control: (app) => nextOption(app),
  // A choice of big buttons, a native radio group: a finger or a mouse on the option, or the arrow key from the chosen one.
  press: async (path, control, app) => {
    if (path !== 'keyboard') return pressBy(path, control);
    const chosen = app.one('.spec-card-setting').querySelector<HTMLInputElement>('input[type="radio"]:checked');
    if (!chosen) throw new Error('no chosen option');
    await keyboard(chosen, '{ArrowRight}');
  },
  then: async (app) => {
    await vi.waitFor(() => expect(app.one('.spec-card-setting').querySelector<HTMLInputElement>('input:checked')?.value).toBe(target), SOON);
    // A set-setting edit through the canvas: one Undo step.
    await vi.waitFor(() => expect(app.button('Undo', '[data-region="runBar"]').disabled).toBe(false), SOON);
  },
});

const strip = (app: MountedApp, name: string): HTMLButtonElement => {
  const found = [...app.host.querySelectorAll<HTMLButtonElement>('.arena-strip button')].find((button) => button.textContent?.startsWith(name));
  if (!found) throw new Error(`no ${name} in the arena strip`);
  return found;
};

threePaths('arena-preset', {
  open: async () => {
    const app = await mountApp();
    expect(strip(app, 'Open floor').getAttribute('aria-pressed')).toBe('true');
    return app;
  },
  control: (app) => strip(app, 'Ramp'),
  then: async (app) => {
    await vi.waitFor(() => expect(strip(app, 'Ramp').getAttribute('aria-pressed')).toBe('true'), SOON);
    expect(strip(app, 'Open floor').getAttribute('aria-pressed')).toBe('false');
    await vi.waitFor(async () => {
      const stored = await app.child.blueprints.load(app.first.meta.id);
      expect(stored.ok && stored.blueprint.arena.preset).toBe('ramp');
    }, SOON);
  },
});

/** A spot on the floor clear of the panels and the build: below the arena strip, beside the tray. */
const freeSpot = (app: MountedApp): Point => {
  const tray = app.one('[data-region="tray"]').getBoundingClientRect();
  const arena = app.one('[data-region="arenaStrip"]').getBoundingClientRect();
  return pageOf(window, { x: tray.right + 60, y: arena.bottom + 60 });
};

let props = 0;
threePaths('arena-prop', {
  open: async () => {
    const app = await mountApp();
    props = listedProps(app);
    return app;
  },
  control: (app) => strip(app, 'Box'),
  press: async (path, control, app) => {
    if (path === 'keyboard') return keyboard(control);
    await pressBy(path, control);
    await vi.waitFor(() => expect(strip(app, 'Box').getAttribute('aria-pressed')).toBe('true'), SOON);
    await (path === 'touch' ? touchAt(freeSpot(app)) : clickAt(freeSpot(app)));
  },
  then: async (app) => {
    await vi.waitFor(() => expect(listedProps(app)).toBe(props + 1), SOON);
    expect(strip(app, 'Box').getAttribute('aria-pressed')).toBe('false');
    // One edit: Reset arena now has a prop to drop.
    expect(app.button('Reset arena', '[data-region="runBar"]').disabled).toBe(false);
  },
});

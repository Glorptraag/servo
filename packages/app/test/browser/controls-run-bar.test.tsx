// The Run bar's controls, each by touch, pointer and keyboard on the real App (ground rule 8, review R-6.4 APP-4):
// Run, Slower, Faster, Undo and Reset arena. Space as Run and Stop is run-bar.test.tsx's.
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { RUN_BAR_TEXT } from '../../src/run-bar/index.ts';
import { RUN, SOON, listedProps, mountApp, runToggle, unmountApps } from './app-harness.tsx';
import type { MountedApp } from './app-harness.tsx';
import { threePaths } from './controls.ts';
import { keyboard } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(unmountApps);

const bar = (app: MountedApp, name: string): HTMLButtonElement => app.button(name, '[data-region="runBar"]');
const rate = (app: MountedApp): string => app.one('[data-region="runBar"] .run-bar-spoken').textContent ?? '';
const box = (app: MountedApp): HTMLButtonElement => {
  const found = [...app.host.querySelectorAll<HTMLButtonElement>('.arena-strip button.arena-strip-prop')].find((button) => button.textContent?.startsWith('Box'));
  if (!found) throw new Error('no Box in the arena strip');
  return found;
};

threePaths('run-toggle', {
  open: () => mountApp(),
  control: (app) => runToggle(app),
  then: async (app) => {
    await vi.waitFor(() => expect(runToggle(app).dataset.run).toBe('stop'), RUN);
    await vi.waitFor(() => expect(app.one('.servo-shell').dataset.mode).toBe('run'), RUN);
    expect(runToggle(app).textContent).toBe(RUN_BAR_TEXT.stop);
  },
});

threePaths('slower', {
  open: async () => {
    const app = await mountApp();
    expect(rate(app)).toBe('30 ticks a second');
    return app;
  },
  control: (app) => bar(app, RUN_BAR_TEXT.slower),
  then: async (app) => {
    await vi.waitFor(() => expect(rate(app)).not.toBe('30 ticks a second'), SOON);
    expect(bar(app, RUN_BAR_TEXT.faster).disabled).toBe(false);
  },
});

threePaths('faster', {
  open: async () => {
    const app = await mountApp();
    await keyboard(bar(app, RUN_BAR_TEXT.slower));
    await vi.waitFor(() => expect(bar(app, RUN_BAR_TEXT.faster).disabled).toBe(false), SOON);
    return app;
  },
  control: (app) => bar(app, RUN_BAR_TEXT.faster),
  then: async (app) => {
    await vi.waitFor(() => expect(rate(app)).toBe('30 ticks a second'), SOON);
    expect(bar(app, RUN_BAR_TEXT.faster).disabled).toBe(true);
  },
});

let props = 0;

threePaths('undo', {
  open: async () => {
    const app = await mountApp();
    props = listedProps(app);
    await keyboard(box(app));
    await vi.waitFor(() => expect(listedProps(app)).toBe(props + 1), SOON);
    await vi.waitFor(() => expect(bar(app, RUN_BAR_TEXT.undo).disabled).toBe(false), SOON);
    return app;
  },
  control: (app) => bar(app, RUN_BAR_TEXT.undo),
  then: async (app) => {
    await vi.waitFor(() => expect(listedProps(app)).toBe(props), SOON);
    expect(bar(app, RUN_BAR_TEXT.undo).disabled).toBe(true);
  },
});

threePaths('reset-arena', {
  open: async () => {
    const app = await mountApp();
    props = listedProps(app);
    await keyboard(box(app));
    await keyboard(box(app));
    await vi.waitFor(() => expect(listedProps(app)).toBe(props + 2), SOON);
    await vi.waitFor(() => expect(bar(app, RUN_BAR_TEXT.resetArena).disabled).toBe(false), SOON);
    return app;
  },
  control: (app) => bar(app, RUN_BAR_TEXT.resetArena),
  then: async (app) => {
    await vi.waitFor(() => expect(listedProps(app)).toBe(props), SOON);
    expect(bar(app, RUN_BAR_TEXT.resetArena).disabled).toBe(true);
    expect(bar(app, RUN_BAR_TEXT.undo).disabled).toBe(false);
  },
});

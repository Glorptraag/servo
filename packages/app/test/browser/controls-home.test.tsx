// Home's controls, each by touch, pointer and keyboard on the real App (ground rule 8, review R-6.4 APP-4): Back to the
// build, New build, a saved build, a challenge, the access switches and the For adults link.
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { CHALLENGE_TEXT } from '../../src/challenges/index.ts';
import { SOON, mountApp, openHome, unmountApps } from './app-harness.tsx';
import type { MountedApp } from './app-harness.tsx';
import { threePaths } from './controls.ts';
import { keyboard, pressBy } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(unmountApps);

const home = (app: MountedApp): HTMLElement | null => app.host.querySelector('.servo-home');

/** The Home choice whose name is `name`, once Home has read the saved builds. */
const choice = (app: MountedApp, name: string): HTMLButtonElement => {
  const found = [...app.host.querySelectorAll<HTMLButtonElement>('.servo-home button.home-choice')].find(
    (button) => (button.querySelector('.home-choice-name')?.textContent ?? button.textContent) === name,
  );
  if (!found) throw new Error(`no ${name} on Home`);
  return found;
};

const withHome = async (): Promise<MountedApp> => {
  const app = await mountApp();
  // A second saved build to open.
  await app.child.blueprints.create({ name: 'Rover', level: 1, arena: { preset: 'open-floor', props: [] } });
  await openHome(app);
  await vi.waitFor(() => expect(choice(app, 'Rover').disabled).toBe(false), SOON);
  await vi.waitFor(() => expect(choice(app, CHALLENGE_TEXT.newBuild).disabled).toBe(false), SOON);
  return app;
};

const buildName = (app: MountedApp): string => app.one('button.shell-blueprint-name').textContent ?? '';

threePaths('home-back', {
  open: withHome,
  control: (app) => app.button(CHALLENGE_TEXT.back, '.servo-home'),
  then: async (app) => {
    await vi.waitFor(() => expect(home(app)).toBeNull(), SOON);
    await vi.waitFor(() => expect(document.activeElement).toBe(app.button(CHALLENGE_TEXT.home, '[data-region="header"]')), SOON);
    expect(buildName(app)).toBe('Build 1');
  },
});

threePaths('home-new-build', {
  open: withHome,
  control: (app) => choice(app, CHALLENGE_TEXT.newBuild),
  then: async (app) => {
    await vi.waitFor(() => expect(home(app)).toBeNull(), SOON);
    await vi.waitFor(() => expect(buildName(app)).toBe('Build 2'), SOON);
    expect((await app.child.blueprints.list()).map((build) => build.name).sort()).toEqual(['Build 1', 'Build 2', 'Rover']);
  },
});

threePaths('home-saved-build', {
  open: withHome,
  control: (app) => choice(app, 'Rover'),
  then: async (app) => {
    await vi.waitFor(() => expect(home(app)).toBeNull(), SOON);
    await vi.waitFor(() => expect(buildName(app)).toBe('Rover'), SOON);
  },
});

threePaths('home-challenge', {
  open: withHome,
  control: (app) => choice(app, 'Meet the switch'),
  then: async (app) => {
    await vi.waitFor(() => expect(home(app)).toBeNull(), SOON);
    await vi.waitFor(() => expect(app.one('.shell-goal').textContent).not.toBe(''), SOON);
    await vi.waitFor(() => expect(app.host.querySelector('button.hint-button')).not.toBeNull(), SOON);
  },
});

const contrast = (app: MountedApp): HTMLInputElement => app.one<HTMLInputElement>('[data-region="access"] [data-option="highContrast"] input[role="switch"]');

threePaths('access-switch', {
  open: withHome,
  control: (app) => contrast(app),
  // A switch: a tap or a click anywhere on its row, or Space on it (Home keeps Space from Run and Stop).
  press: (path, control) => (path === 'keyboard' ? keyboard(control, ' ') : pressBy(path, control.closest('label') as HTMLElement)),
  then: async (app) => {
    await vi.waitFor(() => expect(contrast(app).checked).toBe(true), SOON);
    expect(app.access.prefs.highContrast).toBe(true);
    await vi.waitFor(() => expect(app.one('.servo-shell').dataset.contrast).toBe('high'), SOON);
    expect(runToggleOf(app).dataset.run).toBe('run');
  },
});

const runToggleOf = (app: MountedApp): HTMLElement => app.one('[data-region="runBar"] .run-bar-toggle');

let followed: string[] = [];
threePaths('for-adults', {
  open: async () => {
    const app = await withHome();
    followed = [];
    // The test page must stay: the link's own click is heard, and its navigation held back.
    app.host.addEventListener('click', (event) => {
      const link = (event.target as Element).closest('a.home-parent-link');
      if (!link) return;
      event.preventDefault();
      followed.push((link as HTMLAnchorElement).href);
    });
    return app;
  },
  control: (app) => app.one('a.home-parent-link'),
  then: async (app) => {
    await vi.waitFor(() => expect(followed).toHaveLength(1), SOON);
    expect(new URL(followed[0] ?? '').pathname.endsWith('/parent.html')).toBe(true);
    expect(app.one('a.home-parent-link').textContent).toBe(CHALLENGE_TEXT.forAdults);
  },
});

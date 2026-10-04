// Home's controls, each by touch, pointer and keyboard on the real App (ground rule 8, review R-6.4 APP-4): Back to the
// build, New build, a saved build, a challenge, the access switches and the For adults link.
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { CHALLENGE_TEXT } from '../../src/challenges/index.ts';
import { ACCESS_OPTIONS } from '../../src/a11y/index.ts';
import type { AccessOption } from '../../src/a11y/index.ts';
import { SOON, content, mountApp, openHome, unmountApps } from './app-harness.tsx';
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

/** Home again, by keyboard, with its choices ready. */
const homeAgain = async (app: MountedApp): Promise<void> => {
  await openHome(app);
  await vi.waitFor(() => expect(choice(app, CHALLENGE_TEXT.newBuild).disabled).toBe(false), SOON);
};

const SAVED = ['Build 1', 'Rover', 'Crawler'];

threePaths('home-saved-build', {
  open: async () => {
    const app = await withHome();
    await app.child.blueprints.create({ name: 'Crawler', level: 1, arena: { preset: 'open-floor', props: [] } });
    return app;
  },
  control: (app) => choice(app, 'Rover'),
  // Every saved build in turn, the open one too.
  press: async (path, _first, app) => {
    for (const name of [...SAVED.slice(1), SAVED[0] ?? '']) {
      await homeAgain(app);
      await vi.waitFor(() => choice(app, name), SOON);
      await pressBy(path, choice(app, name));
      await vi.waitFor(() => expect(home(app)).toBeNull(), SOON);
      await vi.waitFor(() => expect(buildName(app)).toBe(name), SOON);
    }
  },
  then: async (app) => {
    expect((await app.child.blueprints.list()).map((build) => build.name).sort()).toEqual([...SAVED].sort());
  },
  timeout: 300_000,
});

let opened: string[] = [];
threePaths('home-challenge', {
  open: async () => {
    opened = [];
    return withHome();
  },
  control: (app) => choice(app, content.challenges[0]?.title ?? ''),
  // Every challenge in content, each laying its goal line over the canvas.
  press: async (path, _first, app) => {
    for (const challenge of content.challenges) {
      await homeAgain(app);
      await pressBy(path, choice(app, challenge.title));
      await vi.waitFor(() => expect(home(app)).toBeNull(), SOON);
      await vi.waitFor(() => expect(app.one('.shell-goal').textContent, challenge.title).toContain(challenge.goalLine), SOON);
      opened.push(challenge.id);
    }
  },
  then: async () => {
    expect(opened).toEqual(content.challenges.map((challenge) => challenge.id));
    expect(opened.length).toBeGreaterThan(1);
  },
  timeout: 900_000,
});

const access = (app: MountedApp, option: AccessOption): HTMLInputElement =>
  app.one<HTMLInputElement>(`[data-region="access"] [data-option="${option}"] input[role="switch"]`);

threePaths('access-switch', {
  open: async () => {
    // Read aloud speaks once it is on.
    vi.spyOn(window.speechSynthesis, 'speak').mockImplementation(() => undefined);
    vi.spyOn(window.speechSynthesis, 'cancel').mockImplementation(() => undefined);
    return withHome();
  },
  control: (app) => access(app, 'highContrast'),
  // Each switch: a tap or a click anywhere on its row, or Space on it (Home keeps Space from Run and Stop).
  press: async (path, _first, app) => {
    for (const option of ACCESS_OPTIONS) {
      const control = (): HTMLInputElement => access(app, option);
      await (path === 'keyboard' ? keyboard(control, ' ') : pressBy(path, control().closest('label') as HTMLElement));
      await vi.waitFor(() => expect(control().checked, option).toBe(true), SOON);
      expect(app.access.prefs[option]).toBe(true);
    }
  },
  then: async (app) => {
    await vi.waitFor(() => expect(app.one('.servo-shell').dataset.contrast).toBe('high'), SOON);
    expect(app.one('.servo-shell').dataset.hand).toBe('left');
    expect(runToggleOf(app).dataset.run).toBe('run');
  },
  close: () => {
    vi.restoreAllMocks();
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

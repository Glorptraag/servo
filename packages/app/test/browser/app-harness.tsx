// The real App for the three-path tests (controls-*.test.tsx): the real canvas, content, sim-core and run loop, a
// store of its own in IndexedDB with one child, the access options kept in memory and no feature flags. Helpers find
// its controls and open its screens without pressing anything, so a test presses only the control it is about.
import { expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { AccessStore } from '../../src/a11y/index.ts';
import { App } from '../../src/App.tsx';
import { NO_FLAGS } from '../../src/flags/index.ts';
import { openStore } from '../../src/store/index.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';
import { keyboard } from './input.ts';

export const { content } = loadContent();

export const fixture = (name: string): Blueprint => {
  const found = loadFixtures().fixtures.find((candidate) => candidate.name === name)?.blueprint;
  if (!found) throw new Error(`no ${name} fixture`);
  return found;
};

export const SOON = { timeout: 30_000 };
export const RUN = { timeout: 60_000 };

export interface MountedApp {
  readonly host: HTMLElement;
  readonly child: ProfileStore;
  /** The build the App opened on, kept in the child's store. */
  readonly first: Blueprint;
  readonly access: AccessStore;
  /** The one element matching `selector`. */
  one<T extends HTMLElement = HTMLElement>(selector: string): T;
  /** The button in `within` (the App by default) whose accessible name is `name`. */
  button(name: string, within?: string): HTMLButtonElement;
}

const opened: { root: Root; host: HTMLElement; store: ServoStore }[] = [];

export const unmountApps = (): void => {
  for (const { root, host, store } of opened.splice(0)) {
    root.unmount();
    host.remove();
    store.close();
  }
};

/** The App on a store of its own, opened on a copy of `start` (the Level 1 roller by default) as the child's build. */
export const mountApp = async (start: Blueprint = fixture('level-1-roller')): Promise<MountedApp> => {
  const store = await openStore({ name: `servo-controls-${crypto.randomUUID()}` });
  const profile = await store.profiles.create('Builder 1');
  const child = store.forProfile(profile.id);
  const copied = await child.blueprints.copy(start, 'Build 1');
  if (!copied.ok) throw new Error('the start did not copy');
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  opened.push({ root, host, store });
  const access = new AccessStore(null);
  await new Promise<void>((ready) =>
    root.render(<App content={content} child={child} start={copied.blueprint} access={access} flags={NO_FLAGS} onReady={ready} />),
  );
  // The list view is filled once the canvas has the build.
  await vi.waitFor(() => expect(host.querySelector('.servo-list-view button[data-toggle]')).not.toBeNull(), SOON);
  // The Run bar works once the run loop is handed out.
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[data-region="runBar"] .run-bar-toggle')?.disabled).toBe(false), SOON);
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = host.querySelector<T>(selector);
    if (!found) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  return {
    host,
    child,
    first: copied.blueprint,
    access,
    one,
    button: (name, within) => {
      const scope = within ? one(within) : host;
      const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim() === name,
      );
      if (!found) throw new Error(`no ${name} button`);
      return found;
    },
  };
};

/** The build as the canvas's list view reads it: the toggles of its parts. */
export const listedParts = (app: MountedApp): string[] =>
  [...app.host.querySelectorAll<HTMLElement>('.servo-list-view button[data-toggle^="part:"]')].map((toggle) => toggle.dataset.toggle ?? '');

/** The wires the list view reads. */
export const listedWires = (app: MountedApp): number => app.host.querySelectorAll('.servo-list-view button[data-toggle^="wire:"]').length;

/** The props the list view reads, the preset's own with the child's. */
export const listedProps = (app: MountedApp): number => app.host.querySelectorAll('.servo-list-view button[data-toggle^="prop:"]').length;

/**
 * Selects a part through the canvas's list view (its own controls, tested in packages/canvas), by keyboard: its
 * Actions, then Select. With no id, the first part whose card shows a setting, or else the first part.
 */
export const selectPart = async (app: MountedApp, partId?: string): Promise<void> => {
  const card = (): HTMLElement => app.one('[data-region="specCard"]');
  const choose = async (id: string): Promise<void> => {
    const toggle = app.one<HTMLButtonElement>(`.servo-list-view button[data-toggle="part:${id}"]`);
    if (toggle.getAttribute('aria-expanded') !== 'true') await keyboard(toggle);
    const select = await vi.waitFor(() => app.one<HTMLButtonElement>(`.servo-list-view button[data-action="select:part:${id}"]`), SOON);
    await keyboard(select);
    await vi.waitFor(() => expect(card().querySelector(`.spec-card`)).not.toBeNull(), SOON);
    await vi.waitFor(() => expect(card().dataset.shown).toBe('true'), SOON);
  };
  if (partId) return choose(partId);
  const ids = listedParts(app).map((toggle) => toggle.slice('part:'.length));
  for (const id of ids) {
    await choose(id);
    if (card().querySelector('.spec-card-setting')) return;
  }
  if (ids[0]) await choose(ids[0]);
};

/** Home, opened by keyboard. */
export const openHome = async (app: MountedApp): Promise<HTMLElement> => {
  if (!app.host.querySelector('.servo-home')) await keyboard(app.button('Home', '[data-region="header"]'));
  return vi.waitFor(() => app.one('.servo-home'), SOON);
};

/** A challenge on the canvas, chosen on Home by keyboard. */
export const openChallenge = async (app: MountedApp, title: string): Promise<void> => {
  const home = await openHome(app);
  const choice = await vi.waitFor(() => {
    const found = [...home.querySelectorAll<HTMLButtonElement>('button.home-choice')].find((each) => each.querySelector('.home-choice-name')?.textContent === title);
    if (!found || found.disabled) throw new Error(`no ${title} on Home yet`);
    return found;
  }, SOON);
  await keyboard(choice);
  await vi.waitFor(() => expect(app.host.querySelector('.servo-home')).toBeNull(), SOON);
  await vi.waitFor(() => expect(app.host.querySelector('.shell-goal')?.textContent).not.toBe(''), SOON);
};

/** The Run/Stop toggle. */
export const runToggle = (app: MountedApp): HTMLButtonElement => app.one<HTMLButtonElement>('[data-region="runBar"] .run-bar-toggle');

/** Run, pressed by keyboard, and the Run playing. */
export const startRun = async (app: MountedApp): Promise<void> => {
  await keyboard(runToggle(app));
  await vi.waitFor(() => expect(runToggle(app).dataset.run).toBe('stop'), RUN);
};

/** Stop, pressed by keyboard, and Build mode back. */
export const stopRun = async (app: MountedApp): Promise<void> => {
  await keyboard(runToggle(app));
  await vi.waitFor(() => expect(runToggle(app).dataset.run).toBe('run'), RUN);
};

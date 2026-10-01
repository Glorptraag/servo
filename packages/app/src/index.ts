// @servo/app: the child's app. Task 4.1 draws the shell round the canvas; task 4.9 adds the store. See README.md.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { loadContent } from '@servo/content';
import type { Blueprint } from '@servo/schema';
import { App, START_LEVEL } from './App.tsx';
import { openStore } from './store/index.ts';
import type { ProfileStore, ServoStore, StoreOptions } from './store/index.ts';

export interface AppOptions {
  /** How to open the store. Tests and the e2e harness pass their own database name. */
  readonly store?: StoreOptions;
}

export interface AppHandle {
  /** Removes the app from its host and closes the store. */
  destroy(): void;
}

/**
 * Starts the child's app in `host`: opens the store, then draws the shell around the canvas. A shared link opens as
 * a read-only replay with "keep a copy" (D43). The web build and the e2e harness call it.
 */
export type MountApp = (host: HTMLElement, options?: AppOptions) => Promise<AppHandle>;

interface Opening {
  readonly child: ProfileStore | null;
  readonly start: Blueprint | undefined;
}

const NO_ONE: Opening = { child: null, start: undefined };

/** The profile the app makes on a device that has none: a neutral name, no email, nothing personal. */
const FIRST_PROFILE_NAME = 'Builder 1';

/** The empty sandbox build the app starts for a profile with none that loads. */
const FIRST_BUILD_NAME = 'Build 1';

/** The arena a first build is set in: the plain floor, with no walls or props, or else the content's first. */
const FIRST_ARENA = 'open-floor';

/** Runs `work` while no other tab of the app on this device runs it, where the browser can promise that (Web Locks). */
const alone = <T>(name: string, work: () => Promise<T>): Promise<T> => {
  const locks = (globalThis as { readonly navigator?: { readonly locks?: LockManager } }).navigator?.locks;
  return locks ? locks.request(name, work) : work();
};

/**
 * Whose records the app opens, and the build it opens with, until the profile switch (task 5.1) and Home (task 4.5)
 * choose them. On a device with no profile it makes one, "Builder 1", which the parent view can rename later. It opens
 * the one profile, with its newest build that loads, or a new empty "Build 1" when none does, so the child always has
 * a build to work on and nothing is lost. With several profiles, before the profile switch exists, none is in use.
 * Two tabs opening at once take turns, so a device never gets two first profiles.
 */
const openingOf = (store: ServoStore): Promise<Opening> =>
  alone('servo.opening', async () => {
    const found = await store.profiles.list();
    const profiles = found.length > 0 ? found : [await store.profiles.create(FIRST_PROFILE_NAME)];
    const [only] = profiles;
    if (!only || profiles.length > 1) return NO_ONE;
    const child = store.forProfile(only.id);
    for (const summary of await child.blueprints.list()) {
      const loaded = await child.blueprints.load(summary.id);
      if (loaded.ok) return { child, start: loaded.blueprint };
    }
    const arena = store.content.arenas.find((preset) => preset.id === FIRST_ARENA) ?? store.content.arenas[0];
    if (!arena) return { child, start: undefined };
    const start = await child.blueprints.create({ name: FIRST_BUILD_NAME, level: START_LEVEL, arena: { preset: arena.id, props: [] } });
    return { child, start };
  });

/**
 * Opens the store, then draws the shell and the canvas in `host`, which needs a definite size: the shell fills it.
 * Resolves once the canvas is mounted. A device whose storage cannot be opened still builds; it only cannot save.
 */
export const mountApp: MountApp = async (host, options = {}) => {
  const store = await openStore(options.store).catch((error: unknown) => {
    console.warn('The store could not be opened, so nothing will be saved.', error);
    return null;
  });
  const { child, start } = store ? await openingOf(store).catch(() => NO_ONE) : NO_ONE;
  const content = store?.content ?? loadContent().content;
  return new Promise<AppHandle>((resolve, reject) => {
    const root = createRoot(host, {
      onUncaughtError: (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
        reportError(error);
      },
    });
    const handle: AppHandle = {
      destroy: () => {
        root.unmount();
        store?.close();
      },
    };
    root.render(createElement(App, { content, child, start, onReady: () => resolve(handle) }));
  });
};

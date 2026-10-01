// @servo/app: the child's app. Task 4.1 draws the shell round the canvas; task 4.9 adds the store. See README.md.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { loadContent } from '@servo/content';
import type { Blueprint } from '@servo/schema';
import { App } from './App.tsx';
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

/**
 * Whose records the app opens, and the build it opens with, until the profile switch (task 5.1) and Home (task 4.5)
 * choose them: the one profile on this device and its newest build that loads. With no profile, or with several, no
 * profile is in use, so the canvas starts empty and nothing is saved.
 */
const openingOf = async (store: ServoStore): Promise<Opening> => {
  const profiles = await store.profiles.list();
  const [only] = profiles;
  if (!only || profiles.length > 1) return NO_ONE;
  const child = store.forProfile(only.id);
  for (const summary of await child.blueprints.list()) {
    const loaded = await child.blueprints.load(summary.id);
    if (loaded.ok) return { child, start: loaded.blueprint };
  }
  return { child, start: undefined };
};

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

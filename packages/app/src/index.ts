// @servo/app: the child's app. Task 4.1 draws the shell round the canvas; task 4.9 adds the store. See README.md.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import { BLUEPRINT_VERSION } from '@servo/schema';
import type { ArenaRef, Blueprint } from '@servo/schema';
import { App, START_LEVEL } from './App.tsx';
import { Autosaver, pageStorage } from './shell/index.ts';
import type { Journal } from './shell/index.ts';
import { DATABASE_NAME } from './store/database.ts';
import { openStore } from './store/index.ts';
import type { ProfileStore, ServoStore, StoreOptions } from './store/index.ts';
import { onProfilesChanged } from './store/device.ts';
import { buildForOpening, profilesForOpening } from './store/open.ts';
import { uuidV4 } from './store/uuid.ts';

export interface AppOptions {
  /** How to open the store. Tests and the e2e harness pass their own database name. */
  readonly store?: StoreOptions;
}

export interface AppHandle {
  /** Removes the app from its host, then closes the store once every save it started has settled. */
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

/** The empty sandbox build the app starts when there is none that loads. */
const FIRST_BUILD_NAME = 'Build 1';

/** The arena a first build is set in: the plain floor, with no walls or props, or else the content's first. */
const firstArena = (content: Content): ArenaRef | undefined => {
  const preset = content.arenas.find((arena) => arena.id === 'open-floor') ?? content.arenas[0];
  return preset ? { preset: preset.id, props: [] } : undefined;
};

/**
 * An empty build that lives only in this page: for a device that cannot keep builds, or a session with no one profile
 * to keep them in. The child builds on, and Save's line says builds are not being kept.
 */
const unsavedBuild = (content: Content): Blueprint | undefined => {
  const arena = firstArena(content);
  if (!arena) return undefined;
  const at = new Date().toISOString();
  const meta = { id: uuidV4(), name: FIRST_BUILD_NAME, level: START_LEVEL, createdAt: at, updatedAt: at, highWater: { parts: 0, wires: 0 } };
  return { version: BLUEPRINT_VERSION, parts: [], wires: [], arena, meta };
};

/**
 * Whose records the app opens, and the build it opens with, until Home (task 4.5) chooses the build. On a device with
 * no profile it makes one, "Builder 1", which the parent view can rename later. It opens the profile in use on this
 * device (the parent view's profile switch, task 5.1, or the only profile), with its newest build that loads, or a new
 * empty "Build 1" when none does, so the child always has a build to work on. Each step is one transaction in the
 * store, so two tabs opening at once never make two of either. With several profiles and none chosen, none is in use.
 */
const openingOf = async (store: ServoStore): Promise<Opening> => {
  await profilesForOpening(store, FIRST_PROFILE_NAME);
  const inUse = await store.profiles.inUse();
  const arena = firstArena(store.content);
  if (!inUse || !arena) return NO_ONE;
  const start = await buildForOpening(store, inUse.id, { name: FIRST_BUILD_NAME, level: START_LEVEL, arena });
  return { child: store.forProfile(inUse.id), start };
};

/**
 * Opens the store, then draws the shell and the canvas in `host`, which needs a definite size: the shell fills it.
 * Resolves once the canvas is mounted. When the device's storage cannot be opened, or opening a build in it fails,
 * the child still builds: on an empty build kept only in the page, with a line that says builds are not being kept.
 */
export const mountApp: MountApp = async (host, options = {}) => {
  const store = await openStore(options.store).catch((error: unknown) => {
    console.warn('The store could not be opened, so builds are not kept on this device.', error);
    return null;
  });
  // Builds a page of the app noted as it was left, before their saves finished, are replayed first, so the build the
  // app then opens is the newest (autosave.ts). A copy that replay kept is said in Save's line.
  const storage = pageStorage();
  const journal: Journal | undefined = storage ? { storage, scope: options.store?.name ?? DATABASE_NAME } : undefined;
  const saving = new Autosaver(journal);
  if (store) {
    await saving.recover(store).catch((error: unknown) => {
      console.warn('Builds left unsaved could not all be replayed; they stay noted for next time.', error);
    });
  }
  const opened = store
    ? await openingOf(store).catch((error: unknown) => {
        console.warn('The store could not open a build, so builds are not kept on this device.', error);
        return NO_ONE;
      })
    : NO_ONE;
  const content = store?.content ?? loadContent().content;
  const scope = options.store?.name ?? DATABASE_NAME;
  return new Promise<AppHandle>((resolve, reject) => {
    const root = createRoot(host, {
      onUncaughtError: (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
        reportError(error);
      },
    });
    let destroyed = false;
    // Each opening is drawn afresh under its own key, so the shell, the canvas and Save start again for that child.
    let shown = 0;
    let current = opened.child?.profile;
    const show = ({ child, start }: Opening): void => {
      shown += 1;
      root.render(
        createElement(App, { key: shown, content, child, start: child ? start : unsavedBuild(content), saving, onReady: () => resolve(handle) }),
      );
    };
    // The profile switch (task 5.1): when the parent view, in another page, chooses another child, or adds or removes
    // one, this page follows. What waits is saved first, to the child who made it; a removed child's waiting builds go
    // with that child (D38). Only then does the app open again, for the child in use now. Every save names its own
    // child, so an edit is never stored under another.
    let following = Promise.resolve();
    const follow = (): void => {
      following = following
        .then(async () => {
          if (!store || destroyed) return;
          const next = (await store.profiles.inUse())?.id;
          if (next === current) return;
          const previous = current;
          if (previous && !(await store.profiles.list()).some((profile) => profile.id === previous)) saving.drop(previous);
          saving.flush();
          await saving.settled();
          const opening = await openingOf(store).catch((error: unknown) => {
            console.warn('The store could not open a build, so builds are not kept on this device.', error);
            return NO_ONE;
          });
          if (destroyed) return;
          current = opening.child?.profile;
          show(opening);
        })
        .catch((error: unknown) => {
          console.warn('The app could not follow the profile switch.', error);
        });
    };
    const unfollow = store ? onProfilesChanged(scope, follow) : () => undefined;
    const handle: AppHandle = {
      destroy: () => {
        destroyed = true;
        unfollow();
        // Unmounting saves what waits; the store closes only once those saves have settled.
        root.unmount();
        void following
          .then(() => saving.settled())
          .finally(() => {
            saving.dispose();
            store?.close();
          });
      },
    };
    show(opened);
  });
};

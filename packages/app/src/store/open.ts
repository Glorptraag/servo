// Opens the store on this device for the content it is given. index.ts's `openStore` gives it the package's own content
// (`loadContent`); tests give it other content, such as the schema's fixture catalogue. Also the app's own openings
// (task 4.9), which are not part of the contract: each runs in one transaction. See docs/store.md.
import type { ContentLoad } from '@servo/content';
import type { Blueprint, ProfileId } from '@servo/schema';
import { blueprintsOf, openingBuild } from './blueprints.ts';
import type { NewBuild } from './blueprints.ts';
import type { StoreContext } from './context.ts';
import { DATABASE_NAME, openDatabase } from './database.ts';
import type { Profile, ServoStore, StoreOptions } from './index.ts';
import { profilesOf, profilesOrFirst } from './profiles.ts';
import { cardGamesOf, runsOf } from './records.ts';
import { syncOf } from './sync.ts';

/**
 * Asks the browser to keep the store, since Safari may otherwise evict it; sync is the real backup. It asks only when
 * the store is not kept yet, and opening never waits for the answer. Some browsers have no StorageManager (Node, or a
 * page that is not a secure context).
 */
const keepStorage = (): void => {
  const storage = (globalThis as { readonly navigator?: { readonly storage?: StorageManager } }).navigator?.storage;
  if (typeof storage?.persisted !== 'function' || typeof storage.persist !== 'function') return;
  void storage
    .persisted()
    .then((kept) => kept || storage.persist())
    .catch(() => false);
};

/** Each store this package opened, with what its parts share. */
const contexts = new WeakMap<ServoStore, StoreContext>();

const contextOf = (store: ServoStore): StoreContext => {
  const ctx = contexts.get(store);
  if (!ctx) throw new Error('This store was not opened by openStore.');
  return ctx;
};

export const openStoreWith = async (load: ContentLoad, options: StoreOptions = {}): Promise<ServoStore> => {
  const db = await openDatabase(options.name ?? DATABASE_NAME);
  keepStorage();
  const ctx: StoreContext = { db, content: load.content, now: options.now ?? (() => new Date().toISOString()) };
  const store: ServoStore = {
    content: load.content,
    contentIssues: load.issues,
    profiles: profilesOf(ctx),
    forProfile: (profile) => ({
      profile,
      blueprints: blueprintsOf(ctx, profile),
      runs: runsOf(ctx, profile),
      cardGames: cardGamesOf(ctx, profile),
    }),
    sync: syncOf(options.remote),
    close: () => db.close(),
  };
  contexts.set(store, ctx);
  return store;
};

/** The app's first run (task 4.9): the device's profiles, oldest first, with one named `name` made when there are none. */
export const profilesForOpening = async (store: ServoStore, name: string): Promise<readonly Profile[]> => profilesOrFirst(contextOf(store), name);

/** The build the app opens for `profile` (task 4.9): its newest that loads, or a new empty one from `init`. */
export const buildForOpening = async (store: ServoStore, profile: ProfileId, init: NewBuild): Promise<Blueprint> =>
  openingBuild(contextOf(store), profile, init);

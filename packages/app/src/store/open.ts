// Opens the store on this device for the content it is given. index.ts's `openStore` gives it the package's own content
// (`loadContent`); tests give it other content, such as the schema's fixture catalogue. See docs/store.md.
import type { ContentLoad } from '@servo/content';
import { blueprintsOf } from './blueprints.ts';
import type { StoreContext } from './context.ts';
import { DATABASE_NAME, openDatabase } from './database.ts';
import type { ServoStore, StoreOptions } from './index.ts';
import { profilesOf } from './profiles.ts';
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

export const openStoreWith = async (load: ContentLoad, options: StoreOptions = {}): Promise<ServoStore> => {
  const db = await openDatabase(options.name ?? DATABASE_NAME);
  keepStorage();
  const ctx: StoreContext = { db, content: load.content, now: options.now ?? (() => new Date().toISOString()) };
  return {
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
};

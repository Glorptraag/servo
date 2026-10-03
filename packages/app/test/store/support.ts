// Shared by the store's unit tests, which run in Node on fake-indexeddb: each test file imports 'fake-indexeddb/auto'
// before anything else, so Dexie finds it. Here: databases no other test meets, the schema's fixture catalogue as
// content, a clock the tests move, and the raw rows, for putting a document in as an older or newer version of Servo,
// or sync, would have left it, and for reading back exactly what was stored.
import { contentFrom } from '@servo/content';
import type { ContentLoad } from '@servo/content';
import type { Blueprint, ProfileId, RunRecord, Timestamp } from '@servo/schema';
import { exampleArenas, exampleParts, validKits } from '@servo/schema/fixtures';
import { openDatabase } from '../../src/store/database.ts';
import type { BlueprintRow, ProfileRow, ServoDatabase } from '../../src/store/database.ts';
import { openStoreWith } from '../../src/store/open.ts';
import type { ServoStore, StoreOptions } from '../../src/store/index.ts';
import { vi } from 'vitest';

// Every store test file imports this, so this sets their timeout: a test opens and fills a database, up to a second
// alone, and far past Vitest's 5 s default on a machine at load 200–350 with many agents running.
vi.setConfig({ testTimeout: 120_000 });

let opened = 0;

/** A database name no other test uses. */
export const freshName = (): string => {
  opened += 1;
  return `servo-test-${opened}-${Math.random().toString(36).slice(2)}`;
};

const idOf = (record: unknown): string => (record as { readonly id: string }).id;

/** The schema's fixture catalogue as content. The schema's valid blueprints and version 0 fixtures are checked against it. */
export const schemaContent: ContentLoad = contentFrom({
  records: Object.fromEntries([
    ...exampleParts.map((part) => [`parts/${idOf(part)}.json`, part] as const),
    ...exampleArenas.map((arena) => [`arenas/${idOf(arena)}.json`, arena] as const),
    ...validKits.map((kit) => [`kits/${kit.name}.json`, kit.data] as const),
  ]),
});

export interface Clock {
  readonly now: () => Timestamp;
  set(time: Timestamp): void;
}

/** A clock that stays where the test sets it. */
export const clock = (start: Timestamp): Clock => {
  let time = start;
  return {
    now: () => time,
    set: (next) => {
      time = next;
    },
  };
};

export interface Opened {
  readonly store: ServoStore;
  readonly name: string;
  readonly clock: Clock;
}

export const T0 = '2026-10-01T09:00:00.000Z';

/** A store on a database of its own, for `content`, with a clock the test moves. */
export const openFor = async (content: ContentLoad, options: StoreOptions = {}): Promise<Opened> => {
  const time = clock(T0);
  const name = freshName();
  const store = await openStoreWith(content, { name, now: time.now, ...options });
  return { store, name, clock: time };
};

/** A second connection to a test's database, for reading and writing rows as they are stored. */
export const withDatabase = async <T>(name: string, use: (db: ServoDatabase) => Promise<T>): Promise<T> => {
  const db = await openDatabase(name);
  try {
    return await use(db);
  } finally {
    db.close();
  }
};

/** The stored bytes of a blueprint, exactly as they lie in the database. */
export const storedDocument = (name: string, id: string): Promise<string | undefined> =>
  withDatabase(name, async (db) => (await db.blueprints.get(id))?.document);

/** Puts a stored document in as it came, for example from an older or a newer version of Servo. */
export const putStored = (name: string, row: BlueprintRow): Promise<void> =>
  withDatabase(name, async (db) => {
    await db.blueprints.put(row);
  });

/** Adds a profile under a given id: a fixture's author, so a stored fixture is that profile's own. */
export const putProfile = (name: string, row: Omit<ProfileRow, 'seq'>): Promise<void> =>
  withDatabase(name, async (db) => {
    await db.profiles.add(row);
  });

/** Every row a profile owns, in every table, straight from the database. */
export const rowsOf = (name: string, profile: ProfileId) =>
  withDatabase(name, async (db) => ({
    profiles: await db.profiles.where('id').equals(profile).count(),
    blueprints: await db.blueprints.where('profile').equals(profile).count(),
    runs: await db.runs.where('profile').equals(profile).count(),
    cardGames: await db.cardGames.where('profile').equals(profile).count(),
  }));

/** The blueprint with another time, name or id, as the store would stamp it. */
export const withMeta = (blueprint: Blueprint, meta: Partial<Blueprint['meta']>): Blueprint => ({ ...blueprint, meta: { ...blueprint.meta, ...meta } });

/** A run record from `template`, of `blueprint`, with `more` on top: its own id, profile and times. */
export const runOf = (template: RunRecord, blueprint: Blueprint, more: Partial<RunRecord> = {}): RunRecord => ({
  ...template,
  blueprintId: blueprint.meta.id,
  blueprint,
  ...more,
});

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

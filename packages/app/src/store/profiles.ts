// Child profiles under the one adult account on this device (docs/store.md, "Profiles"): an opaque id, the adult's name
// for the profile, and when it was made. Removing one removes everything it owns (D38), with what this device noted for
// it outside the database (device.ts); the parent view asks the adult first, and the app never removes anything on its
// own. The profile in use on this device (task 5.1) is kept beside the database, in device.ts, since it never syncs.
import type { ProfileId } from '@servo/schema';
import { recordChange } from './changes.ts';
import type { Change } from './changes.ts';
import { compareText, isName, refusal } from './context.ts';
import { announceProfiles, chooseProfile, chosenProfile, deviceStorage, forgetProfileOnDevice } from './device.ts';
import type { StoreContext } from './context.ts';
import type { ProfileRow } from './database.ts';
import type { Profile, Profiles } from './index.ts';
import { uuidV4 } from './uuid.ts';

const profileOf = ({ id, name, createdAt }: ProfileRow): Profile => ({ id, name, createdAt });

const checkName = (name: unknown): void => {
  if (!isName(name)) throw refusal('A profile name is 1 to 60 characters on one line, without spaces at either end.');
};

const noProfile = (id: ProfileId): Error => refusal(`There is no profile '${String(id)}' on this device.`);

const oldestFirst = (rows: readonly ProfileRow[]): Profile[] =>
  [...rows].sort((a, b) => compareText(a.createdAt, b.createdAt) || a.seq - b.seq).map(profileOf);

/**
 * The device's profiles, oldest first. On a device with none, it first makes one named `name` (the app's first run,
 * task 4.9). One read-write transaction, which IndexedDB runs one at a time across tabs, so two tabs opening at once
 * never make two first profiles, with or without Web Locks.
 */
export const profilesOrFirst = async ({ db, now }: StoreContext, name: string): Promise<readonly Profile[]> => {
  checkName(name);
  return db.transaction('rw', [db.profiles, db.changes], async () => {
    const rows = await db.profiles.toArray();
    if (rows.length > 0) return oldestFirst(rows);
    const profile: Profile = { id: uuidV4(), name, createdAt: now() };
    await db.profiles.add({ ...profile });
    await recordChange(db, { collection: 'profiles', id: profile.id, updatedAt: profile.createdAt, removed: false });
    return [profile];
  });
};

export const profilesOf = ({ db, now }: StoreContext): Profiles => ({
  list: async () => oldestFirst(await db.profiles.toArray()),

  create: async (name) => {
    checkName(name);
    const profile: Profile = { id: uuidV4(), name, createdAt: now() };
    await db.transaction('rw', [db.profiles, db.changes], async () => {
      await db.profiles.add({ ...profile });
      await recordChange(db, { collection: 'profiles', id: profile.id, updatedAt: profile.createdAt, removed: false });
    });
    announceProfiles(db.name);
    return profile;
  },

  rename: async (id, name) => {
    checkName(name);
    return db.transaction('rw', [db.profiles, db.changes], async () => {
      const row = typeof id === 'string' ? await db.profiles.get({ id }) : undefined;
      if (!row) throw noProfile(id);
      await db.profiles.update(row.seq, { name });
      await recordChange(db, { collection: 'profiles', id, updatedAt: now(), removed: false });
      return { id, name, createdAt: row.createdAt };
    });
  },

  inUse: async () => {
    const rows = await db.profiles.toArray();
    const chosen = chosenProfile(deviceStorage(), db.name);
    const row = rows.find((profile) => profile.id === chosen) ?? (rows.length === 1 ? rows[0] : undefined);
    return row ? profileOf(row) : undefined;
  },

  use: async (id) => {
    const row = typeof id === 'string' ? await db.profiles.get({ id }) : undefined;
    if (!row) throw noProfile(id);
    const storage = deviceStorage();
    try {
      if (!storage) throw new Error('The page has no localStorage.');
      chooseProfile(storage, db.name, id);
    } catch (error) {
      throw new Error('This device cannot keep which profile is in use.', { cause: error });
    }
    announceProfiles(db.name);
    return profileOf(row);
  },

  remove: async (id) => {
    await db.transaction('rw', [db.profiles, db.blueprints, db.runs, db.cardGames, db.changes], async () => {
      const row = typeof id === 'string' ? await db.profiles.get({ id }) : undefined;
      if (!row) return;
      const at = now();
      const removed = (collection: Change['collection'], ids: readonly string[]): Change[] =>
        ids.map((record) => ({ collection, id: record, profile: id, updatedAt: at, removed: true }));
      const owned = [
        ...removed('blueprints', await db.blueprints.where('profile').equals(id).primaryKeys()),
        ...removed('runs', (await db.runs.where('profile').equals(id).toArray()).map((run) => run.id)),
        ...removed('card-games', (await db.cardGames.where('profile').equals(id).toArray()).map((game) => game.id)),
      ];
      await db.blueprints.where('profile').equals(id).delete();
      await db.runs.where('profile').equals(id).delete();
      await db.cardGames.where('profile').equals(id).delete();
      await db.profiles.delete(row.seq);
      for (const change of owned) await recordChange(db, change);
      await recordChange(db, { collection: 'profiles', id, updatedAt: at, removed: true });
    });
    forgetProfileOnDevice(deviceStorage(), db.name, id);
    announceProfiles(db.name);
  },
});

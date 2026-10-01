// Child profiles under the one adult account on this device (docs/store.md, "Profiles"): an opaque id, the adult's name
// for the profile, and when it was made. Removing one removes everything it owns (D38); the parent view asks the adult
// first, and the app never removes anything on its own.
import type { ProfileId } from '@servo/schema';
import { recordChange } from './changes.ts';
import type { Change } from './changes.ts';
import { compareText, isName, refusal } from './context.ts';
import type { StoreContext } from './context.ts';
import type { ProfileRow } from './database.ts';
import type { Profile, Profiles } from './index.ts';
import { uuidV4 } from './uuid.ts';

const profileOf = ({ id, name, createdAt }: ProfileRow): Profile => ({ id, name, createdAt });

const checkName = (name: unknown): void => {
  if (!isName(name)) throw refusal('A profile name is 1 to 60 characters on one line, without spaces at either end.');
};

const noProfile = (id: ProfileId): Error => refusal(`There is no profile '${String(id)}' on this device.`);

export const profilesOf = ({ db, now }: StoreContext): Profiles => ({
  list: async () =>
    (await db.profiles.toArray()).sort((a, b) => compareText(a.createdAt, b.createdAt) || a.seq - b.seq).map(profileOf),

  create: async (name) => {
    checkName(name);
    const profile: Profile = { id: uuidV4(), name, createdAt: now() };
    await db.transaction('rw', [db.profiles, db.changes], async () => {
      await db.profiles.add({ ...profile });
      await recordChange(db, { collection: 'profiles', id: profile.id, updatedAt: profile.createdAt, removed: false });
    });
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
  },
});

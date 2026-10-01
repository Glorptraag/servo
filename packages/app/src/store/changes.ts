// The changes sync will push (task 5.5). Every write records one in its own transaction, so a change is never lost
// and never recorded for a write that failed. Until a remote is configured (D10, D13) they wait here, and 5.5 reads
// them with `pendingChanges` in the contract's SyncChange form. See docs/store.md, "Sync".
import type { ProfileId, Timestamp } from '@servo/schema';
import type { ChangeRow, ServoDatabase } from './database.ts';
import type { Profile, SyncChange, SyncCollection } from './index.ts';

export interface Change {
  readonly collection: SyncCollection;
  readonly id: string;
  /** The profile the record belongs to; absent for a profile itself. */
  readonly profile?: ProfileId;
  /** A blueprint's `meta.updatedAt`, or when the record was added, renamed or removed. */
  readonly updatedAt: Timestamp;
  readonly removed: boolean;
}

/** Records a change, replacing the record's earlier one. Call it inside the write's transaction. */
export const recordChange = async (db: ServoDatabase, change: Change): Promise<void> => {
  await db.changes.where('[collection+id]').equals([change.collection, change.id]).delete();
  await db.changes.add({ ...change });
};

const documentOf = async (db: ServoDatabase, { collection, id }: ChangeRow): Promise<unknown> => {
  switch (collection) {
    case 'profiles': {
      const row = await db.profiles.get({ id });
      return row ? ({ id: row.id, name: row.name, createdAt: row.createdAt } satisfies Profile) : undefined;
    }
    case 'blueprints': {
      const row = await db.blueprints.get(id);
      return row ? (JSON.parse(row.document) as unknown) : undefined;
    }
    case 'runs':
      return (await db.runs.get({ id }))?.record;
    case 'card-games':
      return (await db.cardGames.get({ id }))?.result;
  }
};

/**
 * Every change waiting for sync, oldest first, as SyncChange: each with its record as stored now (a blueprint as
 * `serializeBlueprint` wrote it, parsed), or with none when the record was removed.
 */
export const pendingChanges = (db: ServoDatabase): Promise<readonly SyncChange[]> =>
  db.transaction('r', [db.changes, db.profiles, db.blueprints, db.runs, db.cardGames], async () => {
    const pending: SyncChange[] = [];
    for (const change of await db.changes.orderBy('seq').toArray()) {
      const document = change.removed ? undefined : await documentOf(db, change);
      pending.push({
        collection: change.collection,
        id: change.id,
        ...(change.profile === undefined ? {} : { profile: change.profile }),
        updatedAt: change.updatedAt,
        ...(document === undefined ? {} : { document }),
      });
    }
    return pending;
  });

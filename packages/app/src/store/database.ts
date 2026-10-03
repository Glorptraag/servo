// The store's tables, on Dexie 4 over IndexedDB (docs/store.md). Dexie's versions cover the table layout only. A
// blueprint's own format version and its migrations stay in packages/schema (ground rule 5), so a stored blueprint is
// kept as the bytes it was written in, whatever version that was, and migrated each time it is read.
import { Dexie } from 'dexie';
import type { EntityTable, Table } from 'dexie';
import type { BlueprintId, ChallengeId, ProfileId, RunId, RunRecord, Timestamp } from '@servo/schema';
import type { TelemetryEvent } from '../telemetry/events.ts';
import type { CardGameResult, SyncCollection } from './index.ts';

/** The database's name when StoreOptions gives none. */
export const DATABASE_NAME = 'servo';

/** A child profile. `seq` is the order profiles were made in, for profiles made in the same millisecond. */
export interface ProfileRow {
  readonly seq: number;
  readonly id: ProfileId;
  readonly name: string;
  readonly createdAt: Timestamp;
}

/**
 * One saved build: the blueprint exactly as stored, under its `meta.id`, and the profile it belongs to. Nothing derived
 * from the blueprint is stored beside it (ground rule 5): a summary is read from `document` itself. A document from
 * another version of Servo is kept as it came, under the id its migration gives it. `keptFrom` is set only by sync's
 * conflict rule (task 5.5).
 */
export interface BlueprintRow {
  readonly id: BlueprintId;
  readonly profile: ProfileId;
  /** The bytes `serializeBlueprint` wrote: canonical form. */
  readonly document: string;
  readonly keptFrom?: BlueprintId;
}

/** One Run, kept as the schema's RunRecord. `blueprintId` and `challenge` are copied out of it only so it can be found by them. */
export interface RunRow {
  readonly seq: number;
  readonly id: RunId;
  readonly profile: ProfileId;
  readonly blueprintId: BlueprintId;
  readonly challenge?: ChallengeId;
  readonly record: RunRecord;
}

/** One finished round of the card game (D40). */
export interface CardGameRow {
  readonly seq: number;
  readonly id: string;
  readonly profile: ProfileId;
  readonly result: CardGameResult;
}

/**
 * A change sync will push (task 5.5): which record changed, when, and whether it was removed. A record has at most one,
 * its latest, and `seq` orders them. The record itself is read when the change is pushed (`pendingChanges`), so no
 * second copy of a blueprint is kept here.
 */
export interface ChangeRow {
  readonly seq: number;
  readonly collection: SyncCollection;
  readonly id: string;
  readonly profile?: ProfileId;
  readonly updatedAt: Timestamp;
  readonly removed: boolean;
}

/**
 * What sync keeps between syncs (task 5.5, src/sync/): the remote's cursor under `cursor`, and under
 * `blueprints/<id>` the `meta.updatedAt` of the version of each blueprint last sent to or taken from the remote.
 */
export interface SyncRow {
  readonly key: string;
  readonly value: string;
}

/**
 * One telemetry event (task 6.2, src/telemetry/), kept on this device for its child only. It never goes to `changes`,
 * so sync never sends it, and removing the profile removes it.
 */
export interface TelemetryRow {
  readonly seq: number;
  readonly profile: ProfileId;
  readonly event: TelemetryEvent;
}

export type ServoDatabase = Dexie & {
  readonly profiles: EntityTable<ProfileRow, 'seq'>;
  readonly blueprints: Table<BlueprintRow, BlueprintId>;
  readonly runs: EntityTable<RunRow, 'seq'>;
  readonly cardGames: EntityTable<CardGameRow, 'seq'>;
  readonly changes: EntityTable<ChangeRow, 'seq'>;
  readonly sync: Table<SyncRow, string>;
  readonly telemetry: EntityTable<TelemetryRow, 'seq'>;
};

/** Opens the database, creating it on first use. Rejects when the device's storage cannot be opened. */
export const openDatabase = async (name: string): Promise<ServoDatabase> => {
  const db = new Dexie(name) as ServoDatabase;
  db.version(1).stores({
    profiles: '++seq, &id',
    blueprints: 'id, profile',
    runs: '++seq, &id, profile, [profile+blueprintId], [profile+challenge]',
    cardGames: '++seq, &id, profile',
    changes: '++seq, &[collection+id]',
  });
  db.version(2).stores({ sync: 'key' });
  db.version(3).stores({ telemetry: '++seq, profile' });
  await db.open();
  return db;
};

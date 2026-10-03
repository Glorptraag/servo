// Shared by the sync tests, which run in Node on fake-indexeddb (each test file imports 'fake-indexeddb/auto' first).
// A device is a store on its own database, with its own clock and a network the test switches, syncing through a
// remote the test shares between devices.
import { loadContent } from '@servo/content';
import type { ContentLoad } from '@servo/content';
import type { Blueprint, BlueprintId, Timestamp } from '@servo/schema';
import type { BlueprintRow } from '../../src/store/database.ts';
import type { ProfileStore, ServoStore, SyncRemote } from '../../src/store/index.ts';
import { openStoreWith } from '../../src/store/open.ts';
import { manualNetwork } from '../../src/sync/index.ts';
import type { ManualNetwork, SyncOptions } from '../../src/sync/index.ts';
import { T0, clock, freshName, withDatabase } from '../store/support.ts';
import type { Clock } from '../store/support.ts';

export const content: ContentLoad = loadContent();

export interface Device {
  readonly store: ServoStore;
  readonly name: string;
  readonly clock: Clock;
  readonly network: ManualNetwork;
}

const opened: ServoStore[] = [];

/** Closes every device the test opened. */
export const closeDevices = (): void => {
  for (const store of opened.splice(0)) store.close();
};

/** A device on a database of its own, online, that syncs only when the test says (or on reconnect). */
export const openDevice = async (
  remote: SyncRemote | undefined,
  { start, content: load = content, ...more }: SyncOptions & { readonly start?: Timestamp; readonly content?: ContentLoad } = {},
): Promise<Device> => {
  const time = clock(start ?? T0);
  const network = manualNetwork(true);
  const name = freshName();
  const store = await openStoreWith(load, { name, now: time.now, ...(remote ? { remote } : {}) }, { network, syncOnOpen: false, ...more });
  opened.push(store);
  return { store, name, clock: time, network };
};

/** The one profile a device holds, as the child's records. */
export const onlyChild = async (device: Device): Promise<ProfileStore> => {
  const [profile, ...others] = await device.store.profiles.list();
  if (!profile || others.length > 0) throw new Error(`expected one profile, found ${others.length + (profile ? 1 : 0)}`);
  return device.store.forProfile(profile.id);
};

/** Every blueprint row a device holds, by id. */
export const blueprintRows = (device: Device): Promise<ReadonlyMap<BlueprintId, BlueprintRow>> =>
  withDatabase(device.name, async (db) => new Map((await db.blueprints.toArray()).map((row) => [row.id, row])));

/** A loaded build, or a thrown error naming why it did not load. */
export const loaded = async (child: ProfileStore, id: BlueprintId): Promise<Blueprint> => {
  const result = await child.blueprints.load(id);
  if (!result.ok) throw new Error(`did not load: ${result.issues.map((issue) => issue.code).join()}`);
  return result.blueprint;
};

/** A build's bytes but for its id and when it was saved: what tells two versions apart. */
export const contentOf = (blueprint: Blueprint): string => JSON.stringify({ ...blueprint, meta: { ...blueprint.meta, id: '', updatedAt: '' } });

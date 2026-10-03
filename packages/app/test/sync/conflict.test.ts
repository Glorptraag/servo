// The conflict fixture (fixtures/conflict.ts): one build changed on two devices while both were offline. Whichever
// reconnects first, every device and the remote end with both versions: the later at the build's id, the other as its
// own blueprint with `keptFrom` naming the build. Nothing is merged, nothing is dropped, and syncing again changes
// nothing more.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Blueprint, BlueprintId } from '@servo/schema';
import type { ProfileStore } from '../../src/store/index.ts';
import { memoryRemote } from '../../src/sync/index.ts';
import type { MemoryRemote } from '../../src/sync/index.ts';
import { UUID_V4 } from '../store/support.ts';
import { conflictFixture } from './fixtures/conflict.ts';
import type { OfflineEdit } from './fixtures/conflict.ts';
import { blueprintRows, closeDevices, contentOf, loaded, openDevice } from './support.ts';
import type { Device } from './support.ts';

afterEach(closeDevices);

interface Synced {
  readonly remote: MemoryRemote;
  readonly devices: Readonly<Record<OfflineEdit['device'], Device>>;
  readonly children: Readonly<Record<OfflineEdit['device'], ProfileStore>>;
  readonly build: Blueprint;
}

/** The fixture's build kept on the tablet, then synced to the laptop, which starts with nothing. */
const syncedToBoth = async (): Promise<Synced> => {
  const remote = memoryRemote();
  const tablet = await openDevice(remote, { start: conflictFixture.synced });
  const laptop = await openDevice(remote, { start: conflictFixture.synced });
  const profile = await tablet.store.profiles.create('Robin');
  const kept = await tablet.store.forProfile(profile.id).blueprints.copy(conflictFixture.start);
  if (!kept.ok) throw new Error('not kept');
  await tablet.store.sync.now();
  await laptop.store.sync.now();
  const children = { tablet: tablet.store.forProfile(profile.id), laptop: laptop.store.forProfile(profile.id) };
  expect(await laptop.store.profiles.list()).toEqual([profile]);
  expect(await loaded(children.laptop, kept.blueprint.meta.id)).toEqual(kept.blueprint);
  return { remote, devices: { tablet, laptop }, children, build: kept.blueprint };
};

/** Each device's edit, saved while it is offline. Returns each device's version as saved. */
const editOffline = async ({ devices, children, build, remote }: Synced): Promise<Record<OfflineEdit['device'], Blueprint>> => {
  const before = remote.log().length;
  devices.tablet.network.set(false);
  devices.laptop.network.set(false);
  const saved: Partial<Record<OfflineEdit['device'], Blueprint>> = {};
  for (const { device, at, edit } of conflictFixture.edits) {
    devices[device].clock.set(at);
    saved[device] = await children[device].blueprints.save(edit(await loaded(children[device], build.meta.id)));
    await devices[device].store.sync.now();
    expect(devices[device].store.sync.state).toBe('offline');
  }
  expect(remote.log()).toHaveLength(before);
  return saved as Record<OfflineEdit['device'], Blueprint>;
};

/** Each device in turn comes back online, which syncs it; then each syncs once more, as it would next time. */
const reconnect = async ({ devices }: Synced, order: readonly OfflineEdit['device'][]): Promise<void> => {
  for (const device of order) {
    devices[device].network.set(true);
    await devices[device].store.sync.now();
    expect(devices[device].store.sync.state).toBe('idle');
  }
  for (const device of order) await devices[device].store.sync.now();
};

const expectBothKept = async (synced: Synced, saved: Record<OfflineEdit['device'], Blueprint>): Promise<BlueprintId> => {
  const { id } = synced.build.meta;
  const earlier = conflictFixture.latest === 'laptop' ? 'tablet' : 'laptop';
  const copies = new Set<BlueprintId>();
  for (const device of ['tablet', 'laptop'] as const) {
    const child = synced.children[device];
    const list = await child.blueprints.list();
    expect(list).toHaveLength(2);
    const [atId, copy] = [list.find((entry) => entry.id === id), list.find((entry) => entry.id !== id)];
    // The later version keeps the id, exactly as its device saved it.
    expect(atId?.keptFrom).toBeUndefined();
    expect(await loaded(child, id)).toEqual(saved[conflictFixture.latest]);
    // The other is kept whole as its own blueprint: a fresh id, `keptFrom` naming the build, its time as saved.
    expect(copy?.id).toMatch(UUID_V4);
    expect(copy?.keptFrom).toBe(id);
    expect(copy?.updatedAt).toBe(saved[earlier].meta.updatedAt);
    const kept = await loaded(child, copy?.id as BlueprintId);
    expect(contentOf(kept)).toBe(contentOf(saved[earlier]));
    expect(kept.meta).toEqual({ ...saved[earlier].meta, id: copy?.id });
    copies.add(copy?.id as BlueprintId);
    const rows = await blueprintRows(synced.devices[device]);
    expect([...rows.values()].map((row) => row.keptFrom)).toEqual(expect.arrayContaining([undefined, id]));
  }
  // The same copy on both devices: one kept, not one per device.
  expect(copies.size).toBe(1);
  return [...copies][0] as BlueprintId;
};

describe('the conflict fixture', () => {
  for (const order of [
    ['tablet', 'laptop'],
    ['laptop', 'tablet'],
  ] as const) {
    it(`keeps both versions when the ${order[0]} reconnects first: the later at the id, the other as a copy`, async () => {
      const synced = await syncedToBoth();
      const saved = await editOffline(synced);
      await reconnect(synced, order);
      const copy = await expectBothKept(synced, saved);

      // The remote holds both too: a device that only now syncs for the first time gets both.
      const newcomer = await openDevice(synced.remote);
      await newcomer.store.sync.now();
      const child = newcomer.store.forProfile(synced.children.tablet.profile);
      expect((await child.blueprints.list()).map((entry) => [entry.id, entry.keptFrom])).toEqual(
        expect.arrayContaining([
          [synced.build.meta.id, undefined],
          [copy, synced.build.meta.id],
        ]),
      );
      expect(await child.blueprints.list()).toHaveLength(2);

      // Syncing again keeps nothing more and sends nothing more.
      const log = synced.remote.log().length;
      for (const device of order) await synced.devices[device].store.sync.now();
      for (const device of order) await synced.devices[device].store.sync.now();
      expect(synced.remote.log()).toHaveLength(log);
      for (const device of order) expect(await synced.children[device].blueprints.list()).toHaveLength(2);
    });
  }

  it('keeps the version already here at the id when both were saved at the same moment', async () => {
    const synced = await syncedToBoth();
    const { tablet, laptop } = synced.devices;
    tablet.network.set(false);
    laptop.network.set(false);
    const at = conflictFixture.edits[0].at;
    const saved: Record<string, Blueprint> = {};
    for (const { device, edit } of conflictFixture.edits) {
      synced.devices[device].clock.set(at);
      saved[device] = await synced.children[device].blueprints.save(edit(await loaded(synced.children[device], synced.build.meta.id)));
    }
    tablet.network.set(true);
    await tablet.store.sync.now();
    laptop.network.set(true);
    await laptop.store.sync.now();
    // The laptop met the tablet's version second: its own stays at the id, and the tablet's is kept as a copy.
    expect(await loaded(synced.children.laptop, synced.build.meta.id)).toEqual(saved.laptop);
    await tablet.store.sync.now();
    expect(await loaded(synced.children.tablet, synced.build.meta.id)).toEqual(saved.laptop);
    for (const child of Object.values(synced.children)) expect(await child.blueprints.list()).toHaveLength(2);
  });
});

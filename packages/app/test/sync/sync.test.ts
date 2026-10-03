// Sync through a remote (task 5.5), in Node on fake-indexeddb: when it syncs (on open, on now(), on reconnect), what
// it does offline and when the remote is unreachable or refuses, and how each kind of record travels between
// devices. The conflict fixture has its own file (conflict.test.ts).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Blueprint, RunRecord } from '@servo/schema';
import { exampleRunRecords, invalidBlueprints } from '@servo/schema/fixtures';
import type { SyncChange, SyncRemote, SyncState } from '../../src/store/index.ts';
import { RemoteUnreachable, applyPull, memoryRemote } from '../../src/sync/index.ts';
import { runOf, schemaContent, withDatabase, withMeta } from '../store/support.ts';
import { conflictFixture } from './fixtures/conflict.ts';
import { blueprintRows, closeDevices, content, contentOf, loaded, onlyChild, openDevice } from './support.ts';
import type { Device } from './support.ts';

afterEach(closeDevices);

const T1 = '2026-10-02T10:30:00.000Z';
const T2 = '2026-10-03T11:45:00.000Z';
const T3 = '2026-10-04T08:15:00.000Z';
const SOON = { timeout: 10_000, interval: 20 };

/** A device with one child, "Robin", who has kept the conflict fixture's build, synced to the remote. */
const firstDevice = async (remote: SyncRemote): Promise<{ device: Device; build: Blueprint }> => {
  const device = await openDevice(remote);
  const kid = device.store.forProfile((await device.store.profiles.create('Robin')).id);
  const kept = await kid.blueprints.copy(conflictFixture.start);
  if (!kept.ok) throw new Error('not kept');
  await device.store.sync.now();
  return { device, build: kept.blueprint };
};

const states = (device: Device): SyncState[] => {
  const seen: SyncState[] = [];
  device.store.sync.subscribe((state) => seen.push(state));
  return seen;
};

describe('when sync runs', () => {
  it('is local-only with no remote, as the app is until a host is chosen: now() resolves and nothing is sent', async () => {
    const device = await openDevice(undefined);
    expect(device.store.sync.state).toBe('local-only');
    await expect(device.store.sync.now()).resolves.toBeUndefined();
    device.network.set(false);
    device.network.set(true);
    expect(device.store.sync.state).toBe('local-only');
  });

  it('pulls, then pushes every waiting change, which then stops waiting; the states go syncing then idle', async () => {
    const remote = memoryRemote();
    const device = await openDevice(remote);
    const seen = states(device);
    expect(device.store.sync.state).toBe('idle');
    const robin = await device.store.profiles.create('Robin');
    const pull = vi.spyOn(remote, 'pull');
    await device.store.sync.now();
    expect(pull).toHaveBeenCalledWith(undefined);
    expect(remote.log()).toEqual([{ collection: 'profiles', id: robin.id, updatedAt: robin.createdAt, document: robin }]);
    expect(seen).toEqual(['syncing', 'idle']);
    // The cursor is where the remote was before the push, so the next pull brings the push back, and changes nothing.
    await device.store.sync.now();
    expect(pull).toHaveBeenLastCalledWith('0');
    await device.store.sync.now();
    expect(pull).toHaveBeenLastCalledWith('1');
    expect(remote.log()).toHaveLength(1);
    expect(await device.store.profiles.list()).toEqual([robin]);
  });

  it('syncs as the store opens when the device is online', async () => {
    const remote = memoryRemote();
    const { device } = await firstDevice(remote);
    const other = await openDevice(remote, { syncOnOpen: true });
    await vi.waitFor(async () => expect(await other.store.profiles.list()).toHaveLength(1), SOON);
    expect(await other.store.profiles.list()).toEqual(await device.store.profiles.list());
  });

  it('waits while offline, keeps every edit, and syncs on reconnect without being asked', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const pushed = remote.log().length;
    const push = vi.spyOn(remote, 'push');
    const pull = vi.spyOn(remote, 'pull');
    device.network.set(false);
    expect(device.store.sync.state).toBe('offline');
    const kid = await onlyChild(device);
    device.clock.set(T1);
    const saved = await kid.blueprints.save(withMeta(await loaded(kid, build.meta.id), { name: 'Rolling robot, offline' }));
    await expect(device.store.sync.now()).resolves.toBeUndefined();
    expect(device.store.sync.state).toBe('offline');
    expect(pull).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    device.network.set(true);
    await vi.waitFor(() => expect(remote.log()).toHaveLength(pushed + 1), SOON);
    await vi.waitFor(() => expect(device.store.sync.state).toBe('idle'), SOON);
    expect(remote.log().at(-1)).toMatchObject({ collection: 'blueprints', id: build.meta.id, updatedAt: T1, base: build.meta.updatedAt });
    expect(remote.log().at(-1)?.document).toEqual(JSON.parse(JSON.stringify(saved)));
  });

  it('counts an unreachable remote as offline, and syncs once it can be reached', async () => {
    const remote = memoryRemote();
    const device = await openDevice(remote);
    await device.store.profiles.create('Robin');
    remote.reachable = false;
    await expect(device.store.sync.now()).resolves.toBeUndefined();
    expect(device.store.sync.state).toBe('offline');
    remote.reachable = true;
    await device.store.sync.now();
    expect(device.store.sync.state).toBe('idle');
    expect(remote.log()).toHaveLength(1);
  });

  it('when the remote refuses: failed, now() rejects, nothing stops waiting, and it tries again by itself', async () => {
    const remote = memoryRemote();
    const device = await openDevice(remote);
    await device.store.profiles.create('Robin');
    const push = remote.push;
    let refusals = 1;
    remote.push = async (changes) => {
      if (refusals > 0) {
        refusals -= 1;
        throw new Error('The host answered 500.');
      }
      return push(changes);
    };
    await expect(device.store.sync.now()).rejects.toThrow(/500/);
    expect(device.store.sync.state).toBe('failed');
    expect(remote.log()).toHaveLength(0);
    // The first retry is 2 s later.
    await vi.waitFor(() => expect(device.store.sync.state).toBe('idle'), SOON);
    expect(remote.log()).toHaveLength(1);
  });

  it('runs one sync at a time: now() during a sync runs one more after it, for changes made meanwhile', async () => {
    const remote = memoryRemote();
    const device = await openDevice(remote);
    await device.store.profiles.create('Robin');
    const first = device.store.sync.now();
    await device.store.profiles.create('Sam');
    const second = device.store.sync.now();
    await Promise.all([first, second]);
    expect(remote.log().map((change) => (change.document as { name: string }).name)).toEqual(['Robin', 'Sam']);
  });
});

describe('what travels', () => {
  it('takes a newer version made from the one here as a plain update: no copy', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const other = await openDevice(remote);
    await other.store.sync.now();
    const kid = await onlyChild(device);
    device.clock.set(T1);
    const saved = await kid.blueprints.save(withMeta(await loaded(kid, build.meta.id), { name: 'Rolling robot, faster' }));
    device.clock.set(T2);
    const again = await kid.blueprints.save({ ...saved, wires: saved.wires.slice(1) });
    await device.store.sync.now();
    await other.store.sync.now();
    const theirs = await onlyChild(other);
    expect(await theirs.blueprints.list()).toEqual([{ id: build.meta.id, name: 'Rolling robot, faster', level: 1, updatedAt: T2 }]);
    expect(await loaded(theirs, build.meta.id)).toEqual(again);
  });

  it('never keeps a copy of its own version coming back, even when the build has changed here since', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const kid = await onlyChild(device);
    device.clock.set(T1);
    await kid.blueprints.save(withMeta(await loaded(kid, build.meta.id), { name: 'Rolling robot, one' }));
    await device.store.sync.now();
    device.clock.set(T2);
    const latest = await kid.blueprints.save(withMeta(await loaded(kid, build.meta.id), { name: 'Rolling robot, two' }));
    // The pull brings this device's own push of "one" back before "two" is pushed.
    await device.store.sync.now();
    await device.store.sync.now();
    expect(await kid.blueprints.list()).toHaveLength(1);
    expect(await loaded(kid, build.meta.id)).toEqual(latest);
  });

  it('keeps both when two devices pushed versions made from the same one, with no edit waiting here', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const laptop = await openDevice(remote);
    const phone = await openDevice(remote);
    await laptop.store.sync.now();
    await phone.store.sync.now();
    const cursor = String(remote.log().length);
    // Both push before either pulls the other's: the remote holds two versions made from the same one.
    const versions: Blueprint[] = [];
    for (const [other, at, name] of [
      [laptop, T1, 'Laptop robot'],
      [phone, T2, 'Phone robot'],
    ] as const) {
      const kid = await onlyChild(other);
      other.clock.set(at);
      versions.push(await kid.blueprints.save(withMeta(await loaded(kid, build.meta.id), { name })));
      vi.spyOn(remote, 'pull').mockResolvedValueOnce({ changes: [], cursor });
      await other.store.sync.now();
    }
    // The first device took neither yet. It takes the first as an update, then meets the second, made from the same
    // version: the later keeps the id, and the other is kept as a copy.
    await device.store.sync.now();
    const kid = await onlyChild(device);
    const list = await kid.blueprints.list();
    expect(list.map((entry) => [entry.name, entry.keptFrom])).toEqual([
      ['Phone robot', undefined],
      ['Laptop robot', build.meta.id],
    ]);
    expect(contentOf(await loaded(kid, build.meta.id))).toBe(contentOf(versions[1] as Blueprint));
  });

  it('removes a build removed elsewhere when it has not changed here', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const other = await openDevice(remote);
    await other.store.sync.now();
    await (await onlyChild(device)).blueprints.remove(build.meta.id);
    await device.store.sync.now();
    await other.store.sync.now();
    expect(await (await onlyChild(other)).blueprints.list()).toEqual([]);
  });

  it('keeps a build changed here while it was removed elsewhere, and gives it back to the remote', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const other = await openDevice(remote);
    await other.store.sync.now();
    other.network.set(false);
    const theirs = await onlyChild(other);
    other.clock.set(T1);
    const edited = await theirs.blueprints.save(withMeta(await loaded(theirs, build.meta.id), { name: 'Rolling robot, kept' }));
    await (await onlyChild(device)).blueprints.remove(build.meta.id);
    await device.store.sync.now();
    other.network.set(true);
    await other.store.sync.now();
    expect(await loaded(theirs, build.meta.id)).toEqual(edited);
    await device.store.sync.now();
    expect(await loaded(await onlyChild(device), build.meta.id)).toEqual(edited);
  });

  it('takes work done elsewhere over a removal here that was not pushed yet', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const other = await openDevice(remote);
    await other.store.sync.now();
    const theirs = await onlyChild(other);
    other.clock.set(T1);
    const edited = await theirs.blueprints.save(withMeta(await loaded(theirs, build.meta.id), { name: 'Rolling robot, kept' }));
    await other.store.sync.now();
    device.network.set(false);
    await (await onlyChild(device)).blueprints.remove(build.meta.id);
    device.network.set(true);
    await device.store.sync.now();
    expect(await loaded(await onlyChild(device), build.meta.id)).toEqual(edited);
  });

  it('carries profiles, renames (the later wins), runs and card-game results, which are only ever added', async () => {
    const remote = memoryRemote();
    const tablet = await openDevice(remote, { content: schemaContent });
    const laptop = await openDevice(remote, { content: schemaContent });
    const robin = await tablet.store.profiles.create('Robin');
    const kid = tablet.store.forProfile(robin.id);
    const template = exampleRunRecords[0]?.data as RunRecord;
    const kept = await kid.blueprints.copy(template.blueprint);
    if (!kept.ok) throw new Error('not kept');
    const run = runOf(template, kept.blueprint, { id: crypto.randomUUID(), profile: robin.id });
    await kid.runs.add(run);
    const round = await kid.cardGames.add([{ part: 'caster', named: true }]);
    await tablet.store.sync.now();
    await laptop.store.sync.now();
    const theirs = laptop.store.forProfile(robin.id);
    expect(await laptop.store.profiles.list()).toEqual([robin]);
    expect(await theirs.runs.list()).toEqual([run]);
    expect(await theirs.cardGames.list()).toEqual([round]);

    // Renamed on both while apart: the later name stands on both.
    tablet.clock.set(T2);
    await tablet.store.profiles.rename(robin.id, 'Robin T');
    laptop.clock.set(T1);
    await laptop.store.profiles.rename(robin.id, 'Robin L');
    await laptop.store.sync.now();
    await tablet.store.sync.now();
    await laptop.store.sync.now();
    expect((await tablet.store.profiles.list()).map((profile) => profile.name)).toEqual(['Robin T']);
    expect((await laptop.store.profiles.list()).map((profile) => profile.name)).toEqual(['Robin T']);
    // Taking the same records again adds nothing.
    await laptop.store.sync.now();
    expect(await theirs.runs.list()).toHaveLength(1);
    expect(await theirs.cardGames.list()).toHaveLength(1);
  });

  it('removes a profile removed elsewhere, unless a build was changed in it here meanwhile', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const plain = await openDevice(remote);
    const busy = await openDevice(remote);
    await plain.store.sync.now();
    await busy.store.sync.now();
    busy.network.set(false);
    const theirs = await onlyChild(busy);
    busy.clock.set(T3);
    await theirs.blueprints.save(withMeta(await loaded(theirs, build.meta.id), { name: 'Rolling robot, offline' }));
    await device.store.profiles.remove(theirs.profile);
    await device.store.sync.now();
    await plain.store.sync.now();
    expect(await plain.store.profiles.list()).toEqual([]);
    expect((await blueprintRows(plain)).size).toBe(0);
    busy.network.set(true);
    await busy.store.sync.now();
    expect(await busy.store.profiles.list()).toHaveLength(1);
    expect((await theirs.blueprints.list()).map((entry) => entry.name)).toEqual(['Rolling robot, offline']);
  });

  it('keeps a version from a newer Servo as it came when it loses the id, and never overwrites it with nothing kept', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const kid = await onlyChild(device);
    const newer = invalidBlueprints.find((fixture) => fixture.name === 'version-2')?.data as { readonly meta: Record<string, unknown> };
    const theirs = { ...newer, meta: { ...newer.meta, id: build.meta.id, updatedAt: T1 } };
    device.clock.set(T2);
    const mine = await kid.blueprints.save(withMeta(await loaded(kid, build.meta.id), { name: 'Rolling robot, here' }));
    // Another device on a newer version of Servo pushed its version of the build, made from the one synced.
    await remote.push([
      { collection: 'blueprints', id: build.meta.id, profile: kid.profile, updatedAt: T1, base: build.meta.updatedAt, document: theirs } satisfies SyncChange,
    ]);
    await device.store.sync.now();
    const list = await kid.blueprints.list();
    expect(list).toHaveLength(2);
    expect(await loaded(kid, build.meta.id)).toEqual(mine);
    const copy = list.find((entry) => entry.id !== build.meta.id);
    expect(copy?.keptFrom).toBe(build.meta.id);
    const rows = await blueprintRows(device);
    expect(JSON.parse(rows.get(copy?.id as string)?.document ?? 'null')).toEqual({ ...theirs, meta: { ...theirs.meta, id: copy?.id } });
    const reloaded = await kid.blueprints.load(copy?.id as string);
    expect(reloaded.ok).toBe(false);
  });

  it('leaves alone a change it cannot read, and a record for a profile this device does not hold', async () => {
    const remote = memoryRemote();
    const { device } = await firstDevice(remote);
    const before = await blueprintRows(device);
    await remote.push([
      { collection: 'nonsense', id: 'x', updatedAt: T1 } as unknown as SyncChange,
      { collection: 'blueprints', id: 'y', profile: 'not-here', updatedAt: T1, document: conflictFixture.start },
    ]);
    await device.store.sync.now();
    expect(device.store.sync.state).toBe('idle');
    expect(await blueprintRows(device)).toEqual(before);
  });

  it('changes nothing more when the same pull is taken again', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const other = await openDevice(remote);
    await other.store.sync.now();
    other.network.set(false);
    const theirs = await onlyChild(other);
    other.clock.set(T2);
    await theirs.blueprints.save(withMeta(await loaded(theirs, build.meta.id), { name: 'Rolling robot, there' }));
    const kid = await onlyChild(device);
    device.clock.set(T1);
    await kid.blueprints.save(withMeta(await loaded(kid, build.meta.id), { name: 'Rolling robot, here' }));
    await device.store.sync.now();
    const cursor = await withDatabase(other.name, async (db) => (await db.sync.get('cursor'))?.value);
    other.network.set(true);
    await other.store.sync.now();
    const rows = await blueprintRows(other);
    expect(rows.size).toBe(2);
    // The pull the reconnect took, taken again, as a device that stopped after applying it would.
    const pull = await remote.pull(cursor);
    const again = await withDatabase(other.name, (db) => applyPull({ db, content: content.content, now: other.clock.now }, pull));
    expect(again).toEqual([]);
    expect(await blueprintRows(other)).toEqual(rows);
  });

  it('keeps one copy, not one per version, when a device that edited offline misses many saves made elsewhere', async () => {
    const remote = memoryRemote();
    const { device, build } = await firstDevice(remote);
    const other = await openDevice(remote);
    await other.store.sync.now();
    other.network.set(false);
    const theirs = await onlyChild(other);
    other.clock.set(T1);
    const offline = await theirs.blueprints.save(withMeta(await loaded(theirs, build.meta.id), { name: 'Rolling robot, offline' }));
    const kid = await onlyChild(device);
    let latest = build;
    for (let minute = 10; minute < 20; minute += 1) {
      device.clock.set(`2026-10-02T11:${minute}:00.000Z`);
      latest = await kid.blueprints.save(withMeta(latest, { name: `Rolling robot ${minute}` }));
      await device.store.sync.now();
    }
    other.network.set(true);
    await other.store.sync.now();
    const list = await theirs.blueprints.list();
    expect(list.map((entry) => [entry.name, entry.keptFrom])).toEqual([
      ['Rolling robot 19', undefined],
      ['Rolling robot, offline', build.meta.id],
    ]);
    expect(contentOf(await loaded(theirs, list[1]?.id as string))).toBe(contentOf(offline));
    // And the first device takes the copy, nothing else.
    await device.store.sync.now();
    expect((await kid.blueprints.list()).map((entry) => entry.name)).toEqual(['Rolling robot 19', 'Rolling robot, offline']);
  });
});

describe('the remote errors sync knows', () => {
  it('names an unreachable remote', () => {
    expect(new RemoteUnreachable('x')).toBeInstanceOf(Error);
    expect(new RemoteUnreachable('x').name).toBe('RemoteUnreachable');
  });
});

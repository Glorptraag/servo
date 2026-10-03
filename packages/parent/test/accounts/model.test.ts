// The adult account and child profiles (task 5.1), in Node on fake-indexeddb with an in-memory localStorage: the
// profile switch isolates each child's builds, and no query the accounts make, or a stale one, reaches another child.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '@servo/app/store';
import type { ServoStore } from '@servo/app/store';
import type { Blueprint, RunRecord } from '@servo/schema';
import { exampleRunRecords } from '@servo/schema/fixtures';
import { NameRefused, addChild, nameOf, readAccounts, removeChild, renameChild, switchChild } from '../../src/accounts/index.ts';
import { answers, gateQuestion } from '../../src/accounts/gate.ts';
import { databaseOf, memoryStorage, open, plainFloor } from './support.ts';

const GHOST = '9b2e4c1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c';
const runTemplate = exampleRunRecords[0]?.data as RunRecord;

/** A quiet sandbox Run of `blueprint`: nothing happened, and nothing was wrong. */
const sandboxRun = (blueprint: Blueprint, profile: string): RunRecord => {
  const { version, seed, tickRate, startedAt, endedAt, ticks } = runTemplate;
  const id = crypto.randomUUID();
  return { version, id, blueprintId: blueprint.meta.id, blueprint, profile, seed, tickRate, startedAt, endedAt, runNumber: 1, ticks, inputs: [], faults: [], fixed: [], hints: [] };
};

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Two children, each with builds of their own, and Robin with a Run and a card-game round. */
const family = async (store: ServoStore) => {
  const robin = await addChild(store, 'Robin');
  const sam = await addChild(store, 'Sam');
  const robins = store.forProfile(robin.id);
  const sams = store.forProfile(sam.id);
  const rocket = await robins.blueprints.create(plainFloor('Robin rocket'));
  const sorter = await sams.blueprints.create(plainFloor('Sam sorter'));
  return { robin, sam, robins, sams, rocket, sorter };
};

describe('names', () => {
  it('keeps what the store keeps: one line, 1 to 60 characters, spaces tidied', () => {
    expect(nameOf('  Robin   Lee \n')).toBe('Robin Lee');
    expect(nameOf('x'.repeat(60))).toHaveLength(60);
    for (const text of ['', '   ', 'x'.repeat(61), 'Ro\u0007bin']) expect(nameOf(text), JSON.stringify(text)).toBeUndefined();
  });
});

describe('the parental gate (D28)', () => {
  it('asks a short sum and takes only its answer', () => {
    const low = gateQuestion(() => 0);
    const high = gateQuestion(() => 0.999999);
    expect(low).toEqual({ text: 'What is 6 × 12?', answer: 72 });
    expect(high).toEqual({ text: 'What is 9 × 19?', answer: 171 });
    expect(answers(low, ' 72 ')).toBe(true);
    for (const text of ['', '71', '72.0', '7 2', '-72', '0x48']) expect(answers(low, text), text).toBe(false);
  });
});

describe('the accounts', () => {
  it('lists the children, adds and renames them, and keeps the child in use when another is added', async () => {
    const store = await open();
    expect(await readAccounts(store)).toEqual({ profiles: [], builds: [] });
    const robin = await addChild(store, ' Robin ');
    expect(robin.name).toBe('Robin');
    expect((await readAccounts(store)).current).toEqual(robin);
    // Robin was in use as the only child; adding Sam leaves Robin in use, so Robin's app keeps saving.
    const sam = await addChild(store, 'Sam');
    const accounts = await readAccounts(store);
    expect(accounts.profiles.map((profile) => profile.name)).toEqual(['Robin', 'Sam']);
    expect(accounts.current).toEqual(robin);
    expect(await renameChild(store, sam.id, 'Samira')).toMatchObject({ id: sam.id, name: 'Samira' });
    await expect(addChild(store, '   ')).rejects.toBeInstanceOf(NameRefused);
    await expect(renameChild(store, robin.id, 'x'.repeat(61))).rejects.toBeInstanceOf(NameRefused);
    // Names are child-entered text: the id the store gives never carries one.
    for (const profile of (await readAccounts(store)).profiles) expect(profile.id).not.toContain(profile.name.toLowerCase());
    store.close();
  });

  it('switches the child in use, and shows only that child’s builds', async () => {
    const store = await open();
    const { robin, sam, rocket, sorter } = await family(store);
    let accounts = await readAccounts(store);
    expect(accounts.current?.id).toBe(robin.id);
    expect(accounts.builds.map((build) => build.id)).toEqual([rocket.meta.id]);

    await switchChild(store, sam.id);
    accounts = await readAccounts(store);
    expect(accounts.current?.id).toBe(sam.id);
    expect(accounts.builds.map((build) => build.id)).toEqual([sorter.meta.id]);
    expect(JSON.stringify(accounts.builds)).not.toContain(rocket.meta.id);
    expect(JSON.stringify(accounts.builds)).not.toContain('Robin rocket');

    await switchChild(store, robin.id);
    expect((await readAccounts(store)).builds.map((build) => build.name)).toEqual(['Robin rocket']);
    store.close();
  });

  it('refuses to switch to a child who is not on the device, and keeps the child in use', async () => {
    const store = await open();
    const { robin, sam } = await family(store);
    await expect(switchChild(store, GHOST)).rejects.toThrow(/no profile/);
    await removeChild(store, sam.id);
    await expect(switchChild(store, sam.id)).rejects.toThrow(/no profile/);
    expect((await readAccounts(store)).current?.id).toBe(robin.id);
    store.close();
  });

  it('lets no child’s scope read or write another child’s records', async () => {
    const store = await open();
    const { robins, sams, rocket, sorter } = await family(store);
    const run = sandboxRun(rocket, robins.profile);
    await robins.runs.add(run);
    const round = await robins.cardGames.add([{ part: store.content.parts[0]?.id ?? '', named: true }]);

    expect((await sams.blueprints.list()).map((build) => build.id)).toEqual([sorter.meta.id]);
    await expect(sams.blueprints.load(rocket.meta.id)).rejects.toThrow();
    await expect(sams.blueprints.duplicate(rocket.meta.id, 'Mine')).rejects.toThrow();
    await expect(sams.blueprints.save(rocket)).rejects.toThrow();
    await expect(sams.blueprints.save({ ...rocket, meta: { ...rocket.meta, author: sams.profile } })).rejects.toThrow();
    await sams.blueprints.remove(rocket.meta.id);
    expect((await robins.blueprints.load(rocket.meta.id)).ok).toBe(true);
    expect(await sams.runs.list()).toEqual([]);
    expect(await sams.runs.get(run.id)).toBeUndefined();
    await expect(sams.runs.add(run)).rejects.toThrow();
    expect(await sams.cardGames.list()).toEqual([]);
    expect(await sams.cardGames.latest()).toBeUndefined();
    expect((await robins.cardGames.latest())?.id).toBe(round.id);
    store.close();
  });

  it('removes a child with everything of theirs, the builds the journal noted for them included, and no one else’s', async () => {
    const store = await open();
    const { robin, sam, robins, sams, rocket, sorter } = await family(store);
    await switchChild(store, sam.id);
    const note = (profile: string, page: string) => [`servo.unsaved:${databaseOf(store)}:${page}:${profile} b`, JSON.stringify({ profile, build: rocket })] as const;
    const robinsNote = note(robin.id, 'p1');
    const samsNote = note(sam.id, 'p2');
    storage.setItem(...robinsNote);
    storage.setItem(...samsNote);

    await removeChild(store, robin.id);
    const accounts = await readAccounts(store);
    expect(accounts.profiles.map((profile) => profile.name)).toEqual(['Sam']);
    expect(accounts.current?.id).toBe(sam.id);
    expect(await robins.blueprints.list()).toEqual([]);
    await expect(robins.blueprints.load(rocket.meta.id)).rejects.toThrow();
    await expect(robins.blueprints.create(plainFloor('Late'))).rejects.toThrow(/no profile/);
    expect(storage.getItem(robinsNote[0])).toBeNull();
    expect(storage.getItem(samsNote[0])).toBe(samsNote[1]);
    expect((await sams.blueprints.list()).map((build) => build.id)).toEqual([sorter.meta.id]);

    // Removing the child in use leaves no one chosen; with one child left, that child is in use.
    await addChild(store, 'Ari');
    await removeChild(store, sam.id);
    expect((await readAccounts(store)).current?.name).toBe('Ari');
    store.close();
  });

  it('never chooses a child on a store of another name', async () => {
    const first = await open();
    const second = await open();
    const { sam } = await family(first);
    await switchChild(first, sam.id);
    await second.profiles.create('Robin');
    await second.profiles.create('Sam');
    expect((await readAccounts(second)).current).toBeUndefined();
    first.close();
    second.close();
  });
});

describe('a device whose page keeps nothing', () => {
  it('cannot switch, and then uses only a lone child', async () => {
    vi.stubGlobal('localStorage', undefined);
    const store = await openStore({ name: `servo-parent-${crypto.randomUUID()}` });
    const robin = await addChild(store, 'Robin');
    await expect(switchChild(store, robin.id)).rejects.toThrow(/cannot keep/);
    expect((await readAccounts(store)).current?.id).toBe(robin.id);
    await addChild(store, 'Sam');
    const accounts = await readAccounts(store);
    expect(accounts.current).toBeUndefined();
    expect(accounts.builds).toEqual([]);
    store.close();
  });
});

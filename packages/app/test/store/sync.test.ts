// The sync seam (task 4.9; task 5.5 syncs). With no remote the store is local-only (D10, D13), and every write records
// its change, one per record, which `pendingChanges` gives back in the contract's SyncChange form for 5.5 to push.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, RunRecord } from '@servo/schema';
import { exampleRunRecords } from '@servo/schema/fixtures';
import { pendingChanges } from '../../src/store/changes.ts';
import type { SyncRemote } from '../../src/store/index.ts';
import { T0, openFor, runOf, schemaContent, withDatabase, withMeta } from './support.ts';

const T1 = '2026-10-02T10:30:00.000Z';
const T2 = '2026-10-03T11:45:00.000Z';

describe('sync', () => {
  it('is local-only by default: now() resolves at once, and nothing is ever sent', async () => {
    const { store } = await openFor(schemaContent);
    expect(store.sync.state).toBe('local-only');
    await expect(store.sync.now()).resolves.toBeUndefined();
    const listener = vi.fn();
    const unsubscribe = store.sync.subscribe(listener);
    expect(unsubscribe).toBeTypeOf('function');
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    store.close();
  });

  it('takes a remote through the seam, and leaves syncing with it to task 5.5', async () => {
    const remote: SyncRemote = { pull: vi.fn(), push: vi.fn() };
    const { store } = await openFor(schemaContent, { remote });
    expect(store.sync.state).toBe('idle');
    await expect(store.sync.now()).rejects.toThrow(/task 5\.5/);
    expect(remote.pull).not.toHaveBeenCalled();
    expect(remote.push).not.toHaveBeenCalled();
    store.close();
  });

  it('records every change as a SyncChange, the latest one per record, with the record as stored now', async () => {
    const { store, name, clock } = await openFor(schemaContent);
    const robin = await store.profiles.create('Robin');
    const kid = store.forProfile(robin.id);
    const kept = await kid.blueprints.copy((exampleRunRecords[0]?.data as RunRecord).blueprint);
    if (!kept.ok) throw new Error('not kept');
    clock.set(T1);
    const saved = await kid.blueprints.save(withMeta(kept.blueprint, { name: 'Fast one' }));
    const twin = await kid.blueprints.duplicate(saved.meta.id, 'Fast two');
    const run = runOf(exampleRunRecords[0]?.data as RunRecord, saved, { id: crypto.randomUUID(), profile: robin.id });
    await kid.runs.add(run);
    const round = await kid.cardGames.add([{ part: 'caster', named: true }]);
    clock.set(T2);
    await store.profiles.rename(robin.id, 'Robin B');
    await kid.blueprints.remove(twin.meta.id);

    const parsed = (blueprint: Blueprint): unknown => JSON.parse(serializeBlueprint(blueprint));
    const pending = await withDatabase(name, (db) => pendingChanges(db));
    expect(pending).toEqual([
      { collection: 'blueprints', id: saved.meta.id, profile: robin.id, updatedAt: T1, document: parsed(saved) },
      { collection: 'runs', id: run.id, profile: robin.id, updatedAt: T1, document: run },
      { collection: 'card-games', id: round.id, profile: robin.id, updatedAt: T1, document: round },
      { collection: 'profiles', id: robin.id, updatedAt: T2, document: { id: robin.id, name: 'Robin B', createdAt: T0 } },
      { collection: 'blueprints', id: twin.meta.id, profile: robin.id, updatedAt: T2 },
    ]);

    await store.profiles.remove(robin.id);
    const removed = await withDatabase(name, (db) => pendingChanges(db));
    expect(removed).toEqual([
      { collection: 'blueprints', id: twin.meta.id, profile: robin.id, updatedAt: T2 },
      { collection: 'blueprints', id: saved.meta.id, profile: robin.id, updatedAt: T2 },
      { collection: 'runs', id: run.id, profile: robin.id, updatedAt: T2 },
      { collection: 'card-games', id: round.id, profile: robin.id, updatedAt: T2 },
      { collection: 'profiles', id: robin.id, updatedAt: T2 },
    ]);
    store.close();
  });

  it('records nothing for a write that is refused', async () => {
    const { store, name } = await openFor(schemaContent);
    const kid = store.forProfile((await store.profiles.create('Robin')).id);
    const before = await withDatabase(name, (db) => pendingChanges(db));
    await expect(kid.blueprints.create({ name: 'Nowhere', level: 1, arena: { preset: 'the-moon', props: [] } })).rejects.toThrow();
    await expect(kid.cardGames.add([])).rejects.toThrow();
    await expect(store.profiles.create('')).rejects.toThrow();
    expect(await withDatabase(name, (db) => pendingChanges(db))).toEqual(before);
    store.close();
  });
});

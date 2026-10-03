// Reading one child's progress from the store (task 5.2), in Node on fake-indexeddb: through that child's scope only,
// with real sim-core Runs kept as the app keeps them, so the figures are the model's of exactly that child's records.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileId, RunRecord } from '@servo/schema';
import { progressOf, readProgress } from '../../src/index.ts';
import { memoryStorage, open } from '../accounts/support.ts';
import { reconcile } from './reconcile.ts';
import { fixture, planOf, runAll, without } from './runs.ts';

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

const spinner = fixture('broken-reversed-motor');
const owned = (runs: readonly RunRecord[], profile: ProfileId): RunRecord[] => runs.map((run) => ({ ...run, profile }));

describe('readProgress', () => {
  it("reads the child's own Runs and rounds, and none of another child's", async () => {
    const store = await open();
    const robin = await store.profiles.create('Robin');
    const sam = await store.profiles.create('Sam');
    const robinRuns = owned(await runAll([planOf(spinner), { ...planOf(spinner), blueprint: without(spinner.blueprint, 'motor-right') }]), robin.id);
    const samRuns = owned(await runAll([planOf(fixture('level-1-roller'))], 10), sam.id);
    for (const run of robinRuns) await store.forProfile(robin.id).runs.add(run);
    for (const run of samRuns) await store.forProfile(sam.id).runs.add(run);
    await store.forProfile(sam.id).cardGames.add([{ part: 'dc-motor', named: true }]);

    const read = await readProgress(store, robin.id);
    const stored = await store.forProfile(robin.id).runs.list();
    expect(read?.runs).toBe(2);
    expect(read?.progress).toEqual(progressOf({ runs: stored, content: store.content, cardGames: [] }));
    reconcile(stored, store.content, read?.progress ?? progressOf({ runs: [], content: store.content, cardGames: [] }));
    expect(read?.progress.faultsFixed).toHaveLength(1);
    expect(read?.progress.partsNamed).toBeUndefined();
    const samRead = await readProgress(store, sam.id);
    expect(samRead?.runs).toBe(1);
    expect(samRead?.progress.faultsFixed).toEqual([]);
    expect(samRead?.progress.partsNamed).toMatchObject({ named: 1, of: 1 });
    store.close();
  }, 600_000);

  it('gives nothing for a profile not on this device, and leaves out a record naming another profile', async () => {
    const store = await open();
    const robin = await store.profiles.create('Robin');
    expect(await readProgress(store, '9b2e4c1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c')).toBeUndefined();
    const [run] = await runAll([planOf(fixture('level-1-roller'))]);
    const stray = { ...(run as RunRecord), profile: '9b2e4c1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c' };
    // A scope that hands back a stray record, as a store a sync left a removed profile's Runs in might (R-5.5).
    const leaky = new Proxy(store, {
      get: (target, key) =>
        key === 'forProfile'
          ? (profile: ProfileId) => {
              const scope = target.forProfile(profile);
              return { ...scope, runs: { ...scope.runs, list: async () => [stray] } };
            }
          : Reflect.get(target, key),
    });
    const read = await readProgress(leaky, robin.id);
    expect(read).toEqual({ runs: 0, progress: { partsMet: [], unscriptedBuildsPassed: [], faultsFixed: [] } });
    store.close();
  }, 600_000);
});

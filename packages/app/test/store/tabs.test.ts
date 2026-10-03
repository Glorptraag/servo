// Two tabs on one device (task 4.9, review R-4.9 findings 2 and 6): two store connections to one database, as two tabs
// have. When both save one build, the later save keeps the id and the other version is kept as its own blueprint
// (`keptFrom`), as sync's conflict rule does between devices: both kept, never merged, never dropped. And two tabs
// opening the app at once make one first profile and one first build, with no Web Locks.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import { keptCopyOf } from '../../src/store/blueprints.ts';
import { pendingChanges } from '../../src/store/changes.ts';
import { buildForOpening, openStoreWith, profilesForOpening } from '../../src/store/open.ts';
import type { ServoStore } from '../../src/store/index.ts';
import { T0, clock, openFor, schemaContent, storedDocument, withDatabase, withMeta } from './support.ts';

const T1 = '2026-10-02T10:30:00.000Z';
const T2 = '2026-10-03T11:45:00.000Z';
const T3 = '2026-10-04T12:00:00.000Z';
const led = validBlueprints.find((fixture) => fixture.name === 'led-circuit')?.data as Blueprint;

/** The same build with another name, as a tab's edit leaves it. */
const renamed = (blueprint: Blueprint, name: string): Blueprint => withMeta(blueprint, { name });

/** Two tabs on one database: each its own connection and clock, both with the one child's records. */
const twoTabs = async () => {
  const first = await openFor(schemaContent);
  const profile = (await first.store.profiles.create('Robin')).id;
  const otherClock = clock(T0);
  const other: ServoStore = await openStoreWith(schemaContent, { name: first.name, now: otherClock.now });
  const kept = await first.store.forProfile(profile).blueprints.copy(led);
  if (!kept.ok) throw new Error('not kept');
  return {
    name: first.name,
    build: kept.blueprint,
    a: { kid: first.store.forProfile(profile), clock: first.clock },
    b: { kid: other.forProfile(profile), clock: otherClock },
    close: () => {
      first.store.close();
      other.close();
    },
  };
};

describe('two tabs saving one build', () => {
  it('keeps both: the later save keeps the id, and the version it would have replaced is kept as its own blueprint', async () => {
    const { name, build, a, b, close } = await twoTabs();
    // Both tabs open the build as stored.
    const inA = await a.kid.blueprints.load(build.meta.id);
    const inB = await b.kid.blueprints.load(build.meta.id);
    if (!inA.ok || !inB.ok) throw new Error('not loaded');

    a.clock.set(T1);
    const savedA = await a.kid.blueprints.save(renamed(inA.blueprint, 'Tab A'));
    expect(keptCopyOf(savedA)).toBeUndefined();

    // Tab B saves from the version it opened, which tab A has since replaced.
    b.clock.set(T2);
    const savedB = await b.kid.blueprints.save(renamed(inB.blueprint, 'Tab B'));
    expect(savedB.meta).toMatchObject({ id: build.meta.id, name: 'Tab B', updatedAt: T2 });
    const copy = keptCopyOf(savedB);
    expect(copy).toMatchObject({ name: 'Tab A', updatedAt: T1, keptFrom: build.meta.id });
    expect(copy?.id).not.toBe(build.meta.id);
    expect(await storedDocument(name, build.meta.id)).toBe(serializeBlueprint(savedB));
    expect(await storedDocument(name, copy?.id ?? '')).toBe(serializeBlueprint(withMeta(savedA, { id: copy?.id ?? '' })));
    // Both tabs see both builds; the copy says which it was kept from.
    for (const kid of [a.kid, b.kid]) {
      expect((await kid.blueprints.list()).map(({ name: built, keptFrom }) => ({ built, keptFrom }))).toEqual([
        { built: 'Tab B', keptFrom: undefined },
        { built: 'Tab A', keptFrom: build.meta.id },
      ]);
    }

    // Tab A saves again, from its own last save: tab B's version is kept in turn. Nothing is dropped.
    a.clock.set(T3);
    const again = await a.kid.blueprints.save(renamed(savedA, 'Tab A again'));
    expect(keptCopyOf(again)).toMatchObject({ name: 'Tab B', keptFrom: build.meta.id });
    expect((await b.kid.blueprints.list()).map((summary) => summary.name)).toEqual(['Tab A again', 'Tab B', 'Tab A']);
    // Sync will push the build and both copies.
    const pending = await withDatabase(name, (db) => pendingChanges(db));
    expect(pending.filter((change) => change.collection === 'blueprints' && change.document !== undefined)).toHaveLength(3);
    close();
  });

  it('keeps no copy when nothing would be lost', async () => {
    const { build, a, b, close } = await twoTabs();
    // One tab saving one edit after another, each from the save before it.
    a.clock.set(T1);
    const first = await a.kid.blueprints.save(renamed(build, 'One'));
    a.clock.set(T2);
    const second = await a.kid.blueprints.save(renamed(first, 'Two'));
    expect([keptCopyOf(first), keptCopyOf(second)]).toEqual([undefined, undefined]);
    // A tab saving from an old version a build that is the same as the stored one, but for its time.
    b.clock.set(T3);
    const same = await b.kid.blueprints.save(renamed(build, 'Two'));
    expect(keptCopyOf(same)).toBeUndefined();
    expect((await a.kid.blueprints.list()).map((summary) => summary.name)).toEqual(['Two']);
    close();
  });

  it('stamps each save later than the version it replaces, even when a tab’s clock is behind', async () => {
    const { build, a, b, close } = await twoTabs();
    a.clock.set(T2);
    const ahead = await a.kid.blueprints.save(renamed(build, 'Ahead'));
    // Tab B's clock is a day behind, and it saves from the version tab A saved.
    b.clock.set(T1);
    const behind = await b.kid.blueprints.save(renamed(ahead, 'Behind'));
    expect(behind.meta.updatedAt).toBe('2026-10-03T11:45:00.001Z');
    expect(keptCopyOf(behind)).toBeUndefined();
    close();
  });
});

describe('two tabs opening the app at once', () => {
  it('make one first profile and one first build, in one transaction each, using no Web Locks', async () => {
    const first = await openFor(schemaContent);
    const other = await openStoreWith(schemaContent, { name: first.name, now: first.clock.now });
    const [inFirst, inOther] = await Promise.all([profilesForOpening(first.store, 'Builder 1'), profilesForOpening(other, 'Builder 1')]);
    expect(inFirst.map((profile) => profile.name)).toEqual(['Builder 1']);
    expect(inOther).toEqual(inFirst);
    const profile = inFirst[0]?.id ?? '';
    const init = { name: 'Build 1', level: 1, arena: { preset: 'open-floor', props: [] } } as const;
    const [buildFirst, buildOther] = await Promise.all([buildForOpening(first.store, profile, init), buildForOpening(other, profile, init)]);
    expect(buildOther).toEqual(buildFirst);
    expect((await first.store.forProfile(profile).blueprints.list()).map((summary) => summary.name)).toEqual(['Build 1']);
    // Opening again opens the newest build that loads, and makes nothing.
    expect(await buildForOpening(other, profile, { ...init, name: 'Build 2' })).toEqual(buildFirst);
    await expect(profilesForOpening(first.store, '')).rejects.toThrow(/1 to 60 characters/);
    first.store.close();
    other.close();
  });
});

// Child profiles (task 4.9): everything is profile-scoped, one profile's queries never return another's records, and
// removing a profile removes everything it owns (D38).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Blueprint, RunRecord } from '@servo/schema';
import { exampleRunRecords } from '@servo/schema/fixtures';
import type { ProfileStore } from '../../src/store/index.ts';
import { T0, UUID_V4, openFor, rowsOf, runOf, schemaContent, storedDocument, withMeta } from './support.ts';

const T1 = '2026-10-02T10:30:00.000Z';
const runTemplate = exampleRunRecords[0]?.data as RunRecord;
/** The build the Run fixture ran: a Rolling Start robot in the wall-stop arena. */
const rolling: Blueprint = runTemplate.blueprint;

/** One child with a build, a Run of it and a card-game round. */
const furnish = async (kid: ProfileStore) => {
  const kept = await kid.blueprints.copy(rolling);
  if (!kept.ok) throw new Error('not kept');
  const run = runOf(runTemplate, kept.blueprint, { id: crypto.randomUUID(), profile: kid.profile });
  await kid.runs.add(run);
  const round = await kid.cardGames.add([{ part: 'dc-motor', named: true }]);
  return { blueprint: kept.blueprint, run, round };
};

describe('profiles', () => {
  it('makes, lists oldest first and renames profiles, under ids that never carry the name', async () => {
    const { store, clock } = await openFor(schemaContent);
    expect(await store.profiles.list()).toEqual([]);
    clock.set(T1);
    const robin = await store.profiles.create('Robin');
    clock.set(T0);
    const sam = await store.profiles.create('Sam');
    const ari = await store.profiles.create('Ari');
    expect(robin).toEqual({ id: robin.id, name: 'Robin', createdAt: T1 });
    for (const profile of [robin, sam, ari]) {
      expect(profile.id).toMatch(UUID_V4);
      expect(profile.id).not.toContain(profile.name.toLowerCase());
    }
    expect((await store.profiles.list()).map((profile) => profile.name)).toEqual(['Sam', 'Ari', 'Robin']);

    clock.set(T1);
    expect(await store.profiles.rename(sam.id, 'Samira')).toEqual({ id: sam.id, name: 'Samira', createdAt: T0 });
    expect((await store.profiles.list()).map((profile) => profile.name)).toEqual(['Samira', 'Ari', 'Robin']);

    for (const name of ['', ' Robin', 'x'.repeat(61), 'Two\nlines']) {
      await expect(store.profiles.create(name), JSON.stringify(name)).rejects.toThrow(/1 to 60 characters/);
      await expect(store.profiles.rename(robin.id, name), JSON.stringify(name)).rejects.toThrow(/1 to 60 characters/);
    }
    await expect(store.profiles.rename('9b2e4c1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c', 'Ghost')).rejects.toThrow(/no profile/);
    expect(await store.profiles.list()).toHaveLength(3);
    store.close();
  });

  it('never returns one profile’s records to another', async () => {
    const opened = await openFor(schemaContent);
    const { store, name } = opened;
    const robin = store.forProfile((await store.profiles.create('Robin')).id);
    const sam = store.forProfile((await store.profiles.create('Sam')).id);
    const { blueprint, run } = await furnish(robin);
    const stored = await storedDocument(name, blueprint.meta.id);

    expect(await sam.blueprints.list()).toEqual([]);
    await expect(sam.blueprints.load(blueprint.meta.id)).rejects.toThrow(/holds no blueprint/);
    await expect(sam.blueprints.save(blueprint)).rejects.toThrow();
    await expect(sam.blueprints.save(withMeta(blueprint, { author: sam.profile }))).rejects.toThrow(/holds no blueprint/);
    await expect(sam.blueprints.duplicate(blueprint.meta.id, 'Mine now')).rejects.toThrow(/holds no blueprint/);
    await sam.blueprints.remove(blueprint.meta.id);
    expect(await sam.runs.list()).toEqual([]);
    expect(await sam.runs.list({ blueprintId: blueprint.meta.id })).toEqual([]);
    expect(await sam.runs.list({ challenge: runTemplate.challenge ?? null })).toEqual([]);
    expect(await sam.runs.get(run.id)).toBeUndefined();
    await expect(sam.runs.add(run)).rejects.toThrow(/another profile/);
    expect(await sam.cardGames.list()).toEqual([]);
    expect(await sam.cardGames.latest()).toBeUndefined();
    expect(await rowsOf(name, sam.profile)).toEqual({ profiles: 1, blueprints: 0, runs: 0, cardGames: 0 });

    // Robin's records are all still there, untouched.
    expect(await storedDocument(name, blueprint.meta.id)).toBe(stored);
    expect((await robin.blueprints.list()).map((summary) => summary.id)).toEqual([blueprint.meta.id]);
    expect(await robin.runs.get(run.id)).toEqual(run);
    expect(await robin.cardGames.list()).toHaveLength(1);

    // A build passed from one child to another is kept as the other's own copy, never as the same record.
    const kept = await sam.blueprints.copy(blueprint);
    expect(kept.ok && kept.blueprint.meta.id).not.toBe(blueprint.meta.id);
    expect(kept.ok && kept.blueprint.meta.author).toBe(sam.profile);
    expect(await storedDocument(name, blueprint.meta.id)).toBe(stored);
    store.close();
  });

  it('removes a profile with its builds, runs and card-game results, and nothing of anyone else’s', async () => {
    const opened = await openFor(schemaContent);
    const { store, name } = opened;
    const robin = store.forProfile((await store.profiles.create('Robin')).id);
    const sam = store.forProfile((await store.profiles.create('Sam')).id);
    const robins = await furnish(robin);
    await robin.blueprints.create({ name: 'Second build', level: 1, arena: { preset: 'open-floor', props: [] } });
    const sams = await furnish(sam);
    expect(await rowsOf(name, robin.profile)).toEqual({ profiles: 1, blueprints: 2, runs: 1, cardGames: 1 });

    await store.profiles.remove(robin.profile);
    expect((await store.profiles.list()).map((profile) => profile.name)).toEqual(['Sam']);
    expect(await rowsOf(name, robin.profile)).toEqual({ profiles: 0, blueprints: 0, runs: 0, cardGames: 0 });
    expect(await storedDocument(name, robins.blueprint.meta.id)).toBeUndefined();
    expect(await robin.blueprints.list()).toEqual([]);
    expect(await robin.runs.get(robins.run.id)).toBeUndefined();
    expect(await robin.cardGames.latest()).toBeUndefined();

    expect(await rowsOf(name, sam.profile)).toEqual({ profiles: 1, blueprints: 1, runs: 1, cardGames: 1 });
    expect(await sam.runs.get(sams.run.id)).toEqual(sams.run);
    expect((await sam.blueprints.load(sams.blueprint.meta.id)).ok).toBe(true);

    // Nothing is ever kept for a profile that is gone, and removing it again changes nothing.
    await expect(robin.blueprints.create({ name: 'Late', level: 1, arena: { preset: 'open-floor', props: [] } })).rejects.toThrow(/no profile/);
    await expect(robin.blueprints.copy(rolling)).rejects.toThrow(/no profile/);
    await expect(robin.runs.add(runOf(runTemplate, robins.blueprint, { id: crypto.randomUUID(), profile: robin.profile }))).rejects.toThrow(/no profile/);
    await expect(robin.cardGames.add([{ part: 'led', named: false }])).rejects.toThrow(/no profile/);
    await expect(store.profiles.remove(robin.profile)).resolves.toBeUndefined();
    expect(await rowsOf(name, robin.profile)).toEqual({ profiles: 0, blueprints: 0, runs: 0, cardGames: 0 });
    store.close();
  });

  it('keeps nothing for a profile that was never made', async () => {
    const { store } = await openFor(schemaContent);
    const nobody = store.forProfile('9b2e4c1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c');
    expect(await nobody.blueprints.list()).toEqual([]);
    await expect(nobody.blueprints.create({ name: 'Orphan', level: 1, arena: { preset: 'open-floor', props: [] } })).rejects.toThrow(/no profile/);
    await expect(nobody.cardGames.add([{ part: 'led', named: true }])).rejects.toThrow(/no profile/);
    store.close();
  });
});

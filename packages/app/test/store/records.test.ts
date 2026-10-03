// Run records and card-game results (task 4.9): stored as the schema's RunRecord, and the name-the-part rounds whose
// latest counts (D40). Both are only ever added, and each list is oldest first.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Blueprint, RunRecord } from '@servo/schema';
import { exampleRunRecords } from '@servo/schema/fixtures';
import type { CardMark, ProfileStore } from '../../src/store/index.ts';
import { T0, UUID_V4, openFor, runOf, schemaContent } from './support.ts';
import type { Opened } from './support.ts';

const T1 = '2026-10-02T10:30:00.000Z';
const runTemplate = exampleRunRecords[0]?.data as RunRecord;

/** The record without some of its fields. */
const without = (record: RunRecord, ...keys: readonly string[]): RunRecord =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key))) as unknown as RunRecord;

/** A Run in the sandbox: no challenge, so no goal. */
const sandboxTemplate = without(runTemplate, 'challenge', 'goal');

/** The build the Run fixture ran, kept as the child's own. */
const keep = async (kid: ProfileStore): Promise<Blueprint> => {
  const kept = await kid.blueprints.copy(runTemplate.blueprint);
  if (!kept.ok) throw new Error('not kept');
  return kept.blueprint;
};

const childOf = async (opened: Opened): Promise<ProfileStore> => opened.store.forProfile((await opened.store.profiles.create('Robin')).id);

describe('run records', () => {
  it('adds Runs, gets them by id, and lists them oldest first, by blueprint and by challenge', async () => {
    const opened = await openFor(schemaContent);
    const kid = await childOf(opened);
    const rolling = await keep(kid);
    const second = await keep(kid);
    const at = (minute: number): string => `2026-10-01T09:${String(minute).padStart(2, '0')}:00.000Z`;
    const runs: RunRecord[] = [
      runOf(runTemplate, rolling, { id: crypto.randomUUID(), profile: kid.profile, startedAt: at(30), endedAt: at(31), runNumber: 2 }),
      runOf(sandboxTemplate, rolling, { id: crypto.randomUUID(), profile: kid.profile, startedAt: at(10), endedAt: at(11), runNumber: 1 }),
      runOf(runTemplate, second, { id: crypto.randomUUID(), profile: kid.profile, startedAt: at(20), endedAt: at(21), runNumber: 1 }),
      // Same start as the first: the one added later comes later.
      runOf(without(sandboxTemplate, 'profile'), rolling, { id: crypto.randomUUID(), startedAt: at(30), endedAt: at(32), runNumber: 2 }),
    ];
    for (const run of runs) await kid.runs.add(run);
    const [cross, sandbox, other, sandboxAgain] = runs as [RunRecord, RunRecord, RunRecord, RunRecord];

    expect(await kid.runs.list()).toEqual([sandbox, other, cross, sandboxAgain]);
    expect(await kid.runs.list({ blueprintId: rolling.meta.id })).toEqual([sandbox, cross, sandboxAgain]);
    expect(await kid.runs.list({ challenge: 'cross-and-stop' })).toEqual([other, cross]);
    expect(await kid.runs.list({ challenge: null })).toEqual([sandbox, sandboxAgain]);
    expect(await kid.runs.list({ blueprintId: rolling.meta.id, challenge: 'cross-and-stop' })).toEqual([cross]);
    expect(await kid.runs.list({ blueprintId: rolling.meta.id, challenge: null })).toEqual([sandbox, sandboxAgain]);
    expect(await kid.runs.list({ challenge: 'meet-the-switch' })).toEqual([]);
    // Stored as given: a record with no profile stays without one.
    expect(await kid.runs.get(sandboxAgain.id)).toEqual(sandboxAgain);
    expect((await kid.runs.get(sandboxAgain.id))?.profile).toBeUndefined();
    expect(await kid.runs.get(crypto.randomUUID())).toBeUndefined();
    opened.store.close();
  });

  it('refuses a Run it already has, one that does not validate, and one of another profile', async () => {
    const opened = await openFor(schemaContent);
    const kid = await childOf(opened);
    const rolling = await keep(kid);
    const run = runOf(runTemplate, rolling, { id: crypto.randomUUID(), profile: kid.profile });
    await kid.runs.add(run);
    await expect(kid.runs.add(run)).rejects.toThrow(/only ever added/);
    await expect(kid.runs.add({ ...run, id: crypto.randomUUID(), seed: -1 })).rejects.toThrow(/does not validate/);
    await expect(kid.runs.add({ ...run, id: crypto.randomUUID(), blueprintId: crypto.randomUUID() })).rejects.toThrow(/does not validate/);
    await expect(kid.runs.add({ ...run, id: crypto.randomUUID(), profile: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607' })).rejects.toThrow(/another profile/);
    expect(await kid.runs.list()).toEqual([run]);
    opened.store.close();
  });
});

describe('card-game results', () => {
  const round = (named: number): CardMark[] =>
    ['battery-pack-2-cell', 'switch', 'dc-motor', 'wheel-large', 'caster', 'chassis', 'led', 'buzzer', 'gearbox', 'motor-driver'].map((part, index) => ({
      part,
      named: index < named,
    }));

  it('keeps each round for the child, stamped now, and the latest is the one that counts (D40)', async () => {
    const opened = await openFor(schemaContent);
    const kid = await childOf(opened);
    expect(await kid.cardGames.latest()).toBeUndefined();
    opened.clock.set(T1);
    const first = await kid.cardGames.add(round(4));
    expect(first).toEqual({ id: first.id, profile: kid.profile, playedAt: T1, cards: round(4) });
    expect(first.id).toMatch(UUID_V4);
    opened.clock.set(T0);
    const earlier = await kid.cardGames.add(round(9));
    opened.clock.set(T1);
    const same = await kid.cardGames.add(round(7));

    expect(await kid.cardGames.list()).toEqual([earlier, first, same]);
    // Two rounds at the same moment: the one added last is the latest.
    expect(await kid.cardGames.latest()).toEqual(same);
    opened.store.close();
  });

  it('refuses a round with no cards, a card that is not { part, named }, or a part the content does not have', async () => {
    const opened = await openFor(schemaContent);
    const kid = await childOf(opened);
    await expect(kid.cardGames.add([])).rejects.toThrow(/at least one card/);
    await expect(kid.cardGames.add([{ part: 'dc-motor', named: 'yes' } as unknown as CardMark])).rejects.toThrow(/not \{ part, named \}/);
    await expect(kid.cardGames.add([{ part: 'flux-capacitor', named: true }])).rejects.toThrow(/not a part in the content/);
    expect(await kid.cardGames.list()).toEqual([]);
    // Only the marks are kept, whatever else a card carries.
    const kept = await kid.cardGames.add([{ part: 'led', named: true, note: 'quick' } as CardMark]);
    expect(kept.cards).toEqual([{ part: 'led', named: true }]);
    opened.store.close();
  });
});

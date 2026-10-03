// The app's autosave and its journal (src/shell/autosave.ts, task 4.9; review R-4.9 findings 1, 5 and 8), on
// fake-indexeddb. Waiting on every save before closing the store, noting what waits as the page goes, and saving
// what a page left noted the next time the app opens, under the store's conflict rule.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import { Autosaver, UNSAVED_PREFIX } from '../../src/shell/autosave.ts';
import type { Journal, SaveOutcome } from '../../src/shell/autosave.ts';
import { buildForOpening, openStoreWith } from '../../src/store/open.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';
import { clock, openFor, schemaContent, withMeta } from './support.ts';

const led = validBlueprints.find((fixture) => fixture.name === 'led-circuit')?.data as Blueprint;

/** An in-memory Storage, as localStorage behaves. */
const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
};

const notes = (journal: Journal): string[] =>
  Array.from({ length: journal.storage.length }, (_, index) => journal.storage.key(index) ?? '').filter((key) => key.startsWith(UNSAVED_PREFIX));

/** A child with the LED circuit kept, on its own database, and a journal for that database. */
const setUp = async () => {
  const opened = await openFor(schemaContent);
  const child = opened.store.forProfile((await opened.store.profiles.create('Robin')).id);
  const kept = await child.blueprints.copy(led);
  if (!kept.ok) throw new Error('not kept');
  const journal: Journal = { storage: memoryStorage(), scope: opened.name };
  return { ...opened, child, build: kept.blueprint, journal };
};

const namesIn = async (child: ProfileStore): Promise<string[]> => (await child.blueprints.list()).map((summary) => summary.name);

const reopen = (name: string, now?: () => string): Promise<ServoStore> => openStoreWith(schemaContent, now ? { name, now } : { name });

describe('the autosaver', () => {
  it('lets the app wait for every save it started before closing the store', async () => {
    const { store, name, child, build } = await setUp();
    const saving = new Autosaver();
    saving.edited(withMeta(build, { name: 'Edited just before closing' }), child);
    // As destroy() does: what waits saves, and the store closes once those saves have settled.
    saving.flush();
    await saving.settled();
    saving.dispose();
    store.close();
    const again = await reopen(name);
    expect(await namesIn(again.forProfile(child.profile))).toEqual(['Edited just before closing']);
    again.close();
  });

  it('drops what waits for a profile removed while the page was open, and saves or notes nothing more for it (D38)', async () => {
    const { store, child, build, journal } = await setUp();
    const saving = new Autosaver(journal);
    const failed: SaveOutcome[] = [];
    saving.subscribe((outcome) => {
      if (outcome.kind === 'failed') failed.push(outcome);
    });
    saving.edited(withMeta(build, { name: 'Edited as the profile went' }), child);
    saving.leaving();
    expect(notes(journal)).toHaveLength(1);
    saving.drop(child.profile);
    await store.profiles.remove(child.profile);
    await saving.settled();
    saving.edited(withMeta(build, { name: 'After it went' }), child);
    saving.leaving();
    expect(saving.pending).toBe(false);
    await saving.settled();
    expect(notes(journal)).toEqual([]);
    expect(failed).toEqual([]);
    saving.dispose();
    store.close();
  });

  it('notes what waits as the page goes, at once, and forgets each note once its build is saved', async () => {
    const { store, child, build, journal } = await setUp();
    const saving = new Autosaver(journal);
    saving.edited(withMeta(build, { name: 'Edited, then left' }), child);
    saving.leaving();
    expect(notes(journal)).toHaveLength(1);
    await saving.settled();
    expect(notes(journal)).toEqual([]);
    expect(await namesIn(child)).toEqual(['Edited, then left']);
    // An autosaver with no journal notes nothing.
    const plain = new Autosaver();
    plain.edited(withMeta(build, { name: 'Again' }), child);
    plain.leaving();
    expect(notes(journal)).toEqual([]);
    await plain.settled();
    store.close();
  });

  it('keeps a failed save waiting, tells why, and saves it when it can', async () => {
    const { store, name, child, build } = await setUp();
    const saving = new Autosaver();
    const outcomes: SaveOutcome['kind'][] = [];
    saving.subscribe((outcome) => outcomes.push(outcome.kind));
    store.close();
    saving.edited(withMeta(build, { name: 'Saved in the end' }), child);
    saving.flush();
    await saving.settled();
    expect(outcomes).toEqual(['failed']);
    expect(saving.pending).toBe(true);
    // The same build, from a store that works again (as after Safari loses and regains its connection).
    const again = await reopen(name);
    const kid = again.forProfile(child.profile);
    saving.edited(withMeta(build, { name: 'Saved in the end' }), kid);
    saving.flush();
    await saving.settled();
    expect(outcomes).toEqual(['failed', 'saved']);
    expect(await namesIn(kid)).toEqual(['Saved in the end']);
    saving.dispose();
    again.close();
  });
});

describe('builds a page left unsaved', () => {
  // Every time here is fixed, the autosaver's clock as much as the store's, so the tests hold on any date.
  const EDITED_BEFORE_T1 = '2026-10-01T12:00:00.000Z';
  const T1 = '2026-10-02T10:30:00.000Z';
  const EDITED_AFTER_T1 = '2026-10-02T12:00:00.000Z';
  const T2 = '2026-10-03T11:45:00.000Z';
  const init = { name: 'Build 1', level: 1, arena: { preset: 'open-floor', props: [] } } as const;

  /** Tab A: `build` edited, and the page closed at once, before its save could land (its store closes first). */
  const closedAtOnce = async (store: ServoStore, child: ProfileStore, build: Blueprint, journal: Journal, editedAt = EDITED_BEFORE_T1): Promise<void> => {
    const tabA = new Autosaver(journal, clock(editedAt).now);
    tabA.edited(build, child);
    store.close();
    tabA.leaving();
    await tabA.settled();
    tabA.dispose();
    expect(notes(journal)).toHaveLength(1);
  };

  /** Tab A: `build` edited, and the page closed as its save landed, so it never forgot the note. */
  const landedThenClosed = async (child: ProfileStore, build: Blueprint, journal: Journal): Promise<void> => {
    const tabA = new Autosaver(journal, clock(EDITED_BEFORE_T1).now);
    tabA.edited(build, child);
    tabA.leaving();
    const [item] = notes(journal);
    const note = journal.storage.getItem(item ?? '') ?? '';
    await tabA.settled();
    tabA.dispose();
    journal.storage.setItem(item ?? '', note);
  };

  /** The app opening again: the journal replayed, every outcome heard, then the build it opens. */
  const reopenApp = async (name: string, profile: string, journal: Journal, now: () => string) => {
    const store = await reopen(name, now);
    const saving = new Autosaver(journal, now);
    await saving.recover(store);
    const outcomes: SaveOutcome[] = [];
    saving.subscribe((outcome) => outcomes.push(outcome));
    const opened = await buildForOpening(store, profile, init);
    return { store, kid: store.forProfile(profile), outcomes, opened };
  };

  it('save to the build they were edited from when it has not moved on since (no conflict)', async () => {
    const { store, name, child, build, journal } = await setUp();
    await closedAtOnce(store, child, withMeta(build, { name: 'A edit, tab closed at once' }), journal);
    const app = await reopenApp(name, child.profile, journal, clock(T2).now);
    expect((await app.kid.blueprints.list()).map(({ id, name: built }) => ({ id, built }))).toEqual([{ id: build.meta.id, built: 'A edit, tab closed at once' }]);
    expect(app.opened.meta).toMatchObject({ id: build.meta.id, name: 'A edit, tab closed at once' });
    expect(app.outcomes).toEqual([]);
    expect(notes(journal)).toEqual([]);
    app.store.close();
  });

  it('are kept as a copy when another tab saved the build later: the newer build keeps its id, opens, and the line is told', async () => {
    // The reviewer's sequence: A edits and is closed at once; B saves later; A is reopened.
    const { store, name, child, build, journal } = await setUp();
    await closedAtOnce(store, child, withMeta(build, { name: 'A edit, tab closed at once' }), journal);
    const tabB = await reopen(name, clock(T1).now);
    const inB = await tabB.forProfile(child.profile).blueprints.load(build.meta.id);
    if (!inB.ok) throw new Error('not loaded');
    await tabB.forProfile(child.profile).blueprints.save(withMeta(inB.blueprint, { name: 'B edit, saved later' }));
    tabB.close();

    const app = await reopenApp(name, child.profile, journal, clock(T2).now);
    const builds = await app.kid.blueprints.list();
    expect(builds.map(({ id, name: built, keptFrom }) => ({ id: id === build.meta.id ? 'the build' : 'a copy', built, keptFrom }))).toEqual([
      { id: 'the build', built: 'B edit, saved later', keptFrom: undefined },
      { id: 'a copy', built: 'A edit, tab closed at once', keptFrom: build.meta.id },
    ]);
    expect(builds[0]?.updatedAt).toBe(T1);
    // The newest build opens, and the line says a copy was kept.
    expect(app.opened.meta).toMatchObject({ id: build.meta.id, name: 'B edit, saved later' });
    expect(app.outcomes).toMatchObject([{ kind: 'saved', keptCopy: { name: 'A edit, tab closed at once', keptFrom: build.meta.id } }]);
    expect(notes(journal)).toEqual([]);
    app.store.close();
  });

  it('win the id when edited after another tab saved the build, as they would have had their save landed', async () => {
    // The other order: B saves first; A, still on the older version, then edits and is closed at once.
    const { store, name, child, build, journal } = await setUp();
    const tabB = await reopen(name, clock(T1).now);
    await tabB.forProfile(child.profile).blueprints.save(withMeta(build, { name: 'B edit, saved first' }));
    tabB.close();
    await closedAtOnce(store, child, withMeta(build, { name: 'A edit, made after B saved' }), journal, EDITED_AFTER_T1);

    const app = await reopenApp(name, child.profile, journal, clock(T2).now);
    const builds = await app.kid.blueprints.list();
    expect(builds.map(({ id, name: built, keptFrom }) => ({ id: id === build.meta.id ? 'the build' : 'a copy', built, keptFrom }))).toEqual([
      { id: 'the build', built: 'A edit, made after B saved', keptFrom: undefined },
      { id: 'a copy', built: 'B edit, saved first', keptFrom: build.meta.id },
    ]);
    expect(builds[0]?.updatedAt).toBe(T2);
    // The later edit opens, B's is kept once, and the line says a copy was kept.
    expect(app.opened.meta).toMatchObject({ id: build.meta.id, name: 'A edit, made after B saved' });
    expect(app.outcomes).toMatchObject([{ kind: 'saved', keptCopy: { name: 'B edit, saved first', keptFrom: build.meta.id } }]);
    expect(notes(journal)).toEqual([]);
    app.store.close();
  });

  it('give the same winner as the live path in both orders', async () => {
    // Live: A's page stays open and its save lands, after B's. The later edit, A's, keeps the id there too.
    const { name, child, build } = await setUp();
    const tabB = await reopen(name, clock(T1).now);
    await tabB.forProfile(child.profile).blueprints.save(withMeta(build, { name: 'B edit, saved first' }));
    tabB.close();
    const live = new Autosaver(undefined, clock(EDITED_AFTER_T1).now);
    live.edited(withMeta(build, { name: 'A edit, made after B saved' }), child);
    live.flush();
    await live.settled();
    live.dispose();
    expect((await child.blueprints.list()).map(({ name: built, keptFrom }) => ({ built, keptFrom }))).toEqual([
      { built: 'A edit, made after B saved', keptFrom: undefined },
      { built: 'B edit, saved first', keptFrom: build.meta.id },
    ]);
  });

  it('are only forgotten when their own save had landed, so nothing is stored twice, with or without a later save', async () => {
    // A's save landed as its page went, but the page never forgot its note.
    const { name, child, build, journal } = await setUp();
    await landedThenClosed(child, withMeta(build, { name: 'A edit, saved as the page went' }), journal);
    expect(notes(journal)).toHaveLength(1);
    // B, which opened the build before A's save, saves later: A's version is kept as a copy then, by save's rule.
    const tabB = await reopen(name, clock(T1).now);
    await tabB.forProfile(child.profile).blueprints.save(withMeta(build, { name: 'B edit, saved later' }));
    tabB.close();

    const app = await reopenApp(name, child.profile, journal, clock(T2).now);
    expect((await app.kid.blueprints.list()).map(({ name: built, keptFrom }) => ({ built, keptFrom }))).toEqual([
      { built: 'B edit, saved later', keptFrom: undefined },
      { built: 'A edit, saved as the page went', keptFrom: build.meta.id },
    ]);
    expect(app.opened.meta.name).toBe('B edit, saved later');
    expect(app.outcomes).toEqual([]);
    expect(notes(journal)).toEqual([]);
    app.store.close();

    // Without B's save: the note is the build at its id already, so it is only forgotten.
    const alone = await setUp();
    await landedThenClosed(alone.child, withMeta(alone.build, { name: 'A edit, saved as the page went' }), alone.journal);
    const before = (await alone.child.blueprints.list())[0];
    alone.store.close();
    const again = await reopenApp(alone.name, alone.child.profile, alone.journal, clock(T2).now);
    expect(await again.kid.blueprints.list()).toEqual([before]);
    expect(again.outcomes).toEqual([]);
    expect(notes(alone.journal)).toEqual([]);
    again.store.close();
  });

  it('are kept as their own build when theirs was removed meanwhile', async () => {
    const { store, name, child, build, journal } = await setUp();
    await closedAtOnce(store, child, withMeta(build, { name: 'Left unsaved' }), journal);
    const removing = await reopen(name);
    await removing.forProfile(child.profile).blueprints.remove(build.meta.id);
    removing.close();
    const app = await reopenApp(name, child.profile, journal, clock(T2).now);
    const kept = await app.kid.blueprints.list();
    expect(kept.map(({ name: built, keptFrom }) => ({ built, keptFrom }))).toEqual([{ built: 'Left unsaved', keptFrom: undefined }]);
    expect(kept[0]?.id).not.toBe(build.meta.id);
    expect(app.opened.meta.name).toBe('Left unsaved');
    expect(notes(journal)).toEqual([]);
    app.store.close();
  });

  it('stay for next time when the store cannot replay them now, and go with their profile when it is removed', async () => {
    const { store, name, child, build, journal } = await setUp();
    await closedAtOnce(store, child, withMeta(build, { name: 'Left unsaved' }), journal);
    // The store is closed again: nothing can be replayed, and the note stays.
    const closed = await reopen(name);
    closed.close();
    await expect(new Autosaver(journal).recover(closed)).rejects.toThrow();
    expect(notes(journal)).toHaveLength(1);
    // The adult removes the child's profile, and everything of it goes, the note too (D38).
    const again = await reopen(name);
    await again.profiles.remove(child.profile);
    await new Autosaver(journal).recover(again);
    expect(notes(journal)).toEqual([]);
    // Another database's notes are not this store's to touch.
    journal.storage.setItem(`${UNSAVED_PREFIX}another-database:a-page:${child.profile} ${build.meta.id}`, '{}');
    await new Autosaver(journal).recover(again);
    expect(notes(journal)).toHaveLength(1);
    again.close();
  });
});

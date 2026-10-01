// The app's autosave and its journal (src/shell/autosave.ts, task 4.9; review R-4.9 findings 1, 5 and 8), on
// fake-indexeddb. Waiting on every save before closing the store, noting what waits as the page goes, and saving
// what a page left noted the next time the app opens, under the store's conflict rule.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import { Autosaver, UNSAVED_PREFIX, recoverUnsaved } from '../../src/shell/autosave.ts';
import type { Journal, SaveOutcome } from '../../src/shell/autosave.ts';
import { openStoreWith } from '../../src/store/open.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';
import { openFor, schemaContent, withMeta } from './support.ts';

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

const reopen = (name: string): Promise<ServoStore> => openStoreWith(schemaContent, { name });

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
  /** A page that noted `build` as it went, and whose save never finished: its store closed first. */
  const leftUnsaved = async (store: ServoStore, child: ProfileStore, build: Blueprint, journal: Journal): Promise<void> => {
    const saving = new Autosaver(journal);
    saving.edited(build, child);
    store.close();
    saving.leaving();
    await saving.settled();
    saving.dispose();
    expect(notes(journal)).toHaveLength(1);
  };

  it('are saved the next time the app opens, to the build they were made on, and forgotten', async () => {
    const { store, name, child, build, journal } = await setUp();
    await leftUnsaved(store, child, withMeta(build, { name: 'Left unsaved' }), journal);
    const again = await reopen(name);
    await recoverUnsaved(again, journal);
    const kid = again.forProfile(child.profile);
    expect((await kid.blueprints.list()).map(({ id, name: built }) => ({ id, built }))).toEqual([{ id: build.meta.id, built: 'Left unsaved' }]);
    expect(notes(journal)).toEqual([]);
    again.close();
  });

  it('keep the other version as a copy when the build was saved elsewhere since', async () => {
    const { store, name, child, build, journal } = await setUp();
    await leftUnsaved(store, child, withMeta(build, { name: 'Left unsaved' }), journal);
    const again = await reopen(name);
    const kid = again.forProfile(child.profile);
    await kid.blueprints.save(withMeta(build, { name: 'Saved in another tab' }));
    await recoverUnsaved(again, journal);
    expect(await namesIn(kid)).toEqual(expect.arrayContaining(['Left unsaved', 'Saved in another tab']));
    expect(await namesIn(kid)).toHaveLength(2);
    again.close();
  });

  it('are kept as their own build when theirs was removed meanwhile, and only forgotten when already saved', async () => {
    const { store, name, child, build, journal } = await setUp();
    await leftUnsaved(store, child, withMeta(build, { name: 'Left unsaved' }), journal);
    const again = await reopen(name);
    const kid = again.forProfile(child.profile);
    await kid.blueprints.remove(build.meta.id);
    await recoverUnsaved(again, journal);
    const kept = await kid.blueprints.list();
    expect(kept.map((summary) => summary.name)).toEqual(['Left unsaved']);
    expect(kept[0]?.id).not.toBe(build.meta.id);
    expect(notes(journal)).toEqual([]);

    // A note whose build was saved after all, as the page went, is forgotten and saves nothing.
    const stored = await kid.blueprints.load(kept[0]?.id ?? '');
    if (!stored.ok) throw new Error('not loaded');
    const note = { profile: kid.profile, base: '2026-01-01T00:00:00.000Z', build: stored.blueprint };
    journal.storage.setItem(`${UNSAVED_PREFIX}${name}:a-page:${kid.profile} ${stored.blueprint.meta.id}`, JSON.stringify(note));
    await recoverUnsaved(again, journal);
    expect((await kid.blueprints.list()).map((summary) => [summary.name, summary.updatedAt])).toEqual([['Left unsaved', stored.blueprint.meta.updatedAt]]);
    expect(notes(journal)).toEqual([]);
    again.close();
  });

  it('stay for next time when the store cannot save them now, and go with their profile when it is removed', async () => {
    const { store, name, child, build, journal } = await setUp();
    await leftUnsaved(store, child, withMeta(build, { name: 'Left unsaved' }), journal);
    // The store is closed again: nothing can be saved, and the note stays.
    const closed = await reopen(name);
    closed.close();
    await expect(recoverUnsaved(closed, journal)).rejects.toThrow();
    expect(notes(journal)).toHaveLength(1);
    // The adult removes the child's profile, and everything of it goes, the note too (D38).
    const again = await reopen(name);
    await again.profiles.remove(child.profile);
    await recoverUnsaved(again, journal);
    expect(notes(journal)).toEqual([]);
    // Another database's notes are not this store's to touch.
    journal.storage.setItem(`${UNSAVED_PREFIX}another-database:a-page:${child.profile} ${build.meta.id}`, '{}');
    await recoverUnsaved(again, journal);
    expect(notes(journal)).toHaveLength(1);
    again.close();
  });
});

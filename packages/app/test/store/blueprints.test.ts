// Blueprints in the store (task 4.9): save, load, duplicate and rename, keyed by meta.id, in canonical form, with the
// schema's migration run on every load. Round trips compare bytes: what serializeBlueprint writes is what is stored,
// and what comes back.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { contentFrom, loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { canonicalJson, canonicalizeBlueprint, claimPartId, claimWireId, serializeBlueprint } from '@servo/schema';
import type { Blueprint, Issue } from '@servo/schema';
import { exampleArenas, exampleParts, invalidBlueprints, v0Blueprints, validBlueprints, validKits } from '@servo/schema/fixtures';
import { openStore } from '../../src/store/index.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';
import { T0, UUID_V4, freshName, openFor, putProfile, putStored, schemaContent, storedDocument, withMeta } from './support.ts';
import type { Opened } from './support.ts';

const T1 = '2026-10-02T10:30:00.000Z';
const T2 = '2026-10-03T11:45:00.000Z';

const child = async (opened: Opened, name = 'Robin'): Promise<ProfileStore> => opened.store.forProfile((await opened.store.profiles.create(name)).id);

const issuesOf = (error: unknown): readonly Issue[] => ((error as Error).cause ?? []) as readonly Issue[];

/** The round trip every blueprint must survive: keep it, load it, save it, load it again, comparing the stored bytes each time. */
const roundTrip = async (opened: Opened, source: Blueprint): Promise<void> => {
  const { store, name, clock } = opened;
  const kid = await child(opened);
  clock.set(T1);
  const kept = await kid.blueprints.copy(source);
  if (!kept.ok) throw new Error(`not kept: ${kept.issues.map((issue) => issue.code).join()}`);
  const own = withMeta(canonicalizeBlueprint(source, store.content.catalogue), { id: kept.blueprint.meta.id, author: kid.profile, createdAt: T1, updatedAt: T1 });
  expect(kept.blueprint.meta.id).toMatch(UUID_V4);
  expect(serializeBlueprint(kept.blueprint)).toBe(serializeBlueprint(own));
  expect(await storedDocument(name, own.meta.id)).toBe(serializeBlueprint(own));

  const loaded = await kid.blueprints.load(own.meta.id);
  if (!loaded.ok) throw new Error('not loaded');
  expect(loaded.migratedFrom).toBeUndefined();
  expect(serializeBlueprint(loaded.blueprint)).toBe(serializeBlueprint(own));

  clock.set(T2);
  const saved = await kid.blueprints.save(loaded.blueprint);
  expect(serializeBlueprint(saved)).toBe(serializeBlueprint(withMeta(own, { updatedAt: T2 })));
  expect(await storedDocument(name, own.meta.id)).toBe(serializeBlueprint(saved));
  const again = await kid.blueprints.load(own.meta.id);
  expect(again.ok && serializeBlueprint(again.blueprint)).toBe(serializeBlueprint(saved));
};

/** A stored document under its own id, as sync leaves it, loads back as exactly the same bytes. */
const loadsAsStored = async (opened: Opened, source: Blueprint): Promise<void> => {
  const kid = await child(opened, 'Sam');
  const bytes = serializeBlueprint(canonicalizeBlueprint(source, opened.store.content.catalogue));
  await putStored(opened.name, { id: source.meta.id, profile: kid.profile, document: bytes });
  const loaded = await kid.blueprints.load(source.meta.id);
  expect(loaded.ok && serializeBlueprint(loaded.blueprint)).toBe(bytes);
  expect(await storedDocument(opened.name, source.meta.id)).toBe(bytes);
};

describe('round trips', () => {
  const contentFixtures = [...new Map(loadFixtures().fixtures.map((fixture) => [fixture.blueprint.meta.id, fixture])).values()];

  it('has every content fixture blueprint to try', () => {
    expect(loadFixtures().issues).toEqual([]);
    expect(contentFixtures.length).toBeGreaterThanOrEqual(19);
  });

  it.each(contentFixtures.map((fixture) => [fixture.name, fixture.blueprint] as const))('content fixture %s: save, load and the same bytes', async (_, blueprint) => {
    const opened = await openFor(loadContent());
    await roundTrip(opened, blueprint);
    await loadsAsStored(opened, blueprint);
    opened.store.close();
  });

  it.each(validBlueprints.map((fixture) => [fixture.name, fixture.data as Blueprint] as const))('schema fixture %s: save, load and the same bytes', async (_, blueprint) => {
    const opened = await openFor(schemaContent);
    expect(serializeBlueprint(blueprint)).toBe(canonicalJson(blueprint));
    await roundTrip(opened, blueprint);
    await loadsAsStored(opened, blueprint);
    opened.store.close();
  });

  it('stores canonical form, whatever order the build arrives in', async () => {
    const opened = await openFor(loadContent());
    const kid = await child(opened);
    const fixture = loadFixtures().fixtures.find((candidate) => candidate.name === 'kit-rolling-start')?.blueprint as Blueprint;
    const kept = await kid.blueprints.copy(fixture);
    if (!kept.ok) throw new Error('not kept');
    const canonical = kept.blueprint;
    const power = canonical.wires.find((wire) => wire.id === 'w10');
    expect(power?.from).toEqual({ part: 'motor-right', port: 'plus' });
    const jumbled: Blueprint = {
      ...canonical,
      parts: canonical.parts.toReversed(),
      wires: canonical.wires.toReversed().map((wire) => (wire.id === 'w10' ? { ...wire, from: wire.to, to: wire.from } : wire)),
    };
    opened.clock.set(T1);
    const saved = await kid.blueprints.save(jumbled);
    expect(serializeBlueprint(saved)).toBe(serializeBlueprint(withMeta(canonical, { updatedAt: T1 })));
    expect(await storedDocument(opened.name, canonical.meta.id)).toBe(serializeBlueprint(saved));
    expect(saved.wires.find((wire) => wire.id === 'w10')?.from).toEqual({ part: 'motor-right', port: 'plus' });
    opened.store.close();
  });
});

describe('migration on load', () => {
  it.each(v0Blueprints.map((fixture) => [fixture.name, fixture] as const))('migrates the version 0 %s fixture each time it loads, and keeps what was stored', async (_, fixture) => {
    const opened = await openFor(schemaContent);
    const migrated = fixture.migrated as Blueprint;
    const author = migrated.meta.author;
    const profile = author ?? (await opened.store.profiles.create('Robin')).id;
    if (author) await putProfile(opened.name, { id: author, name: 'Robin', createdAt: T0 });
    const kid = opened.store.forProfile(profile);
    const stored = JSON.stringify(fixture.data);
    await putStored(opened.name, { id: migrated.meta.id, profile, document: stored });

    for (const time of [1, 2]) {
      const loaded = await kid.blueprints.load(migrated.meta.id);
      expect(loaded.ok, `load ${time}`).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.migratedFrom).toBe(0);
      expect(loaded.blueprint.version).toBe(1);
      expect(serializeBlueprint(loaded.blueprint)).toBe(canonicalJson(migrated));
      expect(await storedDocument(opened.name, migrated.meta.id)).toBe(stored);
    }
    expect(await kid.blueprints.list()).toEqual([{ id: migrated.meta.id, name: migrated.meta.name, level: migrated.meta.level, updatedAt: migrated.meta.updatedAt }]);

    // Saving writes the current version; from then on nothing needs migrating.
    const loaded = await kid.blueprints.load(migrated.meta.id);
    if (!loaded.ok) throw new Error('not loaded');
    opened.clock.set(T2);
    const saved = await kid.blueprints.save(loaded.blueprint);
    expect(await storedDocument(opened.name, migrated.meta.id)).toBe(serializeBlueprint(withMeta(migrated, { updatedAt: T2 })));
    const again = await kid.blueprints.load(migrated.meta.id);
    expect(again.ok && again.migratedFrom).toBeUndefined();
    expect(again.ok && serializeBlueprint(again.blueprint)).toBe(serializeBlueprint(saved));
    opened.store.close();
  });

  it('migrates a version 0 build it keeps with copy, under a fresh id, and says so', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    const fixture = v0Blueprints.find((candidate) => candidate.name === 'light-and-motor');
    const kept = await kid.blueprints.copy(fixture?.data);
    expect(kept.ok && kept.migratedFrom).toBe(0);
    if (!kept.ok) return;
    const migrated = fixture?.migrated as Blueprint;
    expect(kept.blueprint.meta.id).not.toBe(migrated.meta.id);
    expect(serializeBlueprint(kept.blueprint)).toBe(
      serializeBlueprint(withMeta(migrated, { id: kept.blueprint.meta.id, author: kid.profile, createdAt: T0, updatedAt: T0 })),
    );
    opened.store.close();
  });
});

describe('a blueprint from a newer version of Servo', () => {
  const newer = invalidBlueprints.find((fixture) => fixture.name === 'version-2')?.data as { readonly meta: Blueprint['meta'] };

  it('comes back as a named load issue, never a throw, and stays stored exactly as it came', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    const stored = JSON.stringify(newer);
    await putStored(opened.name, { id: newer.meta.id, profile: kid.profile, document: stored });

    const loaded = await kid.blueprints.load(newer.meta.id);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.issues.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'blueprint.newer_version', path: '$.version' }]);
    expect(loaded.issues[0]?.message).toMatch(/newer version of Servo/);
    // The child still sees it is kept.
    expect(await kid.blueprints.list()).toEqual([{ id: newer.meta.id, name: newer.meta.name, level: newer.meta.level, updatedAt: newer.meta.updatedAt }]);

    // Nothing overwrites it or copies it, and it is never lost.
    const led = validBlueprints.find((fixture) => fixture.name === 'led-circuit')?.data as Blueprint;
    expect(led.meta.id).toBe(newer.meta.id);
    await expect(kid.blueprints.save(withMeta(led, { author: kid.profile }))).rejects.toThrow(/does not load, so it is kept as it is/);
    await expect(kid.blueprints.duplicate(newer.meta.id, 'Copy')).rejects.toThrow(/does not load/);
    const copied = await kid.blueprints.copy(newer);
    expect(copied.ok || copied.issues.map((issue) => issue.code)).toEqual(['blueprint.newer_version']);
    expect(await kid.blueprints.list()).toHaveLength(1);
    expect(await storedDocument(opened.name, newer.meta.id)).toBe(stored);
    opened.store.close();
  });

  it('keeps an unreadable document stored, out of the list, and loads it as an issue', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    await putStored(opened.name, { id: newer.meta.id, profile: kid.profile, document: '{"version": 1, "parts": [' });
    expect(await kid.blueprints.list()).toEqual([]);
    const loaded = await kid.blueprints.load(newer.meta.id);
    expect(loaded.ok || loaded.issues.map((issue) => issue.code)).toEqual(['value.unreadable']);
    opened.store.close();
  });
});

describe('create, save, duplicate, rename and remove', () => {
  const arena = { preset: 'open-floor', props: [] };

  it('creates an empty build: a fresh UUID v4, this profile as author, made now, high-water marks at 0', async () => {
    const opened = await openFor(loadContent());
    const kid = await child(opened);
    const made = await kid.blueprints.create({ name: 'First build', level: 1, arena });
    expect(made).toEqual({
      version: 1,
      parts: [],
      wires: [],
      arena,
      meta: { id: made.meta.id, name: 'First build', level: 1, createdAt: T0, updatedAt: T0, author: kid.profile, highWater: { parts: 0, wires: 0 } },
    });
    expect(made.meta.id).toMatch(UUID_V4);
    expect(await storedDocument(opened.name, made.meta.id)).toBe(serializeBlueprint(made));
    const loaded = await kid.blueprints.load(made.meta.id);
    expect(loaded.ok && serializeBlueprint(loaded.blueprint)).toBe(serializeBlueprint(made));
    expect(await kid.blueprints.list()).toEqual([{ id: made.meta.id, name: 'First build', level: 1, updatedAt: T0 }]);

    const refused = kid.blueprints.create({ name: 'Nowhere', level: 1, arena: { preset: 'the-moon', props: [] } });
    await expect(refused).rejects.toThrow(/does not validate/);
    expect(issuesOf(await refused.catch((error: unknown) => error)).map((issue) => issue.code)).toEqual(['ref.unknown_arena']);
    await expect(kid.blueprints.create({ name: '', level: 1, arena })).rejects.toThrow(/does not validate/);
    expect(await kid.blueprints.list()).toHaveLength(1);
    opened.store.close();
  });

  it('keeps a copy as the child’s own: fresh id, this profile as author, made now, with the name given', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    const source = validBlueprints.find((fixture) => fixture.name === 'bumper-robot')?.data as Blueprint;
    opened.clock.set(T1);
    const kept = await kid.blueprints.copy(source, 'My bumper robot');
    if (!kept.ok) throw new Error('not kept');
    expect(kept.migratedFrom).toBeUndefined();
    expect(kept.blueprint).toEqual(withMeta(source, { id: kept.blueprint.meta.id, author: kid.profile, createdAt: T1, updatedAt: T1, name: 'My bumper robot' }));
    expect(kept.blueprint.meta.id).not.toBe(source.meta.id);

    const badName = await kid.blueprints.copy(source, ' padded ');
    expect(badName.ok || badName.issues.map(({ code, path }) => `${code} ${path}`)).toEqual(['value.bad_format $.meta.name']);
    const broken = await kid.blueprints.copy({ ...source, parts: [...source.parts, { ...source.parts[0], id: 'p1', part: 'warp-drive' }] });
    expect(broken.ok).toBe(false);
    expect(await kid.blueprints.list()).toHaveLength(1);
    opened.store.close();
  });

  it('duplicates under a fresh id with its own name, keeping parts, wires, arena, level and high-water marks', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    const kept = await kid.blueprints.copy(validBlueprints.find((fixture) => fixture.name === 'rolling-start')?.data);
    if (!kept.ok) throw new Error('not kept');
    const original = kept.blueprint;
    const before = await storedDocument(opened.name, original.meta.id);

    opened.clock.set(T1);
    const twin = await kid.blueprints.duplicate(original.meta.id, 'Rolling robot 2');
    expect(twin.meta.id).toMatch(UUID_V4);
    expect(twin.meta.id).not.toBe(original.meta.id);
    expect(twin).toEqual(withMeta(original, { id: twin.meta.id, name: 'Rolling robot 2', author: kid.profile, createdAt: T1, updatedAt: T1 }));
    // Every id the original ever gave out stays given out in the copy.
    expect(claimPartId(twin).id).toBe(claimPartId(original).id);
    expect(claimWireId(twin).id).toBe(claimWireId(original).id);
    expect(await storedDocument(opened.name, twin.meta.id)).toBe(serializeBlueprint(twin));
    expect(await storedDocument(opened.name, original.meta.id)).toBe(before);
    expect((await kid.blueprints.list()).map((summary) => summary.name)).toEqual(['Rolling robot 2', 'Rolling robot']);
    // Its runs start again from 1: it has none.
    expect(await kid.runs.list({ blueprintId: twin.meta.id })).toEqual([]);

    await expect(kid.blueprints.duplicate(original.meta.id, '')).rejects.toThrow(/does not validate/);
    await expect(kid.blueprints.duplicate('9b2e4c1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c', 'Ghost')).rejects.toThrow(/holds no blueprint/);
    expect(await kid.blueprints.list()).toHaveLength(2);
    opened.store.close();
  });

  it('renames a build by saving a new meta.name: child text of 1 to 60 characters on one line', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    const kept = await kid.blueprints.copy(validBlueprints.find((fixture) => fixture.name === 'led-circuit')?.data);
    if (!kept.ok) throw new Error('not kept');
    const build = kept.blueprint;

    opened.clock.set(T1);
    const renamed = await kid.blueprints.save(withMeta(build, { name: 'Night light' }));
    expect(renamed).toEqual(withMeta(build, { name: 'Night light', updatedAt: T1 }));
    expect((await kid.blueprints.list()).map(({ name, updatedAt }) => ({ name, updatedAt }))).toEqual([{ name: 'Night light', updatedAt: T1 }]);
    const sixty = '🔋'.repeat(30) + 'x'.repeat(30);
    const longest = await kid.blueprints.save(withMeta(renamed, { name: sixty }));
    expect(longest.meta.name).toBe(sixty);
    // The clock stood still, and each save is still stamped later than the version it replaced.
    expect(longest.meta.updatedAt).toBe('2026-10-02T10:30:00.001Z');
    expect(await kid.blueprints.list()).toHaveLength(1);

    const stored = await storedDocument(opened.name, build.meta.id);
    for (const name of ['', ' Night', 'Night ', 'x'.repeat(61), 'Two\nlines', 'Tab\there']) {
      await expect(kid.blueprints.save(withMeta(longest, { name })), JSON.stringify(name)).rejects.toThrow(/does not validate/);
    }
    expect(await storedDocument(opened.name, build.meta.id)).toBe(stored);
    opened.store.close();
  });

  it('saves only a build this profile holds, as itself, and only when it validates', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    const kept = await kid.blueprints.copy(validBlueprints.find((fixture) => fixture.name === 'led-circuit')?.data);
    if (!kept.ok) throw new Error('not kept');
    const build = kept.blueprint;
    const stored = await storedDocument(opened.name, build.meta.id);

    await expect(kid.blueprints.save(withMeta(build, { id: '9b2e4c1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c' }))).rejects.toThrow(/holds no blueprint.*create, copy or duplicate/);
    const invalid = kid.blueprints.save({ ...build, wires: [...build.wires, { id: 'w9', from: { part: 'led', port: 'plus' }, to: { part: 'led', port: 'plus' } }] });
    await expect(invalid).rejects.toThrow(/does not validate/);
    expect(issuesOf(await invalid.catch((error: unknown) => error)).length).toBeGreaterThan(0);
    await expect(kid.blueprints.save(null as unknown as Blueprint)).rejects.toThrow(/does not validate/);
    expect(await storedDocument(opened.name, build.meta.id)).toBe(stored);
    // The row decides whose build it is, not the author it names: a build sync brought in, written by this child on
    // another device or by someone else, is still this profile's to save.
    const synced = withMeta(build, { author: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607' });
    expect((await kid.blueprints.save(synced)).meta.author).toBe(synced.meta.author);
    opened.store.close();
  });

  it('lists newest first, and removes a build without touching its runs', async () => {
    const opened = await openFor(schemaContent);
    const kid = await child(opened);
    const times = [T1, T0, T2];
    const builds: Blueprint[] = [];
    for (const [index, time] of times.entries()) {
      opened.clock.set(time);
      builds.push(await kid.blueprints.create({ name: `Build ${index + 1}`, level: 1, arena }));
    }
    expect((await kid.blueprints.list()).map((summary) => summary.name)).toEqual(['Build 3', 'Build 1', 'Build 2']);

    const [first] = builds;
    if (!first) throw new Error('no build');
    await kid.blueprints.remove(first.meta.id);
    expect((await kid.blueprints.list()).map((summary) => summary.name)).toEqual(['Build 3', 'Build 2']);
    await expect(kid.blueprints.load(first.meta.id)).rejects.toThrow(/holds no blueprint/);
    expect(await storedDocument(opened.name, first.meta.id)).toBeUndefined();
    await expect(kid.blueprints.remove(first.meta.id)).resolves.toBeUndefined();
    opened.store.close();
  });
});

describe('opening', () => {
  it('opens on the package’s own content, which has no issues', async () => {
    const store: ServoStore = await openStore({ name: freshName() });
    expect(store.content).toBe(loadContent().content);
    expect(store.contentIssues).toEqual([]);
    expect(store.sync.state).toBe('local-only');
    store.close();
  });

  it('opens despite a content defect: only builds that use the defective record fail to load', async () => {
    const broken = exampleParts.map((part) => ((part as { readonly id: string }).id === 'led' ? { ...(part as object), ports: 'none' } : part));
    const content = contentFrom({
      records: Object.fromEntries([
        ...broken.map((part) => [`parts/${(part as { readonly id: string }).id}.json`, part] as const),
        ...exampleArenas.map((arena) => [`arenas/${(arena as { readonly id: string }).id}.json`, arena] as const),
        ...validKits.map((kit) => [`kits/${kit.name}.json`, kit.data] as const),
      ]),
    });
    const opened = await openFor(content);
    expect(opened.store.contentIssues.length).toBeGreaterThan(0);
    expect(opened.store.content.catalogue.parts.has('led')).toBe(false);
    const kid = await child(opened);
    const led = validBlueprints.find((fixture) => fixture.name === 'led-circuit')?.data as Blueprint;
    const rolling = validBlueprints.find((fixture) => fixture.name === 'rolling-start')?.data as Blueprint;
    await putStored(opened.name, { id: led.meta.id, profile: kid.profile, document: serializeBlueprint(led) });
    await putStored(opened.name, { id: rolling.meta.id, profile: kid.profile, document: serializeBlueprint(rolling) });
    const failed = await kid.blueprints.load(led.meta.id);
    expect(failed.ok || failed.issues.map((issue) => issue.code)).toContain('ref.unknown_part_type');
    expect((await kid.blueprints.load(rolling.meta.id)).ok).toBe(true);
    expect(await kid.blueprints.list()).toHaveLength(2);
    expect(await storedDocument(opened.name, led.meta.id)).toBe(serializeBlueprint(led));
    opened.store.close();
  });
});

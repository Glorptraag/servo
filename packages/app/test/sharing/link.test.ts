// Shared links (task 5.6) in Node: what a link carries, and what opening one refuses. The negative test makes a real
// child's build in a real store (fake-indexeddb), with a profile, a name the child gave it and a Run on record, then
// inflates the link's payload by hand and checks that nothing of the child or the store is in it: no profile id or
// name, no author, no build id or dates, no Run, and only the blueprint fields a shared build is allowed.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { BLUEPRINT_VERSION, canonicalizeBlueprint, serializeBlueprint } from '@servo/schema';
import type { Blueprint } from '@servo/schema';
import { v0Blueprints } from '@servo/schema/fixtures';
import { createSimulation } from '@servo/sim-core';
import {
  LINK_FORMAT,
  MAX_DOCUMENT_BYTES,
  MAX_FRAGMENT_LENGTH,
  SHARED_BUILD_NAME,
  SHARED_META_KEYS,
  isShareFragment,
  readShareFragment,
  seedOf,
  shareLinkOf,
  sharedCopyOf,
} from '../../src/sharing/link.ts';
import { openStoreWith } from '../../src/store/open.ts';
import { SHARED_BUILD_NAME as FROM_STORE, shareLinkOf as shareFromStore } from '../../src/store/index.ts';
import { freshName, schemaContent } from '../store/support.ts';

const { content } = loadContent();
const { catalogue } = content;
const fixtures = loadFixtures().fixtures;
const fixture = (name: string): Blueprint => {
  const found = fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found.blueprint;
};

const BASE = 'https://servo.example/';
const SHARED_AT = '2026-10-03T12:00:00.000Z';
const fixed = { base: BASE, now: () => SHARED_AT };

// ---------------------------------------------------------------------------------------------------------
// Bytes by hand, so the tests read and forge payloads without the code under test.

const pipe = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** The payload of a link's fragment, inflated: the exact text the link carries. */
const payloadOf = async (fragment: string): Promise<string> => {
  const packed = Buffer.from(fragment.slice(fragment.indexOf('.') + 1), 'base64url');
  return new TextDecoder().decode(await pipe(new Uint8Array(packed), new DecompressionStream('deflate')));
};

/** A fragment for any text, deflated as Servo writes one: for links made or changed by hand. */
const forge = async (text: string, format = LINK_FORMAT): Promise<string> =>
  `#share=${format}.${base64url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate')))}`;

const keysOf = (value: unknown): string[] => Object.keys(value as object).sort();

/** Every string anywhere in a JSON value. */
const stringsIn = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : typeof value === 'object' && value !== null ? Object.values(value).flatMap(stringsIn) : [];

const linkOf = async (blueprint: Blueprint, options: Parameters<typeof shareLinkOf>[2] = fixed): Promise<{ url: string; fragment: string }> => {
  const made = await shareLinkOf(blueprint, catalogue, options);
  if (!made.ok) throw new Error(`no link: ${made.issues.map((found) => found.message).join('; ')}`);
  return made;
};

// ---------------------------------------------------------------------------------------------------------

describe('what a shared link carries (D21)', () => {
  it('holds no profile data: a real child’s build, with a Run on record, shared from the store', async () => {
    const store = await openStoreWith(loadContent(), { name: freshName(), now: () => '2026-10-01T09:00:00.000Z' });
    try {
      const profile = await store.profiles.create('Mia Okafor');
      const child = store.forProfile(profile.id);
      const kept = await child.blueprints.copy(fixture('level-1-roller'), 'Mia first robot');
      if (!kept.ok) throw new Error('not kept');
      const build = kept.blueprint;
      expect(build.meta.author).toBe(profile.id);
      const arena = catalogue.arenas?.get(build.arena.preset);
      if (!arena) throw new Error('no arena');
      const simulation = await createSimulation({ blueprint: build, catalogue, arena, seed: 7 });
      for (let tick = 0; tick < 30; tick += 1) simulation.step();
      const run = simulation.record({
        id: crypto.randomUUID(),
        startedAt: '2026-10-01T09:01:00.000Z',
        endedAt: '2026-10-01T09:01:01.000Z',
        runNumber: 1,
        profile: profile.id,
        hints: [],
      });
      simulation.dispose();
      await child.runs.add(run);

      const loaded = await child.blueprints.load(build.meta.id);
      if (!loaded.ok) throw new Error('not loaded');
      const { url, fragment } = await linkOf(loaded.blueprint, { base: BASE });
      expect(url.startsWith(`${BASE}#share=${LINK_FORMAT}.`)).toBe(true);
      expect(url.slice(BASE.length)).toBe(fragment);
      // The fragment is the only place the build goes: no query, nothing a server would see.
      expect(new URL(url).search).toBe('');
      expect(new URL(url).pathname).toBe('/');

      const text = await payloadOf(fragment);
      const payload = JSON.parse(text) as Record<string, unknown>;
      expect(keysOf(payload)).toEqual(['arena', 'meta', 'parts', 'version', 'wires']);
      expect(keysOf(payload.meta)).toEqual([...SHARED_META_KEYS].sort());
      expect(keysOf(payload.meta)).not.toContain('author');
      for (const absent of [
        profile.id,
        profile.name,
        'Mia',
        'Okafor',
        profile.createdAt,
        build.meta.id,
        build.meta.name,
        build.meta.createdAt,
        build.meta.updatedAt,
        run.id,
        run.startedAt,
        run.endedAt,
        'author',
        'profile',
        'runs',
        'runNumber',
        'keptFrom',
      ]) {
        expect(text).not.toContain(absent);
      }
      const shared = payload as unknown as Blueprint;
      expect(shared.meta.name).toBe(SHARED_BUILD_NAME);
      expect(shared.meta.createdAt).not.toBe(build.meta.createdAt);
      expect(shared.meta.id).not.toBe(build.meta.id);
      // Every string in the payload is a part, port, wire or arena id, a setting's option, or the shared copy's own meta.
      const own = new Set([shared.meta.id, shared.meta.name, shared.meta.createdAt, shared.meta.updatedAt]);
      const buildStrings = new Set(stringsIn({ parts: build.parts, wires: build.wires, arena: build.arena }));
      expect(stringsIn(payload).filter((found) => !own.has(found) && !buildStrings.has(found))).toEqual([]);
      // And the build itself is all there.
      expect({ parts: shared.parts, wires: shared.wires, arena: shared.arena }).toEqual({ parts: build.parts, wires: build.wires, arena: build.arena });
      expect(shared.meta.level).toBe(build.meta.level);
      expect(shared.meta.highWater).toEqual(build.meta.highWater);
      expect(text).toBe(serializeBlueprint(shared));
      // Sharing wrote nothing: the child's records are as they were.
      expect((await child.blueprints.list()).map((summary) => summary.id)).toEqual([build.meta.id]);
      expect(await child.runs.list()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('includes the build’s name only when the adult leaves the option ticked, and never the author', async () => {
    const build: Blueprint = { ...fixture('level-1-roller'), meta: { ...fixture('level-1-roller').meta, author: crypto.randomUUID(), name: 'Sam racer' } };
    const unticked = JSON.parse(await payloadOf((await linkOf(build)).fragment)) as Blueprint;
    expect(unticked.meta.name).toBe(SHARED_BUILD_NAME);
    const ticked = JSON.parse(await payloadOf((await linkOf(build, { ...fixed, includeName: true })).fragment)) as Blueprint;
    expect(ticked.meta.name).toBe('Sam racer');
    expect(keysOf(ticked.meta)).not.toContain('author');
    const opened = await readShareFragment((await linkOf(build, { ...fixed, includeName: true })).fragment, catalogue);
    expect(opened.ok && opened.named && opened.blueprint.meta.name).toBe('Sam racer');
  });

  it('leaves behind whatever else the object holds', () => {
    const build = fixture('level-1-roller');
    const cluttered = { ...build, profile: 'p', runs: [{ id: 'r' }], meta: { ...build.meta, author: crypto.randomUUID(), keptFrom: build.meta.id } } as unknown as Blueprint;
    const copy = sharedCopyOf(cluttered, { now: () => SHARED_AT, newId: () => '11111111-2222-4333-8444-555555555555' });
    expect(keysOf(copy)).toEqual(['arena', 'meta', 'parts', 'version', 'wires']);
    expect(copy.meta).toEqual({
      id: '11111111-2222-4333-8444-555555555555',
      name: SHARED_BUILD_NAME,
      level: build.meta.level,
      createdAt: SHARED_AT,
      updatedAt: SHARED_AT,
      highWater: build.meta.highWater,
    });
  });

  it('refuses to make a link for a build that does not validate', async () => {
    const build = fixture('level-1-roller');
    const broken = { ...build, parts: [...build.parts, { ...build.parts[0], id: 'p999', part: 'flux-capacitor' }] } as Blueprint;
    const made = await shareLinkOf(broken, catalogue, fixed);
    expect(made.ok).toBe(false);
  });

  it('is reachable from @servo/app/store, the parent view’s one way into the app', () => {
    expect(shareFromStore).toBe(shareLinkOf);
    expect(FROM_STORE).toBe(SHARED_BUILD_NAME);
  });
});

describe('opening a shared link', () => {
  it('gives back the build, migrated, validated and canonical, for every content fixture', async () => {
    for (const { name, blueprint } of fixtures) {
      const { fragment } = await linkOf(blueprint);
      expect(isShareFragment(fragment)).toBe(true);
      const opened = await readShareFragment(fragment, catalogue);
      if (!opened.ok) throw new Error(`${name}: ${opened.issues.map((found) => found.message).join('; ')}`);
      const canonical = canonicalizeBlueprint(blueprint, catalogue);
      expect({ parts: opened.blueprint.parts, wires: opened.blueprint.wires, arena: opened.blueprint.arena }, name).toEqual({
        parts: canonical.parts,
        wires: canonical.wires,
        arena: canonical.arena,
      });
      expect(opened.named).toBe(false);
      expect(opened.blueprint.meta.author).toBeUndefined();
    }
  });

  it('replays with the same seed for the same build, whoever shares it and whenever', async () => {
    const build = fixture('level-1-roller');
    const first = await readShareFragment((await linkOf(build)).fragment, catalogue);
    const second = await readShareFragment((await linkOf(build, { base: BASE, now: () => '2027-01-01T00:00:00.000Z', includeName: true })).fragment, catalogue);
    const other = await readShareFragment((await linkOf(fixture('motor-driver-robot'))).fragment, catalogue);
    if (!first.ok || !second.ok || !other.ok) throw new Error('not opened');
    expect(first.blueprint.meta.id).not.toBe(second.blueprint.meta.id);
    expect(second.seed).toBe(first.seed);
    expect(other.seed).not.toBe(first.seed);
    expect(first.seed).toBe(seedOf(build));
    expect(Number.isInteger(first.seed) && first.seed >= 0 && first.seed < 2 ** 32).toBe(true);
  });

  it('opens a link holding an older blueprint version through migrateBlueprint, and still refuses one with an author', async () => {
    // The schema's version 0 fixtures are drawn from its example catalogue, so they are checked against that.
    const example = schemaContent.content.catalogue;
    const shared = v0Blueprints.find((found) => found.name === 'light-and-motor');
    const authored = v0Blueprints.find((found) => found.name === 'rolling-start');
    if (!shared || !authored) throw new Error('no version 0 fixtures');
    const opened = await readShareFragment(await forge(JSON.stringify(shared.data)), example);
    if (!opened.ok) throw new Error(opened.issues.map((found) => found.message).join('; '));
    const migrated = shared.migrated as Blueprint;
    expect({ parts: opened.blueprint.parts, wires: opened.blueprint.wires }).toEqual({ parts: migrated.parts, wires: migrated.wires });
    const refusal = await readShareFragment(await forge(JSON.stringify(authored.data)), example);
    expect(refusal.ok).toBe(false);
  });
});

describe('a link that is incomplete, changed or not Servo’s is refused, never thrown', () => {
  const good = async (): Promise<string> => (await linkOf(fixture('level-1-roller'))).fragment;
  const document = (): Record<string, unknown> => JSON.parse(serializeBlueprint(sharedCopyOf(fixture('level-1-roller'), fixed))) as Record<string, unknown>;
  const refusedAs = async (fragment: string, reason: 'refused' | 'newer'): Promise<void> => {
    const opened = await readShareFragment(fragment, catalogue);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.reason).toBe(reason);
      expect(opened.issues.length).toBeGreaterThan(0);
    }
  };

  it('refuses a cut-off link', async () => {
    const fragment = await good();
    for (const keep of [fragment.length - 1, fragment.length - 7, Math.floor(fragment.length / 2), '#share=1.'.length + 2]) {
      await refusedAs(fragment.slice(0, keep), 'refused');
    }
  });

  it('refuses a link with a character changed', async () => {
    const fragment = await good();
    const start = '#share=1.'.length;
    let refusedCount = 0;
    for (let at = start + 4; at < fragment.length; at += Math.max(1, Math.floor((fragment.length - start) / 40))) {
      const swapped = fragment[at] === 'A' ? 'B' : 'A';
      const opened = await readShareFragment(`${fragment.slice(0, at)}${swapped}${fragment.slice(at + 1)}`, catalogue);
      // A change deflate's checksum cannot see would still have to be a valid build; none here is.
      if (!opened.ok) refusedCount += 1;
    }
    expect(refusedCount).toBeGreaterThan(30);
  });

  it('refuses what is not a link at all', async () => {
    for (const hash of ['', '#', '#share=', '#share=1.', '#share=1', '#share=x.abc', '#share=1.ab$c', '#share=1.abc=', '#share=1.a', '#build=1.abc']) {
      await refusedAs(hash, 'refused');
    }
    expect(isShareFragment('#share=')).toBe(true);
    expect(isShareFragment('#settings')).toBe(false);
    expect(isShareFragment('')).toBe(false);
  });

  it('refuses a payload that is not JSON, or not UTF-8', async () => {
    await refusedAs(await forge('not json'), 'refused');
    const latin = `#share=1.${base64url(await pipe(new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]), new CompressionStream('deflate')))}`;
    await refusedAs(latin, 'refused');
    await refusedAs(`#share=1.${base64url(new TextEncoder().encode('{"version":1}'))}`, 'refused');
  });

  it('refuses a payload that carries an author, before or after migration', async () => {
    const withAuthor = document();
    (withAuthor.meta as Record<string, unknown>).author = crypto.randomUUID();
    await refusedAs(await forge(JSON.stringify(withAuthor)), 'refused');
  });

  it('refuses a payload with anything outside a blueprint’s fields', async () => {
    const extras: readonly ((value: Record<string, unknown>) => void)[] = [
      (value) => (value.runs = []),
      (value) => (value.profile = crypto.randomUUID()),
      (value) => ((value.meta as Record<string, unknown>).profileName = 'Mia'),
      (value) => ((value.meta as Record<string, unknown>).keptFrom = crypto.randomUUID()),
      (value) => ((value.parts as Record<string, unknown>[])[0]!.note = 'Mia'),
    ];
    for (const extra of extras) {
      const value = document();
      extra(value);
      await refusedAs(await forge(JSON.stringify(value)), 'refused');
    }
  });

  it('refuses a build this content cannot run', async () => {
    const value = document();
    (value.parts as Record<string, unknown>[])[0]!.part = 'flux-capacitor';
    await refusedAs(await forge(JSON.stringify(value)), 'refused');
    const arena = document();
    arena.arena = { preset: 'the-moon', props: [] };
    await refusedAs(await forge(JSON.stringify(arena)), 'refused');
  });

  it('says a link from a newer Servo is newer: a newer link format or a newer blueprint version', async () => {
    await refusedAs(await forge(serializeBlueprint(sharedCopyOf(fixture('level-1-roller'), fixed)), LINK_FORMAT + 1), 'newer');
    const value = document();
    value.version = BLUEPRINT_VERSION + 1;
    await refusedAs(await forge(JSON.stringify(value)), 'newer');
  });

  it('refuses a link longer than any build, and a payload that inflates past the limit', async () => {
    await refusedAs(`#share=1.${'A'.repeat(MAX_FRAGMENT_LENGTH)}`, 'refused');
    const bomb = await forge(`{"version":1,"pad":"${' '.repeat(MAX_DOCUMENT_BYTES + 10)}"}`);
    expect(bomb.length).toBeLessThan(MAX_FRAGMENT_LENGTH);
    await refusedAs(bomb, 'refused');
  });

  it('never throws, whatever the fragment', async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let state = 12345;
    const next = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state;
    };
    for (let round = 0; round < 50; round += 1) {
      const length = next() % 200;
      const body = Array.from({ length }, () => alphabet[next() % alphabet.length]).join('');
      await expect(readShareFragment(`#share=1.${body}`, catalogue)).resolves.toMatchObject({ ok: false });
    }
  });
});

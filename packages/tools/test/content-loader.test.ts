// Content's loader against the tools that write and check content: the registry `pnpm art` writes (task 0.6), and
// the content validator's record kinds, checks and catalogue (task 0.5). The loader must read and judge content
// exactly as they do, so content that passes the validator can never break the app at start-up.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentFrom, loadContent } from '@servo/content';
import type { ContentLoad } from '@servo/content';
import { afterEach, describe, expect, it } from 'vitest';
import { generateArt, listFiles, validateContent } from '../src/index.ts';
import { catalogueFromFolder } from '../src/validate-content/catalogue.ts';
import { classify, findRecordFiles, readJson } from '../src/validate-content/records.ts';
import { REPO_ROOT, changed, partFixture, removeTempFolders, tempFolder, write, writeSchemaFixtures } from './validate-content/support.ts';

const SCHEMA_PARTS = fileURLToPath(new URL('../../schema/fixtures/parts/', import.meta.url));
const CONTENT = fileURLToPath(new URL('../../content/', import.meta.url));

afterEach(removeTempFolders);

const posix = (file: string): string => file.split(path.sep).join('/');

/** Folders the loader leaves to others: pictures go through the registry, fixtures through @servo/content/fixtures. */
const loaderReads = (file: string): boolean => !['art/', 'fixtures/', 'test/'].some((folder) => file.startsWith(folder));

/** What the loader would be given for a folder laid out like packages/content. */
const recordsIn = (folder: string): Record<string, unknown> =>
  Object.fromEntries(
    findRecordFiles(folder).flatMap((file) => {
      const relative = posix(path.relative(folder, file));
      const read = readJson(file);
      return loaderReads(relative) && read.ok ? [[relative, read.value]] : [];
    }),
  );

interface Verdict {
  /** `file code path`, in order. */
  readonly issues: readonly string[];
  readonly parts: readonly string[];
  readonly arenas: readonly string[];
  readonly kits: readonly string[];
  readonly challenges: readonly string[];
}

const ids = (records: Iterable<{ readonly id: string }>): string[] => [...records].map((record) => record.id).sort();

const loaderVerdict = (load: ContentLoad): Verdict => ({
  issues: load.issues.map(({ file, code, path: at }) => `${file} ${code} ${at}`).sort(),
  parts: ids(load.content.parts),
  arenas: ids(load.content.arenas),
  kits: ids(load.content.kits),
  challenges: ids(load.content.challenges),
});

/** The content validator on the same folder, as `pnpm validate-content <folder>` runs it with no terminology lists. */
const validatorVerdict = (folder: string, repoRoot: string): Verdict => {
  const report = validateContent({
    paths: [folder],
    repoRoot,
    terminology: path.join(folder, 'no-terminology-lists'),
    catalogue: { folder, fallBackToFixtures: false },
  });
  const relative = (file: string): string => posix(path.relative(folder, file));
  const refused = new Set(report.issues.map((issue) => issue.file));
  const challenges = report.files.flatMap((file) => {
    const read = readJson(file);
    const value = read.ok ? read.value : undefined;
    const isChallenge = classify(file, value, repoRoot).kind === 'challenge';
    return isChallenge && !refused.has(file) && loaderReads(relative(file)) ? [{ id: String((value as { readonly id?: unknown }).id) }] : [];
  });
  const { catalogue } = catalogueFromFolder(folder, repoRoot, readJson);
  return {
    issues: report.issues
      .map((issue) => ({ ...issue, file: relative(issue.file) }))
      .filter((issue) => loaderReads(issue.file))
      .map(({ file, code, path: at }) => `${file} ${code} ${at}`)
      .sort(),
    parts: ids(catalogue.parts.values()),
    arenas: ids(catalogue.arenas?.values() ?? []),
    kits: ids(catalogue.kits?.values() ?? []),
    challenges: ids(challenges),
  };
};

describe('content loader: the registry pnpm art writes', () => {
  it('resolves every key from real pnpm art output, a final render over its placeholder', () => {
    const root = tempFolder();
    const generated = path.join(root, 'art', 'generated');
    const final = path.join(root, 'art', 'final');
    write(final, 'part/led.PNG', 'a final render');
    const report = generateArt({ parts: SCHEMA_PARTS, out: generated, final });
    const registry: unknown = JSON.parse(fs.readFileSync(path.join(generated, 'registry.json'), 'utf8'));
    const pictures = Object.fromEntries(listFiles(path.join(root, 'art')).map((file) => [`art/${file}`, `url:${file}`]));

    const load = contentFrom({ records: {}, registry, pictures });

    expect(load.issues).toEqual([]);
    expect([...load.content.art.keys()]).toEqual(Object.keys(report.registry).sort());
    expect(load.content.art.size).toBe(14);
    expect(load.content.art.get('part/led')).toEqual({ src: 'url:final/part/led.PNG', isPlaceholder: false });
    expect(load.content.art.get('part/dc-motor')).toEqual({ src: 'url:generated/part/dc-motor.svg', isPlaceholder: true });
    // A key the registry lacks gives nothing: the canvas draws a neutral tile.
    expect(load.content.art.get('part/ultrasonic-sensor')).toBeUndefined();
  });
});

describe('content loader: the same verdicts as the content validator', () => {
  it('agrees on the schema fixtures laid out as content', () => {
    const folder = tempFolder();
    writeSchemaFixtures(folder);
    const verdict = validatorVerdict(folder, folder);
    expect(verdict.issues).toEqual([]);
    expect(verdict.parts).toHaveLength(14);
    expect(verdict.challenges).toHaveLength(4);
    expect(loaderVerdict(contentFrom({ records: recordsIn(folder) }))).toEqual(verdict);
  });

  it('agrees on misfiled, unknown, duplicate and broken records', () => {
    const folder = tempFolder();
    writeSchemaFixtures(folder);
    const read = (relative: string): unknown => JSON.parse(fs.readFileSync(path.join(folder, relative), 'utf8'));
    write(folder, 'parts/level-2/led.json', partFixture('led'));
    write(folder, 'misc/caster.json', partFixture('caster'));
    write(folder, 'misc/odd.json', { hello: 1 });
    write(folder, 'misc/both.json', { tray: [], wires: [] });
    write(folder, 'parts/a-kit.json', read('kits/rolling-start.json'));
    write(folder, 'kits/broken.json', changed(read('kits/rolling-start.json') as Record<string, unknown>, (kit) => Object.assign(kit, { id: 'broken', parts: [{ part: 'no-such-part', quantity: 1 }] })));
    write(folder, 'challenges/deep/er/lost.json', changed(read('challenges/meet-the-switch.json') as Record<string, unknown>, (challenge) => Object.assign(challenge, { id: 'lost', kit: 'no-such-kit' })));
    write(folder, 'arenas/ramp.json', changed(read('arenas/ramp.json') as Record<string, unknown>, (arena) => Object.assign(arena, { size: 3 })));

    const verdict = validatorVerdict(folder, folder);
    expect(verdict.issues.length).toBeGreaterThan(6);
    expect(verdict.issues).toContain('parts/level-2/led.json content.duplicate_id $.id');
    expect(verdict.issues).toContain('parts/caster.json content.duplicate_id $.id');
    expect(verdict.issues).toContain('misc/odd.json file.unknown_kind $');
    expect(loaderVerdict(contentFrom({ records: recordsIn(folder) }))).toEqual(verdict);
  });

  it("agrees on this repository's own content, read through the loader's globs", () => {
    expect(loaderVerdict(loadContent())).toEqual(validatorVerdict(CONTENT, REPO_ROOT));
  });
});

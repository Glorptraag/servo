// The release's content bundle and content version (task 6.3): the version is the content's semver and a short hash
// of its canonical records, and the bundle holds exactly what content's loader reads.
import { fileURLToPath } from 'node:url';
import { contentFrom, loadContent } from '@servo/content';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT_BUNDLE_FORMAT,
  ReleaseError,
  SHORT_HASH_LENGTH,
  canonicalJson,
  checkContent,
  contentSha256,
  isSemver,
  makeContentBundle,
  readContentFiles,
  readContentSemver,
} from '../src/release/index.ts';
import type { ContentBundleFiles } from '../src/release/index.ts';
import { REPO_ROOT, changed, partFixture, removeTempFolders, tempFolder, write, writeSchemaFixtures } from './validate-content/support.ts';

const CONTENT = fileURLToPath(new URL('../../content/', import.meta.url));

afterEach(removeTempFolders);

/** Calls `run` and returns the ReleaseError it throws. */
const releaseError = (run: () => unknown): ReleaseError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ReleaseError) return error;
    throw error;
  }
  throw new Error('Expected a ReleaseError.');
};

describe('canonical JSON', () => {
  it("puts every object's keys in code-unit order, at every depth, with no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"e":2,"f":1}]},"b":1}');
  });

  it('keeps the order of arrays', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('orders keys that look like numbers as text too', () => {
    expect(canonicalJson({ 10: 'a', 9: 'b', x: 'c' })).toBe('{"10":"a","9":"b","x":"c"}');
  });

  it('gives the same text for the same record however its file is laid out', () => {
    const tidy = JSON.parse('{\n  "id": "dc-motor",\n  "ports": [{ "id": "a", "type": "power" }]\n}') as unknown;
    const packed = JSON.parse('{"ports":[{"type":"power","id":"a"}],"id":"dc-motor"}') as unknown;
    expect(canonicalJson(tidy)).toBe(canonicalJson(packed));
  });
});

describe('the content version', () => {
  const files: ContentBundleFiles = { records: { 'parts/a.json': { id: 'a', n: 1 } }, terminology: {} };

  it('is the semver, a plus, and the first eight hex digits of the SHA-256 of the canonical files', () => {
    // The hash of '{"records":{"parts/a.json":{"id":"a","n":1}},"terminology":{}}', worked out with shasum -a 256.
    const sha256 = '6fdfe631d33daec7129539b6185a0a5bddc54c665e2cb2059ac5688628fd4134';
    const bundle = makeContentBundle('0.1.0', files);
    expect(bundle).toMatchObject({ format: CONTENT_BUNDLE_FORMAT, formatVersion: 1, semver: '0.1.0', sha256, version: '0.1.0+6fdfe631' });
    expect(SHORT_HASH_LENGTH).toBe(8);
    expect(contentSha256(files)).toBe(sha256);
  });

  it('is the same for the same records in any key order', () => {
    const reordered: ContentBundleFiles = { terminology: {}, records: { 'parts/a.json': { n: 1, id: 'a' } } };
    expect(makeContentBundle('0.1.0', reordered).version).toBe(makeContentBundle('0.1.0', files).version);
  });

  it('changes when any record, its path or the terminology changes, and with the semver', () => {
    const version = makeContentBundle('0.1.0', files).version;
    const variants: readonly ContentBundleFiles[] = [
      { records: { 'parts/a.json': { id: 'a', n: 2 } }, terminology: {} },
      { records: { 'parts/a.json': { id: 'a', n: 1 }, 'parts/b.json': { id: 'b' } }, terminology: {} },
      { records: { 'parts/level-2/a.json': { id: 'a', n: 1 } }, terminology: {} },
      { records: files.records, terminology: { 'terminology/banned.json': { banned: [] } } },
    ];
    for (const variant of variants) expect(makeContentBundle('0.1.0', variant).version).not.toBe(version);
    expect(makeContentBundle('0.1.1', files).version).toBe(version.replace('0.1.0+', '0.1.1+'));
  });

  it('takes a pre-release, and refuses anything that is not major.minor.patch', () => {
    expect(makeContentBundle('0.2.0-tester.1', files).version).toMatch(/^0\.2\.0-tester\.1\+[0-9a-f]{8}$/);
    for (const bad of ['', '1', '1.0', 'v1.0.0', '01.0.0', '1.0.0+abc', '1.0.0-', 'one']) {
      expect(isSemver(bad), bad).toBe(false);
      expect(releaseError(() => makeContentBundle(bad, files)).message).toMatch(/is not major\.minor\.patch/);
    }
  });
});

describe('the content bundle of packages/content', () => {
  const files = readContentFiles(CONTENT);

  it("holds what content's loader loads: the same parts, arenas, kits, challenges and terminology, with no issues", () => {
    const fromBundle = contentFrom(files);
    const { content } = loadContent();
    expect(fromBundle.issues).toEqual([]);
    expect(fromBundle.content.parts).toEqual(content.parts);
    expect(fromBundle.content.arenas).toEqual(content.arenas);
    expect(fromBundle.content.kits).toEqual(content.kits);
    expect(fromBundle.content.challenges).toEqual(content.challenges);
    expect(fromBundle.content.terminology).toEqual(content.terminology);
    expect(fromBundle.content.parts.length).toBeGreaterThan(0);
  });

  it('leaves out fixtures, tests, art and package files, and keys every file by its path in packages/content', () => {
    const records = Object.keys(files.records);
    expect(records.length).toBeGreaterThan(0);
    for (const file of records) {
      expect(file).toMatch(/\.json$/);
      expect(file).not.toMatch(/^(?:fixtures|test|art|terminology|node_modules)\/|(?:^|\/)package\.json$|\\/);
    }
    expect(Object.keys(files.terminology)).toEqual(['terminology/banned.json', 'terminology/components.json', 'terminology/words.json']);
  });

  it("passes the release's content check, and is versioned from packages/content/package.json", () => {
    expect(() => checkContent(CONTENT, REPO_ROOT, files)).not.toThrow();
    const semver = readContentSemver(CONTENT);
    expect(isSemver(semver)).toBe(true);
    expect(makeContentBundle(semver, files).version).toMatch(new RegExp(`^${semver.replaceAll('.', '\\.')}\\+[0-9a-f]{8}$`));
  });
});

describe('reading and checking a content folder', () => {
  it('reads records and terminology, and leaves out what the loader leaves out', () => {
    const folder = tempFolder();
    write(folder, 'parts/a.json', { id: 'a' });
    write(folder, 'kits/k.json', { id: 'k' });
    write(folder, 'fixtures/blueprints/b.json', { id: 'b' });
    write(folder, 'test/t.json', { id: 't' });
    write(folder, 'art/generated/registry.json', {});
    write(folder, 'node_modules/x/y.json', {});
    write(folder, '.hidden/h.json', {});
    write(folder, 'package.json', { version: '0.1.0' });
    write(folder, 'tsconfig.json', {});
    write(folder, 'terminology/banned.json', { banned: [] });
    write(folder, 'terminology/notes.txt', 'not a list');
    const files = readContentFiles(folder);
    expect(Object.keys(files.records)).toEqual(['kits/k.json', 'parts/a.json']);
    expect(files.terminology).toEqual({ 'terminology/banned.json': { banned: [] } });
  });

  it('refuses a file that is not JSON, naming it', () => {
    const folder = tempFolder();
    write(folder, 'parts/a.json', '{ not json');
    expect(releaseError(() => readContentFiles(folder)).problems).toEqual([expect.stringMatching(/^parts\/a\.json: Not valid JSON/)]);
  });

  it('passes content the validator and the loader both take', () => {
    const folder = tempFolder();
    writeSchemaFixtures(folder);
    expect(() => checkContent(folder, REPO_ROOT, readContentFiles(folder))).not.toThrow();
  });

  it('refuses content with an invalid record, naming the file', () => {
    const folder = tempFolder();
    writeSchemaFixtures(folder);
    write(folder, 'parts/dc-motor.json', changed(partFixture('dc-motor'), (part) => delete part.ports));
    const error = releaseError(() => checkContent(folder, REPO_ROOT, readContentFiles(folder)));
    expect(error.message).toMatch(/The content has issues, so no release was built/);
    expect(error.problems.some((problem) => problem.startsWith('parts/dc-motor.json: '))).toBe(true);
  });

  it('refuses content with no part records', () => {
    const folder = tempFolder();
    write(folder, 'terminology/banned.json', { banned: [] });
    expect(releaseError(() => checkContent(folder, REPO_ROOT, readContentFiles(folder))).problems).toContain('There are no part records.');
  });

  it("reads the content semver from the folder's package.json, and refuses one without", () => {
    const folder = tempFolder();
    write(folder, 'package.json', { name: '@servo/content', version: '1.2.3' });
    expect(readContentSemver(folder)).toBe('1.2.3');
    write(folder, 'package.json', { name: '@servo/content' });
    expect(releaseError(() => readContentSemver(folder)).message).toMatch(/has no version/);
  });
});

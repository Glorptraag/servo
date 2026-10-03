// The content bundle: every record the app loads, in one file with its own version, so curriculum can be shipped
// apart from an app release (brief Section 6). See README.md, "The content bundle".
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { contentFrom } from '@servo/content';
import { validateContent } from '../validate-content/index.ts';
import { compareText, findRecordFiles, isRecord, readJson } from '../validate-content/records.ts';
import { ReleaseError } from './errors.ts';

/** Names the file's format, so a reader can refuse one it does not know. */
export const CONTENT_BUNDLE_FORMAT = 'servo-content-bundle';
export const CONTENT_BUNDLE_FORMAT_VERSION = 1;

/** How many hex digits of the content's SHA-256 the content version keeps. */
export const SHORT_HASH_LENGTH = 8;

/** major.minor.patch, with an optional pre-release. No build part: the content version adds its own. */
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const isSemver = (version: string): boolean => SEMVER.test(version);

/** Content files keyed by their path inside packages/content, with `/` separators: what content's `contentFrom` reads. */
export interface ContentBundleFiles {
  /** Every record the app's loader reads: parts, arenas, kits and challenges. */
  readonly records: Readonly<Record<string, unknown>>;
  /** The terminology lists, `terminology/*.json`. */
  readonly terminology: Readonly<Record<string, unknown>>;
}

export interface ContentBundle extends ContentBundleFiles {
  readonly format: typeof CONTENT_BUNDLE_FORMAT;
  readonly formatVersion: typeof CONTENT_BUNDLE_FORMAT_VERSION;
  /** The content version: `<semver>+<short hash>`, for example `0.1.0+3f9a2c1b`. */
  readonly version: string;
  /** packages/content's `version`. */
  readonly semver: string;
  /** The SHA-256 of the canonical files, in hex. The version keeps its first SHORT_HASH_LENGTH digits. */
  readonly sha256: string;
}

/**
 * JSON with every object's keys in code-unit order and no whitespace, so the same records give the same text however
 * their files are laid out or their keys are ordered. Arrays keep their order.
 */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

/** The SHA-256, in hex, of the canonical JSON of `{ records, terminology }`. */
export const contentSha256 = (files: ContentBundleFiles): string =>
  createHash('sha256')
    .update(canonicalJson({ records: files.records, terminology: files.terminology }), 'utf8')
    .digest('hex');

/** The bundle for these files: their content version is `semver`, a plus, and the start of their hash. */
export const makeContentBundle = (semver: string, files: ContentBundleFiles): ContentBundle => {
  if (!isSemver(semver)) {
    throw new ReleaseError(`The content's version '${semver}' is not major.minor.patch.`, [
      "Set packages/content/package.json's version to one, for example 0.1.0, with no build part after a +: the release adds the hash.",
    ]);
  }
  const sha256 = contentSha256(files);
  return {
    format: CONTENT_BUNDLE_FORMAT,
    formatVersion: CONTENT_BUNDLE_FORMAT_VERSION,
    version: `${semver}+${sha256.slice(0, SHORT_HASH_LENGTH)}`,
    semver,
    sha256,
    records: files.records,
    terminology: files.terminology,
  };
};

const posix = (file: string): string => file.split(path.sep).join('/');

/** Folders of packages/content that content's loader leaves out: art goes through the registry, and fixtures and tests are not shipped. */
const NOT_LOADED = ['art/', 'fixtures/', 'test/'];

/**
 * The files content's loader reads, from disk: every record (`.json` outside art/, fixtures/, test/, terminology
 * folders, hidden folders and node_modules, and not package configuration) and `terminology/*.json`, each in path
 * order. Throws a ReleaseError when a file cannot be read or is not JSON.
 */
export const readContentFiles = (contentDir: string): ContentBundleFiles => {
  const problems: string[] = [];
  const read = (file: string, into: Record<string, unknown>): void => {
    const relative = posix(path.relative(contentDir, file));
    const result = readJson(file);
    if (result.ok) into[relative] = result.value;
    else problems.push(`${relative}: ${result.message}`);
  };
  const records: Record<string, unknown> = {};
  const unlisted = (folder: string, code: string): void => {
    problems.push(`${posix(path.relative(contentDir, folder)) || '.'}: could not list the folder (${code}).`);
  };
  for (const file of findRecordFiles(contentDir, unlisted)) {
    const relative = posix(path.relative(contentDir, file));
    if (!NOT_LOADED.some((folder) => relative.startsWith(folder))) read(file, records);
  }
  const terminology: Record<string, unknown> = {};
  const lists = path.join(contentDir, 'terminology');
  if (fs.existsSync(lists)) {
    const names = fs
      .readdirSync(lists, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareText);
    for (const name of names) read(path.join(lists, name), terminology);
  }
  if (problems.length > 0) throw new ReleaseError('Some content files could not be read, so no release was built.', problems);
  return { records, terminology };
};

/**
 * Refuses content the app would not load whole, before anything is built: any issue the content validator finds in
 * the content folder (as `pnpm validate-content` does in CI: the schema, terminology, banned words and fixtures), any
 * record content's loader would leave out, and content with no part records.
 */
export const checkContent = (contentDir: string, repoRoot: string, files: ContentBundleFiles): void => {
  const report = validateContent({
    paths: [contentDir],
    repoRoot,
    terminology: path.join(contentDir, 'terminology'),
    catalogue: { folder: contentDir, fallBackToFixtures: false },
  });
  const loaded = contentFrom(files);
  // The loader gives the validator's verdicts (test/content-loader.test.ts), so the same issue is listed once.
  const show = (file: string): string => posix(path.relative(contentDir, file));
  const problems = [
    ...report.issues.map((issue) => `${show(issue.file)}: ${issue.code} at ${issue.path}: ${issue.message}`),
    ...loaded.issues.map((issue) => `${issue.file}: ${issue.code} at ${issue.path}: ${issue.message}`),
  ];
  if (loaded.content.parts.length === 0) problems.push('There are no part records.');
  if (problems.length > 0) {
    throw new ReleaseError('The content has issues, so no release was built. pnpm validate-content packages/content lists them too.', [
      ...new Set(problems),
    ]);
  }
};

/// <reference types="vite/client" />
// @servo/content: the content records and their loaders. The pure core, `contentFrom`, gives each file its kind
// and checks it exactly as the content validator (task 0.5) does: the same record folders, the same schema
// validators and the same catalogue. `loadContent` feeds it the package's files through Vite's eager
// import.meta.glob, so it runs in the app build and under Vitest, not under plain Node. Terminology and glosses are
// checked only when content is authored, by the validator. See packages/content/README.md.

import { makeCatalogue, validateArenaPreset, validateChallenge, validateKit, validatePartRecord } from '@servo/schema';
import type { ArenaPreset, AssetKey, Catalogue, Challenge, IssueCode, Kit, PartRecord, ValidationResult } from '@servo/schema';

/** The content validator's kinds of record. The loader keeps parts, arenas, kits and challenges. */
export type RecordKind = 'part' | 'arena' | 'kit' | 'challenge' | 'blueprint' | 'run-record';

/**
 * The schema's codes, the two of the content validator's that a loaded file can meet, and the fixtures' own:
 * a fixture names a blueprint or challenge that is not there, or a blueprint file no fixture uses.
 */
export type ContentIssueCode =
  | IssueCode
  | 'file.unknown_kind'
  | 'content.duplicate_id'
  | 'fixture.unknown_blueprint'
  | 'fixture.unknown_challenge'
  | 'fixture.unused_blueprint';

/** One problem in one file, as the content validator reports it, with the file's path inside packages/content. */
export interface ContentIssue {
  readonly file: string;
  readonly code: ContentIssueCode;
  readonly path: string;
  readonly message: string;
}

/** A picture in the swap registry (task 0.6). */
export interface ArtEntry {
  /** A URL the browser can load. */
  readonly src: string;
  readonly isPlaceholder: boolean;
}

/** Art key to picture. A key it lacks has no picture yet: the canvas draws a neutral tile. */
export type ArtRegistry = ReadonlyMap<AssetKey, ArtEntry>;

/** A file in terminology/ as authored (task 2.5), in the content validator's format. */
export interface TerminologyFile {
  /** The file name without `.json`. */
  readonly id: string;
  readonly data: unknown;
}

/** Every record that validates, each list in id order. */
export interface Content {
  readonly parts: readonly PartRecord[];
  readonly arenas: readonly ArenaPreset[];
  readonly kits: readonly Kit[];
  readonly challenges: readonly Challenge[];
  /** Parts, arenas and kits by id: what validateBlueprint, sim-core and the canvas take. */
  readonly catalogue: Catalogue;
  readonly terminology: readonly TerminologyFile[];
  readonly art: ArtRegistry;
}

/** The content, and every problem found. A record with a problem is left out, so one bad file never hides the rest. */
export interface ContentLoad {
  readonly content: Content;
  readonly issues: readonly ContentIssue[];
}

/** The files `contentFrom` reads, each keyed by its path inside packages/content with `/` separators. */
export interface ContentFiles {
  /** Parsed JSON records: every `.json` file except package configuration and the art, fixtures, test and terminology folders. */
  readonly records: Readonly<Record<string, unknown>>;
  /** Parsed JSON files in `terminology/`. */
  readonly terminology?: Readonly<Record<string, unknown>>;
  /** `art/generated/registry.json`, parsed, when `pnpm art` has written it. */
  readonly registry?: unknown;
  /** A URL for each picture under `art/`. */
  readonly pictures?: Readonly<Record<string, string>>;
}

const KIND_LABELS: Readonly<Record<RecordKind, string>> = {
  part: 'part record',
  arena: 'arena preset',
  kit: 'kit',
  challenge: 'challenge',
  blueprint: 'blueprint',
  'run-record': 'run record',
};

/** Folder names that say what the records inside are. The nearest one above a file decides its kind. */
const KIND_FOLDERS: ReadonlyMap<string, RecordKind> = new Map([
  ['parts', 'part'],
  ['arenas', 'arena'],
  ['kits', 'kit'],
  ['challenges', 'challenge'],
  ['blueprints', 'blueprint'],
  ['run-records', 'run-record'],
]);

/** For a file below no record folder: the top-level fields that only one kind of record has. */
const KIND_FIELDS: readonly (readonly [RecordKind, readonly string[]])[] = [
  ['part', ['identity', 'body', 'ports', 'needs', 'behaviour', 'failureModes', 'card']],
  ['arena', ['walls', 'zones', 'lines', 'ramps']],
  ['kit', ['tray']],
  ['challenge', ['title', 'goalLine', 'introduces']],
  ['blueprint', ['wires', 'meta']],
  ['run-record', ['blueprintId', 'seed', 'tickRate', 'runNumber', 'inputs', 'faults', 'fixed']],
];

/** Where pictures are found, and where registry.json's `src` paths start. */
const ART = 'art';
const GENERATED = 'art/generated';
const REGISTRY = 'art/generated/registry.json';

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The content validator's walk order: each folder's entries in code-unit order of their names, depth first. */
const comparePaths = (a: string, b: string): number => {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareText(left[index] ?? '', right[index] ?? '');
    if (order !== 0) return order;
  }
  return left.length - right.length;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const own = <T>(files: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(files, key) ? files[key] : undefined);

const nameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1).replace(/\.json$/, '');

/** A file's kind: from the nearest record folder above it, otherwise from the fields only one kind has. */
const kindOf = (file: string, value: unknown): RecordKind | readonly RecordKind[] => {
  for (const folder of file.split('/').slice(0, -1).toReversed()) {
    const kind = KIND_FOLDERS.get(folder);
    if (kind) return kind;
  }
  const candidates = isRecord(value) ? KIND_FIELDS.filter(([, fields]) => fields.some((key) => Object.hasOwn(value, key))).map(([kind]) => kind) : [];
  const [only] = candidates;
  return only !== undefined && candidates.length === 1 ? only : candidates;
};

const unknownKind = (candidates: readonly RecordKind[]): string => {
  const what =
    candidates.length === 0
      ? 'Its kind is unknown: it is in no record folder and has the fields of no record.'
      : `Its kind is unknown: it is in no record folder and has fields of more than one kind (${candidates.map((kind) => KIND_LABELS[kind]).join(', ')}).`;
  return `${what} Put it in one of ${[...KIND_FOLDERS.keys()].map((name) => `${name}/`).join(', ')}.`;
};

/** A path inside packages/content, from a path relative to `folder`; undefined when it climbs out of art/. */
const inside = (folder: string, relative: string): string | undefined => {
  const segments = folder.split('/');
  for (const segment of relative.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  const path = segments.join('/');
  return path.startsWith(`${ART}/`) ? path : undefined;
};

/** registry.json as task 0.6 writes it: art key to `{ src, isPlaceholder }`, `src` relative to the generated folder. */
const artFrom = (registry: unknown, pictures: Readonly<Record<string, string>>, issues: ContentIssue[]): ArtRegistry => {
  const art = new Map<AssetKey, ArtEntry>();
  if (registry === undefined) return art;
  if (!isRecord(registry)) {
    issues.push({ file: REGISTRY, code: 'value.wrong_type', path: '$', message: 'Expected an object of art keys.' });
    return art;
  }
  for (const key of Object.keys(registry).sort(compareText)) {
    const entry = registry[key];
    const path = `$['${key}']`;
    if (!isRecord(entry) || typeof entry.src !== 'string' || typeof entry.isPlaceholder !== 'boolean') {
      issues.push({ file: REGISTRY, code: 'value.wrong_type', path, message: 'An entry is { src, isPlaceholder }.' });
      continue;
    }
    const file = inside(GENERATED, entry.src);
    const url = file === undefined ? undefined : own(pictures, file);
    if (url === undefined) issues.push({ file: REGISTRY, code: 'value.missing', path: `${path}.src`, message: `No picture at '${entry.src}'. Run pnpm art.` });
    else art.set(key, { src: url, isPlaceholder: entry.isPlaceholder });
  }
  return art;
};

/**
 * Pure: the content in a set of files, and every problem in them. Each file's kind comes from its nearest record
 * folder (parts/, arenas/, kits/, challenges/, blueprints/, run-records/), or else from the fields only one kind
 * has. Parts and arenas are checked alone, kits against them, and challenges against all three. When records of
 * one kind share an id, the first in walk order is kept and the others are issues. Blueprints and run records are
 * fixtures and test data, so they are typed and left alone. Never throws.
 */
export const contentFrom = (files: ContentFiles): ContentLoad => {
  const issues: ContentIssue[] = [];
  const found = new Map<RecordKind, { readonly file: string; readonly value: unknown }[]>();
  for (const file of Object.keys(files.records).sort(comparePaths)) {
    const value = own(files.records, file);
    const kind = kindOf(file, value);
    if (typeof kind !== 'string') issues.push({ file, code: 'file.unknown_kind', path: '$', message: unknownKind(kind) });
    else found.set(kind, [...(found.get(kind) ?? []), { file, value }]);
  }
  const take = <T extends { readonly id: string }>(kind: RecordKind, check: (value: unknown) => ValidationResult<T>): T[] => {
    const kept = new Map<string, { readonly file: string; readonly record: T }>();
    for (const { file, value } of found.get(kind) ?? []) {
      const result = check(value);
      const first = result.ok ? kept.get(result.value.id) : undefined;
      if (!result.ok) {
        issues.push(...result.issues.map((issue) => ({ file, ...issue })));
      } else if (first) {
        const message = `Another ${KIND_LABELS[kind]} already uses the id '${result.value.id}': ${first.file}.`;
        issues.push({ file, code: 'content.duplicate_id', path: '$.id', message });
      } else {
        kept.set(result.value.id, { file, record: result.value });
      }
    }
    return [...kept.values()].map(({ record }) => record).sort((a, b) => compareText(a.id, b.id));
  };
  const parts = take('part', validatePartRecord);
  const arenas = take('arena', validateArenaPreset);
  const partsAndArenas = makeCatalogue({ parts, arenas });
  const kits = take('kit', (value) => validateKit(value, partsAndArenas));
  const catalogue = makeCatalogue({ parts, arenas, kits });
  const challenges = take('challenge', (value) => validateChallenge(value, catalogue));
  const terminologyFiles = files.terminology ?? {};
  const terminology = Object.keys(terminologyFiles)
    .sort(comparePaths)
    .map((file) => ({ id: nameOf(file), data: own(terminologyFiles, file) }));
  const art = artFrom(files.registry, files.pictures ?? {}, issues);
  return {
    content: { parts, arenas, kits, challenges, catalogue, terminology, art },
    issues: issues.toSorted((a, b) => comparePaths(a.file, b.file)),
  };
};

/** Glob keys start `../` from this file; content paths start at the package. */
const inPackage = <T>(files: Readonly<Record<string, T>>): Record<string, T> =>
  Object.fromEntries(Object.entries(files).map(([key, value]) => [key.replace(/^\.\.\//, ''), value]));

let loaded: ContentLoad | undefined;

/** The package's own content, loaded and checked once. Never throws; CI fails when `issues` is not empty. */
export const loadContent = (): ContentLoad => {
  loaded ??= contentFrom({
    records: inPackage(
      import.meta.glob(
        ['../**/*.json', '!../package.json', '!../tsconfig*.json', '!../art/**', '!../fixtures/**', '!../test/**', '!../**/terminology/**'],
        { eager: true, import: 'default' },
      ),
    ),
    terminology: inPackage(import.meta.glob('../terminology/*.json', { eager: true, import: 'default' })),
    registry: Object.values(import.meta.glob('../art/generated/registry.json', { eager: true, import: 'default' }))[0],
    pictures: inPackage({
      ...import.meta.glob<string>('../art/**/*.svg', { eager: true, query: '?url', import: 'default', caseSensitive: false }),
      ...import.meta.glob<string>('../art/final/**/*.avif', { eager: true, query: '?url', import: 'default', caseSensitive: false }),
      ...import.meta.glob<string>('../art/final/**/*.jpeg', { eager: true, query: '?url', import: 'default', caseSensitive: false }),
      ...import.meta.glob<string>('../art/final/**/*.jpg', { eager: true, query: '?url', import: 'default', caseSensitive: false }),
      ...import.meta.glob<string>('../art/final/**/*.png', { eager: true, query: '?url', import: 'default', caseSensitive: false }),
      ...import.meta.glob<string>('../art/final/**/*.webp', { eager: true, query: '?url', import: 'default', caseSensitive: false }),
    }),
  });
  return loaded;
};

/** Parts, arenas and kits by id. */
export const loadCatalogue = (): Catalogue => loadContent().content.catalogue;
export const loadParts = (): readonly PartRecord[] => loadContent().content.parts;
export const loadArenas = (): readonly ArenaPreset[] => loadContent().content.arenas;
export const loadKits = (): readonly Kit[] => loadContent().content.kits;
export const loadChallenges = (): readonly Challenge[] => loadContent().content.challenges;
export const loadTerminology = (): readonly TerminologyFile[] => loadContent().content.terminology;
export const loadArtRegistry = (): ArtRegistry => loadContent().content.art;

/// <reference types="vite/client" />
// @servo/content: the content records and their loaders (task 0.4). One JSON record per file, named by its id.
// The loaders read the folders with Vite's eager import.meta.glob, so they run in the app build and under Vitest,
// not under plain Node; the tools CLI reads files from disk instead. See packages/content/README.md.

import { makeCatalogue, validateArenaPreset, validateChallenge, validateKit, validatePartRecord } from '@servo/schema';
import type { ArenaPreset, AssetKey, Catalogue, Challenge, Issue, Kit, PartRecord, ValidationResult } from '@servo/schema';

/** An issue in one content file: the schema's issue, plus the file's path inside packages/content. */
export interface ContentIssue extends Issue {
  readonly file: string;
}

/** A swap-registry entry. Tools (task 0.6) writes the registry; the loader turns `src` into a URL. */
export interface ArtEntry {
  /** A URL the browser can load. */
  readonly src: string;
  readonly isPlaceholder: boolean;
}

export type ArtRegistry = ReadonlyMap<AssetKey, ArtEntry>;

/** A terminology or banned-words file as authored (task 2.5). Its format belongs to the content validator (task 0.5). */
export interface TerminologyFile {
  /** The file name without `.json`. */
  readonly id: string;
  readonly data: unknown;
}

/** Every content record, validated, each list in id order. */
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

export type ContentResult =
  | { readonly ok: true; readonly value: Content }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] };

/** Thrown by the single loaders when the content does not validate. */
export class ContentError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    super(`The content has ${issues.length} issue(s): ${issues.map((issue) => `${issue.file} ${issue.code} at ${issue.path}`).join('; ')}`);
    this.name = 'ContentError';
    this.issues = issues;
  }
}

type Files = Readonly<Record<string, unknown>>;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `parts/level-1/dc-motor.json` from the glob key `../parts/level-1/dc-motor.json`. */
const fileOf = (key: string): string => key.replace(/^\.\.\//, '');
const nameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1).replace(/\.json$/, '');

/** Validates each file, in path order. A record must sit in a file named by its id, so ids never repeat. */
const records = <T extends { readonly id: string }>(files: Files, validate: (value: unknown) => ValidationResult<T>, issues: ContentIssue[]): T[] => {
  const found = new Map<string, T>();
  for (const key of Object.keys(files).sort(compareText)) {
    const file = fileOf(key);
    const result = validate(files[key]);
    if (!result.ok) {
      issues.push(...result.issues.map((issue) => ({ ...issue, file })));
    } else if (result.value.id !== nameOf(file)) {
      issues.push({ code: 'value.inconsistent', path: '$.id', message: `The file is named '${nameOf(file)}' but holds '${result.value.id}'.`, file });
    } else if (found.has(result.value.id)) {
      issues.push({ code: 'id.duplicate', path: '$.id', message: `Another file already holds '${result.value.id}'.`, file });
    } else {
      found.set(result.value.id, result.value);
    }
  }
  return [...found.values()].sort((a, b) => compareText(a.id, b.id));
};

/** The swap registry: art/generated/registry.json maps each asset key to `{ src, isPlaceholder }`, `src` relative to art/. */
const artRegistry = (registries: Files, urls: Readonly<Record<string, string>>, issues: ContentIssue[]): ArtRegistry => {
  const art = new Map<AssetKey, ArtEntry>();
  for (const [key, registry] of Object.entries(registries)) {
    const file = fileOf(key);
    if (!isRecord(registry)) {
      issues.push({ code: 'value.wrong_type', path: '$', message: 'The registry maps asset keys to { src, isPlaceholder }.', file });
      continue;
    }
    for (const asset of Object.keys(registry).sort(compareText)) {
      const entry = registry[asset];
      const path = `$['${asset}']`;
      if (!isRecord(entry) || typeof entry.src !== 'string' || typeof entry.isPlaceholder !== 'boolean') {
        issues.push({ code: 'value.wrong_type', path, message: 'An entry is { src, isPlaceholder }.', file });
        continue;
      }
      const src = urls[`../art/${entry.src}`];
      if (src === undefined) issues.push({ code: 'value.missing', path: `${path}.src`, message: `There is no file art/${entry.src}.`, file });
      else art.set(asset, { src, isPlaceholder: entry.isPlaceholder });
    }
  }
  return art;
};

let loaded: ContentResult | undefined;

/** Loads and validates every record once, with every issue and its file. Never throws. */
export const loadContent = (): ContentResult => {
  if (loaded) return loaded;
  const issues: ContentIssue[] = [];
  const parts = records(import.meta.glob('../parts/*/*.json', { eager: true, import: 'default' }), validatePartRecord, issues);
  const arenas = records(import.meta.glob('../arenas/*.json', { eager: true, import: 'default' }), validateArenaPreset, issues);
  const partsAndArenas = makeCatalogue({ parts, arenas });
  const kits = records(import.meta.glob('../kits/*.json', { eager: true, import: 'default' }), (value) => validateKit(value, partsAndArenas), issues);
  const catalogue = makeCatalogue({ parts, arenas, kits });
  const challengeFiles = import.meta.glob('../challenges/*/*.json', { eager: true, import: 'default' });
  const challenges = records(challengeFiles, (value) => validateChallenge(value, catalogue), issues);
  const terminologyFiles: Files = import.meta.glob('../terminology/*.json', { eager: true, import: 'default' });
  const terminology = Object.keys(terminologyFiles)
    .sort(compareText)
    .map((key) => ({ id: nameOf(fileOf(key)), data: terminologyFiles[key] }));
  const art = artRegistry(import.meta.glob('../art/generated/registry.json', { eager: true, import: 'default' }), {
    ...import.meta.glob<string>('../art/**/*.svg', { eager: true, query: '?url', import: 'default' }),
    ...import.meta.glob<string>('../art/**/*.png', { eager: true, query: '?url', import: 'default' }),
    ...import.meta.glob<string>('../art/**/*.webp', { eager: true, query: '?url', import: 'default' }),
  }, issues);
  loaded = issues.length > 0 ? { ok: false, issues } : { ok: true, value: { parts, arenas, kits, challenges, catalogue, terminology, art } };
  return loaded;
};

const content = (): Content => {
  const result = loadContent();
  if (!result.ok) throw new ContentError(result.issues);
  return result.value;
};

/** Parts, arenas and kits by id. Throws a ContentError when any content does not validate. */
export const loadCatalogue = (): Catalogue => content().catalogue;
export const loadParts = (): readonly PartRecord[] => content().parts;
export const loadArenas = (): readonly ArenaPreset[] => content().arenas;
export const loadKits = (): readonly Kit[] => content().kits;
export const loadChallenges = (): readonly Challenge[] => content().challenges;
export const loadTerminology = (): readonly TerminologyFile[] => content().terminology;
export const loadArtRegistry = (): ArtRegistry => content().art;

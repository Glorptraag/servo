import fs from 'node:fs';
import path from 'node:path';

/** The kinds of record the validator checks, each with its schema validator. */
export const RECORD_KINDS = ['part', 'arena', 'kit', 'challenge', 'blueprint', 'run-record'] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

/** What each kind is called in messages. */
export const KIND_LABELS: Readonly<Record<RecordKind, string>> = {
  part: 'part record',
  arena: 'arena preset',
  kit: 'kit',
  challenge: 'challenge',
  blueprint: 'blueprint',
  'run-record': 'run record',
};

/** Folder names that say what the records inside are. The nearest one above a file decides its kind. */
export const KIND_FOLDERS: ReadonlyMap<string, RecordKind> = new Map([
  ['parts', 'part'],
  ['arenas', 'arena'],
  ['kits', 'kit'],
  ['challenges', 'challenge'],
  ['blueprints', 'blueprint'],
  ['run-records', 'run-record'],
]);

/**
 * The shape check, for a file below no record folder: top-level fields that only one kind of record has.
 * A file is the kind whose fields it has; with none, or the fields of several kinds, its kind is unknown.
 */
export const KIND_FIELDS: Readonly<Record<RecordKind, readonly string[]>> = {
  part: ['identity', 'body', 'ports', 'needs', 'behaviour', 'failureModes', 'card'],
  arena: ['walls', 'zones', 'lines', 'ramps'],
  kit: ['tray'],
  challenge: ['title', 'goalLine', 'introduces'],
  blueprint: ['wires', 'meta'],
  'run-record': ['blueprintId', 'seed', 'tickRate', 'runNumber', 'inputs', 'faults', 'fixed'],
};

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An own property, or undefined; inherited names such as `constructor` never count. */
export const field = (value: unknown, key: string): unknown => (isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined);

/** Code-unit order, the same on every engine and locale. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The folders above a file, from the top down: below the repository root when the file is inside it, so
 * folders above the checkout never count; otherwise every folder of its absolute path.
 */
export const foldersOf = (file: string, repoRoot: string): string[] => {
  const folder = path.dirname(path.resolve(file));
  const relative = path.relative(path.resolve(repoRoot), folder);
  const inside = relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  return (inside ? relative : folder).split(path.sep).filter((name) => name !== '');
};

/** The kind the nearest record folder gives, if any. */
export const kindFromFolders = (folders: readonly string[]): RecordKind | undefined =>
  folders.toReversed().map((name) => KIND_FOLDERS.get(name)).find((kind) => kind !== undefined);

/** The kinds whose fields a value has. */
export const kindsFromFields = (value: unknown): RecordKind[] =>
  isRecord(value) ? RECORD_KINDS.filter((kind) => KIND_FIELDS[kind].some((key) => Object.hasOwn(value, key))) : [];

export type Classification =
  | { readonly kind: RecordKind; readonly by: 'folder' | 'fields' }
  | { readonly kind: undefined; readonly candidates: readonly RecordKind[] };

/** A record's kind: from its folder, or from its fields when no record folder is above it. */
export const classify = (file: string, value: unknown, repoRoot: string): Classification => {
  const fromFolder = kindFromFolders(foldersOf(file, repoRoot));
  if (fromFolder) return { kind: fromFolder, by: 'folder' };
  const candidates = kindsFromFields(value);
  const [only] = candidates;
  return only !== undefined && candidates.length === 1 ? { kind: only, by: 'fields' } : { kind: undefined, candidates };
};

/** Folders the walk leaves out: dependencies, hidden folders, and the terminology lists (read separately). */
export const isSkippedFolder = (name: string): boolean => name.startsWith('.') || name === 'node_modules' || name === 'terminology';

/** Package configuration, not content: `package.json` and `tsconfig*.json`. */
export const isConfigFile = (name: string): boolean => name === 'package.json' || /^tsconfig(?:\.[^/\\]+)?\.json$/.test(name);

const errorCode = (error: unknown): string => (isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error');

/**
 * The record files a path names: the file itself, or every `.json` file in a folder and its subfolders, in
 * code-unit order of their names. Skipped folders, configuration files and symbolic links are left out. A
 * folder that cannot be listed is passed to `unlisted` and skipped. The path must exist.
 */
export const findRecordFiles = (target: string, unlisted: (folder: string, code: string) => void = () => undefined): string[] => {
  if (!fs.statSync(target).isDirectory()) return [path.resolve(target)];
  const files: string[] = [];
  const visit = (folder: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name));
    } catch (error) {
      unlisted(folder, errorCode(error));
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedFolder(entry.name)) visit(full);
      } else if (entry.isFile() && entry.name.endsWith('.json') && !isConfigFile(entry.name)) {
        files.push(full);
      }
    }
  };
  visit(path.resolve(target));
  return files;
};

export type ReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: 'file.unreadable' | 'file.bad_json'; readonly message: string };

const sentence = (text: string): string => (/[.?]$/.test(text) ? text : `${text}.`);

/** Reads and parses one JSON file. Never throws. A leading byte-order mark is ignored. */
export const readJson = (file: string): ReadResult => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { ok: false, code: 'file.unreadable', message: `Could not read the file (${errorCode(error)}).` };
  }
  try {
    return { ok: true, value: JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text) as unknown };
  } catch (error) {
    return { ok: false, code: 'file.bad_json', message: sentence(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`) };
  }
};

/** readJson with each file read once per run, so a file in both the catalogue and the checked paths is read once. */
export const cachedReader = (): ((file: string) => ReadResult) => {
  const cache = new Map<string, ReadResult>();
  return (file) => {
    const key = path.resolve(file);
    const cached = cache.get(key);
    if (cached) return cached;
    const result = readJson(key);
    cache.set(key, result);
    return result;
  };
};

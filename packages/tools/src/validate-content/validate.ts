import fs from 'node:fs';
import path from 'node:path';
import {
  validateArenaPreset,
  validateBlueprint,
  validateChallenge,
  validateKit,
  validatePartRecord,
  validateRunRecord,
} from '@servo/schema';
import type { Catalogue, Issue, ValidationResult } from '@servo/schema';
import { catalogueFromFixtures, catalogueFromFolder } from './catalogue.ts';
import type { CatalogueSource } from './catalogue.ts';
import type { ContentIssue } from './codes.ts';
import { cachedReader, classify, field, findRecordFiles, KIND_FOLDERS, KIND_LABELS } from './records.ts';
import type { RecordKind } from './records.ts';
import { systemText } from './system-text.ts';
import { bannedFindings, compileTerminology, loadTerminology, partNameFindings, TERMINOLOGY_FILES } from './terminology.ts';

export interface ValidateContentOptions {
  /** Record files, or folders to search for `.json` records: absolute, or relative to the process's working folder. */
  readonly paths: readonly string[];
  /** The repository root. Record folders (parts/, kits/ and so on) count only below it, for files inside it. */
  readonly repoRoot: string;
  /** The terminology folder, holding `components.json` and `banned.json`. A missing folder or file is an empty list. */
  readonly terminology: string;
  /**
   * The folder whose parts, arenas and kits form the catalogue. With `fallBackToFixtures`, a folder that holds
   * no part record file at all is replaced by the schema's example records (`@servo/schema/fixtures`).
   */
  readonly catalogue: { readonly folder: string; readonly fallBackToFixtures: boolean };
  /** How a path is written in notes. Defaults to the absolute path. */
  readonly show?: (file: string) => string;
}

export interface ContentReport {
  /** The record files checked, in the order they were checked. */
  readonly files: readonly string[];
  /** Every issue found: paths that cannot be read, then the terminology files, then the records file by file. */
  readonly issues: readonly ContentIssue[];
  /** What the run could not check, and where its catalogue came from. */
  readonly notes: readonly string[];
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const checkRecord = (kind: RecordKind, value: unknown, catalogue: () => Catalogue): ValidationResult<unknown> => {
  switch (kind) {
    case 'part':
      return validatePartRecord(value);
    case 'arena':
      return validateArenaPreset(value);
    case 'kit':
      return validateKit(value, catalogue());
    case 'challenge':
      return validateChallenge(value, catalogue());
    case 'blueprint':
      return validateBlueprint(value, catalogue());
    case 'run-record':
      return validateRunRecord(value, catalogue());
  }
};

const unknownKind = (candidates: readonly RecordKind[]): string => {
  const folders = [...KIND_FOLDERS.keys()].map((name) => `${name}/`).join(', ');
  const what =
    candidates.length === 0
      ? 'Its kind is unknown: it is in no record folder and has the fields of no record.'
      : `Its kind is unknown: it is in no record folder and has fields of more than one kind (${candidates.map((kind) => KIND_LABELS[kind]).join(', ')}).`;
  return `${what} Put it in one of ${folders}.`;
};

/**
 * Checks content records: each against the schema's validator for its kind, its text against the
 * terminology lists, and its id against the other records of its kind. Never throws on bad content;
 * every problem is an issue. See README.md.
 */
export const validateContent = (options: ValidateContentOptions): ContentReport => {
  const show = options.show ?? ((file: string) => file);
  const read = cachedReader();
  const issues: ContentIssue[] = [];
  const notes: string[] = [];

  const found = new Set<string>();
  const unlisted = (folder: string, code: string): void => {
    issues.push({ file: folder, code: 'file.unreadable', path: '$', message: `Could not list the folder (${code}).` });
  };
  for (const target of options.paths) {
    if (fs.existsSync(target)) {
      for (const file of findRecordFiles(target, unlisted)) found.add(file);
    } else {
      issues.push({ file: path.resolve(target), code: 'file.unreadable', path: '$', message: 'No such file or folder.' });
    }
  }
  const files = [...found];

  const terminology = loadTerminology(options.terminology);
  issues.push(...terminology.issues);
  const matcher = compileTerminology(terminology.terminology);
  const componentsFile = path.join(options.terminology, TERMINOLOGY_FILES.components);
  const bannedFile = path.join(options.terminology, TERMINOLOGY_FILES.banned);
  if (terminology.missing.includes(componentsFile)) {
    notes.push(`No components list at ${show(componentsFile)}, so part names are not checked against real component names.`);
  } else if (terminology.terminology.components.length === 0) {
    notes.push(`The components list at ${show(componentsFile)} names no components, so part names are not checked.`);
  }
  if (terminology.missing.includes(bannedFile)) {
    notes.push(`No banned list at ${show(bannedFile)}, so text is not checked for banned words.`);
  } else if (terminology.terminology.banned.length === 0) {
    notes.push(`The banned list at ${show(bannedFile)} bans nothing, so text is not checked for banned words.`);
  }

  let source: CatalogueSource | undefined;
  const catalogue = (): Catalogue => {
    if (source) return source.catalogue;
    const fromFolder = catalogueFromFolder(options.catalogue.folder, options.repoRoot, read);
    source = options.catalogue.fallBackToFixtures && fromFolder.partFiles === 0 ? catalogueFromFixtures() : fromFolder;
    return source.catalogue;
  };

  const firstWithId = new Map<string, string>();
  for (const file of files) {
    const result = read(file);
    if (!result.ok) {
      issues.push({ file, code: result.code, path: '$', message: result.message });
      continue;
    }
    const classification = classify(file, result.value, options.repoRoot);
    if (classification.kind === undefined) {
      issues.push({ file, code: 'file.unknown_kind', path: '$', message: unknownKind(classification.candidates) });
      continue;
    }
    const { kind } = classification;
    const checked = checkRecord(kind, result.value, catalogue);
    if (!checked.ok) issues.push(...checked.issues.map((issue: Issue) => ({ file, ...issue })));
    for (const text of systemText(kind, result.value)) {
      const findings = [...bannedFindings(text.text, matcher), ...(text.partName ? partNameFindings(text.text, matcher) : [])];
      issues.push(...findings.map((finding) => ({ file, path: text.path, ...finding })));
    }
    // Only records that pass the schema claim their id, as only they can enter a catalogue.
    const id = checked.ok ? field(result.value, 'id') : undefined;
    if (typeof id === 'string') {
      const key = `${kind} ${id}`;
      const first = firstWithId.get(key);
      if (first === undefined) firstWithId.set(key, file);
      else {
        issues.push({
          file,
          code: 'content.duplicate_id',
          path: '$.id',
          message: `Another ${KIND_LABELS[kind]} already uses the id '${id}': ${show(first)}.`,
        });
      }
    }
  }

  if (source) {
    const counts = `${plural(source.counts.parts, 'part record')}, ${plural(source.counts.arenas, 'arena preset')} and ${plural(source.counts.kits, 'kit')}`;
    notes.push(
      source.folder === undefined
        ? `Catalogue: ${counts} from @servo/schema/fixtures, because ${show(options.catalogue.folder)} holds no part records.`
        : `Catalogue: ${counts} from ${show(source.folder)}.`,
    );
    for (const file of source.leftOut) {
      if (!found.has(file)) notes.push(`The catalogue leaves out ${show(file)}, which cannot be read or does not validate.`);
    }
  }
  return { files, issues, notes };
};

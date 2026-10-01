import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validatePartRecord } from '@servo/schema';
import type { AssetKey, PartRecord } from '@servo/schema';
import {
  ArtError,
  REGISTRY_FILE,
  buildRegistry,
  listFiles,
  placeholderPath,
  resolveRegistry,
  writeRegistry,
} from '../swap-registry/index.ts';
import type { ArtRegistry, UnusedFinal } from '../swap-registry/index.ts';
import { placeholderSvg } from './svg.ts';

/** The folders `pnpm art` reads and writes. */
export interface ArtOptions {
  /** Part records: every `.json` file under this folder, at any depth. */
  readonly parts: string;
  /** The generated folder: one placeholder per art key, and registry.json. */
  readonly out: string;
  /** The folder final renders are dropped into, as `<art key>.<type>`. */
  readonly final: string;
}

export const DEFAULT_ART_OPTIONS: ArtOptions = {
  parts: fileURLToPath(new URL('../../../content/parts/', import.meta.url)),
  out: fileURLToPath(new URL('../../../content/art/generated/', import.meta.url)),
  final: fileURLToPath(new URL('../../../content/art/final/', import.meta.url)),
};

export const ART_USAGE = [
  'Usage: pnpm art [--parts <folder>] [--out <folder>] [--final <folder>]',
  'Draws one placeholder SVG per part record and writes registry.json beside them.',
  'Defaults: --parts packages/content/parts --out packages/content/art/generated --final packages/content/art/final',
].join('\n');

export interface ArtReport {
  /** How many part records were read. */
  readonly records: number;
  /** The placeholders written, relative to the generated folder. */
  readonly placeholders: readonly string[];
  readonly registry: ArtRegistry;
  /** Files in the final folder that no key uses. */
  readonly unused: readonly UnusedFinal[];
}

/** A path as a person reads it: relative to the working folder when it is inside it. */
const show = (folder: string): string => {
  const relative = path.relative(process.cwd(), folder);
  if (relative === '') return '.';
  return relative.startsWith('..') || path.isAbsolute(relative) ? folder : relative;
};

const isInside = (inner: string, outer: string): boolean => {
  const relative = path.relative(outer, inner);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const NO_RECORDS_HELP =
  'Part records are JSON files under packages/content/parts/ (tasks 2.1 and 2.2 add them). To draw others, pass --parts <folder>, for example --parts packages/schema/fixtures/parts.';

interface ReadRecord {
  readonly file: string;
  readonly record: PartRecord;
}

/** Reads and validates every part record under the folder, in path order. Throws an ArtError listing every problem. */
const readPartRecords = (folder: string): ReadRecord[] => {
  if (!fs.existsSync(folder)) throw new ArtError(`No part records: ${show(folder)} does not exist.`, [NO_RECORDS_HELP]);
  const files = listFiles(folder).filter((file) => file.endsWith('.json'));
  if (files.length === 0) throw new ArtError(`No part records: ${show(folder)} has no .json files.`, [NO_RECORDS_HELP]);
  const problems: string[] = [];
  const records: ReadRecord[] = [];
  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
    } catch (error) {
      problems.push(`${file}: not readable as JSON (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const result = validatePartRecord(data);
    if (result.ok) records.push({ file, record: result.value });
    else for (const issue of result.issues) problems.push(`${file} ${issue.path}: ${issue.message} (${issue.code})`);
  }
  if (problems.length > 0) throw new ArtError(`Some part records under ${show(folder)} are not valid, so no art was written.`, problems);
  return records;
};

/**
 * Regenerates the art: reads every part record under `options.parts`, writes one placeholder SVG per art
 * key into `options.out`, then resolves every key (final render first, else placeholder) and writes
 * registry.json there. Throws an ArtError, with every problem listed and nothing written, when a record
 * is invalid, two parts share a key but draw differently, the folders overlap, `options.out` holds other
 * files, or a key has two final renders. Files from earlier runs are never deleted.
 */
export const generateArt = (options: ArtOptions): ArtReport => {
  const records = readPartRecords(options.parts);

  const tiles = new Map<AssetKey, { readonly file: string; readonly svg: string }>();
  const problems: string[] = [];
  for (const { file, record } of records) {
    const key = record.identity.art;
    const svg = placeholderSvg(record);
    const earlier = tiles.get(key);
    if (earlier === undefined) tiles.set(key, { file, svg });
    else if (earlier.svg !== svg) {
      problems.push(`${earlier.file} and ${file} both use the art key '${key}' but draw different placeholders. One key holds one picture.`);
    }
  }
  if (problems.length > 0) throw new ArtError('Some parts share an art key, so no art was written.', problems);

  if (isInside(options.out, options.final) || isInside(options.final, options.out)) {
    throw new ArtError('The generated and final folders overlap, so no art was written.', [
      `--out ${show(options.out)} and --final ${show(options.final)} must be separate, or a placeholder could pass for a final render.`,
    ]);
  }
  const strangers = listFiles(options.out).filter((file) => file !== REGISTRY_FILE && !file.endsWith('.svg'));
  if (strangers.length > 0) {
    const listed = strangers.slice(0, 5).map((file) => `${file} is not a placeholder or ${REGISTRY_FILE}`);
    if (strangers.length > 5) listed.push(`and ${strangers.length - 5} more`);
    throw new ArtError(`${show(options.out)} holds files pnpm art does not write, so no art was written there.`, [
      ...listed,
      'Point --out at the generated folder, which holds only what pnpm art writes.',
    ]);
  }

  const keys = [...tiles.keys()].sort();
  // The final renders are checked before anything is written, counting every placeholder as drawn.
  resolveRegistry({ keys, generated: keys.map(placeholderPath), finals: listFiles(options.final), finalFromGenerated: '' });
  for (const [key, { svg }] of tiles) {
    const file = path.join(options.out, placeholderPath(key));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, svg);
  }
  const { registry, unused } = buildRegistry({ keys, generatedFolder: options.out, finalFolder: options.final });
  writeRegistry(options.out, registry);
  return { records: records.length, placeholders: keys.map(placeholderPath), registry, unused };
};

/** Reads `--parts`, `--out` and `--final` (each `--name folder` or `--name=folder`), resolved against `cwd`. */
export const parseArtArgs = (args: readonly string[], cwd: string): ArtOptions => {
  const options: { parts: string; out: string; final: string } = { ...DEFAULT_ART_OPTIONS };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--') continue;
    const match = /^--(parts|out|final)(?:=(.*))?$/.exec(arg);
    const name = match?.[1];
    if (name !== 'parts' && name !== 'out' && name !== 'final') throw new ArtError(`Unknown argument '${arg}'.`, [ART_USAGE]);
    let value = match?.[2];
    if (value === undefined) {
      index += 1;
      value = args[index];
    }
    if (value === undefined || value === '' || value.startsWith('--')) throw new ArtError(`--${name} needs a folder.`, [ART_USAGE]);
    options[name] = path.resolve(cwd, value);
  }
  return options;
};

export interface ArtConsole {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

/** `pnpm art`: returns the exit code. Problems a person can fix are printed, not thrown. */
export const runArt = (args: readonly string[], cwd: string, output: ArtConsole): number => {
  if (args.includes('--help') || args.includes('-h')) {
    output.log(ART_USAGE);
    return 0;
  }
  try {
    const options = parseArtArgs(args, cwd);
    const report = generateArt(options);
    const entries = Object.values(report.registry);
    const finals = entries.filter((entry) => !entry.isPlaceholder).length;
    output.log(`Read ${report.records} part records from ${show(options.parts)}.`);
    output.log(`Wrote ${report.placeholders.length} placeholders and ${REGISTRY_FILE} to ${show(options.out)}.`);
    output.log(`${entries.length} art keys: ${entries.length - finals} show the placeholder, ${finals} a final render from ${show(options.final)}.`);
    for (const { file, reason } of report.unused) output.error(`Not used: ${file} in ${show(options.final)}: ${reason}.`);
    return 0;
  } catch (error) {
    if (!(error instanceof ArtError)) throw error;
    output.error(error.message);
    return 1;
  }
};

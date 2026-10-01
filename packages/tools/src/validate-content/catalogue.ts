import fs from 'node:fs';
import { makeCatalogue, validateArenaPreset, validateKit, validatePartRecord } from '@servo/schema';
import type { ArenaPreset, Catalogue, Kit, PartRecord, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validKits } from '@servo/schema/fixtures';
import { classify, findRecordFiles } from './records.ts';
import type { ReadResult, RecordKind } from './records.ts';

/** The parts, arenas and kits that kits, challenges, blueprints and run records are checked against. */
export interface CatalogueSource {
  readonly catalogue: Catalogue;
  readonly counts: { readonly parts: number; readonly arenas: number; readonly kits: number };
  /** The folder it was built from; undefined when it is the schema's example records. */
  readonly folder?: string;
  /** How many files in the folder are part records, whether or not they validate; 0 for the schema's examples. */
  readonly partFiles: number;
  /** Part, arena and kit files in the folder that are left out because they cannot be read or do not validate. */
  readonly leftOut: readonly string[];
}

const valid = <T>(results: readonly ValidationResult<T>[]): T[] => results.flatMap((result) => (result.ok ? [result.value] : []));

const sourceOf = (parts: readonly PartRecord[], arenas: readonly ArenaPreset[], kits: readonly Kit[]) => ({
  catalogue: makeCatalogue({ parts, arenas, kits }),
  counts: { parts: parts.length, arenas: arenas.length, kits: kits.length },
});

/**
 * Builds a catalogue from every part record, arena preset and kit in a folder and its subfolders, classified
 * the same way as checked records. Only records that validate are taken: kits are checked against the
 * folder's own parts and arenas. When two records share an id, the first in walk order wins. A missing
 * folder gives an empty catalogue.
 */
export const catalogueFromFolder = (folder: string, repoRoot: string, read: (file: string) => ReadResult): CatalogueSource => {
  const found: Record<'part' | 'arena' | 'kit', { readonly file: string; readonly value: unknown }[]> = { part: [], arena: [], kit: [] };
  const leftOut: string[] = [];
  let partFiles = 0;
  const isCatalogueKind = (kind: RecordKind | undefined): kind is 'part' | 'arena' | 'kit' =>
    kind === 'part' || kind === 'arena' || kind === 'kit';
  for (const file of fs.existsSync(folder) ? findRecordFiles(folder) : []) {
    const result = read(file);
    const { kind } = classify(file, result.ok ? result.value : undefined, repoRoot);
    if (!isCatalogueKind(kind)) continue;
    if (kind === 'part') partFiles += 1;
    if (result.ok) found[kind].push({ file, value: result.value });
    else leftOut.push(file);
  }
  const take = <T>(entries: readonly { readonly file: string; readonly value: unknown }[], check: (value: unknown) => ValidationResult<T>): T[] =>
    entries.flatMap(({ file, value }) => {
      const result = check(value);
      if (result.ok) return [result.value];
      leftOut.push(file);
      return [];
    });
  const parts = take(found.part, validatePartRecord);
  const arenas = take(found.arena, validateArenaPreset);
  const kits = take(found.kit, (value) => validateKit(value, makeCatalogue({ parts, arenas })));
  return { ...sourceOf(parts, arenas, kits), folder, partFiles, leftOut: leftOut.toSorted() };
};

/** The schema's example parts, arenas and valid kits (`@servo/schema/fixtures`). */
export const catalogueFromFixtures = (): CatalogueSource => {
  const parts = valid(exampleParts.map((part) => validatePartRecord(part)));
  const arenas = valid(exampleArenas.map((arena) => validateArenaPreset(arena)));
  const kits = valid(validKits.map((kit) => validateKit(kit.data, makeCatalogue({ parts, arenas }))));
  return { ...sourceOf(parts, arenas, kits), partFiles: 0, leftOut: [] };
};

/// <reference types="vite/client" />
// @servo/content/fixtures: the fixture blueprints tests run (task 2.6), kept out of the app bundle. Each is a bare
// blueprint in fixtures/blueprints/<name>.json, which the content validator checks as a blueprint; what it is for
// lives in FIXTURE_NOTES below, because a wrapper around a blueprint would not be one. See ../README.md.

import { validateBlueprint } from '@servo/schema';
import type { Blueprint, Catalogue, FailureModeId, IssueCode, PlacedPartId, PortRef } from '@servo/schema';
import { loadContent } from './index.ts';
import type { ContentIssue } from './index.ts';

/** What a Run of the fixture shows. */
export type FixtureOutcome =
  /** It runs with no fault. */
  | { readonly kind: 'works' }
  /** It runs with exactly this one fault. */
  | { readonly kind: 'fault'; readonly partId: PlacedPartId; readonly failure: FailureModeId }
  /** The build before an impossible drop: this wire is refused at the socket with `code`. */
  | { readonly kind: 'refused'; readonly from: PortRef; readonly to: PortRef; readonly code: IssueCode };

export interface FixtureNote {
  /** One line for test names. */
  readonly description: string;
  readonly outcome: FixtureOutcome;
}

/** One note per fixture blueprint, keyed by its file name without `.json`. Task 2.6 writes them with the files. */
export const FIXTURE_NOTES: Readonly<Record<string, FixtureNote>> = {};

export interface BlueprintFixture extends FixtureNote {
  /** The file name without `.json`. */
  readonly name: string;
  readonly blueprint: Blueprint;
}

export interface FixtureLoad {
  /** In name order. */
  readonly fixtures: readonly BlueprintFixture[];
  readonly issues: readonly ContentIssue[];
}

const FOLDER = 'fixtures/blueprints';

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure: pairs each fixture file (keyed by its path inside packages/content) with its note, and checks it against
 * the catalogue. A file without a note, a note without a file, and a blueprint that does not validate are issues.
 */
export const fixturesFrom = (files: Readonly<Record<string, unknown>>, notes: Readonly<Record<string, FixtureNote>>, catalogue: Catalogue): FixtureLoad => {
  const fixtures: BlueprintFixture[] = [];
  const issues: ContentIssue[] = [];
  const names = new Set<string>();
  for (const file of Object.keys(files).sort(compareText)) {
    const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.json$/, '');
    names.add(name);
    const note = Object.hasOwn(notes, name) ? notes[name] : undefined;
    const result = validateBlueprint(Object.hasOwn(files, file) ? files[file] : undefined, catalogue);
    if (!note) issues.push({ file, code: 'value.missing', path: '$', message: `FIXTURE_NOTES has no note for '${name}'.` });
    if (!result.ok) issues.push(...result.issues.map((issue) => ({ file, ...issue })));
    else if (note) fixtures.push({ ...note, name, blueprint: result.value });
  }
  for (const name of Object.keys(notes).sort(compareText)) {
    if (!names.has(name)) issues.push({ file: `${FOLDER}/${name}.json`, code: 'value.missing', path: '$', message: `A note names '${name}', but there is no such file.` });
  }
  return { fixtures, issues };
};

/** The package's fixture blueprints, checked against its own content. Never throws. */
export const loadBlueprintFixtures = (): FixtureLoad =>
  fixturesFrom(
    Object.fromEntries(
      Object.entries(import.meta.glob('../fixtures/blueprints/*.json', { eager: true, import: 'default' })).map(([key, value]) => [key.replace(/^\.\.\//, ''), value]),
    ),
    FIXTURE_NOTES,
    loadContent().content.catalogue,
  );

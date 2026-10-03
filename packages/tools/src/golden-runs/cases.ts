// The Runs the harness keeps references for: every content fixture with its own seed, inputs and ticks, and every
// valid schema blueprint under one fixed protocol. `readContentFixtures` reads content from disk, as `loadFixtures()`
// does through Vite, so the command runs under plain Node.
import fs from 'node:fs';
import path from 'node:path';
import { contentFrom } from '@servo/content';
import type { Content } from '@servo/content';
import { FIXTURES, fixturesFrom } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import { makeCatalogue, validateArenaPreset, validatePartRecord } from '@servo/schema';
import type { Blueprint, Catalogue, PartRecord, RunInput, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { findRecordFiles, readJson } from '../validate-content/records.ts';
import type { GoldenCase } from './run.ts';

/**
 * How a schema blueprint runs, since it carries no seed, inputs or ticks: task 1.5's determinism sweep, so both
 * replay the same Runs. One simulated second, every manual switch opened at tick 10 and closed again at tick 20.
 */
export const SCHEMA_PROTOCOL = { seed: 2026, ticks: 30, open: 10, close: 20 } as const;

export const contentCase = (fixture: ContentFixture, catalogue: Catalogue): GoldenCase => ({
  id: `content/${fixture.name}`,
  blueprint: fixture.blueprint,
  catalogue,
  seed: fixture.seed,
  inputs: fixture.inputs,
  ticks: fixture.ticks,
  ...(fixture.challenge === undefined ? {} : { challenge: fixture.challenge }),
  expect: fixture.expect,
});

const unwrap = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`The schema's ${what} does not validate: ${result.issues.map((issue) => issue.message).join(' ')}`);
  return result.value;
};

/** The schema's valid blueprints (`@servo/schema/fixtures`), on its example parts and arenas, under SCHEMA_PROTOCOL. */
export const schemaCases = (): GoldenCase[] => {
  const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part), 'example part'));
  const catalogue = makeCatalogue({ parts, arenas: exampleArenas.map((arena) => unwrap(validateArenaPreset(arena), 'example arena')) });
  const manual = (type: string): boolean =>
    parts.find((record) => record.id === type)?.behaviour.some((primitive) => primitive.kind === 'switch' && primitive.actuation.kind === 'manual') === true;
  return validBlueprints.map((entry) => {
    const blueprint = entry.data as Blueprint;
    const switches = blueprint.parts.filter((part) => manual(part.part)).map((part) => part.id);
    const inputs = [SCHEMA_PROTOCOL.open, SCHEMA_PROTOCOL.close].flatMap((tick, index) =>
      switches.map((partId): RunInput => ({ tick, partId, kind: 'switch', closed: index === 1 })),
    );
    return { id: `schema/${entry.name}`, blueprint, catalogue, seed: SCHEMA_PROTOCOL.seed, inputs, ticks: SCHEMA_PROTOCOL.ticks };
  });
};

/** Content and its fixtures, read from disk. */
export interface ContentOnDisk {
  readonly content: Content;
  readonly fixtures: readonly ContentFixture[];
  /** One line for each issue in the content or the fixtures, as `<file>: <code> at <path>: <message>`. */
  readonly issues: readonly string[];
}

const FIXTURE_BLUEPRINTS = 'fixtures/blueprints';

/**
 * Reads packages/content from disk with what `loadContent()` and `loadFixtures()` read through import.meta.glob: every
 * record outside art/, fixtures/, test/ and terminology/, and the blueprints in fixtures/blueprints/. A file that is not
 * JSON is an issue here, where Vite's import would fail.
 */
export const readContentFixtures = (contentDir: string): ContentOnDisk => {
  const issues: string[] = [];
  const inside = (file: string): string => path.relative(contentDir, file).split(path.sep).join('/');
  const read = (file: string): unknown => {
    const result = readJson(file);
    if (result.ok) return result.value;
    issues.push(`${inside(file)}: ${result.code} at $: ${result.message}`);
    return undefined;
  };
  const records: Record<string, unknown> = {};
  for (const file of findRecordFiles(contentDir)) {
    const relative = inside(file);
    if (['fixtures/', 'test/'].some((folder) => relative.startsWith(folder))) continue;
    const value = read(file);
    if (value !== undefined) records[relative] = value;
  }
  const load = contentFrom({ records });
  const folder = path.join(contentDir, FIXTURE_BLUEPRINTS);
  const blueprints: Record<string, unknown> = {};
  const names = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name.endsWith('.json')).sort() : [];
  for (const name of names) {
    const value = read(path.join(folder, name));
    if (value !== undefined) blueprints[`${FIXTURE_BLUEPRINTS}/${name}`] = value;
  }
  const fixtures = fixturesFrom(blueprints, FIXTURES, load.content);
  const found = [...load.issues, ...fixtures.issues].map((issue) => `${issue.file}: ${issue.code} at ${issue.path}: ${issue.message}`);
  return { content: load.content, fixtures: fixtures.fixtures, issues: [...issues, ...found] };
};

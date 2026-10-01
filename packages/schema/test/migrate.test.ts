import { describe, expect, it } from 'vitest';
import { exampleChallenges, invalidBlueprints, v0Blueprints, validBlueprints } from '../src/fixtures.ts';
import {
  BLUEPRINT_VERSION,
  ISSUE_CODES,
  canonicalJson,
  canonicalizeBlueprint,
  migrateBlueprint,
  serializeBlueprint,
  validateBlueprint,
  validateBlueprintShape,
  validateChallenge,
} from '../src/index.ts';
import type { Blueprint, Issue, MigrationResult, ValidationResult } from '../src/index.ts';
import { BLUEPRINT_MIGRATIONS } from '../src/migrate/blueprint.ts';
import { runMigrations } from '../src/migrate/runner.ts';
import type { MigrationStep } from '../src/migrate/runner.ts';
import { catalogue, copy, issuesOf, reasons, unwrap } from './support.ts';

// The done-when suite for task 0.3: a version 0 fixture migrates to version 1, validates, and round-trips
// byte for byte. Each step is tested on its own in migrate-v0-to-v1.test.ts.

const raw = (files: Record<string, string>) =>
  Object.entries(files).map(([file, text]) => ({ name: file.slice(file.lastIndexOf('/') + 1, -'.json'.length), text }));
const stored = raw(import.meta.glob('../fixtures/v0/*.json', { query: '?raw', import: 'default', eager: true }));
const expected = raw(import.meta.glob('../fixtures/v0/migrated/*.json', { query: '?raw', import: 'default', eager: true }));
const textOf = (files: readonly { name: string; text: string }[], name: string): string => files.find((file) => file.name === name)?.text ?? '';
const v0Fixtures = v0Blueprints.map(({ name, data, migrated }) => ({
  name,
  data,
  migrated,
  text: textOf(stored, name),
  migratedText: textOf(expected, name),
}));

const migrated = (value: unknown): { readonly value: Blueprint; readonly from: number } => {
  const result = migrateBlueprint(value);
  if (!result.ok) throw new Error(`Expected a migration:\n${JSON.stringify(result.issues, null, 2)}`);
  return result;
};

/** The bytes the app saves: checked against the catalogue, then canonical form. */
const saved = (blueprint: Blueprint): string => serializeBlueprint(canonicalizeBlueprint(unwrap(validateBlueprint(blueprint, catalogue)), catalogue));

const outcome = <T>(result: MigrationResult<T> | ValidationResult<T>) => (result.ok ? { ok: true, value: result.value } : { ok: false, issues: result.issues });

describe('version 0 fixtures migrate to version 1, validate, and round-trip byte for byte', () => {
  it('exports every version 0 file in fixtures/v0, each with its migrated form, and no other', () => {
    expect(v0Blueprints.length).toBeGreaterThanOrEqual(1);
    const names = v0Blueprints.map((fixture) => fixture.name).sort();
    expect(stored.map((file) => file.name).sort()).toEqual(names);
    expect(expected.map((file) => file.name).sort()).toEqual(names);
    for (const fixture of v0Fixtures) {
      expect(canonicalJson(fixture.data)).toBe(fixture.text);
      expect(canonicalJson(fixture.migrated)).toBe(fixture.migratedText);
    }
  });

  it.each(v0Fixtures)('$name', ({ data, migratedText }) => {
    const result = migrated(data);
    expect(result.from).toBe(0);
    expect(result.value.version).toBe(BLUEPRINT_VERSION);
    expect(reasons(validateBlueprint(result.value, catalogue))).toEqual([]);

    // migrate → canonicalise → serialise gives the stored migrated form...
    const bytes = saved(result.value);
    expect(bytes).toBe(migratedText);
    // ...and parse → serialise gives the same bytes again.
    const parsed: unknown = JSON.parse(bytes);
    expect(serializeBlueprint(parsed as Blueprint)).toBe(bytes);

    // Loading the saved form runs no step and changes nothing.
    const reloaded = migrated(parsed);
    expect(reloaded.from).toBe(BLUEPRINT_VERSION);
    expect(reloaded.value).toBe(parsed);
    expect(saved(reloaded.value)).toBe(bytes);
  });

  it('gives the same bytes every time, so it can run on every load without saving', () => {
    for (const { text } of v0Fixtures) {
      expect(saved(migrated(JSON.parse(text)).value)).toBe(saved(migrated(JSON.parse(text)).value));
    }
  });

  it('leaves a directional wire written backwards in version 0 for validateBlueprint to refuse, at the same path', () => {
    const v0 = JSON.parse(v0Fixtures.find((entry) => entry.name === 'rolling-start')?.text ?? '') as { wires: { from: unknown; to: unknown }[] };
    const mount = v0.wires[0];
    if (mount) [mount.from, mount.to] = [mount.to, mount.from];
    expect(reasons(validateBlueprint(migrated(v0).value, catalogue))).toEqual(['wire.reversed at $.wires[0]']);
  });

  it('turns the Rolling Start robot stored as version 0 into the version 1 fixture, with a derived id', () => {
    const fixture = validBlueprints.find((entry) => entry.name === 'rolling-start')?.data as Blueprint;
    const v0 = v0Fixtures.find((entry) => entry.name === 'rolling-start');
    const blueprint = migrated(JSON.parse(v0?.text ?? '')).value;
    expect(blueprint.meta.id).not.toBe(fixture.meta.id);
    expect(saved(blueprint)).toBe(serializeBlueprint({ ...fixture, meta: { ...fixture.meta, id: blueprint.meta.id } }));
  });
});

describe('migrateBlueprint on current blueprints', () => {
  it.each(validBlueprints)('passes $name through as it is', ({ data }) => {
    const before = serializeBlueprint(data as Blueprint);
    const result = migrated(data);
    expect(result.from).toBe(1);
    expect(result.value).toBe(data);
    expect(serializeBlueprint(result.value)).toBe(before);
  });

  it.each(invalidBlueprints.filter((fixture) => fixture.name !== 'version-2'))('gives $name the same verdict as the structure check', ({ data }) => {
    expect(outcome(migrateBlueprint(data))).toEqual(outcome(validateBlueprintShape(data)));
  });
});

describe('the version field', () => {
  it.each([
    ['a newer version', 2],
    ['a much newer version', 1_000_000],
  ])('refuses %s with a named reason, never guessing', (_name, version) => {
    const document = { ...copy(validBlueprints[0]?.data as object), version };
    const before = copy(document);
    const result = migrateBlueprint(document);
    expect(reasons(result)).toEqual(['blueprint.newer_version at $.version']);
    expect(result.ok ? '' : result.issues[0]?.message).toContain(`version ${version}`);
    expect(document).toEqual(before);
  });

  it('reads a version written as -0 as version 0', () => {
    const v0 = v0Fixtures.find((entry) => entry.name === 'rolling-start')?.text ?? '';
    const negative = migrated(JSON.parse(v0.replace('"version": 0', '"version": -0')));
    expect(Object.is(negative.from, 0)).toBe(true);
    expect(negative.value.meta.id).toBe(migrated(JSON.parse(v0)).value.meta.id);
  });

  it.each([2, 3, 1_000_000])('gives version %i the same refusal from validateBlueprint as from migrateBlueprint', (version) => {
    const document = { ...copy(validBlueprints[0]?.data as object), version };
    const issues = issuesOf(validateBlueprint(document, catalogue));
    expect(issues).toEqual(issuesOf(migrateBlueprint(document)));
    expect(issues).toEqual([
      {
        code: 'blueprint.newer_version',
        path: '$.version',
        message: `This blueprint is from a newer version of Servo: it is version ${version}, and the newest this schema reads is version 1. It is refused, never guessed at.`,
      },
    ]);
    expect(issues[0]?.message).not.toContain('Migrate it first');
  });

  it('refuses the version 2 fixture as newer in both, with the same message', () => {
    const fixture = invalidBlueprints.find((entry) => entry.name === 'version-2');
    expect(reasons(validateBlueprint(fixture?.data, catalogue))).toEqual(['blueprint.newer_version at $.version']);
    expect(issuesOf(validateBlueprint(fixture?.data, catalogue))).toEqual(issuesOf(migrateBlueprint(fixture?.data)));
  });

  it('still tells validateBlueprint callers to migrate a version 0 blueprint first', () => {
    const v0 = v0Fixtures.find((entry) => entry.name === 'rolling-start')?.data;
    const issues = issuesOf(validateBlueprint(v0, catalogue));
    expect(issues.map((issue) => `${issue.code} at ${issue.path}`)).toEqual(['blueprint.unsupported_version at $.version']);
    expect(issues[0]?.message).toContain('Migrate it first');
  });

  it('refuses a newer blueprint inside a challenge at its own path', () => {
    const challenge = copy(exampleChallenges.find((entry) => entry.name === 'one-motor-backwards')?.data) as { start: { version: number } };
    challenge.start.version = 2;
    expect(reasons(validateChallenge(challenge, catalogue))).toContain('blueprint.newer_version at $.start.version');
  });

  it.each([
    ['missing', undefined, 'value.missing'],
    ['text', '1', 'value.wrong_type'],
    ['null', null, 'value.wrong_type'],
    ['true', true, 'value.wrong_type'],
    ['not finite', Number.POSITIVE_INFINITY, 'value.wrong_type'],
    ['not a whole number', 0.5, 'value.not_integer'],
    ['below 0', -1, 'value.out_of_range'],
  ])('refuses a version that is %s', (_name, version, code) => {
    const document: Record<string, unknown> = { ...copy(validBlueprints[0]?.data as object) };
    if (version === undefined) delete document.version;
    else document.version = version;
    expect(reasons(migrateBlueprint(document))).toEqual([`${code} at $.version`]);
  });
});

describe('migrateBlueprint never throws on bad data', () => {
  const throwing = (version: number): unknown => {
    const target = { ...copy(validBlueprints[0]?.data as object), version } as Record<string, unknown>;
    Object.defineProperty(target, 'parts', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    return target;
  };

  const hostile: readonly [string, () => unknown][] = [
    ['undefined', () => undefined],
    ['null', () => null],
    ['a number', () => 42],
    ['NaN', () => Number.NaN],
    ['a string', () => 'blueprint'],
    ['an empty object', () => ({})],
    ['an empty list', () => []],
    ['a list holding itself', () => {
      const list: unknown[] = [];
      list.push(list);
      return list;
    }],
    ['a Map', () => new Map([['version', 1]])],
    ['a version 1 object whose field throws', () => throwing(1)],
    ['a version 0 object whose field throws', () => throwing(0)],
    ['a Proxy that throws on every read', () => new Proxy({}, { ownKeys: () => { throw new Error('no keys'); }, get: () => { throw new Error('no reads'); } })],
    ['a Proxy whose version throws', () => new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('no version'); } })],
    ['a version 0 document that holds itself', () => {
      const document: Record<string, unknown> = { version: 0, parts: [], wires: [], arena: 'open-floor', meta: {} };
      (document.meta as Record<string, unknown>).title = document;
      return document;
    }],
  ];

  it.each(hostile)('refuses %s with named reasons', (_name, make) => {
    let result: MigrationResult<Blueprint> | undefined;
    expect(() => (result = migrateBlueprint(make()))).not.toThrow();
    expect(result?.ok).toBe(false);
    const issues: readonly Issue[] = result && !result.ok ? result.issues : [];
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(Object.keys(ISSUE_CODES)).toContain(issue.code);
      expect(issue.path.startsWith('$')).toBe(true);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });
});

describe('the list of blueprint migrations', () => {
  it('starts at version 0 and runs one version at a time up to BLUEPRINT_VERSION', () => {
    expect(BLUEPRINT_MIGRATIONS[0]?.from).toBe(0);
    BLUEPRINT_MIGRATIONS.forEach((step, index) => {
      expect(step.from).toBe(index);
      expect(step.to).toBe(step.from + 1);
    });
    expect(BLUEPRINT_MIGRATIONS.at(-1)?.to).toBe(BLUEPRINT_VERSION);
  });
});

describe('runMigrations, with made-up steps', () => {
  // Each made-up step stamps the version it read, so the trail shows which steps ran and in what order.
  const stamp = (from: number): MigrationStep => ({
    from,
    to: from + 1,
    migrate: (document) => {
      const record = document as { version: number; trail: readonly number[] };
      return { ok: true, value: { version: from + 1, trail: [...record.trail, from] } };
    },
  });
  const refuse = (from: number, issue: Issue): MigrationStep => ({ from, to: from + 1, migrate: () => ({ ok: false, issues: [issue] }) });
  const read = (document: unknown): ValidationResult<unknown> => ({ ok: true, value: document });
  const steps = [stamp(0), stamp(1), stamp(2)];
  const run = (version: number, list: readonly MigrationStep[] = steps, reader = read) => runMigrations({ version, trail: [] }, list, 3, reader);

  it('runs every step from the stored version up, in order, and none for a current document', () => {
    expect(run(0)).toEqual({ ok: true, value: { version: 3, trail: [0, 1, 2] }, from: 0 });
    expect(run(1)).toEqual({ ok: true, value: { version: 3, trail: [1, 2] }, from: 1 });
    expect(run(3)).toEqual({ ok: true, value: { version: 3, trail: [] }, from: 3 });
  });

  it('finds each step by the version it reads, whatever order the list is in', () => {
    expect(run(0, [stamp(2), stamp(0), stamp(1)])).toEqual({ ok: true, value: { version: 3, trail: [0, 1, 2] }, from: 0 });
  });

  it('stops at the first refusal; issues about a document the steps made say which one', () => {
    const issue: Issue = { code: 'value.missing', path: '$.trail', message: "Missing 'trail'." };
    const list = [stamp(0), refuse(1, issue), stamp(2)];
    expect(run(1, list)).toEqual({ ok: false, issues: [issue] });
    expect(run(0, list)).toEqual({
      ok: false,
      issues: [{ ...issue, message: "After migrating from version 0 to version 1: Missing 'trail'." }],
    });
  });

  it("says the same of the current version's check after any step", () => {
    const issue: Issue = { code: 'value.unknown_key', path: '$.trail', message: "Unknown field 'trail'." };
    const strict = (): ValidationResult<unknown> => ({ ok: false, issues: [issue] });
    expect(run(3, steps, strict)).toEqual({ ok: false, issues: [issue] });
    expect(run(2, steps, strict)).toEqual({
      ok: false,
      issues: [{ ...issue, message: "After migrating from version 2 to version 3: Unknown field 'trail'." }],
    });
  });

  it('turns a step or check that throws into value.unreadable', () => {
    const throws: MigrationStep = {
      from: 0,
      to: 1,
      migrate: () => {
        throw new Error('boom');
      },
    };
    expect(reasons(run(0, [throws, stamp(1), stamp(2)]))).toEqual(['value.unreadable at $']);
    const brittle = (): ValidationResult<unknown> => {
      throw new Error('boom');
    };
    expect(reasons(run(0, steps, brittle))).toEqual(['value.unreadable at $']);
  });

  it('refuses a version no step reads', () => {
    const gap = run(0, [stamp(0), stamp(2)]);
    expect(reasons(gap)).toEqual(['value.out_of_range at $.version']);
    expect(gap.ok ? '' : gap.issues[0]?.message).toBe('After migrating from version 0 to version 1: No migration reads version 1.');
    expect(reasons(run(1, [stamp(2)]))).toEqual(['value.out_of_range at $.version']);
    expect(reasons(run(4))).toEqual(['blueprint.newer_version at $.version']);
  });
});

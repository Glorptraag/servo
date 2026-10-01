import { describe, expect, it } from 'vitest';
import {
  exampleArenas,
  exampleChallenges,
  exampleParts,
  exampleRunRecords,
  invalidBlueprints,
  invalidKits,
  validBlueprints,
  validKits,
} from '../fixtures/index.ts';
import {
  canonicalJson,
  canonicalizeBlueprint,
  serializeBlueprint,
  validateArenaPreset,
  validateBlueprint,
  validateChallenge,
  validateKit,
  validatePartRecord,
  validateRunRecord,
} from '../src/index.ts';
import type { Blueprint } from '../src/index.ts';
import { catalogue, reasons, unwrap } from './support.ts';

// The done-when suite for task 0.2: every valid fixture accepted, every invalid one refused with a named reason.

describe('valid blueprints are accepted', () => {
  it('has at least 3', () => expect(validBlueprints.length).toBeGreaterThanOrEqual(3));

  it.each(validBlueprints)('accepts $name', ({ data }) => {
    expect(reasons(validateBlueprint(data, catalogue))).toEqual([]);
  });
});

describe('invalid blueprints are refused with one named reason each', () => {
  it('has at least 10', () => expect(invalidBlueprints.length).toBeGreaterThanOrEqual(10));

  it.each(invalidBlueprints)('refuses $name: $expect.code at $expect.path', ({ data, expect: expected }) => {
    const result = validateBlueprint(data, catalogue);
    expect(result.ok).toBe(false);
    expect(reasons(result)).toEqual([`${expected.code} at ${expected.path}`]);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/\S/);
  });

  it('names a different reason for most of them', () => {
    const codes = new Set(invalidBlueprints.map((fixture) => fixture.expect.code));
    expect(codes.size).toBeGreaterThanOrEqual(15);
  });
});

describe('kits', () => {
  it.each(validKits)('accepts $name', ({ data }) => {
    expect(reasons(validateKit(data, catalogue))).toEqual([]);
  });

  it.each(invalidKits)('refuses $name: $expect.code at $expect.path', ({ data, expect: expected }) => {
    expect(reasons(validateKit(data, catalogue))).toEqual([`${expected.code} at ${expected.path}`]);
  });
});

describe('example part records, arenas, challenges and run records', () => {
  it.each(exampleParts.map((data) => ({ id: (data as { id: string }).id, data })))('part $id is valid', ({ data }) => {
    expect(reasons(validatePartRecord(data))).toEqual([]);
  });

  it.each(exampleArenas.map((data) => ({ id: (data as { id: string }).id, data })))('arena $id is valid', ({ data }) => {
    expect(reasons(validateArenaPreset(data))).toEqual([]);
  });

  it.each(exampleChallenges)('challenge $name is valid', ({ data }) => {
    expect(reasons(validateChallenge(data, catalogue))).toEqual([]);
  });

  it.each(exampleRunRecords)('run record $name is valid', ({ data }) => {
    expect(reasons(validateRunRecord(data, catalogue))).toEqual([]);
  });
});

describe('fixture files', () => {
  const raw = import.meta.glob('../fixtures/**/*.json', { query: '?raw', import: 'default', eager: true });
  const named = (folder: string) =>
    Object.entries(raw)
      .filter(([file]) => file.startsWith(`../fixtures/${folder}/`))
      .map(([file, text]) => ({ name: file.slice(`../fixtures/${folder}/`.length, -'.json'.length), text }));

  it('lists every blueprint file in the manifest', () => {
    expect(named('blueprints/valid').map((f) => f.name).sort()).toEqual(validBlueprints.map((f) => f.name).sort());
    expect(named('blueprints/invalid').map((f) => f.name).sort()).toEqual(invalidBlueprints.map((f) => f.name).sort());
  });

  it.each(named('blueprints/valid'))('stores $name in canonical form, byte for byte', ({ text }) => {
    const blueprint = unwrap(validateBlueprint(JSON.parse(text), catalogue)) as Blueprint;
    expect(serializeBlueprint(canonicalizeBlueprint(blueprint, catalogue))).toBe(text);
  });

  it.each(Object.entries(raw).map(([file, text]) => ({ file, text })))('formats $file canonically', ({ text }) => {
    expect(canonicalJson(JSON.parse(text))).toBe(text);
  });
});

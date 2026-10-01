import { describe, expect, it } from 'vitest';
import { exampleChallenges, validBlueprints } from '../src/fixtures.ts';
import {
  ISSUE_CODES,
  validateArenaPreset,
  validateBlueprint,
  validateBlueprintShape,
  validateChallenge,
  validateKit,
  validatePartRecord,
  validateRunRecord,
} from '../src/index.ts';
import type { ValidationResult } from '../src/index.ts';
import { catalogue, copy, issuesOf, part } from './support.ts';

const validators: readonly [string, (value: unknown) => ValidationResult<unknown>][] = [
  ['validatePartRecord', validatePartRecord],
  ['validateArenaPreset', validateArenaPreset],
  ['validateKit', (value) => validateKit(value, catalogue)],
  ['validateBlueprintShape', validateBlueprintShape],
  ['validateBlueprint', (value) => validateBlueprint(value, catalogue)],
  ['validateChallenge', (value) => validateChallenge(value, catalogue)],
  ['validateRunRecord', (value) => validateRunRecord(value, catalogue)],
];

const throwing = (): unknown => {
  const target = copy(validBlueprints[0]?.data) as Record<string, unknown>;
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
  ['an object whose field throws', throwing],
  ['a Proxy that throws on every read', () => new Proxy({}, { ownKeys: () => { throw new Error('no keys'); }, get: () => { throw new Error('no reads'); } })],
  ['infinite numbers', () => ({ version: 1, parts: [{ id: 'p1', part: 'led', position: { x: Infinity, y: 0 }, rotation: 0, settings: {} }], wires: [], arena: { preset: 'open-floor', props: [] }, meta: {} })],
];

describe('validators never throw on bad data', () => {
  const cases = validators.flatMap(([name, validate]) => hostile.map(([input, make]) => ({ name, input, validate, make })));

  it.each(cases)('$name refuses $input with named reasons', ({ validate, make }) => {
    let result: ValidationResult<unknown> | undefined;
    expect(() => (result = validate(make()))).not.toThrow();
    expect(result?.ok).toBe(false);
    const issues = result ? issuesOf(result) : [];
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(Object.keys(ISSUE_CODES)).toContain(issue.code);
      expect(issue.path.startsWith('$')).toBe(true);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it('notices the holes in a sparse list', () => {
    const blueprint = copy(validBlueprints[0]?.data) as Record<string, unknown>;
    const parts = blueprint.parts as unknown[];
    const holey: unknown[] = [parts[0]];
    holey[2] = parts[2]; // leaves a hole at [1], which JavaScript (never JSON) can make
    blueprint.parts = holey;
    expect(issuesOf(validateBlueprintShape(blueprint)).map((issue) => `${issue.code} at ${issue.path}`)).toEqual([
      'value.wrong_type at $.parts',
    ]);
  });

  it('reads a throwing property as unreadable', () => {
    expect(issuesOf(validateBlueprint(throwing(), catalogue)).map((issue) => issue.code)).toContain('value.unreadable');
  });

  it('stops at a goal that contains itself', () => {
    const challenge = copy(exampleChallenges[0]?.data) as Record<string, unknown>;
    const goal: { kind: string; of: unknown[] } = { kind: 'all', of: [] };
    goal.of.push(goal);
    challenge.goal = goal;
    const codes = issuesOf(validateChallenge(challenge, catalogue)).map((issue) => issue.code);
    expect(codes).toEqual(['value.too_deep']);
  });

  it('reports every problem it finds, not only the first', () => {
    const record = copy(part('led')) as unknown as Record<string, Record<string, unknown>>;
    record.identity = { ...record.identity, family: 'lights', level: 9 };
    record.card = { ...record.card, does: 'Light!' };
    const codes = issuesOf(validatePartRecord(record)).map((issue) => issue.code);
    expect(codes).toEqual(['value.not_allowed', 'value.not_allowed', 'text.exclamation']);
  });
});

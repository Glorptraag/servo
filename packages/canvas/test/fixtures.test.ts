import { describe, expect, it } from 'vitest';
import { canonicalJson, serializeBlueprint } from '@servo/schema';
import stored from './fixtures/twenty-five-parts.json' with { type: 'json' };
import { twentyFiveParts } from './helpers/catalogue.ts';

describe('the 25-part fixture (test/fixtures/twenty-five-parts.json)', () => {
  it('is a valid blueprint of 25 parts from the schema’s example parts, stored in canonical form', () => {
    expect(twentyFiveParts.parts).toHaveLength(25);
    expect(serializeBlueprint(twentyFiveParts)).toBe(canonicalJson(stored));
  });

  it('is a Level 4-sized build: two robots, a circuit and a loose microcontroller, all wired', () => {
    const types = new Set(twentyFiveParts.parts.map((part) => part.part));
    expect(types.size).toBeGreaterThanOrEqual(12);
    expect(twentyFiveParts.wires.length).toBeGreaterThanOrEqual(35);
  });
});

// The changed builds the screenshot mutation test draws (src/e2e/mutations.ts): each is a build the schema accepts,
// short exactly what was taken out.
import { describe, expect, it } from 'vitest';
import { loadCatalogue } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { validateBlueprint } from '@servo/schema';
import { leafParts, withoutPart, withoutWire } from '../src/e2e/mutations.ts';

const catalogue = loadCatalogue();
const { fixtures } = loadFixtures();

describe.each(fixtures.map((fixture) => [fixture.name, fixture.blueprint] as const))('changed builds of %s', (_name, blueprint) => {
  it('takes out one wire, and the schema still accepts the build', () => {
    for (const wire of blueprint.wires) {
      const changed = withoutWire(blueprint, wire.id);
      expect(changed.wires.map((each) => each.id)).toEqual(blueprint.wires.map((each) => each.id).filter((id) => id !== wire.id));
      expect(validateBlueprint(changed, catalogue).ok, wire.id).toBe(true);
    }
  });

  it('takes out a part that holds nothing with every wire on it, and the schema still accepts the build', () => {
    const leaves = leafParts(blueprint, catalogue);
    expect(leaves.size).toBeGreaterThan(0);
    for (const id of leaves) {
      const changed = withoutPart(blueprint, id);
      expect(changed.parts.some((part) => part.id === id)).toBe(false);
      expect(changed.wires.some((wire) => wire.from.part === id || wire.to.part === id)).toBe(false);
      expect(changed.wires.length).toBe(blueprint.wires.filter((wire) => wire.from.part !== id && wire.to.part !== id).length);
      expect(validateBlueprint(changed, catalogue).ok, id).toBe(true);
    }
  });
});

describe('leafParts', () => {
  it('leaves out every part another is mounted on or carried by', () => {
    const rolling = fixtures.find((fixture) => fixture.name === 'kit-rolling-start');
    if (!rolling) throw new Error('No kit-rolling-start fixture.');
    const leaves = leafParts(rolling.blueprint, catalogue);
    expect(leaves.has('chassis')).toBe(false);
    expect(leaves.has('motor-left')).toBe(false);
    expect(leaves.has('wheel-left')).toBe(true);
    expect(leaves.has('battery')).toBe(true);
  });

  it('refuses to take out what the build does not have', () => {
    const [first] = fixtures;
    if (!first) throw new Error('No fixture.');
    expect(() => withoutWire(first.blueprint, 'w999')).toThrow(/no wire w999/);
    expect(() => withoutPart(first.blueprint, 'nothing')).toThrow(/no part nothing/);
  });
});

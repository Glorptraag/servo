// Test data from the schema's fixtures. The canvas never imports content: the app passes the catalogue in, so tests
// build one from @servo/schema/fixtures the same way.
import { makeCatalogue, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type { ArenaPreset, Blueprint, Catalogue, PartRecord, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import twentyFive from '../fixtures/twenty-five-parts.json' with { type: 'json' };

const unwrap = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`${what}: ${result.issues.map((issue) => `${issue.code} at ${issue.path}`).join('; ')}`);
  return result.value;
};

export const parts: readonly PartRecord[] = exampleParts.map((data, index) => unwrap(validatePartRecord(data), `part ${index}`));
export const arenas: readonly ArenaPreset[] = exampleArenas.map((data, index) => unwrap(validateArenaPreset(data), `arena ${index}`));
export const catalogue: Catalogue = makeCatalogue({ parts, arenas });

export const record = (id: string): PartRecord => {
  const found = catalogue.parts.get(id);
  if (!found) throw new Error(`No part record '${id}'.`);
  return found;
};

/** A valid blueprint fixture from the schema, by name (`rolling-start`, `bumper-robot`, `led-circuit` …). */
export const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name);
  if (!found) throw new Error(`No blueprint fixture '${name}'.`);
  return unwrap(validateBlueprint(found.data, catalogue), name);
};

/** The performance fixture: Rolling Start, the bumper robot and the LED circuit side by side, and a microcontroller. */
export const twentyFiveParts: Blueprint = unwrap(validateBlueprint(twentyFive, catalogue), 'twenty-five-parts');

/** A blueprint for tests, with metadata filled in. Parts and wires as given; the high-water marks follow the ids. */
export const blueprintOf = (
  build: Pick<Blueprint, 'parts' | 'wires'> & { readonly arena?: Blueprint['arena'] },
  name = 'Test build',
): Blueprint => {
  const wireNumbers = build.wires.map((wire) => Number(/^w(\d+)$/.exec(wire.id)?.[1] ?? 0));
  const partNumbers = build.parts.map((part) => Number(/^p(\d+)$/.exec(part.id)?.[1] ?? 0));
  const candidate: Blueprint = {
    version: 1,
    parts: build.parts,
    wires: build.wires,
    arena: build.arena ?? { preset: 'open-floor', props: [] },
    meta: {
      id: '5b0d2e7a-3c41-4f6e-8a9b-1c2d3e4f5a6b',
      name,
      level: 2,
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
      highWater: { parts: Math.max(0, ...partNumbers), wires: Math.max(0, ...wireNumbers) },
    },
  };
  return unwrap(validateBlueprint(candidate, catalogue), name);
};

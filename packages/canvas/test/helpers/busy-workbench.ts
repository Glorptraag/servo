// The busy workbench (25 parts, 43 wires), with the content part records and arena it uses, from
// test/fixtures/busy-workbench.json: a copy of packages/content's fixture, because the canvas never imports content.
// Task 3.7 routes its wires and checks none crosses a part body.
import { makeCatalogue, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type { Blueprint, Catalogue, ValidationResult } from '@servo/schema';
import data from '../fixtures/busy-workbench.json' with { type: 'json' };

const unwrap = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`${what}: ${result.issues.map((issue) => `${issue.code} at ${issue.path}`).join('; ')}`);
  return result.value;
};

export const benchCatalogue: Catalogue = makeCatalogue({
  parts: data.parts.map((part: unknown, index: number) => unwrap(validatePartRecord(part), `busy workbench part ${index}`)),
  arenas: data.arenas.map((arena: unknown, index: number) => unwrap(validateArenaPreset(arena), `busy workbench arena ${index}`)),
});

/** The busy workbench, as packages/content/fixtures/blueprints/busy-workbench.json has it. */
export const busyWorkbench: Blueprint = unwrap(validateBlueprint(data.blueprint, benchCatalogue), 'busy-workbench');

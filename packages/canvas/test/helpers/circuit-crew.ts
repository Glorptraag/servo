// The Circuit Crew kit robot (Level 2), with the content part records and arena it uses, from
// test/fixtures/circuit-crew.json: a copy of packages/content's (task 2.6), because the canvas never imports content.
// Its parts differ from the schema's examples (a longer DC motor, a buzzer and an LED with mounts), so its sockets
// crowd differently from the bumper robot's (review R-3.1, finding 2).
import { makeCatalogue, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type { Blueprint, Catalogue, ValidationResult } from '@servo/schema';
import data from '../fixtures/circuit-crew.json' with { type: 'json' };

const unwrap = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`${what}: ${result.issues.map((issue) => `${issue.code} at ${issue.path}`).join('; ')}`);
  return result.value;
};

export const crewCatalogue: Catalogue = makeCatalogue({
  parts: data.parts.map((part: unknown, index: number) => unwrap(validatePartRecord(part), `circuit crew part ${index}`)),
  arenas: data.arenas.map((arena: unknown, index: number) => unwrap(validateArenaPreset(arena), `circuit crew arena ${index}`)),
});

/** The Circuit Crew kit robot, as packages/content/fixtures/blueprints/kit-circuit-crew.json has it. */
export const crewRobot: Blueprint = unwrap(validateBlueprint(data.blueprint, crewCatalogue), 'kit-circuit-crew');

// The Level 3 slot's ProgramRuntime (task 6.6), written against sim-core's interface (packages/sim-core/docs/program.md):
// made by the caller with the build in hand, it drives each brain's outputs at its rules' levels every tick the brain
// is on, and keeps no state. Pure: the same build gives the same runtime, and the same tick the same step.
import type { Blueprint, Catalogue, PortId } from '@servo/schema';
import type { ProgramRuntime } from '@servo/sim-core';
import type { Flags } from '../flags/index.ts';
import { programsOf } from './rules.ts';
import type { BrainProgram } from './rules.ts';

const keyOf = (partId: string, primitive: string): string => JSON.stringify([partId, primitive]);

/** A runtime that runs `programs`. A brain with no program drives nothing, as the no-op brain does (D41). */
export const programRuntime = (programs: readonly BrainProgram[]): ProgramRuntime => {
  const outputs = new Map<string, Readonly<Record<PortId, number>>>(
    programs.map((program) => [keyOf(program.partId, program.primitive), Object.fromEntries(program.rules.map((rule) => [rule.output, rule.level]))]),
  );
  return {
    start: () => null,
    run: (tick, state) => ({ outputs: outputs.get(keyOf(tick.partId, tick.primitive)) ?? {}, state }),
  };
};

/**
 * The program a Run of `blueprint` passes to createSimulation: the Level 3 slot's with the flag on, none with it off,
 * so every brain stays the no-op brain.
 */
export const programFor = (flags: Flags, blueprint: Blueprint, catalogue: Catalogue): ProgramRuntime | undefined =>
  flags['level-3-slot'] ? programRuntime(programsOf(blueprint, catalogue)) : undefined;

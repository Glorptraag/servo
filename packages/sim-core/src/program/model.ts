import { settledPrimitives } from '../behaviour/index.ts';
import type { SimGraph } from '../graph/index.ts';
import type { ProgramRuntime } from '../interface.ts';
import { NO_OP_BRAIN } from './noop.ts';
import type { Brain, ProgramModel } from './types.ts';

/**
 * The slot's view of a graph: every brain (each `program` primitive, with any setting applied, in part id order
 * and then the record's order) and the runtime that runs them: the Run's `program` option, or the v1 no-op brain
 * when it is left out (D41). A Run reads a snapshot that never changes, so this is made once when it starts. Pure.
 */
export const programModel = (graph: SimGraph, runtime?: ProgramRuntime): ProgramModel => ({
  graph,
  runtime: runtime ?? NO_OP_BRAIN,
  brains: [...graph.parts.values()].flatMap((part) =>
    settledPrimitives(part.record, part.placed).flatMap((spec): Brain[] => (spec.kind === 'program' ? [{ partId: part.id, primitive: spec.id, spec }] : [])),
  ),
});

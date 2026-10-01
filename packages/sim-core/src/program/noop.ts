import type { BrainStep, BrainTick, ProgramRuntime, ProgramState } from '../interface.ts';

/**
 * The v1 brain (D41): it runs no rules, so it drives none of its outputs and its state never changes. A servo
 * motor wired to one of its outputs gets no signal, so with power it holds where it is and hums. Every Run that
 * passes no `program` uses it; Level 3, and task 6.6's flagged slot, pass a runtime of their own instead.
 */
export const NO_OP_BRAIN: ProgramRuntime = Object.freeze({
  start: (): ProgramState => null,
  run: (_tick: BrainTick, state: ProgramState): BrainStep => ({ outputs: {}, state }),
});

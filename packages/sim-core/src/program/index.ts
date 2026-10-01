// The program slot (task 1.6): each brain's program, run every tick through the Run's ProgramRuntime between the
// electrical solver and the mechanical solver, with the v1 no-op brain (D41) and the block-rule runtime Level 3
// plugs its rules into. See packages/sim-core/docs/program.md.

export { programModel } from './model.ts';
export { NO_OP_BRAIN } from './noop.ts';
export { blockRuleRuntime } from './rules.ts';
export { routeSignals } from './signals.ts';
export { programTick, startProgram } from './tick.ts';
export type {
  AlwaysCondition,
  BlockAction,
  BlockCondition,
  BlockProgram,
  BlockRule,
  Brain,
  BrainOutput,
  ProgramInputs,
  ProgramModel,
  ProgramSlotState,
  ProgramTick,
  ReadingCondition,
  RoutedSignals,
  SetAction,
  SignalLevels,
} from './types.ts';

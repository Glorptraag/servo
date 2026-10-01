import type { PlacedPartId, PortId, ProgramPrimitive, WireId } from '@servo/schema';
import type { PartPower } from '../behaviour/index.ts';
import type { SimGraph } from '../graph/index.ts';
import type { BrainInfo, ProgramRuntime, ProgramState } from '../interface.ts';

/**
 * The program slot's types (task 1.6). Each tick, after the electrical solver and before the behaviour runtime
 * and the mechanical solver, the slot runs every powered brain through the Run's ProgramRuntime (src/interface.ts)
 * and puts what it drives on the signal lines. Internal to sim-core: the tick loop (task 1.5) imports it by
 * relative path. See docs/program.md.
 */

/** Signal levels (0–1) by placed part and port. A port left out carries no signal. */
export type SignalLevels = ReadonlyMap<PlacedPartId, Readonly<Record<PortId, number>>>;

/** One brain: a placed part's `program` primitive. */
export interface Brain extends BrainInfo {
  /** The primitive as the part's record gives it, with any setting applied. */
  readonly spec: ProgramPrimitive;
}

/** The slot's view of one graph, made once per Run by `programModel`. */
export interface ProgramModel {
  readonly graph: SimGraph;
  /** What runs every brain: the Run's `program` option, or the v1 no-op brain (D41) when it is left out. */
  readonly runtime: ProgramRuntime;
  /** Every `program` primitive, in part id order and then the record's order. The state follows this order. */
  readonly brains: readonly Brain[];
}

/** What the slot carries from one tick to the next. Plain JSON in a fixed order, so equal states give equal bytes. */
export interface ProgramSlotState {
  /** Each brain's program state, in the model's `brains` order. */
  readonly programs: readonly ProgramState[];
  /** The levels each brain drove on its outputs last tick, in the same order: what the brains wired to them read this tick. */
  readonly driven: readonly Readonly<Record<PortId, number>>[];
}

/** What one tick reads beside the state. */
export interface ProgramInputs {
  /** The tick being solved, 0 for the starting state. Each brain's program is told it. */
  readonly tick: number;
  /** Each placed part's power ports, from this tick's electrical solve, read as the behaviour runtime reads them. A port left out reads 0 V. */
  readonly power?: ReadonlyMap<PlacedPartId, PartPower>;
  /**
   * Per placed part, the level on each signal in that something other than a brain drives, as sampled at the end
   * of the previous tick: from Level 3, a sensor's reading, carried to the signal ins by `routeSignals`. Nothing
   * gives one in v1. A brain's own outputs reach the brains wired to them through the state.
   */
  readonly samples?: SignalLevels;
}

/** One brain this tick. */
export interface BrainOutput extends BrainInfo {
  /** Its supply is at or above `onVolts`, so its program ran. Below that it is off: it drives nothing, and starts again from its start state when power returns. */
  readonly on: boolean;
  /** The levels on its inputs as sampled at the end of the previous tick, in the primitive's order: what its program reads. */
  readonly inputs: Readonly<Record<PortId, number>>;
  /** The levels it drives on its outputs this tick, in the primitive's order. An output left out carries no signal. */
  readonly outputs: Readonly<Record<PortId, number>>;
}

/** Signal outs' levels carried along the signal lines. */
export interface RoutedSignals {
  /** Per placed part, in id order, the level on each signal in, in the record's port order: the behaviour runtime's `signals` input. */
  readonly signals: SignalLevels;
  /** The level on each signal line that carries one, in wire id order: the interface's `WireFlow.signal`. */
  readonly lines: ReadonlyMap<WireId, number>;
}

/** One tick's answer and the state for the next tick. */
export interface ProgramTick extends RoutedSignals {
  /** Every brain, in the model's order. */
  readonly brains: readonly BrainOutput[];
  readonly state: ProgramSlotState;
}

// ---------------------------------------------------------------------------------------------
// Block rules: a brain's program as data (ground rule 1), run by `blockRuleRuntime`.

/**
 * A brain's program as data: rules over the brain's own pins, read the same way for every brain. Each tick the
 * brain is on, its rules run in order. Level 3 owns the vocabulary: a new kind of condition or action changes the
 * block-rule runtime, never the tick loop.
 */
export interface BlockProgram {
  readonly rules: readonly BlockRule[];
}

/** When `when` holds, the actions in `then` run in order. */
export interface BlockRule {
  readonly when: BlockCondition;
  readonly then: readonly BlockAction[];
}

/** Holds every tick. */
export interface AlwaysCondition {
  readonly kind: 'always';
}

/**
 * Holds while the level on one of the brain's inputs, as sampled at the end of the previous tick, is more than
 * `level` (`above`) or less than it (`below`). An input that carries no signal holds neither.
 */
export interface ReadingCondition {
  readonly kind: 'reading';
  readonly input: PortId;
  readonly compare: 'above' | 'below';
  readonly level: number;
}

export type BlockCondition = AlwaysCondition | ReadingCondition;

/** Drives one of the brain's outputs at `level` (0–1) from this tick on, until another action sets it. */
export interface SetAction {
  readonly kind: 'set';
  readonly output: PortId;
  readonly level: number;
}

export type BlockAction = SetAction;

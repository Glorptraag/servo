// The behaviour runtime (task 1.3): each part's behaviour primitives, run every tick from their records'
// parameters. See packages/sim-core/docs/behaviour.md.

export { BEHAVIOUR_EFFECTS, effectsOf } from './effects.ts';
export type { BehaviourEffect } from './effects.ts';
export { behaviourModel, behaviourModelOf } from './model.ts';
export { settledPrimitives } from './params.ts';
export { FLOWING_MILLIAMPS, loadLevel, positionRule, ratedSweep, speedRule } from './primitives.ts';
export type { PositionRule, SpeedRule } from './primitives.ts';
export { behaviourTick, startBehaviour } from './tick.ts';
export type {
  BehaviourInputs,
  BehaviourModel,
  BehaviourPart,
  BehaviourState,
  BehaviourTick,
  BehaviourValues,
  BehaviourVerdict,
  DriveRoute,
  DriverOutput,
  LoadOutput,
  PartBehaviour,
  PartPower,
  PositionOutput,
  PowerReading,
  PrimitiveOutput,
  PrimitiveRef,
  ProgramOutput,
  RatioOutput,
  RegulatorOutput,
  SourceOutput,
  SpeedOutput,
  SupportOutput,
  SwitchOutput,
  WheelOutput,
} from './types.ts';

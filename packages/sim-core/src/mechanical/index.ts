// The mechanical solver (task 1.4): drive, collisions, ramps and balance in a 2.5D top-down arena. Internal to sim-core,
// like the graph and the behaviour runtime: the tick loop imports it by relative path. See packages/sim-core/docs/mechanical.md.

export { EDGE_THICKNESS_MM, LEDGE_MM, arenaModel, floorAt } from './arena.ts';
export { coast, driveStep, motorDrive } from './drive.ts';
export type { DriveStep, MotorDrive, Velocity, WheelForce } from './drive.ts';
export { atanDegrees } from './maths.ts';
export { GRAVITY, hullOf, loadingOf, shareWeight, stanceOf, stancePoints } from './stance.ts';
export type { Loading, Placing, Stance, StanceContact, StancePoint } from './stance.ts';
export { HELD_SHARE, SUBSTEPS, mechanicalModel, mechanicalSnapshot, mechanicalTick, restoreMechanics, startMechanics } from './tick.ts';
export { TOUCH_MM, initMechanics, mechanicsReady } from './world.ts';
export type {
  ActuatorMotion,
  ArenaContact,
  ArenaModel,
  BodyPoint,
  FloorRamp,
  Footprint,
  LooseBody,
  MechanicalInputs,
  MechanicalModel,
  MechanicalState,
  MechanicalTick,
  MechanicalVerdict,
  PartMechanics,
  ProbeModel,
  PropModel,
  RobotModel,
  RobotMotion,
  Solid,
  SupportModel,
  WheelDrive,
  WheelModel,
  WheelMotion,
  WorldLayout,
} from './types.ts';

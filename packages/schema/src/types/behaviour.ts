import type { HexColour, PortId, PrimitiveId, Vec2 } from './common.ts';
import type { PowerPair } from './port.ts';

/**
 * The closed vocabulary of behaviour primitives. A part's behaviour is a list of primitives, each
 * parameterised in the part record and bound to the part's ports by id. sim-core implements each
 * kind once and never branches on a part's id, name or family (ground rule 1).
 *
 * Units: volts (V), milliamps (mA), ohms, milliamp-hours (mAh), newton-millimetres (N·mm),
 * revolutions per minute (rpm), degrees, millimetres. Rated values are measured at `ratedVolts`.
 */
export const PRIMITIVE_KINDS = [
  'source',
  'switch',
  'load',
  'actuator',
  'driver',
  'regulator',
  'program',
  'ratio',
  'wheel',
  'support',
] as const;

export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

interface PrimitiveBase {
  /** Unique within the part; settings bind to it. */
  readonly id: PrimitiveId;
}

/**
 * A battery: gives power between `output.pos` and `output.neg`. Its open-circuit voltage falls from
 * `volts` (full) to `emptyVolts` (drained) as charge is used, and sags by current × `internalOhms`
 * under load. A short circuit draws volts ÷ internalOhms, which drains `capacityMah` fast.
 */
export interface SourcePrimitive extends PrimitiveBase {
  readonly kind: 'source';
  readonly output: PowerPair;
  readonly volts: number;
  readonly emptyVolts: number;
  readonly internalOhms: number;
  /** Simulated capacity: a teaching value chosen so drain shows within a run, not the real cell's capacity. */
  readonly capacityMah: number;
}

/** A switch changed by the child during a Run (a manual input recorded in the run record). */
export interface ManualActuation {
  readonly kind: 'manual';
  readonly initially: 'open' | 'closed';
}

/**
 * A switch changed by touch: it flips from its `normally` state while the probe segment (part frame,
 * mm, in the x–y plane) touches a wall or prop. A bumper switch.
 */
export interface ContactActuation {
  readonly kind: 'contact';
  readonly normally: 'open' | 'closed';
  readonly probe: { readonly from: Vec2; readonly to: Vec2 };
}

/** Joins its two power terminals when closed (no resistance) and parts them when open. */
export interface SwitchPrimitive extends PrimitiveBase {
  readonly kind: 'switch';
  readonly terminals: readonly [PortId, PortId];
  readonly actuation: ManualActuation | ContactActuation;
}

export interface LightOutput {
  readonly kind: 'light';
  readonly colour: HexColour;
}

export interface SoundOutput {
  readonly kind: 'sound';
  readonly hz: number;
}

/**
 * A two-terminal consumer. It draws nothing below `onVolts` and `ratedMilliamps` at `ratedVolts`,
 * rising in a straight line between. With `emits`, its light or sound follows its current
 * (full at `ratedMilliamps`). `whenReversed: 'blocks'` (an LED) means reversed voltage draws and gives nothing.
 */
export interface LoadPrimitive extends PrimitiveBase {
  readonly kind: 'load';
  readonly supply: PowerPair;
  readonly whenReversed: 'blocks' | 'works';
  readonly onVolts: number;
  readonly ratedVolts: number;
  readonly ratedMilliamps: number;
  readonly emits?: LightOutput | SoundOutput;
}

/**
 * Turns power into turning at a drive-out port. Speed ∝ voltage, reduced by load; above the stall
 * limit it stops turning, draws `stallMilliamps` and hums (brief Section 6). Below `startVolts` it
 * does not turn. Its speed is positive (right-handed about the drive's axis) when `supply.pos` is
 * above `supply.neg` and `reverse` is false. `whenReversed: 'reverses'` turns it the other way when
 * the supply is reversed (a DC motor). `throttle` (0–1) and `reverse` are the values a setting can drive.
 */
export interface SpeedActuator extends PrimitiveBase {
  readonly kind: 'actuator';
  readonly mode: 'speed';
  readonly supply: PowerPair;
  readonly drive: PortId;
  readonly whenReversed: 'reverses' | 'blocks';
  readonly ratedVolts: number;
  readonly startVolts: number;
  readonly noLoadRpm: number;
  readonly stallTorqueNmm: number;
  readonly noLoadMilliamps: number;
  readonly stallMilliamps: number;
  readonly throttle: number;
  readonly reverse: boolean;
}

/**
 * Turns an arm at a drive-out port to an angle and holds it (a servo motor). The angle arrives as a
 * signal on `command`. With power and no signal it holds where it is and hums. It sweeps at
 * `degPerSecond` (at `ratedVolts`), pushes up to `holdingTorqueNmm`, and only works the right way round.
 * Angles grow right-handed about the drive's axis. `target` is the angle a setting can drive; how a
 * Level 3 program uses it is for the program runtime.
 */
export interface PositionActuator extends PrimitiveBase {
  readonly kind: 'actuator';
  readonly mode: 'position';
  readonly supply: PowerPair;
  readonly drive: PortId;
  readonly command: PortId;
  readonly ratedVolts: number;
  readonly startVolts: number;
  readonly minDeg: number;
  readonly maxDeg: number;
  /** Where the arm is when a Run starts. */
  readonly restDeg: number;
  readonly target: number;
  readonly degPerSecond: number;
  readonly holdingTorqueNmm: number;
  readonly idleMilliamps: number;
  readonly stallMilliamps: number;
}

export type ActuatorPrimitive = SpeedActuator | PositionActuator;

/**
 * One motor-driver channel: passes supply power to `output`, scaled and signed by a command in −1..1
 * (1 full forward, 0 off, −1 full reverse), less `dropVolts`, up to `maxMilliamps`. When a signal
 * source drives `signal`, the signal sets the command; otherwise `command` does (a setting can drive it).
 * Below `onVolts` on its supply it does nothing.
 */
export interface DriverPrimitive extends PrimitiveBase {
  readonly kind: 'driver';
  readonly supply: PowerPair;
  readonly output: PowerPair;
  readonly signal?: PortId;
  readonly command: number;
  readonly onVolts: number;
  readonly dropVolts: number;
  readonly maxMilliamps: number;
  readonly idleMilliamps: number;
}

/**
 * Holds `output` at `volts` from its supply, while the supply is at least volts + dropoutVolts and the
 * output gives no more than `maxMilliamps`; past the limit its voltage falls. A microcontroller's 3V pin:
 * a motor wired straight to it barely turns, which is the Level 3 lesson.
 */
export interface RegulatorPrimitive extends PrimitiveBase {
  readonly kind: 'regulator';
  readonly supply: PowerPair;
  readonly output: PowerPair;
  readonly volts: number;
  readonly dropoutVolts: number;
  readonly maxMilliamps: number;
}

/**
 * A brain that reads `inputs` and drives `outputs` each tick while its supply is at least `onVolts`
 * (below that it is off, and starts again when power returns). Schema v1 has no program rules: the
 * brain is a no-op and its outputs carry no signal. Level 3 adds the rules.
 */
export interface ProgramPrimitive extends PrimitiveBase {
  readonly kind: 'program';
  readonly supply: PowerPair;
  readonly onVolts: number;
  readonly milliamps: number;
  readonly inputs: readonly PortId[];
  readonly outputs: readonly PortId[];
}

/**
 * A gearbox: the output turns 1/ratio as fast as the input, with ratio × efficiency of its torque, and
 * the same way about its own axis as the input turns about its axis. It drives only while its `mount`
 * is fixed to a mount point; loose, the housing turns instead of the output. `ratio` is the value a
 * setting can drive.
 */
export interface RatioPrimitive extends PrimitiveBase {
  readonly kind: 'ratio';
  readonly input: PortId;
  readonly output: PortId;
  readonly mount: PortId;
  readonly ratio: number;
  readonly efficiency: number;
}

/**
 * A wheel turned through its hub (a drive-in). Rolls the robot by radius × turning, up to its grip; past
 * its grip it slips. Turning right-handed about an axle pointing to the robot's left rolls it forward.
 */
export interface WheelPrimitive extends PrimitiveBase {
  readonly kind: 'wheel';
  readonly hub: PortId;
  readonly radiusMm: number;
  readonly widthMm: number;
  /** Friction against the floor. */
  readonly grip: number;
}

/**
 * A free-rolling support that carries weight but drives nothing (a caster). It holds the frame up
 * only while its mount is fixed to a mount point; loose, the frame rests on the floor and drags.
 */
export interface SupportPrimitive extends PrimitiveBase {
  readonly kind: 'support';
  readonly mount: PortId;
  readonly rollingFriction: number;
}

export type Primitive =
  | SourcePrimitive
  | SwitchPrimitive
  | LoadPrimitive
  | ActuatorPrimitive
  | DriverPrimitive
  | RegulatorPrimitive
  | ProgramPrimitive
  | RatioPrimitive
  | WheelPrimitive
  | SupportPrimitive;

/**
 * The parameters a setting may drive, per primitive kind. A setting's value replaces the parameter's
 * value in the record, so a part behaves the same before and after the setting unlocks.
 * `throttle` and `reverse` apply to speed actuators, `target` to position actuators, `colour` to a load
 * that gives light and `hz` to a load that gives sound.
 */
export const BINDABLE_PARAMS = {
  source: {},
  switch: {},
  load: { colour: 'colour', hz: 'number' },
  actuator: { throttle: 'number', reverse: 'boolean', target: 'number' },
  driver: { command: 'number' },
  regulator: {},
  program: {},
  ratio: { ratio: 'number' },
  wheel: {},
  support: {},
} as const satisfies Record<PrimitiveKind, Record<string, 'number' | 'boolean' | 'colour'>>;

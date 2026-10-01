import type {
  ControlState,
  Effect,
  FailureModeId,
  HexColour,
  NeedId,
  PartRecord,
  PlacedPartId,
  PortId,
  Primitive,
  PrimitiveId,
  SoundPayload,
  ValuePayload,
  WireId,
} from '@servo/schema';
import type { SimGraph } from '../graph/index.ts';

/**
 * The behaviour runtime's types (task 1.3). Each tick it turns what the other solvers give (port volts and
 * currents, signal levels, the load on each actuator) into what each part does (shaft speed, arm angle,
 * light, sound), the needs it judges on that, and the effects a child sees. Internal to sim-core; the tick
 * loop (task 1.5) wires electrical → behaviour → mechanical. See docs/behaviour.md.
 */

/** One power port this tick, as the electrical solver gives it. */
export interface PowerReading {
  /** The port's net volts, from its circuit's reference. Only the difference between two ports is read. */
  readonly volts: number;
  /** Current from the net into the part through this port, mA. */
  readonly milliamps: number;
}

/** One placed part's power ports this tick. */
export interface PartPower {
  readonly ports: ReadonlyMap<PortId, PowerReading>;
}

/**
 * What one tick reads beside the state. Whatever is left out is at rest: a power port reads 0 V and 0 mA, a
 * control sits at rest, a signal in carries no signal, an actuator turns no load, and the tick lasts 1/TICK_RATE s.
 */
export interface BehaviourInputs {
  /** Each placed part's power ports, from this tick's electrical solve. */
  readonly power?: ReadonlyMap<PlacedPartId, PartPower>;
  /** Switch positions and driver-channel commands now, read as the schema's `wiredNeeds` reads them. */
  readonly controls?: ControlState;
  /** Per placed part, the level (0–1) on each signal in that something drives this tick. A signal in left out has no signal. */
  readonly signals?: ReadonlyMap<PlacedPartId, Readonly<Record<PortId, number>>>;
  /** Per placed part and actuator primitive, the torque resisting its drive from last tick's mechanics, N·mm. Below 0 reads as 0. */
  readonly loads?: ReadonlyMap<PlacedPartId, Readonly<Record<PrimitiveId, number>>>;
  /** Simulated seconds the tick covers: 1/TICK_RATE unless given. Tick 0, before any time passes, is 0. */
  readonly seconds?: number;
}

/** The actuator that turns a drive port, and how the gearboxes between them scale it. */
export interface DriveRoute {
  /** The placed part and actuator primitive whose drive turns the port. */
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  /** The port's rpm for each rpm of the actuator's drive: the product of 1/ratio through each gearbox, 0 through a loose one. */
  readonly speed: number;
  /** The port's torque for each N·mm the actuator gives: the product of ratio × efficiency through each gearbox, 0 through a loose one. */
  readonly torque: number;
}

/** One placed part as the runtime reads it. Built once per Run: settings and mechanical links do not change during one. */
export interface BehaviourPart {
  readonly id: PlacedPartId;
  readonly record: PartRecord;
  /** The record's primitives in its order, with each parameter a setting binds set to the placed part's value for that setting. */
  readonly primitives: readonly Primitive[];
  /** Its mount ports that are fixed to a mount point. */
  readonly fixed: ReadonlySet<PortId>;
  /** Its drive-ins that are linked to a drive-out. */
  readonly linked: ReadonlySet<PortId>;
  /** Each of its drive ports that an actuator turns, through any gearboxes. A port no actuator reaches is left out. */
  readonly routes: ReadonlyMap<PortId, DriveRoute>;
}

/** A primitive of a placed part. */
export interface PrimitiveRef {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
}

/** The runtime's view of one graph, made once per Run by `behaviourModel`. */
export interface BehaviourModel {
  readonly graph: SimGraph;
  /** Every placed part, in id order. */
  readonly parts: readonly BehaviourPart[];
  /** Every position actuator, in part id order and then the record's order. The state's `arms` follow this order. */
  readonly arms: readonly PrimitiveRef[];
}

/** What the runtime carries from one tick to the next. Plain numbers in a fixed order, so equal states give equal bytes. */
export interface BehaviourState {
  /** Each position actuator's arm angle in degrees, in the model's `arms` order. A Run starts with each at its `restDeg`. */
  readonly arms: readonly number[];
}

/** A battery: whether current flows through it. Its volts, current and charge are the electrical solver's readouts. */
export interface SourceOutput {
  readonly kind: 'source';
  readonly primitive: PrimitiveId;
  /** Current flows through it. */
  readonly working: boolean;
}

export interface SwitchOutput {
  readonly kind: 'switch';
  readonly primitive: PrimitiveId;
  readonly closed: boolean;
  /** Current flows through it. */
  readonly working: boolean;
}

export interface LoadOutput {
  readonly kind: 'load';
  readonly primitive: PrimitiveId;
  /** Volts across its supply, + port minus − port. */
  readonly volts: number;
  /** The light or sound it gives, 0–1: its current over ratedMilliamps, so 1 at its rated volts. */
  readonly level: number;
  /** It draws current. */
  readonly working: boolean;
  readonly emits?: 'light' | 'sound';
  /** Its light's colour, after settings. */
  readonly colour?: HexColour;
  /** Its sound's pitch, after settings. */
  readonly hz?: number;
}

/** A speed actuator (a DC motor). */
export interface SpeedOutput {
  readonly kind: 'actuator';
  readonly mode: 'speed';
  readonly primitive: PrimitiveId;
  /** Volts across its supply, + port minus − port. */
  readonly volts: number;
  /** `idle`: too little drive to turn (or none); `turning`; `stalled`: driven, but its load is more than it can turn. */
  readonly state: 'idle' | 'turning' | 'stalled';
  /** Shaft speed, signed: positive is right-handed about the drive's axis. */
  readonly rpm: number;
  /** Its speed at its rated volts with the same load and settings: what `slow` compares with. */
  readonly ratedRpm: number;
  /** Turning the other way from the way its settings turn it, because its supply is the wrong way round. */
  readonly reversed: boolean;
  /** The most torque it can give now, at a standstill, N·mm: what the torque need compares the load with. 0 when idle. */
  readonly capacityNmm: number;
  /** It is driven: turning or stalled. */
  readonly working: boolean;
}

/** A position actuator (a servo motor). */
export interface PositionOutput {
  readonly kind: 'actuator';
  readonly mode: 'position';
  readonly primitive: PrimitiveId;
  readonly volts: number;
  /**
   * `idle`: no power, so the arm is still; `sweeping` towards the commanded angle; `settled` at it; `holding`:
   * power and no signal, so it holds where it is and hums; `stalled`: its load is more than it can push.
   */
  readonly state: 'idle' | 'sweeping' | 'settled' | 'holding' | 'stalled';
  /** The arm's angle after this tick, degrees. */
  readonly angle: number;
  /** The angle the signal commands, while it has power and a signal. */
  readonly commanded?: number;
  /** How fast it sweeps while sweeping, degrees a second; 0 otherwise. */
  readonly sweep: number;
  /** How fast it would sweep at its rated volts with the same load: what `slow` compares with. */
  readonly ratedSweep: number;
  /** The arm's turning this tick, signed like a shaft's: positive is right-handed about the drive's axis. */
  readonly rpm: number;
  /** The most torque it can push now, N·mm. 0 without power. */
  readonly capacityNmm: number;
  /** It has power. */
  readonly working: boolean;
}

/** A motor-driver channel. Its output's volts and current are the electrical solver's. */
export interface DriverOutput {
  readonly kind: 'driver';
  readonly primitive: PrimitiveId;
  readonly volts: number;
  /** The channel's command now, −1 to 1: a driven signal's level, otherwise the control's setting. */
  readonly command: number;
  /** Its supply is at or above onVolts. */
  readonly working: boolean;
}

export interface RegulatorOutput {
  readonly kind: 'regulator';
  readonly primitive: PrimitiveId;
  readonly volts: number;
  /** Its supply is high enough to hold the output at its volts. */
  readonly working: boolean;
}

/** A brain. The program runtime (task 1.6) runs it while it works. */
export interface ProgramOutput {
  readonly kind: 'program';
  readonly primitive: PrimitiveId;
  readonly volts: number;
  /** Its supply is at or above onVolts, so its program runs. */
  readonly working: boolean;
}

/** A gearbox. */
export interface RatioOutput {
  readonly kind: 'ratio';
  readonly primitive: PrimitiveId;
  /** The output's speed, signed about its own axis. */
  readonly rpm: number;
  /** Its input is linked to a drive-out. */
  readonly driven: boolean;
  /** Its mount is fixed, so it drives; loose, the housing turns instead. */
  readonly fixed: boolean;
}

export interface WheelOutput {
  readonly kind: 'wheel';
  readonly primitive: PrimitiveId;
  /** The hub's speed, signed about its own axis. How the robot rolls on it is the mechanical solver's. */
  readonly rpm: number;
  /** Its hub is linked to a drive-out. */
  readonly driven: boolean;
}

export interface SupportOutput {
  readonly kind: 'support';
  readonly primitive: PrimitiveId;
  /** Its mount is fixed, so it can carry weight. Whether it reaches the floor is the mechanical solver's. */
  readonly fixed: boolean;
}

export type PrimitiveOutput =
  | SourceOutput
  | SwitchOutput
  | LoadOutput
  | SpeedOutput
  | PositionOutput
  | DriverOutput
  | RegulatorOutput
  | ProgramOutput
  | RatioOutput
  | WheelOutput
  | SupportOutput;

/** A need this runtime judges. Power, loop and isolation are the electrical solver's; floor and balance the mechanical solver's. */
export interface BehaviourVerdict {
  readonly need: NeedId;
  readonly kind: 'signal' | 'torque' | 'drive' | 'mount';
  /** How it is unmet now; absent when it is met. */
  readonly unmet?: 'absent' | 'exceeded';
}

/** The readouts this runtime gives, in the schema's ValuePayload words. Volts, milliamps and charge are the electrical solver's. */
export type BehaviourValues = Pick<ValuePayload, 'rpm' | 'angle' | 'light' | 'closed'>;

/** One placed part this tick. */
export interface PartBehaviour {
  readonly id: PlacedPartId;
  /** Its readouts: rpm, angle, light and closed, each from its first primitive that gives it, in the record's order. */
  readonly values: BehaviourValues;
  /** Machine sounds playing now (level above 0), at most one of each, in RUN_SOUNDS order: motor, hum and buzz. */
  readonly sounds: readonly SoundPayload[];
  /** Each primitive's output, in the record's order. */
  readonly primitives: readonly PrimitiveOutput[];
  /** The signal, torque, drive and mount needs, in the record's order. */
  readonly needs: readonly BehaviourVerdict[];
  /** Its own failure modes those verdicts make active now, in the record's order. */
  readonly faults: readonly FailureModeId[];
  /** What a child sees and hears now, in the schema's effect words (EFFECTS order), from BEHAVIOUR_EFFECTS. */
  readonly effects: readonly Effect[];
}

/** One tick's answer and the state for the next tick. */
export interface BehaviourTick {
  /** Every placed part, in id order. */
  readonly parts: ReadonlyMap<PlacedPartId, PartBehaviour>;
  /** Each drive linkage's rpm, signed as its drive-out turns, in wire id order: the interface's `WireFlow.rpm`. */
  readonly drives: ReadonlyMap<WireId, number>;
  readonly state: BehaviourState;
}

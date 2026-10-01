import type {
  ArenaFeatureId,
  ControlId,
  Effect,
  EventSubject,
  FailureModeId,
  MotionPayload,
  NeedId,
  PlacedPartId,
  Pose,
  PrimitiveId,
  SoundPayload,
  Vec2,
  Vec3,
} from '@servo/schema';
import type { BehaviourModel, BehaviourTick } from '../behaviour/index.ts';

/**
 * The mechanical solver's types (task 1.4). Each tick it takes the behaviour runtime's answer (what every actuator is
 * driven with, every drive linkage's speed, every servo arm) and moves the robot in a 2.5D top-down arena: differential
 * drive from the wheels' pushes, grip and slip, collisions with walls and props, ramps, and balance as a centre-of-mass
 * check. It gives the poses, each wheel's actual speed and slip, contacts, each actuator's load for the next tick, the
 * contact switches' states, and the floor and balance verdicts with their faults and effects. Internal to sim-core; the
 * tick loop (task 1.5) wires electrical → behaviour → mechanical. See docs/mechanical.md.
 *
 * Units: millimetres, seconds, kilograms, newtons and N·mm; arena frame x to the right and y up; a robot's own frame is its
 * root part's (+x forward, +y left, +z up).
 */

// ---------------------------------------------------------------------------------------------
// The model: built once per Run, plain data, no physics engine.

/** A ramp, read from the preset: a rectangle rising by `riseMm` towards `uphill`. */
export interface FloorRamp {
  readonly id: ArenaFeatureId;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly riseMm: number;
  readonly uphill: '+x' | '-x' | '+y' | '-y';
  /** Rise per mm along the arena's x and y. */
  readonly gradient: Vec2;
}

/** Something fixed the robot bumps into: a wall, an edge of the floor, or a ramp's drop. Corners counter-clockwise, arena frame. */
export interface Solid {
  readonly kind: 'wall' | 'edge' | 'ledge';
  /** A wall's id; `east`, `north`, `south` or `west` for an edge; `<ramp>-<side>-<n>` for a ledge. */
  readonly id: string;
  readonly corners: readonly Vec2[];
}

/** A prop from the preset or the child, in id order. */
export interface PropModel {
  readonly id: ArenaFeatureId;
  /** Its event subject, `arena:<id>`. */
  readonly subject: EventSubject;
  readonly shape: 'box' | 'cylinder';
  /** Half its length and width (a cylinder's radius twice), mm. */
  readonly hx: number;
  readonly hy: number;
  /** How far its footprint reaches from its centre, mm. */
  readonly reach: number;
  /** Its footprint's radius of gyration, mm. */
  readonly gyration: number;
  readonly kilograms: number;
  readonly fixed: boolean;
  /** Where it starts. */
  readonly at: Pose;
  readonly cos: number;
  readonly sin: number;
}

export interface ArenaModel {
  readonly size: Vec2;
  /** Floor friction against wheels, the frame and props. */
  readonly friction: number;
  /** Where the robot's root part starts. */
  readonly start: Pose;
  readonly ramps: readonly FloorRamp[];
  /** Walls in the preset's order, then the floor's edges, then ledges. */
  readonly solids: readonly Solid[];
  readonly props: readonly PropModel[];
}

/** The speed actuator that turns a wheel's hub, with the gearbox gains between them and its settled parameters. */
export interface WheelDrive {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  /** Hub rpm per actuator rpm, and hub torque per actuator N·mm (the behaviour runtime's route). */
  readonly speed: number;
  readonly torque: number;
  readonly ratedVolts: number;
  readonly startVolts: number;
  readonly noLoadRpm: number;
  readonly stallTorqueNmm: number;
  readonly throttle: number;
  readonly reverse: boolean;
  readonly whenReversed: 'reverses' | 'blocks';
}

/** A wheel on the robot. Points are in the robot's frame. */
export interface WheelModel {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  readonly radiusMm: number;
  readonly grip: number;
  /** The lowest point of its tyre: where it meets the floor. */
  readonly contact: Vec3;
  /** Its rolling direction on the floor (unit), and its axle across it (unit). */
  readonly roll: Vec2;
  readonly axle: Vec2;
  /** Which way the hub's positive turning rolls it along `roll`: 1, −1, or 0 when its axle stands upright. */
  readonly rollSign: -1 | 0 | 1;
  /** The schema's `drivePushes`: along `roll`, which way it pushes when its actuator turns at positive speed. */
  readonly push: -1 | 0 | 1;
  /** The speed actuator that turns it, when one does through a linked, fixed chain. */
  readonly drive?: WheelDrive;
}

/** A support (a caster) fixed to the robot: it carries weight and rolls any way, with a little drag. */
export interface SupportModel {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  /** The bottom of its body: where it meets the floor. */
  readonly contact: Vec3;
  readonly rollingFriction: number;
}

/** A bottom corner of a part's body on the robot (not a wheel's or a support's): where the frame can rest on the floor. */
export interface BodyPoint {
  readonly part: PlacedPartId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A part's footprint on the robot: a rectangle, centre and half sizes in the robot's frame. */
export interface Footprint {
  readonly part: PlacedPartId;
  readonly x: number;
  readonly y: number;
  readonly hx: number;
  readonly hy: number;
}

/** The robot: its root part and everything fixed to it or carried by it (the schema's `placeParts`). */
export interface RobotModel {
  readonly root: PlacedPartId;
  /** Every part on it, in id order. */
  readonly parts: readonly PlacedPartId[];
  readonly kilograms: number;
  /** Centre of mass of every part on it, mounted or carried, in its frame. */
  readonly centreOfMass: Vec3;
  /** Moment of inertia about the centre of mass, about +z, kg·mm². */
  readonly inertia: number;
  /** Radius of gyration about the centre of mass, mm. */
  readonly gyration: number;
  readonly footprints: readonly Footprint[];
  /** In part id order, then the record's primitive order. */
  readonly wheels: readonly WheelModel[];
  readonly supports: readonly SupportModel[];
  readonly bodyPoints: readonly BodyPoint[];
  /** The lowest point of anything on it: the floor, when it stands level. */
  readonly bottom: number;
  /** Where its root part starts: the preset's start pose. */
  readonly start: Pose;
}

/** A contact switch (a bumper switch) and its probe segment, in its part's frame. */
export interface ProbeModel {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  readonly control: ControlId;
  readonly normally: 'open' | 'closed';
  /** On the robot: the probe's ends in the robot's frame. Elsewhere: its ends in the arena, where the part lies (D19). */
  readonly onRobot: boolean;
  readonly from: Vec2;
  readonly to: Vec2;
}

/** A body that is not the robot: a part held by no other, or its own little tree, lying where it was placed (D19). */
export interface LooseBody {
  readonly part: PlacedPartId;
  readonly pose: Pose;
}

/** Everything the solver reads that does not change during a Run. Pure data: built without the physics engine. */
export interface MechanicalModel {
  readonly behaviour: BehaviourModel;
  readonly arena: ArenaModel;
  /** Undefined when no part holds another (the schema's `robotRoot`): then nothing drives. */
  readonly robot?: RobotModel;
  /** Every part not on the robot that is held by no other, in id order. */
  readonly loose: readonly LooseBody[];
  readonly probes: readonly ProbeModel[];
  /** Every placed part in id order, and which of them are on the robot. */
  readonly parts: readonly PlacedPartId[];
  readonly onRobot: ReadonlySet<PlacedPartId>;
  /** Parts with a support primitive whose mount is not fixed, in id order: a loose caster. */
  readonly looseSupports: readonly PlacedPartId[];
}

// ---------------------------------------------------------------------------------------------
// The state: plain data, so a snapshot gives equal bytes for equal states.

/** Where each thing sits in the physics world, by the handles the engine gave it when the world was built. */
export interface WorldLayout {
  readonly robot?: { readonly body: number; readonly colliders: readonly number[] };
  /** In the model's prop order. */
  readonly props: readonly { readonly body: number; readonly collider: number }[];
  /** In the model's solid order. */
  readonly solids: readonly number[];
}

/** What the solver carries from one tick to the next. */
export interface MechanicalState {
  /** The model's fingerprint (`modelPrint`): a snapshot restores only into the model it came from. */
  readonly print: number;
  /** The physics world, as the engine's snapshot of it. */
  readonly world: Uint8Array;
  readonly layout: WorldLayout;
  /** The robot's velocity at its centre of mass in its own frame, as it actually moved in the last substep: mm/s and rad/s. */
  readonly velocity: { readonly forward: number; readonly left: number; readonly turn: number };
  /** The force the floor gave the robot in the last substep, in its frame, N: it shifts the weight forward, back and across. */
  readonly floorForce: Vec2;
  /** Once the robot falls over it stays down for the Run: which way it fell, in degrees. */
  readonly fallen?: { readonly pitch: number; readonly roll: number };
  /** What the robot touched at the end of the last tick: indices into the solids, then the props after them, ascending. */
  readonly touching: readonly number[];
}

// ---------------------------------------------------------------------------------------------
// One tick in and out.

export interface MechanicalInputs {
  /** This tick's behaviour: each actuator's drive, each drive linkage's speed, each servo arm. */
  readonly behaviour: BehaviourTick;
  /** Simulated seconds the tick covers: 1/TICK_RATE unless given. Tick 0, before any time passes, is 0: nothing moves. */
  readonly seconds?: number;
}

/** The robot's root part: its pose, how it stands, and how fast it goes. */
export interface RobotMotion {
  readonly part: PlacedPartId;
  /** Arena x and y of its root part's frame (mm), heading (degrees counter-clockwise, 0–360), pitch (front up) and roll (left side up), degrees. */
  readonly pose: MotionPayload;
  /** `upright` on its wheels and supports; `grounded` with its frame on the floor; `fallen` over. */
  readonly stance: 'upright' | 'grounded' | 'fallen';
  /** Its speed along its heading, mm/s, and how fast it turns, degrees a second counter-clockwise. */
  readonly forwardMmPerSecond: number;
  readonly turnDegPerSecond: number;
}

/** A wheel on the robot this tick. */
export interface WheelMotion {
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  /** The hub's actual speed, rpm, signed about its own axis like the behaviour runtime's. */
  readonly rpm: number;
  /** How fast the floor passes under it along its rolling direction, mm/s: the robot's speed there. */
  readonly groundMmPerSecond: number;
  /** Its tyre's speed less the ground's, along its rolling direction, mm/s: 0 while it grips. */
  readonly slipMmPerSecond: number;
  /** It meets the floor. A wheel in the air, or on a robot that has fallen over, does not. */
  readonly onFloor: boolean;
  /** It pushes harder than its grip allows, so it spins against the floor. */
  readonly slipping: boolean;
  /** The weight it carries, N. */
  readonly loadNewtons: number;
}

/** An actuator's drive this tick, for the next tick's behaviour and electrical steps. */
export interface ActuatorMotion {
  /** How fast its drive actually turns, rpm, signed as the shaft turns. */
  readonly rpm: number;
  /** The torque its drive gives against what it turns, N·mm: 0 when nothing resists. */
  readonly loadNmm: number;
  /** What it turns cannot move (a wall, or more load than it can turn): its load reads as Infinity, so it stalls. */
  readonly held: boolean;
}

/** Something the robot touches: a wall, a prop, an edge of the floor or a ramp's drop. */
export interface ArenaContact {
  readonly kind: 'wall' | 'prop' | 'edge' | 'ledge';
  readonly id: string;
}

/**
 * A floor or balance need, judged on the simulation. Balance is `lost` while the robot has fallen over (a tip) and
 * `grounded` while it rests on its frame (a drag); a floor need is judged only on a robot that has not fallen.
 */
export interface MechanicalVerdict {
  readonly need: NeedId;
  readonly kind: 'floor' | 'balance';
  /** How it is unmet now; absent when it is met or not judged. */
  readonly unmet?: 'lifted' | 'slipping' | 'lost' | 'grounded';
  /**
   * A frame grounded because a support does not hold its end up (loose, or fixed where it cannot reach the floor): that
   * support's own fault (mount · absent, or floor · lifted) stands for it, so the chassis has no fault of its own.
   */
  readonly explainedBy?: { readonly by: 'support'; readonly parts: readonly PlacedPartId[] };
}

/** One placed part this tick, as the mechanics see it. */
export interface PartMechanics {
  readonly id: PlacedPartId;
  /** Its floor and balance needs, in the record's order. */
  readonly needs: readonly MechanicalVerdict[];
  /** Its own failure modes those verdicts make active, in the record's order. */
  readonly faults: readonly FailureModeId[];
  /**
   * In EFFECTS order: `slip` on a wheel that turns without moving the robot (slipping, or in the air); `tip` on the
   * frame (the part whose balance need is judged) of a robot that has fallen over; `drag` on that frame while it rests on
   * the floor, and on a support whose failure left it down.
   */
  readonly effects: readonly Effect[];
  /** `squeal` (a slipping wheel) and `knock` (the robot's root part, as it hits something), in RUN_SOUNDS order. */
  readonly sounds: readonly SoundPayload[];
}

/** One tick's answer and the state for the next tick. */
export interface MechanicalTick {
  /** Undefined when there is no robot. */
  readonly robot?: RobotMotion;
  /** Every body's pose: the robot's root part, loose parts and props (`arena:<id>`), in subject order. */
  readonly bodies: ReadonlyMap<EventSubject, MotionPayload>;
  /** Each wheel on the robot, in part id order. */
  readonly wheels: ReadonlyMap<PlacedPartId, WheelMotion>;
  /** What the robot touches now, solids before props, each in the model's order. */
  readonly contacts: readonly ArenaContact[];
  /** Every actuator primitive of every part, by part (id order) and primitive. */
  readonly actuators: ReadonlyMap<PlacedPartId, Readonly<Record<PrimitiveId, ActuatorMotion>>>;
  /** The next tick's behaviour `loads`: loadNmm, or Infinity where held. */
  readonly loads: ReadonlyMap<PlacedPartId, Readonly<Record<PrimitiveId, number>>>;
  /** Every contact switch's state from its probe, true when closed: the next tick's `ControlState.switches` for them. */
  readonly switches: Readonly<Record<ControlId, boolean>>;
  /** Every placed part, in id order. */
  readonly parts: ReadonlyMap<PlacedPartId, PartMechanics>;
  readonly state: MechanicalState;
}

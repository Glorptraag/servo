import type { Vec2 } from '@servo/schema';
import type { SpeedOutput } from '../behaviour/index.ts';
import { clean, finite, length, magnitude, solve3 } from './maths.ts';
import { GRAVITY } from './stance.ts';
import type { Stance } from './stance.ts';
import type { RobotModel, WheelModel } from './types.ts';

/**
 * The robot's own drive, worked by hand so it stays simple and deterministic (the physics engine only stops it at
 * walls and lets it push props). Each wheel on the floor pushes along its rolling direction with what its motor gives
 * at the speed it turns, a straight line from the stall force at rest to nothing at full speed (brief Section 6:
 * speed ∝ voltage, reduced by load), and holds across its axle. A push past the wheel's grip × the weight on it slips.
 * Supports roll with a little drag, a frame on the floor slides with the floor's friction, and a slope pulls along
 * itself. The velocity is solved implicitly, so a stiff gearbox or a tight grip never makes a substep overshoot.
 */

/** Below this speed, mm/s, Coulomb friction becomes viscous, so a resting robot never jitters. */
const CREEP_MM_S = 1;

/** How firmly a wheel holds across its axle: this many times the robot's own momentum per substep. */
const ACROSS_STIFFNESS = 100;

/** rpm to mm/s along a tyre: 2π r / 60 per rpm. */
const rimPerRpm = (radius: number): number => (2 * Math.PI * radius) / 60;

/** A motor and the wheel it turns, this tick: its drive from the behaviour runtime and its torque–speed line at the tyre. */
export interface MotorDrive {
  /** Turning: its drive, throttle × volts, is at least its startVolts. */
  readonly driven: boolean;
  /** Which way it turns when driven, about its own drive axis: 1 or −1. */
  readonly sense: 1 | -1;
  /** Its stall torque now, N·mm: stallTorqueNmm × drive ÷ ratedVolts. 0 when not driven. */
  readonly capacity: number;
  /** Its speed with nothing to turn, rpm, in the way it turns: noLoadRpm × drive ÷ ratedVolts. */
  readonly freeRpm: number;
  /** The push along the wheel's rolling direction at a standstill, N, signed. */
  readonly stallForce: number;
  /** How much less it pushes for each mm/s the tyre rolls, N per mm/s (back-EMF, and a gear train's drag when unpowered). */
  readonly damping: number;
  /** mm/s along the wheel's rolling direction for each rpm the motor turns, signed by the wheel's push. */
  readonly perRpm: number;
}

/**
 * A wheel's motor now, from the behaviour runtime's output for it. The drive is throttle × volts, nothing reversed for
 * `blocks`; below startVolts it does not turn (the behaviour runtime's rule). An unpowered motor still drags its wheel
 * like a motor at 0 V (its gear train does not run free), so a robot stops within a few centimetres when its power is cut.
 */
export const motorDrive = (wheel: WheelModel, output: SpeedOutput | undefined): MotorDrive | undefined => {
  const drive = wheel.drive;
  if (!drive) return undefined;
  const volts = finite(output?.volts);
  const signed = drive.whenReversed === 'blocks' && volts < 0 ? 0 : drive.throttle * volts;
  const size = magnitude(signed);
  const driven = size > 0 && size >= drive.startVolts;
  const sense: 1 | -1 = signed < 0 !== drive.reverse ? -1 : 1;
  const share = driven ? size / drive.ratedVolts : 0;
  const tyre = drive.torque / wheel.radiusMm;
  return {
    driven,
    sense,
    capacity: drive.stallTorqueNmm * share,
    freeRpm: drive.noLoadRpm * share,
    stallForce: wheel.push * sense * tyre * drive.stallTorqueNmm * share,
    damping: (tyre * drive.stallTorqueNmm) / (drive.noLoadRpm * drive.speed * rimPerRpm(wheel.radiusMm)),
    perRpm: wheel.push * drive.speed * rimPerRpm(wheel.radiusMm),
  };
};

/** The robot's velocity at its centre of mass, in its own frame: mm/s forward and left, rad/s counter-clockwise. */
export interface Velocity {
  readonly forward: number;
  readonly left: number;
  readonly turn: number;
}

/** What one wheel on the floor does in a substep. */
export interface WheelForce {
  /** The floor's push on it along its rolling direction and across it, N. */
  readonly roll: number;
  readonly across: number;
  /** Its push reached its grip: it slips. */
  readonly slipping: boolean;
  /** The weight on it, N, and its grip limit (grip × floor friction × weight). */
  readonly load: number;
  readonly limit: number;
}

export interface DriveStep {
  readonly velocity: Velocity;
  /** Per wheel of the robot, in its order; undefined for a wheel off the floor. */
  readonly wheels: readonly (WheelForce | undefined)[];
  /** The floor's whole push on the robot, its frame, N. */
  readonly floorForce: Vec2;
}

/** A row of the system: how a velocity maps to one point's speed along one direction (forward, left, turn). */
type Row = readonly [number, number, number];

const rowAlong = (direction: Vec2, offset: Vec2): Row => [direction.x, direction.y, direction.y * offset.x - direction.x * offset.y];

const dot = (row: Row, v: Velocity): number => row[0] * v.forward + row[1] * v.left + row[2] * v.turn;

/** One substep of the robot's drive: its velocity after `seconds`, before walls and props have their say. */
export const driveStep = (
  robot: RobotModel,
  stance: Stance,
  motors: readonly (MotorDrive | undefined)[],
  friction: number,
  velocity: Velocity,
  seconds: number,
): DriveStep => {
  const com = robot.centreOfMass;
  // Mass and inertia in the units of the system: N per mm/s², N·mm per rad/s².
  const mass = robot.kilograms / 1000;
  const inertia = robot.inertia / 1000;
  const across = (ACROSS_STIFFNESS * mass) / seconds;
  const wheelLoads = new Map<number, number>();
  const frames: { readonly offset: Vec2; readonly load: number; readonly mu: number }[] = [];
  for (const contact of stance.contacts) {
    const { point, load } = contact;
    if (point.kind === 'wheel') {
      wheelLoads.set(point.index, (wheelLoads.get(point.index) ?? 0) + load);
    } else {
      const mu = point.kind === 'support' ? (robot.supports[point.index]?.rollingFriction ?? 0) : friction;
      frames.push({ offset: { x: point.x - com.x, y: point.y - com.y }, load, mu });
    }
  }
  const wheels = robot.wheels.map((wheel, index) => {
    const load = wheelLoads.get(index);
    if (load === undefined) return undefined;
    const offset = { x: wheel.contact.x - com.x, y: wheel.contact.y - com.y };
    return { wheel, motor: motors[index], load, limit: wheel.grip * friction * load, roll: rowAlong(wheel.roll, offset), side: rowAlong(wheel.axle, offset) };
  });
  // Rolling drag and sliding friction: μ × the weight on the point, against its motion. Each is solved as a drag frozen at
  // this substep's speed, so it slows its point but never past a stop; a point the solve speeds up instead (the robot
  // pulling away) is then held to exactly μN against its new motion and the rest solved again.
  const frameTerms = frames.map((frame) => {
    const ux = velocity.forward - velocity.turn * frame.offset.y;
    const uy = velocity.left + velocity.turn * frame.offset.x;
    const limit = frame.mu * frame.load;
    return { damping: limit / Math.max(length(ux, uy), CREEP_MM_S), limit, x: rowAlong({ x: 1, y: 0 }, frame.offset), y: rowAlong({ x: 0, y: 1 }, frame.offset) };
  });

  const slipping = new Map<number, { readonly roll: number; readonly across: number }>();
  const sliding = new Map<number, Vec2>();
  let solved: Velocity = velocity;
  for (let round = 0; round <= robot.wheels.length + frameTerms.length; round += 1) {
    const k = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const force = [robot.kilograms * stance.along.x, robot.kilograms * stance.along.y, 0];
    const addDamping = (row: Row, c: number): void => {
      for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) k[i * 3 + j] = (k[i * 3 + j] ?? 0) + c * (row[i] ?? 0) * (row[j] ?? 0);
    };
    const addForce = (row: Row, f: number): void => {
      for (let i = 0; i < 3; i += 1) force[i] = (force[i] ?? 0) + f * (row[i] ?? 0);
    };
    wheels.forEach((entry, index) => {
      if (!entry) return;
      const fixed = slipping.get(index);
      if (fixed) {
        addForce(entry.roll, fixed.roll);
        addForce(entry.side, fixed.across);
        return;
      }
      if (entry.motor) {
        addDamping(entry.roll, entry.motor.damping);
        addForce(entry.roll, entry.motor.stallForce);
      } else if (entry.wheel.rollSign === 0) {
        // An axle standing upright rolls nowhere: the wheel holds both ways.
        addDamping(entry.roll, across);
      }
      addDamping(entry.side, across);
    });
    frameTerms.forEach((term, index) => {
      const held = sliding.get(index);
      if (held) {
        addForce(term.x, held.x);
        addForce(term.y, held.y);
        return;
      }
      addDamping(term.x, term.damping);
      addDamping(term.y, term.damping);
    });
    const inertiaRate = [mass / seconds, mass / seconds, inertia / seconds];
    const a = k.map((value, at) => (at % 4 === 0 ? value + (inertiaRate[at / 4] ?? 0) : value));
    const b = [
      (inertiaRate[0] ?? 0) * velocity.forward + (force[0] ?? 0),
      (inertiaRate[1] ?? 0) * velocity.left + (force[1] ?? 0),
      (inertiaRate[2] ?? 0) * velocity.turn + (force[2] ?? 0),
    ];
    const x = solve3(a, b);
    solved = x ? { forward: x[0], left: x[1], turn: x[2] } : velocity;
    let more = false;
    wheels.forEach((entry, index) => {
      if (!entry || slipping.has(index)) return;
      const roll = entry.motor ? entry.motor.stallForce - entry.motor.damping * dot(entry.roll, solved) : entry.wheel.rollSign === 0 ? -across * dot(entry.roll, solved) : 0;
      const side = -across * dot(entry.side, solved);
      const size = length(roll, side);
      if (size > entry.limit) {
        const scale = size > 0 ? entry.limit / size : 0;
        slipping.set(index, { roll: roll * scale, across: side * scale });
        more = true;
      }
    });
    frameTerms.forEach((term, index) => {
      if (sliding.has(index)) return;
      const ux = dot(term.x, solved);
      const uy = dot(term.y, solved);
      const speed = length(ux, uy);
      if (term.damping * speed > term.limit * (1 + 1e-9)) {
        sliding.set(index, { x: (-term.limit * ux) / speed, y: (-term.limit * uy) / speed });
        more = true;
      }
    });
    if (!more) break;
  }

  let fx = 0;
  let fy = 0;
  const outcome = wheels.map((entry, index): WheelForce | undefined => {
    if (!entry) return undefined;
    const fixed = slipping.get(index);
    const roll = fixed
      ? fixed.roll
      : entry.motor
        ? entry.motor.stallForce - entry.motor.damping * dot(entry.roll, solved)
        : entry.wheel.rollSign === 0
          ? -across * dot(entry.roll, solved)
          : 0;
    const side = fixed ? fixed.across : -across * dot(entry.side, solved);
    fx += roll * entry.wheel.roll.x + side * entry.wheel.axle.x;
    fy += roll * entry.wheel.roll.y + side * entry.wheel.axle.y;
    return { roll: clean(roll), across: clean(side), slipping: fixed !== undefined, load: entry.load, limit: entry.limit };
  });
  frameTerms.forEach((term, index) => {
    const held = sliding.get(index);
    fx += held ? held.x : -term.damping * dot(term.x, solved);
    fy += held ? held.y : -term.damping * dot(term.y, solved);
  });
  return {
    velocity: { forward: clean(solved.forward), left: clean(solved.left), turn: clean(solved.turn) },
    wheels: outcome,
    floorForce: { x: clean(fx), y: clean(fy) },
  };
};

/** A fallen robot slides to a stop on its side, slowed by the floor's friction. */
export const coast = (robot: RobotModel, friction: number, velocity: Velocity, seconds: number): Velocity => {
  // The floor slows it by μ g each second: 1000 × μ × g mm/s² along, and that over its radius of gyration in turning.
  const drop = 1000 * friction * GRAVITY * seconds;
  const speed = length(velocity.forward, velocity.left);
  const keep = speed > drop ? (speed - drop) / speed : 0;
  const turnDrop = robot.gyration > 0 ? drop / robot.gyration : Number.POSITIVE_INFINITY;
  const turn = magnitude(velocity.turn) > turnDrop ? velocity.turn - Math.sign(velocity.turn) * turnDrop : 0;
  return { forward: clean(velocity.forward * keep), left: clean(velocity.left * keep), turn: clean(turn) };
};

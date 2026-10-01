import { EFFECTS, RUN_SOUNDS, TICK_RATE, cosSin, normalizeDegrees } from '@servo/schema';
import type { ArenaPreset, ControlId, Effect, EventSubject, FailureModeId, MotionPayload, PlacedPartId, PrimitiveId, SoundPayload, Vec2 } from '@servo/schema';
import type { BehaviourModel, BehaviourTick, SpeedOutput, WheelOutput } from '../behaviour/index.ts';
import type { World } from '@dimforge/rapier2d-deterministic-compat';
import { arenaModel } from './arena.ts';
import { coast, driveStep, motorDrive } from './drive.ts';
import type { MotorDrive, Velocity } from './drive.ts';
import { DEGREES_PER_RADIAN, atanDegrees, clamp, clean, finite, length, magnitude, wrapRadians } from './maths.ts';
import { robotParts } from './robot.ts';
import { decodeState, encodeState } from './snapshot.ts';
import { loadingOf, stanceOf, stancePoints } from './stance.ts';
import type { Placing, Stance, StancePoint } from './stance.ts';
import type {
  ActuatorMotion,
  ArenaContact,
  MechanicalInputs,
  MechanicalModel,
  MechanicalState,
  MechanicalTick,
  MechanicalVerdict,
  PartMechanics,
  ProbeModel,
  RobotModel,
  RobotMotion,
  WheelMotion,
  WorldLayout,
} from './types.ts';
import { bodyOf, buildWorld, markProps, obstacleBoxes, openWorld, probeTouches, robotTouching, slowProps } from './world.ts';

/** Substeps per tick: a quarter of a tick each (1/120 s), so the robot moves under 3 mm between collision checks. */
export const SUBSTEPS = 4;

/** A driven motor turning slower than this share of its free speed, the way it drives, is held: it stalls. */
export const HELD_SHARE = 0.01;

/** Slip, mm/s, at which a wheel's squeal is loudest. */
const SQUEAL_FULL_MM_S = 300;

/** The speed going into a collision, mm/s, at which its knock is loudest; a new contact always knocks at least KNOCK_LEAST. */
const KNOCK_FULL_MM_S = 400;
const KNOCK_LEAST = 0.1;

const rimPerRpm = (radius: number): number => (2 * Math.PI * radius) / 60;

/**
 * The mechanical solver's view of a Run: the robot as a rigid body, the parts lying where they were placed (D19), the
 * contact switches' probes and the arena (the preset, with the child's props from the blueprint). Built once per Run;
 * pure and without the physics engine, so it needs no `initMechanics`.
 */
export const mechanicalModel = (behaviour: BehaviourModel, preset: ArenaPreset): MechanicalModel => {
  const arena = arenaModel(preset, behaviour.graph.blueprint.arena.props);
  return { behaviour, arena, ...robotParts(behaviour, arena) };
};

/** The state a Run starts from: the world as built, everything at rest. Needs `initMechanics` to have finished. */
export const startMechanics = (model: MechanicalModel): MechanicalState => {
  const { bytes, layout } = buildWorld(model, 1 / (TICK_RATE * SUBSTEPS));
  return { world: bytes, layout, velocity: { forward: 0, left: 0, turn: 0 }, floorForce: { x: 0, y: 0 }, touching: [] };
};

/** The state as bytes, for the Run's snapshot: equal states give equal bytes. */
export const mechanicalSnapshot = (state: MechanicalState): Uint8Array => encodeState(state);

/** The state `mechanicalSnapshot` wrote. Throws when the bytes come from another Run's model. */
export const restoreMechanics = (model: MechanicalModel, bytes: Uint8Array): MechanicalState => decodeState(model, bytes);

// ---------------------------------------------------------------------------------------------

const speedOutputOf = (behaviour: BehaviourTick, part: PlacedPartId, primitive: PrimitiveId): SpeedOutput | undefined => {
  const output = behaviour.parts.get(part)?.primitives.find((each) => each.primitive === primitive);
  return output?.kind === 'actuator' && output.mode === 'speed' ? output : undefined;
};

const wheelOutputOf = (behaviour: BehaviourTick, part: PlacedPartId, primitive: PrimitiveId): WheelOutput | undefined => {
  const output = behaviour.parts.get(part)?.primitives.find((each) => each.primitive === primitive);
  return output?.kind === 'wheel' ? output : undefined;
};

/** The robot's root part where the world has it: position, heading (radians) and centre of mass. */
interface Pose2 {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly comX: number;
  readonly comY: number;
}

const poseOf = (world: World, layout: WorldLayout): Pose2 | undefined => {
  if (!layout.robot) return undefined;
  const body = bodyOf(world, layout.robot.body);
  const at = body.translation();
  const com = body.worldCom();
  return { x: at.x, y: at.y, angle: body.rotation(), comX: com.x, comY: com.y };
};

const placingOf = (pose: Pose2): Placing => {
  const [cos, sin] = cosSin(pose.angle * DEGREES_PER_RADIAN);
  return { x: pose.x, y: pose.y, cos, sin };
};

const toArena = (at: Placing, point: Vec2): Vec2 => ({ x: at.x + at.cos * point.x - at.sin * point.y, y: at.y + at.sin * point.x + at.cos * point.y });

const probeEnds = (probe: ProbeModel, at: Placing | undefined): readonly [Vec2, Vec2] =>
  probe.onRobot && at ? [toArena(at, probe.from), toArena(at, probe.to)] : [probe.from, probe.to];

/** Which way a fallen robot lies: on its front or back (pitch ∓90) or a side (roll ∓90), the way its weight left. */
const fallOf = (fall: Vec2): { readonly pitch: number; readonly roll: number } =>
  magnitude(fall.x) >= magnitude(fall.y) ? { pitch: fall.x > 0 ? -90 : 90, roll: 0 } : { pitch: 0, roll: fall.y > 0 ? -90 : 90 };

const sortedSounds = (sounds: readonly SoundPayload[]): readonly SoundPayload[] =>
  RUN_SOUNDS.flatMap((name) => sounds.filter((sound) => sound.sound === name).slice(0, 1));

const sortedEffects = (effects: ReadonlySet<Effect>): readonly Effect[] => EFFECTS.filter((effect) => effects.has(effect));

/** How the robot stands where it is, given the floor's last push. */
const stanceAt = (robot: RobotModel, points: readonly StancePoint[], at: Placing, model: MechanicalModel, floorForce: Vec2): Stance =>
  stanceOf(robot, points, loadingOf(robot, points, at, model.arena.ramps, floorForce));

/**
 * One tick of the mechanical solver. In four substeps the robot's drive pushes it (drive.ts), the physics engine stops
 * it at walls and lets it push props, the floor slows the props, and each contact switch's probe is swept along its
 * travel. Then it gives the poses, each wheel's actual speed and slip, what the robot touches, each actuator's load for
 * the next tick, the contact switches' states, and the floor and balance verdicts with their faults, effects and
 * sounds. Pure and deterministic: the state is bytes and numbers, and nothing reads a clock.
 */
export const mechanicalTick = (model: MechanicalModel, state: MechanicalState, inputs: MechanicalInputs): MechanicalTick => {
  const given = finite(inputs.seconds);
  const seconds = inputs.seconds === undefined ? 1 / TICK_RATE : given > 0 ? given : 0;
  const steps = seconds > 0 ? SUBSTEPS : 0;
  const substep = steps > 0 ? seconds / SUBSTEPS : 1 / (TICK_RATE * SUBSTEPS);
  const robot = model.robot;
  const { layout } = state;
  const behaviour = inputs.behaviour;
  const friction = model.arena.friction;
  const points = robot ? stancePoints(robot) : [];
  const motors: readonly (MotorDrive | undefined)[] = robot
    ? robot.wheels.map((wheel) => (wheel.drive ? motorDrive(wheel, speedOutputOf(behaviour, wheel.drive.part, wheel.drive.primitive)) : undefined))
    : [];

  const world = openWorld(state.world, substep);
  try {
    let velocity: Velocity = state.velocity;
    let floorForce = state.floorForce;
    let fallen = state.fallen;
    let fastest = 0;
    const probeTouched = model.probes.map(() => false);

    for (let step = 0; step < steps; step += 1) {
      const before = poseOf(world, layout);
      const at = before ? placingOf(before) : undefined;
      let wanted: Velocity | undefined;
      if (robot && before && at && layout.robot) {
        if (fallen) {
          wanted = coast(robot, friction, velocity, substep);
        } else {
          const stance = stanceAt(robot, points, at, model, floorForce);
          if (stance.state === 'fallen') {
            fallen = fallOf(stance.fall ?? { x: 1, y: 0 });
            wanted = coast(robot, friction, velocity, substep);
          } else {
            const drive = driveStep(robot, stance, motors, friction, velocity, substep);
            wanted = drive.velocity;
            floorForce = drive.floorForce;
          }
        }
        const body = bodyOf(world, layout.robot.body);
        body.setLinvel({ x: clean(wanted.forward * at.cos - wanted.left * at.sin), y: clean(wanted.forward * at.sin + wanted.left * at.cos) }, true);
        body.setAngvel(wanted.turn, true);
      }
      const marks = markProps(world, model, layout);
      world.step();
      slowProps(world, model, layout, marks, substep);
      const after = poseOf(world, layout);
      if (wanted && before && after && at) {
        // How it actually moved, from where it went: the engine's own velocity record is not physical in a contact stack.
        const vx = (after.comX - before.comX) / substep;
        const vy = (after.comY - before.comY) / substep;
        const actual: Velocity = {
          forward: clean(vx * at.cos + vy * at.sin),
          left: clean(-vx * at.sin + vy * at.cos),
          turn: clean(wrapRadians(after.angle - before.angle) / substep),
        };
        // How hard it could hit something this tick: its speed going into each substep.
        fastest = Math.max(fastest, length(velocity.forward, velocity.left) + magnitude(velocity.turn) * (robot?.gyration ?? 0));
        velocity = actual;
      }
      const later = after ? placingOf(after) : undefined;
      const boxes = model.probes.length > 0 ? obstacleBoxes(world, model, layout) : [];
      model.probes.forEach((probe, index) => {
        if (!probeTouched[index] && probeTouches(world, layout, boxes, probeEnds(probe, at), probeEnds(probe, later))) probeTouched[index] = true;
      });
    }

    const end = poseOf(world, layout);
    const at = end ? placingOf(end) : undefined;
    if (steps === 0 && model.probes.length > 0) {
      const boxes = obstacleBoxes(world, model, layout);
      model.probes.forEach((probe, index) => {
        const ends = probeEnds(probe, at);
        probeTouched[index] = probeTouches(world, layout, boxes, ends, ends);
      });
    }
    let stance: Stance | undefined = robot && at && !fallen ? stanceAt(robot, points, at, model, floorForce) : undefined;
    if (stance?.state === 'fallen') {
      // Nothing it has can hold it up, even before any time passes: it falls now, and stays down.
      fallen = fallOf(stance.fall ?? { x: 1, y: 0 });
      stance = undefined;
    }
    const touching = steps > 0 ? robotTouching(world, layout) : state.touching;
    const knocked = touching.some((index) => !state.touching.includes(index));
    const next: MechanicalState = {
      world: world.takeSnapshot(),
      layout,
      velocity,
      floorForce,
      ...(fallen ? { fallen } : {}),
      touching,
    };
    return outputs(model, inputs.behaviour, next, { at, end, stance, motors, probeTouched, knocked, fastest, seconds, world });
  } finally {
    world.free();
  }
};

interface Finish {
  readonly at: Placing | undefined;
  readonly end: Pose2 | undefined;
  /** How it stands now; undefined with no robot, or once it has fallen. */
  readonly stance: Stance | undefined;
  readonly motors: readonly (MotorDrive | undefined)[];
  readonly probeTouched: readonly boolean[];
  readonly knocked: boolean;
  /** The robot's top speed going into a substep this tick, mm/s, with its turning at its radius of gyration. */
  readonly fastest: number;
  readonly seconds: number;
  readonly world: World;
}

/** Everything a tick gives, read from the state it leaves and how the robot stands. */
const outputs = (model: MechanicalModel, behaviour: BehaviourTick, state: MechanicalState, finish: Finish): MechanicalTick => {
  const robot = model.robot;
  const { at, end, stance, motors, seconds } = finish;
  const fallen = state.fallen;
  const velocity = state.velocity;
  const parts = new Map<PlacedPartId, { needs: MechanicalVerdict[]; effects: Set<Effect>; sounds: SoundPayload[] }>(
    model.parts.map((id) => [id, { needs: [], effects: new Set<Effect>(), sounds: [] }]),
  );

  // ---- Balance (the rule of review 2.6): fallen over is `lost`, a tip; resting on its frame is `grounded`, a drag. A frame
  // grounded because a support does not hold its end up (loose, or fixed where it cannot reach the floor) is explained by
  // that support's own fault, so the chassis has none of its own; with no such support the frame scrapes.
  const touchingPoints = new Set((stance?.contacts ?? []).map((contact) => `${contact.point.kind}:${contact.point.index}`));
  const frameDown = !fallen && stance?.state === 'grounded';
  const shortSupports = robot ? robot.supports.flatMap((support, index) => (support.contact.z > robot.bottom + 0.5 && !touchingPoints.has(`support:${index}`) ? [support.part] : [])) : [];
  const unsupported = frameDown ? [...new Set([...model.looseSupports, ...shortSupports])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  let balance: MechanicalVerdict['unmet'];
  let explainedBy: MechanicalVerdict['explainedBy'];
  if (robot && fallen) balance = 'lost';
  else if (robot && frameDown) {
    balance = 'grounded';
    if (unsupported.length > 0) explainedBy = { by: 'support', parts: unsupported };
  }
  const tipped = balance === 'lost';

  // ---- Wheels: actual speed, slip and grip at the end of the tick.
  const wheels = new Map<PlacedPartId, WheelMotion>();
  const actuators = new Map<PlacedPartId, Record<PrimitiveId, ActuatorMotion>>();
  const setActuator = (part: PlacedPartId, primitive: PrimitiveId, motion: ActuatorMotion): void => {
    actuators.set(part, { ...actuators.get(part), [primitive]: motion });
  };
  const loadOf = new Map((stance?.contacts ?? []).filter((contact) => contact.point.kind === 'wheel').map((contact) => [contact.point.index, contact.load]));
  const com = robot?.centreOfMass ?? { x: 0, y: 0, z: 0 };
  robot?.wheels.forEach((wheel, index) => {
    const onFloor = !fallen && loadOf.has(index);
    const load = onFloor ? (loadOf.get(index) ?? 0) : 0;
    const limit = wheel.grip * model.arena.friction * load;
    const motor = motors[index];
    const offset = { x: wheel.contact.x - com.x, y: wheel.contact.y - com.y };
    const ground = onFloor ? wheel.roll.x * (velocity.forward - velocity.turn * offset.y) + wheel.roll.y * (velocity.left + velocity.turn * offset.x) : 0;
    // It slips if, as the tick ends, its motor's push at the speed it really goes beats its grip under the weight it now
    // carries, the same grip the drive solves with: so a wall that holds the robot shows, and a slip that ended within the
    // tick (a launch that spins its wheels for a moment) shows nothing.
    const pushAtSpeed = motor ? motor.stallForce - motor.damping * ground : 0;
    const slipping = onFloor && seconds > 0 && magnitude(pushAtSpeed) > limit * (1 + 1e-9);
    let rim: number;
    let motorRpm: number | undefined;
    let torque = 0;
    let held = false;
    if (!onFloor || !motor || !wheel.drive) {
      // In the air, on a fallen robot, or turned by nothing: it spins as the behaviour runtime has it, or rolls with the floor.
      const spun = wheelOutputOf(behaviour, wheel.part, wheel.primitive)?.rpm ?? 0;
      rim = onFloor ? ground : spun * rimPerRpm(wheel.radiusMm);
      motorRpm = wheel.drive && !onFloor ? speedOutputOf(behaviour, wheel.drive.part, wheel.drive.primitive)?.rpm : undefined;
    } else if (slipping) {
      // It spins against the floor: its motor turns as fast as the grip's drag lets it.
      const grip = (limit * wheel.radiusMm) / wheel.drive.torque;
      torque = motor.driven ? Math.min(motor.capacity, grip) : 0;
      motorRpm = motor.driven && motor.capacity > 0 ? motor.sense * motor.freeRpm * (1 - torque / motor.capacity) : 0;
      rim = motor.driven ? motorRpm * motor.perRpm : 0;
    } else {
      motorRpm = motor.perRpm !== 0 ? ground / motor.perRpm : 0;
      rim = ground;
      if (motor.driven && seconds > 0) {
        const along = motor.sense * motorRpm;
        held = along <= HELD_SHARE * motor.freeRpm;
        torque = held ? motor.capacity : Math.max(0, motor.capacity * (1 - along / motor.freeRpm));
        if (held) {
          // Stalled: the motor and its wheel stand still, whatever creep the robot has.
          motorRpm = 0;
          rim = 0;
        }
      }
    }
    const hubRpm = clean(rim / rimPerRpm(wheel.radiusMm));
    wheels.set(wheel.part, {
      part: wheel.part,
      primitive: wheel.primitive,
      rpm: hubRpm,
      groundMmPerSecond: clean(ground),
      slipMmPerSecond: clean(onFloor && !held ? rim - ground : 0),
      onFloor,
      slipping,
      loadNewtons: clean(load),
    });
    if (wheel.drive && motorRpm !== undefined) setActuator(wheel.drive.part, wheel.drive.primitive, { rpm: clean(motorRpm), torqueNmm: clean(torque), held });
    const entry = parts.get(wheel.part);
    if (!entry) return;
    // A wheel that turns but does not move the robot: spinning against the floor, or in the air.
    if (slipping || (!onFloor && hubRpm !== 0)) entry.effects.add('slip');
    if (slipping) entry.sounds.push({ sound: 'squeal', level: clean(clamp(magnitude(rim - ground) / SQUEAL_FULL_MM_S, 0.01, 1)) });
  });

  // ---- Every other actuator turns as the behaviour runtime has it, with nothing to push.
  for (const part of model.behaviour.parts) {
    for (const spec of part.primitives) {
      if (spec.kind !== 'actuator' || actuators.get(part.id)?.[spec.id]) continue;
      const output = behaviour.parts.get(part.id)?.primitives.find((each) => each.primitive === spec.id);
      const rpm = output?.kind === 'actuator' ? output.rpm : 0;
      setActuator(part.id, spec.id, { rpm: clean(finite(rpm)), torqueNmm: 0, held: false });
    }
  }
  const loads = new Map<PlacedPartId, Record<PrimitiveId, number>>();
  for (const [part, record] of actuators) {
    loads.set(part, Object.fromEntries(Object.entries(record).map(([primitive, motion]) => [primitive, motion.held ? Number.POSITIVE_INFINITY : motion.torqueNmm])));
  }

  // ---- Needs, faults, effects and sounds, part by part.
  for (const part of model.behaviour.parts) {
    const entry = parts.get(part.id);
    if (!entry) continue;
    const onRobot = model.onRobot.has(part.id);
    for (const need of part.record.needs) {
      if (need.kind === 'balance') {
        entry.needs.push({ need: need.id, kind: 'balance', ...(onRobot && balance ? { unmet: balance } : {}), ...(onRobot && explainedBy ? { explainedBy } : {}) });
      } else if (need.kind === 'floor') {
        // Judged for the wheels and fixed supports on the robot while it has not tipped: a tip stands for what it lifts.
        // A support is off the floor only when that leaves the frame down; held clear by other wheels, it is not needed.
        let unmet: MechanicalVerdict['unmet'];
        if (onRobot && robot && !tipped) {
          const wheel = wheels.get(part.id);
          if (wheel) unmet = !wheel.onFloor ? 'lifted' : wheel.slipping ? 'slipping' : undefined;
          else if (unsupported.includes(part.id)) unmet = 'lifted';
        }
        entry.needs.push({ need: need.id, kind: 'floor', ...(unmet ? { unmet } : {}) });
      }
    }
    // `tip` and `drag` are the robot's: its frame (the part judging its balance) shows them, and so does a support that
    // left the frame down, whose own failure claims the drag.
    const balanceNeed = part.record.needs.some((need) => need.kind === 'balance');
    if (onRobot && balanceNeed && tipped) entry.effects.add('tip');
    if (frameDown && ((onRobot && balanceNeed) || unsupported.includes(part.id))) entry.effects.add('drag');
  }
  if (robot && finish.knocked) {
    parts.get(robot.root)?.sounds.push({ sound: 'knock', level: clean(clamp(finish.fastest / KNOCK_FULL_MM_S, KNOCK_LEAST, 1)) });
  }

  const partOutputs = new Map<PlacedPartId, PartMechanics>();
  for (const part of model.behaviour.parts) {
    const entry = parts.get(part.id);
    if (!entry) continue;
    const faults: FailureModeId[] = part.record.failureModes
      .filter((mode) => entry.needs.some((verdict) => verdict.need === mode.need && verdict.unmet === mode.unmet && verdict.explainedBy === undefined))
      .map((mode) => mode.id);
    partOutputs.set(part.id, { id: part.id, needs: entry.needs, faults, effects: sortedEffects(entry.effects), sounds: sortedSounds(entry.sounds) });
  }

  // ---- Poses.
  const bodies = new Map<EventSubject, MotionPayload>();
  let robotMotion: RobotMotion | undefined;
  if (robot && end && at) {
    const tilt = stance ? { x: stance.floor.x + stance.tilt.x, y: stance.floor.y + stance.tilt.y } : { x: 0, y: 0 };
    const pose: MotionPayload = {
      x: clean(end.x),
      y: clean(end.y),
      heading: normalizeDegrees(end.angle * DEGREES_PER_RADIAN),
      pitch: fallen ? fallen.pitch : atanDegrees(tilt.x),
      roll: fallen ? fallen.roll : atanDegrees(tilt.y),
    };
    bodies.set(robot.root, pose);
    robotMotion = {
      part: robot.root,
      pose,
      stance: fallen ? 'fallen' : frameDown ? 'grounded' : 'upright',
      // The root's own speed along its heading: its centre of mass's, less what turning adds at its offset.
      forwardMmPerSecond: clean(velocity.forward + velocity.turn * com.y),
      turnDegPerSecond: clean(velocity.turn * DEGREES_PER_RADIAN),
    };
  }
  for (const body of model.loose) bodies.set(body.part, { x: clean(body.pose.x), y: clean(body.pose.y), heading: normalizeDegrees(body.pose.heading) });
  model.arena.props.forEach((prop, index) => {
    const entry = state.layout.props[index];
    if (prop.fixed || !entry) {
      bodies.set(prop.subject, { x: prop.at.x, y: prop.at.y, heading: normalizeDegrees(prop.at.heading) });
      return;
    }
    const body = bodyOf(finish.world, entry.body);
    const where = body.translation();
    bodies.set(prop.subject, { x: clean(where.x), y: clean(where.y), heading: normalizeDegrees(body.rotation() * DEGREES_PER_RADIAN) });
  });
  const orderedBodies = new Map([...bodies].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

  // ---- Contacts and contact switches.
  const solids = model.arena.solids.length;
  const contacts: ArenaContact[] = state.touching.map((index) =>
    index < solids ? { kind: model.arena.solids[index]?.kind ?? 'wall', id: model.arena.solids[index]?.id ?? '' } : { kind: 'prop', id: model.arena.props[index - solids]?.id ?? '' },
  );
  const switches: Record<ControlId, boolean> = {};
  model.probes.forEach((probe, index) => {
    const touched = finish.probeTouched[index] === true;
    switches[probe.control] = touched ? probe.normally === 'open' : probe.normally === 'closed';
  });

  return {
    ...(robotMotion ? { robot: robotMotion } : {}),
    bodies: orderedBodies,
    wheels,
    contacts,
    actuators,
    loads,
    switches,
    parts: partOutputs,
    state,
  };
};

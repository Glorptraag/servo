// What one Run frame means for the drawing, folded tick by tick (brief Section 11: every motion has a physical cause).
// Pure and clock-free: the same frames give the same state, so a Run looks the same on every device and in every
// replay. Raw values drive motion (dots, treads, arms, light, poses); debounced faults (`LiveState.faults`) drive
// fault visuals, through the effects their failure modes show. See docs/run-animation.md.
import { TICK_RATE } from '@servo/schema';
import type { ArenaFeatureId, Effect, MotionPayload, PlacedPartId, Pose, RunSound, WireId } from '@servo/schema';
import type { LiveState, RunFrame } from '@servo/sim-core/interface';
import type { ArenaMatrix } from '../scene/arena.ts';
import { arenaToCanvas } from '../scene/arena.ts';
import type { Scene } from '../scene/scene.ts';
import type { RunCast } from './cast.ts';
import { DOT_MAX_MM_PER_S, DOT_MM_PER_S_PER_ROOT_MA, LIVE_MA, LIVE_SIGNAL, SIGNAL_MM_PER_S } from './look.ts';

/** A body's place on the canvas now: its frame origin (mm), its turn (degrees clockwise), and its tilt (degrees). */
export interface BodyPose {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  /** Positive when its front is higher (sim-core's mechanics). */
  readonly pitch: number;
  /** Positive when its left side is higher. */
  readonly roll: number;
}

export interface WireState {
  /** How fast the dots move along it, mm per simulated second; positive from its `from` port to its `to` port. 0: dead. */
  readonly speed: number;
  /** How far the dots have moved since the Run started, mm, signed as `speed`. */
  readonly travelled: number;
}

export interface RunState {
  readonly tick: number;
  /** Bodies with a pose (the robot's root, loose parts), by their root part. */
  readonly bodies: ReadonlyMap<PlacedPartId, BodyPose>;
  /** Props that moved, in arena millimetres. */
  readonly props: ReadonlyMap<ArenaFeatureId, Pose>;
  /** Power and signal lines. */
  readonly wires: ReadonlyMap<WireId, WireState>;
  /** How far each wheel's tyre surface has turned since the Run started, mm: positive rolls the part forward. */
  readonly treads: ReadonlyMap<PlacedPartId, number>;
  /** Each wheel's tyre surface speed now, mm per simulated second. */
  readonly rims: ReadonlyMap<PlacedPartId, number>;
  /** Each arm's angle, degrees. */
  readonly arms: ReadonlyMap<PlacedPartId, number>;
  /** Each light's level, 0–1. */
  readonly lights: ReadonlyMap<PlacedPartId, number>;
  /** Each battery pack's charge, 0–1. */
  readonly charges: ReadonlyMap<PlacedPartId, number>;
  /** Each switch: closed or open. */
  readonly closed: ReadonlyMap<PlacedPartId, boolean>;
  /** The machine sounds playing on each part, and their levels (0–1). */
  readonly sounds: ReadonlyMap<PlacedPartId, ReadonlyMap<RunSound, number>>;
  /** Parts with an active fault that shows `stall`: they shudder. */
  readonly stalled: ReadonlySet<PlacedPartId>;
  /** Parts with an active fault that shows `drain`: a battery pack's gauge shows it. */
  readonly draining: ReadonlySet<PlacedPartId>;
  /** Bodies whose frame drags on the floor: a part on them, or standing for them, has an active fault that shows `drag`. */
  readonly dragging: ReadonlySet<PlacedPartId>;
}

/** The state between two frames, for drawing: `ticks` is fractional, and `shake` runs from −1 to 1 and back once a tick. */
export interface RunDisplay extends RunState {
  readonly ticks: number;
  readonly shake: number;
}

const PROP_PREFIX = 'arena:';

/** The power line's dot speed for its current: √mA, so a trickle crawls and a short races, capped. */
export const powerSpeed = (milliamps: number): number => {
  const size = Math.abs(milliamps);
  if (!(size >= LIVE_MA)) return 0;
  return Math.sign(milliamps) * Math.min(DOT_MAX_MM_PER_S, DOT_MM_PER_S_PER_ROOT_MA * Math.sqrt(size));
};

export const signalSpeed = (level: number): number => (level >= LIVE_SIGNAL ? SIGNAL_MM_PER_S * Math.min(1, level) : 0);

/** The tyre's surface speed for a wheel turning at `rpm`. */
export const rimSpeed = (rpm: number, radiusMm: number): number => (rpm / 60) * 2 * Math.PI * radiusMm;

/** The angle, in degrees clockwise on the canvas, that the arena's +x lies at: the matrix maps arena headings onto it. */
export const arenaTurn = (matrix: ArenaMatrix): number => (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;

/**
 * A body's pose on the arena floor as a canvas pose. The arena is laid so the start pose falls on the robot's root
 * (scene/arena.ts), and its matrix is a reflection: an arena heading `h` (counter-clockwise) lies at `turn − h`.
 */
export const canvasPoseOfMotion = (motion: MotionPayload, matrix: ArenaMatrix): BodyPose => {
  const at = arenaToCanvas(matrix, motion);
  return { x: at.x, y: at.y, rotation: arenaTurn(matrix) - motion.heading, pitch: motion.pitch ?? 0, roll: motion.roll ?? 0 };
};

const effectsOf = (cast: RunCast, partId: PlacedPartId, live: LiveState): readonly Effect[] => {
  const modes = cast.effects.get(partId);
  if (!modes) return [];
  return live.faults.flatMap((failure) => modes.get(failure) ?? []);
};

/** The body a dragging part stands for: its own body, or the robot when it is a loose part on its own (a loose caster). */
const draggedBody = (cast: RunCast, partId: PlacedPartId): PlacedPartId => {
  const body = cast.bodyOf.get(partId) ?? partId;
  const alone = (cast.bodies.get(body)?.length ?? 1) <= 1;
  return alone && body === partId && cast.robot !== undefined ? cast.robot : body;
};

/**
 * Folds one frame into the state. `previous` is the state of the frame before; a frame at the same or an earlier tick
 * (a restore) starts again from it. Motion between ticks accumulates at the new frame's rates over the ticks between.
 */
export const advance = (
  previous: RunState | undefined,
  frame: RunFrame,
  cast: RunCast,
  scene: Scene,
  matrix: ArenaMatrix | undefined,
): RunState => {
  const before = previous !== undefined && frame.tick > previous.tick ? previous : undefined;
  const seconds = before ? (frame.tick - before.tick) / TICK_RATE : 0;

  const bodies = new Map<PlacedPartId, BodyPose>();
  const props = new Map<ArenaFeatureId, Pose>();
  const treads = new Map<PlacedPartId, number>();
  const rims = new Map<PlacedPartId, number>();
  const arms = new Map<PlacedPartId, number>();
  const lights = new Map<PlacedPartId, number>();
  const charges = new Map<PlacedPartId, number>();
  const closed = new Map<PlacedPartId, boolean>();
  const sounds = new Map<PlacedPartId, ReadonlyMap<RunSound, number>>();
  const stalled = new Set<PlacedPartId>();
  const draining = new Set<PlacedPartId>();
  const dragging = new Set<PlacedPartId>();

  for (const [subject, live] of frame.live) {
    if (subject.startsWith(PROP_PREFIX)) {
      const motion = live.motion;
      if (motion) props.set(subject.slice(PROP_PREFIX.length), { x: motion.x, y: motion.y, heading: motion.heading });
      continue;
    }
    if (!scene.partById.has(subject)) continue;
    const { values } = live;
    if (live.motion && matrix) bodies.set(subject, canvasPoseOfMotion(live.motion, matrix));
    const wheel = cast.wheels.get(subject);
    if (wheel) {
      const speed = rimSpeed(values.rpm ?? 0, wheel.radiusMm);
      rims.set(subject, speed);
      treads.set(subject, (before?.treads.get(subject) ?? 0) + speed * seconds);
    }
    if (cast.arms.has(subject) && values.angle !== undefined) arms.set(subject, values.angle);
    if (cast.lights.has(subject)) lights.set(subject, Math.max(0, Math.min(1, values.light ?? 0)));
    if (values.charge !== undefined) charges.set(subject, Math.max(0, Math.min(1, values.charge)));
    if (values.closed !== undefined) closed.set(subject, values.closed);
    if (live.sounds.length > 0) sounds.set(subject, new Map(live.sounds.map((sound) => [sound.sound, sound.level])));
    for (const effect of effectsOf(cast, subject, live)) {
      if (effect === 'stall') stalled.add(subject);
      if (effect === 'drain') draining.add(subject);
      if (effect === 'drag') dragging.add(draggedBody(cast, subject));
    }
  }

  const wires = new Map<WireId, WireState>();
  for (const wire of scene.wires) {
    const flow = frame.flows.get(wire.id);
    const speed = wire.type === 'signal' ? signalSpeed(flow?.signal ?? 0) : powerSpeed(flow?.milliamps ?? 0);
    wires.set(wire.id, { speed, travelled: (before?.wires.get(wire.id)?.travelled ?? 0) + speed * seconds });
  }

  return { tick: frame.tick, bodies, props, wires, treads, rims, arms, lights, charges, closed, sounds, stalled, draining, dragging };
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The shortest way round from `a` to `b`, degrees. */
const turnBetween = (a: number, b: number): number => {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

const blendNumbers = <K>(from: ReadonlyMap<K, number>, to: ReadonlyMap<K, number>, t: number): Map<K, number> => {
  const out = new Map<K, number>();
  for (const [key, value] of to) out.set(key, lerp(from.get(key) ?? value, value, t));
  return out;
};

/** −1 on even ticks, 1 on odd ones: a shudder once a tick, the same in every replay. */
const shakeOf = (tick: number): number => (tick % 2 === 0 ? -1 : 1);

/**
 * The drawing between frame `from` and frame `to`, `t` of the way (0–1). Positions, turns, phases and levels blend;
 * which wires are live, switches, sounds' presence and faults are `to`'s, so they change on the tick they happen.
 */
export const blend = (from: RunState | undefined, to: RunState, t: number): RunDisplay => {
  const a = from !== undefined && from.tick < to.tick ? from : undefined;
  const k = a ? Math.max(0, Math.min(1, t)) : 1;
  if (!a || k >= 1) return { ...to, ticks: to.tick, shake: shakeOf(to.tick) };
  const bodies = new Map<PlacedPartId, BodyPose>();
  for (const [id, pose] of to.bodies) {
    const was = a.bodies.get(id) ?? pose;
    bodies.set(id, {
      x: lerp(was.x, pose.x, k),
      y: lerp(was.y, pose.y, k),
      rotation: was.rotation + turnBetween(was.rotation, pose.rotation) * k,
      pitch: lerp(was.pitch, pose.pitch, k),
      roll: lerp(was.roll, pose.roll, k),
    });
  }
  const props = new Map<ArenaFeatureId, Pose>();
  for (const [id, pose] of to.props) {
    const was = a.props.get(id) ?? pose;
    props.set(id, { x: lerp(was.x, pose.x, k), y: lerp(was.y, pose.y, k), heading: was.heading + turnBetween(was.heading, pose.heading) * k });
  }
  const wires = new Map<WireId, WireState>();
  for (const [id, wire] of to.wires) {
    wires.set(id, { speed: wire.speed, travelled: lerp(a.wires.get(id)?.travelled ?? wire.travelled, wire.travelled, k) });
  }
  const sounds = new Map<PlacedPartId, ReadonlyMap<RunSound, number>>();
  for (const [id, playing] of to.sounds) sounds.set(id, blendNumbers(a.sounds.get(id) ?? new Map(), playing, k));
  return {
    ...to,
    bodies,
    props,
    wires,
    treads: blendNumbers(a.treads, to.treads, k),
    rims: blendNumbers(a.rims, to.rims, k),
    arms: blendNumbers(a.arms, to.arms, k),
    lights: blendNumbers(a.lights, to.lights, k),
    charges: blendNumbers(a.charges, to.charges, k),
    sounds,
    ticks: lerp(a.tick, to.tick, k),
    shake: lerp(shakeOf(a.tick), shakeOf(to.tick), k),
  };
};

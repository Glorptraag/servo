// What a Run shows at each tick, folded from its events, for the goal judge (goal.ts): every subject's readouts,
// sounds, faults and pose, and where each placed part is on the arena floor. Pure and framework-free: no DOM, React or
// clock, so the golden harness (packages/tools) runs it under plain Node. It reads only the run's blueprint, the part
// records and the arena preset (ground rule 1): no part's identity is written here.
import { TICK_RATE, cosSin, normalizeDegrees, placeParts } from '@servo/schema';
import type {
  ArenaPreset,
  Blueprint,
  Catalogue,
  Condition,
  EventSubject,
  FailureModeId,
  MotionPayload,
  PartPlacement,
  PartState,
  PartTarget,
  PlacedPartId,
  RunEvent,
  RunSound,
  ValuePayload,
  Vec2,
  Wall,
} from '@servo/schema';

/** Volts across a part's supply, either way round, from which it counts as `powered`. */
export const POWERED_VOLTS = 0.05;
/** Drive speed, either way, from which a part counts as `turning`. */
export const TURNING_RPM = 0.5;
/** A position actuator's arm moving at least this far in a tick counts as `turning` too. */
export const TURNING_DEGREES = 0.1;
/** Light given, 0–1, from which a part counts as `lit`. */
export const LIT_LEVEL = 0.01;
/** Pitch or roll, either way, from which the robot a part is on counts as `tipped`. A fallen robot reads ±90. */
export const TIPPED_DEGREES = 45;

interface Subject {
  values: ValuePayload;
  readonly sounds: Map<RunSound, number>;
  readonly faults: Set<FailureModeId>;
  motion?: MotionPayload;
}

/** A part's place on the floor: its frame origin (mm), its heading (degrees counter-clockwise) and its body's tilt. */
export interface FloorPose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly pitch: number;
  readonly roll: number;
}

const freshSubject = (): Subject => ({ values: {}, sounds: new Map(), faults: new Set() });

/** Degrees brought into [−180, 180). */
const signedDegrees = (degrees: number): number => normalizeDegrees(degrees + 180) - 180;

const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Distance from a point to a segment. */
const pointToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const segmentsCross = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/** Whether a point lies inside a convex polygon given counter-clockwise or clockwise, edges included. */
const insideConvex = (p: Vec2, corners: readonly Vec2[]): boolean => {
  let sign = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index] as Vec2;
    const b = corners[(index + 1) % corners.length] as Vec2;
    const side = cross(a, b, p);
    if (side === 0) continue;
    if (sign === 0) sign = Math.sign(side);
    else if (Math.sign(side) !== sign) return false;
  }
  return true;
};

/** The gap between a footprint (a convex polygon) and a wall's centre line, 0 where they meet. */
const footprintToSegment = (corners: readonly Vec2[], a: Vec2, b: Vec2): number => {
  if (insideConvex(a, corners) || insideConvex(b, corners)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corners.length; index += 1) {
    const p = corners[index] as Vec2;
    const q = corners[(index + 1) % corners.length] as Vec2;
    if (segmentsCross(p, q, a, b)) return 0;
    best = Math.min(best, pointToSegment(p, a, b), pointToSegment(a, p, q), pointToSegment(b, p, q));
  }
  return best;
};

/**
 * One Run's world, tick by tick. Feed it every tick's events in order from tick 0 (`advance`), then ask what holds at
 * that tick (`holds`). Positions follow sim-core's pose conventions (packages/sim-core/docs/mechanical.md): a body's
 * motion is its frame origin on the floor, and every part fixed to or carried by it rides with it as the schema's
 * `placeParts` places it.
 */
export class RunWorld {
  readonly blueprint: Blueprint;
  private readonly catalogue: Catalogue;
  private readonly arena: ArenaPreset | undefined;
  private readonly subjects = new Map<EventSubject, Subject>();
  private readonly placements: ReadonlyMap<PlacedPartId, PartPlacement>;
  private readonly types = new Map<PlacedPartId, string>();
  /** Each part's pose and arm angle as the tick before left them, for speeds, turn rates and a moving arm. */
  private before = new Map<PlacedPartId, { readonly pose?: FloorPose; readonly angle?: number }>();
  private tickNow = -1;

  constructor(blueprint: Blueprint, catalogue: Catalogue, arena: ArenaPreset | undefined) {
    this.blueprint = blueprint;
    this.catalogue = catalogue;
    this.arena = arena;
    this.placements = placeParts(blueprint, catalogue);
    for (const part of blueprint.parts) this.types.set(part.id, part.part);
  }

  /** The tick the world shows: −1 before the first `advance`. */
  get tick(): number {
    return this.tickNow;
  }

  /** Folds one tick's events into the world. Ticks come in order; tick 0's events give every starting state. */
  advance(tick: number, events: readonly RunEvent[]): void {
    const before = new Map<PlacedPartId, { readonly pose?: FloorPose; readonly angle?: number }>();
    if (this.tickNow >= 0) {
      for (const id of this.types.keys()) {
        const pose = this.poseOf(id);
        const angle = this.subjects.get(id)?.values.angle;
        before.set(id, { ...(pose ? { pose } : {}), ...(angle === undefined ? {} : { angle }) });
      }
    }
    this.before = before;
    this.tickNow = tick;
    for (const event of events) {
      let subject = this.subjects.get(event.partId);
      if (!subject) {
        subject = freshSubject();
        this.subjects.set(event.partId, subject);
      }
      if (event.kind === 'value') subject.values = { ...subject.values, ...event.payload };
      else if (event.kind === 'motion') subject.motion = event.payload;
      else if (event.kind === 'sound') {
        if (event.payload.level > 0) subject.sounds.set(event.payload.sound, event.payload.level);
        else subject.sounds.delete(event.payload.sound);
      } else if (event.payload.active) subject.faults.add(event.payload.failure);
      else subject.faults.delete(event.payload.failure);
    }
  }

  /** The placed parts a target names: one part of the run's build, or every part of a type, in id order. */
  partsOf(target: PartTarget): readonly PlacedPartId[] {
    if ('placed' in target) return this.types.has(target.placed) ? [target.placed] : [];
    return [...this.types].filter(([, type]) => type === target.part).map(([id]) => id).sort();
  }

  /** Whether a failure mode is active on a part now. */
  faultActive(partId: PlacedPartId, failure: FailureModeId): boolean {
    return this.subjects.get(partId)?.faults.has(failure) ?? false;
  }

  /** Every failure mode active now, by part. */
  activeFaults(): readonly { readonly partId: PlacedPartId; readonly failure: FailureModeId }[] {
    const found: { partId: PlacedPartId; failure: FailureModeId }[] = [];
    for (const id of this.types.keys()) for (const failure of this.subjects.get(id)?.faults ?? []) found.push({ partId: id, failure });
    return found;
  }

  /**
   * Where a part is on the floor now: its own motion when it is a body, otherwise its body's motion with the part
   * placed on it. Undefined when neither has moved into the arena yet.
   */
  poseOf(partId: PlacedPartId): FloorPose | undefined {
    const own = this.subjects.get(partId)?.motion;
    const placement = this.placements.get(partId);
    const body = own ? undefined : placement && this.subjects.get(placement.root)?.motion;
    const motion = own ?? body;
    if (!motion) return undefined;
    const tilt = { pitch: motion.pitch ?? 0, roll: motion.roll ?? 0 };
    if (own || !placement) return { x: motion.x, y: motion.y, heading: motion.heading, ...tilt };
    const at = placement.placement;
    const [c, s] = cosSin(motion.heading);
    return {
      x: motion.x + c * at.x - s * at.y,
      y: motion.y + s * at.x + c * at.y,
      heading: normalizeDegrees(motion.heading + at.yaw),
      ...tilt,
    };
  }

  /** Whether a condition holds at this tick. A condition on a type holds when it holds for any part of that type. */
  holds(condition: Condition): boolean {
    switch (condition.kind) {
      case 'and':
        return condition.of.every((inner) => this.holds(inner));
      case 'or':
        return condition.of.some((inner) => this.holds(inner));
      case 'not':
        return !this.holds(condition.of);
      case 'fault':
        return this.partsOf(condition.target).some((id) => this.faultActive(id, condition.failure));
      case 'state':
        return this.partsOf(condition.target).some((id) => this.inState(id, condition.state));
      case 'in-zone': {
        const zone = this.arena?.zones.find((candidate) => candidate.id === condition.zone);
        return (
          zone !== undefined &&
          this.partsOf(condition.target).some((id) => {
            const pose = this.poseOf(id);
            return pose !== undefined && pose.x >= zone.from.x && pose.x <= zone.to.x && pose.y >= zone.from.y && pose.y <= zone.to.y;
          })
        );
      }
      case 'near-wall': {
        const wall = this.arena?.walls.find((candidate) => candidate.id === condition.wall);
        return wall !== undefined && this.partsOf(condition.target).some((id) => (this.gapToWall(id, wall) ?? Number.POSITIVE_INFINITY) <= condition.withinMm);
      }
      case 'speed':
      case 'forward-speed':
      case 'turn-rate':
        return this.partsOf(condition.target).some((id) => {
          const motion = this.motionOf(id);
          if (!motion) return false;
          const value = condition.kind === 'speed' ? motion.speed : condition.kind === 'forward-speed' ? motion.forward : motion.turnRate;
          return (condition.atLeast === undefined || value >= condition.atLeast) && (condition.atMost === undefined || value <= condition.atMost);
        });
    }
  }

  /** A part's speed across the floor and along its heading (mm/s), and its turning rate (degrees a second), over the last tick. */
  motionOf(partId: PlacedPartId): { readonly speed: number; readonly forward: number; readonly turnRate: number } | undefined {
    const now = this.poseOf(partId);
    if (!now) return undefined;
    const then = this.before.get(partId)?.pose;
    if (!then) return { speed: 0, forward: 0, turnRate: 0 };
    const dx = now.x - then.x;
    const dy = now.y - then.y;
    const [c, s] = cosSin(now.heading);
    return {
      speed: Math.hypot(dx, dy) * TICK_RATE,
      forward: (dx * c + dy * s) * TICK_RATE,
      turnRate: Math.abs(signedDegrees(now.heading - then.heading)) * TICK_RATE,
    };
  }

  /** From the nearest point of a part's footprint (its body box seen from above) to the wall's face, in mm. */
  gapToWall(partId: PlacedPartId, wall: Wall): number | undefined {
    const pose = this.poseOf(partId);
    const type = this.types.get(partId);
    const record = type === undefined ? undefined : this.catalogue.parts.get(type);
    if (!pose || !record) return undefined;
    const [c, s] = cosSin(pose.heading);
    const hx = record.body.size.x / 2;
    const hy = record.body.size.y / 2;
    const corners = [
      { x: hx, y: hy },
      { x: -hx, y: hy },
      { x: -hx, y: -hy },
      { x: hx, y: -hy },
    ].map((corner) => ({ x: pose.x + c * corner.x - s * corner.y, y: pose.y + s * corner.x + c * corner.y }));
    return Math.max(0, footprintToSegment(corners, wall.from, wall.to) - wall.thicknessMm / 2);
  }

  /** A part's state now, as the schema's PART_STATES pairs name it. */
  inState(partId: PlacedPartId, state: PartState): boolean {
    const subject = this.subjects.get(partId);
    const values = subject?.values ?? {};
    switch (state) {
      case 'powered':
      case 'unpowered':
        return (Math.abs(values.volts ?? 0) >= POWERED_VOLTS) === (state === 'powered');
      case 'turning':
      case 'still': {
        const before = this.before.get(partId)?.angle;
        const swept = values.angle !== undefined && before !== undefined && Math.abs(values.angle - before) >= TURNING_DEGREES;
        return (Math.abs(values.rpm ?? 0) >= TURNING_RPM || swept) === (state === 'turning');
      }
      case 'lit':
      case 'dark':
        return ((values.light ?? 0) >= LIT_LEVEL) === (state === 'lit');
      case 'sounding':
      case 'silent':
        return (subject !== undefined && subject.sounds.size > 0) === (state === 'sounding');
      case 'closed':
        return values.closed === true;
      case 'open':
        return values.closed === false;
      case 'upright':
      case 'tipped': {
        const pose = this.poseOf(partId);
        if (!pose) return false;
        const tipped = Math.max(Math.abs(pose.pitch), Math.abs(pose.roll)) >= TIPPED_DEGREES;
        return tipped === (state === 'tipped');
      }
    }
  }
}

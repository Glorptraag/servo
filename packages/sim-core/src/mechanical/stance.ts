import type { Vec2 } from '@servo/schema';
import { floorAt } from './arena.ts';
import { clean, length, solve3 } from './maths.ts';
import type { FloorRamp, RobotModel } from './types.ts';

/**
 * Balance: how the robot stands on the floor, as a centre-of-mass check (brief Section 6, and the rule of review 2.6).
 * Its weight falls at its centre of mass, moved by the force the floor gives it: a fast start leans it back, a hard stop
 * forward, and a slope downhill. It stands on whatever of it meets the floor. Where its weight falls outside its wheels
 * and supports, it rocks about the edge the weight crossed until its frame meets the floor: it rests there and drags if
 * its weight is inside the new polygon at that angle, and has fallen over if not. Plain arithmetic in a fixed order; a
 * rock is worked from a slope with a square root, never from an angle.
 */

/** Standard gravity, m/s². */
export const GRAVITY = 9.81;

/** Points within this height of the floor meet it, mm. */
const LEVEL_MM = 0.5;

/** A polygon needs at least this much area to stand on, mm². */
const AREA_MM2 = 1;

/** At most this many rocks while what touches is only a line or a point, before a robot that still cannot stand falls over. */
const TILTS = 4;

/** A point on the robot that can meet the floor. */
export interface StancePoint {
  readonly kind: 'wheel' | 'support' | 'body';
  /** Its index among the robot's wheels, supports or body points. */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A point that meets the floor, and the weight it carries, N. */
export interface StanceContact {
  readonly point: StancePoint;
  readonly load: number;
}

/** How the robot stands this substep. */
export interface Stance {
  /** `upright` on wheels and supports only; `grounded` with part of its frame on the floor; `fallen` over. */
  readonly state: 'upright' | 'grounded' | 'fallen';
  readonly contacts: readonly StanceContact[];
  /** The floor's slope under the robot in its frame: rise per mm forward (x) and to its left (y). */
  readonly floor: Vec2;
  /** The robot's own tilt on top of the floor: rise per mm forward and to its left. */
  readonly tilt: Vec2;
  /** Gravity along the floor in the robot's frame, m/s², and into it. */
  readonly along: Vec2;
  readonly normal: number;
  /** Where its weight falls on the floor, in its frame. */
  readonly centre: Vec2;
  /** When fallen, which way: a unit vector in its frame. */
  readonly fall?: Vec2;
}

/** Where the robot stands in the arena: its root part's position, and its heading as cos and sin. */
export interface Placing {
  readonly x: number;
  readonly y: number;
  readonly cos: number;
  readonly sin: number;
}

/** Every point of the robot that can meet the floor: wheels first, then supports, then the corners of its parts. */
export const stancePoints = (robot: RobotModel): readonly StancePoint[] => [
  ...robot.wheels.map((wheel, index): StancePoint => ({ kind: 'wheel', index, ...wheel.contact })),
  ...robot.supports.map((support, index): StancePoint => ({ kind: 'support', index, ...support.contact })),
  ...robot.bodyPoints.map((point, index): StancePoint => ({ kind: 'body', index, x: point.x, y: point.y, z: point.z })),
];

const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The convex hull of points, counter-clockwise from the lowest x (then y), collinear points dropped (Andrew's monotone chain). */
export const hullOf = <T extends Vec2>(points: readonly T[]): readonly T[] => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter((point, index) => index === 0 || point.x !== sorted[index - 1]?.x || point.y !== sorted[index - 1]?.y);
  if (unique.length < 3) return unique;
  const chain = (list: readonly T[]): T[] => {
    const out: T[] = [];
    for (const point of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as T, out[out.length - 1] as T, point) <= 0) out.pop();
      out.push(point);
    }
    return out;
  };
  const lower = chain(unique);
  const upper = chain([...unique].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};

const areaOf = (hull: readonly Vec2[]): number => {
  let twice = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i] as Vec2;
    const b = hull[(i + 1) % hull.length] as Vec2;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
};

/** A polygon can be stood on: three corners or more, with some area. */
const standable = (hull: readonly Vec2[]): boolean => hull.length >= 3 && areaOf(hull) >= AREA_MM2;

/** The edge of a counter-clockwise hull that `p` lies farthest outside (or least inside), as a start point, unit direction and depth. */
const nearestEdge = (hull: readonly Vec2[], p: Vec2): { readonly from: Vec2; readonly along: Vec2; readonly depth: number } => {
  let best = { from: hull[0] as Vec2, along: { x: 1, y: 0 }, depth: Number.POSITIVE_INFINITY };
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i] as Vec2;
    const b = hull[(i + 1) % hull.length] as Vec2;
    const size = length(b.x - a.x, b.y - a.y);
    if (!(size > 0)) continue;
    const depth = cross(a, b, p) / size;
    if (depth < best.depth) best = { from: a, along: { x: (b.x - a.x) / size, y: (b.y - a.y) / size }, depth };
  }
  return best;
};

/** The point of a list farthest from its first point, and how far: the way a line of points runs. */
const farthest = <T extends Vec2>(list: readonly T[]): { readonly point: T; readonly size: number } | undefined => {
  const first = list[0];
  if (!first) return undefined;
  let best = { point: first, size: 0 };
  for (const point of list) {
    const size = length(point.x - first.x, point.y - first.y);
    if (size > best.size) best = { point, size };
  }
  return best;
};

/** Minimum-norm shares of `weight` among points (relative to the balance point) that lie on a line: balanced along it. */
const shareAlongLine = (live: readonly Vec2[], weight: number): number[] => {
  const n = live.length;
  const first = live[0];
  const far = farthest(live);
  if (!first || !far || !(far.size > 0)) return live.map(() => weight / n);
  const ux = (far.point.x - first.x) / far.size;
  const uy = (far.point.y - first.y) / far.size;
  const along = live.map((point) => point.x * ux + point.y * uy);
  let ss = 0;
  let sss = 0;
  for (const s of along) {
    ss += s;
    sss += s * s;
  }
  const det = n * sss - ss * ss;
  return det > 0 ? along.map((s) => (weight * (sss - ss * s)) / det) : live.map(() => weight / n);
};

/**
 * Shares a weight among points so that it balances about `centre`: the least-squares (minimum-norm) split, with any
 * point that would have to pull dropped and the rest solved again. The same points give the same shares.
 */
export const shareWeight = (points: readonly Vec2[], centre: Vec2, weight: number): readonly number[] => {
  const active = points.map(() => true);
  for (let round = 0; round <= points.length; round += 1) {
    const live = points.flatMap((point, index) => (active[index] ? [{ index, x: point.x - centre.x, y: point.y - centre.y }] : []));
    if (live.length === 0) break;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const point of live) {
      sx += point.x;
      sy += point.y;
      sxx += point.x * point.x;
      sxy += point.x * point.y;
      syy += point.y * point.y;
    }
    // Minimum norm: each share is a + b x + c y, with a, b and c making the shares add up to the weight and balance it.
    const full = solve3([live.length, sx, sy, sx, sxx, sxy, sy, sxy, syy], [weight, 0, 0]);
    const shares = full ? live.map((point) => full[0] + full[1] * point.x + full[2] * point.y) : shareAlongLine(live, weight);
    let worst = -1;
    let worstShare = 0;
    shares.forEach((share, at) => {
      if (share < worstShare) {
        worstShare = share;
        worst = live[at]?.index ?? -1;
      }
    });
    if (worst < 0) {
      const out = points.map(() => 0);
      live.forEach((point, at) => {
        out[point.index] = clean(shares[at] ?? 0);
      });
      return out;
    }
    active[worst] = false;
  }
  return points.map(() => weight / Math.max(1, points.length));
};

/** The floor's slope under the robot, fitted as a plane through the floor heights under `under`, in the robot's frame; under its centre of mass when they do not span a plane. */
const floorSlope = (under: readonly Vec2[], at: Placing, ramps: readonly FloorRamp[], centre: Vec2): Vec2 => {
  if (ramps.length === 0) return { x: 0, y: 0 };
  const arena = (p: Vec2): Vec2 => ({ x: at.x + at.cos * p.x - at.sin * p.y, y: at.y + at.sin * p.x + at.cos * p.y });
  if (under.length >= 3) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let sh = 0;
    let shx = 0;
    let shy = 0;
    for (const point of under) {
      const where = arena(point);
      const h = floorAt(ramps, where.x, where.y).height;
      n += 1;
      sx += point.x;
      sy += point.y;
      sxx += point.x * point.x;
      sxy += point.x * point.y;
      syy += point.y * point.y;
      sh += h;
      shx += h * point.x;
      shy += h * point.y;
    }
    const plane = solve3([n, sx, sy, sx, sxx, sxy, sy, sxy, syy], [sh, shx, shy]);
    if (plane) return { x: clean(plane[1]), y: clean(plane[2]) };
  }
  const where = arena(centre);
  const gradient = floorAt(ramps, where.x, where.y).gradient;
  // The arena's gradient turned into the robot's frame: along its forward (cos, sin) and its left (−sin, cos).
  return { x: clean(gradient.x * at.cos + gradient.y * at.sin), y: clean(-gradient.x * at.sin + gradient.y * at.cos) };
};

/** How the floor under the robot slopes and what it must carry: what every stance of one substep shares. */
export interface Loading {
  readonly floor: Vec2;
  readonly along: Vec2;
  readonly normal: number;
  /** The robot's weight into the floor, N. */
  readonly weight: number;
  /** The force the floor gave the robot in the last substep, its frame, N. */
  readonly push: Vec2;
}

/** The floor's slope under the robot (from the points it stands on level), gravity along and into it, and its weight. */
export const loadingOf = (robot: RobotModel, points: readonly StancePoint[], at: Placing, ramps: readonly FloorRamp[], floorForce: Vec2): Loading => {
  const level = points.filter((point) => point.z <= robot.bottom + LEVEL_MM);
  const floor = floorSlope(level, at, ramps, robot.centreOfMass);
  const lift = Math.sqrt(1 + floor.x * floor.x + floor.y * floor.y);
  const normal = GRAVITY / lift;
  return {
    floor,
    along: { x: clean((-GRAVITY * floor.x) / lift), y: clean((-GRAVITY * floor.y) / lift) },
    normal,
    weight: robot.kilograms * normal,
    push: floorForce,
  };
};

/** A point of the robot as it rests now: where it lies over the floor, in the robot's frame, and how high above it. */
interface Resting {
  readonly x: number;
  readonly y: number;
  readonly h: number;
}

/**
 * How the robot stands on `points` (the rule of review 2.6). It starts level on the lowest of them. Its weight falls
 * at its centre of mass, moved by the floor's push: with the centre of mass h above the floor, a push F moves it
 * h × F ÷ weight the other way, so a fast start leans it back, a hard stop forward, and a robot held still on a slope
 * has its weight fall downhill. While what touches cannot be stood on (a line of wheels, a point), the robot rocks
 * towards its weight until more of it meets the floor. Once it stands on a polygon:
 * - its weight inside, edges included: it stands, `upright` on wheels and supports only, else `grounded` (frame down);
 * - its weight outside: it rocks once about the edge the weight crossed until another point meets the floor. At that
 *   angle it stands if its weight is inside the new polygon, and has `fallen` over if it is not.
 * Each rock is an exact rotation about its axis, worked from the slope that brings the next point down with a square
 * root and no angle, so a tall robot's centre of mass swings out as it rocks.
 */
export const stanceOf = (robot: RobotModel, points: readonly StancePoint[], loading: Loading): Stance => {
  const { floor, along, normal, weight, push } = loading;
  const com = robot.centreOfMass;
  const resting = new Map<StancePoint, Resting>(points.map((point) => [point, { x: point.x, y: point.y, h: point.z - robot.bottom }]));
  const restingOf = (point: StancePoint): Resting => resting.get(point) as Resting;
  let mass: Resting = { x: com.x, y: com.y, h: com.z - robot.bottom };
  const centreNow = (): Vec2 => ({ x: clean(mass.x - (mass.h * push.x) / weight), y: clean(mass.y - (mass.h * push.y) / weight) });
  let centre = centreNow();
  let touching = points.filter((point) => restingOf(point).h <= LEVEL_MM);
  let tilt: Vec2 = { x: 0, y: 0 };
  let rocked = false;
  const fallen = (fall: Vec2): Stance => ({ state: 'fallen', contacts: [], floor, tilt, along, normal, centre, fall });
  for (let round = 0; round <= TILTS; round += 1) {
    const ground = touching.map((point) => ({ point, x: restingOf(point).x, y: restingOf(point).y }));
    const first = ground[0];
    if (!first) return fallen({ x: 1, y: 0 });
    const hull = hullOf(ground);
    // The axis it rocks about, through `from`, and `side`, the unit normal towards its weight.
    let from: Vec2 = first;
    let side: Vec2;
    if (standable(hull)) {
      const edge = nearestEdge(hull, centre);
      if (edge.depth >= 0) {
        const shares = shareWeight(ground, centre, weight);
        const state = touching.some((point) => point.kind === 'body') ? 'grounded' : 'upright';
        return { state, contacts: touching.map((point, index) => ({ point, load: shares[index] ?? 0 })), floor, tilt, along, normal, centre };
      }
      if (rocked) return fallen({ x: edge.along.y, y: -edge.along.x });
      from = edge.from;
      side = { x: edge.along.y, y: -edge.along.x };
    } else {
      const far = farthest(ground);
      if (far && far.size > 0) {
        const ux = (far.point.x - first.x) / far.size;
        const uy = (far.point.y - first.y) / far.size;
        const offset = (centre.x - first.x) * -uy + (centre.y - first.y) * ux;
        // Weight exactly on the line: it rocks the way its centre of mass lies, or to the left of the line when that is on it too.
        const toward = offset !== 0 ? offset : (mass.x - first.x) * -uy + (mass.y - first.y) * ux;
        side = toward >= 0 ? { x: -uy, y: ux } : { x: uy, y: -ux };
      } else {
        const dx = centre.x - first.x;
        const dy = centre.y - first.y;
        const size = length(dx, dy);
        side = size > 0 ? { x: dx / size, y: dy / size } : { x: 1, y: 0 };
      }
    }
    if (round === TILTS) return fallen(side);
    const reach = (where: Vec2): number => (where.x - from.x) * side.x + (where.y - from.y) * side.y;
    let least = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const where = restingOf(point);
      const distance = reach(where);
      if (!(distance > LEVEL_MM)) continue;
      const slope = where.h / distance;
      if (slope < least) least = slope;
    }
    if (!Number.isFinite(least) || least < 0) return fallen(side);
    // Rock by the angle whose tangent is `least`: a point d out from the axis and h up goes to d cos + h sin out and h cos − d sin up.
    const cos = 1 / Math.sqrt(1 + least * least);
    const sin = least * cos;
    const rock = (where: Resting): Resting => {
      const d = reach(where);
      const out = d * cos + where.h * sin;
      return { x: where.x + (out - d) * side.x, y: where.y + (out - d) * side.y, h: where.h * cos - d * sin };
    };
    for (const point of points) resting.set(point, rock(restingOf(point)));
    mass = rock(mass);
    centre = centreNow();
    tilt = { x: clean(tilt.x - least * side.x), y: clean(tilt.y - least * side.y) };
    rocked = true;
    touching = points.filter((point) => restingOf(point).h <= LEVEL_MM && reach(restingOf(point)) > -LEVEL_MM);
  }
  return fallen({ x: 1, y: 0 });
};

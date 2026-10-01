// The free-spot rule (brief Section 10): a loose part lands where it is dropped when that spot is free, and otherwise
// slides to the nearest free spot. A spot is free when the outlines that move keep a clearance from every obstacle.
// Pure and deterministic, so every path that asks the same question lands on the same spot. See docs/placement.md.
import type { Vec2 } from '@servo/schema';
import { PORT_MM } from '../scene/units.ts';

/** A convex outline on the plane: its corners in order round it. */
export type Outline = readonly Vec2[];

/**
 * The clearance a loose part keeps from every other part's tile: a socket's reach (half a 44 px socket), so a socket
 * on one part's outline never covers its neighbour.
 */
export const FREE_GAP_MM = PORT_MM / 2;
/** Spots are tried on a lattice this fine round the drop, nearest first. */
export const SPOT_STEP_MM = 5;
/** How many lattice steps out the search goes (a metre) before it gives up. */
const MAX_RINGS = 200;

/**
 * Places are kept to a tenth of a millimetre: a quarter of a pixel at the default zoom, so a part lands where it
 * looks, the same drop gives the same bytes on every path, and saved builds stay tidy.
 */
export const roundMm = (value: number): number => Math.round(value * 10) / 10 + 0;
export const roundPoint = (point: Vec2): Vec2 => ({ x: roundMm(point.x), y: roundMm(point.y) });

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const boundsOf = (outline: Outline): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of outline) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
};

/** The widest gap between two outlines along the canvas axes and their edge normals: negative when they overlap. */
export const separation = (a: Outline, b: Outline): number => {
  const ab = boundsOf(a);
  const bb = boundsOf(b);
  let best = Math.max(bb.minX - ab.maxX, ab.minX - bb.maxX, bb.minY - ab.maxY, ab.minY - bb.maxY);
  for (const outline of [a, b]) {
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i] as Vec2;
      const q = outline[(i + 1) % outline.length] as Vec2;
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const length = Math.sqrt(nx * nx + ny * ny);
      if (length === 0) continue;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const d = (v.x * nx + v.y * ny) / length;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = (v.x * nx + v.y * ny) / length;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      best = Math.max(best, minB - maxA, minA - maxB);
    }
  }
  return best;
};

/**
 * The lattice points `ring` to `ring + 1` steps from the centre, nearest first, ties by y and then x. Ring after ring,
 * they visit every point in order of distance.
 */
const band = (ring: number): (readonly [number, number])[] => {
  const low = ring * ring;
  const high = (ring + 1) * (ring + 1);
  const points: (readonly [number, number])[] = [];
  for (let i = -ring - 1; i <= ring + 1; i++) {
    const below = high - i * i;
    if (below <= 0) continue;
    let top = Math.floor(Math.sqrt(below - 1));
    while ((top + 1) * (top + 1) < below) top++;
    while (top * top >= below) top--;
    const atLeast = low - i * i;
    let bottom = atLeast <= 0 ? 0 : Math.ceil(Math.sqrt(atLeast));
    while (bottom > 0 && (bottom - 1) * (bottom - 1) >= atLeast) bottom--;
    while (bottom * bottom < atLeast) bottom++;
    for (let j = bottom; j <= top; j++) {
      points.push([i, j]);
      if (j !== 0) points.push([i, -j]);
    }
  }
  return points.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]) || p[1] - q[1] || p[0] - q[0]);
};

export interface SpotQuery {
  /** Where the anchor would go (a drop), already rounded. */
  readonly from: Vec2;
  /** The outlines that move with the anchor, as they lie with the anchor at the origin. */
  readonly shape: readonly Outline[];
  readonly obstacles: readonly Outline[];
  /** A further rule a spot must meet, such as a prop staying on the floor. */
  readonly allows?: (at: Vec2) => boolean;
}

const shifted = (outline: Outline, at: Vec2): Outline => outline.map((point) => ({ x: point.x + at.x, y: point.y + at.y }));

/** Whether the shape, with its anchor at `at`, keeps its clearance from every obstacle (and meets `allows`). */
export const isFree = (query: SpotQuery, at: Vec2): boolean => {
  if (query.allows && !query.allows(at)) return false;
  for (const piece of query.shape) {
    const moved = shifted(piece, at);
    for (const obstacle of query.obstacles) if (separation(moved, obstacle) < FREE_GAP_MM) return false;
  }
  return true;
};

/**
 * The nearest free spot to `from`: `from` itself when it is free, otherwise the nearest point of a 5 mm lattice round
 * it. With nothing free within a metre, a part goes just beyond everything on its right; a spot that must also meet
 * `allows` (a prop on the floor) is then undefined.
 */
export const freeSpot = (query: SpotQuery): Vec2 | undefined => {
  for (let ring = 0; ring <= MAX_RINGS; ring++) {
    for (const [i, j] of band(ring)) {
      const at = roundPoint({ x: query.from.x + i * SPOT_STEP_MM, y: query.from.y + j * SPOT_STEP_MM });
      if (isFree(query, at)) return at;
    }
  }
  if (query.allows) return undefined;
  const right = Math.max(...query.obstacles.map((outline) => boundsOf(outline).maxX));
  const reach = Math.min(...query.shape.map((outline) => boundsOf(outline).minX));
  const x = Math.ceil(right + FREE_GAP_MM - reach + 1);
  return Number.isFinite(x) ? roundPoint({ x, y: query.from.y }) : query.from;
};

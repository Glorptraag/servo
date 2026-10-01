// Plane geometry for the scene: canvas millimetres, x to the right, y down, rotations clockwise
// (packages/schema/docs/geometry.md). Turns use the schema's deterministic `cosSin`, so a port lands exactly where
// `canvasPoseOf` puts the part fixed to it.
import { cosSin } from '@servo/schema';
import type { Vec2 } from '@servo/schema';

/** Where a part is drawn: its frame origin (mm), its rotation (degrees clockwise) and whether it is its mirror image. */
export interface PartPose {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly mirrored: boolean;
}

export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * A point in a part's frame (x forward, y left) on the canvas. The part's left is the canvas's up at rotation 0,
 * and a mirror image flips it (geometry.md: flipped across its own x axis).
 */
export const partToCanvas = (pose: PartPose, point: Vec2): Vec2 => {
  const [c, s] = cosSin(pose.rotation);
  const lx = point.x;
  const ly = pose.mirrored ? point.y : -point.y;
  return { x: pose.x + c * lx - s * ly, y: pose.y + s * lx + c * ly };
};

/** A direction in a part's frame, on the canvas (no translation). */
export const turnToCanvas = (pose: PartPose, direction: Vec2): Vec2 => {
  const [c, s] = cosSin(pose.rotation);
  const lx = direction.x;
  const ly = pose.mirrored ? direction.y : -direction.y;
  return { x: c * lx - s * ly, y: s * lx + c * ly };
};

/** A canvas point in a part's frame: the inverse of `partToCanvas`. */
export const canvasToPart = (pose: PartPose, point: Vec2): Vec2 => {
  const [c, s] = cosSin(pose.rotation);
  const dx = point.x - pose.x;
  const dy = point.y - pose.y;
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  return { x: lx, y: pose.mirrored ? ly : -ly };
};

export const rectOfPoints = (points: readonly Vec2[], pad = 0): Rect | undefined => {
  if (points.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
};

export const unionRect = (a: Rect | undefined, b: Rect | undefined): Rect | undefined => {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
};

export const rectCentre = (rect: Rect): Vec2 => ({ x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 });
export const rectWidth = (rect: Rect): number => rect.maxX - rect.minX;
export const rectHeight = (rect: Rect): number => rect.maxY - rect.minY;

export const distance = (a: Vec2, b: Vec2): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** The distance from `point` to the segment from `a` to `b`. */
export const distanceToSegment = (point: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
};

/** Ids in the schema's text order, so the scene never depends on insertion order. */
export const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

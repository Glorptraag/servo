// Convex shapes on the canvas plane for the wire router: a part's tile, its body as drawn, a body grown by a
// clearance, and the square kept clear round a socket. Touching a shape is allowed; only entering its inside counts.
// Pure maths with the scene's geometry, no Pixi. See docs/routing.md.
import type { Vec2 } from '@servo/schema';
import { partToCanvas } from '../scene/geometry.ts';
import type { Rect } from '../scene/geometry.ts';
import type { ScenePart } from '../scene/scene.ts';

/** Millimetres. A wire may run this close along an edge or round a corner and still count as touching, not crossing. */
export const EPS = 1e-7;

/** A convex polygon, corners in order (either way round), with its bounding box for a quick first test. */
export interface Shape {
  readonly corners: readonly Vec2[];
  readonly box: Rect;
}

export const shapeOf = (corners: readonly Vec2[]): Shape => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of corners) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { corners, box: { minX, minY, maxX, maxY } };
};

/** A part's tile grown by `grow` mm on every side, in its own frame, so it turns with the part. */
export const tileShape = (part: ScenePart, grow = 0): Shape => {
  const w = part.tile.w / 2 + grow;
  const h = part.tile.h / 2 + grow;
  return shapeOf(
    [
      { x: -w, y: h },
      { x: w, y: h },
      { x: w, y: -h },
      { x: -w, y: -h },
    ].map((corner) => partToCanvas(part.pose, corner)),
  );
};

/**
 * A part's body as drawn: its footprint (`body.size` x by y, centred on its frame origin) at its true size, inside
 * its tile, grown by `grow` mm on every side and turned with the part. The rest of the tile, up to the 96 px minimum
 * and round the sockets, is touch padding a wire may pass over.
 */
export const bodyShape = (part: ScenePart, grow = 0): Shape => {
  const w = Math.min(part.record.body.size.x, part.tile.w) / 2 + grow;
  const h = Math.min(part.record.body.size.y, part.tile.h) / 2 + grow;
  return shapeOf(
    [
      { x: -w, y: h },
      { x: w, y: h },
      { x: w, y: -h },
      { x: -w, y: -h },
    ].map((corner) => partToCanvas(part.pose, corner)),
  );
};

/** An upright square of half-side `half` round `centre`. */
export const squareShape = (centre: Vec2, half: number): Shape =>
  shapeOf([
    { x: centre.x - half, y: centre.y - half },
    { x: centre.x + half, y: centre.y - half },
    { x: centre.x + half, y: centre.y + half },
    { x: centre.x - half, y: centre.y + half },
  ]);

const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Strictly inside: on the outline counts as outside. */
export const containsPoint = (shape: Shape, point: Vec2): boolean => {
  const { box, corners } = shape;
  if (point.x <= box.minX + EPS || point.x >= box.maxX - EPS || point.y <= box.minY + EPS || point.y >= box.maxY - EPS) return false;
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as Vec2;
    const b = corners[(i + 1) % corners.length] as Vec2;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const side = cross(a, b, point) / length;
    if (Math.abs(side) <= EPS) return false;
    const s = side > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
};

/** The projection of the corners onto an axis. */
const span = (corners: readonly Vec2[], ax: number, ay: number): [number, number] => {
  let low = Infinity;
  let high = -Infinity;
  for (const { x, y } of corners) {
    const t = x * ax + y * ay;
    if (t < low) low = t;
    if (t > high) high = t;
  }
  return [low, high];
};

/** Whether the axis (unit) keeps the segment and the shape's inside apart. */
const separates = (a: Vec2, b: Vec2, corners: readonly Vec2[], ax: number, ay: number): boolean => {
  const [low, high] = span(corners, ax, ay);
  const sa = a.x * ax + a.y * ay;
  const sb = b.x * ax + b.y * ay;
  return Math.max(sa, sb) <= low + EPS || Math.min(sa, sb) >= high - EPS;
};

/**
 * Whether the segment from `a` to `b` enters the inside of the shape. Running along its outline or touching a
 * corner does not. Separating axes: the shape's edge normals and the segment's own normal.
 */
export const segmentEnters = (a: Vec2, b: Vec2, shape: Shape): boolean => {
  const { box, corners } = shape;
  if (Math.max(a.x, b.x) <= box.minX + EPS || Math.min(a.x, b.x) >= box.maxX - EPS) return false;
  if (Math.max(a.y, b.y) <= box.minY + EPS || Math.min(a.y, b.y) >= box.maxY - EPS) return false;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i] as Vec2;
    const q = corners[(i + 1) % corners.length] as Vec2;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length === 0) continue;
    if (separates(a, b, corners, -(q.y - p.y) / length, (q.x - p.x) / length)) return false;
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length > 0 && separates(a, b, corners, -(b.y - a.y) / length, (b.x - a.x) / length)) return false;
  return true;
};

/**
 * Where the ray from `origin` along the unit `direction` is inside the shape: [enter, leave] in mm along it, enter
 * below 0 when the origin is inside. Undefined when the ray only touches it or misses it.
 */
export const rayInside = (shape: Shape, origin: Vec2, direction: Vec2): readonly [number, number] | undefined => {
  const { corners } = shape;
  let cx = 0;
  let cy = 0;
  for (const corner of corners) {
    cx += corner.x / corners.length;
    cy += corner.y / corners.length;
  }
  let enter = -Infinity;
  let leave = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i] as Vec2;
    const q = corners[(i + 1) % corners.length] as Vec2;
    let mx = -(q.y - p.y);
    let my = q.x - p.x;
    // Outward: away from the middle.
    if (mx * (cx - p.x) + my * (cy - p.y) > 0) {
      mx = -mx;
      my = -my;
    }
    const along = mx * direction.x + my * direction.y;
    const offset = mx * (origin.x - p.x) + my * (origin.y - p.y);
    if (along === 0) {
      if (offset >= 0) return undefined;
      continue;
    }
    const t = -offset / along;
    if (along > 0) leave = Math.min(leave, t);
    else enter = Math.max(enter, t);
  }
  return leave - enter > EPS && leave > EPS ? [enter, leave] : undefined;
};

/** Whether any segment of a path enters the shape's inside. */
export const pathEnters = (points: readonly Vec2[], shape: Shape): boolean => {
  for (let i = 1; i < points.length; i++) if (segmentEnters(points[i - 1] as Vec2, points[i] as Vec2, shape)) return true;
  return false;
};

// Zoom limits that keep the build on screen (task 3.7, brief Section 10: "zoom limits stop the build from getting
// lost"), measured in the part of the canvas the child can see: the host less the safe area the app's panels and the
// device's insets cover (D66, D70). Plain maths, no Pixi. See docs/routing.md.
import type { Vec2 } from '@servo/schema';
import type { CanvasSafeArea } from '../interface.ts';

/** Nothing covered. */
export const NO_SAFE_AREA: CanvasSafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * However much the app says is covered, at least this share of the canvas's width and of its height stays
 * uncovered. Panels cover at most 30% of the canvas (D66); this only guards against a wrong measurement.
 */
export const MIN_UNCOVERED_SHARE = 0.5;

/**
 * Screen pixels of the build always on screen: a 96 px square piece of one part's drawn tile (or of the arena in Run
 * mode), turned with it, or all of it across a side shorter than that.
 */
export const KEEP_ON_SCREEN_PX = 96;

/** A rectangle of screen pixels from the canvas element's top left. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Each inset a finite number from 0; anything else is refused. */
export const checkSafeArea = (area: CanvasSafeArea): CanvasSafeArea => {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  for (const side of sides) {
    const value: unknown = (area as unknown as Record<string, unknown>)[side];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`A safe area's ${side} is a finite number of pixels from 0, not ${String(value)}.`);
    }
  }
  return { top: area.top, right: area.right, bottom: area.bottom, left: area.left };
};

/** Two insets on one axis, shrunk together until at least `MIN_UNCOVERED_SHARE` of `size` is left between them. */
const squeeze = (before: number, after: number, size: number): [number, number] => {
  const most = size * (1 - MIN_UNCOVERED_SHARE);
  const total = before + after;
  if (total <= most || total === 0) return [before, after];
  return [(before * most) / total, (after * most) / total];
};

/** The part of a `width` × `height` canvas the child can see. */
export const uncovered = (width: number, height: number, area: CanvasSafeArea): ScreenRect => {
  const [left, right] = squeeze(area.left, area.right, width);
  const [top, bottom] = squeeze(area.top, area.bottom, height);
  return { x: left, y: top, width: Math.max(1, width - left - right), height: Math.max(1, height - top - bottom) };
};

export const screenCentre = (rect: ScreenRect): Vec2 => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/** A convex polygon on the plane, corners in order. A target is a part's drawn tile, turned with it, or the arena. */
export type Polygon = readonly Vec2[];

const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The convex hull of some points, counter-clockwise from the lowest-leftmost (Andrew's monotone chain). */
const hull = (points: readonly Vec2[]): Vec2[] => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Vec2, lower[lower.length - 1] as Vec2, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Vec2, upper[upper.length - 1] as Vec2, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};

/**
 * The piece of a target that must stay in view: a rectangle `KEEP_ON_SCREEN_PX` on a side (as much of the target's
 * own side as it has, when that is less), turned with the target, anywhere inside it. Returns the centres such a
 * piece can have (the target shrunk by half the piece) and the piece's half extents along the screen's axes.
 */
const keepPiece = (target: Polygon, keep: number): { centres: Vec2[]; halfX: number; halfY: number } => {
  const [a, b, c] = target as [Vec2, Vec2, Vec2];
  const sideA = Math.hypot(b.x - a.x, b.y - a.y);
  const sideB = Math.hypot(c.x - b.x, c.y - b.y);
  const ua = sideA > 0 ? { x: (b.x - a.x) / sideA, y: (b.y - a.y) / sideA } : { x: 1, y: 0 };
  const ub = sideB > 0 ? { x: (c.x - b.x) / sideB, y: (c.y - b.y) / sideB } : { x: 0, y: 1 };
  const pieceA = Math.min(keep, sideA);
  const pieceB = Math.min(keep, sideB);
  const centre = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  const reachA = (sideA - pieceA) / 2;
  const reachB = (sideB - pieceB) / 2;
  const centres = [
    { x: centre.x - ua.x * reachA - ub.x * reachB, y: centre.y - ua.y * reachA - ub.y * reachB },
    { x: centre.x + ua.x * reachA - ub.x * reachB, y: centre.y + ua.y * reachA - ub.y * reachB },
    { x: centre.x + ua.x * reachA + ub.x * reachB, y: centre.y + ua.y * reachA + ub.y * reachB },
    { x: centre.x - ua.x * reachA + ub.x * reachB, y: centre.y - ua.y * reachA + ub.y * reachB },
  ];
  return {
    centres,
    halfX: (Math.abs(ua.x) * pieceA + Math.abs(ub.x) * pieceB) / 2,
    halfY: (Math.abs(ua.y) * pieceA + Math.abs(ub.y) * pieceB) / 2,
  };
};

/**
 * Where the plane point at the centre of the uncovered view (the focus) may be, at `scale` screen pixels per mm, so
 * that a `KEEP_ON_SCREEN_PX` square piece of one target's drawn shape (all of it across a side shorter than that),
 * turned with the target, is wholly on screen and uncovered. One convex polygon per target; the focus may be in any.
 */
export const focusArea = (targets: readonly Polygon[], view: ScreenRect, scale: number): Polygon[] => {
  const halfW = view.width / 2 / scale;
  const halfH = view.height / 2 / scale;
  const keep = KEEP_ON_SCREEN_PX / scale;
  return targets.map((target) => {
    const piece = keepPiece(target, keep);
    // A piece wider than the view (only in a view far smaller than any tablet's) is kept as centred as it can be.
    const slackX = Math.max(0, halfW - piece.halfX);
    const slackY = Math.max(0, halfH - piece.halfY);
    return hull(piece.centres.flatMap((c) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: c.x + sx * slackX, y: c.y + sy * slackY })))));
  });
};

/** The nearest point of a convex polygon to `point`: the point itself when inside. */
const nearestOn = (polygon: Polygon, point: Vec2): Vec2 => {
  if (polygon.length === 1) return polygon[0] as Vec2;
  let inside = polygon.length >= 3;
  let best = point;
  let gap = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[(i + 1) % polygon.length] as Vec2;
    if (cross(a, b, point) < 0) inside = false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const at = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(point.x - at.x, point.y - at.y);
    if (d < gap) {
      gap = d;
      best = at;
    }
  }
  return inside ? point : best;
};

/** The nearest point of the area to `point`, and how far it is; the first polygon wins a tie. */
const nearest = (area: readonly Polygon[], point: Vec2): { readonly at: Vec2; readonly gap: number } => {
  let best = { at: point, gap: Infinity };
  for (const polygon of area) {
    const at = nearestOn(polygon, point);
    const gap = Math.hypot(point.x - at.x, point.y - at.y);
    if (gap < best.gap) best = { at, gap };
  }
  return best;
};

/**
 * Holds the focus in `area` (the area at the new zoom) without jumping. A view that was within the limits
 * (`previous` in `previousArea`, the area at the zoom before) stays within them, sliding along their edge. A view
 * that was already outside them may move back towards the area, or keep its distance, but never move further out.
 */
export const holdFocus = (next: Vec2, previous: Vec2, area: readonly Polygon[], previousArea: readonly Polygon[] = area): Vec2 => {
  const wanted = nearest(area, next);
  if (wanted.gap <= 1e-9) return next;
  if (nearest(previousArea, previous).gap <= 1e-9) return wanted.at;
  const before = nearest(area, previous).gap;
  if (wanted.gap <= before) return next;
  const k = before / wanted.gap;
  return { x: wanted.at.x + (next.x - wanted.at.x) * k, y: wanted.at.y + (next.y - wanted.at.y) * k };
};

/** The nearest point of the area to the focus: where a resize or a new safe area brings a view that left the limits. */
export const backInside = (focus: Vec2, area: readonly Polygon[]): Vec2 => nearest(area, focus).at;

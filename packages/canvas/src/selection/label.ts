// Where the label of a selected wire sits (brief Section 9: "selecting a wire shows what flows on it"). On the wire
// itself, as a pill over the line, so it can only be read as that line's: at the middle of the path the canvas draws
// for it (straight today, a tidied route once task 3.7 gives one), slid along the line when the middle would cover a
// socket or the bin, and preferring a place clear of every other line. Pure: canvas millimetres in, a place out.
import type { Vec2 } from '@servo/schema';
import type { Circle } from '../placement/overlays.ts';

export interface LabelSize {
  readonly w: number;
  readonly h: number;
}

/** Fractions of the way along the path, tried in turn: the middle first, then out towards both ends. */
export const LABEL_STOPS: readonly number[] = [0.5, ...[0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35].flatMap((d) => [0.5 - d, 0.5 + d])];

/** The point `t` of the way along a polyline, by length. */
export const pointAlong = (path: readonly Vec2[], t: number): Vec2 => {
  const lengths = path.slice(1).map((point, i) => Math.hypot(point.x - (path[i] as Vec2).x, point.y - (path[i] as Vec2).y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let left = total * t;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] as number;
    const a = path[i] as Vec2;
    const b = path[i + 1] as Vec2;
    if (left <= length || i === lengths.length - 1) {
      const k = length === 0 ? 0 : Math.min(1, left / length);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    left -= length;
  }
  return path[0] ?? { x: 0, y: 0 };
};

/** Whether a box (its centre and size) and a circle overlap. */
const boxMeets = (centre: Vec2, size: LabelSize, circle: Circle): boolean => {
  const dx = circle.x - Math.min(Math.max(circle.x, centre.x - size.w / 2), centre.x + size.w / 2);
  const dy = circle.y - Math.min(Math.max(circle.y, centre.y - size.h / 2), centre.y + size.h / 2);
  return dx * dx + dy * dy < circle.r * circle.r;
};

/** Whether a line segment passes through a box (its centre and size) grown by `reach` on every side (Liang–Barsky). */
const boxNearLine = (centre: Vec2, size: LabelSize, a: Vec2, b: Vec2, reach: number): boolean => {
  const minX = centre.x - size.w / 2 - reach;
  const maxX = centre.x + size.w / 2 + reach;
  const minY = centre.y - size.h / 2 - reach;
  const maxY = centre.y + size.h / 2 + reach;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let from = 0;
  let to = 1;
  for (const [p, q] of [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) from = Math.max(from, r);
    else to = Math.min(to, r);
    if (from > to) return false;
  }
  return true;
};

export interface LabelQuery {
  /** The selected wire's path as drawn, from end to end. */
  readonly path: readonly Vec2[];
  readonly size: LabelSize;
  /** Sockets and the bin: the label never covers one where the line leaves room. */
  readonly avoid: readonly Circle[];
  /** Every other line's path, with the reach of its hit area: the label keeps off them where it can. */
  readonly others: readonly (readonly Vec2[])[];
  readonly reach: number;
}

/** How many rows out from the middle of a short line the label may go, beside it, when the line has no room on it. */
export const BESIDE_STEPS = 3;

/**
 * The label's centre. On the selected wire's path: the first stop clear of every socket, the bin and every other line
 * wins; failing that, the first clear of the sockets and the bin; failing that, on a line at least as long as the pill,
 * its middle. A line shorter than the pill (a wheel's drive linkage on its motor's shaft) has it just beside its middle
 * instead, a row at a time on either side, up to BESIDE_STEPS rows out, or failing that its middle.
 */
export const placeLabel = (query: LabelQuery): Vec2 => {
  const stops = LABEL_STOPS.map((t) => pointAlong(query.path, t));
  const clear = (at: Vec2): boolean => query.avoid.every((circle) => !boxMeets(at, query.size, circle));
  const apart = (at: Vec2): boolean =>
    query.others.every((path) => path.slice(1).every((b, i) => !boxNearLine(at, query.size, path[i] as Vec2, b, query.reach)));
  const onLine = stops.find((at) => clear(at) && apart(at)) ?? stops.find(clear);
  if (onLine) return onLine;
  const middle = stops[0] as Vec2;
  // A line long enough to hold the pill keeps it, at its middle, even over a socket: the label rides its own line.
  const length = query.path.slice(1).reduce((sum, b, i) => sum + Math.hypot(b.x - (query.path[i] as Vec2).x, b.y - (query.path[i] as Vec2).y), 0);
  if (length >= query.size.w) return middle;
  const first = query.path[0] ?? middle;
  const last = query.path[query.path.length - 1] ?? middle;
  const span = Math.hypot(last.x - first.x, last.y - first.y);
  // Across the line: its normal, or straight up and down for a line with no length.
  const across = span === 0 ? { x: 0, y: 1 } : { x: -(last.y - first.y) / span, y: (last.x - first.x) / span };
  const extent = Math.abs(across.x) * (query.size.w / 2) + Math.abs(across.y) * (query.size.h / 2);
  const beside: Vec2[] = [];
  for (let row = 0; row < BESIDE_STEPS; row++) {
    const out = query.reach + extent + row * query.size.h;
    for (const side of [-1, 1]) beside.push({ x: middle.x + side * across.x * out, y: middle.y + side * across.y * out });
  }
  return beside.find((at) => clear(at) && apart(at)) ?? beside.find(clear) ?? middle;
};

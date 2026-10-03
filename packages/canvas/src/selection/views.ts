// What selection draws itself (the renderer dims and rings parts, wires and sockets through `setEmphasis`): the ring
// round a selected prop, and the hint rungs in the hints layer, above everything and clear of every socket (brief
// Section 9). Canvas millimetres, sized from the brief's pixels at the default zoom. Colour is kept for meaning: a
// pulsed socket and a ghost wire are in their wire colour, a ring round a part or a prop is neutral.
import { Graphics } from 'pixi.js';
import type { Vec2 } from '@servo/schema';
import type { Palette } from '../renderer/style.ts';
import type { Rect } from '../scene/geometry.ts';
import { DASH_GAP_MM, DASH_MM, PORT_MM, WIRE_MM, mmOf } from '../scene/units.ts';
import type { HintTargets } from './hints.ts';

/** How far a socket reaches from its centre: a hexagon's corner reaches furthest. */
export const SOCKET_REACH_MM = (PORT_MM / 2) * (2 / Math.sqrt(3));
/** The space between what a hint rings and its ring. */
export const HINT_GAP_MM = mmOf(6);
export const HINT_RING_MM = mmOf(5);
const HINT_RADIUS_MM = mmOf(10);
/** A ghost wire is the real line's width, see-through. */
export const GHOST_ALPHA = 0.55;
/** The ring round a selected prop. */
export const PROP_RING_MM = mmOf(3);
/** A pulse runs from full strength down to this and back. With reduced motion it holds at full. */
export const PULSE_LOW = 0.35;
export const PULSE_MS = 1200;
/** Points along a line no further apart than this, when it is cut round the sockets it would cross. */
const STEP_MM = 0.5;

/** The strength of a pulse `t` ms after it began: 1 at the start, easing down to PULSE_LOW and back. */
export const pulseAt = (t: number): number => PULSE_LOW + (1 - PULSE_LOW) * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / PULSE_MS));

/** Something a hint keeps clear of: a socket, with how far it reaches. */
export interface Keep {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const grow = (rect: Rect, by: number): Rect => ({ minX: rect.minX - by, minY: rect.minY - by, maxX: rect.maxX + by, maxY: rect.maxY + by });

/**
 * The runs of a polyline that keep clear of every socket by `margin`: where a hint would cross a socket (a neighbour's,
 * or a crowd's), it stops short and starts again on the other side, so it never covers one (brief Section 9).
 */
export const clearRuns = (points: readonly Vec2[], closed: boolean, keep: readonly Keep[], margin: number): Vec2[][] => {
  const clear = (at: Vec2): boolean => keep.every((socket) => Math.hypot(at.x - socket.x, at.y - socket.y) >= socket.r + margin);
  const ends = closed && points.length > 0 ? [...points, points[0] as Vec2] : [...points];
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  for (let i = 0; i + 1 < ends.length; i++) {
    const a = ends[i] as Vec2;
    const b = ends[i + 1] as Vec2;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP_MM));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const at = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      if (clear(at)) {
        run.push(at);
      } else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
    }
  }
  if (run.length > 0) runs.push(run);
  return runs.filter((each) => each.length > 1);
};

const roundedRect = (rect: Rect, radius: number): Vec2[] => {
  const corners: readonly (readonly [number, number, number])[] = [
    [rect.maxX - radius, rect.minY + radius, -Math.PI / 2],
    [rect.maxX - radius, rect.maxY - radius, 0],
    [rect.minX + radius, rect.maxY - radius, Math.PI / 2],
    [rect.minX + radius, rect.minY + radius, Math.PI],
  ];
  return corners.flatMap(([cx, cy, from]) =>
    Array.from({ length: 7 }, (_, i) => ({ x: cx + radius * Math.cos(from + (i / 6) * (Math.PI / 2)), y: cy + radius * Math.sin(from + (i / 6) * (Math.PI / 2)) })),
  );
};

const circle = (at: Vec2, r: number): Vec2[] =>
  Array.from({ length: 48 }, (_, i) => ({ x: at.x + r * Math.cos((2 * Math.PI * i) / 48), y: at.y + r * Math.sin((2 * Math.PI * i) / 48) }));

/** A dashed line's dashes, laid as the renderer's `dashedPath` lays a signal line's, each its own two-point line. */
const dashes = (from: Vec2, to: Vec2): Vec2[][] => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return [];
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const period = DASH_MM + DASH_GAP_MM;
  const count = Math.max(1, Math.floor((length + DASH_GAP_MM) / period));
  let start = Math.max(0, (length - (count * period - DASH_GAP_MM)) / 2);
  const out: Vec2[][] = [];
  for (let i = 0; i < count; i++) {
    const end = Math.min(length, start + DASH_MM);
    out.push([
      { x: from.x + ux * start, y: from.y + uy * start },
      { x: from.x + ux * end, y: from.y + uy * end },
    ]);
    start += period;
  }
  return out;
};

/**
 * One hint rung: a ring round each part (outside its sockets), a ring in its wire colour round each socket (outside
 * the socket), or a ghost wire between two sockets, power solid and signal dashed (the line-style twins). Each is cut
 * where it would cross a socket, so nothing it draws covers one.
 */
export class HintMarks {
  readonly graphics = new Graphics({ label: 'hints' });

  /** Draws at full strength; a pulse sets `graphics.alpha`. */
  draw(targets: HintTargets, palette: Palette, keep: readonly Keep[]): void {
    const g = this.graphics;
    g.clear();
    const stroke = (runs: readonly Vec2[][], style: { readonly color: number; readonly width: number; readonly alpha: number }): void => {
      for (const run of runs) {
        const [first, ...rest] = run as [Vec2, ...Vec2[]];
        g.moveTo(first.x, first.y);
        for (const at of rest) g.lineTo(at.x, at.y);
        g.stroke({ ...style, cap: 'butt', join: 'round' });
      }
    };
    for (const part of targets.parts) {
      const ring = roundedRect(grow(part.bounds, HINT_GAP_MM + HINT_RING_MM / 2), HINT_RADIUS_MM);
      stroke(clearRuns(ring, true, keep, HINT_RING_MM / 2), { color: palette.label, width: HINT_RING_MM, alpha: 1 });
    }
    for (const port of targets.ports) {
      const ring = circle(port.at, SOCKET_REACH_MM + HINT_GAP_MM + HINT_RING_MM / 2);
      stroke(clearRuns(ring, true, keep, HINT_RING_MM / 2), { color: palette.types[port.type].colour, width: HINT_RING_MM, alpha: 1 });
    }
    for (const [from, to] of targets.wires) {
      const lines = from.type === 'signal' ? dashes(from.at, to.at) : [[from.at, to.at]];
      stroke(
        lines.flatMap((line) => clearRuns(line, false, keep, WIRE_MM / 2)),
        { color: palette.types[from.type].colour, width: WIRE_MM, alpha: GHOST_ALPHA },
      );
    }
  }

  clear(): void {
    this.graphics.clear();
  }
}

/** The ring round a selected prop, just outside its footprint (a box's outline, a cylinder's circle). */
export class PropRing {
  readonly graphics = new Graphics({ label: 'selected prop' });

  draw(shape: { readonly kind: 'outline'; readonly corners: readonly Vec2[] } | { readonly kind: 'circle'; readonly at: Vec2; readonly r: number }, palette: Palette): void {
    const g = this.graphics;
    g.clear();
    if (shape.kind === 'circle') g.circle(shape.at.x, shape.at.y, shape.r);
    else g.poly(shape.corners.flatMap((corner) => [corner.x, corner.y]), true);
    g.stroke({ color: palette.label, width: PROP_RING_MM, alignment: 0 });
  }

  clear(): void {
    this.graphics.clear();
  }
}

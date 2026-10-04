// Every wire a hand can press (task 3.7's routing, task 7.9). Sockets are drawn above the wires and take a press first,
// and a wire drawn later takes a press before one drawn under it (scene/hit.ts). Where parts sit close, a straight
// line, or a tidied route, can lie wholly under sockets and the lines drawn over it, so no press reaches it and the
// child cannot see it. Such a line is drawn with a bend out to the nearest clear spot beside it, outside every part
// body, so it shows and its whole 24 px hit area reaches it there. Pure and deterministic, like the router. See docs/routing.md.
import type { Vec2, WireId } from '@servo/schema';
import { distance, distanceToSegment } from '../scene/geometry.ts';
import type { Scene } from '../scene/scene.ts';
import { PORT_MM, WIRE_HIT_MM } from '../scene/units.ts';
import { bodiesOf, crossingCount } from './router.ts';
import type { ArtOf, Route, WireRoutes } from './router.ts';
import { containsPoint } from './shapes.ts';
import type { Shape } from './shapes.ts';

/**
 * A line counts as pressable when a point on it is this far clear of every socket's target and every hit area over it
 * (1 mm, 2.5 px at the default zoom). A bend gives more: its middle is clear by half a wire's hit area, so the whole
 * 24 px round it reaches the line.
 */
export const PRESS_SPARE_MM = 1;

/** The steps along a line where a pressable point is looked for. */
const SCAN_MM = 0.5;

/** The bend's offsets from the line are tried in steps this fine, out to EXPOSE_MAX_MM on either side. */
const OFFSET_STEP_MM = 1;
export const EXPOSE_MAX_MM = 60;

/** Where along the line the bend may sit, as fractions of its length, the middle first. */
const FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

const toPath = (point: Vec2, path: Route): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (let k = 1; k < path.length; k++) nearest = Math.min(nearest, distanceToSegment(point, path[k - 1] as Vec2, path[k] as Vec2));
  return nearest;
};

/** Whether a press within `spare` of `point` reaches the wire through it: clear of every socket and of the lines over it. */
const clear = (point: Vec2, sockets: readonly Vec2[], above: readonly Route[], spare: number): boolean =>
  sockets.every((socket) => distance(point, socket) >= PORT_MM / 2 + spare) && above.every((path) => toPath(point, path) >= WIRE_HIT_MM / 2 + spare);

/** Whether a press on some point along `path` reaches it, with PRESS_SPARE_MM to spare. */
const exposed = (path: Route, sockets: readonly Vec2[], above: readonly Route[]): boolean => {
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1] as Vec2;
    const b = path[k] as Vec2;
    const steps = Math.max(1, Math.ceil(distance(a, b) / SCAN_MM));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (clear({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, sockets, above, PRESS_SPARE_MM)) return true;
    }
  }
  return false;
};

/** What a bend must keep to: the sockets and lines over it, and the part bodies the router keeps off (D85). */
interface Room {
  readonly sockets: readonly Vec2[];
  readonly above: readonly Route[];
  readonly bodies: readonly Shape[];
  /** The middle of the build, so a bend leans outward, away from it. */
  readonly middle: Vec2;
}

/**
 * The path with a bend in its stretch `k`: out from the stretch to a flat stretch a wire's hit area long, whose middle
 * is clear by `spare` and outside every part body, and which crosses no more bodies than the path did. The nearest offset wins,
 * then the fraction nearest the middle, then the side away from the build's middle (the left of the stretch as it runs
 * when it points at the middle exactly), so a small move does not flip a bend that both sides could take. Undefined
 * when nothing within EXPOSE_MAX_MM fits.
 */
const bendAt = (path: Route, k: number, room: Room, crossings: number, spare: number): Route | undefined => {
  const a = path[k] as Vec2;
  const b = path[k + 1] as Vec2;
  const length = distance(a, b);
  if (length === 0) return undefined;
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const n = { x: u.y, y: -u.x };
  const half = Math.min(WIRE_HIT_MM / 2, length / 4);
  for (let step = 1; step * OFFSET_STEP_MM <= EXPOSE_MAX_MM; step++) {
    for (const fraction of FRACTIONS) {
      const base = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
      const outward = n.x * (base.x - room.middle.x) + n.y * (base.y - room.middle.y) < 0 ? -1 : 1;
      for (const side of [outward, -outward]) {
        const h = side * step * OFFSET_STEP_MM;
        const top = { x: base.x + n.x * h, y: base.y + n.y * h };
        if (!clear(top, room.sockets, room.above, spare)) continue;
        if (room.bodies.some((body) => containsPoint(body, top))) continue;
        const next: Route = [
          ...path.slice(0, k + 1),
          { x: top.x - u.x * half, y: top.y - u.y * half },
          { x: top.x + u.x * half, y: top.y + u.y * half },
          ...path.slice(k + 1),
        ];
        if (crossingCount(next, room.bodies) > crossings) continue;
        return next;
      }
    }
  }
  return undefined;
};

/**
 * A path with a bend in one stretch, the longest that can take one first; undefined when none can. A bend whose middle
 * has a whole hit area clear is looked for first, then, where bodies leave no such room, one clear by PRESS_SPARE_MM.
 */
const bent = (path: Route, room: Room): Route | undefined => {
  const crossings = crossingCount(path, room.bodies);
  const stretches = path
    .slice(1)
    .map((point, k) => ({ k, length: distance(path[k] as Vec2, point) }))
    .sort((p, q) => q.length - p.length || p.k - q.k);
  for (const spare of [WIRE_HIT_MM / 2, PRESS_SPARE_MM]) {
    for (const { k } of stretches) {
      const next = bendAt(path, k, room, crossings, spare);
      if (next) return next;
    }
  }
  return undefined;
};

/** The middle of every part's tile together, or the origin with no parts. */
const middleOf = (scene: Scene): Vec2 => {
  const corners = scene.parts.flatMap((part) => part.corners);
  if (corners.length === 0) return { x: 0, y: 0 };
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

/**
 * The paths that make every power and signal line pressable, by wire id: each line no press reaches, along its tidied
 * route in `routes` or straight, with a bend in it that keeps off the part bodies as `artOf` says they are drawn.
 * Lines are taken from the top of the draw order down, since a line is covered only by those drawn over it.
 */
export const exposeWires = (scene: Scene, routes: WireRoutes, artOf?: ArtOf): WireRoutes => {
  const sockets = scene.parts.flatMap((part) => part.ports.filter((port) => port.layer === 'ports').map((port) => port.at));
  const bodies = bodiesOf(scene, artOf);
  const middle = middleOf(scene);
  const bends = new Map<WireId, Route>();
  const above: Route[] = [];
  for (let i = scene.wires.length - 1; i >= 0; i--) {
    const wire = scene.wires[i];
    if (!wire) continue;
    let path: Route = routes.get(wire.id) ?? [wire.from.at, wire.to.at];
    if (!exposed(path, sockets, above)) {
      const next = bent(path, { sockets, above, bodies, middle });
      if (next) {
        bends.set(wire.id, next);
        path = next;
      }
    }
    above.push(path);
  }
  return bends;
};

// The tidy-wires router (task 3.7, brief Section 9: "a 'tidy wires' button that reroutes wires around parts"). Pure
// and deterministic: the same scene gives the same routes, so every path that tidies (touch, pointer, the list view)
// sees the same picture. A route is view state, never part of the blueprint. See docs/routing.md.
//
// Only power and signal lines that cross a part body are routed; a line that crosses nothing keeps its straight
// line. A route leaves each socket straight out from its part's edge, then takes the shortest way round the bodies
// in the way: a visibility graph over the corners of the bodies grown by a clearance, searched with Dijkstra.
//
// A body is the part as drawn: its footprint (`body.size`) at its true size. The rest of its tile, up to the 96 px
// minimum and round its sockets, is touch padding a wire may pass over. Frames (the chassis) are the deck the parts
// stand on, so wires run over them as over a real chassis.
//
// What counts as crossing: the wire as the child sees it. A socket is drawn over the end of its wire, so the stretch
// of wire under a wire's own two sockets is hidden; where a socket sits over another part (the motor driver's sockets
// over the battery pack beside it) a route climbs off that part within the hidden stretch. A socket boxed in on every
// side by other bodies could not be left without crossing one: its route would cross the least it can, straight out,
// and be clean from there on. No fixture has one.
import type { Vec2, WireId } from '@servo/schema';
import { distance } from '../scene/geometry.ts';
import type { Scene, ScenePort, SceneWire } from '../scene/scene.ts';
import { PORT_MM, mmOf } from '../scene/units.ts';
import { EPS, bodyShape, containsPoint, rayInside, segmentEnters, squareShape } from './shapes.ts';
import type { Shape } from './shapes.ts';

/** How far a routed wire keeps from a part's body when it can: its own half width and a little air, 10 px at the default zoom. */
export const CLEARANCE_MM = mmOf(10);

/** A route leaves its socket straight out, past the socket's own disc and the clearance, before it turns. */
export const STUB_MM = PORT_MM / 2 + CLEARANCE_MM + mmOf(1);

/** The stretch of a wire its socket covers: the socket's 44 px, drawn over the wire's end. */
export const HIDDEN_MM = PORT_MM / 2;

/** How far a route from a boxed-in socket may run straight out, across other parts, to get clear. */
export const ESCAPE_MM = mmOf(400);

/** A routed wire's path from its `from` socket to its `to` socket, both included, in canvas mm. */
export type Route = readonly Vec2[];

/** Routes by wire id. A wire with no entry is drawn straight. */
export type WireRoutes = ReadonlyMap<WireId, Route>;

/**
 * Something a route keeps clear of. `halo` is the room it keeps when it can; `core`, when there is one, is a part's
 * body, which no route ever enters.
 */
interface Obstacle {
  readonly halo: Shape;
  readonly core?: Shape;
}

/** One way of keeping clear, tried from the roomiest: sockets and clearance, clearance only, bodies only. */
interface Pass {
  readonly obstacles: readonly Obstacle[];
  readonly nodes: readonly Vec2[];
  /** For each node, the obstacles whose halo holds it. */
  readonly inside: readonly (readonly number[])[];
  /** For each node, its visible neighbours and the distance to each. */
  readonly edges: readonly (readonly (readonly [number, number])[])[];
}

/** How a route leaves one socket: straight to its launch, then out by its stub when it has one. */
interface Exit {
  readonly socket: Vec2;
  /** The socket itself, or the nearest point clear of the other parts it sits over. */
  readonly launch: Vec2;
  readonly stub?: Vec2;
  /** Millimetres of other parts the straight stretch to the launch crosses where the socket does not hide it. */
  readonly crossing: number;
  readonly length: number;
}

/** The bodies a wire must not cross: every part's drawn body but a frame's. */
export const bodiesOf = (scene: Scene): readonly Shape[] => scene.parts.filter((part) => !part.frame).map((part) => bodyShape(part));

/** The pieces of the segment from `a` to `b` that lie outside every disc, scraps dropped. */
const outsideDiscs = (a: Vec2, b: Vec2, discs: readonly Vec2[], radius: number): [Vec2, Vec2][] => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  let pieces: [number, number][] = [[0, 1]];
  for (const centre of discs) {
    // |a + t(b − a) − centre|² = radius²
    const fx = a.x - centre.x;
    const fy = a.y - centre.y;
    const qa = dx * dx + dy * dy;
    const qb = 2 * (fx * dx + fy * dy);
    const qc = fx * fx + fy * fy - radius * radius;
    const discriminant = qb * qb - 4 * qa * qc;
    if (discriminant <= 0) continue;
    const root = Math.sqrt(discriminant);
    const t0 = (-qb - root) / (2 * qa);
    const t1 = (-qb + root) / (2 * qa);
    pieces = pieces.flatMap(([s, e]): [number, number][] => {
      const out: [number, number][] = [];
      if (Math.min(e, t0) > s) out.push([s, Math.min(e, t0)]);
      if (e > Math.max(s, t1)) out.push([Math.max(s, t1), e]);
      return out;
    });
  }
  return pieces
    .filter(([s, e]) => (e - s) * length > 1e-6)
    .map(([s, e]) => [
      { x: a.x + dx * s, y: a.y + dy * s },
      { x: a.x + dx * e, y: a.y + dy * e },
    ]);
};

/** The bodies the shown pieces of these segments enter, with the discs at `ends` hidden. */
const entered = (segments: readonly (readonly [Vec2, Vec2])[], bodies: readonly Shape[], ends: readonly Vec2[]): Set<number> => {
  const found = new Set<number>();
  for (const [p, q] of segments) {
    for (const [a, b] of outsideDiscs(p, q, ends, HIDDEN_MM)) {
      bodies.forEach((body, index) => {
        if (!found.has(index) && segmentEnters(a, b, body)) found.add(index);
      });
    }
  }
  return found;
};

const segmentsOf = (points: readonly Vec2[]): [Vec2, Vec2][] => points.slice(1).map((point, i) => [points[i] as Vec2, point]);

/**
 * How many bodies a wire drawn along `points` crosses as the child sees it: outside the two sockets at its ends.
 * Running along an edge or touching a corner is not crossing.
 */
export const crossingCount = (points: readonly Vec2[], bodies: readonly Shape[]): number =>
  points.length < 2 ? 0 : entered(segmentsOf(points), bodies, [points[0] as Vec2, points[points.length - 1] as Vec2]).size;

export const crossesBodies = (points: readonly Vec2[], bodies: readonly Shape[]): boolean => crossingCount(points, bodies) > 0;

const holding = (obstacles: readonly Obstacle[], point: Vec2): number[] => {
  const found: number[] = [];
  obstacles.forEach((obstacle, index) => {
    if (containsPoint(obstacle.halo, point)) found.push(index);
  });
  return found;
};

/**
 * Whether a segment is clear. An obstacle whose halo holds either end only keeps its body clear: a corner may sit in
 * a neighbour's clearance, and a socket sits on its own part's edge.
 */
const clear = (a: Vec2, b: Vec2, obstacles: readonly Obstacle[], insideA: readonly number[], insideB: readonly number[]): boolean => {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i] as Obstacle;
    const box = obstacle.halo.box;
    if (maxX <= box.minX || minX >= box.maxX || maxY <= box.minY || minY >= box.maxY) continue;
    const excused = insideA.includes(i) || insideB.includes(i);
    const shape = excused ? obstacle.core : obstacle.halo;
    if (shape && segmentEnters(a, b, shape)) return false;
  }
  return true;
};

const makePass = (obstacles: readonly Obstacle[], bodies: readonly Shape[]): Pass => {
  const nodes: Vec2[] = [];
  obstacles.forEach((obstacle, index) => {
    for (const corner of obstacle.halo.corners) {
      // A corner inside a body is no use: every way out of it crosses that body. One inside another obstacle's room
      // is never on the shortest way round, which hugs the outline of the room they keep together.
      if (bodies.some((body) => containsPoint(body, corner))) continue;
      if (obstacles.some((other, k) => k !== index && containsPoint(other.halo, corner))) continue;
      nodes.push(corner);
    }
  });
  const inside = nodes.map((node) => holding(obstacles, node));
  const edges: [number, number][][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i] as Vec2;
      const b = nodes[j] as Vec2;
      if (!clear(a, b, obstacles, inside[i] as number[], inside[j] as number[])) continue;
      const length = distance(a, b);
      (edges[i] as [number, number][]).push([j, length]);
      (edges[j] as [number, number][]).push([i, length]);
    }
  }
  return { obstacles, nodes, inside, edges };
};

/**
 * The ways a route can leave a socket, best first: the socket itself when it sits over no other part; otherwise
 * the nearest points clear of the parts it sits over, straight out from its edge, along its edge either way, or
 * between the two, crossing none where the socket hides it, then the least where it does not.
 */
const exitsOf = (port: ScenePort, own: Shape | undefined, bodies: readonly Shape[]): Exit[] => {
  const others = bodies.filter((body) => body !== own);
  const n = port.outward ?? { x: -1, y: 0 };
  const r = Math.SQRT1_2;
  const directions: readonly Vec2[] = [
    n,
    { x: -n.y, y: n.x },
    { x: n.y, y: -n.x },
    { x: (n.x - n.y) * r, y: (n.y + n.x) * r },
    { x: (n.x + n.y) * r, y: (n.y - n.x) * r },
  ];
  const found: Exit[] = [];
  const add = (t: number, crossing: number, direction: Vec2): void => {
    const launch = t === 0 ? port.at : { x: port.at.x + direction.x * t, y: port.at.y + direction.y * t };
    if (t > 0 && own && segmentEnters(port.at, launch, own)) return;
    if (found.some((exit) => distance(exit.launch, launch) < 1e-9)) return;
    const stub = t === 0 && port.outward ? { x: port.at.x + n.x * STUB_MM, y: port.at.y + n.y * STUB_MM } : undefined;
    found.push({ socket: port.at, launch, ...(stub ? { stub } : {}), crossing, length: t });
  };
  for (const direction of directions) {
    const spans = others
      .map((body) => rayInside(body, port.at, direction))
      .filter((span): span is readonly [number, number] => span !== undefined)
      .map(([enter, leave]): [number, number] => [Math.max(0, enter), leave])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: [number, number][] = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1]);
      else merged.push([span[0], span[1]]);
    }
    if (merged.length === 0 || (merged[0] as [number, number])[0] > EPS) add(0, 0, direction);
    for (const [, end] of merged) {
      if (end > ESCAPE_MM) break;
      const crossing = merged.reduce((sum, [s, e]) => sum + Math.max(0, Math.min(e, end) - Math.max(s, HIDDEN_MM)), 0);
      add(end, crossing > 1e-6 ? crossing : 0, direction);
    }
  }
  // A stable sort: equal exits keep the order of the directions above.
  return found.sort((a, b) => a.crossing - b.crossing || a.length - b.length);
};

/** Drops repeated points and points that lie on the straight line through their neighbours. */
const simplify = (points: readonly Vec2[]): Vec2[] => {
  const out: Vec2[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && distance(last, point) < 1e-9) continue;
    out.push(point);
    while (out.length >= 3) {
      const a = out[out.length - 3] as Vec2;
      const b = out[out.length - 2] as Vec2;
      const c = out[out.length - 1] as Vec2;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const along = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(area) > 1e-9 * Math.max(1, distance(a, c)) || along < 0) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
};

/**
 * The shortest clear way from one launch to the other in a pass, or undefined. Its ends: 0 the from launch, 1 its
 * stub, 2 the to stub, 3 the to launch; the pass's corners from 4. A launch goes out through its stub, or straight
 * to the corners when something is in the way of its stub.
 */
const routeIn = (pass: Pass, from: Exit, to: Exit): Vec2[] | undefined => {
  const { obstacles, nodes } = pass;
  const ends: (Vec2 | undefined)[] = [from.launch, from.stub, to.stub, to.launch];
  const endInside = ends.map((point) => (point ? holding(obstacles, point) : []));
  const count = 4 + nodes.length;
  const point = (index: number): Vec2 | undefined => (index < 4 ? ends[index] : nodes[index - 4]);
  const insideOf = (index: number): readonly number[] => (index < 4 ? (endInside[index] as number[]) : (pass.inside[index - 4] as number[]));
  const visible = (i: number, j: number): boolean => {
    const a = point(i);
    const b = point(j);
    return a !== undefined && b !== undefined && clear(a, b, obstacles, insideOf(i), insideOf(j));
  };

  const viaFromStub = ends[1] !== undefined && visible(0, 1);
  const viaToStub = ends[2] !== undefined && visible(2, 3);
  const start = viaFromStub ? 1 : 0;
  const goal = viaToStub ? 2 : 3;

  const neighbours = (index: number): (readonly [number, number])[] => {
    if (index === 0 && viaFromStub) return [[1, distance(ends[0] as Vec2, ends[1] as Vec2)]];
    if (index === 2 && viaToStub) return [[3, distance(ends[2] as Vec2, ends[3] as Vec2)]];
    const out: (readonly [number, number])[] = [];
    if (index !== start && index < 4) return out;
    const here = point(index) as Vec2;
    if (visible(index, goal)) out.push([goal, distance(here, point(goal) as Vec2)]);
    if (index === start) {
      for (let k = 0; k < nodes.length; k++) if (visible(index, 4 + k)) out.push([4 + k, distance(here, nodes[k] as Vec2)]);
    } else {
      for (const [k, length] of pass.edges[index - 4] as (readonly [number, number])[]) out.push([4 + k, length]);
    }
    return out;
  };

  const best = new Float64Array(count).fill(Infinity);
  const previous = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  best[0] = 0;
  for (;;) {
    let current = -1;
    for (let i = 0; i < count; i++) {
      if (!done[i] && best[i] !== Infinity && (current < 0 || (best[i] as number) < (best[current] as number))) current = i;
    }
    if (current < 0) return undefined;
    if (current === 3) break;
    done[current] = 1;
    for (const [next, length] of neighbours(current)) {
      const through = (best[current] as number) + length;
      if (through < (best[next] as number)) {
        best[next] = through;
        previous[next] = current;
      }
    }
  }
  const path: Vec2[] = [];
  for (let at = 3; at >= 0; at = previous[at] as number) {
    path.push(point(at) as Vec2);
    if (at === 0) break;
  }
  return simplify(path.reverse());
};

/** The whole route: socket, launch, the way between the launches, launch, socket. */
const joined = (from: Exit, between: readonly Vec2[], to: Exit): Vec2[] => {
  const points = [...between];
  if (from.launch !== from.socket) points.unshift(from.socket);
  if (to.launch !== to.socket) points.push(to.socket);
  return points;
};

/** Whether a whole route is clean but for the stretches straight out of a boxed-in socket, which its exits own. */
const cleanBeyondExits = (route: readonly Vec2[], from: Exit, to: Exit, bodies: readonly Shape[]): boolean => {
  const segments = segmentsOf(route);
  if (from.crossing > 0) segments.shift();
  if (to.crossing > 0) segments.pop();
  return entered(segments, bodies, [from.socket, to.socket]).size === 0;
};

/**
 * Routes every power and signal line that crosses a part body. A wire no pass can route keeps its straight line.
 * Mechanical linkages and mounts are never routed: they sit under the parts, and are almost always zero long.
 */
export const routeWires = (scene: Scene): WireRoutes => {
  const routes = new Map<WireId, Route>();
  const solid = scene.parts.filter((part) => !part.frame);
  const bodies = solid.map((part) => bodyShape(part));
  const crossing = scene.wires.filter((wire) => crossesBodies([wire.from.at, wire.to.at], bodies));
  if (crossing.length === 0) return routes;

  const bodyOf = new Map(solid.map((part, index) => [part.id, bodies[index] as Shape]));
  const sockets = solid.flatMap((part) => part.ports.filter((port) => port.layer === 'ports'));
  const grown: Obstacle[] = solid.map((part, index) => ({ halo: bodyShape(part, CLEARANCE_MM), core: bodies[index] as Shape }));
  const makers: readonly (() => Pass)[] = [
    () => makePass([...grown, ...sockets.map((port) => ({ halo: squareShape(port.at, HIDDEN_MM + CLEARANCE_MM / 2) }))], bodies),
    () => makePass(grown, bodies),
    () => makePass(bodies.map((body) => ({ halo: body, core: body })), bodies),
  ];
  const built: (Pass | undefined)[] = makers.map(() => undefined);
  const pass = (k: number): Pass => (built[k] ??= (makers[k] as () => Pass)());
  const loosest = makers.length - 1;

  for (const wire of crossing) {
    const froms = exitsOf(wire.from, bodyOf.get(wire.from.ref.part), bodies);
    const tos = exitsOf(wire.to, bodyOf.get(wire.to.ref.part), bodies);
    const pairs = froms
      .flatMap((from) => tos.map((to) => [from, to] as const))
      .sort(([a, b], [c, d]) => a.crossing + b.crossing - (c.crossing + d.crossing) || a.length + b.length - (c.length + d.length));
    for (const [from, to] of pairs) {
      // The loosest pass says whether these exits join at all; the roomier ones then give the tidier way.
      const loose = routeIn(pass(loosest), from, to);
      if (!loose || !cleanBeyondExits(joined(from, loose, to), from, to, bodies)) continue;
      let route = joined(from, loose, to);
      for (let k = 0; k < loosest; k++) {
        const between = routeIn(pass(k), from, to);
        if (between && cleanBeyondExits(joined(from, between, to), from, to, bodies)) {
          route = joined(from, between, to);
          break;
        }
      }
      routes.set(wire.id, route);
      break;
    }
  }
  return routes;
};

/** A wire's path as drawn: its route, or the straight line between its sockets. */
export const pathOf = (wire: SceneWire, routes: WireRoutes): Route => routes.get(wire.id) ?? [wire.from.at, wire.to.at];

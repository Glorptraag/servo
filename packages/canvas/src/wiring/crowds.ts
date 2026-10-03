// Crowded sockets (review R-3.1, finding 2). Where parts sit close on a chassis, sockets of neighbouring parts overlap
// at every zoom, because sockets scale with the build: on the Level 2 bumper robot some sit 10 px apart, on the
// Circuit Crew kit robot 5.6 px. A crowd is a group of sockets whose 44 px targets overlap. When a press or a wire end
// cannot tell which one of a crowd is meant, the crowd fans out: each socket moves out on a lead to a place of its own,
// a socket and a gap from the others, clear of the rest where there is room, and drawn above them and taking presses
// first where there is not, so it has its own 44 px target. The fan is view state; the build never changes. Pure:
// geometry only, from the scene (ground rule 1). See docs/wiring.md.
import { PLACEMENT_TOLERANCE } from '@servo/schema';
import type { PlacedPartId, Vec2 } from '@servo/schema';
import { distance } from '../scene/geometry.ts';
import type { Rect } from '../scene/geometry.ts';
import type { Scene, ScenePort } from '../scene/scene.ts';
import { PORT_GAP_MM, PORT_MM } from '../scene/units.ts';

/**
 * One place a press can mean: a socket, or a shaft and the hub or gearbox input on it. A mated pair sits on one spot
 * by design and is full at both ends, so it is one member and moves as one.
 */
export interface CrowdMember {
  /** The first of its sockets' keys. */
  readonly key: string;
  readonly ports: readonly ScenePort[];
  /** Where the scene draws it, mm. */
  readonly at: Vec2;
  /** The part its first socket belongs to, and where that part sits: a fanned socket leans towards its own part. */
  readonly part: PlacedPartId;
  readonly towards: Vec2;
}

export interface Crowd {
  /** Its first member's key. */
  readonly id: string;
  /** In key order. */
  readonly members: readonly CrowdMember[];
}

export interface Crowds {
  readonly list: readonly Crowd[];
  /** The crowd a socket is in, by port key; undefined for a socket with its own target. */
  crowdOf(portKey: string): Crowd | undefined;
  /** The member a socket belongs to, by port key, crowded or not. */
  memberOf(portKey: string): CrowdMember | undefined;
}

/** Fanned sockets sit a socket and a gap apart, as a part's own sockets do (scene/layout.ts). */
export const FAN_SPACING_MM = PORT_MM + PORT_GAP_MM;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every socket a press or a wire can meet: the ports layer's power and signal sockets, shafts and hubs. Mounts and
 * mount points are not wired: a part is fixed by placing it (task 3.2), so a frame's mount points, drawn on the
 * chassis under the parts, neither take a wire nor push one away.
 */
export const drawnSockets = (scene: Scene): ScenePort[] => scene.parts.flatMap((part) => part.ports.filter((port) => port.layer === 'ports'));

/**
 * The crowds of a scene: groups of sockets whose 44 px targets overlap (centres less than a socket apart), a mated
 * shaft and hub counting as one member. Sockets with targets of their own are in no crowd.
 */
export const crowdsOf = (scene: Scene): Crowds => {
  const sockets = drawnSockets(scene).sort((a, b) => compareText(a.key, b.key));
  // Mated pairs: the two ends of a drive linkage, drawn on one spot.
  const mate = new Map<string, string>();
  for (const linkage of scene.linkages) {
    if (linkage.kind !== 'drive' || linkage.from.layer !== 'ports' || linkage.to.layer !== 'ports') continue;
    if (distance(linkage.from.at, linkage.to.at) > PLACEMENT_TOLERANCE.mm) continue;
    mate.set(linkage.from.key, linkage.to.key);
    mate.set(linkage.to.key, linkage.from.key);
  }
  const byKey = new Map(sockets.map((port) => [port.key, port] as const));
  const members: CrowdMember[] = [];
  const memberByPort = new Map<string, CrowdMember>();
  for (const port of sockets) {
    if (memberByPort.has(port.key)) continue;
    const partner = mate.get(port.key);
    const ports = [port, ...(partner !== undefined && byKey.has(partner) ? [byKey.get(partner) as ScenePort] : [])];
    const owner = scene.partById.get(port.ref.part);
    const member: CrowdMember = {
      key: port.key,
      ports,
      at: port.at,
      part: port.ref.part,
      towards: owner ? { x: owner.pose.x, y: owner.pose.y } : port.at,
    };
    members.push(member);
    for (const each of ports) memberByPort.set(each.key, member);
  }
  // Members whose targets overlap join one crowd (union-find over the pairs).
  const parent = members.map((_, index) => index);
  const root = (index: number): number => {
    let at = index;
    while (parent[at] !== at) at = parent[at] as number;
    return at;
  };
  const near = (a: CrowdMember, b: CrowdMember): boolean =>
    a.ports.some((p) => b.ports.some((q) => distance(p.at, q.at) < PORT_MM - 1e-9));
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (!near(members[i] as CrowdMember, members[j] as CrowdMember)) continue;
      const a = root(i);
      const b = root(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = new Map<number, CrowdMember[]>();
  members.forEach((member, index) => {
    const group = groups.get(root(index));
    if (group) group.push(member);
    else groups.set(root(index), [member]);
  });
  const list: Crowd[] = [];
  const crowdByPort = new Map<string, Crowd>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const crowd: Crowd = { id: (group[0] as CrowdMember).key, members: group };
    list.push(crowd);
    for (const member of group) for (const port of member.ports) crowdByPort.set(port.key, crowd);
  }
  list.sort((a, b) => compareText(a.id, b.id));
  return {
    list,
    crowdOf: (key) => crowdByPort.get(key),
    memberOf: (key) => memberByPort.get(key),
  };
};

const TAU = 2 * Math.PI;
const normal = (angle: number): number => ((angle % TAU) + TAU) % TAU;

/** Pool-adjacent-violators: the non-decreasing sequence nearest `values` in least squares. */
const nonDecreasing = (values: readonly number[]): number[] => {
  const blocks: { sum: number; count: number }[] = [];
  for (const value of values) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1] as { sum: number; count: number };
      const before = blocks[blocks.length - 2] as { sum: number; count: number };
      if (before.sum / before.count <= last.sum / last.count) break;
      blocks.pop();
      before.sum += last.sum;
      before.count += last.count;
    }
  }
  return blocks.flatMap((block) => Array.from({ length: block.count }, () => block.sum / block.count));
};

/**
 * Angles as near the preferred ones as can be, in the same order round the circle, each at least `gap` from the next.
 * Least squares, by cutting the circle at its widest gap; evenly spaced when the circle has no room to spare.
 */
export const spreadAngles = (preferred: readonly number[], gap: number): number[] => {
  const n = preferred.length;
  if (n <= 1) return preferred.map(normal);
  const order = preferred.map((_, index) => index).sort((a, b) => normal(preferred[a] as number) - normal(preferred[b] as number) || a - b);
  const sorted = order.map((index) => normal(preferred[index] as number));
  let cut = 0;
  let widest = -Infinity;
  for (let k = 0; k < n; k++) {
    const next = k === n - 1 ? (sorted[0] as number) + TAU : (sorted[k + 1] as number);
    if (next - (sorted[k] as number) > widest) {
      widest = next - (sorted[k] as number);
      cut = (k + 1) % n;
    }
  }
  const sequence = [...sorted.slice(cut), ...sorted.slice(0, cut).map((angle) => angle + TAU)];
  const indices = [...order.slice(cut), ...order.slice(0, cut)];
  const step = Math.min(gap, TAU / n);
  const fitted = nonDecreasing(sequence.map((angle, k) => angle - k * step)).map((value, k) => value + k * step);
  const evenly = (fitted[n - 1] as number) - (fitted[0] as number) > TAU - step + 1e-9;
  const offset = sequence.reduce((sum, angle, k) => sum + angle - (k * TAU) / n, 0) / n;
  const result = new Array<number>(n);
  indices.forEach((index, k) => {
    result[index] = normal(evenly ? offset + (k * TAU) / n : (fitted[k] as number));
  });
  return result;
};

export interface FanOptions {
  /** The smallest distance from the fan's centre to a fanned socket, mm: past the reach of a finger at the centre. */
  readonly minRadius: number;
  /**
   * Points a fanned socket stays clear of where it can, mm: other sockets, by a socket's width. Fanned sockets are drawn
   * above them and take presses first, so where a crowd has no room nearby the fan stays close and covers them.
   */
  readonly obstacles: readonly { readonly at: Vec2; readonly clearance: number }[];
  /** What the screen shows, mm: fanned sockets stay inside it where they can. */
  readonly view?: Rect;
}

/** Radius steps and turns the fan tries, nearest first: it stays within a socket of its smallest circle. */
const RADIUS_STEP_MM = PORT_MM / 4;
export const FAN_RADIUS_STEPS = 4;
const TURN_STEP = Math.PI / 12;
const TURN_STEPS = 12;

/**
 * Where each member of a crowd goes when it fans out round `centre` (the press or the wire end that found it
 * ambiguous): on a circle, each leaning towards its own part, a socket and a gap apart. Of the circles up to a socket
 * wider and the turns either way, the first clear of every obstacle and inside the view wins (the smallest circle,
 * the least turn); with none clear, the one that keeps clearest. Keyed by member key. Pure and deterministic.
 */
export const fanOut = (crowd: Crowd, centre: Vec2, options: FanOptions): ReadonlyMap<string, Vec2> => {
  const { members } = crowd;
  const n = members.length;
  const preferred = members.map((member, index) => {
    for (const towards of [member.towards, member.at]) {
      if (distance(towards, centre) > 1e-6) return Math.atan2(towards.y - centre.y, towards.x - centre.x);
    }
    return (index * TAU) / n;
  });
  const smallest = Math.max(options.minRadius, n > 1 ? FAN_SPACING_MM / (2 * Math.sin(Math.PI / n)) : 0);
  const clearance = (points: readonly Vec2[]): number => {
    let worst = Infinity;
    for (const point of points) {
      for (const obstacle of options.obstacles) worst = Math.min(worst, distance(point, obstacle.at) - obstacle.clearance);
      const view = options.view;
      if (view) {
        const margin = PORT_MM / 2;
        worst = Math.min(worst, point.x - view.minX - margin, view.maxX - point.x - margin, point.y - view.minY - margin, view.maxY - point.y - margin);
      }
    }
    return worst;
  };
  const tries: { radius: number; turn: number; cost: number }[] = [];
  for (let r = 0; r <= FAN_RADIUS_STEPS; r++) {
    for (let t = -TURN_STEPS; t <= TURN_STEPS; t++) tries.push({ radius: smallest + r * RADIUS_STEP_MM, turn: t * TURN_STEP, cost: r + Math.abs(t) });
  }
  // Fewest steps first; then the smaller circle, the smaller turn, and the clockwise turn.
  tries.sort((a, b) => a.cost - b.cost || a.radius - b.radius || Math.abs(a.turn) - Math.abs(b.turn) || b.turn - a.turn);
  let best: { points: Vec2[]; score: number } | undefined;
  for (const { radius, turn } of tries) {
    const gap = 2 * Math.asin(Math.min(1, FAN_SPACING_MM / (2 * radius)));
    const angles = spreadAngles(preferred, gap);
    const points = angles.map((angle) => ({ x: centre.x + radius * Math.cos(angle + turn), y: centre.y + radius * Math.sin(angle + turn) }));
    const score = clearance(points);
    if (score >= 0) {
      best = { points, score };
      break;
    }
    if (!best || score > best.score) best = { points, score };
  }
  const points = best?.points ?? members.map((member) => member.at);
  return new Map(members.map((member, index) => [member.key, points[index] as Vec2] as const));
};

/** The smallest circle a crowd fans out on, for a finger that reaches `reach` mm: past that reach from the centre. */
export const fanRadius = (reach: number): number => Math.max(PORT_MM, reach + PORT_MM / 4);

/**
 * The fan the canvas opens for a crowd round `centre`, for a finger that reaches `reach` mm: every fanned socket out of
 * that reach from the centre, so the press or lift that opened it picks none, and clear of every socket where the
 * scene draws it (the crowd's own included) where there is room near by.
 */
export const fanFor = (scene: Scene, crowd: Crowd, centre: Vec2, reach: number, view?: Rect): ReadonlyMap<string, Vec2> => {
  const obstacles = drawnSockets(scene).map((port) => ({ at: port.at, clearance: PORT_MM }));
  return fanOut(crowd, centre, { minRadius: fanRadius(reach), obstacles, ...(view ? { view } : {}) });
};

// Where a wire may land (brief Section 10), judged only by the schema's wiring module (ground rules 1 and 3): the
// canvas asks `planWire` about every socket a wire can meet, so the glow, the push-away and the command always agree.
// The socket under the finger decides; between sockets, a wire lands on the nearest matching one within reach; a
// socket that can never take it pushes it away; lifted anywhere else it goes back. Pure. See docs/wiring.md.
import { planWire } from '@servo/schema';
import type { Blueprint, Catalogue, IssueCode, PortRef, Vec2 } from '@servo/schema';
import { distance } from '../scene/geometry.ts';
import type { Scene, ScenePort } from '../scene/scene.ts';
import { PORT_MM } from '../scene/units.ts';
import { drawnSockets } from './crowds.ts';
import type { Crowds } from './crowds.ts';

/** Forgiveness: a wire lifted within this many screen pixels of a matching socket lands on it (brief Section 10). */
export const WIRE_REACH_PX = 32;

/** A socket a wire can meet, where it is drawn now, and whether it would take the wire. */
export interface Socket {
  readonly port: ScenePort;
  /** Where the scene draws it, or where its crowd fans it out, mm. */
  readonly at: Vec2;
  /** `planWire` accepts the wire: the same colour, room for it, and not a second wire between the same two ports. */
  readonly legal: boolean;
  /** Why it would refuse it: one of the schema's `wire.*` codes. */
  readonly code?: IssueCode;
  /** The wire's own source. */
  readonly source: boolean;
  /** The crowd member it is (a mated shaft and hub are one), the crowd it is in, and whether that crowd is fanned out now (crowds.ts). */
  readonly member: string;
  readonly crowd?: string;
  readonly fanned: boolean;
  /**
   * Where a fanned-out socket came from. It takes no wire and refuses none: a wire there is where the crowd was, and
   * picks nothing until it goes to one of the fanned sockets.
   */
  readonly shadow?: boolean;
}

export type Verdict = { readonly legal: true } | { readonly legal: false; readonly code: IssueCode };

/** How every socket a wire can meet would take a wire from `source`, by `planWire`: what the command will do. */
export const judgeSockets = (blueprint: Blueprint, catalogue: Catalogue, scene: Scene, source: PortRef): Map<string, Verdict> => {
  const verdicts = new Map<string, Verdict>();
  for (const port of drawnSockets(scene)) {
    const plan = planWire(blueprint, catalogue, source, port.ref);
    verdicts.set(port.key, plan.legal ? { legal: true } : { legal: false, code: plan.code });
  }
  return verdicts;
};

/**
 * Every socket a wire from `source` can meet, with its verdict and its crowd, where it is now: fanned out when its
 * crowd member has a place in `fanned` (member key → place), with a shadow where it came from, else where the scene
 * draws it.
 */
export const socketsFrom = (
  scene: Scene,
  crowds: Crowds,
  verdicts: ReadonlyMap<string, Verdict>,
  source: ScenePort,
  fanned?: ReadonlyMap<string, Vec2>,
): Socket[] =>
  drawnSockets(scene).flatMap((port) => {
    const verdict = verdicts.get(port.key);
    const member = crowds.memberOf(port.key)?.key ?? port.key;
    const crowd = crowds.crowdOf(port.key)?.id;
    const place = fanned?.get(member);
    const socket: Socket = {
      port,
      at: place ?? port.at,
      legal: port.key !== source.key && verdict?.legal === true,
      ...(verdict && !verdict.legal ? { code: verdict.code } : {}),
      source: port.key === source.key,
      member,
      ...(crowd !== undefined ? { crowd } : {}),
      fanned: place !== undefined,
    };
    return place === undefined ? [socket] : [socket, { port, at: port.at, legal: false, source: false, member, fanned: true, shadow: true }];
  });

/** The nearest socket within `reach` of `point` that passes `test`, ties to the earlier one. */
const nearest = (point: Vec2, sockets: readonly Socket[], reach: number, test: (socket: Socket) => boolean): Socket | undefined => {
  let best: Socket | undefined;
  let gap = Infinity;
  for (const socket of sockets) {
    if (!test(socket)) continue;
    const d = distance(point, socket.at);
    if (d <= reach && d < gap) {
      best = socket;
      gap = d;
    }
  }
  return best;
};

export type Landing =
  | { readonly kind: 'land'; readonly socket: Socket }
  | { readonly kind: 'spread'; readonly socket: Socket }
  | { readonly kind: 'refuse'; readonly socket: Socket }
  | { readonly kind: 'source' }
  | { readonly kind: 'none' };

/**
 * What a wire at `point` (lifted there, or a waiting wire tapped there) does, so it never lands on a socket other
 * than the one it is on:
 * - on a fanned-out socket's 44 px target (drawn above everything), that socket decides: it takes the wire, or
 *   refuses it (a wrong colour, no room);
 * - nearest to where a fanned-out crowd was (its shadow), nothing: the wire goes to one of the fanned sockets;
 * - on one socket's target, that socket decides; on two at once, they overlap, and their crowd fans out first when
 *   one of it would take the wire;
 * - between sockets, within reach of one that would take it, the wire lands there (brief Section 10's 32 px), unless
 *   another of its crowd is within reach too: then the crowd fans out first;
 * - else within reach of one that would refuse it, it is refused there; within reach of its own source only, it
 *   goes back; and anywhere else it goes back.
 * The wire's own source (with the hub on its shaft) is never what it is on.
 */
export const landingAt = (point: Vec2, sockets: readonly Socket[], reach: number): Landing => {
  const source = sockets.find((socket) => socket.source)?.member;
  const fanned = nearest(point, sockets, PORT_MM / 2, (socket) => socket.fanned && !socket.shadow && socket.member !== source);
  if (fanned) {
    const taker = sockets.find((socket) => socket.member === fanned.member && !socket.shadow && socket.legal);
    return taker ? { kind: 'land', socket: taker } : { kind: 'refuse', socket: fanned };
  }
  if (nearest(point, sockets, reach, (socket) => socket.member !== source || socket.shadow === true)?.shadow) return { kind: 'none' };
  const others = sockets.filter((socket) => socket.member !== source && !socket.shadow);
  const on = others.filter((socket) => distance(point, socket.at) <= PORT_MM / 2).sort((a, b) => distance(point, a.at) - distance(point, b.at));
  const members = new Set(on.map((socket) => socket.member));
  const [first] = on;
  if (first && members.size > 1) {
    const crowdTakes = first.crowd !== undefined && others.some((socket) => socket.crowd === first.crowd && socket.legal);
    return crowdTakes ? { kind: 'spread', socket: first } : { kind: 'refuse', socket: first };
  }
  if (first) {
    const taker = on.find((socket) => socket.legal);
    return taker ? { kind: 'land', socket: taker } : { kind: 'refuse', socket: first };
  }
  const target = nearest(point, others, reach, (socket) => socket.legal);
  if (target) {
    const crowded =
      target.crowd !== undefined &&
      !target.fanned &&
      others.some((socket) => socket.crowd === target.crowd && socket.member !== target.member && distance(point, socket.at) <= reach);
    return crowded ? { kind: 'spread', socket: target } : { kind: 'land', socket: target };
  }
  const wrong = nearest(point, others, reach, () => true);
  if (wrong) return { kind: 'refuse', socket: wrong };
  return nearest(point, sockets, reach, (socket) => socket.source && !socket.shadow) ? { kind: 'source' } : { kind: 'none' };
};

export interface WireEnd {
  /** Where the free end is drawn, mm. */
  readonly end: Vec2;
  /** The matching socket it sits on: where it lands if lifted now. */
  readonly target?: Socket;
  /** The socket pushing it away: one that can never take it. */
  readonly pushedBy?: Socket;
}

/**
 * Where the free end of a wire under a finger at `point` is drawn, by `landingAt`: on the socket it would land on (the
 * wire snaps to it and it glows), held out of reach of a socket that would refuse it (a wrong colour pushes the wire
 * away), else under the finger, as over a crowd that must fan out first.
 */
export const wireEndAt = (point: Vec2, sockets: readonly Socket[], reach: number, sourceAt: Vec2): WireEnd => {
  const landing = landingAt(point, sockets, reach);
  if (landing.kind === 'land') return { end: landing.socket.at, target: landing.socket };
  if (landing.kind !== 'refuse') return { end: point };
  const wrong = landing.socket;
  let dx = point.x - wrong.at.x;
  let dy = point.y - wrong.at.y;
  let length = Math.hypot(dx, dy);
  if (length < 1e-9) {
    // Right on the socket: pushed back towards where the wire comes from.
    dx = sourceAt.x - wrong.at.x;
    dy = sourceAt.y - wrong.at.y;
    length = Math.hypot(dx, dy);
    if (length < 1e-9) return { end: point, pushedBy: wrong };
  }
  return { end: { x: wrong.at.x + (dx / length) * reach, y: wrong.at.y + (dy / length) * reach }, pushedBy: wrong };
};

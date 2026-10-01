import type { Blueprint, PlacedPart } from '../types/blueprint.ts';
import type { IssueCode } from '../types/issue.ts';
import type { PortRef, PortSpec } from '../types/port.ts';
import type { Catalogue } from './catalogue.ts';
import { compareText } from './reader.ts';

/**
 * Wire legality: the one module the canvas and sim-core both import (ground rule 3).
 *
 * Two kinds of wrong are kept apart (brief Section 10):
 * - an impossible drop is refused here with a named reason, at the socket, before it exists;
 * - a legal-but-wrong wire (a motor straight off a microcontroller pin, a reversed motor, a short)
 *   is always accepted, because its failure on Run is the lesson.
 */

/** Every socket a port can be. */
export type Socket = 'power' | 'signal-in' | 'signal-out' | 'drive-in' | 'drive-out' | 'mount' | 'mount-point';

export const socketOf = (port: PortSpec): Socket => {
  if (port.type === 'power') return 'power';
  if (port.type === 'signal') return port.direction === 'in' ? 'signal-in' : 'signal-out';
  return port.role;
};

/**
 * How many wires each socket takes; `null` means any number. Power ports join nets and a signal out
 * may feed several inputs; a signal in, a shaft, a hub, a mount and a mount point take one each.
 */
export const SOCKET_CAPACITY: Readonly<Record<Socket, number | null>> = {
  power: null,
  'signal-out': null,
  'signal-in': 1,
  'drive-out': 1,
  'drive-in': 1,
  mount: 1,
  'mount-point': 1,
};

/** A power line, a signal line, a drive linkage (turning) or a mount (fixing a part to a frame). */
export type WireKind = 'power' | 'signal' | 'drive' | 'mount';

export type PairRefusal = 'wire.type_mismatch' | 'wire.signal_direction' | 'wire.mechanical_mismatch' | 'wire.mechanical_direction';

/** The socket rule for two ports. `swap` is true when `b` is the source end of a directional wire. */
export type PairVerdict =
  | { readonly legal: true; readonly kind: WireKind; readonly swap: boolean }
  | { readonly legal: false; readonly code: PairRefusal; readonly message: string };

const isDrive = (socket: Socket): boolean => socket === 'drive-out' || socket === 'drive-in';

/**
 * Whether two ports' sockets accept each other: same type only; signal out → signal in; drive-out →
 * drive-in; mount → mount point. Power joins any power port in either order. Use it for the glow on
 * approach; `planWire` adds the rules that depend on the rest of the build.
 */
export const checkPortPair = (a: PortSpec, b: PortSpec): PairVerdict => {
  if (a.type !== b.type) {
    return {
      legal: false,
      code: 'wire.type_mismatch',
      message: `A ${a.type} port only joins another ${a.type} port; this one is a ${b.type} port.`,
    };
  }
  const first = socketOf(a);
  const second = socketOf(b);
  if (a.type === 'power') return { legal: true, kind: 'power', swap: false };
  if (a.type === 'signal') {
    if (first === second) {
      return {
        legal: false,
        code: 'wire.signal_direction',
        message: `A signal line runs from a signal out to a signal in; both of these are signal ${first === 'signal-out' ? 'outs' : 'ins'}.`,
      };
    }
    return { legal: true, kind: 'signal', swap: first === 'signal-in' };
  }
  if (isDrive(first) !== isDrive(second)) {
    return {
      legal: false,
      code: 'wire.mechanical_mismatch',
      message: 'A drive linkage joins a shaft to a hub; a mount joins a part to a mount point. These cannot be mixed.',
    };
  }
  if (first === second) {
    return {
      legal: false,
      code: 'wire.mechanical_direction',
      message: isDrive(first)
        ? 'A drive linkage runs from a drive-out (a shaft or arm) to a drive-in (a hub or gearbox input).'
        : "A mount joins a part's mount to a mount point on another part.",
    };
  }
  return isDrive(first) ? { legal: true, kind: 'drive', swap: first === 'drive-in' } : { legal: true, kind: 'mount', swap: first === 'mount-point' };
};

/** Code-unit order by part id, then port id: the canonical order of a power wire's ends. */
export const comparePortRefs = (a: PortRef, b: PortRef): number => compareText(a.part, b.part) || compareText(a.port, b.port);

/** A port on the board with its spec from the part record. */
export interface PortEnd {
  readonly ref: PortRef;
  readonly spec: PortSpec;
}

/** The wires already on a board, for judging the next one. Build it with `emptyWiring` and `addWire`. */
export interface WiringState {
  readonly counts: Map<string, number>;
  readonly pairs: Set<string>;
  /** Placed part id → the ids of the parts it is mounted on. */
  readonly hosts: Map<string, Set<string>>;
}

export const emptyWiring = (): WiringState => ({ counts: new Map(), pairs: new Set(), hosts: new Map() });

const portKey = (ref: PortRef): string => `${ref.part}.${ref.port}`;

const pairKey = (a: PortRef, b: PortRef): string =>
  comparePortRefs(a, b) <= 0 ? `${portKey(a)}|${portKey(b)}` : `${portKey(b)}|${portKey(a)}`;

const mountedOn = (state: WiringState, part: string, host: string): boolean => {
  const seen = new Set<string>();
  const stack = [part];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === host) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of state.hosts.get(current) ?? []) stack.push(next);
  }
  return false;
};

export type WireRefusal = PairRefusal | 'wire.same_port' | 'wire.mechanical_same_part' | 'wire.duplicate' | 'wire.port_full' | 'mount.cycle';

export type WireJudgement =
  | { readonly legal: true; readonly kind: WireKind; readonly from: PortRef; readonly to: PortRef }
  | { readonly legal: false; readonly code: WireRefusal; readonly message: string };

/**
 * Judges a wire between two ports given the wires already on the board. A legal judgement carries the
 * wire in stored orientation: source first for directional kinds, lower port reference first for power.
 */
export const judgeWire = (state: WiringState, a: PortEnd, b: PortEnd): WireJudgement => {
  if (a.ref.part === b.ref.part && a.ref.port === b.ref.port) {
    return { legal: false, code: 'wire.same_port', message: 'Both ends of the wire are the same port.' };
  }
  const pair = checkPortPair(a.spec, b.spec);
  if (!pair.legal) return pair;
  if ((pair.kind === 'drive' || pair.kind === 'mount') && a.ref.part === b.ref.part) {
    return { legal: false, code: 'wire.mechanical_same_part', message: 'A mechanical linkage cannot join a part to itself.' };
  }
  if (state.pairs.has(pairKey(a.ref, b.ref))) {
    return { legal: false, code: 'wire.duplicate', message: 'These two ports are already joined.' };
  }
  for (const end of [a, b]) {
    const capacity = SOCKET_CAPACITY[socketOf(end.spec)];
    if (capacity !== null && (state.counts.get(portKey(end.ref)) ?? 0) >= capacity) {
      return {
        legal: false,
        code: 'wire.port_full',
        message: `Port '${end.ref.port}' on '${end.ref.part}' already has ${capacity === 1 ? 'its wire' : `${capacity} wires`}.`,
      };
    }
  }
  const [source, sink] = pair.swap ? [b, a] : [a, b];
  const [from, to] = pair.kind === 'power' && comparePortRefs(source.ref, sink.ref) > 0 ? [sink.ref, source.ref] : [source.ref, sink.ref];
  if (pair.kind === 'mount' && mountedOn(state, to.part, from.part)) {
    return { legal: false, code: 'mount.cycle', message: `'${to.part}' is already mounted, directly or through other parts, on '${from.part}'.` };
  }
  return { legal: true, kind: pair.kind, from, to };
};

/** Records a legal wire on the board. */
export const addWire = (state: WiringState, wire: { readonly kind: WireKind; readonly from: PortRef; readonly to: PortRef }): void => {
  for (const ref of [wire.from, wire.to]) state.counts.set(portKey(ref), (state.counts.get(portKey(ref)) ?? 0) + 1);
  state.pairs.add(pairKey(wire.from, wire.to));
  if (wire.kind === 'mount') {
    const hosts = state.hosts.get(wire.from.part) ?? new Set<string>();
    hosts.add(wire.to.part);
    state.hosts.set(wire.from.part, hosts);
  }
};

export type ResolvedPort =
  | ({ readonly found: true } & PortEnd)
  | { readonly found: false; readonly code: IssueCode; readonly message: string };

/** Finds a placed part's port spec through the catalogue. `parts` maps placed-part ids to parts. */
export const resolvePort = (parts: ReadonlyMap<string, PlacedPart>, catalogue: Catalogue, ref: PortRef): ResolvedPort => {
  const placed = parts.get(ref.part);
  if (!placed) return { found: false, code: 'ref.unknown_placed_part', message: `No placed part has the id '${ref.part}'.` };
  const record = catalogue.parts.get(placed.part);
  if (!record) return { found: false, code: 'ref.unknown_part_type', message: `No part record has the id '${placed.part}'.` };
  const spec = record.ports.find((port) => port.id === ref.port);
  if (!spec) return { found: false, code: 'ref.unknown_port', message: `The ${record.identity.name} has no port '${ref.port}'.` };
  return { found: true, ref, spec };
};

/** Placed parts by id; the first part with an id wins. */
export const indexPlacedParts = (parts: readonly PlacedPart[]): ReadonlyMap<string, PlacedPart> => {
  const map = new Map<string, PlacedPart>();
  for (const part of parts) if (!map.has(part.id)) map.set(part.id, part);
  return map;
};

export type WirePlan =
  | { readonly legal: true; readonly kind: WireKind; readonly from: PortRef; readonly to: PortRef }
  | { readonly legal: false; readonly code: IssueCode; readonly message: string };

/**
 * Whether a new wire between ports `a` and `b` may join a valid blueprint, given every wire already in
 * it, and the wire in stored orientation when it may. The canvas calls this on drop and the list view
 * on its "wire" action, so both produce the same wire.
 */
export const planWire = (blueprint: Blueprint, catalogue: Catalogue, a: PortRef, b: PortRef): WirePlan => {
  const parts = indexPlacedParts(blueprint.parts);
  const first = resolvePort(parts, catalogue, a);
  if (!first.found) return { legal: false, code: first.code, message: first.message };
  const second = resolvePort(parts, catalogue, b);
  if (!second.found) return { legal: false, code: second.code, message: second.message };
  const state = emptyWiring();
  for (const wire of blueprint.wires) {
    const from = resolvePort(parts, catalogue, wire.from);
    const to = resolvePort(parts, catalogue, wire.to);
    if (!from.found || !to.found) continue;
    const judgement = judgeWire(state, from, to);
    if (judgement.legal) addWire(state, judgement);
  }
  return judgeWire(state, first, second);
};

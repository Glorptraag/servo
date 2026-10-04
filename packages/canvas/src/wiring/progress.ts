// The handle's `wire` event (task 7.8): one wire on its way at a time, whichever path began it. Wiring on the canvas
// (drag, tap-then-tap) and the list view each report their own; the latest one still on its way is the one shown.
import type { PortRef } from '@servo/schema';
import type { WireEvent, WireInProgress } from '../interface.ts';
import type { Socket } from './rules.ts';

export type WireSource = 'canvas' | 'list';

const keyOf = (ref: PortRef): string => `${ref.part}.${ref.port}`;

/** The ports a wire can go to, sorted by `part.port` as text. */
export const towardsOf = (ports: readonly PortRef[]): readonly PortRef[] =>
  ports.map((ref) => ({ part: ref.part, port: ref.port })).sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));

/** The legal sockets among `sockets`, as ports a wire can go to. */
export const legalTowards = (sockets: readonly Socket[]): readonly PortRef[] => towardsOf(sockets.filter((socket) => socket.legal).map((socket) => socket.port.ref));

/** Whether two reports name the same wire: its path and its source. */
export const sameWire = (a: WireInProgress | null, b: WireInProgress | null): boolean =>
  a === b || (a !== null && b !== null && a.path === b.path && keyOf(a.from) === keyOf(b.from));

export class WireProgress {
  private readonly emit: (event: WireEvent) => void;
  /** In the order they began: the last is shown. */
  private readonly sources = new Map<WireSource, WireInProgress>();
  private shown: WireInProgress | null = null;

  constructor(emit: (event: WireEvent) => void) {
    this.emit = emit;
  }

  get current(): WireInProgress | null {
    return this.shown;
  }

  report(source: WireSource, wire: WireInProgress | null): void {
    if (sameWire(this.sources.get(source) ?? null, wire)) return;
    this.sources.delete(source);
    if (wire) this.sources.set(source, wire);
    const next = [...this.sources.values()].at(-1) ?? null;
    if (next === this.shown) return;
    this.shown = next;
    this.emit({ wire: next });
  }
}

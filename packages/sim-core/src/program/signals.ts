import type { PlacedPartId, PortId, WireId } from '@servo/schema';
import { clean, signalLevel } from '../behaviour/primitives.ts';
import type { SimGraph } from '../graph/index.ts';
import type { RoutedSignals, SignalLevels } from './types.ts';

/** A record's own level for a port, never one it inherits: `constructor` is a valid port id. */
export const levelOf = (levels: Readonly<Record<PortId, number>> | undefined, port: PortId): number | undefined =>
  levels !== undefined && Object.hasOwn(levels, port) ? levels[port] : undefined;

/**
 * The levels on `ports`, in their order, each read as a signal, as the behaviour runtime reads one: clamped to
 * 0–1, and left out (no signal) when it is not a finite number. −0 is written as 0.
 */
export const levelsOn = (ports: readonly PortId[], read: (port: PortId) => number | undefined): Record<PortId, number> => {
  const levels: Record<PortId, number> = {};
  for (const port of ports) {
    const level = signalLevel(read(port));
    if (level !== undefined) levels[port] = clean(level);
  }
  return levels;
};

/** A port as `<placed part> <port>`; ids are slugs, so the space never clashes. */
const keyOf = (part: PlacedPartId, port: PortId): string => `${part} ${port}`;

/**
 * Carries the levels on signal outs along the signal lines, in the same tick: each line from a signal out with a
 * level carries it to the signal in at its other end. A signal out may feed several signal ins, and a signal in
 * takes one line. Levels are read as signals (`levelsOn`). Lines come out in wire id order, and signal ins in part
 * id order, then the record's port order, so the answer never depends on the order levels were given in. Pure.
 */
export const routeSignals = (graph: SimGraph, outs: SignalLevels): RoutedSignals => {
  const lines = new Map<WireId, number>();
  const arriving = new Map<string, number>();
  for (const link of graph.signals) {
    const level = signalLevel(levelOf(outs.get(link.from.part), link.from.port));
    if (level === undefined) continue;
    lines.set(link.wire, clean(level));
    arriving.set(keyOf(link.to.part, link.to.port), clean(level));
  }
  const signals = new Map<PlacedPartId, Readonly<Record<PortId, number>>>();
  if (arriving.size === 0) return { signals, lines };
  for (const part of graph.parts.values()) {
    const levels = levelsOn([...part.ports.keys()], (port) => arriving.get(keyOf(part.id, port)));
    if (Object.keys(levels).length > 0) signals.set(part.id, levels);
  }
  return { signals, lines };
};

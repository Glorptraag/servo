import type { PlacedPartId, PortId, WireId } from '@servo/schema';
import type { Solved } from './circuit.ts';
import type { Model, Situation } from './model.ts';
import type { PartFlow, PortFlow } from './types.ts';

/** What flows through the switches and along the power lines, and every part's readouts. */
export interface Flows {
  /** Per net, its volts (its node's). */
  readonly netVolts: readonly number[];
  /** Per switch, amps from its first terminal to its second. */
  readonly switchAmps: Float64Array;
  /** Per port, amps from its net into its part, through elements and switches alike. */
  readonly portAmps: Float64Array;
  readonly wires: ReadonlyMap<WireId, number>;
  readonly parts: ReadonlyMap<PlacedPartId, PartFlow>;
}

const MILLI = 1000;
/**
 * Currents under 0.1 µA read 0. Leak currents (LEAK_SIEMENS × a few volts, nanoamps) and rounding stay below
 * it; the smallest current a part here draws to any effect (an LED just past onVolts) is far above it.
 */
export const NOISE_MILLIAMPS = 1e-4;

/** Milliamps as reported: −0, leak currents and rounding noise read 0. */
export const milliamps = (amps: number): number => {
  const value = amps * MILLI;
  return value < NOISE_MILLIAMPS && value > -NOISE_MILLIAMPS ? 0 : value;
};

type Edge = readonly [number, number];

/**
 * A spanning forest, by breadth-first search from each tree's lowest vertex, taking edges in list order: for
 * every vertex, the edge to its parent (−1 at a root), and the vertices in visiting order.
 */
interface Forest {
  readonly edges: readonly Edge[];
  readonly parent: Int32Array;
  readonly order: readonly number[];
}

const forestOf = (count: number, edges: readonly Edge[], roots: Iterable<number>): Forest => {
  const adjacency: number[][] = Array.from({ length: count }, () => []);
  edges.forEach(([a, b], index) => {
    if (a === b) return;
    adjacency[a]?.push(index);
    adjacency[b]?.push(index);
  });
  const parent = new Int32Array(count).fill(-1);
  const seen = new Uint8Array(count);
  const order: number[] = [];
  for (const root of roots) {
    if ((seen[root] as number) === 1) continue;
    seen[root] = 1;
    const queue = [root];
    for (let head = 0; head < queue.length; head += 1) {
      const vertex = (queue[head] as number);
      order.push(vertex);
      for (const index of adjacency[vertex] ?? []) {
        const [a, b] = edges[index] as Edge;
        const other = a === vertex ? b : a;
        if ((seen[other] as number) === 1) continue;
        seen[other] = 1;
        parent[other] = index;
        queue.push(other);
      }
    }
  }
  return { edges, parent, order };
};

/**
 * Pushes each subtree's draw up its tree: the edge from a vertex to its parent carries everything the
 * vertices below it draw. `draw` is changed in place. Per edge, the amps from its first end to its second:
 * 0 for an edge left out of the forest, as ideal joins in a ring share nothing, so the first carries it all.
 */
const treeFlows = (forest: Forest, draw: Float64Array): Float64Array => {
  const amps = new Float64Array(forest.edges.length);
  for (let index = forest.order.length - 1; index >= 0; index -= 1) {
    const vertex = (forest.order[index] as number);
    const edge = (forest.parent[vertex] as number);
    if (edge < 0) continue;
    const [a, b] = forest.edges[edge] as Edge;
    const above = a === vertex ? b : a;
    amps[edge] = b === vertex ? (draw[vertex] as number) : -(draw[vertex] as number);
    draw[above] = (draw[above] as number) + (draw[vertex] as number);
  }
  return amps;
};

/** Per part, its power ports, and what its readouts are read from: a battery, a supply, a switch, or nothing. */
interface Reading {
  readonly id: PlacedPartId;
  readonly ports: readonly (readonly [PortId, number])[];
  readonly from: { readonly kind: 'source' | 'use' | 'switch'; readonly index: number } | undefined;
}

interface Static {
  /** Within each net, the power lines from the net's first port. */
  readonly lines: Forest;
  readonly readings: readonly Reading[];
}

const statics = new WeakMap<Model, Static>();
const switchForests = new WeakMap<Situation, Forest>();

const staticOf = (model: Model): Static => {
  const known = statics.get(model);
  if (known) return known;
  const graph = model.graph;
  const lines = model.wires.map((wire): Edge => [wire.from, wire.to]);
  const firstPorts = graph.nets.map((net) => model.portIndex.get(`${net.ports[0]?.part} ${net.ports[0]?.port}`) ?? 0);
  const readings = [...graph.parts.values()].map((part): Reading => {
    const ports = part.record.ports.flatMap((spec): (readonly [PortId, number])[] => {
      const index = model.portIndex.get(`${part.id} ${spec.id}`);
      return index === undefined ? [] : [[spec.id, index]];
    });
    let from: Reading['from'];
    for (const bound of part.primitives) {
      if (bound.source !== undefined && bound.spec.kind === 'source') from = { kind: 'source', index: bound.source };
      else if (bound.use !== undefined) from = { kind: 'use', index: bound.use };
      else if (bound.switch !== undefined) from = { kind: 'switch', index: bound.switch };
      if (from) break;
    }
    return { id: part.id, ports, from };
  });
  const made = { lines: forestOf(model.portCount, lines, firstPorts), readings };
  statics.set(model, made);
  return made;
};

/**
 * Currents through the closed switches (within each node, between the nets it joins) and along the power
 * lines (within each net, between its ports), then each part's readouts. The actual situation only: its
 * nets are the graph's.
 */
export const flowsOf = (model: Model, situation: Situation, solved: Solved, charge: readonly number[]): Flows => {
  const graph = model.graph;
  const nets = graph.nets.length;
  const { lines, readings } = staticOf(model);
  const netVolts = graph.nets.map((_, net) => solved.volts[situation.live.nodes[net] as number] as number);
  const portAmps = Float64Array.from(solved.portAmps);

  // Switches: each net draws what its ports draw, and closed switches carry it between the nets of a node.
  const netDraw = new Float64Array(nets);
  for (let port = 0; port < model.portCount; port += 1) netDraw[model.portNet[port] as number] = (netDraw[model.portNet[port] as number] as number) + (portAmps[port] as number);
  let switches = switchForests.get(situation);
  if (!switches) {
    const closed = graph.switches.map((join): Edge => (situation.on[join.control] === true ? [join.a, join.b] : [join.a, join.a]));
    switches = forestOf(nets, closed, graph.nets.keys());
    switchForests.set(situation, switches);
  }
  const switchAmps = treeFlows(switches, netDraw);
  model.switches.forEach((join, index) => {
    portAmps[join.a] = (portAmps[join.a] as number) + (switchAmps[index] as number);
    portAmps[join.b] = (portAmps[join.b] as number) - (switchAmps[index] as number);
  });

  // Power lines: within each net, the lines carry each port's draw to it from the net's first port.
  const lineAmps = treeFlows(lines, Float64Array.from(portAmps));
  const wires = new Map<WireId, number>(model.wires.map((wire, index) => [wire.id, milliamps(lineAmps[index] as number)]));

  const across = (pos: number, neg: number): number => (netVolts[model.portNet[pos] as number] as number) - (netVolts[model.portNet[neg] as number] as number);
  const parts = new Map<PlacedPartId, PartFlow>();
  for (const reading of readings) {
    const ports = new Map<PortId, PortFlow>();
    for (const [id, index] of reading.ports) ports.set(id, { volts: netVolts[model.portNet[index] as number] as number, milliamps: milliamps(portAmps[index] as number) });
    const from = reading.from;
    if (from?.kind === 'source') {
      const source = model.sources[from.index];
      if (source) parts.set(reading.id, { volts: across(source.pos, source.neg), milliamps: milliamps(solved.sourceAmps[from.index] as number), charge: charge[from.index] as number, ports });
    } else if (from?.kind === 'use') {
      const use = model.uses[from.index];
      if (use) parts.set(reading.id, { volts: across(use.pos, use.neg), milliamps: milliamps(portAmps[use.pos] as number), ports });
    } else if (from?.kind === 'switch') {
      const join = model.switches[from.index];
      if (join) parts.set(reading.id, { volts: across(join.a, join.b), milliamps: milliamps(switchAmps[from.index] as number), ports });
    }
    if (!parts.has(reading.id)) parts.set(reading.id, { ports });
  }
  return { netVolts, switchAmps, portAmps, wires, parts };
};

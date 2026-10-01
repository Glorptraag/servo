import type { Control, ControlState, PlacedPartId } from '@servo/schema';
import { blocksOf, cycleMates, groupsOf } from './topology.ts';
import type { Edge } from './topology.ts';
import type { LiveState, NetPair, PowerSource, PowerSwitch, PowerUse, SimGraph } from './types.ts';

/**
 * With at most this many controls (64 settings), the graph holds the live state for every setting of
 * them, so a tick only looks its state up. A Level 1–2 kit has at most four: a switch, a bumper switch and
 * a motor driver's two channels. Above it, `liveAt` works each state out when asked.
 */
export const LIVE_TABLE_CONTROLS = 6;

/** The parts of a graph the live state is worked out from. */
export interface Wiring {
  readonly nets: readonly unknown[];
  readonly sources: readonly PowerSource[];
  readonly switches: readonly PowerSwitch[];
  readonly uses: readonly PowerUse[];
}

const at = (list: readonly number[], index: number): number => list[index] as number;

/**
 * Whether each control is on at this state: a switch closed, or a driver channel not at stop (its
 * command is not 0). A control left out of the state sits at rest. The same reading as the schema's
 * `wiredNeeds`.
 */
export const controlsOn = (controls: readonly Control[], state: ControlState): boolean[] =>
  controls.map((control) =>
    control.kind === 'switch' ? (state.switches?.[control.id] ?? control.rest) === true : (state.channels?.[control.id] ?? control.rest) !== 0,
  );

/** The edges of what conducts: every use, and every source giving power, with whether each is a source. */
const conductingEdges = (
  wiring: Wiring,
  giving: readonly boolean[],
  nodes: readonly number[],
  except?: PlacedPartId,
): { readonly edges: Edge[]; readonly isSource: boolean[] } => {
  const edges: Edge[] = [];
  const isSource: boolean[] = [];
  for (const use of wiring.uses) {
    if (use.part === except) continue;
    edges.push([at(nodes, use.pos), at(nodes, use.neg)]);
    isSource.push(false);
  }
  wiring.sources.forEach((source, index) => {
    if (source.part === except || giving[index] !== true) return;
    edges.push([at(nodes, source.pos), at(nodes, source.neg)]);
    isSource.push(true);
  });
  return { edges, isSource };
};

/** Whether a closed path through a source giving power, outside the part, joins the feeder's two nets. */
const closesThroughSource = (wiring: Wiring, giving: readonly boolean[], nodes: readonly number[], part: PlacedPartId, feeder: NetPair): boolean => {
  const from = at(nodes, feeder.pos);
  const to = at(nodes, feeder.neg);
  if (from === to) return false;
  const { edges, isSource } = conductingEdges(wiring, giving, nodes, part);
  const mates = cycleMates(edges, from, to);
  return isSource.some((source, index) => source && mates(index));
};

/** Live nets: a closed path through a source giving power runs through them. A source shorted outright closes its own. */
const liveNets = (wiring: Wiring, giving: readonly boolean[], nodes: readonly number[]): boolean[] => {
  const { edges, isSource } = conductingEdges(wiring, giving, nodes);
  const block = blocksOf(edges);
  const sizes = new Map<number, number>();
  const sourced = new Set<number>();
  block.forEach((id, index) => {
    if (id === -1) return;
    sizes.set(id, (sizes.get(id) ?? 0) + 1);
    if (isSource[index] === true) sourced.add(id);
  });
  const live = nodes.map(() => false);
  edges.forEach(([a, b], index) => {
    const id = at(block, index);
    if (id === -1) {
      if (isSource[index] === true) live[a] = true;
      return;
    }
    // A block of two or more edges holds a closed path through every edge in it, and so through every node.
    if (sourced.has(id) && (sizes.get(id) ?? 0) >= 2) {
      live[a] = true;
      live[b] = true;
    }
  });
  return nodes.map((node) => live[node] === true);
};

/**
 * The live state with each control on or off (`on`, in control order). Closed switches join nets. A
 * battery always gives power; an output gives power once its supply closes through a source giving power
 * outside its own part, and a driver channel at stop gives none: the schema's rule for powering through a
 * motor driver or regulator, grown until nothing changes, which gives the same answer in any order.
 */
export const liveState = (wiring: Wiring, on: readonly boolean[]): LiveState => {
  const count = wiring.nets.length;
  const closed = wiring.switches.filter((join) => on[join.control] === true);
  const nodes = groupsOf(
    count,
    closed.map((join): Edge => [join.a, join.b]),
  );
  // The nets as a part sees them: every closed switch joined except its own (the schema's `nets(part)`).
  const views = new Map<PlacedPartId, number[]>();
  const viewOf = (part: PlacedPartId): readonly number[] => {
    if (!closed.some((join) => join.part === part)) return nodes;
    const known = views.get(part);
    if (known) return known;
    const view = groupsOf(
      count,
      closed.filter((join) => join.part !== part).map((join): Edge => [join.a, join.b]),
    );
    views.set(part, view);
    return view;
  };
  const giving = wiring.sources.map((source) => source.feeder === undefined);
  for (let grew = true; grew; ) {
    grew = false;
    wiring.sources.forEach((source, index) => {
      if (!source.feeder || giving[index] === true) return;
      if (source.control !== undefined && on[source.control] !== true) return;
      if (!closesThroughSource(wiring, giving, viewOf(source.part), source.part, source.feeder)) return;
      giving[index] = true;
      grew = true;
    });
  }
  return { nodes, sources: giving, nets: liveNets(wiring, giving, nodes) };
};

/** The live state for every control key, or undefined above LIVE_TABLE_CONTROLS controls. */
export const liveTableOf = (wiring: Wiring, controls: number): readonly LiveState[] | undefined => {
  if (controls > LIVE_TABLE_CONTROLS) return undefined;
  return Array.from({ length: 1 << controls }, (_, key) =>
    liveState(
      wiring,
      Array.from({ length: controls }, (_, index) => (key & (1 << index)) !== 0),
    ),
  );
};

/**
 * The power graph at a control state: which nets closed switches join, which sources give power and which
 * nets are live. Pure: the same graph and state always give the same answer. Kit-sized builds look it up
 * in `liveTable`; larger ones work it out here, so a caller that ticks can keep the answer until a control
 * changes.
 */
export const liveAt = (graph: SimGraph, state: ControlState = {}): LiveState => {
  const on = controlsOn(graph.controls, state);
  if (!graph.liveTable) return liveState(graph, on);
  let key = 0;
  on.forEach((flag, index) => {
    if (flag) key |= 1 << index;
  });
  return graph.liveTable[key] as LiveState;
};

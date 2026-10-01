import { wiredNeeds } from '@servo/schema';
import type { ControlState, PlacedPartId, WiredVerdict } from '@servo/schema';
import { liveAt } from '../graph/index.ts';
import type { LiveNets } from '../graph/index.ts';
import { liveFor } from '../graph/live.ts';
import type { Wiring } from '../graph/live.ts';
import { blocksOf, cycleMates, groupsOf } from '../graph/topology.ts';
import type { Edge } from '../graph/topology.ts';
import { at, compareText } from './model.ts';
import type { Model, Situation } from './model.ts';

/** A control state with every control written out, and the key the solver's caches use for it. */
export interface Settled {
  readonly key: string;
  readonly state: ControlState;
  readonly command: readonly number[];
  readonly on: readonly boolean[];
}

/**
 * Reads a control state the way the schema and the graph do (a control left out sits at rest; a switch is
 * closed only when its value is `true`), and writes every control out. A channel's command is clamped to
 * −1..1; NaN, or anything that is not a number, reads as stop, and −0 as 0.
 */
export const settle = (model: Model, state: ControlState = {}): Settled => {
  const switches: Record<string, boolean> = {};
  const channels: Record<string, number> = {};
  const command: number[] = [];
  const on: boolean[] = [];
  const words: string[] = [];
  for (const control of model.graph.controls) {
    if (control.kind === 'switch') {
      const closed = (state.switches?.[control.id] ?? control.rest) === true;
      switches[control.id] = closed;
      command.push(closed ? 1 : 0);
      on.push(closed);
      words.push(closed ? 'closed' : 'open');
    } else {
      const raw: unknown = state.channels?.[control.id] ?? control.rest;
      const clamped = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(-1, raw)) : 0;
      const value = clamped === 0 ? 0 : clamped;
      channels[control.id] = value;
      command.push(value);
      on.push(value !== 0);
      words.push(String(value));
    }
  }
  return { key: words.join(','), state: { switches, channels }, command, on };
};

/** Two-terminal pairs that tie nodes into one circuit: every source's output (and an output's supply) and every use's supply. */
const pairsOf = (model: Model, node: (port: number) => number): Edge[] => {
  const pairs: Edge[] = [];
  for (const source of model.sources) {
    pairs.push([node(source.pos), node(source.neg)]);
    if (source.feederPos >= 0) pairs.push([node(source.feederPos), node(source.feederNeg)]);
  }
  for (const use of model.uses) pairs.push([node(use.pos), node(use.neg)]);
  return pairs;
};

const buildSituation = (model: Model, settled: Settled, key: string, on: readonly boolean[], wiring: Wiring, netOfPort: Int32Array, live: LiveNets): Situation => {
  const count = wiring.nets.length;
  const node = (port: number): number => at(live.nodes, at(netOfPort, port));
  // A circuit is the nodes its parts' own terminals tie together. Its reference node is the − of its first
  // source in graph order, or its lowest node.
  const group = groupsOf(count, pairsOf(model, node));
  const reference = new Int32Array(count).fill(-1);
  for (const source of model.sources) {
    const minus = node(source.neg);
    if (at(reference, at(group, minus)) === -1) reference[at(group, minus)] = minus;
  }
  const unknownOf = new Int32Array(count).fill(-1);
  let unknowns = 0;
  for (let net = 0; net < count; net += 1) {
    if (at(live.nodes, net) !== net) continue;
    const circuit = at(group, net);
    if (at(reference, circuit) === -1) reference[circuit] = net;
    if (at(reference, circuit) === net) continue;
    unknownOf[net] = unknowns;
    unknowns += 1;
  }
  return { key, state: settled.state, command: settled.command, on, wiring, netOfPort, live, unknownOf, unknowns, views: new Map(), scratch: undefined };
};

type LiveNodes = { readonly nodes: readonly number[] };

/** The circuit at a settled control state, from the graph's live table. Cached by its key: it depends on nothing else. */
export const situationOf = (model: Model, settled: Settled): Situation => {
  const known = model.situations.get(settled.key);
  if (known) return known;
  const live = liveAt(model.graph, settled.state);
  const situation = buildSituation(model, settled, settled.key, settled.on, model.graph, model.portNet, live);
  model.situations.set(settled.key, situation);
  return situation;
};

/** The schema's verdicts on the wiring at a situation's controls. Cached by its key: the control search runs once per control state (review N14). */
export const wiredAt = (model: Model, situation: Situation): readonly WiredVerdict[] => {
  const known = model.wired.get(situation.key);
  if (known) return known;
  const verdicts = wiredNeeds(model.graph.blueprint, model.graph.catalogue, situation.state);
  model.wired.set(situation.key, verdicts);
  return verdicts;
};

export const nodeOf = (situation: Situation, port: number): number => at(situation.live.nodes, at(situation.netOfPort, port));

/** Nets as a part sees them: every closed switch joined except its own. The situation's own nodes for a part with no closed switch. */
const viewOf = (situation: Situation, part: PlacedPartId): LiveNodes => {
  const closed = situation.wiring.switches.filter((join) => situation.on[join.control] === true);
  if (!closed.some((join) => join.part === part)) return situation.live;
  const known = situation.views.get(part);
  if (known) return { nodes: known };
  const nodes = groupsOf(
    situation.wiring.nets.length,
    closed.filter((join) => join.part !== part).map((join): Edge => [join.a, join.b]),
  );
  situation.views.set(part, nodes);
  return { nodes };
};

/**
 * Whether a closed path through a source giving power, outside the part, joins its supply's two ports: the
 * schema's power need as the wiring decides it (`wiredNeeds`' `open`), at any situation, healed or not.
 */
export const powerClosed = (situation: Situation, part: PlacedPartId, pos: number, neg: number): boolean => {
  const { nodes } = viewOf(situation, part);
  const node = (net: number): number => at(nodes, net);
  const from = node(at(situation.netOfPort, pos));
  const to = node(at(situation.netOfPort, neg));
  if (from === to) return false;
  const edges: Edge[] = [];
  const through: boolean[] = [];
  for (const use of situation.wiring.uses) {
    if (use.part === part) continue;
    edges.push([node(use.pos), node(use.neg)]);
    through.push(false);
  }
  situation.wiring.sources.forEach((source, index) => {
    if (source.part === part || situation.live.sources[index] !== true) return;
    edges.push([node(source.pos), node(source.neg)]);
    through.push(true);
  });
  const mates = cycleMates(edges, from, to);
  return through.some((source, index) => source && mates(index));
};

/**
 * The first output, in graph order, whose part has no power and through which a closed path outside the part
 * joins its supply's ports (the schema's feeder step, `feederOf`): along anything but switches.
 */
export const feederOf = (situation: Situation, part: PlacedPartId, pos: number, neg: number, unpowered: ReadonlySet<PlacedPartId>): PlacedPartId | undefined => {
  const { nodes } = viewOf(situation, part);
  const node = (net: number): number => at(nodes, net);
  const from = node(at(situation.netOfPort, pos));
  const to = node(at(situation.netOfPort, neg));
  if (from === to) return undefined;
  const edges: Edge[] = [];
  const feeders: (PlacedPartId | undefined)[] = [];
  for (const use of situation.wiring.uses) {
    if (use.part === part) continue;
    edges.push([node(use.pos), node(use.neg)]);
    feeders.push(undefined);
  }
  for (const source of situation.wiring.sources) {
    if (source.part === part) continue;
    edges.push([node(source.pos), node(source.neg)]);
    feeders.push(source.feeder !== undefined && unpowered.has(source.part) ? source.part : undefined);
  }
  const mates = cycleMates(edges, from, to);
  return feeders.find((feeder, index) => feeder !== undefined && mates(index));
};

/**
 * The shorted parts that stand for a need: those in the same circuit (joined by wires, closed switches and any
 * part's own terminals) as the need's supply, or every shorted part when none is (the schema's rule).
 */
export const nearShorts = (model: Model, situation: Situation, pos: number, shorted: ReadonlyMap<PlacedPartId, number>): PlacedPartId[] => {
  const group = groupsOf(situation.wiring.nets.length, pairsOf(model, (port) => nodeOf(situation, port)));
  const circuit = at(group, nodeOf(situation, pos));
  const near = [...shorted].filter(([, port]) => at(group, nodeOf(situation, port)) === circuit).map(([part]) => part);
  return [...new Set(near.length > 0 ? near : [...shorted.keys()])].sort(compareText);
};

/**
 * The circuit with each short circuit's wires and closed switches taken away (the schema's short step,
 * extended to loops made only of sources, review N10). Over power ports: the power lines, the closed
 * switches, and the outputs of the shorted parts that give power. Every line or switch that shares a block
 * (biconnected component) with a shorted part's source or switch is on a short, and goes. Undefined when
 * nothing goes. Cached by the situation's key: the shorted parts follow from the controls.
 */
export const healedOf = (model: Model, situation: Situation, shorted: ReadonlySet<PlacedPartId>): Situation | undefined => {
  const known = model.healed.get(situation.key);
  if (known !== undefined) return known ?? undefined;
  const edges: Edge[] = [];
  const kinds: ('wire' | 'switch' | 'short')[] = [];
  const refs: number[] = [];
  model.wires.forEach((wire, index) => {
    edges.push([wire.from, wire.to]);
    kinds.push('wire');
    refs.push(index);
  });
  model.switches.forEach((join, index) => {
    if (situation.on[join.control] !== true) return;
    edges.push([join.a, join.b]);
    kinds.push(shorted.has(join.part) ? 'short' : 'switch');
    refs.push(index);
  });
  model.sources.forEach((source, index) => {
    if (!shorted.has(source.part) || situation.live.sources[index] !== true) return;
    edges.push([source.pos, source.neg]);
    kinds.push('short');
    refs.push(-1);
  });
  const block = blocksOf(edges);
  const marked = new Set<number>();
  kinds.forEach((kind, index) => {
    if (kind === 'short' && at(block, index) !== -1) marked.add(at(block, index));
  });
  const wiresGone = new Set<number>();
  const switchesGone = new Set<number>();
  kinds.forEach((kind, index) => {
    if (!marked.has(at(block, index))) return;
    if (kind === 'wire') wiresGone.add(at(refs, index));
    else if (refs[index] !== -1) switchesGone.add(at(refs, index));
  });
  if (wiresGone.size === 0 && switchesGone.size === 0) {
    model.healed.set(situation.key, null);
    return undefined;
  }

  // Healed nets: ports joined by the power lines that stay, numbered by their lowest port.
  const groups = groupsOf(
    model.portCount,
    model.wires.filter((_, index) => !wiresGone.has(index)).map((wire): Edge => [wire.from, wire.to]),
  );
  const netOfGroup = new Map<number, number>();
  const netOfPort = new Int32Array(model.portCount);
  for (let port = 0; port < model.portCount; port += 1) {
    const root = at(groups, port);
    let net = netOfGroup.get(root);
    if (net === undefined) {
      net = netOfGroup.size;
      netOfGroup.set(root, net);
    }
    netOfPort[port] = net;
  }
  const pair = (pos: number, neg: number) => ({ pos: at(netOfPort, pos), neg: at(netOfPort, neg) });
  const graph = model.graph;
  const wiring: Wiring = {
    nets: Array.from({ length: netOfGroup.size }, () => null),
    sources: graph.sources.map((source, index) => {
      const info = model.sources[index];
      if (!info) return source;
      return { ...source, ...pair(info.pos, info.neg), ...(info.feederPos >= 0 ? { feeder: pair(info.feederPos, info.feederNeg) } : {}) };
    }),
    switches: graph.switches.map((join, index) => {
      const info = model.switches[index];
      return info ? { ...join, a: at(netOfPort, info.a), b: at(netOfPort, info.b) } : join;
    }),
    uses: graph.uses.map((use, index) => {
      const info = model.uses[index];
      return info ? { ...use, ...pair(info.pos, info.neg) } : use;
    }),
  };
  const opened = new Set([...switchesGone].map((index) => model.switches[index]?.control));
  const on = situation.on.map((flag, control) => flag && !opened.has(control));
  const settled: Settled = { key: situation.key, state: situation.state, command: situation.command, on };
  const healed = buildSituation(model, settled, `${situation.key}|healed`, on, wiring, netOfPort, liveFor(wiring, on));
  model.healed.set(situation.key, healed);
  return healed;
};

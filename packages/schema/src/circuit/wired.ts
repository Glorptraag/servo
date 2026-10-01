import type { Primitive } from '../types/behaviour.ts';
import type { Blueprint } from '../types/blueprint.ts';
import type { NeedId, PlacedPartId } from '../types/common.ts';
import type { Need, PartRecord } from '../types/part.ts';
import type { Catalogue } from '../validate/catalogue.ts';
import { compareText } from '../validate/reader.ts';
import { checkPortPair, indexPlacedParts, resolvePort } from '../validate/wiring.ts';

/**
 * What the wiring alone says about a power, loop or isolation need, judged as wired: every switch counted
 * closed and every motor-driver channel at full forward command. sim-core judges `low`, `high` and
 * `reversed` on the voltages of the same as-wired circuit. See docs/parts.md.
 */
export interface WiredVerdict {
  readonly partId: PlacedPartId;
  readonly need: NeedId;
  readonly kind: 'power' | 'loop' | 'isolation';
  /** How the wiring leaves the need unmet: power and loop `open`, isolation `shorted`. Absent when it is met. */
  readonly unmet?: 'open' | 'shorted';
  /**
   * For a power need whose only closed paths run through the output of a motor driver or regulator that has
   * no power: that part's own power fault stands for this one, so this part shows no fault of its own.
   */
  readonly explainedBy?: PlacedPartId;
}

/** A port as `<placed part> <port>`; ids are slugs, so the space never clashes. */
type Net = string;

interface Edge {
  readonly a: Net;
  readonly b: Net;
}

interface Branch extends Edge {
  readonly part: PlacedPartId;
  /** A source gives power, a use takes it, and a switch joins its terminals (always counted closed). */
  readonly kind: 'source' | 'use' | 'switch';
  /** For a driver channel's or regulator's output: the supply that must have power for it to give any. */
  readonly feeder?: Edge;
}

const portKey = (part: PlacedPartId, port: string): Net => `${part} ${port}`;

const branchesOf = (part: PlacedPartId, primitive: Primitive): Branch[] => {
  const pair = (pos: string, neg: string): Edge => ({ a: portKey(part, pos), b: portKey(part, neg) });
  switch (primitive.kind) {
    case 'source':
      return [{ part, ...pair(primitive.output.pos, primitive.output.neg), kind: 'source' }];
    case 'switch':
      return [{ part, ...pair(primitive.terminals[0], primitive.terminals[1]), kind: 'switch' }];
    case 'load':
    case 'actuator':
    case 'program':
      return [{ part, ...pair(primitive.supply.pos, primitive.supply.neg), kind: 'use' }];
    case 'driver':
    case 'regulator': {
      const supply = pair(primitive.supply.pos, primitive.supply.neg);
      return [
        { part, ...supply, kind: 'use' },
        { part, ...pair(primitive.output.pos, primitive.output.neg), kind: 'source', feeder: supply },
      ];
    }
    default:
      return [];
  }
};

const sameEnds = (edge: Edge, x: Net, y: Net): boolean => (edge.a === x && edge.b === y) || (edge.a === y && edge.b === x);

/** Union-find over ports. Each net is named by its lowest port key, so the nets are the same for any wire order. */
const netsOf = (joins: readonly Edge[]): ((key: Net) => Net) => {
  const parent = new Map<Net, Net>();
  const find = (key: Net): Net => {
    let root = key;
    let next = parent.get(root);
    while (next !== undefined) {
      root = next;
      next = parent.get(root);
    }
    let step = key;
    let up = parent.get(step);
    while (up !== undefined) {
      parent.set(step, root);
      step = up;
      up = parent.get(step);
    }
    return root;
  };
  for (const join of joins) {
    const ra = find(join.a);
    const rb = find(join.b);
    if (ra === rb) continue;
    if (compareText(ra, rb) < 0) parent.set(rb, ra);
    else parent.set(ra, rb);
  }
  return find;
};

/** Whether a path joins two nets. */
const connected = (edges: readonly Edge[], from: Net, to: Net): boolean => {
  const adjacency = new Map<Net, Net[]>();
  const link = (from: Net, to: Net): void => {
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  };
  for (const edge of edges) {
    link(edge.a, edge.b);
    link(edge.b, edge.a);
  }
  const seen = new Set<Net>([from]);
  const queue: Net[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const net = queue[head] as Net;
    if (net === to) return true;
    for (const next of adjacency.get(net) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
};

interface Frame {
  readonly net: Net;
  readonly via: number;
  next: number;
}

/**
 * The block (biconnected component) of every edge, by index, or −1 for an edge whose two ends are one net.
 * Two edges lie on one simple closed path exactly when they share a block. Iterative, so a long chain of
 * parts cannot overflow the stack.
 */
const blocksOf = (edges: readonly Edge[]): number[] => {
  const block = edges.map(() => -1);
  const adjacency = new Map<Net, number[]>();
  edges.forEach((edge, index) => {
    if (edge.a === edge.b) return;
    for (const end of [edge.a, edge.b]) {
      const list = adjacency.get(end);
      if (list) list.push(index);
      else adjacency.set(end, [index]);
    }
  });
  const order = new Map<Net, number>();
  const low = new Map<Net, number>();
  const stack: number[] = [];
  let blocks = 0;
  for (const start of adjacency.keys()) {
    if (order.has(start)) continue;
    const first = order.size;
    order.set(start, first);
    low.set(start, first);
    const frames: Frame[] = [{ net: start, via: -1, next: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as Frame;
      const list = adjacency.get(frame.net) ?? [];
      if (frame.next < list.length) {
        const index = list[frame.next] as number;
        frame.next += 1;
        if (index === frame.via) continue;
        const edge = edges[index] as Edge;
        const other = edge.a === frame.net ? edge.b : edge.a;
        const seen = order.get(other);
        if (seen === undefined) {
          const rank = order.size;
          order.set(other, rank);
          low.set(other, rank);
          stack.push(index);
          frames.push({ net: other, via: index, next: 0 });
        } else if (seen < (order.get(frame.net) as number)) {
          stack.push(index);
          low.set(frame.net, Math.min(low.get(frame.net) as number, seen));
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (!parent) continue;
      const reach = low.get(frame.net) as number;
      low.set(parent.net, Math.min(low.get(parent.net) as number, reach));
      if (reach < (order.get(parent.net) as number)) continue;
      let index = stack.pop();
      while (index !== undefined) {
        block[index] = blocks;
        if (index === frame.via) break;
        index = stack.pop();
      }
      blocks += 1;
    }
  }
  return block;
};

/** Which of `edges` lie on one simple closed path with an extra edge from `from` to `to` (two different nets). */
const cycleMates = (edges: readonly Edge[], from: Net, to: Net): ((index: number) => boolean) => {
  const block = blocksOf([...edges, { a: from, b: to }]);
  const probe = block[edges.length] as number;
  return (index) => block[index] === probe;
};

/**
 * The verdict on every power, loop and isolation need of every placed part, from the wiring alone, in
 * placed-part id order and then the record's need order. For a blueprint that validateBlueprint accepts.
 * Every need is judged on the circuit outside its part:
 * - power `open`: no closed path through a source that has power joins the supply's two ports (a part
 *   bypassed by a wire is open too). When the only closed paths run through the output of a motor driver
 *   or regulator that has no power, the need counts as met and `explainedBy` names that part.
 * - loop `open`: no closed path at all joins the two ports. Unless the part is the source of those ports,
 *   the path runs through a source.
 * - isolation `shorted`: a closed path made only of wires, closed switches and sources that have power
 *   joins the two ports, through a source: a loop with nothing that uses power.
 */
export const wiredNeeds = (blueprint: Blueprint, catalogue: Catalogue): readonly WiredVerdict[] => {
  const placed = indexPlacedParts(blueprint.parts);
  const records = new Map<PlacedPartId, PartRecord>();
  for (const part of placed.values()) {
    const record = catalogue.parts.get(part.part);
    if (record) records.set(part.id, record);
  }
  const ids = [...records.keys()].sort(compareText);
  const owned = new Map<PlacedPartId, Branch[]>();
  for (const id of ids) owned.set(id, (records.get(id) as PartRecord).behaviour.flatMap((primitive) => branchesOf(id, primitive)));
  const branches = ids.flatMap((id) => owned.get(id) ?? []);
  const switches = branches.filter((branch) => branch.kind === 'switch');
  const wires: Edge[] = [];
  for (const wire of blueprint.wires) {
    const a = resolvePort(placed, catalogue, wire.from);
    const b = resolvePort(placed, catalogue, wire.to);
    if (!a.found || !b.found) continue;
    const pair = checkPortPair(a.spec, b.spec);
    if (pair.legal && pair.kind === 'power') wires.push({ a: portKey(a.ref.part, a.ref.port), b: portKey(b.ref.part, b.ref.port) });
  }

  // Nets with every switch closed, except the switches of the part being judged.
  const allClosed = netsOf([...wires, ...switches]);
  const netsWithout = (part: PlacedPartId): ((key: Net) => Net) =>
    (owned.get(part) ?? []).some((branch) => branch.kind === 'switch')
      ? netsOf([...wires, ...switches.filter((branch) => branch.part !== part)])
      : allClosed;
  const others = (part: PlacedPartId, keep: (branch: Branch) => boolean): Branch[] =>
    branches.filter((branch) => branch.kind !== 'switch' && branch.part !== part && keep(branch));
  const placedOn = (find: (key: Net) => Net, list: readonly Branch[]): Edge[] => list.map((branch) => ({ a: find(branch.a), b: find(branch.b) }));

  // A driver channel's or regulator's output has power once its supply has a closed path through a source
  // that has power. Growing the set until nothing changes gives the same answer in any order.
  const live = new Set<Branch>(branches.filter((branch) => branch.kind === 'source' && !branch.feeder));
  const poweredThrough = (part: PlacedPartId, a: Net, b: Net): boolean => {
    const find = netsWithout(part);
    const from = find(a);
    const to = find(b);
    if (from === to) return false;
    const list = others(part, (branch) => branch.kind === 'use' || live.has(branch));
    const mates = cycleMates(placedOn(find, list), from, to);
    return list.some((branch, index) => branch.kind === 'source' && mates(index));
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (const branch of branches) {
      if (!branch.feeder || live.has(branch) || !poweredThrough(branch.part, branch.feeder.a, branch.feeder.b)) continue;
      live.add(branch);
      grew = true;
    }
  }

  // The same questions for the whole build at once, for a part whose one branch is the need's own: the
  // build without that branch, plus a probe between its ends, is the build itself.
  const blockMap = (list: readonly Branch[]): Map<Branch, number> => {
    const block = blocksOf(placedOn(allClosed, list));
    return new Map(list.map((branch, index) => [branch, block[index] as number]));
  };
  const powering = blockMap(branches.filter((branch) => branch.kind === 'use' || live.has(branch)));
  const anyPower = blockMap(branches.filter((branch) => branch.kind !== 'switch'));
  const sourcesOnly = blockMap(branches.filter((branch) => live.has(branch)));
  const blocksWith = (map: ReadonlyMap<Branch, number>, keep: (branch: Branch) => boolean): Map<number, Branch[]> => {
    const found = new Map<number, Branch[]>();
    for (const [branch, block] of map) {
      if (!keep(branch)) continue;
      const list = found.get(block);
      if (list) list.push(branch);
      else found.set(block, [branch]);
    }
    return found;
  };
  const poweredBlocks = blocksWith(powering, (branch) => branch.kind === 'source');
  const deadFeeders = blocksWith(anyPower, (branch) => branch.kind === 'source' && !live.has(branch));
  const sizes = (map: ReadonlyMap<Branch, number>): Map<number, number> => {
    const counted = new Map<number, number>();
    for (const block of map.values()) counted.set(block, (counted.get(block) ?? 0) + 1);
    return counted;
  };
  const anyPowerSizes = sizes(anyPower);
  const sourcesOnlySizes = sizes(sourcesOnly);
  const onCycle = (block: number | undefined, counted: ReadonlyMap<number, number>): boolean =>
    block !== undefined && block !== -1 && (counted.get(block) ?? 0) > 1;

  const power = (part: PlacedPartId, a: Net, b: Net): Pick<WiredVerdict, 'unmet' | 'explainedBy'> => {
    const mine = owned.get(part) ?? [];
    const only = mine.length === 1 && mine[0]?.kind === 'use' && sameEnds(mine[0], a, b) ? mine[0] : undefined;
    if (only) {
      if (allClosed(a) === allClosed(b)) return { unmet: 'open' };
      if (poweredBlocks.has(powering.get(only) ?? -1)) return {};
      const feeder = deadFeeders.get(anyPower.get(only) ?? -1)?.[0];
      return feeder ? { explainedBy: feeder.part } : { unmet: 'open' };
    }
    if (poweredThrough(part, a, b)) return {};
    const find = netsWithout(part);
    const from = find(a);
    const to = find(b);
    if (from === to) return { unmet: 'open' };
    const list = others(part, () => true);
    const mates = cycleMates(placedOn(find, list), from, to);
    const feeder = list.find((branch, index) => branch.kind === 'source' && !live.has(branch) && mates(index));
    return feeder ? { explainedBy: feeder.part } : { unmet: 'open' };
  };

  const loopOrIsolation = (part: PlacedPartId, need: Need & { readonly kind: 'loop' | 'isolation' }): WiredVerdict => {
    const x = portKey(part, need.ports[0]);
    const y = portKey(part, need.ports[1]);
    const mine = owned.get(part) ?? [];
    const own = mine.find((branch) => branch.kind === 'source' && sameEnds(branch, x, y));
    const verdict = (unmet: 'open' | 'shorted' | undefined): WiredVerdict => ({ partId: part, need: need.id, kind: need.kind, ...(unmet ? { unmet } : {}) });
    if (own && mine.length === 1) {
      const together = allClosed(x) === allClosed(y);
      if (need.kind === 'loop') return verdict(together || onCycle(anyPower.get(own), anyPowerSizes) ? undefined : 'open');
      const shorted = live.has(own) && (together || onCycle(sourcesOnly.get(own), sourcesOnlySizes));
      return verdict(shorted ? 'shorted' : undefined);
    }
    const find = netsWithout(part);
    const from = find(x);
    const to = find(y);
    if (need.kind === 'loop') {
      const list = others(part, () => true);
      let closed = false;
      if (own) closed = from === to || connected(placedOn(find, list), from, to);
      else if (from !== to) {
        const mates = cycleMates(placedOn(find, list), from, to);
        closed = list.some((branch, index) => branch.kind === 'source' && mates(index));
      }
      return verdict(closed ? undefined : 'open');
    }
    const sources = placedOn(find, others(part, (branch) => live.has(branch)));
    const shorted = own ? live.has(own) && (from === to || connected(sources, from, to)) : from !== to && connected(sources, from, to);
    return verdict(shorted ? 'shorted' : undefined);
  };

  const verdicts: WiredVerdict[] = [];
  for (const id of ids) {
    for (const need of (records.get(id) as PartRecord).needs) {
      if (need.kind === 'power') {
        verdicts.push({ partId: id, need: need.id, kind: 'power', ...power(id, portKey(id, need.supply.pos), portKey(id, need.supply.neg)) });
      } else if (need.kind === 'loop' || need.kind === 'isolation') {
        verdicts.push(loopOrIsolation(id, need));
      }
    }
  }
  return verdicts;
};

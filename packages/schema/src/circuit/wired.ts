import type { DriverPrimitive, Primitive } from '../types/behaviour.ts';
import type { Blueprint, PlacedPart } from '../types/blueprint.ts';
import type { NeedId, PlacedPartId, PrimitiveId } from '../types/common.ts';
import type { PartRecord } from '../types/part.ts';
import type { Catalogue } from '../validate/catalogue.ts';
import { mapSettingValue } from '../validate/part.ts';
import { compareText } from '../validate/reader.ts';
import { checkPortPair, indexPlacedParts, resolvePort } from '../validate/wiring.ts';

/**
 * A fault is something the child's controls cannot fix. Every power, loop and isolation need is judged on
 * the build as it stands, with each switch and each motor-driver channel at its current setting. An
 * unmet power or loop need is a fault only when no other setting of the controls would meet it and no
 * short circuit or unpowered driver explains it. A short circuit is a fault for as long as it lasts.
 * See docs/parts.md.
 */

/** A switch's position or a motor-driver channel's command, written `<placed part>/<primitive>`. */
export type ControlId = string;

export const controlId = (part: PlacedPartId, primitive: PrimitiveId): ControlId => `${part}/${primitive}`;

export interface Control {
  readonly id: ControlId;
  readonly part: PlacedPartId;
  readonly primitive: PrimitiveId;
  readonly kind: 'switch' | 'channel';
  /** Its setting at rest: a switch's resting position (true when closed), or a channel's command from its setting. */
  readonly rest: boolean | number;
}

/** The controls' settings at one moment. A control left out sits at rest. */
export interface ControlState {
  /** Switch positions by control id, true when closed. A contact switch is given at its current state. */
  readonly switches?: Readonly<Record<ControlId, boolean>>;
  /** Motor-driver channel commands by control id, from −1 (full backward) to 1 (full forward). */
  readonly channels?: Readonly<Record<ControlId, number>>;
}

/** Why an unmet need is not a fault. */
export type Explanation =
  /** Another setting of these controls meets it, so the part just shows the behaviour. */
  | { readonly by: 'controls'; readonly controls: readonly ControlId[] }
  /** A short circuit starves it: these parts' isolation faults stand for it. */
  | { readonly by: 'short'; readonly parts: readonly PlacedPartId[] }
  /** It is fed through this motor driver or regulator, whose own power need is unmet. */
  | { readonly by: 'feeder'; readonly part: PlacedPartId };

export interface WiredVerdict {
  readonly partId: PlacedPartId;
  readonly need: NeedId;
  readonly kind: 'power' | 'loop' | 'isolation';
  /** How the wiring leaves the need unmet at this control state: power and loop `open`, isolation `shorted`. */
  readonly unmet?: 'open' | 'shorted';
  /** Why an unmet need is not a fault. An unmet need without it is a fault; a short never has one. */
  readonly explainedBy?: Explanation;
}

/** With more combinations of control settings than this (2^10), only single-control changes are tried. */
export const CONTROL_COMBINATION_CAP = 1024;

/** Source voltages around a loop cancel when they add up to zero within this many volts. */
const VOLTS_TOLERANCE = 1e-9;

/** A port as `<placed part> <port>`; ids are slugs, so the space never clashes. */
type Net = string;
type Find = (key: Net) => Net;
type Setting = boolean | number;
type Settings = ReadonlyMap<ControlId, Setting>;

interface Edge {
  readonly a: Net;
  readonly b: Net;
}

interface Branch extends Edge {
  readonly part: PlacedPartId;
  /** A source gives power, a use takes it, and a switch joins its terminals while closed. */
  readonly kind: 'source' | 'use' | 'switch';
  /** A battery's volts from − (b) to + (a). Absent on a driver channel's or regulator's output. */
  readonly volts?: number;
  /** For a driver channel's or regulator's output: the supply that must have power for it to give any. */
  readonly feeder?: Edge;
  /** The control it follows: a switch's position, or a channel's command. */
  readonly control?: ControlId;
}

/** A power wire, or a switch's terminals, joined while the switch is closed. */
interface Join extends Edge {
  readonly branch?: Branch;
}

/** An edge for the short-circuit test: a source with its volts (unknown for an output), or a closed switch at 0 V. */
interface Push extends Edge {
  readonly volts: number | undefined;
}

const portKey = (part: PlacedPartId, port: string): Net => `${part} ${port}`;

const sameEnds = (edge: Edge, x: Net, y: Net): boolean => (edge.a === x && edge.b === y) || (edge.a === y && edge.b === x);

const branchesOf = (part: PlacedPartId, primitive: Primitive): Branch[] => {
  const pair = (pos: string, neg: string): Edge => ({ a: portKey(part, pos), b: portKey(part, neg) });
  const control = controlId(part, primitive.id);
  switch (primitive.kind) {
    case 'source':
      return [{ part, ...pair(primitive.output.pos, primitive.output.neg), kind: 'source', volts: primitive.volts }];
    case 'switch':
      return [{ part, ...pair(primitive.terminals[0], primitive.terminals[1]), kind: 'switch', control }];
    case 'load':
    case 'actuator':
    case 'program':
      return [{ part, ...pair(primitive.supply.pos, primitive.supply.neg), kind: 'use' }];
    case 'driver':
    case 'regulator': {
      const supply = pair(primitive.supply.pos, primitive.supply.neg);
      const output: Branch = { part, ...pair(primitive.output.pos, primitive.output.neg), kind: 'source', feeder: supply };
      return [{ part, ...supply, kind: 'use' }, primitive.kind === 'driver' ? { ...output, control } : output];
    }
    default:
      return [];
  }
};

/** A channel's command at rest: its bound setting's value on the placed part, or the primitive's own. */
const restingCommand = (placed: PlacedPart | undefined, record: PartRecord, primitive: DriverPrimitive): number => {
  const setting = record.settings.find((candidate) => candidate.binds.primitive === primitive.id && candidate.binds.param === 'command');
  if (!setting) return primitive.command;
  const value = placed?.settings[setting.id] ?? setting.default;
  if (setting.kind === 'choice') {
    const chosen = setting.options.find((option) => option.id === value)?.value;
    return typeof chosen === 'number' ? chosen : primitive.command;
  }
  return typeof value === 'number' ? mapSettingValue(setting, value) : primitive.command;
};

/** Union-find over ports. Each net is named by its lowest port key, so the nets are the same for any wire order. */
const netsOf = (joins: readonly Edge[]): Find => {
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

const adjacencyOf = (edges: readonly Edge[]): Map<Net, number[]> => {
  const adjacency = new Map<Net, number[]>();
  edges.forEach((edge, index) => {
    if (edge.a === edge.b) return;
    for (const end of [edge.a, edge.b]) {
      const list = adjacency.get(end);
      if (list) list.push(index);
      else adjacency.set(end, [index]);
    }
  });
  return adjacency;
};

/** Whether a path joins two nets. */
const connected = (edges: readonly Edge[], from: Net, to: Net): boolean => {
  const adjacency = adjacencyOf(edges);
  const seen = new Set<Net>([from]);
  const queue: Net[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const net = queue[head] as Net;
    if (net === to) return true;
    for (const index of adjacency.get(net) ?? []) {
      const edge = edges[index] as Edge;
      const next = edge.a === net ? edge.b : edge.a;
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
  const adjacency = adjacencyOf(edges);
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

/** Whether the voltages around every loop of one block add up to zero: each net then has one potential. */
const cancels = (pushes: readonly Push[], members: readonly number[]): boolean => {
  if (members.some((index) => pushes[index]?.volts === undefined)) return false;
  const adjacency = adjacencyOf(members.map((index) => pushes[index] as Push));
  const start = (pushes[members[0] as number] as Push).b;
  const potential = new Map<Net, number>([[start, 0]]);
  const queue: Net[] = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const net = queue[head] as Net;
    for (const local of adjacency.get(net) ?? []) {
      const push = pushes[members[local] as number] as Push;
      const volts = push.volts as number;
      const other = push.a === net ? push.b : push.a;
      const expected = (potential.get(net) as number) + (push.a === net ? -volts : volts);
      const known = potential.get(other);
      if (known === undefined) {
        potential.set(other, expected);
        queue.push(other);
      } else if (Math.abs(known - expected) > VOLTS_TOLERANCE) {
        return false;
      }
    }
  }
  return true;
};

/**
 * The indexes of the pushes on a short circuit: a closed loop of sources and closed switches whose
 * voltages do not cancel. A source whose two ends are one net is shorted outright; a switch so joined
 * carries nothing.
 */
const shortedPushes = (pushes: readonly Push[]): ReadonlySet<number> => {
  const shorted = new Set<number>();
  const block = blocksOf(pushes);
  const members = new Map<number, number[]>();
  pushes.forEach((push, index) => {
    const id = block[index] as number;
    if (id === -1) {
      if (push.volts !== 0) shorted.add(index);
      return;
    }
    const list = members.get(id);
    if (list) list.push(index);
    else members.set(id, [index]);
  });
  for (const list of members.values()) {
    if (list.length > 1 && !cancels(pushes, list)) for (const index of list) shorted.add(index);
  }
  return shorted;
};

interface Circuit {
  readonly ids: readonly PlacedPartId[];
  readonly records: ReadonlyMap<PlacedPartId, PartRecord>;
  readonly owned: ReadonlyMap<PlacedPartId, readonly Branch[]>;
  readonly branches: readonly Branch[];
  readonly wires: readonly Join[];
  readonly switches: readonly Join[];
  readonly controls: readonly Control[];
}

const circuitOf = (blueprint: Blueprint, catalogue: Catalogue): Circuit => {
  const placed = indexPlacedParts(blueprint.parts);
  const records = new Map<PlacedPartId, PartRecord>();
  for (const part of placed.values()) {
    const record = catalogue.parts.get(part.part);
    if (record) records.set(part.id, record);
  }
  const ids = [...records.keys()].sort(compareText);
  const owned = new Map<PlacedPartId, Branch[]>();
  const controls: Control[] = [];
  for (const id of ids) {
    const record = records.get(id) as PartRecord;
    owned.set(id, record.behaviour.flatMap((primitive) => branchesOf(id, primitive)));
    for (const primitive of record.behaviour) {
      const control = { id: controlId(id, primitive.id), part: id, primitive: primitive.id };
      if (primitive.kind === 'switch') {
        const { actuation } = primitive;
        controls.push({ ...control, kind: 'switch', rest: (actuation.kind === 'manual' ? actuation.initially : actuation.normally) === 'closed' });
      } else if (primitive.kind === 'driver') {
        controls.push({ ...control, kind: 'channel', rest: restingCommand(placed.get(id), record, primitive) });
      }
    }
  }
  const branches = ids.flatMap((id) => owned.get(id) ?? []);
  const wires: Join[] = [];
  for (const wire of blueprint.wires) {
    const a = resolvePort(placed, catalogue, wire.from);
    const b = resolvePort(placed, catalogue, wire.to);
    if (!a.found || !b.found) continue;
    const pair = checkPortPair(a.spec, b.spec);
    if (pair.legal && pair.kind === 'power') wires.push({ a: portKey(a.ref.part, a.ref.port), b: portKey(b.ref.part, b.ref.port) });
  }
  const switches = branches.filter((branch) => branch.kind === 'switch').map((branch): Join => ({ a: branch.a, b: branch.b, branch }));
  return { ids, records, owned, branches, wires, switches, controls };
};

/** The controls of a build, in placed-part id order and then the record's primitive order. */
export const controlsOf = (blueprint: Blueprint, catalogue: Catalogue): readonly Control[] => circuitOf(blueprint, catalogue).controls;

const settingsFrom = (controls: readonly Control[], state: ControlState): Map<ControlId, Setting> =>
  new Map(controls.map((control) => [control.id, (control.kind === 'switch' ? state.switches?.[control.id] : state.channels?.[control.id]) ?? control.rest]));

const stateOf = (controls: readonly Control[], settings: Settings): ControlState => {
  const switches: Record<ControlId, boolean> = {};
  const channels: Record<ControlId, number> = {};
  for (const control of controls) {
    const setting = settings.get(control.id);
    if (typeof setting === 'boolean') switches[control.id] = setting;
    else if (typeof setting === 'number') channels[control.id] = setting;
  }
  return { switches, channels };
};

/** A control's settings to try, its current one first: a switch open or closed; a channel forward, stop or backward. */
const optionsOf = (control: Control, current: Setting): readonly Setting[] =>
  control.kind === 'switch' ? [current, !current] : [current, ...[1, 0, -1].filter((command) => command !== current)];

const changedControls = (controls: readonly Control[], from: Settings, to: Settings): ControlId[] =>
  controls.filter((control) => !Object.is(from.get(control.id), to.get(control.id))).map((control) => control.id);

/**
 * Every other setting of the controls, fewest changes first, then in control order with each control's
 * options in order. Above CONTROL_COMBINATION_CAP combinations, single-control changes only.
 */
const alternatives = (controls: readonly Control[], current: Settings): Settings[] => {
  const options = controls.map((control) => optionsOf(control, current.get(control.id) ?? control.rest));
  let total = 1;
  for (const list of options) total = Math.min(total * list.length, CONTROL_COMBINATION_CAP + 1);
  if (total > CONTROL_COMBINATION_CAP) {
    return controls.flatMap((control, index) => (options[index] ?? []).slice(1).map((option) => new Map(current).set(control.id, option)));
  }
  let combinations: { readonly settings: Map<ControlId, Setting>; readonly changes: number }[] = [{ settings: new Map(), changes: 0 }];
  controls.forEach((control, index) => {
    const list = options[index] ?? [];
    combinations = combinations.flatMap((combination) =>
      list.map((option, choice) => ({ settings: new Map(combination.settings).set(control.id, option), changes: combination.changes + (choice === 0 ? 0 : 1) })),
    );
  });
  return combinations
    .filter((combination) => combination.changes > 0)
    .sort((p, q) => p.changes - q.changes)
    .map((combination) => combination.settings);
};

/**
 * The rule for explaining an unmet need by the controls, for sim-core to judge the ways only voltages show
 * (`low`, `high`, `reversed`) with its solver: tries every other setting of the controls in a fixed order,
 * fewest changes first (single changes only above CONTROL_COMBINATION_CAP combinations), and returns the
 * controls changed in the first setting that `meets` accepts, or undefined when none does.
 */
export const explainByControls = (
  controls: readonly Control[],
  actual: ControlState,
  meets: (state: ControlState) => boolean,
): readonly ControlId[] | undefined => {
  const current = settingsFrom(controls, actual);
  for (const settings of alternatives(controls, current)) {
    if (meets(stateOf(controls, settings))) return changedControls(controls, current, settings);
  }
  return undefined;
};

/** The circuit at one setting of the controls. */
interface Situation {
  readonly settings: Settings;
  readonly joins: readonly Join[];
  /** Nets with every closed switch joined. */
  readonly all: Find;
  /** Nets with every closed switch joined except the part's own. */
  readonly nets: (part: PlacedPartId) => Find;
  /** The sources giving power: every battery, and each output whose supply has power (a channel not at stop). */
  readonly live: ReadonlySet<Branch>;
  /** For parts whose only branch is a use: each use's block, and the blocks holding a source with power. */
  readonly powering: () => { readonly block: ReadonlyMap<Branch, number>; readonly sourced: ReadonlySet<number> };
}

/** The first `through` branch on a closed path through two ports of a part, outside it, along `conducting` branches. */
const closesThrough = (
  circuit: Circuit,
  nets: Find,
  part: PlacedPartId,
  a: Net,
  b: Net,
  conducting: (branch: Branch) => boolean,
  through: (branch: Branch) => boolean,
): Branch | undefined => {
  const from = nets(a);
  const to = nets(b);
  if (from === to) return undefined;
  const list = circuit.branches.filter((branch) => branch.kind !== 'switch' && branch.part !== part && conducting(branch));
  const mates = cycleMates(
    list.map((branch) => ({ a: nets(branch.a), b: nets(branch.b) })),
    from,
    to,
  );
  return list.find((branch, index) => through(branch) && mates(index));
};

const situationAt = (circuit: Circuit, settings: Settings, removed: ReadonlySet<Join> = new Set()): Situation => {
  const closed = (join: Join): boolean => join.branch?.control !== undefined && settings.get(join.branch.control) === true;
  const joins = [...circuit.wires, ...circuit.switches.filter(closed)].filter((join) => !removed.has(join));
  const all = netsOf(joins);
  const cache = new Map<PlacedPartId, Find>();
  const nets = (part: PlacedPartId): Find => {
    if (!(circuit.owned.get(part) ?? []).some((branch) => branch.kind === 'switch')) return all;
    const known = cache.get(part);
    if (known) return known;
    const find = netsOf(joins.filter((join) => join.branch?.part !== part));
    cache.set(part, find);
    return find;
  };
  // An output gives power once its supply has a closed path through a source giving power; a channel at stop
  // gives none. Growing the set until nothing changes gives the same answer in any order.
  const live = new Set<Branch>(circuit.branches.filter((branch) => branch.kind === 'source' && !branch.feeder));
  const conducting = (branch: Branch): boolean => branch.kind === 'use' || live.has(branch);
  for (let grew = true; grew; ) {
    grew = false;
    for (const branch of circuit.branches) {
      if (!branch.feeder || live.has(branch) || (branch.control !== undefined && settings.get(branch.control) === 0)) continue;
      if (!closesThrough(circuit, nets(branch.part), branch.part, branch.feeder.a, branch.feeder.b, conducting, (other) => live.has(other))) continue;
      live.add(branch);
      grew = true;
    }
  }
  let powering: ReturnType<Situation['powering']> | undefined;
  return {
    settings,
    joins,
    all,
    nets,
    live,
    powering: () => {
      if (powering) return powering;
      const list = circuit.branches.filter(conducting);
      const block = blocksOf(list.map((branch) => ({ a: all(branch.a), b: all(branch.b) })));
      const sourced = new Set<number>();
      list.forEach((branch, index) => {
        if (branch.kind === 'source' && block[index] !== -1) sourced.add(block[index] as number);
      });
      powering = { block: new Map(list.map((branch, index) => [branch, block[index] as number])), sourced };
      return powering;
    },
  };
};

/** A power or loop need: the part and the two ports it joins. */
interface Check {
  readonly part: PlacedPartId;
  readonly kind: 'power' | 'loop';
  readonly a: Net;
  readonly b: Net;
}

const meets = (circuit: Circuit, situation: Situation, check: Check): boolean => {
  const { part, a, b } = check;
  const mine = circuit.owned.get(part) ?? [];
  const conducting = (branch: Branch): boolean => branch.kind === 'use' || situation.live.has(branch);
  const live = (branch: Branch): boolean => situation.live.has(branch);
  if (check.kind === 'power') {
    // A part whose one branch is this use: the build is its own probe, so one look at the blocks will do.
    const only = mine.length === 1 && mine[0]?.kind === 'use' && sameEnds(mine[0], a, b) ? mine[0] : undefined;
    if (only) {
      if (situation.all(a) === situation.all(b)) return false;
      const { block, sourced } = situation.powering();
      return sourced.has(block.get(only) ?? -1);
    }
    return closesThrough(circuit, situation.nets(part), part, a, b, conducting, live) !== undefined;
  }
  if (mine.some((branch) => branch.kind === 'source' && sameEnds(branch, a, b))) {
    const nets = situation.nets(part);
    if (nets(a) === nets(b)) return true;
    const list = circuit.branches.filter((branch) => branch.kind !== 'switch' && branch.part !== part && conducting(branch));
    return connected(
      list.map((branch) => ({ a: nets(branch.a), b: nets(branch.b) })),
      nets(a),
      nets(b),
    );
  }
  return closesThrough(circuit, situation.nets(part), part, a, b, conducting, live) !== undefined;
};

/** Whether a short circuit runs through the part's own source or closed switch on these two ports. */
const shortedThrough = (circuit: Circuit, situation: Situation, part: PlacedPartId, x: Net, y: Net): boolean => {
  const mine = (circuit.owned.get(part) ?? []).find((branch) => branch.kind !== 'use' && sameEnds(branch, x, y));
  if (!mine) return false;
  if (mine.kind === 'switch' ? mine.control === undefined || situation.settings.get(mine.control) !== true : !situation.live.has(mine)) return false;
  const nets = situation.nets(part);
  const sources = circuit.branches.filter((branch) => situation.live.has(branch));
  const pushes: Push[] = sources.map((branch) => ({ a: nets(branch.a), b: nets(branch.b), volts: branch.volts }));
  if (mine.kind === 'switch') pushes.push({ a: nets(mine.a), b: nets(mine.b), volts: 0 });
  return shortedPushes(pushes).has(mine.kind === 'switch' ? pushes.length - 1 : sources.indexOf(mine));
};

/**
 * The wires and closed switches that make each short of a battery or output joined to itself. Without
 * them the build is as it would be with the short taken away.
 */
const shortPaths = (circuit: Circuit, situation: Situation, shorted: ReadonlySet<PlacedPartId>): Set<Join> => {
  const removed = new Set<Join>();
  for (const branch of circuit.branches) {
    if (branch.kind !== 'source' || !shorted.has(branch.part) || situation.all(branch.a) !== situation.all(branch.b)) continue;
    const edges: Edge[] = [...situation.joins, { a: branch.a, b: branch.b }];
    const block = blocksOf(edges);
    const mine = block[situation.joins.length] as number;
    situation.joins.forEach((join, index) => {
      if (block[index] === mine) removed.add(join);
    });
  }
  return removed;
};

/** For a need nothing else explains: a closed path through a dead output, named by its control at stop or its part. */
const feederOf = (circuit: Circuit, situation: Situation, check: Check): Explanation | undefined => {
  const found = closesThrough(
    circuit,
    situation.nets(check.part),
    check.part,
    check.a,
    check.b,
    (branch) => branch.kind !== 'switch',
    (branch) => branch.kind === 'source' && !situation.live.has(branch),
  );
  if (!found) return undefined;
  if (found.control !== undefined && situation.settings.get(found.control) === 0) return { by: 'controls', controls: [found.control] };
  return { by: 'feeder', part: found.part };
};

/**
 * The verdict on every power, loop and isolation need of every placed part at one setting of the controls
 * (each control left out of `state` sits at rest), in placed-part id order and then the record's need
 * order. For a blueprint that validateBlueprint accepts. Pure: the same build and state always give the
 * same verdicts, so sim-core can keep them until a control changes.
 * - power `open`: no closed path through a source giving power joins the supply's two ports outside the
 *   part (a part bypassed by a wire or a closed switch is open too).
 * - loop `open`: no closed path joins the two ports outside the part; unless the part is the source of
 *   those ports, the path runs through a source giving power.
 * - isolation `shorted`: a short circuit runs through the part's own source or closed switch: a closed loop
 *   of sources and closed switches, with nothing that uses power, whose source voltages do not cancel
 *   (adding each battery's volts from − to + and taking them away from + to −). A loop through a driver
 *   channel's or regulator's output never cancels here.
 * An unmet power or loop need is explained, in this order: by a short that starves it (it would be met with
 * the wires and closed switches making the short taken away), by the controls (the first other setting
 * that meets it), or by a driver or regulator without power that feeds it. Unexplained, it is a fault.
 */
export const wiredNeeds = (blueprint: Blueprint, catalogue: Catalogue, state: ControlState = {}): readonly WiredVerdict[] => {
  const circuit = circuitOf(blueprint, catalogue);
  const settings = settingsFrom(circuit.controls, state);
  const actual = situationAt(circuit, settings);
  const verdicts: WiredVerdict[] = [];
  const pending: { readonly index: number; readonly check: Check }[] = [];
  const shortedPorts: [PlacedPartId, Net][] = [];
  for (const id of circuit.ids) {
    for (const need of (circuit.records.get(id) as PartRecord).needs) {
      const base = { partId: id, need: need.id };
      if (need.kind === 'isolation') {
        const x = portKey(id, need.ports[0]);
        const shorted = shortedThrough(circuit, actual, id, x, portKey(id, need.ports[1]));
        if (shorted) shortedPorts.push([id, x]);
        verdicts.push({ ...base, kind: 'isolation', ...(shorted ? { unmet: 'shorted' as const } : {}) });
        continue;
      }
      let check: Check | undefined;
      if (need.kind === 'power') check = { part: id, kind: 'power', a: portKey(id, need.supply.pos), b: portKey(id, need.supply.neg) };
      if (need.kind === 'loop') check = { part: id, kind: 'loop', a: portKey(id, need.ports[0]), b: portKey(id, need.ports[1]) };
      if (!check) continue;
      if (meets(circuit, actual, check)) {
        verdicts.push({ ...base, kind: check.kind });
        continue;
      }
      pending.push({ index: verdicts.length, check });
      verdicts.push({ ...base, kind: check.kind, unmet: 'open' });
    }
  }
  const explain = (index: number, explanation: Explanation): void => {
    verdicts[index] = { ...(verdicts[index] as WiredVerdict), explainedBy: explanation };
  };
  let open = pending;

  // A short circuit that starves it: these parts' isolation faults stand for it.
  const removed = open.length > 0 && shortedPorts.length > 0 ? shortPaths(circuit, actual, new Set(shortedPorts.map(([part]) => part))) : new Set<Join>();
  if (removed.size > 0) {
    const healed = situationAt(circuit, settings, removed);
    const within = netsOf([...actual.joins, ...circuit.branches.filter((branch) => branch.kind !== 'switch')]);
    open = open.filter(({ index, check }) => {
      if (!meets(circuit, healed, check)) return true;
      const near = shortedPorts.filter(([, port]) => within(port) === within(check.a)).map(([part]) => part);
      const parts = [...new Set(near.length > 0 ? near : shortedPorts.map(([part]) => part))].sort(compareText);
      explain(index, { by: 'short', parts });
      return false;
    });
  }

  // Another setting of the controls.
  for (const settingsThen of open.length > 0 ? alternatives(circuit.controls, settings) : []) {
    const then = situationAt(circuit, settingsThen);
    open = open.filter(({ index, check }) => {
      if (!meets(circuit, then, check)) return true;
      explain(index, { by: 'controls', controls: changedControls(circuit.controls, settings, settingsThen) });
      return false;
    });
    if (open.length === 0) break;
  }

  // A driver or regulator without power that feeds it.
  for (const { index, check } of open) {
    const explanation = feederOf(circuit, actual, check);
    if (explanation) explain(index, explanation);
  }
  return verdicts;
};

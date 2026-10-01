import {
  carriedPlacement,
  checkPortPair,
  comparePortRefs,
  controlId,
  controlsOf,
  drivePushes,
  indexPlacedParts,
  mountPlacement,
  placeParts,
  resolvePort,
  robotRoot,
  validateBlueprint,
  validateBlueprintShape,
  validatePartRecord,
} from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  DrivePort,
  Issue,
  MountPointPort,
  MountPort,
  PartPlacement,
  PartRecord,
  PlacedPart,
  PlacedPartId,
  PortId,
  PortRef,
  PowerPair,
  WireId,
} from '@servo/schema';
import { liveTableOf } from './live.ts';
import { groupsOf } from './topology.ts';
import type {
  BoundPort,
  BoundPrimitive,
  DriveLink,
  GraphPart,
  MountLink,
  NetPair,
  PowerLine,
  PowerNet,
  PowerSource,
  PowerSwitch,
  PowerUse,
  SignalLink,
  SimGraph,
} from './types.ts';

/** Schema-invalid input: the blueprint, or a part record it uses, fails the schema's validators. */
export class GraphInputError extends Error {
  /** What was refused: the blueprint, or a part record by id. */
  readonly subject: string;
  /** Every named reason, as the validator gives them: a stable code, a JSONPath into the subject and a message. */
  readonly issues: readonly Issue[];

  constructor(subject: string, issues: readonly Issue[]) {
    super(`${subject} is not valid: ${issues.map((issue) => `${issue.code} at ${issue.path} (${issue.message})`).join('; ')}`);
    this.name = 'GraphInputError';
    this.subject = subject;
    this.issues = issues;
  }
}

/** Code-unit order, as the schema sorts ids. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byWire = (p: { readonly wire: WireId }, q: { readonly wire: WireId }): number => compareText(p.wire, q.wire);

/** A port as `<placed part> <port>`; ids are slugs, so the space never clashes. */
const keyOf = (ref: PortRef): string => `${ref.part} ${ref.port}`;

const add = <T>(list: T[], item: T): number => list.push(item) - 1;

/**
 * Checks the input before anything is built: the blueprint's structure, then every part record it uses
 * (the catalogue is meant to hold valid records; a broken one gets its own named reason here), then the
 * whole blueprint against the catalogue. Legal-but-wrong wiring passes, as it does in the schema.
 */
const checked = (blueprint: Blueprint, catalogue: Catalogue): Blueprint => {
  const shape = validateBlueprintShape(blueprint);
  if (!shape.ok) throw new GraphInputError('The blueprint', shape.issues);
  const used = [...shape.value.parts].sort((a, b) => compareText(a.id, b.id)).map((part) => part.part);
  for (const type of new Set(used)) {
    const record = catalogue.parts.get(type);
    if (record === undefined) continue;
    const result = validatePartRecord(record);
    if (!result.ok) throw new GraphInputError(`The part record '${type}'`, result.issues);
  }
  const full = validateBlueprint(shape.value, catalogue);
  if (!full.ok) throw new GraphInputError('The blueprint', full.issues);
  return full.value;
};

/** A power wire before nets are known: its ends as stored. */
type PowerWire = Omit<PowerLine, 'net'>;

interface Wires {
  readonly power: readonly PowerWire[];
  readonly signals: readonly SignalLink[];
  readonly drives: readonly DriveLink[];
  readonly mounts: readonly MountLink[];
}

/** Every wire by kind, in wire id order, each written source first: signal out → in, drive-out → drive-in, mount → mount point. */
const sortWires = (blueprint: Blueprint, catalogue: Catalogue, placed: ReadonlyMap<string, PlacedPart>): Wires => {
  const power: PowerWire[] = [];
  const signals: SignalLink[] = [];
  const drives: DriveLink[] = [];
  const mounts: MountLink[] = [];
  for (const wire of blueprint.wires) {
    const a = resolvePort(placed, catalogue, wire.from);
    const b = resolvePort(placed, catalogue, wire.to);
    // A valid blueprint resolves every end and holds only legal wires.
    if (!a.found || !b.found) continue;
    const pair = checkPortPair(a.spec, b.spec);
    if (!pair.legal) continue;
    const [source, sink] = pair.swap ? [b, a] : [a, b];
    const from: PortRef = { part: source.ref.part, port: source.ref.port };
    const to: PortRef = { part: sink.ref.part, port: sink.ref.port };
    if (pair.kind === 'power') power.push({ wire: wire.id, from, to });
    else if (pair.kind === 'signal') signals.push({ wire: wire.id, from, to });
    else if (pair.kind === 'drive') drives.push({ wire: wire.id, from, to, carried: carriedPlacement(source.spec as DrivePort, sink.spec as DrivePort) });
    else {
      const local = mountPlacement(sink.spec as MountPointPort, source.spec as MountPort);
      mounts.push({ wire: wire.id, part: from.part, mount: from.port, host: to.part, point: to.port, local });
    }
  }
  return { power: power.sort(byWire), signals: signals.sort(byWire), drives: drives.sort(byWire), mounts: mounts.sort(byWire) };
};

/** Power nets: every power port of every part, joined by power wires alone, each net in port order and the nets in order of their first port. */
const netsOf = (
  ids: readonly PlacedPartId[],
  records: ReadonlyMap<PlacedPartId, PartRecord>,
  power: readonly PowerWire[],
): { readonly nets: readonly PowerNet[]; readonly netOf: (ref: PortRef) => number } => {
  const ports: PortRef[] = [];
  const index = new Map<string, number>();
  for (const id of ids) {
    for (const spec of records.get(id)?.ports ?? []) {
      if (spec.type !== 'power') continue;
      const ref = { part: id, port: spec.id };
      index.set(keyOf(ref), ports.length);
      ports.push(ref);
    }
  }
  const end = (ref: PortRef): number => index.get(keyOf(ref)) as number;
  const groups = groupsOf(
    ports.length,
    power.map((wire) => [end(wire.from), end(wire.to)] as const),
  );
  const members = new Map<number, PortRef[]>();
  ports.forEach((ref, at) => {
    const group = groups[at] as number;
    const list = members.get(group);
    if (list) list.push(ref);
    else members.set(group, [ref]);
  });
  const lists = [...members.values()].map((list) => list.sort(comparePortRefs)).sort((p, q) => comparePortRefs(p[0] as PortRef, q[0] as PortRef));
  const nets = new Map<string, number>();
  lists.forEach((list, net) => {
    for (const ref of list) nets.set(keyOf(ref), net);
  });
  const netOf = (ref: PortRef): number => nets.get(keyOf(ref)) as number;
  const wires = lists.map((): WireId[] => []);
  for (const wire of power) wires[netOf(wire.from)]?.push(wire.wire);
  return { nets: lists.map((list, net) => ({ ports: list, wires: wires[net] ?? [] })), netOf };
};

/**
 * Turns a valid blueprint into the wired graph the solvers read: power nets with switches as joins the
 * control state decides, sources with their polarity, live nets for every setting of the controls (when
 * there are few), signal lines, drive linkages and mounts with the schema's transforms, and each part's
 * primitives bound to its ports. `catalogue` is the schema's `makeCatalogue` result, holding every part
 * record the blueprint uses. Legal-but-wrong builds build like any other; schema-invalid input throws a
 * GraphInputError with the validator's named reasons. Pure and deterministic: every list is in id order.
 */
export const buildGraph = (blueprint: Blueprint, catalogue: Catalogue): SimGraph => {
  const valid = checked(blueprint, catalogue);
  const placed = indexPlacedParts(valid.parts);
  const ids = [...placed.keys()].sort(compareText);
  const records = new Map<PlacedPartId, PartRecord>(ids.map((id) => [id, catalogue.parts.get(placed.get(id)?.part ?? '') as PartRecord]));
  const wires = sortWires(valid, catalogue, placed);
  const { nets, netOf } = netsOf(ids, records, wires.power);

  const controls = controlsOf(valid, catalogue);
  const controlIndex = new Map(controls.map((control, index) => [control.id, index]));
  const sources: PowerSource[] = [];
  const switches: PowerSwitch[] = [];
  const uses: PowerUse[] = [];
  const primitives = new Map<PlacedPartId, readonly BoundPrimitive[]>();
  for (const id of ids) {
    const net = (port: PortId): number => netOf({ part: id, port });
    const pair = (ports: PowerPair): NetPair => ({ pos: net(ports.pos), neg: net(ports.neg) });
    const controlOf = (primitive: string): number => {
      const index = controlIndex.get(controlId(id, primitive));
      // controlsOf names every switch and driver channel, so this cannot happen.
      if (index === undefined) throw new Error(`No control for ${controlId(id, primitive)}.`);
      return index;
    };
    // The same elements as the schema's circuit rules: a source per battery, a join per switch, a use per
    // supply, and for a driver channel or regulator a use on its supply and a source on its output.
    const bound = (records.get(id)?.behaviour ?? []).map((spec): BoundPrimitive => {
      const base = { part: id, primitive: spec.id };
      switch (spec.kind) {
        case 'source':
          return { spec, source: add(sources, { ...base, spec, ...pair(spec.output) }) };
        case 'switch':
          return { spec, switch: add(switches, { ...base, spec, a: net(spec.terminals[0]), b: net(spec.terminals[1]), control: controlOf(spec.id) }) };
        case 'load':
        case 'actuator':
        case 'program':
          return { spec, use: add(uses, { ...base, spec, ...pair(spec.supply) }) };
        case 'driver':
          return {
            spec,
            use: add(uses, { ...base, spec, ...pair(spec.supply) }),
            source: add(sources, { ...base, spec, ...pair(spec.output), feeder: pair(spec.supply), control: controlOf(spec.id) }),
          };
        case 'regulator':
          return {
            spec,
            use: add(uses, { ...base, spec, ...pair(spec.supply) }),
            source: add(sources, { ...base, spec, ...pair(spec.output), feeder: pair(spec.supply) }),
          };
        default:
          return { spec };
      }
    });
    primitives.set(id, bound);
  }

  const joined = new Map<string, PortRef[]>();
  const join = (a: PortRef, b: PortRef): void => {
    for (const [end, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const list = joined.get(keyOf(end));
      if (list) list.push(other);
      else joined.set(keyOf(end), [other]);
    }
  };
  for (const link of [...wires.signals, ...wires.drives]) join(link.from, link.to);
  for (const link of wires.mounts) join({ part: link.part, port: link.mount }, { part: link.host, port: link.point });

  const placements = placeParts(valid, catalogue);
  const parts = new Map<PlacedPartId, GraphPart>();
  for (const id of ids) {
    const record = records.get(id) as PartRecord;
    const ports = new Map<PortId, BoundPort>();
    for (const spec of record.ports) {
      const ref = { part: id, port: spec.id };
      const others = [...(joined.get(keyOf(ref)) ?? [])].sort(comparePortRefs);
      ports.set(spec.id, spec.type === 'power' ? { spec, net: netOf(ref), joined: others } : { spec, joined: others });
    }
    parts.set(id, {
      id,
      placed: placed.get(id) as PlacedPart,
      record,
      ports,
      primitives: primitives.get(id) ?? [],
      placement: placements.get(id) as PartPlacement,
    });
  }

  const wiring = { nets, sources, switches, uses };
  return {
    blueprint: valid,
    catalogue,
    parts,
    ...wiring,
    powerLines: wires.power.map((line) => ({ ...line, net: netOf(line.from) })),
    controls,
    liveTable: liveTableOf(wiring, controls.length),
    signals: wires.signals,
    drives: wires.drives,
    mounts: wires.mounts,
    root: robotRoot(placements),
    pushes: drivePushes(valid, catalogue),
  };
};

// The parity check's plan (task 3.8): a content fixture as the steps a child takes to build it from an empty canvas,
// in terms every input path can act on: touch, pointer, the list view and plain commands. Pure: no DOM, no canvas.
// See README.md, "The parity check".
import { checkPortPair, indexPlacedParts, placeParts, resolvePort } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  IssueCode,
  PartTypeId,
  PlacedPartId,
  PortId,
  PortRef,
  SettingId,
  SettingValue,
  Wire,
  WireId,
  WireKind,
} from '@servo/schema';
import type { EditCommand } from '@servo/canvas';

export type StepKind = 'place' | 'setting' | 'connect' | 'refuse';

export const STEP_KINDS: readonly StepKind[] = ['place', 'setting', 'connect', 'refuse'];

/**
 * Places a part from the tray. Held in the fixture (by its mount on a mount point, or its hub on a shaft), it lands
 * attached there. Loose, it lands on the free spot: the one place every path can name, since the list view offers no
 * other (packages/canvas/src/interface.ts, `ListView.placementsFor`), so a loose part may sit elsewhere than the
 * fixture has it.
 */
export interface PlaceStep {
  readonly kind: 'place';
  /** The part's id in the fixture. Each path maps it onto the id its own placement claims. */
  readonly ref: PlacedPartId;
  readonly part: PartTypeId;
  /** Its mount or hub (`port`) onto a mount point or shaft of a part placed earlier, named by fixture ids. */
  readonly attach?: { readonly port: PortId; readonly onto: PortRef };
}

/** Sets a setting the fixture gives a non-default value: on the spec card, or in the list view. */
export interface SettingStep {
  readonly kind: 'setting';
  readonly ref: PlacedPartId;
  readonly setting: SettingId;
  readonly value: SettingValue;
}

/** Draws a power line, a signal line or a drive linkage the placements did not make, in fixture ids. */
export interface ConnectStep {
  readonly kind: 'connect';
  readonly from: PortRef;
  readonly to: PortRef;
  readonly wire: Exclude<WireKind, 'mount'>;
}

/** A broken fixture's impossible drop (task 2.6): every path must refuse it and leave the build as it was. */
export interface RefuseStep {
  readonly kind: 'refuse';
  readonly from: PortRef;
  readonly to: PortRef;
  readonly code: IssueCode;
}

export type Step = PlaceStep | SettingStep | ConnectStep | RefuseStep;

export interface BuildPlan {
  /** The fixture's name in `FIXTURES`. */
  readonly fixture: string;
  /** The build every path starts from: the fixture's metadata and arena, nothing placed, no ids claimed. */
  readonly start: Blueprint;
  /** Placements (each holder before what it holds), then settings, then wires, then the refused drop. */
  readonly steps: readonly Step[];
}

/** The part of a content fixture a plan reads. */
export interface PlannedFixture {
  readonly name: string;
  readonly blueprint: Blueprint;
  readonly expect: { readonly refused?: { readonly from: PortRef; readonly to: PortRef; readonly code: IssueCode } };
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Wire ids in number order (`w2` before `w10`), any other id after them in text order. */
const compareWireIds = (a: WireId, b: WireId): number => {
  const number = (id: WireId): number => Number(/^w(\d+)$/.exec(id)?.[1] ?? Number.POSITIVE_INFINITY);
  return number(a) - number(b) || compareText(a, b);
};

interface Holding {
  readonly child: PlacedPartId;
  readonly wire: Wire;
  readonly port: PortId;
  readonly onto: PortRef;
}

/** The wire by which `parent` holds `child`: a mount (child's mount → parent's mount point) or a drive linkage (parent's shaft → child's hub). */
const holdingWire = (blueprint: Blueprint, catalogue: Catalogue, child: PlacedPartId, parent: PlacedPartId, by: 'mount' | 'carried'): Holding => {
  const parts = indexPlacedParts(blueprint.parts);
  for (const wire of [...blueprint.wires].sort((a, b) => compareWireIds(a.id, b.id))) {
    const from = resolvePort(parts, catalogue, wire.from);
    const to = resolvePort(parts, catalogue, wire.to);
    if (!from.found || !to.found) continue;
    const pair = checkPortPair(from.spec, to.spec);
    if (!pair.legal) continue;
    const [source, target] = pair.swap ? [wire.to, wire.from] : [wire.from, wire.to];
    if (by === 'mount' && pair.kind === 'mount' && source.part === child && target.part === parent) {
      return { child, wire, port: source.port, onto: target };
    }
    if (by === 'carried' && pair.kind === 'drive' && target.part === child && source.part === parent) {
      return { child, wire, port: target.port, onto: source };
    }
  }
  throw new Error(`No wire holds '${child}' on '${parent}'.`);
};

/**
 * The steps that build a fixture from an empty canvas. Placements come first: each loose part with everything it
 * holds, the biggest group first (so a robot's chassis takes the empty canvas's free spot, the origin, where the
 * fixtures put it), and within a group each held part after its holder, in the order of the wires that hold them.
 * Then every setting the fixture changes, then every wire the placements did not make (power and signal lines, and
 * drive linkages between held parts), in wire order, then a broken fixture's refused drop. Throws when the fixture
 * has a mount that holds nothing, which no step here makes.
 */
export const planFor = (fixture: PlannedFixture, catalogue: Catalogue): BuildPlan => {
  const { blueprint } = fixture;
  const parts = indexPlacedParts(blueprint.parts);
  const placements = placeParts(blueprint, catalogue);
  const held: Holding[] = [];
  const loose: PlacedPartId[] = [];
  for (const part of blueprint.parts) {
    const placement = placements.get(part.id);
    if (!placement || placement.by === 'root' || placement.parent === undefined) loose.push(part.id);
    else held.push(holdingWire(blueprint, catalogue, part.id, placement.parent, placement.by));
  }
  const groupSize = (id: PlacedPartId): number => [...placements.values()].filter((placement) => placement.root === id).length;
  loose.sort((a, b) => groupSize(b) - groupSize(a) || compareText(a, b));
  held.sort((a, b) => compareWireIds(a.wire.id, b.wire.id));
  const made = new Set(held.map((holding) => holding.wire.id));

  const steps: Step[] = [];
  const placed = new Set<PlacedPartId>();
  const partOf = (id: PlacedPartId): PartTypeId => parts.get(id)?.part ?? '';
  const ready = (): number => held.findIndex((holding) => placed.has(holding.onto.part));
  for (const root of loose) {
    steps.push({ kind: 'place', ref: root, part: partOf(root) });
    placed.add(root);
    for (let next = ready(); next >= 0; next = ready()) {
      const [holding] = held.splice(next, 1) as [Holding];
      steps.push({ kind: 'place', ref: holding.child, part: partOf(holding.child), attach: { port: holding.port, onto: holding.onto } });
      placed.add(holding.child);
    }
  }
  if (held.length > 0) throw new Error(`${fixture.name}: '${held[0]?.child}' is held by a part that is never placed.`);

  for (const part of [...blueprint.parts].sort((a, b) => compareText(a.id, b.id))) {
    for (const setting of Object.keys(part.settings).sort(compareText)) {
      const value = part.settings[setting];
      if (value !== undefined) steps.push({ kind: 'setting', ref: part.id, setting, value });
    }
  }

  for (const wire of [...blueprint.wires].sort((a, b) => compareWireIds(a.id, b.id))) {
    if (made.has(wire.id)) continue;
    const from = resolvePort(parts, catalogue, wire.from);
    const to = resolvePort(parts, catalogue, wire.to);
    const pair = from.found && to.found ? checkPortPair(from.spec, to.spec) : undefined;
    if (!pair?.legal) throw new Error(`${fixture.name}: wire '${wire.id}' does not join two ports that take it.`);
    if (pair.kind === 'mount') throw new Error(`${fixture.name}: mount '${wire.id}' holds nothing, and no step makes a mount by itself.`);
    steps.push({ kind: 'connect', from: wire.from, to: wire.to, wire: pair.kind });
  }

  const refused = fixture.expect.refused;
  if (refused) steps.push({ kind: 'refuse', from: refused.from, to: refused.to, code: refused.code });

  return {
    fixture: fixture.name,
    start: { ...blueprint, parts: [], wires: [], meta: { ...blueprint.meta, highWater: { parts: 0, wires: 0 } } },
    steps,
  };
};

/** Fixture part ids to the ids one path's placements claimed. */
export type IdMap = ReadonlyMap<PlacedPartId, PlacedPartId>;

export const mapPart = (ids: IdMap, ref: PlacedPartId): PlacedPartId => {
  const id = ids.get(ref);
  if (id === undefined) throw new Error(`'${ref}' has not been placed.`);
  return id;
};

export const mapPort = (ids: IdMap, ref: PortRef): PortRef => ({ part: mapPart(ids, ref.part), port: ref.port });

/**
 * The command a step stands for, on the ids this path claimed: what the app, the spec card and the hint ladder send
 * through `apply`, and what the list view's actions carry. A loose placement names no spot, so the placement rule
 * picks the free spot. A refused drop is the `connect` that must be refused.
 */
export const commandFor = (step: Step, ids: IdMap): EditCommand => {
  switch (step.kind) {
    case 'place':
      return step.attach
        ? { kind: 'place-part', part: step.part, attach: { port: step.attach.port, onto: mapPort(ids, step.attach.onto) } }
        : { kind: 'place-part', part: step.part };
    case 'setting':
      return { kind: 'set-setting', partId: mapPart(ids, step.ref), setting: step.setting, value: step.value };
    case 'connect':
    case 'refuse':
      return { kind: 'connect', from: mapPort(ids, step.from), to: mapPort(ids, step.to) };
  }
};

/** One line for messages, in fixture ids: `place dc-motor motor-left on chassis.motor-left-inner`. */
export const describeStep = (step: Step): string => {
  const port = (ref: PortRef): string => `${ref.part}.${ref.port}`;
  switch (step.kind) {
    case 'place':
      return step.attach
        ? `place ${step.part} ${step.ref} by its ${step.attach.port} on ${port(step.attach.onto)}`
        : `place ${step.part} ${step.ref} on the free spot`;
    case 'setting':
      return `set ${step.ref} ${step.setting} to ${String(step.value)}`;
    case 'connect':
      return `connect ${port(step.from)} to ${port(step.to)} (${step.wire})`;
    case 'refuse':
      return `drop ${port(step.from)} on ${port(step.to)}, refused as ${step.code}`;
  }
};

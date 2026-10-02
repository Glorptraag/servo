// The schema's valid fixtures built by EditCommands, as touch, pointer and the list view build them: one placement per
// part, holders first, each part attached by its mount or its hub where the fixture has it held, and loose where the
// fixture has it loose; then one `connect` per power line, signal line and drive linkage a placement does not make.
// Part and wire ids are the ones the commands claim (`p<n>`, `w<n>`), so a fixture's own ids are mapped onto them.
import { canonicalizeBlueprint, checkPortPair, indexPlacedParts, placeParts, resolvePort } from '@servo/schema';
import type { Blueprint, PartTypeId, PlacedPartId, PortId, PortRef, Vec2, Wire, WireId } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import type { Connect, PlacePart, SingleEdit } from '../../src/interface.ts';
import { catalogue, fixture } from './catalogue.ts';

export interface PlacementStep {
  /** The part's id in the fixture. */
  readonly fixtureId: PlacedPartId;
  readonly part: PartTypeId;
  /** Where it lands held: its mount on a mount point, or its hub on a shaft, of a part placed before it (fixture ids). */
  readonly attach?: { readonly kind: 'mount' | 'shaft'; readonly port: PortId; readonly onto: PortRef; readonly wire: WireId };
  /** Where it lands loose: the fixture's place for it. */
  readonly position?: Vec2;
  readonly rotation?: number;
}

export interface Plan {
  readonly name: string;
  readonly fixture: Blueprint;
  readonly steps: readonly PlacementStep[];
  /** Fixture part id → the id its place-part claims. */
  readonly ids: ReadonlyMap<PlacedPartId, PlacedPartId>;
}

export const fixtureNames: readonly string[] = validBlueprints.map((entry) => entry.name);

const wireNumber = (id: WireId): number => Number(/^w(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

/** The wire by which `parent` holds `child` in the fixture, as a mount or a drive linkage. */
const holdingWire = (blueprint: Blueprint, child: PlacedPartId, parent: PlacedPartId, by: 'mount' | 'carried'): PlacementStep['attach'] => {
  const parts = indexPlacedParts(blueprint.parts);
  for (const wire of blueprint.wires) {
    const from = resolvePort(parts, catalogue, wire.from);
    const to = resolvePort(parts, catalogue, wire.to);
    if (!from.found || !to.found) continue;
    const pair = checkPortPair(from.spec, to.spec);
    if (!pair.legal) continue;
    if (by === 'mount' && pair.kind === 'mount' && wire.from.part === child && wire.to.part === parent) {
      return { kind: 'mount', port: wire.from.port, onto: wire.to, wire: wire.id };
    }
    if (by === 'carried' && pair.kind === 'drive' && wire.to.part === child && wire.from.part === parent) {
      return { kind: 'shaft', port: wire.to.port, onto: wire.from, wire: wire.id };
    }
  }
  throw new Error(`No wire holds '${child}' on '${parent}'.`);
};

/** One placement per part: loose parts first in id order, then held parts by their holding wire, each after its holder. */
export const planFor = (name: string): Plan => {
  const blueprint = fixture(name);
  const placements = placeParts(blueprint, catalogue);
  const loose: PlacementStep[] = [];
  const held: PlacementStep[] = [];
  for (const part of blueprint.parts) {
    const placement = placements.get(part.id);
    if (!placement || placement.by === 'root' || placement.parent === undefined) {
      loose.push({ fixtureId: part.id, part: part.part, position: part.position, rotation: part.rotation });
    } else {
      held.push({ fixtureId: part.id, part: part.part, attach: holdingWire(blueprint, part.id, placement.parent, placement.by) });
    }
  }
  loose.sort((a, b) => (a.fixtureId < b.fixtureId ? -1 : 1));
  held.sort((a, b) => wireNumber(a.attach?.wire ?? '') - wireNumber(b.attach?.wire ?? ''));
  const steps = [...loose];
  const placed = new Set(loose.map((step) => step.fixtureId));
  while (held.length > 0) {
    const next = held.findIndex((step) => placed.has(step.attach?.onto.part ?? ''));
    if (next < 0) throw new Error(`${name}: a held part's holder is never placed.`);
    const [step] = held.splice(next, 1) as [PlacementStep];
    steps.push(step);
    placed.add(step.fixtureId);
  }
  const ids = new Map(steps.map((step, index) => [step.fixtureId, `p${blueprint.meta.highWater.parts + index + 1}`] as const));
  return { name, fixture: blueprint, steps, ids };
};

const mapped = (plan: Plan, id: PlacedPartId): PlacedPartId => {
  const placed = plan.ids.get(id);
  if (!placed) throw new Error(`${plan.name}: '${id}' is not placed.`);
  return placed;
};

/** The place-part command for each step, naming earlier parts by the ids their commands claimed. */
export const placeCommands = (plan: Plan): PlacePart[] =>
  plan.steps.map((step) =>
    step.attach
      ? { kind: 'place-part', part: step.part, attach: { port: step.attach.port, onto: { ...step.attach.onto, part: mapped(plan, step.attach.onto.part) } } }
      : { kind: 'place-part', part: step.part, position: step.position as Vec2, ...(step.rotation ? { rotation: step.rotation } : {}) },
  );

/** The fixture's settings that differ from the defaults, as set-setting commands on the placed ids. */
export const settingCommands = (plan: Plan): SingleEdit[] =>
  plan.fixture.parts.flatMap((part) =>
    Object.entries(part.settings).map(([setting, value]) => ({ kind: 'set-setting', partId: mapped(plan, part.id), setting, value }) as const),
  );

/** The build every path starts from: the fixture's metadata and arena, nothing placed, no ids claimed. */
export const startOf = (plan: Plan): Blueprint => ({
  ...plan.fixture,
  parts: [],
  wires: [],
  meta: { ...plan.fixture.meta, highWater: { parts: 0, wires: 0 } },
});

/**
 * What the placements make of a fixture: its parts under the ids the commands claim, the mounts and drive linkages the
 * placements made (renumbered in placement order), and the high-water marks those claims raise. Canonical form.
 */
export const placedFixture = (plan: Plan, settings = true): Blueprint => {
  const attaches = plan.steps.flatMap((step) => (step.attach ? [step.attach.wire] : []));
  const wireIds = new Map(attaches.map((id, index) => [id, `w${index + 1}`] as const));
  const relabel = (ref: PortRef): PortRef => ({ ...ref, part: mapped(plan, ref.part) });
  const wires: Wire[] = plan.fixture.wires.flatMap((wire) => {
    const id = wireIds.get(wire.id);
    return id ? [{ id, from: relabel(wire.from), to: relabel(wire.to) }] : [];
  });
  const parts = plan.fixture.parts.map((part) => ({ ...part, id: mapped(plan, part.id), ...(settings ? {} : { settings: {} }) }));
  return canonicalizeBlueprint(
    { ...plan.fixture, parts, wires, meta: { ...plan.fixture.meta, highWater: { parts: parts.length, wires: wires.length } } },
    catalogue,
  );
};

/** A fixture wire's two ends on the placed ids. */
const relabelled = (plan: Plan, wire: Wire): { readonly from: PortRef; readonly to: PortRef } => ({
  from: { ...wire.from, part: mapped(plan, wire.from.part) },
  to: { ...wire.to, part: mapped(plan, wire.to.part) },
});

/** The fixture's wires a placement does not make (power lines, signal lines, drive linkages between held parts), in id order. */
export const connectWires = (plan: Plan): readonly Wire[] => {
  const attached = new Set(plan.steps.flatMap((step) => (step.attach ? [step.attach.wire] : [])));
  return plan.fixture.wires.filter((wire) => !attached.has(wire.id)).sort((a, b) => wireNumber(a.id) - wireNumber(b.id));
};

/** A `connect` for each wire a placement does not make, after every placement, naming parts by their placed ids. */
export const connectCommands = (plan: Plan): Connect[] => connectWires(plan).map((wire) => ({ kind: 'connect', ...relabelled(plan, wire) }));

/**
 * The whole fixture as the placements and then the connects make it: its parts under the claimed ids, every wire
 * renumbered in the order the commands claim it (placements first, then connects), and the high-water marks those
 * claims raise. Canonical form.
 */
export const wiredFixture = (plan: Plan, settings = true): Blueprint => {
  const order = [...plan.steps.flatMap((step) => (step.attach ? [step.attach.wire] : [])), ...connectWires(plan).map((wire) => wire.id)];
  const wireIds = new Map(order.map((id, index) => [id, `w${index + 1}`] as const));
  const wires: Wire[] = plan.fixture.wires.map((wire) => ({ id: wireIds.get(wire.id) as WireId, ...relabelled(plan, wire) }));
  const parts = plan.fixture.parts.map((part) => ({ ...part, id: mapped(plan, part.id), ...(settings ? {} : { settings: {} }) }));
  return canonicalizeBlueprint(
    { ...plan.fixture, parts, wires, meta: { ...plan.fixture.meta, highWater: { parts: parts.length, wires: wires.length } } },
    catalogue,
  );
};

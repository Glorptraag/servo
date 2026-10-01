// What holds what in a build: the schema's `placeParts` read as a tree, and where every held part sits. The command
// layer and the input paths share it, so a part on a mount or a shaft is stored where that mount or shaft puts it, by
// every path (packages/schema/docs/geometry.md). Pure. See docs/placement.md.
import { canvasPoseOf, checkPortPair, indexPlacedParts, placeParts, resolvePort } from '@servo/schema';
import type { Blueprint, Catalogue, PartPlacement, PlacedPart, PlacedPartId, Wire } from '@servo/schema';
import { compareIds } from '../scene/geometry.ts';
import type { PartPose } from '../scene/geometry.ts';

export interface Holding {
  readonly parts: ReadonlyMap<PlacedPartId, PlacedPart>;
  /** `placeParts`: how each part is held, and its frame in its holder's. */
  readonly placements: ReadonlyMap<PlacedPartId, PartPlacement>;
  /** The parts each part holds directly, by a mount or on a shaft, in id order. */
  readonly children: ReadonlyMap<PlacedPartId, readonly PlacedPartId[]>;
}

export const readHolding = (blueprint: Blueprint, catalogue: Catalogue): Holding => {
  const placements = placeParts(blueprint, catalogue);
  const children = new Map<PlacedPartId, PlacedPartId[]>();
  for (const id of [...placements.keys()].sort(compareIds)) {
    const parent = placements.get(id)?.parent;
    if (parent === undefined) continue;
    const list = children.get(parent);
    if (list) list.push(id);
    else children.set(parent, [id]);
  }
  return { parts: indexPlacedParts(blueprint.parts), placements, children };
};

/** The part and every part held under it, each holder before the parts it holds. */
export const subtreeOf = (holding: Holding, id: PlacedPartId): PlacedPartId[] => {
  const order = [id];
  for (let i = 0; i < order.length; i++) {
    for (const child of holding.children.get(order[i] as PlacedPartId) ?? []) order.push(child);
  }
  return order;
};

/** A loose part's pose: where it is stored, never mirrored (only a mirrored mount point mirrors a part). */
export const loosePose = (part: PlacedPart): PartPose => ({ x: part.position.x, y: part.position.y, rotation: part.rotation, mirrored: false });

/** Where a part and everything it holds sit when the part sits at `pose` (`canvasPoseOf` down the tree). */
export const layOut = (holding: Holding, id: PlacedPartId, pose: PartPose): Map<PlacedPartId, PartPose> => {
  const poses = new Map<PlacedPartId, PartPose>([[id, pose]]);
  for (const holder of subtreeOf(holding, id)) {
    const at = poses.get(holder);
    if (!at) continue;
    for (const child of holding.children.get(holder) ?? []) {
      const local = holding.placements.get(child)?.local;
      if (local) poses.set(child, canvasPoseOf(at, local));
    }
  }
  return poses;
};

/** Every part's pose: a loose part where it is stored, a held part where its holder puts it. */
export const posesOf = (holding: Holding): Map<PlacedPartId, PartPose> => {
  const poses = new Map<PlacedPartId, PartPose>();
  for (const id of [...holding.placements.keys()].sort(compareIds)) {
    const part = holding.parts.get(id);
    if (!part || holding.placements.get(id)?.by !== 'root') continue;
    for (const [child, pose] of layOut(holding, id, loosePose(part))) poses.set(child, pose);
  }
  return poses;
};

/**
 * The build with every held part stored where its holder puts it; loose parts stay where they are. Every command
 * that changes what holds what, or where a holder sits, ends with this, so a mount is never misplaced and a wheel
 * on a shaft is stored on it.
 */
export const settle = (blueprint: Blueprint, catalogue: Catalogue): Blueprint => {
  const holding = readHolding(blueprint, catalogue);
  const poses = posesOf(holding);
  let changed = false;
  const parts = blueprint.parts.map((part) => {
    const pose = poses.get(part.id);
    if (!pose || holding.placements.get(part.id)?.by === 'root') return part;
    if (pose.x === part.position.x && pose.y === part.position.y && pose.rotation === part.rotation) return part;
    changed = true;
    return { ...part, position: { x: pose.x, y: pose.y }, rotation: pose.rotation };
  });
  return changed ? { ...blueprint, parts } : blueprint;
};

/**
 * The parts a change left loose (D35): held, before it, by a part the change removed, and held by nothing after it.
 * In id order.
 */
export const leftLoose = (before: Blueprint, after: Blueprint, catalogue: Catalogue): PlacedPartId[] => {
  const was = placeParts(before, catalogue);
  const now = placeParts(after, catalogue);
  const remaining = new Set(after.parts.map((part) => part.id));
  const loose: PlacedPartId[] = [];
  for (const [id, placement] of was) {
    const holder = placement.parent;
    if (holder !== undefined && !remaining.has(holder) && remaining.has(id) && now.get(id)?.by === 'root') loose.push(id);
  }
  return loose.sort(compareIds);
};

/** Whether `wire` is the mount or drive linkage by which `holder` holds `id`. */
const holds = (
  parts: ReadonlyMap<string, PlacedPart>,
  catalogue: Catalogue,
  wire: Wire,
  id: PlacedPartId,
  holder: PlacedPartId,
): boolean => {
  const ends = [wire.from.part, wire.to.part];
  if (id === holder || !ends.includes(id) || !ends.includes(holder)) return false;
  const from = resolvePort(parts, catalogue, wire.from);
  const to = resolvePort(parts, catalogue, wire.to);
  if (!from.found || !to.found) return false;
  const pair = checkPortPair(from.spec, to.spec);
  if (!pair.legal || (pair.kind !== 'mount' && pair.kind !== 'drive')) return false;
  // Stored orientation runs mount → mount point and drive-out → drive-in: the held part is the mount or the drive-in.
  const [source, sink] = pair.swap ? [to, from] : [from, to];
  return pair.kind === 'mount' ? source.ref.part === id : sink.ref.part === id;
};

/**
 * Takes a part off whatever holds it (D34). The mount or drive linkage that holds it is removed, and again while
 * another would hold it instead (a gearbox's input on a motor shaft, once its mount is gone), until it is loose.
 * Nothing else changes: the parts it holds stay on it.
 */
export const takeOff = (blueprint: Blueprint, catalogue: Catalogue, id: PlacedPartId): Blueprint => {
  const parts = indexPlacedParts(blueprint.parts);
  let current = blueprint;
  for (let guard = 0; guard <= blueprint.wires.length; guard++) {
    const placement = placeParts(current, catalogue).get(id);
    const holder = placement?.parent;
    if (!placement || placement.by === 'root' || holder === undefined) return current;
    const wires = current.wires.filter((wire) => !holds(parts, catalogue, wire, id, holder));
    if (wires.length === current.wires.length) return current;
    current = { ...current, wires };
  }
  return current;
};

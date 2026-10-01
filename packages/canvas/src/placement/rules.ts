// Where a part may land (brief Section 10), from port roles and geometry alone (ground rule 1): onto a free mount point
// or shaft it fits, or loose at a free spot on the workbench. The command layer, the input paths and the list view
// (task 3.6) share these rules, so a drop, a tap and a list action agree. Pure. See docs/placement.md.
import { PLACEMENT_TOLERANCE, canvasPoseOf, carriedPlacement, claimPartId, mountPlacement, planWire } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  DrivePort,
  MountPointPort,
  MountPort,
  PartRecord,
  PartTypeId,
  PlacedPartId,
  PortId,
  PortRef,
  Vec2,
} from '@servo/schema';
import { compareIds, distance, partToCanvas } from '../scene/geometry.ts';
import type { PartPose } from '../scene/geometry.ts';
import { layoutPart } from '../scene/layout.ts';
import { freeSpot, roundPoint } from './free-spot.ts';
import type { Outline } from './free-spot.ts';
import { layOut, posesOf, readHolding, subtreeOf, takeOff } from './holding.ts';

/** Somewhere a part can attach as it lands: its mount on a free mount point, or its hub on a free shaft. */
export interface SnapTarget {
  readonly kind: 'mount' | 'shaft';
  /** The placing part's port: its mount, or its drive-in (a hub). */
  readonly port: PortId;
  /** A free mount point, or a free shaft (a drive-out). */
  readonly onto: PortRef;
  /** Where `onto` sits on the canvas, mm. */
  readonly at: Vec2;
  /** Where the placing part would sit: the mount or the shaft decides. */
  readonly pose: PartPose;
}

/** A part's tile on the canvas at `pose`: the rectangle the renderer draws (scene/layout.ts). */
export const tileOutline = (record: PartRecord, pose: PartPose): Outline => {
  const { w, h } = layoutPart(record).tile;
  return [
    { x: -w / 2, y: h / 2 },
    { x: w / 2, y: h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: -w / 2, y: -h / 2 },
  ].map((corner) => partToCanvas(pose, corner));
};

const byId = <T extends { readonly id: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => compareIds(a.id, b.id));

/**
 * Every free mount point (and, with `shafts`, every free shaft) that `partId`'s mount (or hub) may join in `draft`,
 * judged by the schema's `planWire`, so a target is exactly what the command accepts. Parts in `exclude` offer none.
 */
const targetsOf = (
  draft: Blueprint,
  catalogue: Catalogue,
  partId: PlacedPartId,
  record: PartRecord,
  exclude: ReadonlySet<PlacedPartId>,
  shafts: boolean,
): SnapTarget[] => {
  const poses = posesOf(readHolding(draft, catalogue));
  const targets: SnapTarget[] = [];
  for (const port of record.ports) {
    if (port.type !== 'mechanical') continue;
    const wanted = port.role === 'mount' ? 'mount-point' : port.role === 'drive-in' && shafts ? 'drive-out' : undefined;
    if (!wanted) continue;
    for (const host of byId(draft.parts)) {
      const hostRecord = catalogue.parts.get(host.part);
      const hostPose = poses.get(host.id);
      if (exclude.has(host.id) || !hostRecord || !hostPose) continue;
      for (const spec of hostRecord.ports) {
        if (spec.type !== 'mechanical' || spec.role !== wanted) continue;
        const onto = { part: host.id, port: spec.id };
        if (!planWire(draft, catalogue, { part: partId, port: port.id }, onto).legal) continue;
        const local =
          wanted === 'mount-point'
            ? mountPlacement(spec as MountPointPort, port as MountPort)
            : carriedPlacement(spec as DrivePort, port as DrivePort);
        if (!local) continue;
        targets.push({
          kind: wanted === 'mount-point' ? 'mount' : 'shaft',
          port: port.id,
          onto,
          at: partToCanvas(hostPose, spec.at),
          pose: canvasPoseOf(hostPose, local),
        });
      }
    }
  }
  return targets;
};

/** The id the next placed part takes, or undefined once ids have run out. */
const nextPartId = (blueprint: Blueprint): ReturnType<typeof claimPartId> | undefined => {
  try {
    return claimPartId(blueprint);
  } catch {
    return undefined;
  }
};

/** Where a new part from the tray can attach: every free mount point its mount fits and every free shaft its hub fits. */
export const placeTargets = (blueprint: Blueprint, catalogue: Catalogue, type: PartTypeId): SnapTarget[] => {
  const record = catalogue.parts.get(type);
  const claimed = nextPartId(blueprint);
  if (!record || !claimed) return [];
  const provisional = { id: claimed.id, part: type, position: { x: 0, y: 0 }, rotation: 0, settings: {} };
  const draft: Blueprint = { ...blueprint, parts: [...blueprint.parts, provisional], meta: claimed.meta };
  return targetsOf(draft, catalogue, claimed.id, record, new Set([claimed.id]), true);
};

/**
 * Where a placed part can re-snap as it moves (D34): every free mount point its mount fits once it is off its own,
 * which is among them, never one on the part itself or on anything it holds.
 */
export const moveTargets = (blueprint: Blueprint, catalogue: Catalogue, partId: PlacedPartId): SnapTarget[] => {
  const part = blueprint.parts.find((candidate) => candidate.id === partId);
  const record = part && catalogue.parts.get(part.part);
  if (!part || !record) return [];
  const loose = takeOff(blueprint, catalogue, partId);
  const exclude = new Set(subtreeOf(readHolding(loose, catalogue), partId));
  return targetsOf(loose, catalogue, partId, record, exclude, false);
};

/**
 * The target nearest to where the placing part's port would be (`portAt`), within `radius` mm. Mounts win ties, so a
 * gearbox dropped where its mount point and a motor shaft meet is mounted. Undefined when none is in reach.
 */
export const nearestTarget = (
  targets: readonly SnapTarget[],
  portAt: (target: SnapTarget) => Vec2,
  radius: number,
): SnapTarget | undefined => {
  let best: SnapTarget | undefined;
  let bestDistance = Infinity;
  for (const target of targets) {
    const gap = distance(portAt(target), target.at);
    if (gap > radius) continue;
    const tie = Math.abs(gap - bestDistance) <= PLACEMENT_TOLERANCE.mm;
    if ((!tie && gap < bestDistance) || (tie && best?.kind === 'shaft' && target.kind === 'mount')) {
      best = target;
      bestDistance = gap;
    }
  }
  return best;
};

/** Every placed part's tile but those in `except`: what a loose part keeps clear of. */
const tilesExcept = (blueprint: Blueprint, catalogue: Catalogue, except: ReadonlySet<PlacedPartId>): Outline[] => {
  const poses = posesOf(readHolding(blueprint, catalogue));
  const tiles: Outline[] = [];
  for (const part of byId(blueprint.parts)) {
    const record = catalogue.parts.get(part.part);
    const pose = poses.get(part.id);
    if (!except.has(part.id) && record && pose) tiles.push(tileOutline(record, pose));
  }
  return tiles;
};

/** Where a new loose part of type `record`, turned `rotation`, lands when dropped at `from`: the nearest free spot. */
export const newPartSpot = (blueprint: Blueprint, catalogue: Catalogue, record: PartRecord, rotation: number, from: Vec2): Vec2 => {
  const start = roundPoint(from);
  const shape = [tileOutline(record, { x: 0, y: 0, rotation, mirrored: false })];
  return freeSpot({ from: start, shape, obstacles: tilesExcept(blueprint, catalogue, new Set()) }) ?? start;
};

/**
 * Where a placed part lands when it is moved loose to `position` (its frame origin) with everything it holds: the
 * nearest free spot for the whole group.
 */
export const movedPartSpot = (blueprint: Blueprint, catalogue: Catalogue, partId: PlacedPartId, position: Vec2): Vec2 => {
  const start = roundPoint(position);
  const loose = takeOff(blueprint, catalogue, partId);
  const holding = readHolding(loose, catalogue);
  const part = holding.parts.get(partId);
  if (!part) return start;
  const group = subtreeOf(holding, partId);
  const poses = layOut(holding, partId, { x: 0, y: 0, rotation: part.rotation, mirrored: false });
  const shape: Outline[] = [];
  for (const id of group) {
    const record = catalogue.parts.get(holding.parts.get(id)?.part ?? '');
    const pose = poses.get(id);
    if (record && pose) shape.push(tileOutline(record, pose));
  }
  return freeSpot({ from: start, shape, obstacles: tilesExcept(loose, catalogue, new Set(group)) }) ?? start;
};

/**
 * Where a part placed without a spot lands (the list view, the hint ladder's do-it): the free spot nearest the middle
 * of the build, or the canvas origin, where the first part goes, when nothing is placed. It depends on the build
 * alone, never on the view, so every path that omits the spot lands on the same one.
 */
export const defaultSpot = (blueprint: Blueprint, catalogue: Catalogue, record: PartRecord, rotation: number): Vec2 => {
  const tiles = tilesExcept(blueprint, catalogue, new Set());
  const points = tiles.flat();
  const anchor =
    points.length === 0
      ? { x: 0, y: 0 }
      : {
          x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
          y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2,
        };
  return newPartSpot(blueprint, catalogue, record, rotation, anchor);
};

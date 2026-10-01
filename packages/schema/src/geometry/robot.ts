import type { Primitive } from '../types/behaviour.ts';
import type { Blueprint, PlacedPart } from '../types/blueprint.ts';
import type { PlacedPartId, Vec3 } from '../types/common.ts';
import type { PartRecord } from '../types/part.ts';
import type { DrivePort, MountPointPort, MountPort, PortRef } from '../types/port.ts';
import type { Catalogue } from '../validate/catalogue.ts';
import { compareText } from '../validate/reader.ts';
import { checkPortPair, indexPlacedParts, resolvePort } from '../validate/wiring.ts';
import { IDENTITY_PLACEMENT, axisVector, carriedPlacement, composePlacements, mountPlacement, spin, turnVector } from './frames.ts';
import type { Placement } from './frames.ts';

/** How a part is held: fixed by a mount, carried on another part's shaft, or not held (a root). */
export interface PartPlacement {
  /** The part at the top of its chain: itself when it is not held. */
  readonly root: PlacedPartId;
  /** Its frame in the root's frame. */
  readonly placement: Placement;
  readonly by: 'root' | 'mount' | 'carried';
  /** The part it is fixed to or carried by. */
  readonly parent?: PlacedPartId;
  /** Its frame in the parent's frame. */
  readonly local: Placement;
}

interface Link {
  readonly parent: PlacedPartId;
  readonly local: Placement;
  readonly by: 'mount' | 'carried';
}

interface Linkage {
  readonly from: PortRef;
  readonly to: PortRef;
  readonly out: DrivePort;
  readonly into: DrivePort;
}

interface Fixing {
  readonly child: PlacedPartId;
  readonly host: PlacedPartId;
  readonly point: MountPointPort;
  readonly mount: MountPort;
}

interface Board {
  readonly parts: ReadonlyMap<string, PlacedPart>;
  readonly records: ReadonlyMap<string, PartRecord>;
  readonly mounts: readonly Fixing[];
  readonly linkages: readonly Linkage[];
}

const readBoard = (blueprint: Blueprint, catalogue: Catalogue): Board => {
  const parts = indexPlacedParts(blueprint.parts);
  const records = new Map<string, PartRecord>();
  for (const part of parts.values()) {
    const record = catalogue.parts.get(part.part);
    if (record) records.set(part.id, record);
  }
  const mounts: Fixing[] = [];
  const linkages: Linkage[] = [];
  for (const wire of blueprint.wires) {
    const a = resolvePort(parts, catalogue, wire.from);
    const b = resolvePort(parts, catalogue, wire.to);
    if (!a.found || !b.found || a.ref.part === b.ref.part) continue;
    const pair = checkPortPair(a.spec, b.spec);
    if (!pair.legal) continue;
    const [source, sink] = pair.swap ? [b, a] : [a, b];
    if (pair.kind === 'mount') {
      mounts.push({ child: source.ref.part, host: sink.ref.part, point: sink.spec as MountPointPort, mount: source.spec as MountPort });
    } else if (pair.kind === 'drive') {
      linkages.push({ from: source.ref, to: sink.ref, out: source.spec as DrivePort, into: sink.spec as DrivePort });
    }
  }
  return { parts, records, mounts, linkages };
};

/** Candidates in the part record's port order, then by the other part's id, so wire order never matters. */
const byPortOrder = <T>(record: PartRecord, items: readonly T[], port: (item: T) => string, other: (item: T) => string): T[] => {
  const order = (item: T): number => record.ports.findIndex((spec) => spec.id === port(item));
  return [...items].sort((a, b) => order(a) - order(b) || compareText(other(a), other(b)));
};

const grouped = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list) list.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
};

/**
 * Every part's frame in its root's frame. A mounted part hangs from its host; a part that is not mounted
 * but whose drive-in rides on another part's shaft is carried by it; any other part is a root. Mount
 * links come first, then carried links, each part in id order and each candidate in the record's port
 * order. A link that would close a loop is dropped. The result is the same for any wire order.
 */
export const placeParts = (blueprint: Blueprint, catalogue: Catalogue): ReadonlyMap<PlacedPartId, PartPlacement> => {
  const board = readBoard(blueprint, catalogue);
  const ids = [...board.records.keys()].sort(compareText);
  const links = new Map<string, Link>();
  // Each part's tree, by union-find: a part still unlinked heads its own tree, so a new parent closes a
  // loop exactly when the parent's tree is headed by the part itself.
  const tree = new Map<string, string>();
  const head = (id: string): string => {
    let top = id;
    let up = tree.get(top);
    while (up !== undefined) {
      top = up;
      up = tree.get(top);
    }
    let step = id;
    up = tree.get(step);
    while (up !== undefined) {
      tree.set(step, top);
      step = up;
      up = tree.get(step);
    }
    return top;
  };
  const link = (id: string, value: Link): void => {
    links.set(id, value);
    tree.set(id, value.parent);
  };
  const mountsOf = grouped(board.mounts, (fixing) => fixing.child);
  for (const id of ids) {
    const record = board.records.get(id) as PartRecord;
    for (const fixing of byPortOrder(record, mountsOf.get(id) ?? [], (f) => f.mount.id, (f) => f.host)) {
      if (!board.records.has(fixing.host) || head(fixing.host) === id) continue;
      link(id, { parent: fixing.host, local: mountPlacement(fixing.point, fixing.mount), by: 'mount' });
      break;
    }
  }
  const linkagesInto = grouped(board.linkages, (linkage) => linkage.to.part);
  for (const id of ids) {
    if (links.has(id)) continue;
    const record = board.records.get(id) as PartRecord;
    for (const linkage of byPortOrder(record, linkagesInto.get(id) ?? [], (l) => l.to.port, (l) => `${l.from.part}.${l.from.port}`)) {
      if (!board.records.has(linkage.from.part) || head(linkage.from.part) === id) continue;
      const local = carriedPlacement(linkage.out, linkage.into);
      if (!local) continue;
      link(id, { parent: linkage.from.part, local, by: 'carried' });
      break;
    }
  }
  const placed = new Map<PlacedPartId, PartPlacement>();
  // Walks up to a placed part or a root, then places the chain top down, so a long chain cannot overflow the stack.
  const place = (id: string): void => {
    const chain: string[] = [];
    let top = id;
    for (let link = links.get(top); !placed.has(top) && link; link = links.get(top)) {
      chain.push(top);
      top = link.parent;
    }
    if (!placed.has(top)) placed.set(top, { root: top, placement: IDENTITY_PLACEMENT, by: 'root', local: IDENTITY_PLACEMENT });
    for (const child of chain.reverse()) {
      const link = links.get(child) as Link;
      const parent = placed.get(link.parent) as PartPlacement;
      placed.set(child, {
        root: parent.root,
        placement: composePlacements(parent.placement, link.local),
        by: link.by,
        parent: link.parent,
        local: link.local,
      });
    }
  };
  for (const id of ids) place(id);
  return placed;
};

/**
 * The robot's root: the part not held by any other with the most parts held under it, ties going to the
 * lowest id. Undefined when no part holds another. Its canvas pose maps onto the arena's start pose.
 */
export const robotRoot = (placements: ReadonlyMap<PlacedPartId, PartPlacement>): PlacedPartId | undefined => {
  const counts = new Map<string, number>();
  for (const [id, placement] of placements) {
    if (placement.root !== id) counts.set(placement.root, (counts.get(placement.root) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [id, count] of [...counts].sort(([a], [b]) => compareText(a, b))) {
    if (best === undefined || count > (counts.get(best) ?? 0)) best = id;
  }
  return best;
};

/** A wheel driven by a speed actuator, and which way it pushes the robot when that actuator turns at positive speed. */
export interface DrivePush {
  readonly wheel: PlacedPartId;
  readonly actuator: PlacedPartId;
  readonly root: PlacedPartId;
  /** Along the root's +x: 1 forward, −1 backward, 0 neither (the axle lies along the root's x or is upright). */
  readonly push: -1 | 0 | 1;
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

const primitiveOf = <K extends Primitive['kind']>(record: PartRecord | undefined, kind: K): readonly Extract<Primitive, { kind: K }>[] =>
  (record?.behaviour ?? []).filter((primitive): primitive is Extract<Primitive, { kind: K }> => primitive.kind === kind);

/**
 * Which way each drive wheel pushes the robot when its actuator turns at positive speed. The turning
 * follows the drive chain: a drive linkage turns the drive-in exactly as the drive-out turns; a gearbox
 * that is mounted turns its output the same way about its axis as its input turns about its axis.
 * Multiply by the actuator's actual turning sign (wiring, `reverse`, a driver's command) for the push
 * in a Run. sim-core and the canvas share this rule.
 */
export const drivePushes = (blueprint: Blueprint, catalogue: Catalogue): readonly DrivePush[] => {
  const board = readBoard(blueprint, catalogue);
  const placements = placeParts(blueprint, catalogue);
  const intoPort = (part: string, port: string): Linkage | undefined =>
    board.linkages.find((linkage) => linkage.to.part === part && linkage.to.port === port);

  /** The turning of a drive-out per unit of actuator speed, in its root's frame, and the actuator behind it. */
  const turning = (part: string, port: string, seen: ReadonlySet<string>): { omega: Vec3; actuator: string } | undefined => {
    if (seen.has(part)) return undefined;
    const record = board.records.get(part);
    const where = placements.get(part);
    if (!record || !where) return undefined;
    const spec = record.ports.find((candidate) => candidate.id === port);
    if (!spec || spec.type !== 'mechanical' || spec.role !== 'drive-out') return undefined;
    if (primitiveOf(record, 'actuator').some((actuator) => actuator.mode === 'speed' && actuator.drive === port)) {
      return { omega: spin(where.placement, spec.axis), actuator: part };
    }
    const gearbox = primitiveOf(record, 'ratio').find((ratio) => ratio.output === port);
    if (!gearbox || !board.mounts.some((fixing) => fixing.child === part && fixing.mount.id === gearbox.mount)) return undefined;
    const input = intoPort(part, gearbox.input);
    const inputSpec = record.ports.find((candidate) => candidate.id === gearbox.input);
    if (!input || !inputSpec || inputSpec.type !== 'mechanical' || inputSpec.role !== 'drive-in') return undefined;
    // Turnings compare only within one robot's frame.
    if (placements.get(input.from.part)?.root !== where.root) return undefined;
    const driven = turning(input.from.part, input.from.port, new Set([...seen, part]));
    if (!driven) return undefined;
    const inAxis = turnVector(where.placement, axisVector(inputSpec.axis));
    const outAxis = turnVector(where.placement, axisVector(spec.axis));
    return { omega: scale(outAxis, dot(driven.omega, inAxis) / gearbox.ratio), actuator: driven.actuator };
  };

  const pushes: DrivePush[] = [];
  for (const id of [...board.records.keys()].sort(compareText)) {
    for (const wheel of primitiveOf(board.records.get(id), 'wheel')) {
      const linkage = intoPort(id, wheel.hub);
      const drive = linkage && turning(linkage.from.part, linkage.from.port, new Set([id]));
      const where = placements.get(id);
      if (!drive || !where || placements.get(drive.actuator)?.root !== where.root) continue;
      // A wheel turning ω rolls its hub at ω × (radius · up): along +x by ω.y.
      const forward = drive.omega.y;
      pushes.push({ wheel: id, actuator: drive.actuator, root: where.root, push: forward > 0 ? 1 : forward < 0 ? -1 : 0 });
    }
  }
  return pushes;
};

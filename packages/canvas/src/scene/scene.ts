// The scene model: what the canvas draws for a blueprint, in canvas millimetres, with no Pixi in it. The renderer
// draws it; later tasks hit-test, snap and route against it. Pure: the same blueprint and catalogue give the same
// scene. See docs/renderer.md.
import { checkPortPair, placeParts, robotRoot } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  PartRecord,
  PlacedPart,
  PlacedPartId,
  PortRef,
  PortSpec,
  PortType,
  Vec2,
  WireId,
  WireKind,
} from '@servo/schema';
import { compareIds, partToCanvas, rectOfPoints, turnToCanvas, unionRect } from './geometry.ts';
import type { PartPose, Rect } from './geometry.ts';
import { layoutPart } from './layout.ts';
import type { SocketLayer, TileSize } from './layout.ts';
import { PORT_MM } from './units.ts';

export interface ScenePort {
  readonly ref: PortRef;
  /** `<part>.<port>`: a stable key for views and emphasis. */
  readonly key: string;
  readonly spec: PortSpec;
  readonly type: PortType;
  /** In the part's frame, mm. */
  readonly local: Vec2;
  /** On the canvas, mm. */
  readonly at: Vec2;
  /** For a socket on the tile's outline: its outward direction on the canvas. */
  readonly outward?: Vec2;
  readonly layer: SocketLayer;
  /** A wire ends on it: drawn filled. */
  readonly connected: boolean;
}

export interface ScenePart {
  readonly id: PlacedPartId;
  readonly placed: PlacedPart;
  readonly record: PartRecord;
  readonly pose: PartPose;
  /** Holds other parts (has a mount point): drawn in the chassis layer. */
  readonly frame: boolean;
  /** How it is held: by a mount, on another part's shaft, or not at all. */
  readonly held: 'root' | 'mount' | 'carried';
  readonly parent?: PlacedPartId;
  /** Links up to its root: 0 for a root. */
  readonly depth: number;
  /** The height of its base above its root's (mm, `placeParts`): parts lower on the robot draw first. */
  readonly z: number;
  readonly tile: TileSize;
  /** In the record's port order. */
  readonly ports: readonly ScenePort[];
  /** The tile's corners on the canvas, clockwise from the back left. */
  readonly corners: readonly Vec2[];
  /** The tile and its sockets on the canvas. */
  readonly bounds: Rect;
}

export interface SceneWire {
  readonly id: WireId;
  readonly kind: WireKind;
  readonly type: PortType;
  readonly from: ScenePort;
  readonly to: ScenePort;
}

export interface Scene {
  /** Draw order: frames, then other parts, each from low to high on the robot, then by depth and id. */
  readonly parts: readonly ScenePart[];
  readonly partById: ReadonlyMap<PlacedPartId, ScenePart>;
  readonly portByKey: ReadonlyMap<string, ScenePort>;
  /** Power and signal lines, by id. */
  readonly wires: readonly SceneWire[];
  /** Drive linkages and mounts, by id. */
  readonly linkages: readonly SceneWire[];
  /** The robot's root (schema `robotRoot`), whose pose the arena's start pose maps onto. */
  readonly root?: PlacedPartId;
  /** Everything drawn for the build: tiles and sockets. Undefined when no part is placed. */
  readonly bounds?: Rect;
}

export const portKey = (ref: PortRef): string => `${ref.part}.${ref.port}`;

/** How far a socket reaches from its centre, for bounds: a hexagon's corner reaches furthest. */
const SOCKET_REACH = (PORT_MM / 2) * (2 / Math.sqrt(3));

const EMPTY: Scene = { parts: [], partById: new Map(), portByKey: new Map(), wires: [], linkages: [] };

/**
 * The scene for a blueprint that `validateBlueprint` accepted against `catalogue`. Parts are drawn where the
 * blueprint stores them; a part on a mirrored mount point, directly or through its host, is drawn as its mirror
 * image (`placeParts`).
 */
export const buildScene = (blueprint: Blueprint | undefined, catalogue: Catalogue): Scene => {
  if (!blueprint) return EMPTY;
  const placements = placeParts(blueprint, catalogue);
  const connected = new Set<string>();
  for (const wire of blueprint.wires) {
    connected.add(portKey(wire.from));
    connected.add(portKey(wire.to));
  }
  const depthOf = (id: PlacedPartId): number => {
    let depth = 0;
    for (let at = placements.get(id); at?.parent !== undefined && depth <= placements.size; at = placements.get(at.parent)) depth++;
    return depth;
  };

  const parts: ScenePart[] = [];
  for (const placed of blueprint.parts) {
    const record = catalogue.parts.get(placed.part);
    if (!record) continue;
    const placement = placements.get(placed.id);
    const layout = layoutPart(record);
    const pose: PartPose = {
      x: placed.position.x,
      y: placed.position.y,
      rotation: placed.rotation,
      mirrored: placement?.placement.mirrored ?? false,
    };
    const ports: ScenePort[] = layout.ports.map((port) => {
      const ref = { part: placed.id, port: port.spec.id };
      const key = portKey(ref);
      return {
        ref,
        key,
        spec: port.spec,
        type: port.type,
        local: port.at,
        at: partToCanvas(pose, port.at),
        ...(port.outward ? { outward: turnToCanvas(pose, port.outward) } : {}),
        layer: port.layer,
        connected: connected.has(key),
      };
    });
    const { w, h } = layout.tile;
    const corners = [
      { x: -w / 2, y: h / 2 },
      { x: w / 2, y: h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: -w / 2, y: -h / 2 },
    ].map((corner) => partToCanvas(pose, corner));
    const sockets = ports.filter((port) => port.layer !== 'none').map((port) => port.at);
    const bounds = unionRect(rectOfPoints(corners), rectOfPoints(sockets, SOCKET_REACH)) as Rect;
    parts.push({
      id: placed.id,
      placed,
      record,
      pose,
      frame: layout.frame,
      held: placement?.by ?? 'root',
      ...(placement?.parent !== undefined ? { parent: placement.parent } : {}),
      depth: depthOf(placed.id),
      z: placement?.placement.z ?? 0,
      tile: layout.tile,
      ports,
      corners,
      bounds,
    });
  }
  parts.sort((a, b) => Number(b.frame) - Number(a.frame) || a.z - b.z || a.depth - b.depth || compareIds(a.id, b.id));

  const partById = new Map(parts.map((part) => [part.id, part]));
  const portByKey = new Map(parts.flatMap((part) => part.ports.map((port) => [port.key, port] as const)));
  const wires: SceneWire[] = [];
  const linkages: SceneWire[] = [];
  for (const wire of [...blueprint.wires].sort((a, b) => compareIds(a.id, b.id))) {
    const from = portByKey.get(portKey(wire.from));
    const to = portByKey.get(portKey(wire.to));
    if (!from || !to) continue;
    const pair = checkPortPair(from.spec, to.spec);
    if (!pair.legal) continue;
    const drawn: SceneWire = { id: wire.id, kind: pair.kind, type: from.type, from, to };
    (from.type === 'mechanical' ? linkages : wires).push(drawn);
  }
  let bounds: Rect | undefined;
  for (const part of parts) bounds = unionRect(bounds, part.bounds);
  const root = robotRoot(placements);
  return {
    parts,
    partById,
    portByKey,
    wires,
    linkages,
    ...(root !== undefined ? { root } : {}),
    ...(bounds ? { bounds } : {}),
  };
};

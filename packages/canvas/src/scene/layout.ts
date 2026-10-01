// A part's tile and where its sockets sit, from the part record alone (ground rule 1): its body size, and its
// ports' types, roles, positions and display order. Never its id, name, family or art. See docs/renderer.md.
import type { PartRecord, PortSpec, PortType, Vec2 } from '@servo/schema';
import { distance } from './geometry.ts';
import { MIN_TILE_MM, PORT_GAP_MM, PORT_MM } from './units.ts';

/** A tile in the part's frame: `w` along its x (forward), `h` along its y (left), centred on its frame origin. */
export interface TileSize {
  readonly w: number;
  readonly h: number;
}

/**
 * Where a socket is drawn:
 * - `ports`: the ports-and-handles layer, above the wires: power and signal ports, shafts and hubs;
 * - `frame`: on the frame it belongs to, in the chassis layer, so a part fixed on it covers it as on a real chassis;
 * - `none`: not drawn. A part's own mount sits under the part, so the mount point it is fixed to stands for it.
 */
export type SocketLayer = 'ports' | 'frame' | 'none';

export interface PortPlace {
  readonly spec: PortSpec;
  readonly type: PortType;
  /** In the part's frame, mm. */
  readonly at: Vec2;
  /** For a socket on the tile's outline: the outward normal in the part's frame. */
  readonly outward?: Vec2;
  readonly layer: SocketLayer;
}

export interface PartLayout {
  readonly tile: TileSize;
  /** In the record's port order (its display order). */
  readonly ports: readonly PortPlace[];
  /** A frame holds other parts: it has at least one mount point. Frames draw in the chassis layer. */
  readonly frame: boolean;
}

/** Power and signal ports have no place in the record, so they go on the tile's outline. */
const onOutline = (spec: PortSpec): boolean => spec.type !== 'mechanical';

const layerOf = (spec: PortSpec): SocketLayer => {
  if (spec.type !== 'mechanical') return 'ports';
  if (spec.role === 'mount-point') return 'frame';
  if (spec.role === 'mount') return 'none';
  return 'ports';
};

/** Socket centres along the outline are this far apart: a socket and a gap. */
const SPACING_MM = PORT_MM + PORT_GAP_MM;

/**
 * The point `t` mm round the outline of a w × h tile from the middle of its back edge (−x). Positive `t` runs up
 * the back towards the part's left (+y), then along its left side and on round; negative `t` runs the other way.
 */
const outlinePoint = (w: number, h: number, t: number): { at: Vec2; outward: Vec2 } => {
  if (t < 0) {
    // The right-hand half is the mirror image of the left, so both sides of the back match exactly.
    const { at, outward } = outlinePoint(w, h, -t);
    return { at: { x: at.x, y: -at.y + 0 }, outward: { x: outward.x, y: -outward.y + 0 } };
  }
  let left = Math.min(t, w + h);
  const segments: readonly { from: Vec2; to: Vec2; outward: Vec2 }[] = [
    { from: { x: -w / 2, y: 0 }, to: { x: -w / 2, y: h / 2 }, outward: { x: -1, y: 0 } },
    { from: { x: -w / 2, y: h / 2 }, to: { x: w / 2, y: h / 2 }, outward: { x: 0, y: 1 } },
    { from: { x: w / 2, y: h / 2 }, to: { x: w / 2, y: 0 }, outward: { x: 1, y: 0 } },
  ];
  for (const [index, segment] of segments.entries()) {
    const length = distance(segment.from, segment.to);
    if (left <= length || index === segments.length - 1) {
      const k = length === 0 ? 0 : Math.min(1, left / length);
      return {
        at: { x: segment.from.x + (segment.to.x - segment.from.x) * k, y: segment.from.y + (segment.to.y - segment.from.y) * k },
        outward: segment.outward,
      };
    }
    left -= length;
  }
  return { at: { x: w / 2, y: 0 }, outward: { x: 1, y: 0 } };
};

/**
 * The first point past `t`, going the way `direction` says, that lies `spacing` from the point at `t` in a straight
 * line, so sockets round a corner keep their distance. Undefined when half the outline is not enough.
 */
const nextAlong = (w: number, h: number, t: number, direction: 1 | -1, spacing: number): number | undefined => {
  const from = outlinePoint(w, h, t).at;
  const half = w + h;
  const steps = 256;
  let previous = 0;
  for (let i = 1; i <= steps; i++) {
    const u = (half * i) / steps;
    if (distance(outlinePoint(w, h, t + direction * u).at, from) < spacing) {
      previous = u;
      continue;
    }
    let low = previous;
    let high = u;
    for (let k = 0; k < 40; k++) {
      const mid = (low + high) / 2;
      if (distance(outlinePoint(w, h, t + direction * mid).at, from) < spacing) low = mid;
      else high = mid;
    }
    return t + direction * high;
  }
  return undefined;
};

/**
 * Where `count` outline sockets go, as distances round the outline, first to last in display order. They sit side
 * by side along the back edge, centred on it, like the terminals at the back of a real motor or the leads out of a
 * battery holder; more than the back edge holds carry on round the corners, the same on both sides. Undefined when
 * the outline cannot hold them.
 */
const outlineStops = (w: number, h: number, count: number): number[] | undefined => {
  if (count === 0) return [];
  const stops: number[] = [];
  let up: number;
  let down: number;
  if (count % 2 === 1) {
    up = 0;
    down = 0;
    stops.push(0);
  } else {
    // The middle pair straddles the centre of the back edge, or sits on its corners if the edge is shorter.
    up = Math.min(SPACING_MM / 2, h / 2);
    down = -up;
    stops.push(up, down);
  }
  while (stops.length < count) {
    const nextUp = nextAlong(w, h, up, 1, SPACING_MM);
    const nextDown = nextAlong(w, h, down, -1, SPACING_MM);
    if (nextUp === undefined || nextDown === undefined) return undefined;
    up = nextUp;
    down = nextDown;
    stops.push(up, down);
  }
  // From the part's left round the back to its right: top to bottom on the canvas at rotation 0.
  return stops.sort((a, b) => b - a);
};

/** Rounds away the last bits of arithmetic noise, so a socket in the middle of an edge sits at exactly 0. */
const tidy = (value: number): number => Math.round(value * 1e9) / 1e9 + 0;

/** Evenly round the whole outline: the last resort for a part with more sockets than any tile size fits. */
const evenStops = (w: number, h: number, count: number): number[] =>
  Array.from({ length: count }, (_, index) => (w + h) - ((index + 0.5) * 2 * (w + h)) / count);

const place = (record: PartRecord, tile: TileSize, lastResort = false): PortPlace[] | undefined => {
  const outline = record.ports.filter(onOutline);
  let stops = outlineStops(tile.w, tile.h, outline.length);
  if (!stops || stops.some((stop) => Math.abs(stop) > tile.w + tile.h)) {
    if (!lastResort) return undefined;
    stops = evenStops(tile.w, tile.h, outline.length);
  }
  return record.ports.map((spec) => {
    const layer = layerOf(spec);
    if (spec.type === 'mechanical') return { spec, type: spec.type, at: { x: spec.at.x, y: spec.at.y }, layer };
    const { at, outward } = outlinePoint(tile.w, tile.h, stops[outline.indexOf(spec)] as number);
    return { spec, type: spec.type, at: { x: tidy(at.x), y: tidy(at.y) }, outward, layer };
  });
};

/**
 * Whether two drawn sockets overlap, where one of them sits on the outline. Shafts and hubs sit where the part has
 * them, so only the outline moves as the tile grows.
 */
const crowded = (ports: readonly PortPlace[]): boolean => {
  const drawn = ports.filter((port) => port.layer === 'ports');
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i] as PortPlace;
      const b = drawn[j] as PortPlace;
      if (!a.outward && !b.outward) continue;
      if (distance(a.at, b.at) < PORT_MM - 1e-9) return true;
    }
  }
  return false;
};

/** Growth steps when sockets crowd a tile: 5% at a time, at most about 20 times larger. */
const GROWTH = 1.05;
const MAX_GROWTH_STEPS = 64;

const cache = new WeakMap<PartRecord, PartLayout>();

/**
 * The tile is the part's footprint (`body.size` x by y), scaled up evenly until its longer side is at least the
 * smallest tile (96 px at default zoom), then, if it must, until its sockets no longer overlap. Power and signal
 * sockets sit side by side along the back edge in the record's port order, a socket and a gap apart, and round
 * the corners when there are more. Mechanical ports sit where the record puts them (`at`), so mated shafts and
 * hubs, and mounts and mount points, meet exactly.
 */
export const layoutPart = (record: PartRecord): PartLayout => {
  const cached = cache.get(record);
  if (cached) return cached;
  const footprint = { w: Math.max(record.body.size.x, 1e-3), h: Math.max(record.body.size.y, 1e-3) };
  let scale = Math.max(1, MIN_TILE_MM / Math.max(footprint.w, footprint.h));
  let tile: TileSize = { w: footprint.w * scale, h: footprint.h * scale };
  let ports = place(record, tile);
  for (let step = 0; step < MAX_GROWTH_STEPS && (!ports || crowded(ports)); step++) {
    scale *= GROWTH;
    tile = { w: footprint.w * scale, h: footprint.h * scale };
    ports = place(record, tile);
  }
  const layout: PartLayout = {
    tile,
    ports: ports ?? (place(record, tile, true) as PortPlace[]),
    frame: record.ports.some((spec) => spec.type === 'mechanical' && spec.role === 'mount-point'),
  };
  cache.set(record, layout);
  return layout;
};

// Pixel probes on what a build must show, read from a real screenshot against the scene's own geometry, with no
// reference image (so they guard the references too):
// - every power and signal line in its colour, red or yellow (brief Section 13), along the stretch of it no socket
//   and no other line covers;
// - every part's tile and picture: wherever nothing drawn after the part covers it, the colour its tile and picture
//   give there, with the picture rasterised from the art registry and laid in the tile as the canvas lays it. A point
//   counts only where that colour differs from what would show there without the part: the tile under it, or the
//   workbench. So a missing part fails its probe even where it sat on another.
// A line or part with too little uncovered to judge is not probed, and the result says so. Runs in the browser;
// `expectedColour`, the model of a tile, is pure. See README.md, "Screenshots".
import type { Content } from '@servo/content';
import type { PartTypeId, Vec2 } from '@servo/schema';
import type { Bench, RendererHooks, SceneLine, SceneTile } from './bench.ts';
import { colourDistance, colourName, rgbOf } from './pixels.ts';
import type { Rgb } from './pixels.ts';
import type { Shot } from './screenshots.ts';

/** docs/renderer.md: 2.5 screen pixels per millimetre at zoom 1, and every size below is pixels at zoom 1. */
const PX_PER_MM = 2.5;
/** Brief Section 9: a socket is 44 px across (a hexagon's corners reach 0.6 of that out). */
const SOCKET_REACH_PX = 0.6 * 44;
/** Brief Section 9: a line is 6 px wide; with its darker edge and a pixel of anti-aliasing, 5 px either side. */
const LINE_REACH_PX = 5;
/** docs/renderer.md: a linkage is 10 px wide, drawn under the parts; 7 px either side. */
const LINKAGE_REACH_PX = 7;
/** Kept clear of a covering socket or line beyond its reach, and of a tile's rounded corners and edge, for anti-aliasing. */
const MARGIN_PX = 2;
/** The renderer's tile (packages/canvas/src/renderer/views.ts): corners rounded 8 px, the picture 5 px in from the edge. */
const TILE_RADIUS_PX = 8;
const TILE_PADDING_PX = 5;
/** The light palette's tile and workbench (packages/canvas/src/renderer/style.ts): the canvas exposes no palette. */
const TILE = rgbOf(0xf8f6f2);
const WORKBENCH = rgbOf(0xebe8e3);
/** Pictures are rasterised at this many pixels per CSS pixel of their SVG: enough to read the colour of each face. */
const PICTURE_SCALE = 2;
/** Samples along a line, and across a tile's bounding box in each direction. */
const LINE_SAMPLES = 48;
const TILE_SAMPLES = 48;
/** Fewer uncovered samples than this, and a line or part is not probed. */
const MIN_LINE_SAMPLES = 4;
const MIN_TILE_SAMPLES = 12;
/**
 * The share of a line's uncovered samples that must show its colour. On the content fixtures every power line's samples
 * all read red, and with the line taken out at most 69% still did (where it crossed a red battery pack). A signal line
 * is dashed (12 px dash, 7 px gap), so less of it is yellow; no content fixture has one yet to measure.
 */
const LINE_SHARE: Readonly<Record<string, number>> = { power: 0.9, signal: 0.3 };
/**
 * A part's point counts where its tile and picture give one colour for FLAT_REACH_PX around: no face edge, outline or
 * anti-aliasing within reach moves it by more than FLAT in any channel. The screen may show that colour off by NOISE,
 * and by FLAT more where it varies at all within reach. A point counts only where what would show there without the
 * part is further from it than both allowances together, so a missing part never passes for a present one. (The
 * tile and the workbench differ by 15.)
 */
const FLAT_REACH_PX = 2;
const FLAT = 6;
const NOISE = 3;
/** The share of a part's counted points that must show its colours. */
const PART_SHARE = 0.9;

/** A part type's picture, rasterised: RGBA rows from the top, not premultiplied. */
export interface Picture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type Pictures = ReadonlyMap<PartTypeId, Picture>;

/** Every part type's picture from the art registry, rasterised in the browser as an image, the way the canvas loads it. */
export const loadPictures = async (content: Content): Promise<Pictures> => {
  const pictures = new Map<PartTypeId, Picture>();
  for (const part of content.parts) {
    const src = content.art.get(part.identity.art)?.src;
    if (!src) continue;
    const image = new Image();
    image.src = src;
    await image.decode();
    const width = Math.round(image.naturalWidth * PICTURE_SCALE);
    const height = Math.round(image.naturalHeight * PICTURE_SCALE);
    const context = new OffscreenCanvas(width, height).getContext('2d');
    if (!context) throw new Error('No 2D canvas to rasterise the pictures in.');
    context.drawImage(image, 0, 0, width, height);
    pictures.set(part.id, { width, height, data: context.getImageData(0, 0, width, height).data });
  }
  return pictures;
};

/** The colour expected at a point, and how far in any channel the screen may be from it there. */
export interface Expected {
  readonly colour: Rgb;
  readonly tolerance: number;
}

/**
 * The colour a tile and its picture give at screen point `p`, or undefined where that is not one clear colour: near the
 * tile's edge or rounded corners, or within FLAT_REACH_PX of a change in the picture. `corners` are the tile's corners
 * on screen in the scene's order (clockwise from the back left, so the first is the top left of the tile as drawn, the
 * second its top right and the fourth its bottom left), and `size` the tile in mm. The picture is fitted inside the
 * padding, centred, in its own proportions, and turns and flips with the tile (docs/renderer.md, "Parts").
 */
export const expectedColour = (corners: readonly Vec2[], size: { readonly w: number; readonly h: number }, picture: Picture, p: Vec2): Expected | undefined => {
  const [c0, c1, , c3] = corners as [Vec2, Vec2, Vec2, Vec2];
  const across = { x: c1.x - c0.x, y: c1.y - c0.y };
  const down = { x: c3.x - c0.x, y: c3.y - c0.y };
  const width = Math.hypot(across.x, across.y);
  const height = Math.hypot(down.x, down.y);
  const det = across.x * down.y - across.y * down.x;
  if (det === 0) return undefined;
  // `p` in the tile's own frame, in screen pixels from its top left.
  const dx = p.x - c0.x;
  const dy = p.y - c0.y;
  const x = ((dx * down.y - dy * down.x) / det) * width;
  const y = ((across.x * dy - across.y * dx) / det) * height;
  const px = width / size.w / PX_PER_MM;
  const clear = TILE_RADIUS_PX * px + MARGIN_PX;
  if (x < clear || y < clear || width - x < clear || height - y < clear) return undefined;
  const padding = TILE_PADDING_PX * px;
  const fit = Math.min((width - 2 * padding) / picture.width, (height - 2 * padding) / picture.height);
  const left = (width - fit * picture.width) / 2;
  const top = (height - fit * picture.height) / 2;
  const colourAt = (at: Vec2): Rgb => {
    const column = Math.floor((at.x - left) / fit);
    const row = Math.floor((at.y - top) / fit);
    if (column < 0 || row < 0 || column >= picture.width || row >= picture.height) return TILE;
    const i = (row * picture.width + column) * 4;
    const alpha = (picture.data[i + 3] as number) / 255;
    const over = (channel: 0 | 1 | 2): number => Math.round((picture.data[i + channel] as number) * alpha + TILE[channel] * (1 - alpha));
    return [over(0), over(1), over(2)];
  };
  const centre = colourAt({ x, y });
  let spread = 0;
  for (const reach of [FLAT_REACH_PX / 2, FLAT_REACH_PX]) {
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4;
      spread = Math.max(spread, colourDistance(colourAt({ x: x + reach * Math.cos(angle), y: y + reach * Math.sin(angle) }), centre));
    }
  }
  if (spread > FLAT) return undefined;
  return { colour: centre, tolerance: spread > 0 ? NOISE + FLAT : NOISE };
};

export interface Probe {
  /** For messages: `w3 power line` or `p2 dc-motor`. */
  readonly what: string;
  readonly kind: 'line' | 'part';
  readonly id: string;
  /** Uncovered samples that count. */
  readonly samples: number;
  /** Of those, the samples in the expected colour. */
  readonly hits: number;
  /** Enough samples to judge. */
  readonly probed: boolean;
  /** Probed and seen, or not probed. */
  readonly seen: boolean;
}

type Segment = readonly [Vec2, Vec2];

const distanceToSegment = (p: Vec2, [a, b]: Segment): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const distanceToPath = (p: Vec2, path: readonly Vec2[]): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (let k = 1; k < path.length; k++) nearest = Math.min(nearest, distanceToSegment(p, [path[k - 1] as Vec2, path[k] as Vec2]));
  return nearest;
};

/** The point a fraction `t` of the way along a path, by length. */
const alongPath = (path: readonly Vec2[], t: number): Vec2 => {
  const lengths = path.slice(1).map((point, k) => Math.hypot(point.x - (path[k] as Vec2).x, point.y - (path[k] as Vec2).y));
  let left = t * lengths.reduce((sum, length) => sum + length, 0);
  for (const [k, length] of lengths.entries()) {
    const a = path[k] as Vec2;
    const b = path[k + 1] as Vec2;
    if (left <= length) {
      const s = length === 0 ? 0 : left / length;
      return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
    }
    left -= length;
  }
  return path[path.length - 1] as Vec2;
};

/** Whether `p` lies inside a convex polygon given in order (either way round). */
const inside = (p: Vec2, polygon: readonly Vec2[]): boolean => {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[(i + 1) % polygon.length] as Vec2;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
};

interface ScreenTile {
  readonly tile: SceneTile;
  readonly corners: readonly Vec2[];
}

/** The scene as the screen shows it now, in CSS pixels: every drawn socket, the lines, the linkages, and the tiles in draw order. */
interface Screen {
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  readonly sockets: readonly Vec2[];
  /** Each line along the path it is drawn on: straight, or bent where a press could not reach it (task 7.9). */
  readonly lines: readonly { readonly line: SceneLine; readonly path: readonly Vec2[] }[];
  /** Further lines that cover what they cross, not probed: a changed build's lines as drawn now. */
  readonly covers: readonly (readonly Vec2[])[];
  readonly linkages: readonly Segment[];
  readonly tiles: readonly ScreenTile[];
}

/** Canvas paths by line id, as drawn: the paths a probe follows. */
export type LinePaths = ReadonlyMap<string, readonly Vec2[]>;

/** The paths the bench draws its lines on now (the canvas's testing entry), to probe a later build by. */
export const drawnPaths = (bench: Bench): LinePaths =>
  new Map(bench.hooks.scene.wires.flatMap((line) => {
    const path = bench.probe.wire(line.id)?.path.map((place) => place.world);
    return path ? [[line.id, path] as const] : [];
  }));

const screenOf = (camera: RendererHooks['camera'], scene: RendererHooks['scene'], zoom: number, paths: LinePaths, covers: LinePaths): Screen => {
  const to = (p: Vec2): Vec2 => camera.worldToScreen(p);
  return {
    zoom,
    width: camera.width,
    height: camera.height,
    sockets: [...scene.portByKey.values()].filter((socket) => socket.layer !== 'none').map((socket) => to(socket.at)),
    lines: scene.wires.map((line) => ({ line, path: (paths.get(line.id) ?? [line.from.at, line.to.at]).map(to) })),
    covers: [...covers.values()].map((path) => path.map(to)),
    linkages: scene.linkages.map((line) => [to(line.from.at), to(line.to.at)] as const),
    tiles: scene.parts.map((tile) => ({ tile, corners: tile.corners.map(to) })),
  };
};

const onScreen = (screen: Screen, p: Vec2): boolean => p.x >= 0 && p.y >= 0 && p.x < screen.width && p.y < screen.height;

const nearSocket = (screen: Screen, p: Vec2): boolean =>
  screen.sockets.some((socket) => Math.hypot(p.x - socket.x, p.y - socket.y) <= SOCKET_REACH_PX * screen.zoom + MARGIN_PX);

const nearLine = (screen: Screen, p: Vec2, except?: string): boolean =>
  screen.lines.some(({ line, path }) => line.id !== except && distanceToPath(p, path) <= LINE_REACH_PX * screen.zoom + MARGIN_PX) ||
  screen.covers.some((path) => distanceToPath(p, path) <= LINE_REACH_PX * screen.zoom + MARGIN_PX);

const nearLinkage = (screen: Screen, p: Vec2): boolean =>
  screen.linkages.some((segment) => distanceToSegment(p, segment) <= LINKAGE_REACH_PX * screen.zoom + MARGIN_PX);

const probeLine = (screen: Screen, shot: Shot, entry: Screen['lines'][number]): Probe => {
  const { line, path } = entry;
  const expected = line.type === 'signal' ? 'yellow' : 'red';
  let samples = 0;
  let hits = 0;
  for (let k = 0; k <= LINE_SAMPLES; k++) {
    const t = 0.05 + (0.9 * k) / LINE_SAMPLES;
    const p = alongPath(path, t);
    if (!onScreen(screen, p) || nearSocket(screen, p) || nearLine(screen, p, line.id)) continue;
    samples += 1;
    if (colourName(shot.at(p)) === expected) hits += 1;
  }
  const probed = samples >= MIN_LINE_SAMPLES;
  return {
    what: `${line.id} ${line.type} line`,
    kind: 'line',
    id: line.id,
    samples,
    hits,
    probed,
    seen: !probed || hits >= (LINE_SHARE[line.type] ?? 0.6) * samples,
  };
};

const tileColour = (pictures: Pictures, entry: ScreenTile, p: Vec2): Expected | undefined => {
  const picture = pictures.get(entry.tile.record.id);
  if (!picture) throw new Error(`No picture for ${entry.tile.record.id}: the bench draws every part with its picture.`);
  return expectedColour(entry.corners, entry.tile.tile, picture, p);
};

/** Inside a tile, or close enough to its edge to catch its anti-aliasing. */
const onTile = (p: Vec2, corners: readonly Vec2[]): boolean =>
  inside(p, corners) || corners.some((corner, i) => distanceToSegment(p, [corner, corners[(i + 1) % corners.length] as Vec2]) <= MARGIN_PX);

const BARE: Expected = { colour: WORKBENCH, tolerance: NOISE };

const probeTile = (screen: Screen, shot: Shot, index: number, pictures: Pictures): Probe => {
  const entry = screen.tiles[index] as ScreenTile;
  const { tile, corners } = entry;
  const over = screen.tiles.slice(index + 1);
  const under = screen.tiles.slice(0, index).reverse();
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let samples = 0;
  let hits = 0;
  for (let i = 0; i < TILE_SAMPLES; i++) {
    for (let j = 0; j < TILE_SAMPLES; j++) {
      const p = { x: minX + ((maxX - minX) * (i + 0.5)) / TILE_SAMPLES, y: minY + ((maxY - minY) * (j + 0.5)) / TILE_SAMPLES };
      if (!onScreen(screen, p) || !inside(p, corners) || over.some((other) => onTile(p, other.corners))) continue;
      if (nearSocket(screen, p) || nearLine(screen, p) || nearLinkage(screen, p)) continue;
      const own = tileColour(pictures, entry, p);
      if (!own) continue;
      // What would show here without the part: the topmost tile drawn before it, or the bare workbench.
      const below = under.find((other) => inside(p, other.corners));
      const without = below ? tileColour(pictures, below, p) : BARE;
      if (!without || colourDistance(own.colour, without.colour) <= own.tolerance + without.tolerance) continue;
      samples += 1;
      if (colourDistance(shot.at(p), own.colour) <= own.tolerance) hits += 1;
    }
  }
  const probed = samples >= MIN_TILE_SAMPLES;
  return {
    what: `${tile.id} ${tile.record.id}`,
    kind: 'part',
    id: tile.id,
    samples,
    hits,
    probed,
    seen: !probed || hits >= PART_SHARE * samples,
  };
};

/**
 * Probes every line and part of the build on the bench in `shot` (a screenshot of the bench's canvas, in Build mode).
 * `scene` and `paths` are the geometry to probe by: the bench's own by default, or recorded earlier (`drawnPaths`), to
 * probe a changed build for what it lost. `covers` are lines drawn now that cover what they cross: with a line taken out
 * another may lose its bend and run where the lost one was.
 */
export const probeBuild = (
  bench: Bench,
  shot: Shot,
  pictures: Pictures,
  scene: RendererHooks['scene'] = bench.hooks.scene,
  paths: LinePaths = drawnPaths(bench),
  covers: LinePaths = new Map(),
): readonly Probe[] => {
  const screen = screenOf(bench.hooks.camera, scene, bench.handle.zoom, paths, covers);
  return [...screen.lines.map((entry) => probeLine(screen, shot, entry)), ...screen.tiles.map((_, index) => probeTile(screen, shot, index, pictures))];
};

export const describeProbe = (probe: Probe): string =>
  `${probe.what}: ${probe.hits} of ${probe.samples} uncovered samples in its ${probe.kind === 'line' ? 'colour' : 'tile’s and picture’s colours'}` +
  (probe.probed ? '' : ' (too few to judge)');

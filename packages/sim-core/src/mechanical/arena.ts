import type { ArenaPreset, Prop, Ramp, Vec2 } from '@servo/schema';
import { cosSin } from '@servo/schema';
import { clean, length } from './maths.ts';
import type { ArenaModel, FloorRamp, PropModel, Solid } from './types.ts';

/**
 * The arena as the mechanical solver reads it (arena frame: x to the right, y up, millimetres; packages/schema/src/types/arena.ts).
 * Walls, the floor's edges and the ramps' drops are solids the robot bumps into; props are bodies; ramps give the floor
 * its height. Built once per Run from the preset and the child's props, with no physics engine involved.
 */

/** How far the floor's edge walls reach past the floor, mm: thick enough that nothing passes through in one substep. */
export const EDGE_THICKNESS_MM = 200;

/** A ramp edge is a drop (a ledge) where the floor on either side differs by more than this, mm. */
export const LEDGE_MM = 1;

/** Ledges are found by sampling a ramp's edges at most this far apart, mm. */
const LEDGE_SAMPLE_MM = 10;

/** How far outside a ramp's edge the floor beyond it is read, mm. */
const OUTSIDE_MM = 0.5;

/** A ledge is a wall this thick, centred on the ramp's edge, mm. */
const LEDGE_THICKNESS_MM = 4;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const rampOf = (ramp: Ramp): FloorRamp => {
  const x0 = Math.min(ramp.from.x, ramp.to.x);
  const x1 = Math.max(ramp.from.x, ramp.to.x);
  const y0 = Math.min(ramp.from.y, ramp.to.y);
  const y1 = Math.max(ramp.from.y, ramp.to.y);
  const run = ramp.uphill === '+x' || ramp.uphill === '-x' ? x1 - x0 : y1 - y0;
  const rise = run > 0 ? ramp.riseMm / run : 0;
  const gradient =
    ramp.uphill === '+x' ? { x: rise, y: 0 } : ramp.uphill === '-x' ? { x: -rise, y: 0 } : ramp.uphill === '+y' ? { x: 0, y: rise } : { x: 0, y: -rise };
  return { id: ramp.id, x0, y0, x1, y1, riseMm: ramp.riseMm, uphill: ramp.uphill, gradient };
};

const inside = (ramp: FloorRamp, x: number, y: number): boolean => x >= ramp.x0 && x <= ramp.x1 && y >= ramp.y0 && y <= ramp.y1;

/** A ramp's height at a point inside its rectangle: 0 along its low edge, riseMm along its high edge. */
const rampHeight = (ramp: FloorRamp, x: number, y: number): number => {
  switch (ramp.uphill) {
    case '+x':
      return ramp.x1 > ramp.x0 ? (ramp.riseMm * (x - ramp.x0)) / (ramp.x1 - ramp.x0) : 0;
    case '-x':
      return ramp.x1 > ramp.x0 ? (ramp.riseMm * (ramp.x1 - x)) / (ramp.x1 - ramp.x0) : 0;
    case '+y':
      return ramp.y1 > ramp.y0 ? (ramp.riseMm * (y - ramp.y0)) / (ramp.y1 - ramp.y0) : 0;
    case '-y':
      return ramp.y1 > ramp.y0 ? (ramp.riseMm * (ramp.y1 - y)) / (ramp.y1 - ramp.y0) : 0;
  }
};

/**
 * The floor's height at a point, mm, and its gradient there (rise per mm along x and y). A ramp rises only inside its
 * own rectangle; elsewhere the floor is flat at 0. Where ramps overlap, the highest wins, ties going to the first by id.
 */
export const floorAt = (ramps: readonly FloorRamp[], x: number, y: number): { readonly height: number; readonly gradient: Vec2 } => {
  let height = 0;
  let gradient: Vec2 = { x: 0, y: 0 };
  for (const ramp of ramps) {
    if (!inside(ramp, x, y)) continue;
    const here = rampHeight(ramp, x, y);
    if (here > height) {
      height = here;
      gradient = ramp.gradient;
    }
  }
  return { height, gradient };
};

/** A rectangle of the given thickness centred on a segment, as four corners counter-clockwise. */
const thickSegment = (from: Vec2, to: Vec2, thickness: number): readonly Vec2[] | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const size = length(dx, dy);
  if (!(size > 0) || !(thickness > 0)) return undefined;
  const nx = (-dy / size) * (thickness / 2);
  const ny = (dx / size) * (thickness / 2);
  return [
    { x: from.x - nx, y: from.y - ny },
    { x: to.x - nx, y: to.y - ny },
    { x: to.x + nx, y: to.y + ny },
    { x: from.x + nx, y: from.y + ny },
  ];
};

const box = (x0: number, y0: number, x1: number, y1: number): readonly Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The floor's four edges, as walls just outside it, so the robot bumps and stops rather than leaving. */
const edgesOf = (size: Vec2): Solid[] => {
  const t = EDGE_THICKNESS_MM;
  return [
    { kind: 'edge', id: 'east', corners: box(size.x, -t, size.x + t, size.y + t) },
    { kind: 'edge', id: 'north', corners: box(-t, size.y, size.x + t, size.y + t) },
    { kind: 'edge', id: 'south', corners: box(-t, -t, size.x + t, 0) },
    { kind: 'edge', id: 'west', corners: box(-t, -t, 0, size.y + t) },
  ];
};

interface RampEdge {
  readonly side: string;
  readonly from: Vec2;
  readonly to: Vec2;
  /** Unit normal pointing out of the ramp. */
  readonly out: Vec2;
}

/** A ramp's edges other than its low one: the high edge and the two sides, where the floor can drop away. */
const raisedEdges = (ramp: FloorRamp): readonly RampEdge[] => {
  const { x0, y0, x1, y1 } = ramp;
  const all: Record<'+x' | '-x' | '+y' | '-y', RampEdge> = {
    '+x': { side: 'east', from: { x: x1, y: y0 }, to: { x: x1, y: y1 }, out: { x: 1, y: 0 } },
    '-x': { side: 'west', from: { x: x0, y: y0 }, to: { x: x0, y: y1 }, out: { x: -1, y: 0 } },
    '+y': { side: 'north', from: { x: x0, y: y1 }, to: { x: x1, y: y1 }, out: { x: 0, y: 1 } },
    '-y': { side: 'south', from: { x: x0, y: y0 }, to: { x: x1, y: y0 }, out: { x: 0, y: -1 } },
  };
  const low = ramp.uphill === '+x' ? '-x' : ramp.uphill === '-x' ? '+x' : ramp.uphill === '+y' ? '-y' : '+y';
  return (['+x', '-x', '+y', '-y'] as const).filter((side) => side !== low).map((side) => all[side]);
};

/**
 * Where a ramp's edge drops to a lower floor, or rises from it, by more than LEDGE_MM: the schema says nothing about the
 * floor past a ramp's high edge or beside it, so the conservative reading makes each such drop a wall, like the floor's
 * own edge. The robot bumps and stops at it rather than driving off. Ramps that meet at the same height (a ridge) and
 * edges on or past the floor's boundary make none. Each ledge is a run of edge samples LEDGE_SAMPLE_MM apart at most.
 */
const ledgesOf = (ramps: readonly FloorRamp[], size: Vec2): Solid[] => {
  const ledges: Solid[] = [];
  const onFloor = (x: number, y: number): boolean => x > 0 && x < size.x && y > 0 && y < size.y;
  for (const ramp of ramps) {
    for (const edge of raisedEdges(ramp)) {
      const span = length(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
      const count = Math.max(1, Math.ceil(span / LEDGE_SAMPLE_MM));
      let start: number | undefined;
      const close = (end: number, index: number): void => {
        const at = (k: number): Vec2 => ({
          x: clean(edge.from.x + ((edge.to.x - edge.from.x) * k) / count),
          y: clean(edge.from.y + ((edge.to.y - edge.from.y) * k) / count),
        });
        const corners = thickSegment(at(start ?? 0), at(end), LEDGE_THICKNESS_MM);
        if (corners) ledges.push({ kind: 'ledge', id: `${ramp.id}-${edge.side}-${index}`, corners });
      };
      let runs = 0;
      for (let k = 0; k < count; k += 1) {
        const t = (k + 0.5) / count;
        const x = edge.from.x + (edge.to.x - edge.from.x) * t;
        const y = edge.from.y + (edge.to.y - edge.from.y) * t;
        const outX = x + edge.out.x * OUTSIDE_MM;
        const outY = y + edge.out.y * OUTSIDE_MM;
        const drop = onFloor(outX, outY) && Math.abs(rampHeight(ramp, x, y) - floorAt(ramps, outX, outY).height) > LEDGE_MM;
        if (drop && start === undefined) start = k;
        if (!drop && start !== undefined) {
          close(k, runs);
          runs += 1;
          start = undefined;
        }
      }
      if (start !== undefined) close(count, runs);
    }
  }
  return ledges;
};

const propOf = (prop: Prop): PropModel => {
  const [cos, sin] = cosSin(prop.at.heading);
  const round = prop.shape === 'cylinder';
  const hx = prop.size.x / 2;
  const hy = round ? prop.size.x / 2 : prop.size.y / 2;
  // How far the footprint reaches from its centre, for quick distance checks.
  const reach = round ? hx : length(hx, hy);
  // Radius of gyration of the footprint about its centre: a box's √((x² + y²) / 12), a disc's r / √2.
  const gyration = round ? hx / Math.SQRT2 : Math.sqrt((prop.size.x * prop.size.x + prop.size.y * prop.size.y) / 12);
  return {
    id: prop.id,
    subject: `arena:${prop.id}`,
    shape: prop.shape,
    hx,
    hy,
    reach,
    gyration,
    kilograms: prop.grams / 1000,
    fixed: prop.fixed,
    at: prop.at,
    cos,
    sin,
  };
};

/**
 * The arena a Run happens in: the preset with the child's props added (the blueprint's `arena.props`, which keep their
 * ids apart from the preset's). Solids in a fixed order: walls in the preset's order, then the floor's edges, then
 * ledges; props in id order.
 */
export const arenaModel = (preset: ArenaPreset, childProps: readonly Prop[] = []): ArenaModel => {
  const ramps = [...preset.ramps].sort((a, b) => compareText(a.id, b.id)).map(rampOf);
  const walls: Solid[] = [];
  for (const wall of preset.walls) {
    const corners = thickSegment(wall.from, wall.to, wall.thicknessMm);
    if (corners) walls.push({ kind: 'wall', id: wall.id, corners });
  }
  const props = [...preset.props, ...childProps].sort((a, b) => compareText(a.id, b.id)).map(propOf);
  return {
    size: preset.size,
    friction: preset.friction,
    start: preset.start,
    ramps,
    solids: [...walls, ...edgesOf(preset.size), ...ledgesOf(ramps, preset.size)],
    props,
  };
};

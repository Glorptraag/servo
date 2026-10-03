// The arena floor and props, the bottom layer (brief Section 9): a matte floor darker than the workbench with a
// clear boundary, its walls, zones, lines and ramps, and every prop, the preset's and the child's. Drawn in canvas
// millimetres where `layArena` lays the floor. Task 3.5 moves the props in Run mode.
import { Graphics } from 'pixi.js';
import { cosSin } from '@servo/schema';
import type { ArenaFeatureId, Pose, Prop, Vec2 } from '@servo/schema';
import { arenaToCanvas } from '../scene/arena.ts';
import type { ArenaMatrix, SceneArena } from '../scene/arena.ts';
import { mmOf } from '../scene/units.ts';
import type { Palette } from './style.ts';

const EDGE_MM = 6;
const OUTLINE_MM = mmOf(2);

const flat = (points: readonly Vec2[]): number[] => points.flatMap((point) => [point.x, point.y]);

const rectangle = (m: ArenaMatrix, from: Vec2, to: Vec2): number[] =>
  flat(
    [
      { x: from.x, y: from.y },
      { x: to.x, y: from.y },
      { x: to.x, y: to.y },
      { x: from.x, y: to.y },
    ].map((point) => arenaToCanvas(m, point)),
  );

/** A wall: the band `thickness` wide along the segment. */
const band = (m: ArenaMatrix, from: Vec2, to: Vec2, thickness: number): number[] => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = (-dy / length) * (thickness / 2);
  const ny = (dx / length) * (thickness / 2);
  return flat(
    [
      { x: from.x + nx, y: from.y + ny },
      { x: to.x + nx, y: to.y + ny },
      { x: to.x - nx, y: to.y - ny },
      { x: from.x - nx, y: from.y - ny },
    ].map((point) => arenaToCanvas(m, point)),
  );
};

/** A box prop's footprint, turned by its heading (degrees counter-clockwise in the arena). */
const boxFootprint = (m: ArenaMatrix, prop: Prop): number[] => {
  const [c, s] = cosSin(prop.at.heading);
  const hx = prop.size.x / 2;
  const hy = prop.size.y / 2;
  return flat(
    [
      { x: -hx, y: -hy },
      { x: hx, y: -hy },
      { x: hx, y: hy },
      { x: -hx, y: hy },
    ].map((corner) => arenaToCanvas(m, { x: prop.at.x + c * corner.x - s * corner.y, y: prop.at.y + s * corner.x + c * corner.y })),
  );
};

/**
 * Three pieces, so Build and Run can look different on one surface: in Build mode the workbench shows through and
 * the arena's features and props are faint; Run lays the matte floor down and brings everything up in full.
 */
export class ArenaView {
  readonly floor = new Graphics({ label: 'arena floor' });
  readonly features = new Graphics({ label: 'arena features' });
  readonly props = new Graphics({ label: 'arena props' });

  draw(arena: SceneArena | undefined, palette: Palette): void {
    this.floor.clear();
    this.features.clear();
    this.props.clear();
    if (!arena) return;
    const { matrix: m, preset } = arena;
    const features = this.features;
    this.floor.poly(flat(arena.corners), true).fill({ color: palette.floor });
    for (const zone of preset.zones) {
      features.poly(rectangle(m, zone.from, zone.to), true).fill({ color: palette.zone, alpha: 0.45 });
    }
    for (const ramp of preset.ramps) {
      features
        .poly(rectangle(m, ramp.from, ramp.to), true)
        .fill({ color: palette.ramp })
        .stroke({ color: palette.floorEdge, width: OUTLINE_MM, alignment: 1 });
    }
    for (const line of preset.lines) {
      const points = line.points.map((point) => arenaToCanvas(m, point));
      const [first, ...rest] = points;
      if (!first) continue;
      features.moveTo(first.x, first.y);
      for (const point of rest) features.lineTo(point.x, point.y);
      features.stroke({ color: palette.floorLine, width: line.widthMm, cap: 'round', join: 'round' });
    }
    for (const wall of preset.walls) {
      features.poly(band(m, wall.from, wall.to, wall.thicknessMm), true).fill({ color: palette.wall });
    }
    features.poly(flat(arena.corners), true).stroke({ color: palette.floorEdge, width: EDGE_MM, alignment: 0 });
    this.drawProps(arena, palette);
  }

  /**
   * The props, the preset's and the child's. In Run mode (task 3.5) a prop the robot pushed is drawn where the Run has
   * it (`moved`, arena mm); the rest stay where the arena puts them.
   */
  drawProps(arena: SceneArena | undefined, palette: Palette, moved?: ReadonlyMap<ArenaFeatureId, Pose>): void {
    this.props.clear();
    if (!arena) return;
    const { matrix: m } = arena;
    for (const placed of arena.props) {
      const at = moved?.get(placed.id);
      const prop = at ? { ...placed, at } : placed;
      const fill = { color: prop.fixed ? palette.propFixed : palette.prop };
      const edge = { color: palette.propEdge, width: OUTLINE_MM, alignment: 1 };
      if (prop.shape === 'cylinder') {
        const centre = arenaToCanvas(m, { x: prop.at.x, y: prop.at.y });
        this.props.circle(centre.x, centre.y, prop.size.x / 2).fill(fill).stroke(edge);
      } else {
        this.props.poly(boxFootprint(m, prop), true).fill(fill).stroke(edge);
      }
    }
  }
}

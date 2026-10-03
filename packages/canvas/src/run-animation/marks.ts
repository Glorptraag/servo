// What a Run leaves on the arena floor, under the robot: the shadow of a tilted or fallen body, on the side it leans
// to, and scrape marks where a dragging frame's low edge passes (brief Section 11: a grounded frame scrapes). Drawn
// in the arena's group, above its features and under its props and the build. See docs/run-animation.md.
import { Container, Graphics } from 'pixi.js';
import type { PlacedPartId, Vec2 } from '@servo/schema';
import type { ScenePart } from '../scene/scene.ts';
import type { Palette } from '../renderer/style.ts';
import type { Affine } from './affine.ts';
import { apply, compose, nodeMatrix } from './affine.ts';
import { SCRAPE_ALPHA, SCRAPE_MAX_POINTS, SCRAPE_WIDTH_MM, SHADOW_ALPHA, SHADOW_FROM_DEG, SHADOW_REACH_MM } from './look.ts';
import type { BodyPose } from './state.ts';

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The three points of a body's low edge that scrape, in its part frame (x forward, y left): across the rear edge when
 * its front is up, the front edge when its front is down, or a side edge when it rolls further than it pitches.
 */
export const lowEdge = (part: ScenePart, pose: BodyPose): readonly Vec2[] => {
  const hx = part.record.body.size.x / 2;
  const hy = part.record.body.size.y / 2;
  const across = [-0.8, 0, 0.8];
  if (Math.abs(pose.roll) > Math.abs(pose.pitch)) {
    const y = pose.roll > 0 ? -hy : hy;
    return across.map((f) => ({ x: f * hx, y }));
  }
  const x = pose.pitch >= 0 ? -hx : hx;
  return across.map((f) => ({ x, y: f * hy }));
};

/** A body's dragging edge on the canvas, for the transform that places its root part. */
export const edgeOnCanvas = (part: ScenePart, pose: BodyPose, body: Affine): readonly Vec2[] => {
  const node = compose(body, nodeMatrix(part.pose));
  return lowEdge(part, pose).map((point) => apply(node, { x: point.x, y: -point.y }));
};

interface Stroke {
  /** Three scratches, each a polyline of canvas points. */
  readonly tracks: Vec2[][];
}

export class FloorMarks {
  readonly container = new Container({ label: 'run marks' });
  private readonly shadows = new Graphics({ label: 'shadows' });
  private readonly scrapes = new Graphics({ label: 'scrapes' });
  private readonly strokes = new Map<PlacedPartId, Stroke[]>();
  private readonly open = new Set<PlacedPartId>();
  private dirty = false;
  private shadowed = false;

  constructor() {
    this.container.addChild(this.shadows, this.scrapes);
  }

  /** Forgets every mark: a new Run. */
  reset(): void {
    this.strokes.clear();
    this.open.clear();
    this.shadows.clear();
    this.scrapes.clear();
    this.dirty = false;
    this.shadowed = false;
  }

  /** At each tick: extends the scratches of each dragging body; a body that stopped dragging ends its stroke. */
  record(dragging: ReadonlyMap<PlacedPartId, readonly Vec2[]>): void {
    for (const id of [...this.open]) {
      if (!dragging.has(id)) this.open.delete(id);
    }
    for (const [id, edge] of dragging) {
      const strokes = this.strokes.get(id) ?? [];
      this.strokes.set(id, strokes);
      let stroke = this.open.has(id) ? strokes[strokes.length - 1] : undefined;
      if (!stroke) {
        stroke = { tracks: edge.map(() => []) };
        strokes.push(stroke);
        this.open.add(id);
      }
      stroke.tracks.forEach((track, index) => {
        const point = edge[index];
        if (!point) return;
        const last = track[track.length - 1];
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.5) return;
        track.push(point);
        if (track.length > SCRAPE_MAX_POINTS) track.splice(0, track.length - SCRAPE_MAX_POINTS);
      });
      this.dirty = true;
    }
  }

  /** The scratches of a body as drawn: for tests and the harness. */
  scratches(id: PlacedPartId): readonly (readonly Vec2[])[] {
    return (this.strokes.get(id) ?? []).flatMap((stroke) => stroke.tracks);
  }

  /**
   * Draws the scrapes, with each open stroke reaching to where its edge is drawn now (`edges`), and the shadow of each
   * tilted body (`tilted`: its footprint on the canvas, and the offset towards its low side).
   */
  draw(palette: Palette, edges: ReadonlyMap<PlacedPartId, readonly Vec2[]>, tilted: readonly { corners: readonly Vec2[]; pose: BodyPose; forward: Vec2; left: Vec2 }[]): void {
    const casting = tilted.filter((body) => Math.max(Math.abs(body.pose.pitch), Math.abs(body.pose.roll)) >= SHADOW_FROM_DEG);
    // Untouched while nothing tilts, so a frame with no shadow redraws nothing.
    if (casting.length > 0 || this.shadowed) this.shadows.clear();
    this.shadowed = casting.length > 0;
    for (const body of casting) {
      const along = -Math.sin(radians(body.pose.pitch)) * SHADOW_REACH_MM;
      const aside = -Math.sin(radians(body.pose.roll)) * SHADOW_REACH_MM;
      const dx = body.forward.x * along + body.left.x * aside;
      const dy = body.forward.y * along + body.left.y * aside;
      this.shadows.poly(body.corners.flatMap((corner) => [corner.x + dx, corner.y + dy]), true).fill({ color: 0x000000, alpha: SHADOW_ALPHA });
    }
    if (!this.dirty && edges.size === 0) return;
    this.dirty = false;
    this.scrapes.clear();
    let drew = false;
    for (const [id, strokes] of this.strokes) {
      strokes.forEach((stroke, index) => {
        const live = index === strokes.length - 1 && this.open.has(id) ? edges.get(id) : undefined;
        stroke.tracks.forEach((track, t) => {
          const points = live?.[t] ? [...track, live[t] as Vec2] : track;
          const [first, ...rest] = points;
          if (!first || rest.length === 0) return;
          this.scrapes.moveTo(first.x, first.y);
          for (const point of rest) this.scrapes.lineTo(point.x, point.y);
          drew = true;
        });
      });
    }
    if (drew) this.scrapes.stroke({ color: palette.floorEdge, width: SCRAPE_WIDTH_MM, alpha: SCRAPE_ALPHA, cap: 'round', join: 'round' });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

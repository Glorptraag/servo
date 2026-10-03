// Moving dots along live wires (brief Sections 9 and 11): red on power lines, yellow on signal lines, each the wire's
// own colour lit, spaced evenly and moving with the flow. A dead wire carries none. Every dot of a kind shares one
// GraphicsContext, so a frame only moves dots, and they draw in one batch. See docs/run-animation.md.
import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { PortType, Vec2, WireId } from '@servo/schema';
import { mmOf } from '../scene/units.ts';
import type { Palette } from '../renderer/style.ts';
import { DOT_LIGHTEN, DOT_MM, DOT_SPACING_MM } from './look.ts';
import { lighten, wrap } from './overlay.ts';

/** Where a wire's dots are, mm along it from its `from` end, for dots that have moved `travelled` mm. */
export const dotOffsets = (length: number, travelled: number): number[] => {
  const offsets: number[] = [];
  for (let s = wrap(travelled, DOT_SPACING_MM); s <= length; s += DOT_SPACING_MM) offsets.push(s);
  return offsets;
};

/**
 * One wire's dots this frame: the path its line is drawn along on the canvas, from its `from` end to its `to` end
 * (two points for a straight line, more for a tidied route, task 3.7), and how far its dots have moved.
 */
export interface DotRun {
  readonly type: PortType;
  readonly path: readonly Vec2[];
  readonly travelled: number;
}

/** The point `s` mm along a path, and the path's whole length. */
const along = (path: readonly Vec2[]): { readonly length: number; at(s: number): Vec2 } => {
  const pieces = path.slice(1).map((point, i) => {
    const from = path[i] as Vec2;
    return { from, to: point, length: Math.hypot(point.x - from.x, point.y - from.y) };
  });
  const length = pieces.reduce((sum, piece) => sum + piece.length, 0);
  return {
    length,
    at: (s) => {
      let left = s;
      for (const piece of pieces) {
        if (left <= piece.length && piece.length > 0) {
          const k = left / piece.length;
          return { x: piece.from.x + (piece.to.x - piece.from.x) * k, y: piece.from.y + (piece.to.y - piece.from.y) * k };
        }
        left -= piece.length;
      }
      return path[path.length - 1] as Vec2;
    },
  };
};

export class DotField {
  readonly container = new Container({ label: 'run dots' });
  private readonly contexts = new Map<PortType, GraphicsContext>();
  private readonly pool: Graphics[] = [];
  private used = 0;
  private readonly placed = new Map<WireId, Vec2[]>();
  private readonly fills = new Map<PortType, number>();
  private readonly colours = new Map<PortType, number>();

  setPalette(palette: Palette): void {
    for (const context of this.contexts.values()) context.destroy();
    this.contexts.clear();
    for (const type of ['power', 'signal', 'mechanical'] as const) {
      const colours = palette.types[type];
      this.fills.set(type, lighten(colours.colour, DOT_LIGHTEN));
      this.colours.set(type, colours.colour);
      this.contexts.set(
        type,
        new GraphicsContext()
          .circle(0, 0, DOT_MM / 2)
          .fill({ color: lighten(colours.colour, DOT_LIGHTEN) })
          .stroke({ color: colours.casing, width: mmOf(1.5), alignment: 1 }),
      );
    }
    for (const dot of this.pool) dot.destroy();
    this.pool.length = 0;
    this.used = 0;
  }

  /** Draws every live wire's dots; a wire left out has none. */
  draw(runs: ReadonlyMap<WireId, DotRun>): void {
    this.used = 0;
    this.placed.clear();
    for (const [id, run] of runs) {
      const line = along(run.path);
      if (line.length <= 0) continue;
      const context = this.contexts.get(run.type);
      if (!context) continue;
      const points: Vec2[] = [];
      for (const s of dotOffsets(line.length, run.travelled)) {
        const point = line.at(s);
        const dot = this.take(context);
        dot.position.set(point.x, point.y);
        points.push(point);
      }
      this.placed.set(id, points);
    }
    // Spare dots are hidden by alpha, not visibility, so the batch keeps its shape from frame to frame.
    for (let i = this.used; i < this.pool.length; i++) (this.pool[i] as Graphics).alpha = 0;
  }

  /** Where the dots on a wire are now, canvas mm: for tests and the harness. */
  dotsOn(id: WireId): readonly Vec2[] {
    return this.placed.get(id) ?? [];
  }

  /** A dot's fill colour on a line of this type (0xrrggbb): for tests and the harness. */
  fillOf(type: PortType): number | undefined {
    return this.fills.get(type);
  }

  /** A line's own colour in the current palette (0xrrggbb): what a draining gauge fills with. For tests and the harness. */
  colourOf(type: PortType): number | undefined {
    return this.colours.get(type);
  }

  clear(): void {
    this.draw(new Map());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    for (const context of this.contexts.values()) context.destroy();
    this.contexts.clear();
    this.pool.length = 0;
  }

  private take(context: GraphicsContext): Graphics {
    let dot = this.pool[this.used];
    if (!dot) {
      dot = new Graphics(context);
      this.pool.push(dot);
      this.container.addChild(dot);
    } else if (dot.context !== context) {
      dot.context = context;
    }
    dot.alpha = 1;
    this.used += 1;
    return dot;
  }
}

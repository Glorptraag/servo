// What placement draws on the canvas: the part or prop under a dragging finger, the free mount points and shafts a part
// can go onto, the move, rotate and bin handles beside the selected part (D44), and the one plain line. Canvas
// millimetres; the handles and the line keep their screen size at every zoom (44 px targets, 15 px type). Colour is
// kept for meaning: the snap rings are mechanical grey, the handles and the line neutral. See docs/placement.md.
import { Container, Graphics, Text } from 'pixi.js';
import type { Vec2 } from '@servo/schema';
import type { PartPose } from '../scene/geometry.ts';
import type { ScenePart } from '../scene/scene.ts';
import { PORT_MM, mmOf } from '../scene/units.ts';
import type { ArtState } from '../renderer/art.ts';
import { FONT_STACKS } from '../renderer/style.ts';
import type { Palette } from '../renderer/style.ts';
import { PartView } from '../renderer/views.ts';
import type { DrawContext, WorldLayers } from '../renderer/views.ts';
import type { Outline } from './free-spot.ts';
import type { HandleKind } from './overlays.ts';
import type { SnapTarget } from './rules.ts';

/** A part or prop being placed or dragged is drawn a little see-through, so what lies under it still shows. */
export const GHOST_ALPHA = 0.75;
/** Over a remove target (the tray, the arena strip) it fades further: letting go there removes it. */
export const REMOVING_ALPHA = 0.35;
/** A handle is a 44 px target on screen at every zoom, like a port at the default zoom (brief Sections 9 and 13). */
export const HANDLE_PX = 44;
/** The space between a part (with its sockets) and its handles, and between handles, on screen. */
export const HANDLE_GAP_PX = 8;
/** The line's type size on screen at every zoom: a label's, in regular weight. */
export const CALLOUT_PX = 15;
const CALLOUT_PADDING_PX = 20;
export const CALLOUT_GAP_PX = 30;
const RING_MM = mmOf(4);
const ACTIVE_RING_MM = mmOf(6);

/** A hexagon with flat top and bottom, `size` across its flats: the mechanical socket's shape (D20). */
const hexagon = (at: Vec2, size: number): number[] => {
  const r = size / Math.sqrt(3);
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push(at.x + r * Math.cos(angle), at.y + r * Math.sin(angle));
  }
  return points;
};

/** A part from the tray, drawn as the renderer draws a placed one (its tile, picture or name, sockets) under the finger. */
export class PartGhost {
  readonly view: PartView;

  constructor(part: ScenePart, parent: Container, layers: WorldLayers | undefined, art: ArtState, context: DrawContext) {
    this.view = new PartView(part, parent);
    this.view.draw(part, art, context);
    if (layers) this.view.attach(layers);
    this.view.node.alpha = GHOST_ALPHA;
    this.view.node.visible = false;
  }

  show(pose: PartPose, removing: boolean): void {
    this.view.setPose(pose);
    this.view.node.alpha = removing ? REMOVING_ALPHA : GHOST_ALPHA;
    this.view.node.visible = true;
  }

  hide(): void {
    this.view.node.visible = false;
  }

  destroy(): void {
    this.view.destroy();
  }
}

/** A prop from the arena strip, or one of the child's being moved: its footprint on the floor. */
export class PropGhost {
  readonly graphics = new Graphics({ label: 'prop ghost' });

  constructor(parent: Container, layers: WorldLayers | undefined) {
    parent.addChild(this.graphics);
    layers?.parts.attach(this.graphics);
    this.graphics.visible = false;
  }

  /** `outline` on the canvas, mm. */
  show(outline: Outline, palette: Palette, removing: boolean): void {
    const g = this.graphics;
    g.clear();
    g.poly(outline.flatMap((point) => [point.x, point.y]), true)
      .fill({ color: palette.prop })
      .stroke({ color: palette.propEdge, width: mmOf(2), alignment: 1 });
    g.alpha = removing ? REMOVING_ALPHA : GHOST_ALPHA;
    g.visible = true;
  }

  hide(): void {
    this.graphics.visible = false;
  }

  destroy(): void {
    this.graphics.destroy();
  }
}

/**
 * Where a part can go: a grey halo round each free mount point and shaft, wider than the socket so it shows round a
 * mount point's own drawing, and a strong one where the part will snap. Drawn on top of the sockets.
 */
export class TargetRings {
  readonly graphics = new Graphics({ label: 'snap targets' });

  draw(targets: readonly SnapTarget[], active: SnapTarget | undefined, palette: Palette): void {
    const g = this.graphics;
    g.clear();
    const { colour, casing } = palette.types.mechanical;
    for (const target of targets) {
      if (target === active) continue;
      g.poly(hexagon(target.at, PORT_MM + 2 * RING_MM), true)
        .fill({ color: colour, alpha: 0.2 })
        .stroke({ color: colour, width: RING_MM, alpha: 0.9, alignment: 0 });
    }
    if (active) {
      g.poly(hexagon(active.at, PORT_MM + 2 * ACTIVE_RING_MM), true)
        .fill({ color: colour, alpha: 0.45 })
        .stroke({ color: casing, width: ACTIVE_RING_MM, alignment: 0 });
    }
  }

  clear(): void {
    this.graphics.clear();
  }
}

/**
 * One plain line on the canvas, in the hints layer (brief Section 9: above everything): what a removal took and left
 * loose (D35), or why a held part has no rotate handle. No dialog, nothing to dismiss: it goes with the next change or
 * tap. Its type keeps its screen size at every zoom.
 */
export class Callout {
  readonly container = new Container({ label: 'callout' });
  private readonly back = new Graphics();
  private readonly text = new Text({ text: '', anchor: 0.5 });
  private box: { readonly at: Vec2; readonly w: number; readonly h: number } | undefined;
  /** What the text was last set with: the same again (a pinch's every frame) keeps its texture. */
  private setWith = '';

  constructor() {
    this.container.addChild(this.back, this.text);
    this.container.visible = false;
  }

  get line(): string | undefined {
    return this.container.visible ? this.text.text : undefined;
  }

  /** Sets the line at `scale` screen pixels per millimetre, and gives the size of its box in mm. */
  measure(line: string, context: DrawContext, scale: number): { readonly w: number; readonly h: number } {
    const setWith = `${line}|${context.typeface}|${context.palette.label}|${context.resolution}`;
    if (setWith !== this.setWith) {
      this.setWith = setWith;
      this.text.text = line;
      this.text.style = { fontFamily: [...FONT_STACKS[context.typeface]], fontSize: CALLOUT_PX, fill: context.palette.label };
      this.text.resolution = context.resolution;
    }
    this.text.scale.set(1 / scale);
    return { w: this.text.width + (2 * CALLOUT_PADDING_PX) / scale, h: this.text.height + CALLOUT_PADDING_PX / scale };
  }

  /** Shows the measured line in a rounded box centred at `at`. */
  place(at: Vec2, size: { readonly w: number; readonly h: number }, palette: Palette, scale: number): void {
    this.text.position.set(at.x, at.y);
    this.back.clear();
    this.back
      .roundRect(at.x - size.w / 2, at.y - size.h / 2, size.w, size.h, size.h / 2)
      .fill({ color: palette.tile })
      .stroke({ color: palette.tileEdge, width: 1.5 / scale, alignment: 1 });
    this.box = { at, ...size };
    this.container.visible = true;
  }

  /** Whether a canvas point is on the line's box. */
  covers(point: Vec2): boolean {
    const box = this.box;
    if (!box || !this.container.visible) return false;
    return Math.abs(point.x - box.at.x) <= box.w / 2 && Math.abs(point.y - box.at.y) <= box.h / 2;
  }

  hide(): void {
    this.container.visible = false;
    this.box = undefined;
  }
}

/**
 * The handles beside the selected part (D44): move, rotate (a free part only: a mount or a shaft sets a held part's
 * turn) and bin, each a 44 px disc with its sign. The one waiting for its tap (move) shows dark.
 */
export class Handles {
  readonly graphics = new Graphics({ label: 'handles' });
  private places: ReadonlyMap<HandleKind, Vec2> = new Map();
  private radius = 0;

  get shown(): ReadonlyMap<HandleKind, Vec2> {
    return this.places;
  }

  get size(): number {
    return this.radius;
  }

  draw(places: ReadonlyMap<HandleKind, Vec2>, radius: number, palette: Palette, active?: HandleKind): void {
    this.places = places;
    this.radius = radius;
    const g = this.graphics;
    g.clear();
    const line = radius * 0.14;
    for (const [kind, at] of places) {
      const ink = kind === active ? palette.tile : palette.label;
      g.circle(at.x, at.y, radius)
        .fill({ color: kind === active ? palette.label : palette.tile })
        .stroke({ color: palette.tileEdge, width: radius * 0.09, alignment: 1 });
      if (kind === 'move') {
        // Four arrows out from the middle: the part goes where the next tap says.
        const reach = radius * 0.55;
        const head = radius * 0.2;
        g.moveTo(at.x - reach, at.y).lineTo(at.x + reach, at.y).stroke({ color: ink, width: line, cap: 'round' });
        g.moveTo(at.x, at.y - reach).lineTo(at.x, at.y + reach).stroke({ color: ink, width: line, cap: 'round' });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const tip = { x: at.x + dx * (reach + head * 0.4), y: at.y + dy * (reach + head * 0.4) };
          const back = { x: tip.x - dx * head * 1.3, y: tip.y - dy * head * 1.3 };
          g.poly([tip.x, tip.y, back.x - dy * head, back.y + dx * head, back.x + dy * head, back.y - dx * head], true).fill({ color: ink });
        }
      } else if (kind === 'rotate') {
        // A clockwise arrow, the way a tap turns the part: three quarters of a circle from the top round to the left,
        // with its head pointing on round towards the top.
        const arc = radius * 0.5;
        g.moveTo(at.x, at.y - arc).arc(at.x, at.y, arc, -Math.PI / 2, Math.PI).stroke({ color: ink, width: line, cap: 'round' });
        const tip = { x: at.x - arc, y: at.y - arc * 0.5 };
        g.poly([tip.x - arc * 0.45, tip.y + arc * 0.35, tip.x + arc * 0.45, tip.y + arc * 0.35, tip.x, tip.y - arc * 0.2], true).fill({ color: ink });
      } else {
        // A bin: a lid with a handle, and a body.
        const w = radius * 0.9;
        g.rect(at.x - w / 2, at.y - w * 0.45, w, line).fill({ color: ink });
        g.rect(at.x - w * 0.15, at.y - w * 0.6, w * 0.3, line).fill({ color: ink });
        g.roundRect(at.x - w * 0.38, at.y - w * 0.3, w * 0.76, w * 0.8, line / 2).stroke({ color: ink, width: line });
      }
    }
  }

  /** The handle under a canvas point, if any. */
  hit(point: Vec2): HandleKind | undefined {
    for (const [kind, at] of this.places) {
      if ((point.x - at.x) ** 2 + (point.y - at.y) ** 2 <= this.radius * this.radius) return kind;
    }
    return undefined;
  }
}

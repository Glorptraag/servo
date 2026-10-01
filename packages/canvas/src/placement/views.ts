// What placement draws on the canvas: the part or prop under a dragging finger, the free mount points and shafts a part
// can go onto, and the rotate and bin handles beside the selected part (D44). All in canvas millimetres, sized from the
// brief's pixels at the default zoom (44 px targets), with colour kept for meaning: the snap rings are mechanical grey,
// and the handles are neutral. See docs/placement.md.
import { Container, Graphics, Text } from 'pixi.js';
import type { Vec2 } from '@servo/schema';
import type { Rect } from '../scene/geometry.ts';
import type { ScenePart } from '../scene/scene.ts';
import { PORT_MM, PX_PER_MM, mmOf } from '../scene/units.ts';
import type { PartPose } from '../scene/geometry.ts';
import type { ArtState } from '../renderer/art.ts';
import { FONT_STACKS } from '../renderer/style.ts';
import type { Palette } from '../renderer/style.ts';
import { PartView } from '../renderer/views.ts';
import type { DrawContext, WorldLayers } from '../renderer/views.ts';
import type { Outline } from './free-spot.ts';
import type { SnapTarget } from './rules.ts';

/** A part or prop being placed or dragged is drawn a little see-through, so what lies under it still shows. */
export const GHOST_ALPHA = 0.75;
/** Over a remove target (the tray, the arena strip) it fades further: letting go there removes it. */
export const REMOVING_ALPHA = 0.35;
/** A handle is a 44 px target at the default zoom, like a port (brief Section 9). */
export const HANDLE_MM = PORT_MM;
/** The space between a part (with its sockets) and its handles, and between the two handles. */
const HANDLE_GAP_MM = mmOf(8);
const RING_MM = mmOf(3);
const ACTIVE_RING_MM = mmOf(6);
const ICON_MM = mmOf(3);

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

/** The free mount points and shafts a part can go onto: faint rings, and a strong one where it will snap. */
export class TargetRings {
  readonly graphics = new Graphics({ label: 'snap targets' });

  draw(targets: readonly SnapTarget[], active: SnapTarget | undefined, palette: Palette): void {
    const g = this.graphics;
    g.clear();
    const { colour, casing } = palette.types.mechanical;
    for (const target of targets) {
      if (target === active) continue;
      g.poly(hexagon(target.at, PORT_MM), true).stroke({ color: colour, width: RING_MM, alpha: 0.8, alignment: 1 });
    }
    if (active) {
      g.poly(hexagon(active.at, PORT_MM + 2 * ACTIVE_RING_MM), true).fill({ color: colour, alpha: 0.35 });
      g.poly(hexagon(active.at, PORT_MM), true).stroke({ color: casing, width: ACTIVE_RING_MM, alignment: 1 });
    }
  }

  clear(): void {
    this.graphics.clear();
  }
}

/** The callout's type size in screen pixels at the default zoom: a label's, in regular weight. */
const CALLOUT_PX = 15;
const CALLOUT_PADDING_MM = mmOf(8);
const CALLOUT_GAP_MM = mmOf(12);

/**
 * One plain line on the canvas, in the hints layer (brief Section 9: above everything), centred over an area: what a
 * removal left loose (D35). No dialog, nothing to dismiss: it goes with the next change.
 */
export class Callout {
  readonly container = new Container({ label: 'callout' });
  private readonly back = new Graphics();
  private readonly text = new Text({ text: '', anchor: { x: 0.5, y: 1 } });

  constructor() {
    this.container.addChild(this.back, this.text);
    this.container.visible = false;
  }

  get line(): string | undefined {
    return this.container.visible ? this.text.text : undefined;
  }

  /**
   * Centred over `over`, or under it when there is no room above in `view` (what the screen shows), and held inside
   * the view where it can be.
   */
  show(line: string, over: Rect, view: Rect, context: DrawContext): void {
    const { palette } = context;
    this.text.text = line;
    this.text.style = { fontFamily: [...FONT_STACKS[context.typeface]], fontSize: CALLOUT_PX, fill: palette.label };
    this.text.resolution = context.resolution * 2;
    this.text.scale.set(1 / PX_PER_MM);
    const w = this.text.width + 2 * CALLOUT_PADDING_MM;
    const h = this.text.height + CALLOUT_PADDING_MM;
    const hold = (value: number, min: number, max: number): number => (min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max));
    const x = hold((over.minX + over.maxX) / 2, view.minX + w / 2, view.maxX - w / 2);
    // `y` is the text's baseline edge: the bottom of the text, the box reaching half a padding beyond it.
    const above = over.minY - CALLOUT_GAP_MM;
    const below = over.maxY + CALLOUT_GAP_MM + this.text.height;
    const roomAbove = above - this.text.height - CALLOUT_PADDING_MM / 2 >= view.minY;
    const y = hold(roomAbove ? above : below, view.minY + this.text.height + CALLOUT_PADDING_MM / 2, view.maxY - CALLOUT_PADDING_MM / 2);
    this.text.position.set(x, y);
    this.back.clear();
    this.back
      .roundRect(x - w / 2, y - this.text.height - CALLOUT_PADDING_MM / 2, w, h, h / 2)
      .fill({ color: palette.tile })
      .stroke({ color: palette.tileEdge, width: mmOf(1.5), alignment: 1 });
    this.container.visible = true;
  }

  hide(): void {
    this.container.visible = false;
  }
}

export type HandleKind = 'rotate' | 'bin';

/**
 * The rotate and bin handles beside the selected part (D44): on its right, rotate above bin, or on its left for
 * left-handed use, clear of the part and its sockets.
 */
export class Handles {
  readonly graphics = new Graphics({ label: 'handles' });
  private places: { readonly rotate: Vec2; readonly bin: Vec2 } | undefined;

  /** Where each handle's centre sits next to a part whose tile and sockets span `bounds`. */
  static placesFor(bounds: Rect, leftHanded: boolean): { readonly rotate: Vec2; readonly bin: Vec2 } {
    const r = HANDLE_MM / 2;
    const x = leftHanded ? bounds.minX - HANDLE_GAP_MM - r : bounds.maxX + HANDLE_GAP_MM + r;
    const middle = (bounds.minY + bounds.maxY) / 2;
    return { rotate: { x, y: middle - r - HANDLE_GAP_MM / 2 }, bin: { x, y: middle + r + HANDLE_GAP_MM / 2 } };
  }

  get shown(): { readonly rotate: Vec2; readonly bin: Vec2 } | undefined {
    return this.places;
  }

  draw(part: ScenePart | undefined, leftHanded: boolean, palette: Palette): void {
    const g = this.graphics;
    g.clear();
    this.places = part ? Handles.placesFor(part.bounds, leftHanded) : undefined;
    if (!this.places) return;
    const r = HANDLE_MM / 2;
    for (const at of [this.places.rotate, this.places.bin]) {
      g.circle(at.x, at.y, r).fill({ color: palette.tile }).stroke({ color: palette.tileEdge, width: mmOf(2), alignment: 1 });
    }
    // A clockwise arrow, the way a tap turns the part: three quarters of a circle from the top round to the left,
    // with its head pointing on round towards the top.
    const { rotate, bin } = this.places;
    const arc = r * 0.5;
    g.moveTo(rotate.x, rotate.y - arc)
      .arc(rotate.x, rotate.y, arc, -Math.PI / 2, Math.PI)
      .stroke({ color: palette.label, width: ICON_MM, cap: 'round' });
    const tip = { x: rotate.x - arc, y: rotate.y - arc * 0.5 };
    g.poly([tip.x - arc * 0.45, tip.y + arc * 0.35, tip.x + arc * 0.45, tip.y + arc * 0.35, tip.x, tip.y - arc * 0.2], true).fill({
      color: palette.label,
    });
    // A bin: a lid with a handle, and a body.
    const w = r * 0.9;
    g.rect(bin.x - w / 2, bin.y - w * 0.45, w, ICON_MM).fill({ color: palette.label });
    g.rect(bin.x - w * 0.15, bin.y - w * 0.6, w * 0.3, ICON_MM).fill({ color: palette.label });
    g.roundRect(bin.x - w * 0.38, bin.y - w * 0.3, w * 0.76, w * 0.8, ICON_MM / 2).stroke({ color: palette.label, width: ICON_MM });
  }

  /** The handle under a canvas point, if any. */
  hit(point: Vec2): HandleKind | undefined {
    if (!this.places) return undefined;
    const reach = (HANDLE_MM / 2) ** 2;
    for (const kind of ['rotate', 'bin'] as const) {
      const at = this.places[kind];
      if ((point.x - at.x) ** 2 + (point.y - at.y) ** 2 <= reach) return kind;
    }
    return undefined;
  }
}

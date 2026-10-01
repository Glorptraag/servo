// The display objects for one part and one wire. A part is one node at its pose; its body, its frame sockets and
// its port sockets render in different layers (RenderLayer), so the brief's layer order holds while one transform
// moves them all. Task 3.2 moves parts with `setPose`; task 3.4 dims and highlights through `setEmphasis`; task 3.5
// animates the same nodes in Run mode.
import { Container, Graphics, GraphicsPath, Sprite, Text } from 'pixi.js';
import type { RenderLayer } from 'pixi.js';
import type { Vec2 } from '@servo/schema';
import type { PartPose } from '../scene/geometry.ts';
import type { ScenePart, SceneWire } from '../scene/scene.ts';
import { DASH_GAP_MM, DASH_MM, LINKAGE_MM, PX_PER_MM, WIRE_MM, mmOf } from '../scene/units.ts';
import type { ArtState } from './art.ts';
import { drawSocket } from './sockets.ts';
import { DIM_ALPHA, FONT_STACKS } from './style.ts';
import type { Palette } from './style.ts';

/** Every layer a view can attach to, bottom to top (brief Section 9). */
export interface WorldLayers {
  readonly chassis: RenderLayer;
  readonly linkages: RenderLayer;
  readonly parts: RenderLayer;
  readonly wires: RenderLayer;
  readonly ports: RenderLayer;
  readonly hints: RenderLayer;
}

/** How a part, wire or socket stands out: dimmed one step, or highlighted (focus states, task 3.4). */
export type Emphasis = 'normal' | 'dimmed' | 'highlighted';

export interface DrawContext {
  readonly palette: Palette;
  readonly typeface: keyof typeof FONT_STACKS;
  /** Device pixels per CSS pixel, for text sharpness. */
  readonly resolution: number;
}

const TILE_RADIUS_MM = mmOf(8);
const TILE_EDGE_MM = mmOf(1.5);
/** Space between a tile's edge and its picture or name. */
const TILE_PADDING_MM = mmOf(5);
/** The name on a neutral tile, in screen pixels at default zoom (brief Section 11: generous size, real names in bold). */
const LABEL_PX = 15;
/** Names are rasterised sharp up to this zoom. */
const LABEL_SHARP_TO_ZOOM = 2;
const CASING_MM = mmOf(1.5);
/** The ring round a highlighted part, outside its tile. */
const OUTLINE_MM = mmOf(3);
/** The glow round a highlighted wire. */
const WIRE_HALO_MM = mmOf(8);

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** A point of the part's frame (x forward, y left) in the node's own space (x forward, y down the canvas at rotation 0). */
const nodeLocal = (point: Vec2): Vec2 => ({ x: point.x, y: -point.y });

export class PartView {
  readonly node = new Container();
  part: ScenePart;
  private readonly body = new Container();
  private readonly tile = new Graphics();
  private readonly outline = new Graphics();
  private readonly frameSockets = new Graphics();
  private readonly sockets = new Graphics();
  private picture: Sprite | undefined;
  private label: Text | undefined;
  private labelScale = 1 / PX_PER_MM;
  private emphasis: Emphasis = 'normal';
  private highlightedPorts: ReadonlySet<string> = new Set();

  constructor(part: ScenePart, parent: Container) {
    this.part = part;
    this.node.label = `part:${part.id}`;
    this.body.label = 'body';
    this.frameSockets.label = 'frame sockets';
    this.sockets.label = 'sockets';
    this.body.addChild(this.tile);
    // Every child of the node renders through a layer; a frame's mount points draw just above its body.
    this.node.addChild(this.body, this.sockets);
    if (part.frame) this.node.addChild(this.frameSockets);
    parent.addChild(this.node);
    this.setPose(part.pose);
  }

  /**
   * Puts the body in the chassis layer (a frame) or the parts layer, a frame's mount points just above its body,
   * and the sockets in the ports layer. Each call moves them to the top of their layers, so attaching views in
   * the scene's order gives the scene's draw order.
   */
  attach(layers: WorldLayers): void {
    for (const object of [this.body, this.frameSockets, this.sockets]) object.parentRenderLayer?.detach(object);
    (this.part.frame ? layers.chassis : layers.parts).attach(this.body);
    if (this.part.frame) layers.chassis.attach(this.frameSockets);
    layers.ports.attach(this.sockets);
  }

  /** Places the node: position in mm, rotation clockwise, and a part on a mirrored mount point flipped across its x axis. */
  setPose(pose: PartPose): void {
    this.node.position.set(pose.x, pose.y);
    this.node.rotation = toRadians(pose.rotation);
    this.node.scale.set(1, pose.mirrored ? -1 : 1);
    if (this.label) this.uprightLabel(this.label, pose);
  }

  /** Redraws everything from the scene part and its picture's state. */
  draw(part: ScenePart, art: ArtState, context: DrawContext): void {
    this.part = part;
    const { w, h } = part.tile;
    const { palette } = context;
    this.tile.clear();
    this.tile
      .roundRect(-w / 2, -h / 2, w, h, TILE_RADIUS_MM)
      .fill({ color: palette.tile })
      .stroke({ color: palette.tileEdge, width: TILE_EDGE_MM, alignment: 1 });
    this.drawPicture(part, art, context);
    this.drawOutline(context);
    this.drawSockets(context);
    this.setPose(part.pose);
  }

  /** Dimmed draws the whole part, sockets and all, one step fainter; highlighted rings its tile. */
  setEmphasis(emphasis: Emphasis, highlightedPorts: ReadonlySet<string>, context: DrawContext): void {
    const portsChanged =
      highlightedPorts.size !== this.highlightedPorts.size || [...highlightedPorts].some((key) => !this.highlightedPorts.has(key));
    const outlineChanged = (emphasis === 'highlighted') !== (this.emphasis === 'highlighted');
    this.emphasis = emphasis;
    this.node.alpha = emphasis === 'dimmed' ? DIM_ALPHA : 1;
    if (outlineChanged) this.drawOutline(context);
    if (portsChanged) {
      this.highlightedPorts = new Set(highlightedPorts);
      this.drawSockets(context);
    }
  }

  get currentEmphasis(): Emphasis {
    return this.emphasis;
  }

  /** The picture or name currently shown: for tests and the list view's parity checks. */
  get shows(): { readonly picture: boolean; readonly name: string | undefined } {
    return { picture: this.picture?.visible === true, name: this.label?.visible ? this.label.text : undefined };
  }

  /** The font stack the name is written in, when the tile shows a name. */
  get labelFont(): string | undefined {
    if (!this.label?.visible) return undefined;
    const family = this.label.style.fontFamily;
    return Array.isArray(family) ? family.join(', ') : String(family);
  }

  destroy(): void {
    this.node.destroy({ children: true });
  }

  private drawOutline(context: DrawContext): void {
    this.outline.clear();
    if (this.emphasis !== 'highlighted') return;
    const { w, h } = this.part.tile;
    this.outline
      .roundRect(-w / 2, -h / 2, w, h, TILE_RADIUS_MM)
      .stroke({ color: context.palette.label, width: OUTLINE_MM, alignment: 0 });
    // Above the picture and the name.
    this.body.addChild(this.outline);
  }

  private drawSockets(context: DrawContext): void {
    this.sockets.clear();
    this.frameSockets.clear();
    for (const port of this.part.ports) {
      if (port.layer === 'none') continue;
      const target = port.layer === 'frame' ? this.frameSockets : this.sockets;
      drawSocket(
        target,
        { type: port.type, at: nodeLocal(port.local), connected: port.connected, highlighted: this.highlightedPorts.has(port.key) },
        context.palette,
      );
    }
  }

  private drawPicture(part: ScenePart, art: ArtState, context: DrawContext): void {
    const innerW = Math.max(part.tile.w - 2 * TILE_PADDING_MM, 1);
    const innerH = Math.max(part.tile.h - 2 * TILE_PADDING_MM, 1);
    if (art.status === 'ready') {
      if (!this.picture) {
        this.picture = new Sprite();
        this.picture.anchor.set(0.5);
        this.body.addChild(this.picture);
      }
      this.picture.texture = art.texture;
      const fit = Math.min(innerW / art.texture.width, innerH / art.texture.height);
      this.picture.scale.set(fit);
      this.picture.visible = true;
      if (this.label) this.label.visible = false;
      return;
    }
    if (this.picture) this.picture.visible = false;
    // While a picture loads, the tile stays plain; with none, or when it fails, the tile shows the part's real name.
    if (art.status === 'loading') {
      if (this.label) this.label.visible = false;
      return;
    }
    const room = this.labelRoom(part, innerW, innerH);
    if (!this.label) {
      this.label = new Text({ text: '', anchor: 0.5 });
      this.body.addChild(this.label);
    }
    const label = this.label;
    // The text is set in screen pixels at default zoom, then scaled into millimetres, and rasterised sharp to 200%.
    label.text = part.record.identity.name;
    label.style = {
      fontFamily: [...FONT_STACKS[context.typeface]],
      fontWeight: '700',
      fontSize: LABEL_PX,
      fill: context.palette.label,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: room.width * PX_PER_MM,
      lineHeight: LABEL_PX * 1.15,
    };
    label.resolution = context.resolution * LABEL_SHARP_TO_ZOOM;
    label.scale.set(1);
    label.rotation = 0;
    this.labelScale = Math.min(1 / PX_PER_MM, room.width / Math.max(label.width, 1e-6), room.height / Math.max(label.height, 1e-6));
    label.visible = true;
    this.uprightLabel(label, part.pose);
  }

  /** The room for the name as the screen shows it: a turned tile offers its height across. */
  private labelRoom(part: ScenePart, innerW: number, innerH: number): { width: number; height: number } {
    const quarter = Math.round(part.pose.rotation / 90) % 2 === 1;
    const exact = part.pose.rotation % 90 === 0;
    if (!exact) {
      const side = Math.min(innerW, innerH);
      return { width: side, height: side };
    }
    return quarter ? { width: innerH, height: innerW } : { width: innerW, height: innerH };
  }

  /**
   * Text stays upright and unmirrored whatever the part's turn: the node's turn and flip are undone. A flip turns
   * later turns the other way (S·R(a) = R(−a)·S), so under a mirrored node the label turns with the part, flipped.
   * A part's name sits in its middle; a frame's in the corner that is top left on screen, clear of the parts it holds.
   */
  private uprightLabel(label: Text, pose: PartPose): void {
    const flip = pose.mirrored ? -1 : 1;
    label.rotation = -flip * toRadians(pose.rotation);
    label.scale.set(this.labelScale, flip * this.labelScale);
    if (!this.part.frame) {
      label.anchor.set(0.5);
      label.position.set(0, 0);
      return;
    }
    const c = Math.cos(toRadians(pose.rotation));
    const s = Math.sin(toRadians(pose.rotation));
    const halfW = this.part.tile.w / 2 - TILE_PADDING_MM;
    const halfH = this.part.tile.h / 2 - TILE_PADDING_MM;
    let corner = { x: -halfW, y: -halfH };
    let topLeft = Infinity;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const x = sx * halfW;
      const y = sy * halfH;
      // Where this corner lands on screen, relative to the part's origin: flipped, then turned.
      const screenX = c * x - s * flip * y;
      const screenY = s * x + c * flip * y;
      if (screenX + screenY < topLeft) {
        topLeft = screenX + screenY;
        corner = { x, y };
      }
    }
    label.anchor.set(0, 0);
    label.position.set(corner.x, corner.y);
  }
}

export class WireView {
  readonly graphics = new Graphics();
  wire: SceneWire;
  private palette: Palette | undefined;
  private ends: readonly [Vec2, Vec2] | undefined;
  private emphasis: Emphasis = 'normal';

  constructor(wire: SceneWire, parent: Container) {
    this.wire = wire;
    this.graphics.label = `wire:${wire.id}`;
    parent.addChild(this.graphics);
  }

  /** Moves the line to the top of `layer`: the wires layer, or the linkages layer for a mechanical linkage. */
  attach(layer: RenderLayer): void {
    this.graphics.parentRenderLayer?.detach(this.graphics);
    layer.attach(this.graphics);
  }

  /**
   * Power solid, signal dashed, mechanical thick: the line-style twins of brief Section 13. The ends default to the
   * two sockets; a drag (task 3.3) or a route (task 3.7) can give others.
   */
  draw(wire: SceneWire, palette: Palette, from: Vec2 = wire.from.at, to: Vec2 = wire.to.at): void {
    this.wire = wire;
    this.palette = palette;
    this.ends = [from, to];
    const colours = palette.types[wire.type];
    const g = this.graphics;
    g.clear();
    if (this.emphasis === 'highlighted') {
      const width = (wire.type === 'mechanical' ? LINKAGE_MM : WIRE_MM) + 2 * WIRE_HALO_MM;
      g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: colours.colour, alpha: 0.3, width, cap: 'round' });
    }
    if (wire.type === 'signal') {
      const path = dashedPath(from, to);
      g.path(path).stroke({ color: colours.casing, width: WIRE_MM + 2 * CASING_MM, cap: 'butt' });
      g.path(path).stroke({ color: colours.colour, width: WIRE_MM, cap: 'butt' });
      return;
    }
    const width = wire.type === 'mechanical' ? LINKAGE_MM : WIRE_MM;
    const path = new GraphicsPath().moveTo(from.x, from.y).lineTo(to.x, to.y);
    g.path(path).stroke({ color: colours.casing, width: width + 2 * CASING_MM, cap: 'round' });
    g.path(path).stroke({ color: colours.colour, width, cap: 'round' });
  }

  /** Dimmed draws the line one step fainter; highlighted gives it a glow in its colour. */
  setEmphasis(emphasis: Emphasis): void {
    const glowChanged = (emphasis === 'highlighted') !== (this.emphasis === 'highlighted');
    this.emphasis = emphasis;
    this.graphics.alpha = emphasis === 'dimmed' ? DIM_ALPHA : 1;
    if (glowChanged && this.palette && this.ends) this.draw(this.wire, this.palette, this.ends[0], this.ends[1]);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}

/** Dashes along a straight line, centred so both ends look alike. */
export const dashedPath = (from: Vec2, to: Vec2): GraphicsPath => {
  const path = new GraphicsPath();
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return path;
  const ux = dx / length;
  const uy = dy / length;
  const period = DASH_MM + DASH_GAP_MM;
  const count = Math.max(1, Math.floor((length + DASH_GAP_MM) / period));
  const used = count * period - DASH_GAP_MM;
  let start = Math.max(0, (length - used) / 2);
  for (let i = 0; i < count; i++) {
    const end = Math.min(length, start + DASH_MM);
    path.moveTo(from.x + ux * start, from.y + uy * start).lineTo(from.x + ux * end, from.y + uy * end);
    start += period;
  }
  return path;
};

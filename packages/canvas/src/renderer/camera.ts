// The view onto the canvas plane: which millimetre sits at the centre of the host, and the zoom. Plain maths with
// no Pixi in it, so it runs in unit tests. Zoom limits keep the build findable (brief Section 10); task 3.7
// extends them.
import type { Vec2 } from '@servo/schema';
import { rectCentre, rectHeight, rectWidth } from '../scene/geometry.ts';
import type { Rect } from '../scene/geometry.ts';
import { MAX_ZOOM, PX_PER_MM } from '../scene/units.ts';

/** Space kept round the content by `fit`, in screen pixels: room for the sockets on the outermost tiles. */
export const FIT_PADDING_PX = 48;

/** How far below the fitting zoom the child may zoom out: the build stays at least half as big as fitted. */
export const ZOOM_OUT_BEYOND_FIT = 2;

/** With nothing placed, the view stays near the canvas origin, where the first part lands. */
const EMPTY_AREA: Rect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

export interface ViewLimits {
  readonly minZoom: number;
  readonly maxZoom: number;
  /** The view's centre stays inside this area, so some of the content is always on screen. */
  readonly area: Rect;
}

export class Camera {
  centreX = 0;
  centreY = 0;
  zoom = 1;
  width = 1;
  height = 1;

  /** Screen pixels per millimetre. */
  get scale(): number {
    return PX_PER_MM * this.zoom;
  }

  worldToScreen(point: Vec2): Vec2 {
    return { x: (point.x - this.centreX) * this.scale + this.width / 2, y: (point.y - this.centreY) * this.scale + this.height / 2 };
  }

  screenToWorld(point: Vec2): Vec2 {
    return { x: (point.x - this.width / 2) / this.scale + this.centreX, y: (point.y - this.height / 2) / this.scale + this.centreY };
  }

  /** The visible part of the plane. */
  visible(): Rect {
    const a = this.screenToWorld({ x: 0, y: 0 });
    const b = this.screenToWorld({ x: this.width, y: this.height });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  /** Keeps the centre where it is, so tucking an edge away leaves the build in the middle. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  /** Moves the plane with a drag of (dx, dy) screen pixels, held by the limits. */
  panBy(dx: number, dy: number, limits: ViewLimits): void {
    const previous = { x: this.centreX, y: this.centreY };
    this.centreX -= dx / this.scale;
    this.centreY -= dy / this.scale;
    this.holdCentre(previous, limits.area);
  }

  /** Zooms keeping the plane point under `screen` fixed, held by the limits. */
  zoomAbout(screen: Vec2, zoom: number, limits: ViewLimits): void {
    const previous = { x: this.centreX, y: this.centreY };
    const anchor = this.screenToWorld(screen);
    this.zoom = holdWithin(zoom, this.zoom, limits.minZoom, limits.maxZoom);
    this.centreX = anchor.x - (screen.x - this.width / 2) / this.scale;
    this.centreY = anchor.y - (screen.y - this.height / 2) / this.scale;
    this.holdCentre(previous, limits.area);
  }

  /** Re-centres on `content` at the fitting zoom, never above the default zoom. */
  fit(content: Rect | undefined, limits: ViewLimits): void {
    const target = content ?? EMPTY_AREA;
    const centre = rectCentre(target);
    this.centreX = centre.x;
    this.centreY = centre.y;
    this.zoom = Math.min(Math.min(1, fittingZoom(target, this.width, this.height)), limits.maxZoom);
  }

  /** Brings the view inside the limits outright (used after a resize). */
  clampTo(limits: ViewLimits): void {
    this.zoom = Math.min(Math.max(this.zoom, limits.minZoom), limits.maxZoom);
    this.centreX = Math.min(Math.max(this.centreX, limits.area.minX), limits.area.maxX);
    this.centreY = Math.min(Math.max(this.centreY, limits.area.minY), limits.area.maxY);
  }

  /**
   * Holds the centre in the area without jumping: a view already outside (after a load, say) may move back
   * towards the area but no further out.
   */
  private holdCentre(previous: Vec2, area: Rect): void {
    this.centreX = holdWithin(this.centreX, previous.x, area.minX, area.maxX);
    this.centreY = holdWithin(this.centreY, previous.y, area.minY, area.maxY);
  }
}

/** `next` held in [min, max], widened to include `previous`, so a limit never pulls a value across it. */
const holdWithin = (next: number, previous: number, min: number, max: number): number =>
  Math.min(Math.max(next, Math.min(min, previous)), Math.max(max, previous));

/** The zoom at which `content` fills the view less the padding, uncapped. */
export const fittingZoom = (content: Rect, width: number, height: number): number => {
  const spanX = Math.max(rectWidth(content), 1) * PX_PER_MM;
  const spanY = Math.max(rectHeight(content), 1) * PX_PER_MM;
  const roomX = Math.max(width - 2 * FIT_PADDING_PX, width / 2);
  const roomY = Math.max(height - 2 * FIT_PADDING_PX, height / 2);
  return Math.min(roomX / spanX, roomY / spanY);
};

/**
 * The limits for a view of `width` × `height` pixels onto `content`: zoom from half the fitting zoom (or half the
 * default, for a small build) up to 400%, and a centre that stays over the content.
 */
export const limitsFor = (content: Rect | undefined, width: number, height: number): ViewLimits => {
  const area = content ?? EMPTY_AREA;
  const fit = fittingZoom(area, Math.max(1, width), Math.max(1, height));
  return { minZoom: Math.min(1, fit) / ZOOM_OUT_BEYOND_FIT, maxZoom: MAX_ZOOM, area };
};

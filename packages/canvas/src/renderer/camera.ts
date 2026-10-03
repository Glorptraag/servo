// The view onto the canvas plane: which millimetre sits at the centre of the host, and the zoom. Plain maths with
// no Pixi in it, so it runs in unit tests. Fit, zoom and the limits work in the part of the host the child can see,
// less the safe area the app's panels cover (D66, D70); the limits keep part of the build on screen there (brief
// Section 10, task 3.7: src/routing/view.ts).
import type { Vec2 } from '@servo/schema';
import type { CanvasSafeArea } from '../interface.ts';
import { NO_SAFE_AREA, backInside, focusArea, holdFocus, screenCentre, uncovered } from '../routing/view.ts';
import type { Polygon, ScreenRect } from '../routing/view.ts';
import { rectCentre, rectHeight, rectOfPoints, rectWidth, unionRect } from '../scene/geometry.ts';
import type { Rect } from '../scene/geometry.ts';
import { MAX_ZOOM, PX_PER_MM } from '../scene/units.ts';

/** Space kept round the content by `fit`, in screen pixels: room for the sockets on the outermost tiles. */
export const FIT_PADDING_PX = 48;

/** How far below the fitting zoom the child may zoom out: the build stays at least half as big as fitted. */
export const ZOOM_OUT_BEYOND_FIT = 2;

/** With nothing placed, the view stays near the canvas origin, where the first part lands. */
const EMPTY_AREA: Rect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
const EMPTY_TARGET: Polygon = [
  { x: EMPTY_AREA.minX, y: EMPTY_AREA.minY },
  { x: EMPTY_AREA.maxX, y: EMPTY_AREA.minY },
  { x: EMPTY_AREA.maxX, y: EMPTY_AREA.maxY },
  { x: EMPTY_AREA.minX, y: EMPTY_AREA.maxY },
];

export interface ViewLimits {
  readonly minZoom: number;
  readonly maxZoom: number;
  /**
   * What stays on screen: a 96 px piece of one of these (each part's drawn tile, turned with it, and in Run mode the
   * arena) is always in view. Each is a rectangle's four corners in order.
   */
  readonly targets: readonly Polygon[];
}

export class Camera {
  centreX = 0;
  centreY = 0;
  zoom = 1;
  width = 1;
  height = 1;
  /** How far in from each edge the canvas the child can see begins (D70). */
  safeArea: CanvasSafeArea = NO_SAFE_AREA;

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

  /** The part of the host the child can see, in screen pixels: the host less the safe area. */
  uncovered(): ScreenRect {
    return uncovered(this.width, this.height, this.safeArea);
  }

  /** The plane point at the centre of the uncovered view, where `setZoom` zooms about and `fit` centres. */
  focus(): Vec2 {
    return this.screenToWorld(screenCentre(this.uncovered()));
  }

  /** Keeps the centre where it is, so tucking an edge away leaves the build in the middle. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  /** Moves the plane with a drag of (dx, dy) screen pixels, held by the limits. */
  panBy(dx: number, dy: number, limits: ViewLimits): void {
    const previous = this.focus();
    this.centreX -= dx / this.scale;
    this.centreY -= dy / this.scale;
    this.hold(previous, this.scale, limits);
  }

  /** Zooms keeping the plane point under `screen` fixed, held by the limits. */
  zoomAbout(screen: Vec2, zoom: number, limits: ViewLimits): void {
    const previous = this.focus();
    const previousScale = this.scale;
    const anchor = this.screenToWorld(screen);
    this.zoom = holdWithin(zoom, this.zoom, limits.minZoom, limits.maxZoom);
    this.centreX = anchor.x - (screen.x - this.width / 2) / this.scale;
    this.centreY = anchor.y - (screen.y - this.height / 2) / this.scale;
    this.hold(previous, previousScale, limits);
  }

  /** Centres `content` in the uncovered view at the zoom that shows it all there, never above the default zoom. */
  fit(content: Rect | undefined, limits: ViewLimits): void {
    const target = content ?? EMPTY_AREA;
    const view = this.uncovered();
    this.zoom = Math.min(Math.min(1, fittingZoom(target, view.width, view.height)), limits.maxZoom);
    this.setFocus(rectCentre(target));
  }

  /**
   * After a resize or a new safe area: zoom back within the limits, and a view that has left them comes back to the
   * nearest place within them, so the build is never left covered or off screen.
   */
  reHold(limits: ViewLimits): void {
    const focus = this.focus();
    this.zoom = Math.min(Math.max(this.zoom, limits.minZoom), limits.maxZoom);
    this.setFocus(backInside(focus, focusArea(limits.targets, this.uncovered(), this.scale)));
  }

  private setFocus(point: Vec2): void {
    const centre = screenCentre(this.uncovered());
    this.centreX = point.x - (centre.x - this.width / 2) / this.scale;
    this.centreY = point.y - (centre.y - this.height / 2) / this.scale;
  }

  /** Keeps some of the content in the uncovered view, without jumping (`holdFocus`). */
  private hold(previous: Vec2, previousScale: number, limits: ViewLimits): void {
    const view = this.uncovered();
    const area = focusArea(limits.targets, view, this.scale);
    const before = previousScale === this.scale ? area : focusArea(limits.targets, view, previousScale);
    this.setFocus(holdFocus(this.focus(), previous, area, before));
  }
}

/** `next` held in [min, max], widened to include `previous`, so a limit never pulls a value across it. */
const holdWithin = (next: number, previous: number, min: number, max: number): number =>
  Math.min(Math.max(next, Math.min(min, previous)), Math.max(max, previous));

/** The zoom at which `content` fills a view of `width` × `height` pixels less the padding, uncapped. */
export const fittingZoom = (content: Rect, width: number, height: number): number => {
  const spanX = Math.max(rectWidth(content), 1) * PX_PER_MM;
  const spanY = Math.max(rectHeight(content), 1) * PX_PER_MM;
  const roomX = Math.max(width - 2 * FIT_PADDING_PX, width / 2);
  const roomY = Math.max(height - 2 * FIT_PADDING_PX, height / 2);
  return Math.min(roomX / spanX, roomY / spanY);
};

/**
 * The limits for an uncovered view of `width` × `height` pixels onto `targets`: zoom from half the fitting zoom
 * (or half the default, for a small build) up to 400%, and a view that always shows some of one target.
 */
export const limitsFor = (targets: readonly Polygon[], width: number, height: number): ViewLimits => {
  const kept = targets.length > 0 ? targets : [EMPTY_TARGET];
  let bounds: Rect | undefined;
  for (const target of kept) bounds = unionRect(bounds, rectOfPoints(target));
  const fit = fittingZoom(bounds as Rect, Math.max(1, width), Math.max(1, height));
  return { minZoom: Math.min(1, fit) / ZOOM_OUT_BEYOND_FIT, maxZoom: MAX_ZOOM, targets: kept };
};

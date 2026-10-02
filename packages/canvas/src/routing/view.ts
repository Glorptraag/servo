// Zoom limits that keep the build on screen (task 3.7, brief Section 10: "zoom limits stop the build from getting
// lost"), measured in the part of the canvas the child can see: the host less the safe area the app's panels and the
// device's insets cover (D66, D70). Plain maths, no Pixi. See docs/routing.md.
import type { Vec2 } from '@servo/schema';
import type { CanvasSafeArea } from '../interface.ts';
import { rectWidth, rectHeight } from '../scene/geometry.ts';
import type { Rect } from '../scene/geometry.ts';

/** Nothing covered. */
export const NO_SAFE_AREA: CanvasSafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * However much the app says is covered, at least this share of the canvas's width and of its height stays
 * uncovered. Panels cover at most 30% of the canvas (D66); this only guards against a wrong measurement.
 */
export const MIN_UNCOVERED_SHARE = 0.5;

/** Screen pixels of the build always on screen: a whole small tile (96 px), or as much of a bigger one. */
export const KEEP_ON_SCREEN_PX = 96;

/** A rectangle of screen pixels from the canvas element's top left. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Each inset a finite number from 0; anything else is refused. */
export const checkSafeArea = (area: CanvasSafeArea): CanvasSafeArea => {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  for (const side of sides) {
    const value: unknown = (area as unknown as Record<string, unknown>)[side];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`A safe area's ${side} is a finite number of pixels from 0, not ${String(value)}.`);
    }
  }
  return { top: area.top, right: area.right, bottom: area.bottom, left: area.left };
};

/** Two insets on one axis, shrunk together until at least `MIN_UNCOVERED_SHARE` of `size` is left between them. */
const squeeze = (before: number, after: number, size: number): [number, number] => {
  const most = size * (1 - MIN_UNCOVERED_SHARE);
  const total = before + after;
  if (total <= most || total === 0) return [before, after];
  return [(before * most) / total, (after * most) / total];
};

/** The part of a `width` × `height` canvas the child can see. */
export const uncovered = (width: number, height: number, area: CanvasSafeArea): ScreenRect => {
  const [left, right] = squeeze(area.left, area.right, width);
  const [top, bottom] = squeeze(area.top, area.bottom, height);
  return { x: left, y: top, width: Math.max(1, width - left - right), height: Math.max(1, height - top - bottom) };
};

export const screenCentre = (rect: ScreenRect): Vec2 => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/**
 * Where the plane point at the centre of the uncovered view (the focus) may be, at `scale` screen pixels per mm, so
 * that at least `KEEP_ON_SCREEN_PX` of one target (all of it when it is smaller) is on screen and uncovered on both
 * axes. One rectangle per target; the focus may be in any.
 */
export const focusArea = (targets: readonly Rect[], view: ScreenRect, scale: number): Rect[] => {
  const halfW = view.width / 2 / scale;
  const halfH = view.height / 2 / scale;
  const keep = KEEP_ON_SCREEN_PX / scale;
  return targets.map((target) => {
    const keepX = Math.min(keep, rectWidth(target), 2 * halfW);
    const keepY = Math.min(keep, rectHeight(target), 2 * halfH);
    return {
      minX: target.minX - halfW + keepX,
      minY: target.minY - halfH + keepY,
      maxX: target.maxX + halfW - keepX,
      maxY: target.maxY + halfH - keepY,
    };
  });
};

/** The nearest point of the area to `point`, and how far it is; the first rectangle wins a tie. */
const nearest = (area: readonly Rect[], point: Vec2): { readonly at: Vec2; readonly gap: number } => {
  let best = { at: point, gap: Infinity };
  for (const rect of area) {
    const at = { x: Math.min(Math.max(point.x, rect.minX), rect.maxX), y: Math.min(Math.max(point.y, rect.minY), rect.maxY) };
    const gap = Math.hypot(point.x - at.x, point.y - at.y);
    if (gap < best.gap) best = { at, gap };
  }
  return best;
};

/**
 * Holds the focus in `area` (the area at the new zoom) without jumping. A view that was within the limits
 * (`previous` in `previousArea`, the area at the zoom before) stays within them, sliding along their edge. A view
 * that was already outside them (after a load, a resize or a new safe area) may move back towards the area, or keep
 * its distance, but never move further out, so a limit never makes it jump.
 */
export const holdFocus = (next: Vec2, previous: Vec2, area: readonly Rect[], previousArea: readonly Rect[] = area): Vec2 => {
  const wanted = nearest(area, next);
  if (wanted.gap <= 1e-9) return next;
  if (nearest(previousArea, previous).gap <= 1e-9) return wanted.at;
  const before = nearest(area, previous).gap;
  if (wanted.gap <= before) return next;
  const k = before / wanted.gap;
  return { x: wanted.at.x + (next.x - wanted.at.x) * k, y: wanted.at.y + (next.y - wanted.at.y) * k };
};

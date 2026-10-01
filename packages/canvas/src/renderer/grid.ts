// The workbench grid (brief Sections 9 and 11): faint, between the arena and the build, and shown only while
// something moves; at rest it fades out. It is drawn in canvas millimetres with hairlines one device pixel wide, over
// an area three views across, so panning and zooming move it on the GPU and it is redrawn only when the view leaves
// that area or the zoom calls for another spacing.
import { Graphics } from 'pixi.js';
import type { Rect } from '../scene/geometry.ts';
import type { Camera } from './camera.ts';
import type { Palette } from './style.ts';

/** Minor spacings in mm; every fifth minor line is a major one. */
export const GRID_STEPS_MM: readonly number[] = [10, 50, 250, 1250, 6250];
/** Minor lines are never closer than this on screen. */
export const MIN_GRID_SPACING_PX = 18;
/** How long after the last movement the grid starts to fade, and how long it takes (UI motion, brief Section 11). */
export const GRID_REST_MS = 600;
export const GRID_FADE_IN_MS = 120;
export const GRID_FADE_OUT_MS = 200;

export const gridStepFor = (scale: number): number =>
  GRID_STEPS_MM.find((step) => step * scale >= MIN_GRID_SPACING_PX) ?? (GRID_STEPS_MM[GRID_STEPS_MM.length - 1] as number);

const inside = (outer: Rect, inner: Rect): boolean =>
  inner.minX >= outer.minX && inner.minY >= outer.minY && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;

export class Grid {
  readonly graphics = new Graphics({ label: 'grid' });
  private drawn: { readonly step: number; readonly area: Rect; readonly palette: Palette } | undefined;

  /** Makes sure the lines cover the view at the right spacing; redraws only when they do not. */
  cover(camera: Camera, palette: Palette): void {
    const step = gridStepFor(camera.scale);
    const view = camera.visible();
    const drawn = this.drawn;
    if (drawn && drawn.step === step && drawn.palette === palette && inside(drawn.area, view)) return;
    const major = step * 5;
    const width = view.maxX - view.minX;
    const height = view.maxY - view.minY;
    const area: Rect = {
      minX: Math.floor((view.minX - width) / major) * major,
      minY: Math.floor((view.minY - height) / major) * major,
      maxX: Math.ceil((view.maxX + width) / major) * major,
      maxY: Math.ceil((view.maxY + height) / major) * major,
    };
    const g = this.graphics;
    g.clear();
    for (const majorLines of [false, true]) {
      for (let i = Math.round(area.minX / step); i * step <= area.maxX; i++) {
        if ((i % 5 === 0) !== majorLines) continue;
        g.moveTo(i * step, area.minY).lineTo(i * step, area.maxY);
      }
      for (let j = Math.round(area.minY / step); j * step <= area.maxY; j++) {
        if ((j % 5 === 0) !== majorLines) continue;
        g.moveTo(area.minX, j * step).lineTo(area.maxX, j * step);
      }
      g.stroke({
        color: majorLines ? palette.gridMajor : palette.gridMinor,
        alpha: majorLines ? palette.gridMajorAlpha : palette.gridMinorAlpha,
        pixelLine: true,
      });
    }
    this.drawn = { step, area, palette };
  }

  /** Forgets what was drawn, so the next `cover` redraws. */
  invalidate(): void {
    this.drawn = undefined;
  }
}

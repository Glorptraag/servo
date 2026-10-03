// Whether the build is still findable on screen (task 3.7, review R-3.7 finding 3), measured on what is drawn and
// independently of the zoom limits' own maths: shared by the camera's unit tests and the browser tests.
import type { Vec2 } from '@servo/schema';
import type { Camera } from '../../src/renderer/camera.ts';
import { KEEP_ON_SCREEN_PX } from '../../src/routing/view.ts';
import type { Polygon } from '../../src/routing/view.ts';

const insideConvex = (shape: Polygon, point: Vec2): boolean => {
  let sign = 0;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i] as Vec2;
    const b = shape[(i + 1) % shape.length] as Vec2;
    const side = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (side === 0) continue;
    if (sign === 0) sign = Math.sign(side);
    else if (Math.sign(side) !== sign) return false;
  }
  return true;
};

/**
 * Whether the build is still findable, measured on what is drawn and independently of the limits' maths: the
 * square screen pixels of one target's turned shape inside the uncovered view, counted on a 2 px grid, reach a 96 px
 * square's worth (or the shape's own `min(side, 96) × min(side, 96)` when a side is shorter).
 */
export const findable = (view: Camera, targets: readonly Polygon[]): boolean => {
  const shown = view.uncovered();
  const step = 2;
  return targets.some((target) => {
    const [a, b, c] = target.map((corner) => view.worldToScreen(corner)) as [Vec2, Vec2, Vec2];
    const sideA = Math.hypot(b.x - a.x, b.y - a.y);
    const sideB = Math.hypot(c.x - b.x, c.y - b.y);
    const needed = Math.min(KEEP_ON_SCREEN_PX, sideA) * Math.min(KEEP_ON_SCREEN_PX, sideB) * 0.97;
    const onScreen = target.map((corner) => view.worldToScreen(corner));
    // Only the grid points within both the view and the shape's own screen box can count.
    const left = Math.max(shown.x, Math.min(...onScreen.map((p) => p.x)));
    const right = Math.min(shown.x + shown.width, Math.max(...onScreen.map((p) => p.x)));
    const top = Math.max(shown.y, Math.min(...onScreen.map((p) => p.y)));
    const bottom = Math.min(shown.y + shown.height, Math.max(...onScreen.map((p) => p.y)));
    let seen = 0;
    for (let y = shown.y + step / 2 + Math.max(0, Math.floor((top - shown.y) / step)) * step; y < bottom; y += step) {
      for (let x = shown.x + step / 2 + Math.max(0, Math.floor((left - shown.x) / step)) * step; x < right; x += step) {
        if (insideConvex(onScreen, { x, y })) seen += step * step;
        if (seen >= needed) return true;
      }
    }
    return false;
  });
};

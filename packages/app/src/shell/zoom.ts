// The zoom control's steps. Zoom in and out move along a ladder of zooms a half power of two apart: 0.5, 0.71, 1,
// 1.41, 2, 2.83, 4. Two taps double or halve, and the default (1) and the brief's 400% (4) are both rungs. After a
// pinch leaves the zoom between rungs, the next tap lands on the nearest rung in its direction. The canvas holds
// every zoom inside its own limits (packages/canvas/docs/renderer.md, "The view").

/** Rungs per doubling. */
const RUNGS_PER_DOUBLING = 2;
/** A zoom this close to a rung counts as on it, so float error never skips one. */
const EPSILON = 1e-6;

const rungOf = (zoom: number): number => Math.log2(zoom) * RUNGS_PER_DOUBLING;
const zoomAt = (rung: number): number => 2 ** (rung / RUNGS_PER_DOUBLING);

/** The next rung up from `zoom`. */
export const zoomInFrom = (zoom: number): number => zoomAt(Math.floor(rungOf(zoom) + EPSILON) + 1);

/** The next rung down from `zoom`. */
export const zoomOutFrom = (zoom: number): number => zoomAt(Math.ceil(rungOf(zoom) - EPSILON) - 1);

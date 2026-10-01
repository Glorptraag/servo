// Sizes on the canvas. The canvas plane is in millimetres (packages/schema/docs/geometry.md); the brief gives
// sizes in screen pixels at the default zoom (Section 9). PX_PER_MM joins the two. See docs/renderer.md.

/**
 * Screen pixels (CSS) per canvas millimetre at zoom 1, the default zoom. At 2.5 the example parts' true sizes
 * land in the brief's 96–160 px tile band (a DC motor 115 px, a battery pack 145 px), and a Level 1 robot
 * (about 170 × 185 mm) fits a 10-inch tablet's canvas without scrolling.
 */
export const PX_PER_MM = 2.5;

/** Brief Sections 9 and 13: ports are at least 44 px at default zoom, as a touch target and as drawn. */
export const PORT_PX = 44;
/** The gap left between two sockets on a part's outline, so neighbouring targets never overlap. */
export const PORT_GAP_PX = 8;
/** A part's tile is at least this long on its longer side at default zoom (brief Section 9: 96–160 px tiles). */
export const MIN_TILE_PX = 96;
/** Power and signal lines (brief Section 9). */
export const WIRE_PX = 6;
/** A wire's hit area (brief Section 9), for hit testing by the input paths. */
export const WIRE_HIT_PX = 24;
/** The thick grey line of a mechanical linkage (brief Section 13: thick grey mechanical). */
export const LINKAGE_PX = 10;
/** Signal lines are dashed (brief Section 13): dash and gap at default zoom. */
export const DASH_PX = 12;
export const DASH_GAP_PX = 7;

/** Zoom 1 is the default; 4 is 400% (brief Section 13). Task 3.7 extends the limits. */
export const MAX_ZOOM = 4;

/** Converts a size in screen pixels at default zoom to canvas millimetres. */
export const mmOf = (px: number): number => px / PX_PER_MM;

export const PORT_MM = mmOf(PORT_PX);
export const PORT_GAP_MM = mmOf(PORT_GAP_PX);
export const MIN_TILE_MM = mmOf(MIN_TILE_PX);
export const WIRE_MM = mmOf(WIRE_PX);
export const WIRE_HIT_MM = mmOf(WIRE_HIT_PX);
export const LINKAGE_MM = mmOf(LINKAGE_PX);
export const DASH_MM = mmOf(DASH_PX);
export const DASH_GAP_MM = mmOf(DASH_GAP_PX);

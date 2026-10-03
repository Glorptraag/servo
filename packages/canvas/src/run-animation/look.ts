// How Run mode looks and how fast its motion goes (brief Section 11: every motion has a physical cause). Sizes are the
// brief's pixels at default zoom, in canvas millimetres, so they zoom with the build. See docs/run-animation.md.
import { mmOf } from '../scene/units.ts';

/** Dots along a live wire: this far apart, and this wide (a little wider than the 6 px wire, so they read on it). */
export const DOT_SPACING_MM = mmOf(36);
export const DOT_MM = mmOf(11);
/** A dot's fill is its wire's colour mixed this far towards white: the same colour, lit. */
export const DOT_LIGHTEN = 0.6;

/**
 * Dots on a power line move at this many mm/s per √mA of current, at a simulated second's pace, so a trickle crawls
 * and a short races. Capped so a dot never moves more than half the spacing in a 60 Hz frame at full speed.
 */
export const DOT_MM_PER_S_PER_ROOT_MA = 4;
export const DOT_MAX_MM_PER_S = 300;
/** A power line carrying less than this is dead: no dots. */
export const LIVE_MA = 0.1;
/** A signal line at level 1 moves its dots this fast; below LIVE_SIGNAL it is dead. */
export const SIGNAL_MM_PER_S = 60;
export const LIVE_SIGNAL = 0.01;

/** Tread marks along a wheel's two long edges, this far apart, slide at the tyre's surface speed. */
export const TREAD_SPACING_MM = 16;
export const TREAD_MARK_MM = mmOf(4);

/** A stalled part shudders this far either side, once a tick (brief Section 11: a stalled motor shudders). */
export const SHUDDER_MM = mmOf(2.5);

/** A servo motor's arm: length from its drive port, and width. */
export const ARM_MM = 24;
export const ARM_WIDTH_MM = mmOf(10);

/** A light's glow reaches this far past its tile's half-diagonal. */
export const GLOW_REACH_MM = 10;

/** Sound twins pulse this many times a simulated second (a buzzer's pulse, a hum's tremble, a motor's whirr). */
export const PULSE_HZ = { motor: 2, hum: 6, buzz: 3, squeal: 8, knock: 2 } as const;

/** A tilted body casts a shadow this far, at most, towards the side it leans to. */
export const SHADOW_REACH_MM = 14;
export const SHADOW_ALPHA = 0.22;
/** Tilts below this many degrees cast no shadow. */
export const SHADOW_FROM_DEG = 1;
/** A fallen body is drawn no thinner than this fraction of its footprint, so it stays visible. */
export const MIN_FORESHORTEN = 0.2;

/** Scrape marks on the floor where a dragging frame's low edge passes: three scratches across it. */
export const SCRAPE_WIDTH_MM = mmOf(3);
export const SCRAPE_ALPHA = 0.85;
/** At most this many tick points per scratch, so a long Run's marks stay cheap to draw. */
export const SCRAPE_MAX_POINTS = 900;

/** Frames further apart than this (slow motion at 1 tick a second) still tween over at most this long. */
export const TWEEN_MAX_MS = 1000;
/** While the Run holds tick 0 (the spin-up), live wires' dots flow at a simulated second's pace. */
export const SPIN_UP_CATCH_UP_MM_PER_S = 40;

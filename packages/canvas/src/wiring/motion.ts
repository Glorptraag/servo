// How wiring moves (brief Sections 10 and 11): UI motion is short, 120–200 ms, and every motion has a cause. A crowd
// fans out, a wire that lands settles into its socket with a short elastic overshoot, and a wire let go springs softly
// back. With reduced motion the canvas skips straight to the end. Pure.

/** A crowd of sockets fans out over this long. */
export const FAN_MS = 150;
/** A wire that lands settles into its socket over this long, elastically. */
export const SETTLE_MS = 180;
/** A wire let go away from a socket that takes it springs back to its source over this long. */
export const SPRING_BACK_MS = 160;
/** A tapped socket that refuses the wire: the wire reaches for it over this long, then springs back. */
export const REACH_MS = 120;

/** Fast, then slowing to a stop. */
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Past the end and back, settling by the end: a wire end pressed home into its socket. */
export const elastic = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.cos(t * Math.PI * 2.5) * Math.exp(-6 * t));

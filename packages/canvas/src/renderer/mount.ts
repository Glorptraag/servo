import type { MountCanvas } from '../interface.ts';
import { CanvasSurface } from './surface.ts';

/**
 * Draws the canvas into `host` and returns its handle. The canvas element fills the host's content box and follows
 * its size, so the host needs a definite size (the app's layout gives it one). Drawing starts once the GPU
 * renderer is up, a moment after the call; the handle works from the start.
 */
export const mountCanvas: MountCanvas = (host, options) => new CanvasSurface(host, options);

// Port sockets (brief Sections 11 and 13, D20): the wire colour and the socket shape together, so colour is never
// the only cue (power round, signal square, mechanical hexagon); hollow when empty, filled when connected; never
// smaller than 44 px at default zoom.
import { PORT_TYPE_STYLE } from '@servo/schema';
import type { PortType, Vec2 } from '@servo/schema';
import type { Graphics } from 'pixi.js';
import { PORT_MM, mmOf } from '../scene/units.ts';
import type { Palette } from './style.ts';

/** The coloured ring of a hollow socket. */
export const RING_MM = mmOf(4);
/** The dark edge of a filled socket. */
export const EDGE_MM = mmOf(1.5);
/** The halo of a highlighted socket (focus states, task 3.4). */
export const HALO_MM = mmOf(6);

export type SocketShape = (typeof PORT_TYPE_STYLE)[PortType]['socket'];

export const socketShapeOf = (type: PortType): SocketShape => PORT_TYPE_STYLE[type].socket;

/** Adds the outline of a socket of `size` (its smallest width), centred on `at`, to `g`'s current path. */
const traceShape = (g: Graphics, shape: SocketShape, at: Vec2, size: number): void => {
  if (shape === 'round') {
    g.circle(at.x, at.y, size / 2);
    return;
  }
  if (shape === 'square') {
    g.roundRect(at.x - size / 2, at.y - size / 2, size, size, size * 0.12);
    return;
  }
  // A hexagon with flat top and bottom: its height, the smallest width, is `size`.
  const r = size / Math.sqrt(3);
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push(at.x + r * Math.cos(angle), at.y + r * Math.sin(angle));
  }
  g.poly(points, true);
};

export interface SocketLook {
  readonly type: PortType;
  /** In the Graphics' own space. */
  readonly at: Vec2;
  readonly connected: boolean;
  readonly highlighted?: boolean;
}

/** Draws one socket into `g`. Strokes sit inside the shape, so the socket's outer size stays `PORT_MM`. */
export const drawSocket = (g: Graphics, look: SocketLook, palette: Palette): void => {
  const shape = socketShapeOf(look.type);
  const colours = palette.types[look.type];
  if (look.highlighted) {
    traceShape(g, shape, look.at, PORT_MM + 2 * HALO_MM);
    g.fill({ color: colours.colour, alpha: 0.35 });
  }
  // A stroke straight after a fill reuses the fill's path.
  traceShape(g, shape, look.at, PORT_MM);
  if (look.connected) {
    g.fill({ color: colours.colour }).stroke({ color: colours.casing, width: EDGE_MM, alignment: 1 });
  } else {
    g.fill({ color: palette.socketInner }).stroke({ color: colours.colour, width: RING_MM, alignment: 1 });
  }
};

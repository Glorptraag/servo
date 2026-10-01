// Where the canvas's own controls and its one line sit (brief Sections 9 and 10, D44): the handles beside the selected
// part and the callout. What the child sees is what a tap reaches: the handles draw on top, so they are placed clear
// of every socket, and the callout clear of every socket and handle. Pure: canvas millimetres in, places out.
// See docs/placement.md.
import type { Vec2 } from '@servo/schema';
import type { Rect } from '../scene/geometry.ts';

export type HandleKind = 'move' | 'rotate' | 'bin';

/** Something round a tap may reach: a socket or a handle. */
export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface HandleQuery {
  /** The handles to show, top to bottom in their column. */
  readonly kinds: readonly HandleKind[];
  /** The selected part's tile and sockets on the canvas. */
  readonly part: Rect;
  /** Every socket a tap can reach (drawn above the parts), with how far it reaches. */
  readonly sockets: readonly Circle[];
  /** A handle's radius: 22 px at the current zoom. */
  readonly radius: number;
  /** The space between the part and its handles, and between handles. */
  readonly gap: number;
  /** What the screen shows; handles stay inside it where they can. */
  readonly view?: Rect;
  /** Handles go on the part's left first (D44), otherwise on its right. */
  readonly leftHanded: boolean;
}

/** How far out from the part a column of handles may go, in columns, and how far up or down, in handle radii. */
const COLUMNS_OUT = 4;
const SHIFTS = 8;

const clearOf = (at: Vec2, radius: number, sockets: readonly Circle[]): boolean =>
  sockets.every((socket) => {
    const dx = socket.x - at.x;
    const dy = socket.y - at.y;
    const reach = socket.r + radius;
    return dx * dx + dy * dy >= reach * reach;
  });

const inside = (at: Vec2, radius: number, view: Rect | undefined): boolean =>
  !view || (at.x - radius >= view.minX && at.x + radius <= view.maxX && at.y - radius >= view.minY && at.y + radius <= view.maxY);

/**
 * The handles' places: a column beside the part, on its right (its left for left-handed use), first at the part's
 * middle, then shifted up and down, then on the other side, then a column further out. The first place where every
 * handle is clear of every socket and inside the view wins; failing the view, the first clear of every socket.
 * Failing both, only the handles clear of every socket are shown, so a handle never covers a socket.
 */
export const layOutHandles = (query: HandleQuery): ReadonlyMap<HandleKind, Vec2> => {
  const { kinds, part, radius, gap, sockets, view } = query;
  const step = 2 * radius + gap;
  const middle = (part.minY + part.maxY) / 2;
  const sides = query.leftHanded ? [-1, 1] : [1, -1];
  const shifts = [0, ...Array.from({ length: SHIFTS }, (_, i) => [i + 1, -(i + 1)]).flat()];
  const columns: Map<HandleKind, Vec2>[] = [];
  for (let out = 0; out < COLUMNS_OUT; out++) {
    for (const side of sides) {
      const x = side > 0 ? part.maxX + gap + radius + out * step : part.minX - gap - radius - out * step;
      for (const shift of shifts) {
        const top = middle + shift * radius - ((kinds.length - 1) / 2) * step;
        columns.push(new Map(kinds.map((kind, index) => [kind, { x, y: top + index * step }] as const)));
      }
    }
  }
  const clear = (column: Map<HandleKind, Vec2>): boolean => [...column.values()].every((at) => clearOf(at, radius, sockets));
  const shown = (column: Map<HandleKind, Vec2>): boolean => [...column.values()].every((at) => inside(at, radius, view));
  const best = columns.find((column) => clear(column) && shown(column)) ?? columns.find(clear);
  if (best) return best;
  const [first] = columns;
  return new Map([...(first ?? new Map<HandleKind, Vec2>())].filter(([, at]) => clearOf(at, radius, sockets)));
};

/** Whether a box (its centre and size) and a circle overlap. */
const boxMeets = (centre: Vec2, size: { readonly w: number; readonly h: number }, circle: Circle): boolean => {
  const nearestX = Math.min(Math.max(circle.x, centre.x - size.w / 2), centre.x + size.w / 2);
  const nearestY = Math.min(Math.max(circle.y, centre.y - size.h / 2), centre.y + size.h / 2);
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy < circle.r * circle.r;
};

/**
 * Where the callout's box is centred: above the area it speaks about, or below it, then further out a line at a time,
 * held across inside the view. The first place inside the view clear of every socket and handle wins; failing that,
 * the first inside the view; failing that, just above the area.
 */
export const layOutCallout = (
  size: { readonly w: number; readonly h: number },
  over: Rect,
  avoid: readonly Circle[],
  view: Rect,
  gap: number,
): Vec2 => {
  const hold = (value: number, min: number, max: number): number => (min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max));
  const x = hold((over.minX + over.maxX) / 2, view.minX + size.w / 2, view.maxX - size.w / 2);
  const places: Vec2[] = [];
  for (let line = 0; line <= 12; line++) {
    places.push({ x, y: over.minY - gap - size.h / 2 - line * size.h });
    places.push({ x, y: over.maxY + gap + size.h / 2 + line * size.h });
  }
  const visible = (at: Vec2): boolean => at.y - size.h / 2 >= view.minY && at.y + size.h / 2 <= view.maxY;
  const clear = (at: Vec2): boolean => avoid.every((circle) => !boxMeets(at, size, circle));
  return places.find((at) => visible(at) && clear(at)) ?? places.find(visible) ?? (places[0] as Vec2);
};

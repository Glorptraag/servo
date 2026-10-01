// What wiring draws over the sockets, in the ports-and-handles layer (brief Section 9): the glow of a socket a wire
// can land on, the ring round a waiting wire's source, a crowd fanned out on its leads, the free end of a wire under a
// finger, and the bin beside a tapped wire. Colour is kept for meaning: every glow is in its socket's wire colour, and
// each socket keeps its shape (D20). All in canvas millimetres, sized from the brief's pixels at the default zoom.
import { Graphics } from 'pixi.js';
import type { PortType, Vec2 } from '@servo/schema';
import { drawSocket } from '../renderer/sockets.ts';
import type { Palette } from '../renderer/style.ts';
import { PORT_MM, mmOf } from '../scene/units.ts';

/** How a socket looks: its type and whether a wire ends on it (hollow or filled). */
export interface SocketMark {
  readonly at: Vec2;
  readonly type: PortType;
  readonly connected: boolean;
}

/** A crowd's member fanned out: its lead from where the scene draws it, and its sockets where it is now. */
export interface FanMark {
  readonly home: Vec2;
  readonly sockets: readonly SocketMark[];
}

export interface Marks {
  readonly fan?: readonly FanMark[];
  /** Sockets that would take the wire: the right colour glowing. */
  readonly hints?: readonly SocketMark[];
  /** The socket the wire would land on now. */
  readonly target?: SocketMark;
  /** The wire's source while it waits for its tap or is under a finger. */
  readonly source?: SocketMark;
  /** The free end of a wire on its way. */
  readonly plug?: { readonly at: Vec2; readonly type: PortType };
  /** The bin beside a tapped wire. */
  readonly bin?: Vec2;
}

/** A 44 px target, as a port's (brief Section 9). */
export const BIN_MM = PORT_MM;
const LEAD_MM = mmOf(3);
const LEAD_DOT_MM = mmOf(5);
const BACKING_MM = mmOf(4);
const HINT_GLOW_MM = mmOf(9);
const TARGET_GLOW_MM = mmOf(14);
const TARGET_RING_MM = mmOf(3);
const SOURCE_RING_MM = mmOf(4);
const RING_GAP_MM = mmOf(6);
const PLUG_MM = mmOf(7);
const ICON_MM = mmOf(3);

/** The glow round a socket a wire can land on, and the socket itself above it, so it shows above any neighbour. */
const glow = (g: Graphics, mark: SocketMark, palette: Palette, reach: number, alpha: number): void => {
  g.circle(mark.at.x, mark.at.y, PORT_MM / 2 + reach).fill({ color: palette.types[mark.type].colour, alpha });
  drawSocket(g, mark, palette);
};

export class WireMarks {
  readonly graphics = new Graphics({ label: 'wiring' });

  draw(marks: Marks, palette: Palette): void {
    const g = this.graphics;
    g.clear();
    for (const member of marks.fan ?? []) {
      const [first] = member.sockets;
      if (!first) continue;
      const { colour, casing } = palette.types[first.type];
      g.moveTo(member.home.x, member.home.y).lineTo(first.at.x, first.at.y).stroke({ color: casing, width: LEAD_MM, cap: 'round' });
      g.circle(member.home.x, member.home.y, LEAD_DOT_MM / 2).fill({ color: colour });
      g.circle(first.at.x, first.at.y, PORT_MM / 2 + BACKING_MM).fill({ color: palette.tile }).stroke({ color: casing, width: mmOf(1.5), alignment: 1 });
      for (const socket of member.sockets) drawSocket(g, socket, palette);
    }
    for (const hint of marks.hints ?? []) glow(g, hint, palette, HINT_GLOW_MM, 0.35);
    if (marks.target) {
      glow(g, marks.target, palette, TARGET_GLOW_MM, 0.55);
      g.circle(marks.target.at.x, marks.target.at.y, PORT_MM / 2 + RING_GAP_MM).stroke({ color: palette.types[marks.target.type].casing, width: TARGET_RING_MM });
    }
    if (marks.source) {
      const { at, type } = marks.source;
      g.circle(at.x, at.y, PORT_MM / 2 + RING_GAP_MM).stroke({ color: palette.types[type].colour, width: SOURCE_RING_MM });
      drawSocket(g, marks.source, palette);
    }
    if (marks.plug) {
      const { at, type } = marks.plug;
      g.circle(at.x, at.y, PLUG_MM).fill({ color: palette.types[type].colour }).stroke({ color: palette.types[type].casing, width: mmOf(1.5), alignment: 1 });
    }
    if (marks.bin) this.drawBin(marks.bin, palette);
  }

  clear(): void {
    this.graphics.clear();
  }

  /** A round 44 px handle with a bin on it, as the bin beside a selected part (placement/views.ts). */
  private drawBin(at: Vec2, palette: Palette): void {
    const g = this.graphics;
    const r = BIN_MM / 2;
    g.circle(at.x, at.y, r).fill({ color: palette.tile }).stroke({ color: palette.tileEdge, width: mmOf(2), alignment: 1 });
    const w = r * 0.9;
    g.rect(at.x - w / 2, at.y - w * 0.45, w, ICON_MM).fill({ color: palette.label });
    g.rect(at.x - w * 0.15, at.y - w * 0.6, w * 0.3, ICON_MM).fill({ color: palette.label });
    g.roundRect(at.x - w * 0.38, at.y - w * 0.3, w * 0.76, w * 0.8, ICON_MM / 2).stroke({ color: palette.label, width: ICON_MM });
  }
}

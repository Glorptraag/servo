// @servo/canvas/testing: what a test hand needs to know about a mounted canvas beyond its interface, for
// packages/tools' e2e harness and this package's tests only. Lint keeps it out of every other package's src/
// (eslint.config.js, `toolsOnly`): the app reaches the canvas through '@servo/canvas' alone. Where a part, a socket,
// a wire or a handle sits on the page now, when a frame is final, and a way to set the view without the limits.
// See README.md, "Testing entry".
import type { PlacedPartId, PortRef, Vec2, WireId } from '@servo/schema';
import type { CanvasHandle } from './interface.ts';
import { CanvasSurface } from './renderer/surface.ts';
import type { Emphasis } from './renderer/views.ts';
import { wireOf } from './selection/focus.ts';

/** A point twice over: on the canvas plane (mm) and on the page (CSS pixels from the page's top left, as `clientX`). */
export interface Place {
  readonly world: Vec2;
  readonly page: Vec2;
}

/** In Run mode, where a part, a socket or a line is drawn now, as the Run moves the robot. */
export interface PartPlace {
  /** The part's frame origin, where its tile is centred. */
  readonly centre: Place;
  /** The tile's corners, clockwise from the back left. */
  readonly corners: readonly Place[];
}

export interface SocketPlace {
  /** Where the scene draws the socket. */
  readonly at: Place;
  /** Where it takes a press now: where its crowd fanned it out (task 3.3), or where it is drawn. */
  readonly press: Place;
  /** Whether its crowd is fanned out now. */
  readonly fanned: boolean;
}

export interface WirePlace {
  readonly from: Place;
  readonly to: Place;
  /** Halfway along: where a tap selects it. */
  readonly middle: Place;
  /** The line as drawn, end to end: two points, or a tidied route's corners too. */
  readonly path: readonly Place[];
}

export interface CanvasView {
  /** The plane point in the middle of the canvas, mm. */
  readonly centre: Vec2;
  readonly zoom: number;
  /** The canvas's size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** CSS pixels per millimetre at this zoom. */
  readonly scale: number;
}

export interface CanvasProbe {
  /** Resolves once the GPU renderer is up. */
  readonly ready: Promise<void>;
  /** Nothing is loading, fading or waiting to be drawn: the picture on screen is final (the grid may still show). */
  readonly settled: boolean;
  /** The grid's opacity: 0 once the view has rested. */
  readonly gridOpacity: number;
  readonly canvas: HTMLCanvasElement;
  readonly view: CanvasView;
  /**
   * Puts `centre` (mm) in the middle of the canvas at `zoom`, as a hand would pan and zoom, without the view's limits
   * and without a `zoom` event. The view is not part of the build.
   */
  setView(centre: Vec2, zoom: number): void;
  /** Asks for a frame after a change made outside the handle. */
  requestFrame(): void;
  /** A plane point (mm) on the page. */
  pageOf(world: Vec2): Vec2;
  /** A page point on the plane (mm). */
  worldOf(page: Vec2): Vec2;
  /** Undefined when the canvas shows no such part, socket or wire. */
  part(id: PlacedPartId): PartPlace | undefined;
  socket(port: PortRef | string): SocketPlace | undefined;
  wire(id: WireId): WirePlace | undefined;
  /** The handles beside the selected part (move, rotate, bin) or the selected prop (move, bin), and the bin beside a selected wire. */
  handles(): ReadonlyMap<'move' | 'rotate' | 'bin', Place>;
  /** How a part or wire is drawn now: dimmed or highlighted by a focus state, or normal. */
  emphasis(subject: { readonly part: PlacedPartId } | { readonly wire: WireId }): Emphasis | undefined;
  /** The label on the selected wire: what flows on it. */
  readonly wireLabel: string | undefined;
  /** Where that label's pill is drawn: its centre, and its size in CSS pixels. */
  readonly wireLabelBox: { readonly centre: Place; readonly width: number; readonly height: number } | undefined;
}

/** The probe for a canvas `mountCanvas` made. Throws for anything else. */
export const probeCanvas = (handle: CanvasHandle): CanvasProbe => {
  if (!(handle instanceof CanvasSurface)) throw new TypeError('probeCanvas takes a canvas that mountCanvas made.');
  const surface = handle;
  const { camera } = surface;
  const pageOf = (world: Vec2): Vec2 => {
    const screen = camera.worldToScreen(world);
    const box = surface.canvas.getBoundingClientRect();
    return { x: box.left + screen.x, y: box.top + screen.y };
  };
  const place = (world: Vec2): Place => ({ world: { x: world.x, y: world.y }, page: pageOf(world) });
  /** In Run mode parts, sockets and lines are where the Run draws them now (task 3.5), not where the build has them. */
  const running = (): boolean => surface.mode === 'run';
  return {
    ready: surface.ready,
    get settled() {
      return surface.settled;
    },
    get gridOpacity() {
      return surface.gridOpacity;
    },
    canvas: surface.canvas,
    get view() {
      return { centre: { x: camera.centreX, y: camera.centreY }, zoom: camera.zoom, width: camera.width, height: camera.height, scale: camera.scale };
    },
    setView: (centre, zoom) => {
      Object.assign(camera, { centreX: centre.x, centreY: centre.y, zoom });
      surface.requestFrame();
    },
    requestFrame: () => surface.requestFrame(),
    pageOf,
    worldOf: (page) => {
      const box = surface.canvas.getBoundingClientRect();
      return camera.screenToWorld({ x: page.x - box.left, y: page.y - box.top });
    },
    part: (id) => {
      const part = surface.scene.partById.get(id);
      if (!part) return undefined;
      if (!running()) return { centre: place({ x: part.pose.x, y: part.pose.y }), corners: part.corners.map(place) };
      const { w, h } = part.tile;
      const corners = [
        { x: -w / 2, y: h / 2 },
        { x: w / 2, y: h / 2 },
        { x: w / 2, y: -h / 2 },
        { x: -w / 2, y: -h / 2 },
      ];
      return { centre: place(surface.run.partPoint(id, { x: 0, y: 0 })), corners: corners.map((corner) => place(surface.run.partPoint(id, corner))) };
    },
    socket: (port) => {
      const key = typeof port === 'string' ? port : `${port.part}.${port.port}`;
      const socket = surface.scene.portByKey.get(key);
      if (!socket) return undefined;
      if (running()) {
        const at = place(surface.run.partPoint(socket.ref.part, socket.local));
        return { at, press: at, fanned: false };
      }
      const fanned = surface.wiring.fanned?.get(key);
      return { at: place(socket.at), press: place(fanned ?? socket.at), fanned: fanned !== undefined };
    },
    wire: (id) => {
      const wire = wireOf(surface.scene, id);
      if (!wire) return undefined;
      // The line as drawn: in Run mode where the Run draws it, along its route once tidied (task 3.7).
      const path = (running() ? surface.run.pathOf(id) : surface.wireView(id)?.path) ?? [wire.from.at, wire.to.at];
      const from = path[0] ?? wire.from.at;
      const to = path[path.length - 1] ?? wire.to.at;
      // Halfway along the line, which on a route is not halfway between its ends.
      const lengths = path.slice(1).map((point, k) => Math.hypot(point.x - (path[k] as Vec2).x, point.y - (path[k] as Vec2).y));
      let left = lengths.reduce((sum, length) => sum + length, 0) / 2;
      let middle = from;
      for (const [k, length] of lengths.entries()) {
        const a = path[k] as Vec2;
        const b = path[k + 1] as Vec2;
        if (left <= length) {
          const t = length === 0 ? 0 : left / length;
          middle = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          break;
        }
        left -= length;
      }
      return { from: place(from), to: place(to), middle: place(middle), path: path.map(place) };
    },
    handles: () => {
      const shown = new Map<'move' | 'rotate' | 'bin', Place>();
      for (const [kind, at] of surface.placement.handlePlaces.places) shown.set(kind, place(at));
      for (const [kind, at] of surface.selecting.propHandlePlaces) shown.set(kind, place(at));
      const bin = surface.wiring.binPlace;
      if (bin) shown.set('bin', place(bin));
      return shown;
    },
    emphasis: (subject) =>
      'part' in subject ? surface.partView(subject.part)?.currentEmphasis : surface.wireView(subject.wire)?.currentEmphasis,
    get wireLabel() {
      return surface.selecting.wireLabel;
    },
    get wireLabelBox() {
      const box = surface.selecting.wireLabelBox;
      return box && { centre: place(box.at), width: box.w * camera.scale, height: box.h * camera.scale };
    },
  };
};

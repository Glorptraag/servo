// One input path for mouse, touch and pen: pointer events on the canvas element (brief Section 10). Task 3.1 owns
// the view gestures: drag on empty canvas to pan, pinch and two-finger drag to zoom and pan, the wheel to zoom.
// There is no long-press and no double-tap. Later tasks claim pointers first through `handlers` (placing, wiring,
// selecting); a pointer nobody claims is the view's.
import type { Vec2 } from '@servo/schema';
import type { Hit } from '../scene/hit.ts';

/** A pointer a handler has taken: it gets that pointer's moves until it lifts or is cancelled. */
export interface PointerClaim {
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(): void;
}

/** Offered each new pointer, in order, with where it landed; returns a claim to take it. */
export type PointerHandler = (event: PointerEvent, screen: Vec2, hit: Hit | null) => PointerClaim | null;

/** What the view gestures do to the canvas. Moving the view also wakes the grid. */
export interface ViewGestures {
  hitTest(screen: Vec2): Hit | null;
  zoom(): number;
  panBy(dx: number, dy: number): void;
  zoomAbout(screen: Vec2, zoom: number): void;
  /** Screen pixels a touch travels before it becomes a drag. */
  dragThreshold(): number;
}

/** A drag starts after this many pixels at drag sensitivity 1 (D44: below 1 a touch must travel further). */
export const DRAG_THRESHOLD_PX = 8;
/** Wheel zoom per pixel of scroll, and faster for a trackpad pinch, which the browser sends as a ctrl-wheel. */
const WHEEL_ZOOM_PER_PX = 0.0015;
const PINCH_WHEEL_ZOOM_PER_PX = 0.01;
const LINE_PX = 16;

interface ViewPointer {
  x: number;
  y: number;
  readonly startX: number;
  readonly startY: number;
  readonly onEmpty: boolean;
  panning: boolean;
}

interface Pinch {
  readonly ids: readonly [number, number];
  readonly startDistance: number;
  readonly startZoom: number;
  mid: Vec2;
}

const midpoint = (a: ViewPointer, b: ViewPointer): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const spread = (a: ViewPointer, b: ViewPointer): number => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));

export class InputRouter {
  /** Later tasks push their handlers here; the first to claim a pointer owns it. */
  readonly handlers: PointerHandler[] = [];
  private readonly element: HTMLElement;
  private readonly gestures: ViewGestures;
  private readonly claims = new Map<number, PointerClaim>();
  private readonly pointers = new Map<number, ViewPointer>();
  private pinch: Pinch | undefined;
  private readonly listeners: readonly [string, EventListener, AddEventListenerOptions?][];

  constructor(element: HTMLElement, gestures: ViewGestures) {
    this.element = element;
    this.gestures = gestures;
    this.listeners = [
      ['pointerdown', (event) => this.down(event as PointerEvent)],
      ['pointermove', (event) => this.move(event as PointerEvent)],
      ['pointerup', (event) => this.up(event as PointerEvent, false)],
      ['pointercancel', (event) => this.up(event as PointerEvent, true)],
      ['lostpointercapture', (event) => this.up(event as PointerEvent, true)],
      ['wheel', (event) => this.wheel(event as WheelEvent), { passive: false }],
      ['contextmenu', (event) => event.preventDefault()],
    ];
    for (const [type, listener, options] of this.listeners) element.addEventListener(type, listener, options);
  }

  /** Whether a view gesture (pan or pinch) is under way. */
  get busy(): boolean {
    return this.pointers.size > 0;
  }

  destroy(): void {
    for (const [type, listener, options] of this.listeners) this.element.removeEventListener(type, listener, options);
    for (const claim of this.claims.values()) claim.cancel();
    this.claims.clear();
    this.pointers.clear();
    this.pinch = undefined;
  }

  private screenOf(event: MouseEvent): Vec2 {
    const box = this.element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private down(event: PointerEvent): void {
    if (event.button !== 0) return;
    const screen = this.screenOf(event);
    const hit = this.gestures.hitTest(screen);
    for (const handler of this.handlers) {
      const claim = handler(event, screen, hit);
      if (claim) {
        this.claims.set(event.pointerId, claim);
        this.capture(event.pointerId);
        return;
      }
    }
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: screen.x, y: screen.y, startX: screen.x, startY: screen.y, onEmpty: hit === null, panning: false });
    this.capture(event.pointerId);
    if (this.pointers.size === 2 && !this.pinch) this.startPinch();
  }

  private move(event: PointerEvent): void {
    const claim = this.claims.get(event.pointerId);
    if (claim) {
      claim.move(event);
      return;
    }
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const screen = this.screenOf(event);
    const dx = screen.x - pointer.x;
    const dy = screen.y - pointer.y;
    pointer.x = screen.x;
    pointer.y = screen.y;
    if (this.pinch) {
      if (this.pinch.ids.includes(event.pointerId)) this.stepPinch();
      return;
    }
    if (!pointer.onEmpty) return;
    if (!pointer.panning) {
      if (Math.hypot(screen.x - pointer.startX, screen.y - pointer.startY) < this.gestures.dragThreshold()) return;
      pointer.panning = true;
      // The whole way from the press, so the canvas stays under the finger.
      this.gestures.panBy(screen.x - pointer.startX, screen.y - pointer.startY);
    } else {
      this.gestures.panBy(dx, dy);
    }
  }

  private up(event: PointerEvent, cancelled: boolean): void {
    const claim = this.claims.get(event.pointerId);
    if (claim) {
      this.claims.delete(event.pointerId);
      if (cancelled) claim.cancel();
      else claim.up(event);
      return;
    }
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.pinch?.ids.includes(event.pointerId)) {
      this.pinch = undefined;
      // A finger still down carries on panning, from where it is.
      for (const [id, pointer] of this.pointers) {
        this.pointers.set(id, { ...pointer, startX: pointer.x, startY: pointer.y, onEmpty: true, panning: true });
      }
      if (this.pointers.size >= 2) this.startPinch();
    }
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? this.element.clientHeight : 1;
    const delta = event.deltaY * scale;
    if (delta === 0) return;
    const rate = event.ctrlKey ? PINCH_WHEEL_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX;
    const factor = Math.min(2, Math.max(0.5, Math.exp(-delta * rate)));
    this.gestures.zoomAbout(this.screenOf(event), this.gestures.zoom() * factor);
  }

  private startPinch(): void {
    const [first, second] = [...this.pointers.entries()];
    if (!first || !second) return;
    this.pinch = {
      ids: [first[0], second[0]],
      startDistance: spread(first[1], second[1]),
      startZoom: this.gestures.zoom(),
      mid: midpoint(first[1], second[1]),
    };
  }

  private stepPinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const a = this.pointers.get(pinch.ids[0]);
    const b = this.pointers.get(pinch.ids[1]);
    if (!a || !b) return;
    const mid = midpoint(a, b);
    // Two-finger drag pans with the midpoint; the spread zooms about it.
    this.gestures.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
    pinch.mid = mid;
    this.gestures.zoomAbout(mid, pinch.startZoom * (spread(a, b) / pinch.startDistance));
  }

  private capture(pointerId: number): void {
    try {
      this.element.setPointerCapture(pointerId);
    } catch {
      // A synthetic or already-ended pointer cannot be captured; its events still arrive on the canvas.
    }
  }
}

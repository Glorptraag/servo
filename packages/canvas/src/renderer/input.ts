// One input path for mouse, touch and pen: pointer events on the canvas element (brief Section 10). Task 3.1 owns
// the view gestures: drag on empty canvas to pan, pinch and two-finger drag to zoom and pan, the wheel to zoom.
// There is no long-press and no double-tap. Later tasks claim pointers first through `handlers` (placing, wiring,
// selecting); a pointer nobody claims is the view's, and one that lifts without moving the view is offered to `taps`.
// Two fingers always move the view, wherever they land: a second finger never goes to the handlers.
import type { Vec2 } from '@servo/schema';
import type { Hit } from '../scene/hit.ts';

/** A pointer a handler has taken: it gets that pointer's moves until it lifts or is cancelled. */
export interface PointerClaim {
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  cancel(): void;
  /**
   * Whether a second finger may take this pointer back for a pinch (a part pressed but not yet dragged). The claim is
   * cancelled first. Without it, the claim keeps its pointer and a second finger is ignored.
   */
  yieldsToPinch?(): boolean;
}

/** Offered each new pointer, in order, with where it landed; returns a claim to take it. */
export type PointerHandler = (event: PointerEvent, screen: Vec2, hit: Hit | null) => PointerClaim | null;

/** Offered a pointer nobody claimed that lifts without panning or pinching: a tap or a click on the canvas. */
export type TapHandler = (event: PointerEvent, screen: Vec2) => void;

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
  /** It took part in a pinch, so lifting it is not a tap. */
  pinched?: boolean;
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
  /** Later tasks push their tap handlers here; each is told of every tap on the canvas that nobody claimed. */
  readonly taps: TapHandler[] = [];
  private readonly element: HTMLElement;
  private readonly gestures: ViewGestures;
  private readonly claims = new Map<number, PointerClaim>();
  /** Where each claimed pointer is now, so a claim that yields hands the pinch a true starting point. */
  private readonly claimedAt = new Map<number, Vec2>();
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

  /** Whether a finger or the mouse button is down on the canvas: a view gesture or a claimed drag is under way. */
  get busy(): boolean {
    return this.pointers.size > 0 || this.claims.size > 0;
  }

  destroy(): void {
    for (const [type, listener, options] of this.listeners) this.element.removeEventListener(type, listener, options);
    for (const claim of this.claims.values()) claim.cancel();
    this.claims.clear();
    this.claimedAt.clear();
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
    if (this.claims.size > 0 || this.pointers.size > 0) {
      // A second finger moves the view, wherever it lands. A claim that allows it gives its pointer back for the
      // pinch; one that does not (a part already being dragged) keeps the gesture, and the new finger is ignored.
      this.yieldClaims();
      if (this.claims.size > 0) return;
      event.preventDefault();
      this.pointers.set(event.pointerId, { x: screen.x, y: screen.y, startX: screen.x, startY: screen.y, onEmpty: true, panning: false });
      this.capture(event.pointerId);
      if (this.pointers.size >= 2 && !this.pinch) this.startPinch();
      return;
    }
    const hit = this.gestures.hitTest(screen);
    for (const handler of this.handlers) {
      const claim = handler(event, screen, hit);
      if (claim) {
        this.claims.set(event.pointerId, claim);
        this.claimedAt.set(event.pointerId, screen);
        this.capture(event.pointerId);
        return;
      }
    }
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: screen.x, y: screen.y, startX: screen.x, startY: screen.y, onEmpty: hit === null, panning: false });
    this.capture(event.pointerId);
  }

  /** Cancels every claim that yields to a pinch and makes its pointer the view's, from where it is now. */
  private yieldClaims(): void {
    for (const [id, claim] of [...this.claims]) {
      if (!claim.yieldsToPinch?.()) continue;
      this.claims.delete(id);
      const at = this.claimedAt.get(id) ?? { x: 0, y: 0 };
      this.claimedAt.delete(id);
      claim.cancel();
      this.pointers.set(id, { x: at.x, y: at.y, startX: at.x, startY: at.y, onEmpty: true, panning: true });
    }
  }

  private move(event: PointerEvent): void {
    const claim = this.claims.get(event.pointerId);
    if (claim) {
      this.claimedAt.set(event.pointerId, this.screenOf(event));
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
      this.claimedAt.delete(event.pointerId);
      if (cancelled) claim.cancel();
      else claim.up(event);
      return;
    }
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.pointers.delete(event.pointerId);
    if (this.pinch?.ids.includes(event.pointerId)) {
      this.pinch = undefined;
      // A finger still down carries on panning, from where it is.
      for (const [id, other] of this.pointers) {
        this.pointers.set(id, { ...other, startX: other.x, startY: other.y, onEmpty: true, panning: true });
      }
      if (this.pointers.size >= 2) this.startPinch();
      return;
    }
    if (!cancelled && !pointer.panning && !pointer.pinched && this.pointers.size === 0) {
      const screen = this.screenOf(event);
      for (const tap of this.taps) tap(event, screen);
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
    first[1].pinched = true;
    second[1].pinched = true;
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

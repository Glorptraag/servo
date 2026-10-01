// Placing, moving, turning and removing parts by touch and by pointer (brief Section 10, task 3.2). Dragging and
// tap-then-tap are equals, and every gesture ends in one EditCommand through the handle's `apply`, the layer the list
// view uses too (ground rule 8), so the same steps give byte-identical blueprints on every path. There is no long-press
// and no double-tap, and two fingers always move the view. What the child sees on top is what a tap reaches (brief
// Section 9). See docs/placement.md.
import { normalizeDegrees } from '@servo/schema';
import type { AssetKey, Blueprint, Catalogue, PartRecord, PartTypeId, PlacedPartId, Prop, Vec2 } from '@servo/schema';
import type { CanvasPrefs, EditCommand, EditResult, PlacementEvent, PropTemplate } from '../interface.ts';
import type { ArtState } from '../renderer/art.ts';
import { DRAG_THRESHOLD_PX } from '../renderer/input.ts';
import type { PointerClaim } from '../renderer/input.ts';
import { paletteFor } from '../renderer/style.ts';
import type { Palette } from '../renderer/style.ts';
import type { CanvasSurface } from '../renderer/surface.ts';
import type { DrawContext } from '../renderer/views.ts';
import { arenaToCanvas } from '../scene/arena.ts';
import { distance, partToCanvas, unionRect } from '../scene/geometry.ts';
import type { PartPose, Rect } from '../scene/geometry.ts';
import type { Hit } from '../scene/hit.ts';
import { buildScene } from '../scene/scene.ts';
import type { Scene, ScenePart } from '../scene/scene.ts';
import { PORT_MM } from '../scene/units.ts';
import { roundPoint } from './free-spot.ts';
import { layOut, readHolding, subtreeOf, takeOff } from './holding.ts';
import type { Holding } from './holding.ts';
import { heldLine, removalLine } from './notices.ts';
import { layOutCallout, layOutHandles } from './overlays.ts';
import type { Circle, HandleKind } from './overlays.ts';
import { canvasToArena, onProp, propOutline, propSpot } from './props.ts';
import { movedPartSpot, moveTargets, nearestTarget, newPartSpot, placeTargets } from './rules.ts';
import type { SnapTarget } from './rules.ts';
import { CALLOUT_GAP_PX, Callout, HANDLE_GAP_PX, HANDLE_PX, Handles, PartGhost, PropGhost, TargetRings } from './views.ts';

/** Forgiveness: a part snaps to a free mount point or shaft within this many screen pixels (brief Section 10). */
export const SNAP_RADIUS_PX = 48;
/** A tap on the rotate handle turns a part a quarter turn clockwise, and a drag turns it in quarter turns, as the list view does. */
export const QUARTER_TURN = 90;
/** A part that lands away from where it was let go slides there over this long (UI motion, brief Section 11). */
export const SLIDE_MS = 160;
/** Drag sensitivity is held at or above this, as the view's pan threshold holds it. */
const MIN_SENSITIVITY = 0.05;
/**
 * How far a socket reaches from its centre: a hexagon's corner reaches furthest (scene/scene.ts). The handles keep
 * clear of it, and so does a wire's bin (task 3.3).
 */
export const SOCKET_REACH_MM = (PORT_MM / 2) * (2 / Math.sqrt(3));

export interface PlacementHost {
  readonly surface: CanvasSurface;
  readonly catalogue: Catalogue;
  readonly readOnly: boolean;
  prefs(): CanvasPrefs;
  drawContext(): DrawContext;
  art(key: AssetKey): ArtState;
  /** Fires the handle's `placement` event. */
  placed(event: PlacementEvent): void;
}

/** A part from the tray or a prop from the arena strip, on its way in: carried by a finger, or waiting for a tap. */
type Incoming =
  | { readonly kind: 'part'; readonly part: PartTypeId; readonly record: PartRecord; targets: readonly SnapTarget[]; build: Blueprint }
  | { readonly kind: 'prop'; readonly prop: PropTemplate };

/** A placed part waiting for the tap that says where it goes (the Move handle): tap-then-tap for a move. */
interface Relocating {
  readonly id: PlacedPartId;
  readonly targets: readonly SnapTarget[];
  /** The shaft it rides on: tapped there, it stays. */
  readonly home: SnapTarget | undefined;
}

/** The line on show, and the area it speaks about. */
interface Notice {
  readonly kind: 'removal' | 'held';
  readonly line: string;
  readonly over: Rect;
}

/** What a pressed pointer does: a tap until it travels the drag threshold, then a drag. Wiring (task 3.3) shares it. */
export interface Gesture {
  tap(event: PointerEvent): void;
  start?(event: PointerEvent): void;
  drag?(event: PointerEvent): void;
  drop?(event: PointerEvent): void;
  /** Takes back what the drag showed, changing nothing. */
  abandon?(): void;
}

/** A pointer the canvas claimed: a tap or a drag, with no long-press and no timing in it. */
export class Press implements PointerClaim {
  dragging = false;
  done = false;
  readonly build: Blueprint | undefined;
  private readonly start: Vec2;
  private readonly threshold: () => number;
  private readonly gesture: Gesture;

  constructor(event: PointerEvent, build: Blueprint | undefined, threshold: () => number, gesture: Gesture) {
    this.start = { x: event.clientX, y: event.clientY };
    this.build = build;
    this.threshold = threshold;
    this.gesture = gesture;
  }

  /** A press not yet dragging gives its pointer to a pinch: two fingers always move the view. */
  yieldsToPinch(): boolean {
    return !this.dragging && !this.done;
  }

  move(event: PointerEvent): void {
    if (this.done) return;
    if (!this.dragging) {
      if (Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) < this.threshold()) return;
      this.dragging = true;
      this.gesture.start?.(event);
    }
    this.gesture.drag?.(event);
  }

  up(event: PointerEvent): void {
    if (this.done) return;
    this.done = true;
    if (this.dragging) this.gesture.drop?.(event);
    else this.gesture.tap(event);
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    if (this.dragging) this.gesture.abandon?.();
  }
}

/** A placed part being moved or turned, with everything it holds. */
interface Carry {
  readonly id: PlacedPartId;
  readonly part: Blueprint['parts'][number];
  readonly record: PartRecord;
  /** The build with the part taken off whatever held it (D34): its own subtree is what moves. */
  readonly holding: Holding;
  readonly group: readonly PlacedPartId[];
  /** The mounts or linkages that held it: hidden while it is carried, as they come off. */
  readonly letGo: ReadonlySet<string>;
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const contains = (box: DOMRect, x: number, y: number): boolean =>
  box.width > 0 && box.height > 0 && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/** Where a part's port sits on the canvas when the part sits at `pose`. */
const portAt = (record: PartRecord, port: string, pose: PartPose): Vec2 => {
  const spec = record.ports.find((candidate) => candidate.id === port);
  return spec && spec.type === 'mechanical' ? partToCanvas(pose, spec.at) : { x: pose.x, y: pose.y };
};

/** The shortest way between two turns, `k` of the way along. */
const turnBetween = (from: number, to: number, k: number): number => from + ((((to - from + 540) % 360) + 360) % 360 - 180) * k;

export class PlacementController {
  private readonly host: PlacementHost;
  private readonly surface: CanvasSurface;
  private readonly rings = new TargetRings();
  private readonly handles = new Handles();
  private readonly callout = new Callout();
  /** The build and scene at the last redraw, and the ones before them: what an edit changed. */
  private seen: { readonly build: Blueprint | undefined; readonly scene: Scene } | undefined;
  private prior: { readonly build: Blueprint | undefined; readonly scene: Scene } | undefined;
  private incoming: Incoming | undefined;
  private ghost: PartGhost | PropGhost | undefined;
  /** The pointer carrying `incoming` in from the tray, while it is dragged. */
  private carrying: number | undefined;
  private press: Press | undefined;
  private selected: PlacedPartId | undefined;
  private relocating: Relocating | undefined;
  private said: Notice | undefined;
  private removeTargets: readonly HTMLElement[] = [];
  private slideFrame: number | undefined;
  private readonly windowListeners: readonly [string, EventListener][];

  constructor(host: PlacementHost) {
    this.host = host;
    this.surface = host.surface;
    const { canvas, input, overlays } = this.surface;
    overlays.addChild(this.rings.graphics, this.handles.graphics, this.callout.container);
    input.handlers.unshift((event, screen, hit) => this.pressed(event, screen, hit));
    input.taps.push((event) => this.tapped(event));
    this.surface.on('edit', ({ blueprint }) => this.edited(blueprint));
    // The handles and the line keep their screen size, so they are laid out again as the zoom changes.
    this.surface.on('zoom', () => this.drawHandles());
    // Focusable without joining the tab order, so a click on a part lets the Delete key remove it. The list view is
    // the keyboard's way round the build (task 3.6).
    if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = -1;
    canvas.addEventListener('keydown', this.keyed);
    this.windowListeners = [
      ['pointermove', (event) => this.carried(event as PointerEvent, false)],
      ['pointerup', (event) => this.carried(event as PointerEvent, true)],
      ['pointercancel', (event) => this.dropped(event as PointerEvent, true)],
    ];
  }

  /** The part whose handles show. Task 3.4 joins this to the handle's selection. */
  get selectedPart(): PlacedPartId | undefined {
    return this.selected;
  }

  /** Where each handle beside the selected part sits now, canvas mm, with their radius. */
  get handlePlaces(): { readonly places: ReadonlyMap<HandleKind, Vec2>; readonly radius: number } {
    return { places: this.handles.shown, radius: this.handles.size };
  }

  /** Whether a part or prop from the tray or the arena strip is on its way in. */
  get placing(): boolean {
    return this.incoming !== undefined;
  }

  /** The part the Move handle is moving, waiting for the tap that says where it goes. */
  get moving(): PlacedPartId | undefined {
    return this.relocating?.id;
  }

  /** The one plain line the canvas shows (D35, removals, held parts), for the list view to read out (task 3.6). */
  get notice(): string | undefined {
    return this.callout.line;
  }

  /** Whether the line lies over a canvas point: drawn above everything, it takes a press first (wiring, task 3.3). */
  noticeCovers(world: Vec2): boolean {
    return this.callout.covers(world);
  }

  /** Shows the handles beside a part, or none: the tap on a part does this, and task 3.4's `select` will. */
  selectPart(id: PlacedPartId | undefined): void {
    this.select(id !== undefined && this.surface.scene.partById.has(id) ? id : undefined);
  }

  // ---------------------------------------------------------------------------------------------------------
  // The handle's members (task 3.2)

  begin(part: PartTypeId, pointer?: PointerEvent): void {
    this.endIncoming(false);
    this.hideNotice();
    const build = this.surface.blueprint;
    const record = this.host.catalogue.parts.get(part);
    if (!build || !record || !this.editable()) {
      this.host.placed({ kind: 'part', part, placed: false });
      return;
    }
    this.select(undefined);
    this.incoming = { kind: 'part', part, record, targets: placeTargets(build, this.host.catalogue, part), build };
    const ghost = this.ghostOf(build, part);
    if (ghost) this.ghost = new PartGhost(ghost, this.surface.overlays, this.surface.layers, this.host.art(record.identity.art), this.host.drawContext());
    this.enter(pointer);
  }

  beginProp(prop: PropTemplate, pointer?: PointerEvent): void {
    this.endIncoming(false);
    this.hideNotice();
    const shaped = (prop.shape === 'box' || prop.shape === 'cylinder') && typeof prop.size?.x === 'number' && typeof prop.size.y === 'number';
    if (!this.surface.blueprint || !this.surface.arena || !shaped || !this.editable()) {
      this.host.placed({ kind: 'prop', placed: false });
      return;
    }
    this.select(undefined);
    this.incoming = { kind: 'prop', prop };
    this.ghost = new PropGhost(this.surface.overlays, this.surface.layers);
    this.enter(pointer);
  }

  cancel(): void {
    this.endIncoming(false);
  }

  setRemoveTargets(elements: readonly HTMLElement[]): void {
    this.removeTargets = [...elements];
  }

  // ---------------------------------------------------------------------------------------------------------
  // Hooks the surface calls

  /**
   * After every redraw of the build: puts the rings and handles back on top of the sockets the redraw re-layered,
   * drops a gesture the build changed under, and lays the handles out again.
   */
  refresh(): void {
    this.raise();
    const build = this.surface.blueprint;
    const previous = this.seen;
    this.seen = { build, scene: this.surface.scene };
    const changed = previous !== undefined && previous.build !== build;
    if (changed) {
      this.prior = previous;
      this.hideNotice();
    }
    if (this.press && !this.press.done && this.press.build !== build) {
      this.press.cancel();
      this.press = undefined;
    }
    this.stopSlide();
    const incoming = this.incoming;
    if (incoming?.kind === 'part' && build && incoming.build !== build) {
      incoming.targets = placeTargets(build, this.host.catalogue, incoming.part);
      incoming.build = build;
    }
    if (incoming?.kind === 'part' && this.carrying === undefined) this.rings.draw(incoming.targets, undefined, this.palette);
    if (changed && this.relocating) this.endRelocation();
    if (this.selected !== undefined && !this.surface.scene.partById.has(this.selected)) this.selected = undefined;
    this.drawHandles();
  }

  /** Run mode locks the build: whatever was on its way in or under a finger is let go, and the handles go. */
  modeChanged(): void {
    if (this.surface.mode !== 'run') return;
    this.endIncoming(false);
    this.press?.cancel();
    this.press = undefined;
    this.select(undefined);
    this.hideNotice();
  }

  /**
   * After an edit by any path: a removal says what went with the part and what it left loose, in one plain line
   * (brief Section 10, D35), above where it was and clear of every socket and handle.
   */
  private edited(after: Blueprint): void {
    const before = this.prior?.build;
    const scene = this.prior?.scene;
    if (!before || !scene || after !== this.surface.blueprint) return;
    const line = removalLine(before, after, this.host.catalogue);
    if (!line) return;
    let over: Rect | undefined;
    for (const part of before.parts) {
      if (!after.parts.some((other) => other.id === part.id)) over = unionRect(over, scene.partById.get(part.id)?.bounds);
    }
    if (over) this.showNotice('removal', line, over);
  }

  destroy(): void {
    this.stopCarrying();
    this.stopSlide();
    this.press?.cancel();
    this.surface.canvas.removeEventListener('keydown', this.keyed);
    this.ghost?.destroy();
    this.rings.graphics.destroy();
    this.handles.graphics.destroy();
    this.callout.container.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Pointers on the canvas

  /**
   * What a press lands on, top first as the child sees it (brief Section 9): the line, then the handles, then a
   * socket, a wire or a part, then the child's props on the floor. The handles are laid out clear of every socket;
   * a socket still wins, so a tap on one never reaches a handle.
   */
  private pressed(event: PointerEvent, screen: Vec2, hit: Hit | null): PointerClaim | null {
    if (!this.editable() || this.carrying !== undefined) return null;
    this.stopSlide();
    const world = this.surface.camera.screenToWorld(screen);
    if (this.callout.covers(world)) return this.claim(event, { tap: () => this.hideNotice() });
    const handle = hit?.kind === 'port' ? undefined : this.handles.hit(world);
    if (handle && this.selected !== undefined) return this.claim(event, this.handleGesture(handle, this.selected, event));
    if (hit?.kind === 'part') return this.claim(event, this.moveGesture(hit.part.id, event));
    // While a part waits for its tap, a tap on a socket or a wire is where it goes.
    if (hit && (this.incoming || this.relocating)) return this.claim(event, { tap: (up) => this.tapped(up) });
    const prop = hit ? undefined : this.propAt(world);
    if (prop) return this.claim(event, this.propGesture(prop, event));
    return null;
  }

  private claim(event: PointerEvent, gesture: Gesture): Press {
    this.press = new Press(event, this.surface.blueprint, () => DRAG_THRESHOLD_PX / this.sensitivity, gesture);
    return this.press;
  }

  /**
   * A tap on the canvas: where a waiting part goes (from the tray, or by the Move handle), or a part to show the
   * handles of, or nothing to clear them. A tap on a held part says why it has no rotate handle.
   */
  private tapped(event: PointerEvent, part?: PlacedPartId): void {
    if (!this.editable()) return;
    this.hideNotice();
    if (this.incoming && this.carrying === undefined) {
      this.land(this.worldOf(event), 'tap');
      return;
    }
    if (this.relocating) {
      // A tap on the part itself leaves it where it is; anywhere else is where it goes.
      if (part === this.relocating.id) this.endRelocation();
      else this.landRelocation(this.worldOf(event));
      return;
    }
    this.select(part);
    if (part === undefined) return;
    this.surface.canvas.focus({ preventScroll: true });
    const scenePart = this.surface.scene.partById.get(part);
    if (scenePart && scenePart.held !== 'root') this.showNotice('held', heldLine(scenePart.held), scenePart.bounds);
  }

  private readonly keyed = (event: KeyboardEvent): void => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (this.selected === undefined || !this.editable()) return;
    event.preventDefault();
    this.commit({ kind: 'remove-part', partId: this.selected });
  };

  // ---------------------------------------------------------------------------------------------------------
  // In from the tray or the arena strip

  /**
   * Starts carrying the incoming part or prop with `pointer`, or, with none, waits for a tap (tap-then-tap). A pointer
   * with no button down (a click, a lifted finger) is not carrying anything, so it waits for the tap too.
   */
  private enter(pointer: PointerEvent | undefined): void {
    if (pointer && pointer.buttons !== 0) {
      this.carrying = pointer.pointerId;
      for (const [type, listener] of this.windowListeners) window.addEventListener(type, listener, true);
      this.follow(pointer);
    } else if (this.incoming?.kind === 'part') {
      // Shows where the part can go.
      this.rings.draw(this.incoming.targets, undefined, this.palette);
    }
    this.surface.requestFrame();
  }

  private carried(event: PointerEvent, lifted: boolean): void {
    if (event.pointerId !== this.carrying) return;
    if (lifted) this.dropped(event, false);
    else this.follow(event);
  }

  /** The incoming part or prop under the finger, snapped where it would snap; hidden off the canvas. */
  private follow(event: PointerEvent): void {
    const incoming = this.incoming;
    if (!incoming) return;
    if (!this.overCanvas(event) || this.overRemove(event)) {
      this.ghost?.hide();
      if (incoming.kind === 'part') this.rings.draw(incoming.targets, undefined, this.palette);
    } else {
      const world = this.worldOf(event);
      if (incoming.kind === 'part' && this.ghost instanceof PartGhost) {
        const free: PartPose = { x: world.x, y: world.y, rotation: 0, mirrored: false };
        const target = this.snap(incoming.targets, incoming.record, free);
        this.ghost.show(target ? target.pose : free, false);
        this.rings.draw(incoming.targets, target, this.palette);
      } else if (incoming.kind === 'prop' && this.ghost instanceof PropGhost && this.surface.arena) {
        const { matrix } = this.surface.arena;
        const at = canvasToArena(matrix, world);
        const outline = propOutline(incoming.prop, { x: at.x, y: at.y, heading: 0 }).map((point) => arenaToCanvas(matrix, point));
        this.ghost.show(outline, this.palette, false);
      }
      this.surface.wakeGrid();
    }
    this.surface.requestFrame();
  }

  private dropped(event: PointerEvent, cancelled: boolean): void {
    if (event.pointerId !== this.carrying) return;
    this.stopCarrying();
    if (cancelled || this.overRemove(event)) this.endIncoming(false);
    else this.land(this.worldOf(event, true), 'drag');
  }

  /**
   * Lands the incoming part or prop at a canvas point. A dragged part snaps when its mount or hub comes within reach of
   * a free mount point or shaft; a tap snaps when it lands within reach of one. Otherwise the part goes to the nearest
   * free spot, sliding there when that is not where it was let go.
   */
  private land(world: Vec2, how: 'drag' | 'tap'): void {
    const incoming = this.incoming;
    const build = this.surface.blueprint;
    if (!incoming || !build) return;
    if (incoming.kind === 'prop') {
      const arena = this.surface.arena;
      const at = arena && propSpot(build, this.host.catalogue, incoming.prop, canvasToArena(arena.matrix, world));
      this.endIncoming(at !== undefined && this.commit({ kind: 'place-prop', prop: incoming.prop, at }).ok);
      return;
    }
    const free: PartPose = { x: world.x, y: world.y, rotation: 0, mirrored: false };
    const target = how === 'drag' ? this.snap(incoming.targets, incoming.record, free) : this.snapTap(incoming.targets, world);
    if (target) {
      this.endIncoming(this.commit({ kind: 'place-part', part: incoming.part, attach: { port: target.port, onto: target.onto } }).ok);
      return;
    }
    const position = newPartSpot(build, this.host.catalogue, incoming.record, 0, world);
    const before = new Set(build.parts.map((part) => part.id));
    const placed = this.commit({ kind: 'place-part', part: incoming.part, position }).ok;
    this.endIncoming(placed);
    const id = this.surface.blueprint?.parts.find((part) => !before.has(part.id))?.id;
    if (placed && id !== undefined) this.slide(new Map([[id, { ...roundPoint(world), rotation: 0, mirrored: false }]]));
  }

  private endIncoming(placed: boolean): void {
    const incoming = this.incoming;
    if (!incoming) return;
    this.incoming = undefined;
    this.stopCarrying();
    this.ghost?.destroy();
    this.ghost = undefined;
    this.rings.clear();
    this.surface.requestFrame();
    this.host.placed(incoming.kind === 'part' ? { kind: 'part', part: incoming.part, placed } : { kind: 'prop', placed });
  }

  private stopCarrying(): void {
    if (this.carrying === undefined) return;
    this.carrying = undefined;
    for (const [type, listener] of this.windowListeners) window.removeEventListener(type, listener, true);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Moving, turning and removing a placed part

  /** Drag a part to move it (D34): it comes off its mount or shaft, re-snaps near a free mount point, or lands free. */
  private moveGesture(id: PlacedPartId, start: PointerEvent): Gesture {
    let carry: Carry | undefined;
    let grab: Vec2 = { x: 0, y: 0 };
    let free: PartPose | undefined;
    let target: SnapTarget | undefined;
    let targets: readonly SnapTarget[] = [];
    let home: SnapTarget | undefined;
    let removing = false;
    return {
      tap: (event) => this.tapped(event, id),
      start: () => {
        carry = this.carry(id);
        if (!carry) return;
        const at = this.worldOf(start);
        grab = { x: at.x - carry.part.position.x, y: at.y - carry.part.position.y };
        home = this.homeOf(id);
        targets = [...moveTargets(this.surface.blueprint as Blueprint, this.host.catalogue, id), ...(home ? [home] : [])];
        this.select(undefined);
        this.hideNotice();
      },
      drag: (event) => {
        if (!carry) return;
        const world = this.worldOf(event);
        free = { x: world.x - grab.x, y: world.y - grab.y, rotation: carry.part.rotation, mirrored: false };
        removing = this.overRemove(event);
        target = removing ? undefined : this.snap(targets, carry.record, free);
        this.show(carry, layOut(carry.holding, id, target ? target.pose : free), removing);
        this.rings.draw(targets, target, this.palette);
        this.surface.wakeGrid();
      },
      drop: (event) => {
        this.press = undefined;
        this.rings.clear();
        const build = this.surface.blueprint;
        if (!carry || !free || !build) {
          this.restore();
        } else if (removing || this.overRemove(event)) {
          this.commit({ kind: 'remove-part', partId: id });
        } else if (target && target === home) {
          // Back on the shaft it came off: nothing changes.
          this.restore();
        } else if (target) {
          // Re-snaps onto a mount point (D34); its own mount point changes nothing.
          this.commit({ kind: 'mount', partId: id, port: target.port, onto: target.onto });
          if (this.surface.blueprint === build) this.restore();
        } else {
          const position = movedPartSpot(build, this.host.catalogue, id, { x: free.x, y: free.y });
          const from = layOut(carry.holding, id, { ...free, ...roundPoint(free) });
          this.commit({ kind: 'move-part', partId: id, position });
          if (this.surface.blueprint === build) this.restore();
          else this.slide(from);
        }
      },
      abandon: () => this.restore(),
    };
  }

  private handleGesture(kind: HandleKind, id: PlacedPartId, start: PointerEvent): Gesture {
    if (kind === 'rotate') return this.turnGesture(id, start);
    if (kind === 'bin') {
      // D35: what the part held stays, loose, and the line says so.
      return {
        tap: () => {
          this.commit({ kind: 'remove-part', partId: id });
        },
      };
    }
    // The Move handle: tap it, then tap where the part goes. Tapped again, it lets the part be.
    return {
      tap: () => {
        if (this.relocating?.id === id) this.endRelocation();
        else this.startRelocation(id);
      },
    };
  }

  /**
   * The rotate handle, shown on a free part only (a mount or a shaft sets a held part's turn). A tap turns the part a
   * quarter turn clockwise; a drag turns it round its origin in quarter turns, as the list view does.
   */
  private turnGesture(id: PlacedPartId, start: PointerEvent): Gesture {
    let carry: Carry | undefined;
    let from = 0;
    let rotation: number | undefined;
    return {
      tap: () => {
        const part = this.surface.blueprint?.parts.find((candidate) => candidate.id === id);
        if (part) this.commit({ kind: 'rotate-part', partId: id, rotation: normalizeDegrees(part.rotation + QUARTER_TURN) });
      },
      start: () => {
        carry = this.carry(id);
        if (carry) from = this.angleAround(carry, start);
      },
      drag: (event) => {
        if (!carry) return;
        const turned = ((((this.angleAround(carry, event) - from + 540) % 360) + 360) % 360) - 180;
        rotation = normalizeDegrees(carry.part.rotation + Math.round(turned / QUARTER_TURN) * QUARTER_TURN);
        const { x, y } = carry.part.position;
        this.show(carry, layOut(carry.holding, id, { x, y, rotation, mirrored: false }), false);
        this.surface.wakeGrid();
      },
      drop: () => {
        this.press = undefined;
        if (!carry || rotation === undefined || rotation === carry.part.rotation) return this.restore();
        if (!this.commit({ kind: 'rotate-part', partId: id, rotation }).ok) this.restore();
      },
      abandon: () => this.restore(),
    };
  }

  /** The Move handle was tapped: show where the part can re-snap (D34), and wait for the tap that says where it goes. */
  private startRelocation(id: PlacedPartId): void {
    const build = this.surface.blueprint;
    if (!build) return;
    const home = this.homeOf(id);
    this.relocating = { id, targets: [...moveTargets(build, this.host.catalogue, id), ...(home ? [home] : [])], home };
    this.rings.draw(this.relocating.targets, undefined, this.palette);
    this.drawHandles();
  }

  /**
   * The tap after the Move handle, with the same rules as a drag (D34): within reach of a free mount point the part
   * re-snaps there; on the shaft it rides on, it stays; anywhere else it comes off and goes to the free spot there,
   * with everything it holds and every wire it has.
   */
  private landRelocation(world: Vec2): void {
    const relocating = this.relocating;
    const build = this.surface.blueprint;
    this.endRelocation();
    if (!relocating || !build) return;
    const { id } = relocating;
    const target = this.snapTap(relocating.targets, world);
    if (target && target === relocating.home) return;
    const holding = readHolding(takeOff(build, this.host.catalogue, id), this.host.catalogue);
    const from = new Map<PlacedPartId, PartPose>();
    for (const part of subtreeOf(holding, id)) {
      const pose = this.surface.scene.partById.get(part)?.pose;
      if (pose) from.set(part, pose);
    }
    if (target) this.commit({ kind: 'mount', partId: id, port: target.port, onto: target.onto });
    else this.commit({ kind: 'move-part', partId: id, position: movedPartSpot(build, this.host.catalogue, id, world) });
    if (this.surface.blueprint !== build) this.slide(from);
  }

  private endRelocation(): void {
    if (!this.relocating) return;
    this.relocating = undefined;
    this.rings.clear();
    this.drawHandles();
  }

  /** The part, taken off whatever holds it, with everything it holds. */
  private carry(id: PlacedPartId): Carry | undefined {
    const build = this.surface.blueprint;
    const part = build?.parts.find((candidate) => candidate.id === id);
    const record = part && this.host.catalogue.parts.get(part.part);
    if (!build || !part || !record) return undefined;
    const loose = takeOff(build, this.host.catalogue, id);
    const kept = new Set(loose.wires.map((wire) => wire.id));
    const holding = readHolding(loose, this.host.catalogue);
    return {
      id,
      part,
      record,
      holding,
      group: subtreeOf(holding, id),
      letGo: new Set(build.wires.filter((wire) => !kept.has(wire.id)).map((wire) => wire.id)),
    };
  }

  /** The shaft a carried part rides on: brought back there, it stays on it. */
  private homeOf(id: PlacedPartId): SnapTarget | undefined {
    const scenePart = this.surface.scene.partById.get(id);
    if (scenePart?.held !== 'carried') return undefined;
    const linkage = this.surface.scene.linkages.find(
      (wire) => wire.kind === 'drive' && wire.to.ref.part === id && wire.from.ref.part === scenePart.parent,
    );
    if (!linkage) return undefined;
    return { kind: 'shaft', port: linkage.to.ref.port, onto: linkage.from.ref, at: linkage.from.at, pose: scenePart.pose };
  }

  /** The angle from a part's origin to the pointer, degrees clockwise on the canvas. */
  private angleAround(carry: Carry, event: PointerEvent): number {
    const world = this.worldOf(event);
    return (Math.atan2(world.y - carry.part.position.y, world.x - carry.part.position.x) * 180) / Math.PI;
  }

  // ---------------------------------------------------------------------------------------------------------
  // The child's props in the arena (D36)

  private propAt(world: Vec2): Prop | undefined {
    const build = this.surface.blueprint;
    const arena = this.surface.arena;
    if (!build || !arena) return undefined;
    const point = canvasToArena(arena.matrix, world);
    return [...build.arena.props].reverse().find((prop) => onProp(prop, point));
  }

  /** Drag one of the child's props to move it on the floor, or onto the arena strip to remove it. */
  private propGesture(prop: Prop, start: PointerEvent): Gesture {
    let ghost: PropGhost | undefined;
    let at: Vec2 = { x: prop.at.x, y: prop.at.y };
    let grab: Vec2 = { x: 0, y: 0 };
    const arenaPoint = (event: PointerEvent): Vec2 | undefined => {
      const arena = this.surface.arena;
      return arena && canvasToArena(arena.matrix, this.worldOf(event));
    };
    const finish = (): void => {
      ghost?.destroy();
      ghost = undefined;
      this.surface.requestFrame();
    };
    return {
      tap: (event) => this.tapped(event),
      start: () => {
        const point = arenaPoint(start);
        if (point) grab = { x: point.x - prop.at.x, y: point.y - prop.at.y };
        ghost = new PropGhost(this.surface.overlays, this.surface.layers);
      },
      drag: (event) => {
        const point = arenaPoint(event);
        const arena = this.surface.arena;
        if (!point || !arena || !ghost) return;
        at = { x: point.x - grab.x, y: point.y - grab.y };
        const outline = propOutline(prop, { ...at, heading: prop.at.heading }).map((corner) => arenaToCanvas(arena.matrix, corner));
        ghost.show(outline, this.palette, this.overRemove(event));
        this.surface.requestFrame();
      },
      drop: (event) => {
        this.press = undefined;
        finish();
        const build = this.surface.blueprint;
        if (!build) return;
        if (this.overRemove(event)) {
          this.commit({ kind: 'remove-prop', propId: prop.id });
          return;
        }
        const spot = propSpot(build, this.host.catalogue, prop, at, prop.id, prop.at.heading);
        if (spot && (spot.x !== prop.at.x || spot.y !== prop.at.y)) this.commit({ kind: 'move-prop', propId: prop.id, at: spot });
      },
      abandon: finish,
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Drawing

  /** Draws parts at the given poses, with their wires following their ports; hidden over a remove target. */
  private show(carry: Carry | undefined, poses: ReadonlyMap<PlacedPartId, PartPose>, hidden: boolean): void {
    const palette = this.palette;
    for (const [id, pose] of poses) {
      const view = this.surface.partView(id);
      if (!view) continue;
      view.setPose(pose);
      view.node.visible = !hidden;
    }
    for (const wire of [...this.surface.scene.wires, ...this.surface.scene.linkages]) {
      const from = poses.get(wire.from.ref.part);
      const to = poses.get(wire.to.ref.part);
      const view = this.surface.wireView(wire.id);
      if ((!from && !to) || !view) continue;
      view.draw(wire, palette, from ? partToCanvas(from, wire.from.local) : wire.from.at, to ? partToCanvas(to, wire.to.local) : wire.to.at);
      view.graphics.visible = !hidden && !carry?.letGo.has(wire.id);
    }
    this.surface.requestFrame();
  }

  /** Puts every part and wire back where the scene has them. */
  private restore(): void {
    if (!this.relocating) this.rings.clear();
    const palette = this.palette;
    for (const part of this.surface.scene.parts) {
      const view = this.surface.partView(part.id);
      if (!view) continue;
      view.setPose(part.pose);
      view.node.visible = true;
    }
    for (const wire of [...this.surface.scene.wires, ...this.surface.scene.linkages]) {
      const view = this.surface.wireView(wire.id);
      if (!view) continue;
      view.draw(wire, palette);
      view.graphics.visible = true;
    }
    this.drawHandles();
    this.surface.requestFrame();
  }

  /**
   * Brief Section 10: a part lands on a free spot within the forgiveness radius at once (it snaps there), and one let
   * go further away, in the void, slides to the nearest free spot.
   */
  private slide(from: ReadonlyMap<PlacedPartId, PartPose>): void {
    this.stopSlide();
    const scene = this.surface.scene;
    const to = new Map<PlacedPartId, PartPose>();
    let far = false;
    for (const [id, pose] of from) {
      const end = scene.partById.get(id)?.pose;
      if (!end) continue;
      to.set(id, end);
      if (distance(pose, end) > this.snapRadius) far = true;
    }
    if (!far || reducedMotion()) return;
    const started = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - started) / SLIDE_MS));
      const k = 1 - (1 - t) * (1 - t);
      if (t >= 1) {
        this.slideFrame = undefined;
        this.restore();
        return;
      }
      const poses = new Map<PlacedPartId, PartPose>();
      for (const [id, end] of to) {
        const begin = from.get(id) as PartPose;
        poses.set(id, {
          x: begin.x + (end.x - begin.x) * k,
          y: begin.y + (end.y - begin.y) * k,
          rotation: turnBetween(begin.rotation, end.rotation, k),
          mirrored: end.mirrored,
        });
      }
      this.show(undefined, poses, false);
      this.slideFrame = requestAnimationFrame(step);
    };
    this.show(undefined, from, false);
    this.slideFrame = requestAnimationFrame(step);
  }

  private stopSlide(): void {
    if (this.slideFrame === undefined) return;
    cancelAnimationFrame(this.slideFrame);
    this.slideFrame = undefined;
    this.restore();
  }

  /** Every socket a tap can reach, drawn above the parts, as far as each reaches. */
  private sockets(): Circle[] {
    return this.surface.scene.parts.flatMap((part) =>
      part.ports.filter((port) => port.layer === 'ports').map((port) => ({ x: port.at.x, y: port.at.y, r: SOCKET_REACH_MM })),
    );
  }

  /**
   * The handles beside the selected part (D44), 44 px on screen at every zoom: move and bin, with rotate between them
   * on a free part. They draw on top, so they are laid out clear of every socket and inside the view where they fit.
   */
  private drawHandles(): void {
    const part = this.selected !== undefined && this.editable() ? this.surface.scene.partById.get(this.selected) : undefined;
    const scale = this.surface.camera.scale;
    const radius = HANDLE_PX / 2 / scale;
    const kinds: HandleKind[] = part?.held === 'root' ? ['move', 'rotate', 'bin'] : ['move', 'bin'];
    const places = part
      ? layOutHandles({
          kinds,
          part: part.bounds,
          sockets: this.sockets(),
          radius,
          gap: HANDLE_GAP_PX / scale,
          view: this.surface.camera.visible(),
          leftHanded: this.host.prefs().leftHanded,
        })
      : new Map<HandleKind, Vec2>();
    this.handles.draw(places, radius, this.palette, this.relocating ? 'move' : undefined);
    this.placeNotice();
    this.surface.requestFrame();
  }

  private select(id: PlacedPartId | undefined): void {
    if (this.selected === id) return;
    this.selected = id;
    if (this.said?.kind === 'held') this.hideNotice();
    if (this.relocating && this.relocating.id !== id) this.endRelocation();
    this.drawHandles();
  }

  private showNotice(kind: Notice['kind'], line: string, over: Rect): void {
    this.said = { kind, line, over };
    this.placeNotice();
  }

  /** Lays the line out at the current zoom: 15 px type, clear of every socket and handle, inside the view. */
  private placeNotice(): void {
    const said = this.said;
    if (!said) return;
    const scale = this.surface.camera.scale;
    const size = this.callout.measure(said.line, this.host.drawContext(), scale);
    const handles = [...this.handles.shown.values()].map((at) => ({ x: at.x, y: at.y, r: this.handles.size }));
    const at = layOutCallout(size, said.over, [...this.sockets(), ...handles], this.surface.camera.visible(), CALLOUT_GAP_PX / scale);
    this.callout.place(at, size, this.palette, scale);
    this.surface.requestFrame();
  }

  private hideNotice(): void {
    if (!this.said && this.callout.line === undefined) return;
    this.said = undefined;
    this.callout.hide();
    this.surface.requestFrame();
  }

  /**
   * Puts the rings and handles last in the ports-and-handles layer, over the sockets each redraw re-layers, and the
   * line last in the hints layer, above everything (brief Section 9).
   */
  private raise(): void {
    const layers = this.surface.layers;
    if (!layers) return;
    for (const graphics of [this.rings.graphics, this.handles.graphics]) {
      graphics.parentRenderLayer?.detach(graphics);
      layers.ports.attach(graphics);
    }
    this.callout.container.parentRenderLayer?.detach(this.callout.container);
    layers.hints.attach(this.callout.container);
  }

  /** A part of type `part` alone, as the scene would draw it: the ghost under the finger. */
  private ghostOf(build: Blueprint, part: PartTypeId): ScenePart | undefined {
    const alone: Blueprint = { ...build, parts: [{ id: 'incoming', part, position: { x: 0, y: 0 }, rotation: 0, settings: {} }], wires: [] };
    return buildScene(alone, this.host.catalogue).parts[0];
  }

  // ---------------------------------------------------------------------------------------------------------
  // Small helpers

  private commit(command: EditCommand): EditResult {
    return this.surface.apply(command);
  }

  private editable(): boolean {
    return !this.host.readOnly && this.surface.mode === 'build' && this.surface.blueprint !== undefined;
  }

  private get sensitivity(): number {
    return Math.max(this.host.prefs().dragSensitivity, MIN_SENSITIVITY);
  }

  private get palette(): Palette {
    return paletteFor(this.host.prefs());
  }

  /** The forgiveness radius in canvas mm at the current zoom: 48 px, more for lower drag sensitivity (D44). */
  private get snapRadius(): number {
    return SNAP_RADIUS_PX / this.sensitivity / this.surface.camera.scale;
  }

  /** The target the part's mount or hub reaches, as the part sits at `pose`. */
  private snap(targets: readonly SnapTarget[], record: PartRecord, pose: PartPose): SnapTarget | undefined {
    return nearestTarget(targets, (target) => portAt(record, target.port, pose), this.snapRadius);
  }

  /** The target a tap lands on. */
  private snapTap(targets: readonly SnapTarget[], world: Vec2): SnapTarget | undefined {
    return nearestTarget(targets, () => world, this.snapRadius);
  }

  private overCanvas(event: PointerEvent): boolean {
    return contains(this.surface.canvas.getBoundingClientRect(), event.clientX, event.clientY);
  }

  private overRemove(event: PointerEvent): boolean {
    return this.removeTargets.some((element) => element.isConnected && contains(element.getBoundingClientRect(), event.clientX, event.clientY));
  }

  /** The canvas point under a pointer; held inside the canvas when `inside`, so a drop off its edge lands on it. */
  private worldOf(event: PointerEvent, inside = false): Vec2 {
    const box = this.surface.canvas.getBoundingClientRect();
    let x = event.clientX - box.left;
    let y = event.clientY - box.top;
    if (inside) {
      x = Math.min(Math.max(x, 0), box.width);
      y = Math.min(Math.max(y, 0), box.height);
    }
    return this.surface.camera.screenToWorld({ x, y });
  }
}

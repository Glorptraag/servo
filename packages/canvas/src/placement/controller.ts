// Placing, moving, turning and removing parts by touch and by pointer (brief Section 10, task 3.2). Dragging and
// tap-then-tap are equals, and every gesture ends in one EditCommand through the handle's `apply`, the layer the list
// view uses too (ground rule 8), so the same steps give byte-identical blueprints on every path. There is no long-press
// and no double-tap, and two fingers always move the view. See docs/placement.md.
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
import { roundPoint } from './free-spot.ts';
import { layOut, leftLoose, readHolding, subtreeOf, takeOff } from './holding.ts';
import type { Holding } from './holding.ts';
import { canvasToArena, onProp, propOutline, propSpot } from './props.ts';
import { movedPartSpot, moveTargets, nearestTarget, newPartSpot, placeTargets } from './rules.ts';
import type { SnapTarget } from './rules.ts';
import { Callout, Handles, PartGhost, PropGhost, TargetRings } from './views.ts';

/** Forgiveness: a part snaps to a free mount point or shaft within this many screen pixels (brief Section 10). */
export const SNAP_RADIUS_PX = 48;
/** A tap on the rotate handle turns a part a quarter turn clockwise, as the list view's turn does. */
export const QUARTER_TURN = 90;
/** Dragging the rotate handle turns a part in child-sized steps (brief Section 10: angles in 15° steps). */
export const TURN_STEP = 15;
/** A part that lands away from where it was let go slides there over this long (UI motion, brief Section 11). */
export const SLIDE_MS = 160;
/** Drag sensitivity is held at or above this, as the view's pan threshold holds it. */
const MIN_SENSITIVITY = 0.05;

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

/** What a pressed pointer does: a tap until it travels the drag threshold, then a drag. */
interface Gesture {
  tap(event: PointerEvent): void;
  start?(event: PointerEvent): void;
  drag?(event: PointerEvent): void;
  drop?(event: PointerEvent): void;
  /** Takes back what the drag showed, changing nothing. */
  abandon?(): void;
}

/** A pointer the canvas claimed: a tap or a drag, with no long-press and no timing in it. */
class Press implements PointerClaim {
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

/**
 * D35's one plain line: the real names of the parts a removal left loose, each once, as the spec card lists needs
 * ("Needs: power (red) and a signal (yellow)"). A callout ends without a full stop (brief Section 12).
 */
export const looseLine = (names: readonly string[]): string => {
  const distinct = [...new Set(names)];
  const last = distinct.pop() ?? '';
  return `Loose now: ${distinct.length > 0 ? `${distinct.join(', ')} and ${last}` : last}`;
};

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
  private removeTargets: readonly HTMLElement[] = [];
  private slideFrame: number | undefined;
  private attached = false;
  private readonly windowListeners: readonly [string, EventListener][];

  constructor(host: PlacementHost) {
    this.host = host;
    this.surface = host.surface;
    const { canvas, input, overlays } = this.surface;
    overlays.addChild(this.rings.graphics, this.handles.graphics, this.callout.container);
    input.handlers.unshift((event, screen, hit) => this.pressed(event, screen, hit));
    input.taps.push((event) => this.tapped(event));
    this.surface.on('edit', ({ blueprint }) => this.edited(blueprint));
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

  /** The part whose rotate and bin handles show. Task 3.4 joins this to the handle's selection. */
  get selectedPart(): PlacedPartId | undefined {
    return this.selected;
  }

  /** Whether a part or prop from the tray or the arena strip is on its way in. */
  get placing(): boolean {
    return this.incoming !== undefined;
  }

  /** The line the canvas shows after a removal left parts loose (D35), for the list view to read out (task 3.6). */
  get notice(): string | undefined {
    return this.callout.line;
  }

  // ---------------------------------------------------------------------------------------------------------
  // The handle's members (task 3.2)

  begin(part: PartTypeId, pointer?: PointerEvent): void {
    this.endIncoming(false);
    this.hideCallout();
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
    this.hideCallout();
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

  /** After every redraw of the build: drops a gesture the build changed under, and redraws targets and handles. */
  refresh(): void {
    this.attach();
    const build = this.surface.blueprint;
    const previous = this.seen;
    this.seen = { build, scene: this.surface.scene };
    if (previous && previous.build !== build) {
      this.prior = previous;
      this.callout.hide();
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
    this.callout.hide();
  }

  /** After an edit by any path: when it left parts loose (D35), the canvas says which in one plain line. */
  private edited(after: Blueprint): void {
    const before = this.prior?.build;
    const scene = this.prior?.scene;
    if (!before || !scene || after !== this.surface.blueprint) return;
    const loose = leftLoose(before, after, this.host.catalogue);
    if (loose.length === 0) return;
    let over: Rect | undefined;
    for (const part of before.parts) {
      if (!after.parts.some((other) => other.id === part.id)) over = unionRect(over, scene.partById.get(part.id)?.bounds);
    }
    const names = loose.map((id) => {
      const type = after.parts.find((part) => part.id === id)?.part ?? '';
      return this.host.catalogue.parts.get(type)?.identity.name ?? type;
    });
    if (!over) return;
    this.callout.show(looseLine(names), over, this.host.drawContext());
    this.surface.requestFrame();
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

  private pressed(event: PointerEvent, screen: Vec2, hit: Hit | null): PointerClaim | null {
    if (!this.editable() || this.carrying !== undefined) return null;
    this.stopSlide();
    const world = this.surface.camera.screenToWorld(screen);
    const handle = this.selected !== undefined ? this.handles.hit(world) : undefined;
    if (handle && this.selected !== undefined) {
      return this.claim(event, handle === 'rotate' ? this.turnGesture(this.selected, event) : this.binGesture(this.selected));
    }
    if (hit?.kind === 'part') return this.claim(event, this.moveGesture(hit.part.id, event));
    // While a part waits for its tap, a tap on a socket or a wire is where it goes.
    if (hit && this.incoming) return this.claim(event, { tap: (up) => this.tapped(up) });
    const prop = hit ? undefined : this.propAt(world);
    if (prop) return this.claim(event, this.propGesture(prop, event));
    return null;
  }

  private claim(event: PointerEvent, gesture: Gesture): Press {
    this.press = new Press(event, this.surface.blueprint, () => DRAG_THRESHOLD_PX / this.sensitivity, gesture);
    return this.press;
  }

  /** A tap on the canvas: where a waiting part goes, or a part to show the handles of, or nothing to clear them. */
  private tapped(event: PointerEvent, part?: PlacedPartId): void {
    if (!this.editable()) return;
    this.hideCallout();
    if (this.incoming && this.carrying === undefined) {
      this.land(this.worldOf(event), 'tap');
      return;
    }
    this.select(part);
    if (part !== undefined) this.surface.canvas.focus({ preventScroll: true });
  }

  private readonly keyed = (event: KeyboardEvent): void => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (this.selected === undefined || !this.editable()) return;
    event.preventDefault();
    this.commit({ kind: 'remove-part', partId: this.selected });
  };

  // ---------------------------------------------------------------------------------------------------------
  // In from the tray or the arena strip

  /** Starts carrying the incoming part or prop with `pointer`, or, with none, waits for a tap (tap-then-tap). */
  private enter(pointer: PointerEvent | undefined): void {
    if (pointer) {
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
        home = this.homeOf(carry);
        targets = [...moveTargets(this.surface.blueprint as Blueprint, this.host.catalogue, id), ...(home ? [home] : [])];
        this.select(undefined);
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

  /** A tap on the rotate handle turns the part a quarter turn; a drag turns it in 15° steps (D34: it comes off). */
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
        const turned = carry.part.rotation + this.angleAround(carry, event) - from;
        rotation = normalizeDegrees(Math.round(turned / TURN_STEP) * TURN_STEP);
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

  /** A tap on the bin handle removes the part (D35: what it held stays, loose). */
  private binGesture(id: PlacedPartId): Gesture {
    return {
      tap: () => {
        this.commit({ kind: 'remove-part', partId: id });
      },
    };
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

  /** Where a part carried on a shaft came from: dropped back there, it stays on it. */
  private homeOf(carry: Carry): SnapTarget | undefined {
    const scenePart = this.surface.scene.partById.get(carry.id);
    if (scenePart?.held !== 'carried') return undefined;
    const linkage = this.surface.scene.linkages.find((wire) => wire.kind === 'drive' && wire.to.ref.part === carry.id && carry.letGo.has(wire.id));
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
    this.rings.clear();
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

  /** Slides parts from where they were let go to where they landed (brief Section 10: a part slides to the free spot). */
  private slide(from: ReadonlyMap<PlacedPartId, PartPose>): void {
    this.stopSlide();
    const scene = this.surface.scene;
    const to = new Map<PlacedPartId, PartPose>();
    let far = false;
    for (const [id, pose] of from) {
      const end = scene.partById.get(id)?.pose;
      if (!end) continue;
      to.set(id, end);
      if (distance(pose, end) * this.surface.camera.scale > 1) far = true;
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

  private drawHandles(): void {
    const part = this.selected !== undefined && this.editable() ? this.surface.scene.partById.get(this.selected) : undefined;
    this.handles.draw(part, this.host.prefs().leftHanded, this.palette);
    this.surface.requestFrame();
  }

  private select(id: PlacedPartId | undefined): void {
    if (this.selected === id) return;
    this.selected = id;
    this.drawHandles();
  }

  private hideCallout(): void {
    if (this.callout.line === undefined) return;
    this.callout.hide();
    this.surface.requestFrame();
  }

  /** Puts the rings and handles in the ports-and-handles layer, and the callout in the hints layer, once the renderer is up. */
  private attach(): void {
    const layers = this.surface.layers;
    if (this.attached || !layers) return;
    this.attached = true;
    layers.ports.attach(this.rings.graphics, this.handles.graphics);
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

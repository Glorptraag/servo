// Selection and focus states (brief Sections 9 and 10, task 3.4). One selection for the whole canvas: a part, a wire
// or a prop, made by a tap or a click, by the handle's `select` (the app, the list view), and shown the same way
// whichever path made it. A part selection is what opens the spec card: every change fires `select`. In Build mode
// the selected part shows placement's handles and a selected wire wiring's bin; in Run mode and on a read-only canvas
// a tap still selects, to inspect. The hint rungs draw here too, in the hints layer. A selected prop of the child's
// shows a Move handle beside its bin: tap it, then tap where the prop goes, as a drag moves it (task 7.3). The handle's
// `select` brings what it selects into view, and the arrow keys pan the view, the keyboard's way round a big build at
// a high zoom (task 7.3). See docs/selection.md.
import type { ArenaFeatureId, Catalogue, Prop, Vec2 } from '@servo/schema';
import type { CanvasPrefs, DrawnHintStep, EditCommand, SelectEvent, Selection } from '../interface.ts';
import { Press } from '../placement/controller.ts';
import type { Gesture } from '../placement/controller.ts';
import { layOutHandles } from '../placement/overlays.ts';
import type { Circle } from '../placement/overlays.ts';
import type { HandleKind } from '../placement/overlays.ts';
import { canvasToArena, onProp, propOutline, propSpot } from '../placement/props.ts';
import { Callout, HANDLE_GAP_PX, HANDLE_PX, Handles } from '../placement/views.ts';
import { DRAG_THRESHOLD_PX } from '../renderer/input.ts';
import type { PointerClaim } from '../renderer/input.ts';
import { paletteFor } from '../renderer/style.ts';
import type { Palette } from '../renderer/style.ts';
import type { CanvasSurface } from '../renderer/surface.ts';
import type { DrawContext } from '../renderer/views.ts';
import { arenaToCanvas } from '../scene/arena.ts';
import { distanceToSegment, rectOfPoints } from '../scene/geometry.ts';
import type { Rect } from '../scene/geometry.ts';
import type { Hit } from '../scene/hit.ts';
import type { SceneWire } from '../scene/scene.ts';
import { WIRE_HIT_MM } from '../scene/units.ts';
import { drawnSockets } from '../wiring/crowds.ts';
import { allWires, flowLine, focusFor, wireOf } from './focus.ts';
import { placeLabel } from './label.ts';
import { drawsAnything, hintTargets } from './hints.ts';
import type { HintTargets } from './hints.ts';
import { HintMarks, PropRing, SOCKET_REACH_MM, pulseAt } from './views.ts';

const MIN_SENSITIVITY = 0.05;
/** The wire label's pill: a fixed height, and a width in steps of this, on screen at every zoom. */
export const LABEL_HEIGHT_PX = 40;
export const LABEL_STEP_PX = 16;
/** How often a pulsing hint is redrawn. */
export const PULSE_FPS = 20;
/** An arrow key pans the view by this share of the uncovered canvas's shorter side (task 7.3). */
export const ARROW_PAN_SHARE = 0.25;
/** Room kept between a subject brought into view and the uncovered canvas's edge, px (task 7.3). */
export const REVEAL_MARGIN_PX = 48;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface SelectionHost {
  readonly surface: CanvasSurface;
  readonly catalogue: Catalogue;
  readonly readOnly: boolean;
  prefs(): CanvasPrefs;
  drawContext(): DrawContext;
  /** Fires the handle's `select` event. */
  selected(event: SelectEvent): void;
}

/** Which controller says what it shows: placement's handles (a part), wiring's bin (a wire), or a tapped prop. */
export type SelectionSource = 'part' | 'wire' | 'prop';

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const same = (a: Selection | null, b: Selection | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === 'part' && b.kind === 'part') return a.partId === b.partId;
  if (a.kind === 'wire' && b.kind === 'wire') return a.wireId === b.wireId;
  if (a.kind === 'prop' && b.kind === 'prop') return a.propId === b.propId;
  return false;
};

const selectionOf = (source: SelectionSource, id: string): Selection =>
  source === 'part' ? { kind: 'part', partId: id } : source === 'wire' ? { kind: 'wire', wireId: id } : { kind: 'prop', propId: id };

export class SelectionController {
  private readonly host: SelectionHost;
  private readonly surface: CanvasSurface;
  private readonly label = new Callout();
  private readonly marks = new HintMarks();
  private readonly ring = new PropRing();
  /** The selected prop's handles: Move and its bin, on the child's props only. */
  private readonly propBin = new Handles();
  /** The child's prop the Move handle is moving, waiting for the tap that says where it goes. */
  private relocating: ArenaFeatureId | undefined;
  private readonly offZoom: () => void;
  private current: Selection | null = null;
  /** Set while the selection is passed on to placement and wiring, so what they report back is not taken as new. */
  private pushing = false;
  private hint: { readonly step: DrawnHintStep; targets: HintTargets } | undefined;
  private pulse: { readonly started: number; frame: number | undefined; drawn?: number } | undefined;
  /** A pointer is down on the canvas: a selection let go during it clears when it lifts, unless something new was chosen. */
  private pressing = false;
  private letGoOf: Selection | null = null;
  private press: Press | undefined;
  private labelBox: { readonly at: Vec2; readonly w: number; readonly h: number } | undefined;
  /** Whether the prop's ring or bin is drawn, and whether a rung is: what there is to clear. */
  private propShown = false;
  private hintShown = false;
  private destroyed = false;

  constructor(host: SelectionHost) {
    this.host = host;
    this.surface = host.surface;
    const { canvas, input, overlays } = this.surface;
    overlays.addChild(this.ring.graphics, this.propBin.graphics, this.marks.graphics, this.label.container);
    // First in line: it sees every press, and claims one only on the selected prop's bin.
    input.handlers.unshift((event, screen, hit) => this.pressed(event, screen, hit));
    input.taps.push((event, screen) => this.tapped(screen));
    canvas.addEventListener('keydown', this.keyed);
    // Capture, so it runs before the input router's own listener on the canvas; the end runs after it.
    canvas.addEventListener('pointerdown', this.pressBegan, { capture: true });
    canvas.addEventListener('pointerup', this.pressEnded);
    canvas.addEventListener('pointercancel', this.pressEnded);
    canvas.addEventListener('lostpointercapture', this.pressEnded);
    // The label and the bin keep their screen size at every zoom.
    // Only when one is shown: with nothing selected a zoom (a wheel or a pinch, every frame) costs selection nothing.
    this.offZoom = this.surface.on('zoom', () => {
      if (this.current?.kind === 'prop') this.drawProp();
      else if (this.current?.kind === 'wire') this.drawLabel();
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // The handle's members

  get selection(): Selection | null {
    return this.current;
  }

  /**
   * Selects what `next` names, or clears with null, and fires `select` when that changes the selection. A selection
   * naming nothing on the canvas now (a part Undo took away) changes nothing.
   */
  select(next: Selection | null): void {
    if (next !== null && !['part', 'wire', 'prop'].includes((next as { kind?: unknown }).kind as string)) {
      throw new RangeError(`Unknown selection kind '${String((next as { kind?: unknown }).kind)}'.`);
    }
    if (next !== null && !this.exists(next)) return;
    this.choose(next);
    if (next !== null) this.reveal(next);
  }

  /**
   * Draws one hint rung over everything, replacing the one before. Returns false, drawing nothing, when nothing on the
   * canvas matches. Drawn in Build mode; in Run mode it waits, hidden, for Stop.
   */
  showHint(step: DrawnHintStep): boolean {
    if (step.step !== 'pulse-part' && step.step !== 'pulse-port' && step.step !== 'ghost-wire') {
      throw new RangeError(`The canvas draws pulse-part, pulse-port and ghost-wire; '${String((step as { step?: unknown }).step)}' is the app's.`);
    }
    const targets = hintTargets(this.surface.scene, step);
    this.hint = { step, targets };
    this.drawHint();
    return drawsAnything(targets);
  }

  clearHints(): void {
    this.hint = undefined;
    this.drawHint();
  }

  /** The rung drawn now, for the list view's text twin (task 3.6). Undefined when none is drawn, as in Run mode. */
  get shownHint(): DrawnHintStep | undefined {
    return this.hint && drawsAnything(this.hint.targets) && this.surface.mode !== 'run' ? this.hint.step : undefined;
  }

  /** The label on the selected wire: what flows on it. */
  get wireLabel(): string | undefined {
    return this.label.line;
  }

  /** Where the label's pill sits, mm: its centre and size. */
  get wireLabelBox(): { readonly at: Vec2; readonly w: number; readonly h: number } | undefined {
    return this.label.line === undefined ? undefined : this.labelBox;
  }

  /** Where the selected prop's bin sits, mm. */
  get propBinPlace(): Vec2 | undefined {
    return this.propBin.shown.get('bin');
  }

  /** Where the selected prop's handles sit, mm: Move and the bin. */
  get propHandlePlaces(): ReadonlyMap<HandleKind, Vec2> {
    return this.propBin.shown;
  }

  /** The child's prop the Move handle is moving, waiting for the tap that says where it goes. */
  get movingProp(): ArenaFeatureId | undefined {
    return this.relocating;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Hooks the surface calls

  /**
   * Placement, wiring and a tapped prop say what they show: placement's handles beside a part, wiring's bin beside a
   * wire. Something shown is the new selection; the one selected showing nothing any more clears it. Only in Build
   * mode: locked, they show nothing, and the selection stays for inspecting.
   */
  shown(source: SelectionSource, id: string | undefined): void {
    if (this.pushing || !this.editable()) return;
    if (id !== undefined) this.choose(selectionOf(source, id));
    else if (this.current?.kind === source) this.letGo();
  }

  /** After every redraw of the build: a selection the build lost clears, and focus and hints follow the new scene. */
  refresh(): void {
    if (this.relocating !== undefined && !this.childsProp(this.relocating)) this.relocating = undefined;
    if (this.current !== null && !this.exists(this.current)) {
      this.choose(null);
      return;
    }
    if (this.hint) this.hint.targets = hintTargets(this.surface.scene, this.hint.step);
    this.push();
    this.redraw();
  }

  /**
   * Run mode, each painted frame: the selected wire's label and a selected prop's ring go where the Run draws the line
   * and the prop now (task 3.5 moves the robot and its lines, and the props, without a rebuild).
   */
  followRun(): void {
    // Called while a frame is drawn: it moves what that frame shows, and asks for no frame of its own.
    if (this.destroyed || this.current === null) return;
    if (this.current.kind === 'wire') this.drawLabel(false);
    else if (this.current.kind === 'prop') this.drawProp(false);
  }

  /** Run keeps the selection, for the spec card's live readouts; back in Build its handles or bin show again. */
  modeChanged(): void {
    this.press?.cancel();
    this.press = undefined;
    this.relocating = undefined;
    this.push();
    this.redraw();
  }

  destroy(): void {
    this.destroyed = true;
    this.press?.cancel();
    this.stopPulse();
    this.offZoom();
    this.surface.canvas.removeEventListener('keydown', this.keyed);
    this.surface.canvas.removeEventListener('pointerdown', this.pressBegan, { capture: true });
    this.surface.canvas.removeEventListener('pointerup', this.pressEnded);
    this.surface.canvas.removeEventListener('pointercancel', this.pressEnded);
    this.surface.canvas.removeEventListener('lostpointercapture', this.pressEnded);
    this.ring.graphics.destroy();
    this.propBin.graphics.destroy();
    this.marks.graphics.destroy();
    this.label.container.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Choosing

  /**
   * Clears the selection, or while a pointer is down, once it lifts: so a tap that moves the selection from a wire to
   * a part (wiring lets the wire go at the press, placement takes the part at the lift) fires one `select`, as `select`
   * and the list view do.
   */
  private letGo(): void {
    if (!this.pressing) {
      this.choose(null);
      return;
    }
    this.letGoOf = this.current;
  }

  private readonly pressBegan = (): void => {
    this.pressing = true;
  };

  private readonly pressEnded = (): void => {
    this.pressing = false;
    const letGoOf = this.letGoOf;
    this.letGoOf = null;
    if (letGoOf !== null && same(this.current, letGoOf)) this.choose(null);
  };

  private choose(next: Selection | null): void {
    if (same(this.current, next)) return;
    this.current = next;
    if (next?.kind !== 'prop' || next.propId !== this.relocating) this.relocating = undefined;
    this.push();
    this.redraw();
    this.host.selected({ selection: next });
  }

  /** Passes the selection on to placement and wiring, which show the handles or the bin in Build mode. */
  private push(): void {
    if (!this.editable()) return;
    const current = this.current;
    this.pushing = true;
    try {
      this.surface.placement.selectPart(current?.kind === 'part' ? current.partId : undefined);
      this.surface.wiring.showBin(current?.kind === 'wire' ? current.wireId : undefined);
    } finally {
      this.pushing = false;
    }
  }

  private exists(selection: Selection): boolean {
    switch (selection.kind) {
      case 'part':
        return this.surface.scene.partById.has(selection.partId);
      case 'wire':
        return wireOf(this.surface.scene, selection.wireId) !== undefined;
      case 'prop':
        return this.propOf(selection.propId) !== undefined;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Pointers and keys

  /**
   * Sees every press first and claims only a press on the selected prop's handles, or, while its Move handle waits, a
   * press on the build or on a prop, which is where the prop goes. A press on the build (a socket, a wire, a part)
   * lets a selected prop go, as it lets a selected part go; a pan keeps it.
   */
  private pressed(event: PointerEvent, screen: Vec2, hit: Hit | null): PointerClaim | null {
    if (this.current?.kind !== 'prop') return null;
    const world = this.surface.camera.screenToWorld(screen);
    const propId = this.current.propId;
    const handle = this.editable() ? this.propBin.hit(world) : undefined;
    if (handle === 'bin') return this.claim(event, this.binGesture(propId));
    if (handle === 'move') return this.claim(event, { tap: () => this.toggleRelocation(propId) });
    if (this.relocating === propId && (hit !== null || this.propAt(world) !== undefined)) {
      return this.claim(event, { tap: () => this.landRelocation(world) });
    }
    if (hit !== null && this.editable()) this.letGo();
    return null;
  }

  private claim(event: PointerEvent, gesture: Gesture): Press {
    this.press = new Press(event, this.surface.blueprint, () => DRAG_THRESHOLD_PX / this.sensitivity, gesture);
    return this.press;
  }

  /** The Move handle was tapped: the prop waits for the tap that says where it goes. Tapped again, it lets it be. */
  private toggleRelocation(propId: ArenaFeatureId): void {
    this.press = undefined;
    this.relocating = this.relocating === propId ? undefined : propId;
    this.drawProp();
  }

  /**
   * The tap after the Move handle, with a drag's rule (placement's prop drag, D36): the prop's middle goes to the free
   * spot nearest the tap, on the floor. A tap on the prop itself leaves it where it is.
   */
  private landRelocation(world: Vec2): void {
    this.press = undefined;
    const propId = this.relocating;
    this.relocating = undefined;
    this.drawProp();
    const build = this.surface.blueprint;
    const arena = this.surface.arena;
    const prop = build?.arena.props.find((each) => each.id === propId);
    if (!build || !arena || !prop) return;
    const at = canvasToArena(arena.matrix, world);
    if (onProp(prop, at)) return;
    const spot = propSpot(build, this.host.catalogue, prop, at, prop.id, prop.at.heading);
    if (spot && (spot.x !== prop.at.x || spot.y !== prop.at.y)) this.commit({ kind: 'move-prop', propId: prop.id, at: spot });
  }

  /**
   * A tap nobody claimed. In Build mode placement and wiring select by tap what they own, and a tap on one of the
   * child's props comes through placement; what reaches here is empty canvas or a preset's prop, which selects it (to
   * inspect) or lets a selected prop go. Locked (Run mode, read-only), a tap selects what it lands on, to inspect: a
   * socket's part, a wire, a part, and in Build mode a prop. In Run mode props move, so a tap does not reach them.
   */
  private tapped(screen: Vec2): void {
    if (!this.surface.blueprint) return;
    const world = this.surface.camera.screenToWorld(screen);
    if (this.editable() && this.relocating !== undefined) {
      this.landRelocation(world);
      return;
    }
    if (this.editable()) {
      const prop = this.propAt(world);
      if (prop) this.choose({ kind: 'prop', propId: prop.id });
      else if (this.current?.kind === 'prop') this.choose(null);
      return;
    }
    // In Run mode the robot and its lines move: a line is hit where the Run draws it, above the parts, as in Build.
    const runWire = this.surface.mode === 'run' ? this.runWireAt(world) : undefined;
    const hit: Hit | null = runWire ? { kind: 'wire', wire: runWire } : this.surface.hitAt(screen);
    const prop = hit === null && this.surface.mode === 'build' ? this.propAt(world) : undefined;
    const next: Selection | null =
      hit?.kind === 'wire'
        ? { kind: 'wire', wireId: hit.wire.id }
        : hit
          ? { kind: 'part', partId: hit.part.id }
          : prop
            ? { kind: 'prop', propId: prop.id }
            : null;
    this.choose(next);
    if (next) this.surface.canvas.focus({ preventScroll: true });
  }

  /**
   * Delete (and Backspace) removes a selected prop of the child's, as it removes a part or a wire. The arrow keys pan
   * the view, in every mode: the keyboard's way to look at one corner of a big build (task 7.3, R-6.4 CAN-5).
   */
  private readonly keyed = (event: KeyboardEvent): void => {
    const arrow = ARROWS[event.key];
    if (arrow && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const view = this.surface.camera.uncovered();
      const step = Math.min(view.width, view.height) * ARROW_PAN_SHARE;
      // A drag of (dx, dy) moves the plane with the finger, so the view looks the other way.
      this.panView(-arrow[0] * step, -arrow[1] * step);
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (this.current?.kind !== 'prop' || !this.editable() || !this.childsProp(this.current.propId)) return;
    event.preventDefault();
    this.commit({ kind: 'remove-prop', propId: this.current.propId });
  };

  private binGesture(propId: ArenaFeatureId): Gesture {
    return {
      tap: () => {
        this.press = undefined;
        this.commit({ kind: 'remove-prop', propId });
      },
    };
  }

  private commit(command: EditCommand): void {
    this.surface.apply(command);
  }

  /** Moves the plane by (dx, dy) screen pixels, held by the view's limits, as a drag on empty workbench does. */
  private panView(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.surface.camera.panBy(dx, dy, this.surface.limits());
    this.surface.wakeGrid();
    this.surface.requestFrame();
  }

  /**
   * Brings what the handle selected into the uncovered canvas, with a margin, at the zoom it has: the list view's
   * Select, so a keyboard user at a high zoom sees what they chose (task 7.3, R-6.4 CAN-5). Wholly in view along an
   * axis, nothing moves along it; bigger than the view, its middle comes to the middle.
   */
  private reveal(selection: Selection): void {
    const area = this.areaOf(selection);
    if (!area) return;
    const { camera } = this.surface;
    const view = camera.uncovered();
    const a = camera.worldToScreen({ x: area.minX, y: area.minY });
    const b = camera.worldToScreen({ x: area.maxX, y: area.maxY });
    const margin = Math.min(REVEAL_MARGIN_PX, view.width / 4, view.height / 4);
    const along = (low: number, high: number, start: number, size: number): number => {
      if (low >= start && high <= start + size) return 0;
      const from = start + margin;
      const to = start + size - margin;
      if (high - low > to - from) return (from + to) / 2 - (low + high) / 2;
      if (low < from) return from - low;
      if (high > to) return to - high;
      return 0;
    };
    this.panView(along(Math.min(a.x, b.x), Math.max(a.x, b.x), view.x, view.width), along(Math.min(a.y, b.y), Math.max(a.y, b.y), view.y, view.height));
  }

  /** Where a selection lies on the plane: a part's bounds, a wire's drawn path, a prop's outline. */
  private areaOf(selection: Selection): Rect | undefined {
    if (selection.kind === 'part') return this.surface.scene.partById.get(selection.partId)?.bounds;
    if (selection.kind === 'wire') {
      const wire = wireOf(this.surface.scene, selection.wireId);
      return wire && rectOfPoints(this.drawnPath(wire));
    }
    const prop = this.propOf(selection.propId);
    const arena = this.surface.arena;
    return prop && arena ? rectOfPoints(propOutline(prop, prop.at).map((corner) => arenaToCanvas(arena.matrix, corner))) : undefined;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Drawing

  private redraw(): void {
    if (this.destroyed) return;
    const scene = this.surface.scene;
    this.surface.setEmphasis(focusFor(scene, this.current));
    this.drawProp();
    this.drawLabel();
    this.drawHint();
  }

  /** The ring round a selected prop, and in Build mode its bin when it is the child's (the preset's stay). */
  private drawProp(request = true): void {
    const scale = this.surface.camera.scale;
    const radius = HANDLE_PX / 2 / scale;
    const current = this.current;
    const prop = current?.kind === 'prop' ? this.propOf(current.propId) : undefined;
    const arena = this.surface.arena;
    if (!prop || !arena) {
      // Clears only what is drawn: an untouched Graphics costs the renderer nothing.
      if (this.propShown) {
        this.ring.clear();
        this.propBin.draw(new Map(), radius, this.palette);
        this.propShown = false;
      }
      return;
    }
    this.propShown = true;
    // In Run mode a prop the robot pushes is where the Run draws it now.
    const at = (this.surface.mode === 'run' ? this.surface.run.shown?.props.get(prop.id) : undefined) ?? prop.at;
    const corners = propOutline(prop, at).map((corner) => arenaToCanvas(arena.matrix, corner));
    if (prop.shape === 'cylinder') {
      this.ring.draw({ kind: 'circle', at: arenaToCanvas(arena.matrix, at), r: prop.size.x / 2 }, this.palette);
    } else {
      this.ring.draw({ kind: 'outline', corners }, this.palette);
    }
    if (!this.editable() || !this.childsProp(prop.id)) {
      this.propBin.draw(new Map(), radius, this.palette);
      return;
    }
    const places = layOutHandles({
      kinds: ['move', 'bin'],
      part: rectOfPoints(corners) as Rect,
      sockets: this.socketCircles(),
      radius,
      gap: HANDLE_GAP_PX / scale,
      view: this.surface.camera.visible(),
      leftHanded: this.host.prefs().leftHanded,
    });
    this.propBin.draw(places, radius, this.palette, this.relocating === prop.id ? 'move' : undefined);
    if (request) this.surface.requestFrame();
  }

  /**
   * What flows on the selected wire, in one word on the wire itself: a pill over the line at the middle of the path it
   * is drawn along, slid along the line off any socket and the bin, and off other lines where it can (label.ts).
   */
  private drawLabel(request = true): void {
    const current = this.current;
    const wire = current?.kind === 'wire' ? wireOf(this.surface.scene, current.wireId) : undefined;
    if (!wire) {
      if (this.labelBox !== undefined) {
        this.label.hide();
        this.labelBox = undefined;
        if (request) this.surface.requestFrame();
      }
      return;
    }
    const scale = this.surface.camera.scale;
    // The pill's size steps rather than following the type's exact metrics, which differ between devices' fonts: the
    // same word gives the same pill, and so the same place on the line, on every device that draws it.
    const measured = this.label.measure(flowLine(wire.kind), this.host.drawContext(), scale);
    const size = { w: (Math.ceil((measured.w * scale) / LABEL_STEP_PX) * LABEL_STEP_PX) / scale, h: LABEL_HEIGHT_PX / scale };
    const pathOf = (each: SceneWire): readonly Vec2[] => this.drawnPath(each);
    const bin = this.surface.wiring.binPlace;
    const at = placeLabel({
      path: pathOf(wire),
      size,
      avoid: [...this.socketCircles(true), ...(bin ? [{ ...bin, r: HANDLE_PX / 2 / scale }] : [])],
      others: allWires(this.surface.scene)
        .filter((other) => other.id !== wire.id && other.kind !== 'mount')
        .map(pathOf),
      reach: WIRE_HIT_MM / 2,
    });
    this.label.place(at, size, this.palette, scale);
    this.labelBox = { at, ...size };
    if (request) this.surface.requestFrame();
  }

  /** The hint rung, pulsing; still with reduced motion. Hidden in Run mode. */
  private drawHint(): void {
    if (this.destroyed) return;
    const hint = this.hint;
    if (!hint || !drawsAnything(hint.targets) || this.surface.mode === 'run') {
      this.stopPulse();
      if (this.hintShown) {
        this.marks.clear();
        this.hintShown = false;
        this.surface.requestFrame();
      }
      return;
    }
    this.marks.draw(hint.targets, this.palette, this.everySocket());
    this.hintShown = true;
    if (reducedMotion()) {
      this.stopPulse();
      this.marks.graphics.alpha = 1;
      this.surface.requestFrame();
      return;
    }
    if (!this.pulse) this.pulse = { started: performance.now(), frame: undefined };
    this.stepPulse(performance.now());
  }

  /** A pulse changes only how strongly the rung shows, a frame at a time, until the rung goes. */
  private stepPulse(now: number): void {
    const pulse = this.pulse;
    if (!pulse || this.destroyed) return;
    // A slow pulse needs few frames: the canvas redraws at PULSE_FPS, not the display's rate.
    if (pulse.drawn === undefined || now - pulse.drawn >= 1000 / PULSE_FPS) {
      pulse.drawn = now;
      this.marks.graphics.alpha = pulseAt(now - pulse.started);
      this.surface.requestFrame();
    }
    if (pulse.frame === undefined) {
      pulse.frame = requestAnimationFrame((next) => {
        pulse.frame = undefined;
        this.stepPulse(next);
      });
    }
  }

  private stopPulse(): void {
    if (this.pulse?.frame !== undefined) cancelAnimationFrame(this.pulse.frame);
    this.pulse = undefined;
  }

  /**
   * After every rebuild, before wiring and placement raise theirs: the prop's ring in the chassis layer, its bin in the
   * ports layer, the label and the hints in the hints layer.
   */
  layer(): void {
    const layers = this.surface.layers;
    if (!layers) return;
    for (const [object, layer] of [
      [this.ring.graphics, layers.chassis],
      [this.propBin.graphics, layers.ports],
      [this.marks.graphics, layers.hints],
      [this.label.container, layers.hints],
    ] as const) {
      object.parentRenderLayer?.detach(object);
      layer.attach(object);
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Small helpers

  private propOf(id: ArenaFeatureId): Prop | undefined {
    return this.surface.arena?.props.find((prop) => prop.id === id);
  }

  private childsProp(id: ArenaFeatureId): boolean {
    return this.surface.blueprint?.arena.props.some((prop) => prop.id === id) === true;
  }

  /** The topmost prop of the arena's, the preset's or the child's, under a canvas point. */
  private propAt(world: Vec2): Prop | undefined {
    const arena = this.surface.arena;
    if (!arena) return undefined;
    const point = canvasToArena(arena.matrix, world);
    return [...arena.props].reverse().find((prop) => onProp(prop, point));
  }

  /** The drawn sockets, where the build has them, or with `asDrawn` in Run mode where the Run draws them now. */
  private socketCircles(asDrawn = false): Circle[] {
    const run = asDrawn && this.surface.mode === 'run' ? this.surface.run : undefined;
    return drawnSockets(this.surface.scene).map((port) => ({
      ...(run ? run.partPoint(port.ref.part, port.local) : port.at),
      r: SOCKET_REACH_MM,
    }));
  }

  /** A line's path as drawn now: in Run mode where the Run draws it (it moves with the robot), else its view's path. */
  private drawnPath(wire: SceneWire): readonly Vec2[] {
    if (this.surface.mode === 'run') {
      const path = this.surface.run.pathOf(wire.id);
      if (path) return path;
    }
    return this.surface.wireView(wire.id)?.path ?? [wire.from.at, wire.to.at];
  }

  /** The topmost power or signal line drawn at a canvas point in Run mode, where the Run draws it (24 px hit area). */
  private runWireAt(world: Vec2): SceneWire | undefined {
    const wires = this.surface.scene.wires;
    for (let i = wires.length - 1; i >= 0; i--) {
      const wire = wires[i] as SceneWire;
      const path = this.drawnPath(wire);
      if (path.slice(1).some((b, k) => distanceToSegment(world, path[k] as Vec2, b) <= WIRE_HIT_MM / 2)) return wire;
    }
    return undefined;
  }

  /** Every socket the canvas draws, a frame's mount points too: a hint covers none of them. */
  private everySocket(): Circle[] {
    return this.surface.scene.parts.flatMap((part) => part.ports.filter((port) => port.layer !== 'none').map((port) => ({ ...port.at, r: SOCKET_REACH_MM })));
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
}

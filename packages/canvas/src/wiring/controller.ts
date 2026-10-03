// Wiring by touch and by pointer (brief Sections 10 and 13, task 3.3). Touch a socket and drag to another, or tap one
// socket and then the other: the two paths are equals, and each ends in one `connect` through the handle's `apply`,
// the layer the list view uses too (ground rule 8), so every path gives the same bytes. A wire lands within 32 px of a
// socket that takes it, which glows as it comes near; a socket that can never take it pushes the wire away while the
// right colour glows; let go anywhere else, the wire springs back. A crowd of overlapping sockets fans out first, so a
// wire never lands on the wrong part's socket. A wire is removed by dragging it to the tray or by its bin. What the
// child sees on top is what a press reaches, and a socket beats a handle, as for placement (task 3.2). No long-press,
// no double-tap, no text: what is wrong shows at the socket (brief Section 10). See docs/wiring.md.
import type { Blueprint, Catalogue, IssueCode, PortRef, Vec2, WireId } from '@servo/schema';
import type { CanvasPrefs, EditCommand, EditResult } from '../interface.ts';
import { Press, SOCKET_REACH_MM } from '../placement/controller.ts';
import type { Gesture } from '../placement/controller.ts';
import { layOutHandles } from '../placement/overlays.ts';
import type { Circle } from '../placement/overlays.ts';
import { HANDLE_GAP_PX, HANDLE_PX, Handles, REMOVING_ALPHA } from '../placement/views.ts';
import { DRAG_THRESHOLD_PX } from '../renderer/input.ts';
import type { PointerClaim } from '../renderer/input.ts';
import { paletteFor } from '../renderer/style.ts';
import type { Palette } from '../renderer/style.ts';
import type { CanvasSurface } from '../renderer/surface.ts';
import { WireView } from '../renderer/views.ts';
import { distance, distanceToSegment } from '../scene/geometry.ts';
import type { Hit } from '../scene/hit.ts';
import type { ScenePort, SceneWire } from '../scene/scene.ts';
import { PORT_MM, PX_PER_MM, WIRE_HIT_MM, mmOf } from '../scene/units.ts';
import { crowdsOf, drawnSockets, fanFor } from './crowds.ts';
import type { Crowd, CrowdMember, Crowds } from './crowds.ts';
import { FAN_MS, REACH_MS, SETTLE_MS, SPRING_BACK_MS, easeOut, elastic } from './motion.ts';
import { WIRE_REACH_PX, judgeSockets, landingAt, socketsFrom, wireEndAt } from './rules.ts';
import type { Socket, Verdict } from './rules.ts';
import { WireMarks } from './views.ts';
import type { FanMark, Marks, SocketMark } from './views.ts';

/** Drag sensitivity is held at or above this, as placement and the view hold it. */
const MIN_SENSITIVITY = 0.05;

export interface WiringHost {
  readonly surface: CanvasSurface;
  readonly catalogue: Catalogue;
  readonly readOnly: boolean;
  prefs(): CanvasPrefs;
}

/** What wiring shows after a socket refused a wire, until the next touch: the right colour glowing (brief Section 10). */
export interface WiringCue {
  /** The socket that refused it, and the schema's reason. */
  readonly refused: PortRef;
  readonly code: IssueCode;
  /** Every socket that would take the wire, glowing in its colour. */
  readonly glowing: readonly PortRef[];
}

/** A wire on its way from its source socket, with how every socket would take it (`planWire`). */
interface Pending {
  readonly source: ScenePort;
  readonly build: Blueprint;
  readonly verdicts: ReadonlyMap<string, Verdict>;
}

/** A wire under a finger. */
interface Dragged extends Pending {
  end: Vec2;
  target: Socket | undefined;
  pushedBy: Socket | undefined;
  /** It was waiting for its tap before the finger picked it up. */
  readonly waited: boolean;
  /** The crowd it fanned out on its way: let go short of a fanned socket, the wire waits for the tap on one. */
  spread: Fan | undefined;
}

/** A crowd fanned out round a press or a wire end that could not tell its sockets apart. */
interface Fan {
  readonly crowd: Crowd;
  /** Member key → where it sits, fanned out. */
  readonly places: ReadonlyMap<string, Vec2>;
  readonly centre: Vec2;
  /** The furthest a fanned socket sits from the centre, mm. */
  readonly radius: number;
  /** How far it has opened, 0 to 1 (drawing only: presses use where it ends up). */
  open: number;
}

interface Motion {
  readonly started: number;
  readonly duration: number;
  step(t: number): void;
  done?(): void;
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const contains = (box: DOMRect, x: number, y: number): boolean =>
  box.width > 0 && box.height > 0 && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

const refOf = (port: ScenePort): PortRef => ({ part: port.ref.part, port: port.ref.port });

export class WiringController {
  private readonly host: WiringHost;
  private readonly surface: CanvasSurface;
  private readonly marks = new WireMarks();
  /** The tapped wire's bin: the bin handle a selected part has (D44). */
  private readonly bin = new Handles();
  private readonly offZoom: () => void;
  private crowds: Crowds;
  /** The build the state below belongs to: any other build ends it. */
  private seen: Blueprint | undefined;
  private press: Press | undefined;
  private waiting: Pending | undefined;
  private dragging: Dragged | undefined;
  private fan: Fan | undefined;
  private refusal: (WiringCue & { readonly hints: readonly ScenePort[] }) | undefined;
  private selected: WireId | undefined;
  private removeTargets: readonly HTMLElement[] = [];
  /** The wire drawn on its way: under a finger, reaching for a socket, or springing back. */
  private live: { readonly view: WireView; readonly wire: SceneWire; end: Vec2 } | undefined;
  private readonly motions = new Map<string, Motion>();
  private frame: number | undefined;

  constructor(host: WiringHost) {
    this.host = host;
    this.surface = host.surface;
    this.crowds = crowdsOf(this.surface.scene);
    const { canvas, input, overlays } = this.surface;
    overlays.addChild(this.marks.graphics, this.bin.graphics);
    // First in line, ahead of placement: a socket beats a handle, and fanned sockets take presses first.
    input.handlers.unshift((event, screen, hit) => this.pressed(event, screen, hit));
    // The bin keeps its 44 px on screen at every zoom.
    this.offZoom = this.surface.on('zoom', () => this.redraw());
    input.taps.push(() => this.tapped());
    canvas.addEventListener('keydown', this.keyed);
  }

  // ---------------------------------------------------------------------------------------------------------
  // What wiring shows now: for tests, the list view (task 3.6) and selection (task 3.4)

  /** The source of the wire waiting for its tap (tap-then-tap). */
  get waitingFrom(): PortRef | undefined {
    return this.waiting && refOf(this.waiting.source);
  }

  /** The socket the wire under a finger would land on now. */
  get target(): PortRef | undefined {
    return this.dragging?.target && refOf(this.dragging.target.port);
  }

  /** The free end of the wire under a finger, mm. */
  get wireEnd(): Vec2 | undefined {
    return this.dragging?.end;
  }

  /** Where each socket of the fanned-out crowd sits, by port key, mm. */
  get fanned(): ReadonlyMap<string, Vec2> | undefined {
    const fan = this.fan;
    if (!fan) return undefined;
    return new Map(fan.crowd.members.flatMap((member) => member.ports.map((port) => [port.key, fan.places.get(member.key) as Vec2] as const)));
  }

  /** The cue after a refused wire: which socket refused it, why, and which sockets glow. */
  get cue(): WiringCue | undefined {
    if (!this.refusal) return undefined;
    const { refused, code, glowing } = this.refusal;
    return { refused, code, glowing };
  }

  /** Port keys of the sockets glowing now: the right colour, and the socket a wire would land on. */
  get glowing(): readonly string[] {
    const { hints, target } = this.glowState();
    return [...hints.map((port) => port.key), ...(target ? [target.key] : [])].sort();
  }

  /** The wire whose bin shows: the handle's selection when it is a wire, in Build mode (task 3.4). */
  get selectedWire(): WireId | undefined {
    return this.selected;
  }

  /** Shows the bin beside a wire, or none: the handle's `select` does this (task 3.4). A mount has no bin. */
  showBin(id: WireId | undefined): void {
    const scene = this.surface.scene;
    const removable = id !== undefined && this.editable() && [...scene.wires, ...scene.linkages].some((wire) => wire.id === id && wire.kind !== 'mount');
    if (!removable) {
      this.clearSelection();
      return;
    }
    if (this.selected === id) return;
    this.selected = id;
    this.letGo();
    this.redraw();
  }

  /** Where the bin of the tapped wire sits, mm. */
  get binPlace(): Vec2 | undefined {
    return this.selected !== undefined ? this.bin.shown.get('bin') : undefined;
  }

  /** The crowds of overlapping sockets in the build now. */
  get crowded(): Crowds {
    return this.crowds;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Hooks the surface calls

  setRemoveTargets(elements: readonly HTMLElement[]): void {
    this.removeTargets = [...elements];
  }

  /** After every redraw of the build: a new build ends whatever wire was on its way. */
  refresh(): void {
    this.attach();
    this.crowds = crowdsOf(this.surface.scene);
    const build = this.surface.blueprint;
    if (build !== this.seen) {
      this.seen = build;
      // The rebuild drew every wire where the new build has it: a motion of the old one is dropped, not finished.
      this.motions.clear();
      if (this.press && !this.press.done && this.press.build !== build) {
        this.press.cancel();
        this.press = undefined;
      }
      this.dropLive();
      this.dragging = undefined;
      this.waiting = undefined;
      this.fan = undefined;
      this.refusal = undefined;
      if (this.selected !== undefined && !build?.wires.some((wire) => wire.id === this.selected)) this.selected = undefined;
    }
    this.redraw();
  }

  /** Run mode locks the build: whatever wire was on its way goes, and so do the glows and the bin. */
  modeChanged(): void {
    if (this.surface.mode !== 'run') return;
    this.press?.cancel();
    this.press = undefined;
    this.finishMotions();
    this.dropLive();
    this.dragging = undefined;
    this.waiting = undefined;
    this.fan = undefined;
    this.refusal = undefined;
    this.selected = undefined;
    this.redraw();
  }

  destroy(): void {
    this.press?.cancel();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.motions.clear();
    this.surface.canvas.removeEventListener('keydown', this.keyed);
    this.offZoom();
    this.dropLive();
    this.marks.graphics.destroy();
    this.bin.graphics.destroy();
  }

  // ---------------------------------------------------------------------------------------------------------
  // Pointers on the canvas

  /**
   * What the child sees on top is what a press reaches (brief Section 9): the line, then the fanned sockets, the
   * sockets, the tapped wire's bin and the selected part's handles, then wires, parts and drive linkages. A socket
   * beats a handle, as for placement (task 3.2), whose handles and line are laid out clear of every socket.
   */
  private pressed(event: PointerEvent, screen: Vec2, hit: Hit | null): PointerClaim | null {
    if (this.deferring()) return null;
    this.finishMotions();
    if (this.refusal) {
      this.clearCue();
      this.redraw();
    }
    const world = this.surface.camera.screenToWorld(screen);
    const placement = this.surface.placement;
    // The line is drawn above everything: a press on it only takes it away (placement's).
    if (placement.noticeCovers(world)) return null;
    const waiting = this.waiting;
    const fanned = this.fannedAt(world);
    if (fanned) return this.claim(event, waiting ? this.pickGesture(waiting) : this.socketGesture(fanned.ports[0] as ScenePort));
    // Where the fanned sockets came from is no target while they are out: each sits clear of it, out of reach.
    if (this.onFannedHome(world)) return this.claim(event, { tap: () => undefined });
    if (waiting && this.nearSocket(world)) return this.claim(event, this.pickGesture(waiting));
    const under = this.membersUnder(world);
    if (under.length > 1) {
      // The press cannot tell these sockets apart: they fan out round it, and the next press picks one.
      this.clearSelection();
      placement.selectPart(undefined);
      const crowd = this.crowds.crowdOf((under[0] as CrowdMember).key);
      if (crowd) this.openFan(crowd, world);
      return this.claim(event, { tap: () => undefined });
    }
    if (under.length === 1) return this.claim(event, this.socketGesture((under[0] as CrowdMember).ports[0] as ScenePort));
    if (this.selected !== undefined && this.bin.hit(world) === 'bin') return this.claim(event, this.binGesture(this.selected));
    if (waiting && hit !== null) this.letGo();
    this.closeFan();
    // The selected part's handles are placement's.
    if (this.onHandle(world)) {
      this.clearSelection();
      this.redraw();
      return null;
    }
    const wire = hit?.kind === 'wire' ? hit.wire : hit === null ? this.linkageAt(world) : undefined;
    if (wire) return this.claim(event, this.wireGesture(wire, world));
    if (hit?.kind === 'part') this.clearSelection();
    this.redraw();
    return null;
  }

  /** A tap on the canvas nobody claimed (empty workbench): the waiting wire, the fan, the bin and the cue go. */
  private tapped(): void {
    if (this.deferring()) return;
    this.letGo();
    this.clearSelection();
    this.clearCue();
    this.redraw();
  }

  private readonly keyed = (event: KeyboardEvent): void => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (this.selected === undefined || !this.editable()) return;
    event.preventDefault();
    this.commit({ kind: 'disconnect', wireId: this.selected });
  };

  private claim(event: PointerEvent, gesture: Gesture): Press {
    this.press = new Press(event, this.surface.blueprint, () => DRAG_THRESHOLD_PX / this.sensitivity, gesture);
    return this.press;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Drawing a wire: drag, or tap-then-tap

  /** A press on a socket: a tap makes it the source of a wire that waits for the next tap; a drag draws the wire. */
  private socketGesture(port: ScenePort): Gesture {
    return {
      tap: () => {
        if (!this.inFan(port)) this.closeFan();
        this.wait(this.pendingFrom(port));
      },
      start: () => this.startDrag(this.pendingFrom(port), false),
      drag: (event) => this.dragTo(this.worldOf(event)),
      drop: (event) => this.dropAt(this.worldOf(event, true)),
      abandon: () => this.abandonDrag(),
    };
  }

  /** A press near a socket while a wire waits: a tap lands it there, a drag carries it there. */
  private pickGesture(pending: Pending): Gesture {
    return {
      tap: (event) => this.pickAt(pending, this.worldOf(event)),
      start: () => this.startDrag(pending, true),
      drag: (event) => this.dragTo(this.worldOf(event)),
      drop: (event) => this.dropAt(this.worldOf(event, true)),
      abandon: () => this.abandonDrag(),
    };
  }

  private pendingFrom(port: ScenePort): Pending {
    const build = this.surface.blueprint as Blueprint;
    return { source: port, build, verdicts: judgeSockets(build, this.host.catalogue, this.surface.scene, port.ref) };
  }

  /** Tap-then-tap: the wire waits at its source, the sockets that would take it glowing. */
  private wait(pending: Pending): void {
    this.waiting = pending;
    this.surface.placement.selectPart(undefined);
    this.clearSelection();
    this.redraw();
  }

  /** The waiting wire goes, and the fan with it. */
  private letGo(): void {
    this.waiting = undefined;
    this.closeFan();
  }

  private pickAt(pending: Pending, world: Vec2): void {
    this.press = undefined;
    const landing = landingAt(world, this.socketsFor(pending), this.reach);
    switch (landing.kind) {
      case 'land':
        this.waiting = undefined;
        this.land(pending, landing.socket, this.placeOf(pending.source));
        return;
      case 'spread':
        this.spreadFor(landing.socket, world);
        break;
      case 'refuse':
        this.refuse(pending, landing.socket);
        this.reachFor(pending, landing.socket);
        break;
      default:
        this.letGo();
    }
    this.redraw();
  }

  private startDrag(pending: Pending, waited: boolean): void {
    this.waiting = undefined;
    const from = this.placeOf(pending.source);
    this.dragging = { ...pending, end: from, target: undefined, pushedBy: undefined, waited, spread: undefined };
    this.surface.placement.selectPart(undefined);
    this.clearSelection();
    this.showLive(pending.source, from);
  }

  private dragTo(world: Vec2): void {
    const drag = this.dragging;
    if (!drag) return;
    // A crowd this wire fanned out closes again behind it once the wire has gone on past it.
    const opened = drag.spread;
    if (opened && this.fan === opened && distance(world, opened.centre) > opened.radius + this.reach) {
      this.closeFan();
      drag.spread = undefined;
    }
    let sockets = this.socketsFor(drag);
    const here = landingAt(world, sockets, this.reach);
    if (here.kind === 'spread') {
      // The wire cannot see which of a crowd's sockets it is at: the crowd fans out round its end.
      this.spreadFor(here.socket, world);
      drag.spread = this.fan;
      sockets = this.socketsFor(drag);
    }
    const found = wireEndAt(world, sockets, this.reach, this.placeOf(drag.source));
    drag.end = found.end;
    drag.target = found.target;
    drag.pushedBy = found.pushedBy;
    this.showLive(drag.source, found.end);
    this.redraw();
    this.surface.wakeGrid();
  }

  private dropAt(world: Vec2): void {
    const drag = this.dragging;
    if (!drag) return;
    this.dragging = undefined;
    this.press = undefined;
    const landing = landingAt(world, this.socketsFor(drag), this.reach);
    switch (landing.kind) {
      case 'land':
        this.land(drag, landing.socket, drag.end);
        return;
      case 'spread':
        this.spreadFor(landing.socket, world);
        this.springBack(drag.source);
        this.wait(drag);
        return;
      case 'refuse':
        this.refuse(drag, landing.socket);
        this.springBack(drag.source);
        if (drag.waited) this.wait(drag);
        else this.closeFan();
        break;
      default:
        this.springBack(drag.source);
        // Let go among a crowd it fanned out on its way: the wire waits for the tap on one of them.
        if (drag.spread && this.fan === drag.spread) this.wait(drag);
        else this.closeFan();
    }
    this.redraw();
  }

  private abandonDrag(): void {
    const drag = this.dragging;
    if (!drag) return;
    this.dragging = undefined;
    this.springBack(drag.source);
    this.redraw();
  }

  /** Joins the source to the socket by `connect`, and the new wire settles into the socket. */
  private land(pending: Pending, socket: Socket, from: Vec2): void {
    const before = this.surface.blueprint;
    this.dropLive();
    const result = this.commit({ kind: 'connect', from: refOf(pending.source), to: refOf(socket.port) });
    if (result.ok && before) this.settle(before, result.blueprint, socket.port.key, from);
    else this.redraw();
  }

  /** The socket refused the wire: the right colour glows until the next touch (brief Section 10). */
  private refuse(pending: Pending, socket: Socket): void {
    const sockets = this.socketsFor(pending);
    const hints = sockets
      .filter((each) => each.legal)
      .map((each) => each.port)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    this.refusal = {
      refused: refOf(socket.port),
      code: socket.code ?? 'wire.type_mismatch',
      glowing: hints.map(refOf),
      hints,
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Crowded sockets (crowds.ts)

  /** Fans out the crowd of `socket` round `centre`, unless it is already out. */
  private spreadFor(socket: Socket, centre: Vec2): void {
    const crowd = this.crowds.crowdOf(socket.port.key);
    if (crowd && this.fan?.crowd.id !== crowd.id) this.openFan(crowd, centre);
  }

  private openFan(crowd: Crowd, centre: Vec2): void {
    const places = fanFor(this.surface.scene, crowd, centre, this.reach, this.surface.camera.visible());
    const radius = Math.max(0, ...[...places.values()].map((place) => distance(place, centre)));
    const fan: Fan = { crowd, places, centre, radius, open: 0 };
    this.fan = fan;
    this.animate('fan', FAN_MS, (t) => {
      fan.open = easeOut(t);
      this.redraw();
    });
  }

  private closeFan(): void {
    if (!this.fan) return;
    this.motions.delete('fan');
    this.fan = undefined;
  }

  private inFan(port: ScenePort): boolean {
    const member = this.crowds.memberOf(port.key);
    return member !== undefined && this.fan?.places.has(member.key) === true;
  }

  /** Where a socket takes presses and wires now: fanned out, or where the scene draws it. */
  private placeOf(port: ScenePort): Vec2 {
    const member = this.crowds.memberOf(port.key);
    return (member && this.fan?.places.get(member.key)) ?? port.at;
  }

  /** Where a socket is drawn now, part way out while its crowd fans out. */
  private drawnAt(port: ScenePort): Vec2 {
    const fan = this.fan;
    const member = this.crowds.memberOf(port.key);
    const place = member && fan?.places.get(member.key);
    return place && fan ? lerp(port.at, place, fan.open) : port.at;
  }

  /** The fanned-out member whose socket lies under a canvas point. */
  private fannedAt(world: Vec2): CrowdMember | undefined {
    const fan = this.fan;
    if (!fan) return undefined;
    return fan.crowd.members.find((member) => distance(fan.places.get(member.key) as Vec2, world) <= PORT_MM / 2);
  }

  private onFannedHome(world: Vec2): boolean {
    return this.fan?.crowd.members.some((member) => member.ports.some((port) => distance(port.at, world) <= PORT_MM / 2)) === true;
  }

  /** The sockets, mated pairs as one, whose 44 px targets lie under a canvas point. */
  private membersUnder(world: Vec2): CrowdMember[] {
    const found = new Map<string, CrowdMember>();
    for (const part of this.surface.scene.parts) {
      for (const port of part.ports) {
        if (port.layer !== 'ports' || distance(port.at, world) > PORT_MM / 2) continue;
        const member = this.crowds.memberOf(port.key);
        if (member) found.set(member.key, member);
      }
    }
    return [...found.values()];
  }

  /** Whether a press is near enough a socket to be where a waiting wire goes. */
  private nearSocket(world: Vec2): boolean {
    return drawnSockets(this.surface.scene).some((port) => distance(this.placeOf(port), world) <= this.reach);
  }

  /** Every socket a wire from `pending`'s source can meet, where it is now, judged by `planWire`. */
  private socketsFor(pending: Pending): Socket[] {
    return socketsFrom(this.surface.scene, this.crowds, pending.verdicts, pending.source, this.fan?.places);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Removing a wire: drag it to the tray, or tap it and its bin, or the Delete key

  private wireGesture(wire: SceneWire, grabbed: Vec2): Gesture {
    let removing = false;
    const restore = (): void => {
      const view = this.surface.wireView(wire.id);
      if (view) {
        view.draw(wire, this.palette);
        view.graphics.alpha = 1;
      }
      this.surface.requestFrame();
    };
    return {
      tap: () => this.selectWire(wire.id),
      start: () => {
        this.surface.placement.selectPart(undefined);
        this.clearSelection();
      },
      drag: (event) => {
        const view = this.surface.wireView(wire.id);
        if (!view) return;
        removing = this.overRemove(event);
        // The wire comes off its sockets and rides under the finger; over the tray it fades.
        const world = this.worldOf(event, true);
        const dx = world.x - grabbed.x;
        const dy = world.y - grabbed.y;
        view.draw(wire, this.palette, { x: wire.from.at.x + dx, y: wire.from.at.y + dy }, { x: wire.to.at.x + dx, y: wire.to.at.y + dy });
        view.graphics.alpha = removing ? REMOVING_ALPHA : 1;
        this.surface.wakeGrid();
        this.surface.requestFrame();
      },
      drop: (event) => {
        this.press = undefined;
        if (removing || this.overRemove(event)) {
          if (!this.commit({ kind: 'disconnect', wireId: wire.id }).ok) restore();
          return;
        }
        restore();
      },
      abandon: restore,
    };
  }

  private binGesture(id: WireId): Gesture {
    return {
      tap: () => {
        this.commit({ kind: 'disconnect', wireId: id });
      },
    };
  }

  private selectWire(id: WireId): void {
    this.selected = id;
    this.letGo();
    // Selection first: it lets the part go itself, so the change is one `select`.
    this.surface.selectionShown('wire', id);
    this.surface.placement.selectPart(undefined);
    this.surface.canvas.focus({ preventScroll: true });
    this.redraw();
  }

  private clearSelection(): void {
    if (this.selected === undefined) return;
    this.selected = undefined;
    this.bin.draw(new Map(), 0, this.palette);
    this.surface.requestFrame();
    this.surface.selectionShown('wire', undefined);
  }

  /** Whether a press lands on one of the selected part's handles, drawn above the wires and parts. */
  private onHandle(world: Vec2): boolean {
    const { places, radius } = this.surface.placement.handlePlaces;
    return [...places.values()].some((at) => distance(at, world) <= radius);
  }

  /** A drive linkage long enough to see and grab (24 px hit area): one whose wheel does not sit on its shaft. */
  private linkageAt(world: Vec2): SceneWire | undefined {
    const linkages = this.surface.scene.linkages;
    for (let i = linkages.length - 1; i >= 0; i--) {
      const linkage = linkages[i] as SceneWire;
      if (linkage.kind !== 'drive' || distance(linkage.from.at, linkage.to.at) <= PORT_MM) continue;
      if (distanceToSegment(world, linkage.from.at, linkage.to.at) <= WIRE_HIT_MM / 2) return linkage;
    }
    return undefined;
  }

  /**
   * The tapped wire's bin, laid out as a selected part's handles are (D44): beside the wire's middle, on its right for
   * right-handed use and its left otherwise, then further along, clear of every socket and of the wire's own hit area,
   * inside the view where it fits; 44 px on screen at every zoom.
   */
  private drawBin(): void {
    const id = this.selected;
    const wire = id === undefined ? undefined : [...this.surface.scene.wires, ...this.surface.scene.linkages].find((each) => each.id === id);
    const scale = this.surface.camera.scale;
    const radius = HANDLE_PX / 2 / scale;
    if (!wire) {
      this.bin.draw(new Map(), radius, this.palette);
      return;
    }
    const { at: a } = wire.from;
    const { at: b } = wire.to;
    const half = WIRE_HIT_MM / 2;
    const middle = lerp(a, b, 0.5);
    const steps = Math.max(1, Math.ceil(distance(a, b) / half));
    const line: Circle[] = Array.from({ length: steps + 1 }, (_, i) => ({ ...lerp(a, b, i / steps), r: half }));
    const sockets: Circle[] = drawnSockets(this.surface.scene).map((port) => ({ ...port.at, r: SOCKET_REACH_MM }));
    const places = layOutHandles({
      kinds: ['bin'],
      part: { minX: middle.x - half, minY: middle.y - half, maxX: middle.x + half, maxY: middle.y + half },
      sockets: [...sockets, ...line],
      radius,
      gap: HANDLE_GAP_PX / scale,
      view: this.surface.camera.visible(),
      leftHanded: this.host.prefs().leftHanded,
    });
    this.bin.draw(places, radius, this.palette);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Drawing and motion

  /**
   * Shows the wire on its way from `source` (where it sits now) to `end`, in its type's style. It draws in the wires
   * layer whatever its type, so a drive linkage on its way stays above the parts it crosses.
   */
  private showLive(source: ScenePort, end: Vec2): void {
    const layers = this.surface.layers;
    if (!this.live || this.live.wire.from.key !== source.key) {
      this.dropLive();
      const wire: SceneWire = { id: 'live', kind: source.type === 'mechanical' ? 'drive' : source.type, type: source.type, from: source, to: source };
      const view = new WireView(wire, this.surface.overlays);
      if (layers) view.attach(layers.wires);
      this.live = { view, wire, end };
    }
    this.live.end = end;
    this.live.view.draw(this.live.wire, this.palette, this.drawnAt(source), end);
    this.surface.requestFrame();
  }

  private dropLive(): void {
    if (!this.live) return;
    this.motions.delete('live');
    this.live.view.destroy();
    this.live = undefined;
    this.surface.requestFrame();
  }

  /** Lifted away from a socket that takes it, the wire springs softly back to its source and goes. */
  private springBack(source: ScenePort): void {
    const live = this.live;
    if (!live) return;
    const from = live.end;
    this.animate(
      'live',
      SPRING_BACK_MS,
      (t) => {
        const end = lerp(from, this.drawnAt(source), easeOut(t));
        live.end = end;
        live.view.draw(live.wire, this.palette, this.drawnAt(source), end);
        this.redraw();
      },
      () => this.dropLive(),
    );
  }

  /** A tapped socket that cannot take the wire: the wire reaches for it, is pushed away, and springs back. */
  private reachFor(pending: Pending, socket: Socket): void {
    const from = this.placeOf(pending.source);
    const pushed = wireEndAt(socket.at, [{ ...socket, legal: false }], this.reach, from).end;
    this.showLive(pending.source, from);
    const live = this.live;
    if (!live) return;
    this.animate(
      'live',
      REACH_MS + SPRING_BACK_MS,
      (t) => {
        const split = REACH_MS / (REACH_MS + SPRING_BACK_MS);
        const k = t < split ? easeOut(t / split) : 1 - easeOut((t - split) / (1 - split));
        live.end = lerp(from, pushed, k);
        live.view.draw(live.wire, this.palette, from, live.end);
        this.redraw();
      },
      () => this.dropLive(),
    );
  }

  /** The new wire's end settles into its socket from where the wire was let go (or from its source, for a tap). */
  private settle(before: Blueprint, after: Blueprint, socketKey: string, from: Vec2): void {
    const known = new Set(before.wires.map((wire) => wire.id));
    const id = after.wires.find((wire) => !known.has(wire.id))?.id;
    const wire = id !== undefined ? [...this.surface.scene.wires, ...this.surface.scene.linkages].find((candidate) => candidate.id === id) : undefined;
    const view = id !== undefined ? this.surface.wireView(id) : undefined;
    if (!wire || !view) return;
    const atTo = wire.to.key === socketKey;
    const home = atTo ? wire.to.at : wire.from.at;
    const other = atTo ? wire.from.at : wire.to.at;
    let start = from;
    if (distance(start, home) < mmOf(1)) {
      // Already on the socket: it is pushed home a little, from just short of it along the wire.
      const length = Math.max(distance(home, other), 1e-9);
      start = { x: home.x - ((home.x - other.x) / length) * mmOf(6), y: home.y - ((home.y - other.y) / length) * mmOf(6) };
    }
    this.animate(
      'settle',
      SETTLE_MS,
      (t) => {
        if (view.graphics.destroyed) return;
        const end = lerp(start, home, elastic(t));
        view.draw(wire, this.palette, atTo ? other : end, atTo ? end : other);
        this.surface.requestFrame();
      },
      () => {
        if (view.graphics.destroyed) return;
        view.draw(wire, this.palette);
        this.surface.requestFrame();
      },
    );
  }

  /** Runs `step` from 0 to 1 over `duration` on animation frames; at once with reduced motion. */
  private animate(name: string, duration: number, step: (t: number) => void, done?: () => void): void {
    const previous = this.motions.get(name);
    if (previous) {
      this.motions.delete(name);
      previous.step(1);
      previous.done?.();
    }
    if (duration <= 0 || reducedMotion()) {
      step(1);
      done?.();
      return;
    }
    this.motions.set(name, { started: performance.now(), duration, step, ...(done ? { done } : {}) });
    step(0);
    if (this.frame === undefined) this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = undefined;
    for (const [name, motion] of [...this.motions]) {
      const t = Math.min(1, Math.max(0, (now - motion.started) / motion.duration));
      motion.step(t);
      if (t >= 1 && this.motions.get(name) === motion) {
        this.motions.delete(name);
        motion.done?.();
      }
    }
    this.surface.requestFrame();
    if (this.motions.size > 0) this.frame = requestAnimationFrame(this.tick);
  };

  /** Every motion jumps to its end: a new press, or Run mode. */
  private finishMotions(): void {
    for (const [name, motion] of [...this.motions]) {
      this.motions.delete(name);
      motion.step(1);
      motion.done?.();
    }
  }

  private clearCue(): void {
    this.refusal = undefined;
  }

  private socketMark(port: ScenePort, at: Vec2 = this.drawnAt(port)): SocketMark {
    return { at, type: port.type, connected: port.connected };
  }

  /**
   * The sockets glowing now: the right colour while a wire waits for its tap, while a wrong socket pushes a wire away,
   * and after a socket refused one; and the socket a wire under a finger would land on.
   */
  private glowState(): { readonly hints: readonly ScenePort[]; readonly target?: ScenePort } {
    const drag = this.dragging;
    const legal = (pending: Pending): ScenePort[] => this.socketsFor(pending).filter((socket) => socket.legal).map((socket) => socket.port);
    let hints: readonly ScenePort[] = [];
    if (this.refusal) hints = this.refusal.hints;
    else if (this.waiting) hints = legal(this.waiting);
    else if (drag?.pushedBy) hints = legal(drag);
    const target = drag?.target?.port;
    return { hints: hints.filter((port) => port.key !== target?.key), ...(target ? { target } : {}) };
  }

  private currentMarks(): Marks {
    const fan = this.fan;
    const fanMarks: FanMark[] = fan
      ? fan.crowd.members.map((member) => ({ home: member.at, sockets: member.ports.map((port) => this.socketMark(port)) }))
      : [];
    const drag = this.dragging;
    const pending = drag ?? this.waiting;
    const { hints, target } = this.glowState();
    return {
      ...(fanMarks.length > 0 ? { fan: fanMarks } : {}),
      hints: hints.map((port) => this.socketMark(port)),
      ...(target ? { target: this.socketMark(target) } : {}),
      ...(pending ? { source: this.socketMark(pending.source) } : {}),
      ...(drag ? { plug: { at: drag.end, type: drag.source.type } } : {}),
    };
  }

  private redraw(): void {
    this.marks.draw(this.currentMarks(), this.palette);
    this.drawBin();
    this.surface.requestFrame();
  }

  /**
   * The marks and the bin go on top of the ports layer after every rebuild, above every socket, as fanned sockets must
   * be; placement's rings and handles then go above them (task 3.2), which never show while a crowd is fanned out.
   */
  private attach(): void {
    const layers = this.surface.layers;
    if (!layers) return;
    for (const graphics of [this.marks.graphics, this.bin.graphics]) {
      graphics.parentRenderLayer?.detach(graphics);
      layers.ports.attach(graphics);
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Small helpers

  private commit(command: EditCommand): EditResult {
    return this.surface.apply(command);
  }

  private editable(): boolean {
    return !this.host.readOnly && this.surface.mode === 'build' && this.surface.blueprint !== undefined;
  }

  /** Locked, or a part is waiting for its tap (from the tray or by the Move handle): it takes every press (task 3.2). */
  private deferring(): boolean {
    return !this.editable() || this.surface.placement.placing || this.surface.placement.moving !== undefined;
  }

  private get sensitivity(): number {
    return Math.max(this.host.prefs().dragSensitivity, MIN_SENSITIVITY);
  }

  private get palette(): Palette {
    return paletteFor(this.host.prefs());
  }

  /** Forgiveness in canvas mm at the current zoom: 32 px, more for lower drag sensitivity (D44), and never less than a socket's own target. */
  private get reach(): number {
    return Math.max(WIRE_REACH_PX / this.sensitivity, (PORT_MM * PX_PER_MM) / 2) / this.surface.camera.scale;
  }

  private overRemove(event: PointerEvent): boolean {
    return this.removeTargets.some((element) => element.isConnected && contains(element.getBoundingClientRect(), event.clientX, event.clientY));
  }

  /** The canvas point under a pointer; held inside the canvas when `inside`. */
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

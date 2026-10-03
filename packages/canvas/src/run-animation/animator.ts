// Run mode's drawing (task 3.5): the canvas draws the frames the app gives it through `applyRunFrame`, and only those.
// It never steps the simulation and never reads a clock to decide what happens; between two frames it tweens on
// requestAnimationFrame, so a Run at 30 ticks a second moves smoothly and one in slow motion glides from tick to tick.
// While the Run holds tick 0 (the app's one-second spin-up) the wires light before anything moves: their dots flow
// and nothing else does. The build itself is never touched: Stop puts every node back where the build has it.
// See docs/run-animation.md.
import { Matrix } from 'pixi.js';
import type { ArenaFeatureId, PlacedPartId, Pose, Vec2, WireId } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core/interface';
import type { SceneArena } from '../scene/arena.ts';
import type { Scene, ScenePart } from '../scene/scene.ts';
import type { Palette } from '../renderer/style.ts';
import type { PartView, WireView, WorldLayers } from '../renderer/views.ts';
import type { Affine } from './affine.ts';
import { IDENTITY, apply, bodyMatrix, compose, invert, nodeMatrix, translation } from './affine.ts';
import { castOf } from './cast.ts';
import type { RunCast } from './cast.ts';
import { DotField } from './dots.ts';
import type { DotRun } from './dots.ts';
import { DOT_SPACING_MM, SHUDDER_MM, SPIN_UP_CATCH_UP_MM_PER_S, TWEEN_MAX_MS } from './look.ts';
import { FloorMarks, edgeOnCanvas } from './marks.ts';
import { PartOverlay } from './overlay.ts';
import type { PartTells } from './overlay.ts';
import { advance, blend } from './state.ts';
import type { BodyPose, RunDisplay, RunState } from './state.ts';

/** PartTells on the canvas (mm). */
export type RunTells = PartTells;

/** What the animator needs from the surface. */
export interface RunAnimatorHost {
  scene(): Scene;
  arena(): SceneArena | undefined;
  layers(): WorldLayers | undefined;
  palette(): Palette;
  partView(id: PlacedPartId): PartView | undefined;
  wireView(id: WireId): WireView | undefined;
  /** Redraws the arena's props, with the ones that moved at their poses (arena mm); undefined puts every prop back. */
  drawProps(moved: ReadonlyMap<ArenaFeatureId, Pose> | undefined): void;
  /** `prefers-reduced-motion`: frames show at once, with no tween and no flowing dots during the spin-up. */
  reducedMotion(): boolean;
}

const sameAffine = (a: Affine, b: Affine): boolean =>
  a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.tx === b.tx && a.ty === b.ty;

const matrixOf = (m: Affine): Matrix => new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty);

/** Props' poses as one string, so they are redrawn only when one moved. */
const propsKey = (props: ReadonlyMap<ArenaFeatureId, Pose>): string =>
  [...props].map(([id, pose]) => `${id}:${pose.x},${pose.y},${pose.heading}`).join(';');

export class RunAnimator {
  readonly marks = new FloorMarks();
  readonly dots = new DotField();
  private readonly host: RunAnimatorHost;
  private cast: RunCast | undefined;
  private readonly overlays = new Map<PlacedPartId, PartOverlay>();
  private previous: RunState | undefined;
  private current: RunState | undefined;
  private shownDisplay: RunDisplay | undefined;
  private arrivedAt = 0;
  private interval = 0;
  /** Extra travel of each wire's dots while the Run holds tick 0, mm. */
  private readonly spin = new Map<WireId, number>();
  /** After the spin-up, each wire's dots carry on to the next whole spacing, so tick 1 on looks the same every time. */
  private readonly catchUp = new Map<WireId, number>();
  private lastStep: number | undefined;
  private readonly matrices = new Map<PlacedPartId, Affine>();
  private readonly wireEnds = new Map<WireId, readonly [Vec2, Vec2]>();
  /** Each line's path as the Run draws it: its route carried by its body, or straight between its ends (task 3.7). */
  private readonly wirePaths = new Map<WireId, readonly Vec2[]>();
  private drawnProps = '';
  private active = false;

  constructor(host: RunAnimatorHost) {
    this.host = host;
  }

  get running(): boolean {
    return this.active;
  }

  /** The state of the latest frame. */
  get state(): RunState | undefined {
    return this.current;
  }

  /** What was drawn last: the latest frame, or a tween towards it. */
  get shown(): RunDisplay | undefined {
    return this.shownDisplay;
  }

  /** True while a tween, the spin-up or its catch-up still needs frames. */
  get moving(): boolean {
    if (!this.active || !this.current) return false;
    if (this.spinningUp() || this.catchUp.size > 0) return true;
    return this.alpha(this.lastStep ?? this.arrivedAt) < 1;
  }

  /** Run mode starts: works out what can move, and draws the build as it stands until the first frame. */
  enter(): void {
    this.active = true;
    this.reset();
    this.prepare();
  }

  /** Back to Build: every node and line returns to the build's own transform, and the Run's drawing goes. */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.restoreTransforms();
    this.clearOverlays();
    this.dots.clear();
    this.marks.reset();
    if (this.drawnProps !== '') this.host.drawProps(undefined);
    this.reset();
  }

  /** After the surface rebuilt its views (a prefs change in Run mode): drawn again with the new palette. */
  rebuilt(): void {
    if (!this.active) return;
    this.clearOverlays();
    this.prepare();
    this.matrices.clear();
    this.wireEnds.clear();
    this.wirePaths.clear();
  }

  /** Takes one frame. `now` is the frame clock, used only to tween towards it. */
  apply(frame: RunFrame, now: number): void {
    if (!this.active || !this.cast) return;
    const scene = this.host.scene();
    const before = this.current;
    const restarted = before !== undefined && frame.tick <= before.tick;
    if (restarted || before === undefined) {
      this.spin.clear();
      this.catchUp.clear();
      this.marks.reset();
    }
    const next = advance(restarted ? undefined : before, frame, this.cast, scene, this.host.arena()?.matrix);
    if (before && !restarted && before.tick === 0 && next.tick > 0) this.endSpinUp(before);
    // Where the tween starts: what is on screen now, so a frame that arrives mid-tween carries on from there.
    this.previous = restarted ? undefined : (this.shownDisplay ?? before);
    this.interval = this.previous ? Math.min(TWEEN_MAX_MS, Math.max(0, now - this.arrivedAt)) : 0;
    this.arrivedAt = now;
    this.current = next;
    this.recordMarks(next);
  }

  /** Draws the frame for `now`. Returns true while more frames are needed. */
  step(now: number): boolean {
    if (!this.active) return false;
    const current = this.current;
    if (!current) {
      this.lastStep = now;
      return false;
    }
    const seconds = this.lastStep === undefined ? 0 : Math.max(0, now - this.lastStep) / 1000;
    this.lastStep = now;
    this.advanceSpin(current, seconds);
    const display = blend(this.previous, current, this.alpha(now));
    this.shownDisplay = display;
    this.paint(display);
    return this.moving;
  }

  /** The topmost part drawn at a canvas point (mm), as Run mode draws it. */
  partAt(point: Vec2): ScenePart | undefined {
    const scene = this.host.scene();
    for (let i = scene.parts.length - 1; i >= 0; i--) {
      const part = scene.parts[i] as ScenePart;
      const local = apply(invert(this.matrixOf(part.id)), point);
      if (Math.abs(local.x) <= part.tile.w / 2 && Math.abs(local.y) <= part.tile.h / 2) return part;
    }
    return undefined;
  }

  /** A manual switch drawn at a canvas point, for a tap or click that flips it. */
  switchAt(point: Vec2): PlacedPartId | undefined {
    const part = this.partAt(point);
    return part && this.cast?.switches.get(part.id) === 'manual' ? part.id : undefined;
  }

  /** Whether a part is a switch the child flips. */
  isManualSwitch(id: PlacedPartId): boolean {
    return this.cast?.switches.get(id) === 'manual';
  }

  /** A part node's transform now (canvas mm), as drawn. */
  matrixOf(id: PlacedPartId): Affine {
    const known = this.matrices.get(id);
    if (known) return known;
    const part = this.host.scene().partById.get(id);
    return part ? nodeMatrix(part.pose) : IDENTITY;
  }

  /** A point in a part's frame (x forward, y left) where it is drawn now. */
  partPoint(id: PlacedPartId, point: Vec2): Vec2 {
    return apply(this.matrixOf(id), { x: point.x, y: -point.y });
  }

  /** Where a part's Run-mode drawing shows now (canvas mm): what the e2e harness probes in screenshots. */
  tellsOf(id: PlacedPartId): RunTells | undefined {
    const overlay = this.overlays.get(id);
    const display = this.shownDisplay;
    if (!overlay || !display) return undefined;
    const local = overlay.tells(display);
    const m = this.matrixOf(id);
    const all = (points: readonly Vec2[] | undefined): Vec2[] | undefined => points?.map((point) => apply(m, point));
    const sounds = local.sounds
      ? Object.fromEntries(Object.entries(local.sounds).map(([sound, points]) => [sound, all(points) ?? []]))
      : undefined;
    return {
      ...(local.treads ? { treads: all(local.treads) } : {}),
      ...(local.arm ? { arm: apply(m, local.arm) } : {}),
      ...(local.glow ? { glow: all(local.glow) } : {}),
      ...(local.charge
        ? { charge: { full: apply(m, local.charge.full), ...(local.charge.empty ? { empty: apply(m, local.charge.empty) } : {}) } }
        : {}),
      ...(sounds ? { sounds } : {}),
    };
  }

  /** A wire's ends as drawn now. */
  /** Where a line is drawn now (canvas mm), end to end, along its route once tidied: what its dots and label follow. */
  pathOf(id: WireId): readonly Vec2[] | undefined {
    const known = this.wirePaths.get(id);
    if (known) return known;
    const ends = this.endsOf(id);
    return ends ? this.host.wireView(id)?.path ?? ends : undefined;
  }

  endsOf(id: WireId): readonly [Vec2, Vec2] | undefined {
    const known = this.wireEnds.get(id);
    if (known) return known;
    const wire = [...this.host.scene().wires, ...this.host.scene().linkages].find((candidate) => candidate.id === id);
    return wire ? [wire.from.at, wire.to.at] : undefined;
  }

  destroy(): void {
    this.clearOverlays();
    this.dots.destroy();
    this.marks.destroy();
  }

  // ---------------------------------------------------------------------------------------------------------

  private reset(): void {
    this.previous = undefined;
    this.current = undefined;
    this.shownDisplay = undefined;
    this.spin.clear();
    this.catchUp.clear();
    this.lastStep = undefined;
    this.interval = 0;
    this.matrices.clear();
    this.wireEnds.clear();
    this.wirePaths.clear();
    this.drawnProps = '';
  }

  private prepare(): void {
    const scene = this.host.scene();
    const palette = this.host.palette();
    this.cast = castOf(scene);
    for (const part of scene.parts) {
      const view = this.host.partView(part.id);
      if (view) this.overlays.set(part.id, new PartOverlay(part, this.cast, view.run, palette));
    }
    this.dots.setPalette(palette);
    const layers = this.host.layers();
    if (layers) {
      this.dots.container.parentRenderLayer?.detach(this.dots.container);
      layers.wires.attach(this.dots.container);
    }
  }

  private clearOverlays(): void {
    for (const overlay of this.overlays.values()) overlay.destroy();
    this.overlays.clear();
  }

  private restoreTransforms(): void {
    const scene = this.host.scene();
    for (const part of scene.parts) {
      const node = this.host.partView(part.id)?.node;
      if (!node) continue;
      node.skew.set(0, 0);
      node.pivot.set(0, 0);
    }
    for (const wire of [...scene.wires, ...scene.linkages]) {
      const graphics = this.host.wireView(wire.id)?.graphics;
      if (!graphics) continue;
      graphics.position.set(0, 0);
      graphics.scale.set(1, 1);
      graphics.rotation = 0;
      graphics.skew.set(0, 0);
    }
  }

  private alpha(now: number): number {
    if (!this.previous || this.interval <= 0 || this.host.reducedMotion()) return 1;
    return Math.min(1, Math.max(0, (now - this.arrivedAt) / this.interval));
  }

  private spinningUp(): boolean {
    return this.current?.tick === 0 && !this.host.reducedMotion();
  }

  /** While tick 0 holds, live wires' dots flow at their speed; after it, they carry on to the next whole spacing. */
  private advanceSpin(current: RunState, seconds: number): void {
    if (this.spinningUp()) {
      for (const [id, wire] of current.wires) if (wire.speed !== 0) this.spin.set(id, (this.spin.get(id) ?? 0) + wire.speed * seconds);
      return;
    }
    for (const [id, target] of this.catchUp) {
      const at = this.spin.get(id) ?? 0;
      const speed = Math.max(Math.abs(current.wires.get(id)?.speed ?? 0), SPIN_UP_CATCH_UP_MM_PER_S);
      const step = Math.sign(target - at) * Math.min(Math.abs(target - at), speed * seconds);
      const next = at + step;
      if (next === target || this.host.reducedMotion()) {
        this.spin.delete(id);
        this.catchUp.delete(id);
      } else {
        this.spin.set(id, next);
      }
    }
  }

  private endSpinUp(spinUp: RunState): void {
    for (const [id, extra] of this.spin) {
      const forward = (spinUp.wires.get(id)?.speed ?? 0) >= 0;
      const whole = (forward ? Math.ceil(extra / DOT_SPACING_MM) : Math.floor(extra / DOT_SPACING_MM)) * DOT_SPACING_MM;
      if (whole === extra) this.spin.delete(id);
      else this.catchUp.set(id, whole);
    }
    for (const id of [...this.spin.keys()]) if (!this.catchUp.has(id)) this.spin.delete(id);
  }

  /** The transform of each body: from where the build has its root part to where the frame has it. */
  private bodyMatrices(display: RunDisplay): Map<PlacedPartId, Affine> {
    const scene = this.host.scene();
    const out = new Map<PlacedPartId, Affine>();
    for (const [id, pose] of display.bodies) {
      const root = scene.partById.get(id);
      if (root) out.set(id, bodyMatrix(root.pose, pose));
    }
    return out;
  }

  private recordMarks(state: RunState): void {
    const cast = this.cast;
    if (!cast) return;
    const scene = this.host.scene();
    const edges = new Map<PlacedPartId, readonly Vec2[]>();
    for (const id of state.dragging) {
      const part = scene.partById.get(id);
      const pose = state.bodies.get(id);
      if (part && pose) edges.set(id, edgeOnCanvas(part, pose, bodyMatrix(part.pose, pose)));
    }
    this.marks.record(edges);
  }

  private paint(display: RunDisplay): void {
    const cast = this.cast;
    if (!cast) return;
    const scene = this.host.scene();
    const bodies = this.bodyMatrices(display);
    const bodyOf = (id: PlacedPartId): Affine => bodies.get(cast.bodyOf.get(id) ?? id) ?? IDENTITY;

    for (const part of scene.parts) {
      let matrix = compose(bodyOf(part.id), nodeMatrix(part.pose));
      if (display.stalled.has(part.id)) matrix = compose(matrix, translation(0, display.shake * SHUDDER_MM));
      const view = this.host.partView(part.id);
      const known = this.matrices.get(part.id);
      if (view && (!known || !sameAffine(known, matrix))) view.node.setFromMatrix(matrixOf(matrix));
      this.matrices.set(part.id, matrix);
      this.overlays.get(part.id)?.update(display);
    }

    const runs = new Map<WireId, DotRun>();
    const palette = this.host.palette();
    for (const wire of [...scene.wires, ...scene.linkages]) {
      const fromBody = bodyOf(wire.from.ref.part);
      const toBody = bodyOf(wire.to.ref.part);
      const ends: readonly [Vec2, Vec2] = [apply(fromBody, wire.from.at), apply(toBody, wire.to.at)];
      const view = this.host.wireView(wire.id);
      const known = this.wireEnds.get(wire.id);
      const moved = !known || known[0].x !== ends[0].x || known[0].y !== ends[0].y || known[1].x !== ends[1].x || known[1].y !== ends[1].y;
      if (view && moved) {
        if (sameAffine(fromBody, toBody)) {
          // Both ends ride on one body: the line moves with it, undrawn.
          view.graphics.setFromMatrix(matrixOf(fromBody));
        } else {
          view.graphics.setFromMatrix(matrixOf(IDENTITY));
          view.draw(wire, palette, ends[0], ends[1]);
        }
      }
      this.wireEnds.set(wire.id, ends);
      // The line as drawn: one riding on one body keeps its resting path (a tidied route, task 3.7), carried by that
      // body; one between two bodies is drawn straight between its ends. Its dots and its label follow it.
      const path = sameAffine(fromBody, toBody) && view ? view.path.map((point) => apply(fromBody, point)) : ends;
      this.wirePaths.set(wire.id, path);
      const state = display.wires.get(wire.id);
      if (!state || state.speed === 0) continue;
      runs.set(wire.id, { type: wire.type, path, travelled: state.travelled + (this.spin.get(wire.id) ?? 0) });
    }
    this.dots.draw(runs);

    const edges = new Map<PlacedPartId, readonly Vec2[]>();
    const tilted: { corners: readonly Vec2[]; pose: BodyPose; forward: Vec2; left: Vec2 }[] = [];
    for (const [id, pose] of display.bodies) {
      const part = scene.partById.get(id);
      const matrix = bodies.get(id);
      if (!part || !matrix) continue;
      if (display.dragging.has(id)) edges.set(id, edgeOnCanvas(part, pose, matrix));
      if (pose.pitch !== 0 || pose.roll !== 0) {
        const flat = bodyMatrix(part.pose, { ...pose, pitch: 0, roll: 0 });
        const turn = (pose.rotation * Math.PI) / 180;
        tilted.push({
          corners: part.corners.map((corner) => apply(flat, corner)),
          pose,
          forward: { x: Math.cos(turn), y: Math.sin(turn) },
          left: { x: Math.sin(turn), y: -Math.cos(turn) },
        });
      }
    }
    this.marks.draw(palette, edges, tilted);

    const props = propsKey(display.props);
    if (props !== this.drawnProps) {
      this.host.drawProps(display.props.size > 0 ? display.props : undefined);
      this.drawnProps = props;
    }
  }
}

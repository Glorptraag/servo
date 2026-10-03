// The canvas handle (task 3.1's part of packages/canvas/src/interface.ts): mounting, `load`, the scene layers, pan,
// zoom, `fit`, the grid that fades at rest, art, prefs, and the focus and dim hooks task 3.4's selection drives.
// Members other tasks build throw until those tasks land, naming the task. See docs/renderer.md.
import { Container, RenderLayer, Ticker, autoDetectRenderer } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { canonicalizeBlueprint, serializeBlueprint, validateBlueprint } from '@servo/schema';
import type { ArenaFeatureId, AssetKey, Blueprint, Level, PartTypeId, PlacedPartId, Pose, ValidationResult, Vec2, WireId } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core/interface';
import type {
  CanvasEventMap,
  CanvasHandle,
  CanvasMode,
  CanvasOptions,
  CanvasPrefs,
  DrawnHintStep,
  EditCommand,
  EditResult,
  ListView,
  PropTemplate,
  Selection,
} from '../interface.ts';
import { ListViewDom } from '../list-view/dom.ts';
import { ListViewModel } from '../list-view/model.ts';
import { applyEdit } from '../placement/apply.ts';
import { PlacementController } from '../placement/controller.ts';
import { RunAnimator } from '../run-animation/animator.ts';
import { readoutsDue } from '../run-animation/readouts.ts';
import { layArena } from '../scene/arena.ts';
import type { SceneArena } from '../scene/arena.ts';
import { unionRect } from '../scene/geometry.ts';
import type { Rect } from '../scene/geometry.ts';
import { hitTest } from '../scene/hit.ts';
import type { Hit } from '../scene/hit.ts';
import { buildScene } from '../scene/scene.ts';
import type { Scene } from '../scene/scene.ts';
import { SelectionController } from '../selection/controller.ts';
import type { SelectionSource } from '../selection/controller.ts';
import { WiringController } from '../wiring/controller.ts';
import { ArenaView } from './arena-view.ts';
import { ArtStore } from './art.ts';
import { Camera, limitsFor } from './camera.ts';
import type { ViewLimits } from './camera.ts';
import { Emitter } from './emitter.ts';
import { Fade, FrameLoop } from './frame-loop.ts';
import { GRID_FADE_IN_MS, GRID_FADE_OUT_MS, GRID_REST_MS, Grid } from './grid.ts';
import { DRAG_THRESHOLD_PX, InputRouter } from './input.ts';
import { ARENA_BUILD_ALPHA, paletteFor } from './style.ts';
import type { Palette } from './style.ts';
import { PartView, WireView } from './views.ts';
import type { DrawContext, Emphasis, WorldLayers } from './views.ts';

/** The canvas element's accessible name. The list view (task 3.6) is the screen-reader path to the build itself. */
export const CANVAS_NAME = 'Build canvas';
/** Run brings the arena up, and Stop takes it back, over this long (UI motion, brief Section 11). */
export const MODE_FADE_MS = 200;
/** Device pixels per CSS pixel are capped here: a 3× phone screen would cost twice a 2× tablet's pixels for little. */
export const MAX_RESOLUTION = 2;

/** What task 3.4 asks the renderer to show: anything not named is drawn normally. */
export interface EmphasisRequest {
  readonly parts?: ReadonlyMap<PlacedPartId, Emphasis>;
  readonly wires?: ReadonlyMap<WireId, Emphasis>;
  /** Port keys (`<part>.<port>`) drawn with a halo. */
  readonly ports?: ReadonlySet<string>;
}

const notYet = (member: string, task: string): Error => new Error(`${member} is not implemented yet (task ${task}).`);

/** Surfaces alive now: global GPU pools are released only when the last one goes. */
const live = new Set<CanvasSurface>();

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class CanvasSurface implements CanvasHandle {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new Camera();
  readonly input: InputRouter;
  /** Resolves once the renderer is up and the first frame is requested. */
  readonly ready: Promise<void>;
  /** The scene the canvas draws: task 3.2–3.7's geometry for hit testing, snapping and routing. */
  scene: Scene;
  arena: SceneArena | undefined;
  /** Bottom to top: the arena, the grid, then the world's layers. Undefined until `ready`. */
  layers: WorldLayers | undefined;
  /** The logical parent for anything later tasks attach to a world layer (hints, ghost wires, drag previews). */
  readonly overlays = new Container();
  /** Placing, moving, turning and removing parts by touch and pointer (task 3.2, src/placement/). */
  readonly placement: PlacementController;
  /** Drawing and removing wires by touch and pointer, sockets' glows and crowded sockets fanning out (task 3.3, src/wiring/). */
  readonly wiring: WiringController;
  /** The one selection, its focus states, and the hint rungs (task 3.4, src/selection/). */
  readonly selecting: SelectionController;
  /** Run mode's drawing: the frames `applyRunFrame` gives, tweened between ticks (task 3.5, src/run-animation/). */
  readonly run: RunAnimator;
  /** The screen-reader and keyboard path: the list view's model and its DOM beside the canvas (task 3.6, src/list-view/). */
  readonly list: ListViewModel;
  readonly listDom: ListViewDom;

  private readonly options: CanvasOptions;
  private readonly emitter = new Emitter<CanvasEventMap>();
  private readonly loop: FrameLoop;
  private readonly art: ArtStore;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly stage = new Container();
  private readonly arenaGroup = new Container({ isRenderGroup: true, label: 'arena' });
  private readonly arenaView = new ArenaView();
  private readonly grid = new Grid();
  private readonly world = new Container({ isRenderGroup: true, label: 'world' });
  private readonly partNodes = new Container({ label: 'parts' });
  private readonly lineNodes = new Container({ label: 'lines' });
  private readonly partViews = new Map<PlacedPartId, PartView>();
  private readonly wireViews = new Map<WireId, WireView>();
  private readonly gridFade = new Fade(0);
  /** 0 is the Build look, 1 the Run look: the arena floor laid down and its features at full strength. */
  private readonly modeFade = new Fade(0);
  private renderer: Renderer | undefined;
  /** Run mode: the latest frame, for the list view's live readouts, and the tick it last read them at. */
  private lastFrame: RunFrame | undefined;
  private listedTick: number | undefined;
  private current: Blueprint | undefined;
  private currentMode: CanvasMode = 'build';
  private level: Level;
  private prefs: CanvasPrefs;
  private emphasis: EmphasisRequest | null = null;
  private restTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(host: HTMLElement, options: CanvasOptions) {
    this.options = options;
    this.level = options.level;
    this.prefs = options.prefs;
    this.scene = buildScene(undefined, options.catalogue);
    this.arena = undefined;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', CANVAS_NAME);
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
      webkitTouchCallout: 'none',
      outline: 'none',
    });
    // A GPU context lost in the background (a tablet short of memory) comes back blank: draw again once Pixi restores it.
    this.canvas.addEventListener('webglcontextrestored', () => this.loop.request());
    host.appendChild(this.canvas);
    this.camera.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.loop = new FrameLoop((now) => this.frame(now));
    this.art = new ArtStore(options.resolveArt, (key) => this.artArrived(key));
    this.input = new InputRouter(this.canvas, {
      hitTest: (screen) => this.hitAt(screen),
      zoom: () => this.camera.zoom,
      panBy: (dx, dy) => this.viewChange(() => this.camera.panBy(dx, dy, this.limits())),
      zoomAbout: (screen, zoom) => this.viewChange(() => this.camera.zoomAbout(screen, zoom, this.limits())),
      dragThreshold: () => DRAG_THRESHOLD_PX / Math.max(this.prefs.dragSensitivity, 0.05),
    });
    this.placement = new PlacementController({
      surface: this,
      catalogue: options.catalogue,
      readOnly: options.readOnly === true,
      prefs: () => this.prefs,
      drawContext: () => this.drawContext,
      art: (key) => this.art.get(key),
      placed: (event) => this.emitter.emit('placement', event),
    });
    // After placement, so its pointer handler comes first: sockets and wires sit above the parts they belong to.
    this.wiring = new WiringController({
      surface: this,
      catalogue: options.catalogue,
      readOnly: options.readOnly === true,
      prefs: () => this.prefs,
    });
    // Last, so its pointer handler comes first: it sees every press, and claims only the selected prop's bin.
    this.selecting = new SelectionController({
      surface: this,
      catalogue: options.catalogue,
      readOnly: options.readOnly === true,
      prefs: () => this.prefs,
      drawContext: () => this.drawContext,
      selected: (event) => this.emitter.emit('select', event),
    });
    this.run = new RunAnimator({
      scene: () => this.scene,
      arena: () => this.arena,
      layers: () => this.layers,
      palette: () => this.palette,
      partView: (id) => this.partViews.get(id),
      wireView: (id) => this.wireViews.get(id),
      drawProps: (moved) => this.drawProps(moved),
      reducedMotion,
    });
    // A tap or click on a manual switch in Run mode flips it; Enter flips a selected one (D42).
    this.input.taps.push((_event, screen) => this.tappedInRun(screen));
    this.canvas.addEventListener('keydown', this.keyedInRun);
    this.list = new ListViewModel({
      catalogue: options.catalogue,
      readOnly: options.readOnly === true,
      blueprint: () => this.current,
      mode: () => this.currentMode,
      level: () => this.level,
      apply: (command) => this.apply(command),
      control: (input) => this.emitter.emit('control', { input }),
      select: (selection) => this.select(selection),
      hint: () => {
        const step = this.selecting.shownHint;
        return step && { step: step.step, line: step.line };
      },
      live: (subject) => (this.currentMode === 'run' ? this.lastFrame?.live.get(subject) : undefined),
    });
    this.listDom = new ListViewDom(host, this.list, { prefs: () => this.prefs });
    this.resizeObserver =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resized()) : undefined;
    this.resizeObserver?.observe(this.canvas);
    live.add(this);
    this.ready = this.start();
  }

  // ---------------------------------------------------------------------------------------------------------
  // CanvasHandle: task 3.1

  get mode(): CanvasMode {
    return this.currentMode;
  }

  get blueprint(): Blueprint | undefined {
    return this.current;
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  load(blueprint: Blueprint): ValidationResult<Blueprint> {
    this.alive('load');
    if (this.currentMode === 'run') throw new Error('load is refused in Run mode: Stop returns to Build mode first.');
    const checked = validateBlueprint(blueprint, this.options.catalogue);
    if (!checked.ok) return checked;
    const canonical = canonicalizeBlueprint(checked.value, this.options.catalogue);
    this.current = canonical;
    this.rebuild();
    return { ok: true, value: canonical };
  }

  setMode(mode: CanvasMode): void {
    this.alive('setMode');
    if (mode !== 'build' && mode !== 'run') throw new RangeError(`Unknown mode '${String(mode)}'.`);
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    this.lastFrame = undefined;
    this.listedTick = undefined;
    this.placement.modeChanged();
    this.wiring.modeChanged();
    if (mode === 'run') {
      this.run.enter();
    } else {
      // Stop: every node and line goes back to the build exactly as it was (ground rule 4).
      this.run.exit();
      this.rebuild();
    }
    this.selecting.modeChanged();
    this.modeFade.toward(mode === 'run' ? 1 : 0, this.motion(MODE_FADE_MS), performance.now());
    this.loop.request();
    this.list.changed();
  }

  fit(): void {
    this.alive('fit');
    this.viewChange(() => this.camera.fit(this.content(), this.limits()));
  }

  setZoom(zoom: number): void {
    this.alive('setZoom');
    if (!Number.isFinite(zoom)) throw new RangeError(`setZoom needs a finite number, not ${zoom}.`);
    this.viewChange(() =>
      this.camera.zoomAbout({ x: this.camera.width / 2, y: this.camera.height / 2 }, zoom, this.limits()),
    );
  }

  /**
   * The level sets the reading load of what the canvas writes. Task 3.1 writes only a neutral tile's real name, which
   * shows at every level (a picture and a name go together from Level 1, brief Section 12); the list view (task 3.6)
   * and hint callouts (task 3.4) read the level from here.
   */
  setLevel(level: Level): void {
    this.alive('setLevel');
    this.level = level;
    this.list.changed();
  }

  /** The child's level, as `mountCanvas` or `setLevel` last gave it. */
  get currentLevel(): Level {
    return this.level;
  }

  setPrefs(prefs: CanvasPrefs): void {
    this.alive('setPrefs');
    this.prefs = prefs;
    this.rebuild();
  }

  on<K extends keyof CanvasEventMap>(type: K, listener: (event: CanvasEventMap[K]) => void): () => void {
    return this.emitter.on(type, listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    live.delete(this);
    this.selecting.destroy();
    this.placement.destroy();
    this.wiring.destroy();
    this.canvas.removeEventListener('keydown', this.keyedInRun);
    this.run.destroy();
    this.listDom.destroy();
    this.loop.stop();
    if (this.restTimer !== undefined) clearTimeout(this.restTimer);
    this.resizeObserver?.disconnect();
    this.input.destroy();
    this.art.close();
    this.emitter.clear();
    if (this.renderer) this.release(this.renderer);
    this.canvas.remove();
  }

  // ---------------------------------------------------------------------------------------------------------
  // CanvasHandle: task 3.2 (src/placement/, docs/placement.md)

  /**
   * The one way into the build: touch, pointer, the list view and the app all apply commands here, through the pure
   * `applyEdit`. Fires `edit` when the build changed.
   */
  apply(command: EditCommand): EditResult {
    this.alive('apply');
    if (this.options.readOnly || this.currentMode === 'run') {
      return { ok: false, refusal: { code: 'edit.locked', message: 'The build is locked: it is running, or this canvas is read-only.' } };
    }
    const current = this.current;
    if (!current) return { ok: false, refusal: { code: 'edit.no_build', message: 'Nothing is loaded yet.' } };
    const result = applyEdit(current, command, this.options.catalogue);
    if (result.ok && serializeBlueprint(result.blueprint) !== serializeBlueprint(current)) {
      this.current = result.blueprint;
      this.rebuild();
      this.emitter.emit('edit', { command, blueprint: result.blueprint });
    }
    return result;
  }

  beginPlacement(part: PartTypeId, pointer?: PointerEvent): void {
    this.alive('beginPlacement');
    this.placement.begin(part, pointer);
  }

  beginPropPlacement(prop: PropTemplate, pointer?: PointerEvent): void {
    this.alive('beginPropPlacement');
    this.placement.beginProp(prop, pointer);
  }

  cancelPlacement(): void {
    this.alive('cancelPlacement');
    this.placement.cancel();
  }

  setRemoveTargets(elements: readonly HTMLElement[]): void {
    this.alive('setRemoveTargets');
    this.placement.setRemoveTargets(elements);
    this.wiring.setRemoveTargets(elements);
  }

  // ---------------------------------------------------------------------------------------------------------
  // CanvasHandle: task 3.6 (src/list-view/)

  get listView(): ListView {
    return this.list;
  }

  // ---------------------------------------------------------------------------------------------------------
  // CanvasHandle: task 3.4 (src/selection/, docs/selection.md)

  get selection(): Selection | null {
    return this.selecting.selection;
  }

  select(selection: Selection | null): void {
    this.alive('select');
    this.selecting.select(selection);
  }

  showHint(step: DrawnHintStep): boolean {
    this.alive('showHint');
    const drawn = this.selecting.showHint(step);
    this.list.changed();
    return drawn;
  }

  clearHints(): void {
    this.alive('clearHints');
    this.selecting.clearHints();
    this.list.changed();
  }

  /** Placement, wiring and a tapped prop say what they now show; selection makes it the canvas's one selection. */
  selectionShown(source: SelectionSource, id: string | undefined): void {
    // Placement and wiring are made before selection, and may report while it is being made.
    (this.selecting as SelectionController | undefined)?.shown(source, id);
  }

  // ---------------------------------------------------------------------------------------------------------
  // CanvasHandle: later tasks

  /**
   * Run mode: draws one tick (task 3.5, docs/run-animation.md). The canvas draws only the frames it is given, tweening
   * between them; it never steps the simulation. Ignored in Build mode.
   */
  applyRunFrame(frame: RunFrame): void {
    this.alive('applyRunFrame');
    if (this.currentMode !== 'run') return;
    this.run.apply(frame, performance.now());
    this.loop.request();
    const before = this.lastFrame;
    this.lastFrame = frame;
    if (readoutsDue(before, frame, this.listedTick)) {
      this.listedTick = frame.tick;
      this.list.changed();
    }
  }

  tidyWires(): void {
    throw notYet('tidyWires', '3.7');
  }

  // ---------------------------------------------------------------------------------------------------------
  // Hooks for the later canvas tasks

  /** Focus states (task 3.4): dims or highlights parts, wires and ports. Null draws everything normally. */
  setEmphasis(request: EmphasisRequest | null): void {
    this.emphasis = request;
    this.applyEmphasis();
    this.loop.request();
  }

  /** Keeps the grid showing, as while the view moves: for drags that move parts or wires (tasks 3.2, 3.3). */
  wakeGrid(): void {
    if (this.destroyed) return;
    this.gridFade.toward(1, this.motion(GRID_FADE_IN_MS), performance.now());
    if (this.restTimer !== undefined) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => this.rest(), GRID_REST_MS);
    this.loop.request();
  }

  /** Asks for a frame after a change made outside the handle (a part moved by a drag, a hint drawn). */
  requestFrame(): void {
    this.loop.request();
  }

  /** The topmost thing under a screen point (CSS pixels from the canvas's top left), or null for empty canvas. */
  hitAt(screen: Vec2): Hit | null {
    const world = this.camera.screenToWorld(screen);
    if (this.currentMode === 'run') {
      // Parts are where the Run draws them, not where the build has them.
      const part = this.run.partAt(world);
      return part ? { kind: 'part', part } : null;
    }
    return hitTest(this.scene, world);
  }

  /** The part's display objects, for the tasks that move and animate them. */
  partView(id: PlacedPartId): PartView | undefined {
    return this.partViews.get(id);
  }

  wireView(id: WireId): WireView | undefined {
    return this.wireViews.get(id);
  }

  /** The current limits on zoom and pan. */
  limits(): ViewLimits {
    return limitsFor(this.content(), this.camera.width, this.camera.height);
  }

  /** True when nothing is loading, fading or waiting to be drawn: the picture on screen is final. */
  get settled(): boolean {
    return (
      this.renderer !== undefined &&
      this.art.pending === 0 &&
      !this.loop.pending &&
      !this.gridFade.moving &&
      !this.modeFade.moving &&
      !this.run.moving
    );
  }

  /** The workbench colour the renderer clears to (follows `highContrast`). */
  canvasBackground(): number | undefined {
    return this.renderer?.background.color.toNumber();
  }

  /** The grid's opacity now: 0 at rest. */
  get gridOpacity(): number {
    return this.gridFade.value;
  }

  /** Between the Build look (0: the workbench, the arena faint) and the Run look (1: the arena floor in full). */
  get modeBlend(): number {
    return this.modeFade.value;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Internals

  /** Run mode: a tap or click on a manual switch flips it, through `control` (never when read-only). */
  private tappedInRun(screen: Vec2): void {
    if (this.currentMode !== 'run' || this.options.readOnly) return;
    const partId = this.run.switchAt(this.camera.screenToWorld(screen));
    if (partId !== undefined) this.flip(partId);
  }

  /** Run mode: Enter flips the selected manual switch (D42: Space stays the app's Run and Stop). */
  private readonly keyedInRun = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || this.currentMode !== 'run' || this.options.readOnly) return;
    const selected = this.selection;
    if (selected?.kind !== 'part' || !this.run.isManualSwitch(selected.partId)) return;
    event.preventDefault();
    this.flip(selected.partId);
  };

  /** Asks the app to flip a manual switch the other way from the latest frame's. */
  flip(partId: PlacedPartId): boolean {
    if (this.currentMode !== 'run' || this.options.readOnly || !this.run.isManualSwitch(partId)) return false;
    const closed = this.run.state?.closed.get(partId);
    if (closed === undefined) return false;
    this.emitter.emit('control', { input: { partId, kind: 'switch', closed: !closed } });
    return true;
  }

  private drawProps(moved: ReadonlyMap<ArenaFeatureId, Pose> | undefined): void {
    this.arenaView.drawProps(this.arena, this.palette, moved);
  }

  private alive(member: string): void {
    if (this.destroyed) throw new Error(`${member}: the canvas was destroyed.`);
  }

  private motion(ms: number): number {
    return reducedMotion() ? 0 : ms;
  }

  private get resolution(): number {
    return Math.min(MAX_RESOLUTION, Math.max(1, globalThis.devicePixelRatio || 1));
  }

  private get palette(): Palette {
    return paletteFor(this.prefs);
  }

  private get drawContext(): DrawContext {
    return { palette: this.palette, typeface: this.prefs.typeface, resolution: this.resolution };
  }

  /** What fit and the limits look at: the build, and in Run mode the arena around it. */
  private content(): Rect | undefined {
    return this.currentMode === 'run' ? unionRect(this.scene.bounds, this.arena?.bounds) : this.scene.bounds;
  }

  private async start(): Promise<void> {
    const renderer = await autoDetectRenderer({
      canvas: this.canvas,
      width: this.camera.width,
      height: this.camera.height,
      resolution: this.resolution,
      autoDensity: false,
      antialias: true,
      background: this.palette.workbench,
      preference: 'webgl',
      // The canvas brings its own pointer handling and its own screen-reader path (the list view), so Pixi's
      // event and accessibility systems stay out: no hit testing on every move, no extra element in the page.
      skipExtensionImports: true,
    });
    // Pixi's scheduler (its GPU memory clean-up) runs on a shared clock that would ask for a frame at every display
    // refresh, for ever. The canvas advances that clock from its own frames instead, so at rest it asks for none.
    Ticker.system.autoStart = false;
    Ticker.system.stop();
    if (this.destroyed) {
      this.release(renderer);
      return;
    }
    this.renderer = renderer;
    const layers: WorldLayers = {
      chassis: new RenderLayer(),
      linkages: new RenderLayer(),
      parts: new RenderLayer(),
      wires: new RenderLayer(),
      ports: new RenderLayer(),
      hints: new RenderLayer(),
    };
    this.layers = layers;
    this.arenaGroup.addChild(this.arenaView.floor, this.arenaView.features, this.run.marks.container, this.arenaView.props);
    this.world.addChild(layers.chassis, layers.linkages, layers.parts, layers.wires, layers.ports, layers.hints);
    this.world.addChild(this.partNodes, this.lineNodes, this.run.dots.container, this.overlays);
    // The grid sits on the arena's floor and under the build: last in the arena's group, before the world's layers.
    this.grid.graphics.visible = false;
    this.arenaGroup.addChild(this.grid.graphics);
    this.stage.addChild(this.arenaGroup, this.world);
    this.resized();
    this.rebuild();
  }

  private release(renderer: Renderer): void {
    for (const view of this.partViews.values()) view.destroy();
    for (const view of this.wireViews.values()) view.destroy();
    this.partViews.clear();
    this.wireViews.clear();
    this.stage.destroy({ children: true });
    renderer.destroy({ removeView: false, releaseGlobalResources: live.size === 0 });
  }

  /** Follows the host: the canvas element is 100% of it, and the drawing buffer matches the element. */
  private resized(): void {
    if (this.destroyed) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.camera.resize(width, height);
    const renderer = this.renderer;
    if (renderer && (renderer.screen.width !== width || renderer.screen.height !== height || renderer.resolution !== this.resolution)) {
      renderer.resize(width, height, this.resolution);
      // Resizing clears the drawing buffer, and this runs after the frame's animation callbacks and before it is
      // painted. Draw now, as Pixi's own ResizePlugin does, so a sliding edge never shows a blank canvas.
      if (this.frame(performance.now())) this.loop.request();
      return;
    }
    this.loop.request();
  }

  /** Builds the scene from the current blueprint and brings every view in line with it. */
  private rebuild(): void {
    if (this.destroyed) return;
    this.scene = buildScene(this.current, this.options.catalogue);
    this.arena = layArena(this.current, this.options.catalogue, this.scene);
    this.list.changed();
    const layers = this.layers;
    const renderer = this.renderer;
    if (!layers || !renderer) {
      this.wiring.refresh();
      this.placement.refresh();
      this.selecting.refresh();
      return;
    }
    const context = this.drawContext;
    renderer.background.color = context.palette.workbench;

    const seenParts = new Set<PlacedPartId>();
    for (const part of this.scene.parts) {
      seenParts.add(part.id);
      let view = this.partViews.get(part.id);
      if (view && (view.part.record !== part.record || view.part.frame !== part.frame)) {
        view.destroy();
        view = undefined;
      }
      if (!view) {
        view = new PartView(part, this.partNodes);
        this.partViews.set(part.id, view);
      }
      view.draw(part, this.art.get(part.record.identity.art), context);
    }
    for (const [id, view] of this.partViews) {
      if (seenParts.has(id)) continue;
      view.destroy();
      this.partViews.delete(id);
    }

    const seenWires = new Set<WireId>();
    for (const wire of [...this.scene.wires, ...this.scene.linkages]) {
      seenWires.add(wire.id);
      let view = this.wireViews.get(wire.id);
      if (view && view.wire.type !== wire.type) {
        view.destroy();
        view = undefined;
      }
      if (!view) {
        view = new WireView(wire, this.lineNodes);
        this.wireViews.set(wire.id, view);
      }
      view.draw(wire, context.palette);
    }
    for (const [id, view] of this.wireViews) {
      if (seenWires.has(id)) continue;
      view.destroy();
      this.wireViews.delete(id);
    }

    this.orderLayers(layers);
    this.arenaView.draw(this.arena, context.palette);
    this.applyEmphasis();
    this.grid.invalidate();
    // Selection's own drawings first, so wiring's and placement's go on top of them in each layer.
    this.selecting.layer();
    this.wiring.refresh();
    this.placement.refresh();
    this.selecting.refresh();
    this.run.rebuilt();
    this.loop.request();
  }

  /** Re-attaches every view in the scene's order, so draw order never depends on what was added when. */
  private orderLayers(layers: WorldLayers): void {
    for (const part of this.scene.parts) this.partViews.get(part.id)?.attach(layers);
    for (const wire of [...this.scene.wires, ...this.scene.linkages]) {
      const view = this.wireViews.get(wire.id);
      if (view) view.attach(wire.type === 'mechanical' ? layers.linkages : layers.wires);
    }
  }

  private applyEmphasis(): void {
    const request = this.emphasis;
    const context = this.drawContext;
    const ports = request?.ports ?? new Set<string>();
    for (const [id, view] of this.partViews) {
      const highlighted = new Set([...ports].filter((key) => key.startsWith(`${id}.`)));
      view.setEmphasis(request?.parts?.get(id) ?? 'normal', highlighted, context);
    }
    for (const [id, view] of this.wireViews) view.setEmphasis(request?.wires?.get(id) ?? 'normal');
  }

  private artArrived(key: AssetKey): void {
    if (this.destroyed) return;
    const context = this.drawContext;
    for (const view of this.partViews.values()) {
      if (view.part.record.identity.art === key) view.draw(view.part, this.art.get(key), context);
    }
    this.loop.request();
  }

  /** A change to the view: redraw, wake the grid, and tell the app when the zoom moved. */
  private viewChange(change: () => void): void {
    const before = this.camera.zoom;
    change();
    this.wakeGrid();
    if (this.camera.zoom !== before) this.emitter.emit('zoom', { zoom: this.camera.zoom });
  }

  private rest(): void {
    this.restTimer = undefined;
    if (this.destroyed) return;
    if (this.input.busy) {
      this.restTimer = setTimeout(() => this.rest(), GRID_REST_MS);
      return;
    }
    this.gridFade.toward(0, this.motion(GRID_FADE_OUT_MS), performance.now());
    this.loop.request();
  }

  private frame(now: number): boolean {
    const renderer = this.renderer;
    if (!renderer || this.destroyed) return false;
    const fading = [this.gridFade.step(now), this.modeFade.step(now), this.run.step(now)].some(Boolean);
    // Selection's own drawings (a wire's label, a prop's ring) follow the Run's geometry, frame by frame (task 3.4).
    if (this.currentMode === 'run') this.selecting.followRun();
    const { camera } = this;
    const scale = camera.scale;
    const x = camera.width / 2 - camera.centreX * scale;
    const y = camera.height / 2 - camera.centreY * scale;
    for (const group of [this.arenaGroup, this.world]) {
      group.position.set(x, y);
      group.scale.set(scale);
    }
    const run = this.modeFade.value;
    this.arenaView.floor.alpha = run;
    this.arenaView.floor.visible = run > 0;
    this.arenaView.features.alpha = ARENA_BUILD_ALPHA + (1 - ARENA_BUILD_ALPHA) * run;
    this.arenaView.props.alpha = this.arenaView.features.alpha;
    this.run.marks.container.alpha = run;
    this.grid.graphics.alpha = this.gridFade.value;
    this.grid.graphics.visible = this.gridFade.value > 0;
    if (this.grid.graphics.visible) this.grid.cover(camera, this.palette);
    Ticker.system.update(now);
    renderer.render({ container: this.stage });
    return fading;
  }
}

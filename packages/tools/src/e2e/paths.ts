// The input paths the parity check compares (ground rule 8), each building on the same bench: touch and pointer by
// real input through CDP, the list view through its DOM (and its model where the app's tray and arena strip call
// it), and plain commands through the handle's `apply`, the reference. Each path finds out what it can do by trying
// it: a member a later task builds throws an error naming that task, and the step waits for it. Runs in the browser.
// See README.md.
import { vi } from 'vitest';
import { applyEdit } from '@servo/canvas';
import type { EditCommand, EditResult, ListAction, ListSubject, PlacementEvent, PropTemplate, Selection } from '@servo/canvas';
import { canvasPoseOf, cosSin, placeParts, robotRoot, serializeBlueprint } from '@servo/schema';
import type { Blueprint, Catalogue, PartTypeId, PlacedPartId, PortId, PortRef, Prop, Vec2, WireId } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { ControlInput, RunFrame } from '@servo/sim-core';
import { fannedOut, frames, middleOf, pageOf, pressPlaceOf, settle, showPoints, socketAt } from './bench.ts';
import type { Bench } from './bench.ts';
import { drag, holding, lift, move, press, tap } from './input.ts';
import type { Hand } from './input.ts';
import { READY, attempt, waitingLike } from './parity.ts';
import type { Capability, InputPath, PathBuild } from './parity.ts';
import { EDIT_KINDS, KEEPS_BUILD, STEP_KINDS, commandFor, isBuildStep, mapPart, mapPort } from './plan.ts';
import type { BuildPlan, IdMap, PlaceStep, Step, StepKind } from './plan.ts';

const bytesOf = (blueprint: Blueprint | undefined): string => (blueprint ? serializeBlueprint(blueprint) : '');

const portKey = (ref: PortRef): string => `${ref.part}.${ref.port}`;

/** The step's command must have been accepted. */
const accepted = (result: EditResult): void => {
  if (!result.ok) throw new Error(`refused as ${result.refusal.code}: ${result.refusal.message}`);
};

/** What a step can read and note while a path takes it. */
interface StepContext {
  /** Fixture part ids to the ids this path's placements claimed. */
  readonly ids: IdMap;
  /** Notes what the step did besides the build, compared across paths as the bytes are. */
  observe(line: string): void;
}

/** The selection, as one observed line. */
const selectionLine = (selection: Selection | null): string => {
  if (!selection) return 'selection: none';
  return `selection: ${selection.kind} ${selection.kind === 'part' ? selection.partId : selection.kind === 'wire' ? selection.wireId : selection.propId}`;
};

/** A switch flip's control, as one observed line, its fields in one order whoever made it. */
const controlLine = (input: ControlInput): string => `control: ${JSON.stringify({ partId: input.partId, kind: input.kind, closed: input.closed })}`;

/**
 * Loads the plan's start and takes each step with `take`, checking after each that the build changed (or, for a
 * refused drop and a step that changes only the view, the selection or the Run, that it did not) and noting the id
 * each placement claimed. Undo and Reset arena are the Run bar's buttons, the same on every path, so they are taken
 * here: Undo loads the build before the last `edit`, as the app's history does (packages/app/src/run-bar/history.ts),
 * so a path whose gesture made two edits where the reference made one gives other bytes after it.
 */
const buildWith = async (
  bench: Bench,
  plan: BuildPlan,
  steps: readonly Step[],
  signal: AbortSignal | undefined,
  take: (step: Step, context: StepContext) => Promise<void>,
): Promise<PathBuild> => {
  const { handle } = bench;
  handle.cancelPlacement();
  if (handle.mode !== 'build') handle.setMode('build');
  const loaded = handle.load(plan.start);
  if (!loaded.ok) return { ok: false, step: -1, reason: `the start did not load: ${loaded.issues.map((issue) => issue.code).join(', ')}` };
  handle.select(null);
  const ids = new Map<PlacedPartId, PlacedPartId>();
  const observed: string[] = [];
  const past: Blueprint[] = [];
  let now = handle.blueprint;
  const off = handle.on('edit', (event) => {
    if (now) past.push(now);
    now = event.blueprint;
  });
  const context: StepContext = { ids, observe: (line) => observed.push(line) };
  try {
    for (const [index, step] of steps.entries()) {
      if (signal?.aborted) return { ok: false, step: index, reason: 'stopped: the test timed out or was cancelled' };
      const before = handle.blueprint;
      const beforeBytes = bytesOf(before);
      try {
        if (step.kind === 'undo') {
          const previous = past.pop();
          if (!previous) throw new Error('there is nothing to undo');
          const result = handle.load(previous);
          if (!result.ok) throw new Error(`the build before did not load: ${result.issues.map((issue) => issue.code).join(', ')}`);
          now = handle.blueprint;
        } else if (step.kind === 'reset-arena') {
          if (!before) throw new Error('no build is loaded');
          accepted(handle.apply({ kind: 'set-arena', arena: { preset: before.arena.preset, props: [] } }));
        } else {
          await take(step, context);
        }
      } catch (error) {
        return { ok: false, step: index, reason: error instanceof Error ? error.message : String(error) };
      }
      const after = handle.blueprint;
      const changed = bytesOf(after) !== beforeBytes;
      if (KEEPS_BUILD.has(step.kind)) {
        if (changed) return { ok: false, step: index, reason: 'the build changed' };
        continue;
      }
      if (!changed || !after) return { ok: false, step: index, reason: 'the build did not change' };
      if (step.kind === 'place') {
        const known = new Set(before?.parts.map((part) => part.id));
        const added = after.parts.filter((part) => !known.has(part.id));
        const [only] = added;
        if (!only || added.length > 1) return { ok: false, step: index, reason: `${added.length} parts were added, not one` };
        ids.set(step.ref, only.id);
      }
    }
  } finally {
    off();
  }
  const built = handle.blueprint;
  return built ? { ok: true, blueprint: built, observed } : { ok: false, step: steps.length, reason: 'the canvas holds no build' };
};

// ---------------------------------------------------------------------------------------------------------
// What every path reads from the build to aim an edit: the same targets, so only the hands differ.

const buildOf = (bench: Bench): Blueprint => {
  const build = bench.handle.blueprint;
  if (!build) throw new Error('No build is loaded.');
  return build;
};

/** The command a list action carries: what a path aims at where the canvas's own rules pick the spot. */
const listCommand = (bench: Bench, subject: ListSubject, id: string): EditCommand => {
  const action = bench.handle.listView.actionsFor(subject).find((candidate) => candidate.id === id);
  if (!action || action.does.kind !== 'edit') throw new Error(`the list view offers no '${id}'`);
  return action.does.command;
};

/** Where `Move X to a free spot` puts a part: the free spot every path aims at. */
const moveSpot = (bench: Bench, partId: PlacedPartId): Vec2 => {
  const command = listCommand(bench, { kind: 'part', partId }, `move:${partId}:free`);
  if (command.kind !== 'move-part') throw new Error(`the list view moves ${partId} with ${command.kind}`);
  return command.position;
};

/** One of the child's props, by its place among them in id order. */
const childProp = (bench: Bench, index: number): Prop => {
  const prop = [...buildOf(bench).arena.props].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[index];
  if (!prop) throw new Error(`the arena has no prop ${index + 1} of the child's`);
  return prop;
};

/** Where `Move the box to a free spot` puts a prop, in arena millimetres. */
const propMoveSpot = (bench: Bench, propId: string): Vec2 => {
  const command = listCommand(bench, { kind: 'prop', propId }, `move-prop:${propId}:free`);
  if (command.kind !== 'move-prop') throw new Error(`the list view moves ${propId} with ${command.kind}`);
  return command.at;
};

/** Where a prop from the arena strip lands with no spot named (the list view's): a dry run of the canvas's own `applyEdit`. */
const propLandSpot = (bench: Bench, catalogue: Catalogue, prop: PropTemplate): Vec2 => {
  const build = buildOf(bench);
  const result = applyEdit(build, { kind: 'place-prop', prop }, catalogue);
  if (!result.ok) throw new Error(`No free spot on the floor: ${result.refusal.code}.`);
  const known = new Set(build.arena.props.map((each) => each.id));
  const added = result.blueprint.arena.props.find((each) => !known.has(each.id));
  if (!added) throw new Error('The dry run placed no prop.');
  return added.at;
};

/**
 * An arena point (mm, y up) on the canvas (mm, y down): the arena laid so that its start pose falls on the robot's
 * root, as the canvas lays it (packages/canvas/src/scene/arena.ts, `layArena`).
 */
const canvasOfArena = (build: Blueprint, catalogue: Catalogue, at: Vec2): Vec2 => {
  const preset = catalogue.arenas?.get(build.arena.preset);
  if (!preset) throw new Error(`No arena preset '${build.arena.preset}'.`);
  const rootId = robotRoot(placeParts(build, catalogue));
  const part = build.parts.find((candidate) => candidate.id === rootId);
  const root = part ? { x: part.position.x, y: part.position.y, rotation: part.rotation } : { x: 0, y: 0, rotation: 0 };
  const [c, s] = cosSin(root.rotation);
  const [ch, sh] = cosSin(preset.start.heading);
  const a = c * ch - s * sh;
  const cc = c * sh + s * ch;
  const b = s * ch + c * sh;
  const d = s * sh - c * ch;
  const tx = root.x - a * preset.start.x - cc * preset.start.y;
  const ty = root.y - b * preset.start.x - d * preset.start.y;
  return { x: a * at.x + cc * at.y + tx, y: b * at.x + d * at.y + ty };
};

/** The line a disconnect step names, by its id now. */
const stepLine = (bench: Bench, ids: IdMap, step: { readonly from: PortRef; readonly to: PortRef }): WireId =>
  wireBetween(bench, mapPort(ids, step.from), mapPort(ids, step.to));

/** The wire joining two ports now, in either order. */
const wireBetween = (bench: Bench, from: PortRef, to: PortRef): WireId => {
  const same = (a: PortRef, b: PortRef): boolean => a.part === b.part && a.port === b.port;
  const wire = buildOf(bench).wires.find((each) => (same(each.from, from) && same(each.to, to)) || (same(each.from, to) && same(each.to, from)));
  if (!wire) throw new Error(`no wire joins ${portKey(from)} and ${portKey(to)}`);
  return wire.id;
};

// ---------------------------------------------------------------------------------------------------------
// Where a hand presses: a point that reaches what it means, by the canvas's own order of what lies on top
// (packages/canvas/src/scene/hit.ts): a socket, then a wire, then the topmost part.

/** Half a socket (44 px at 2.5 px per mm, packages/canvas/src/scene/units.ts) and 1 mm to spare. */
const SOCKET_REACH_MM = 44 / 2.5 / 2 + 1;
/** Half a wire's hit area (24 px) and 1 mm to spare. */
const WIRE_REACH_MM = 24 / 2.5 / 2 + 1;

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const toSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
};

const toPath = (p: Vec2, path: readonly Vec2[]): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (let k = 1; k < path.length; k++) nearest = Math.min(nearest, toSegment(p, path[k - 1] as Vec2, path[k] as Vec2));
  return nearest;
};

/** Whether a point lies inside a convex outline (a tile's corners, in order). */
const inside = (corners: readonly Vec2[], p: Vec2): boolean => {
  let sign = 0;
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k] as Vec2;
    const b = corners[(k + 1) % corners.length] as Vec2;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
};

/** Points across a tile, nearest its middle first. */
const acrossTile = (corners: readonly Vec2[]): Vec2[] => {
  const [c0, c1, , c3] = corners as [Vec2, Vec2, Vec2, Vec2];
  const points: { readonly at: Vec2; readonly off: number }[] = [];
  for (let i = 2; i <= 18; i++) {
    for (let j = 2; j <= 18; j++) {
      const s = i / 20;
      const t = j / 20;
      points.push({ at: { x: c0.x + s * (c1.x - c0.x) + t * (c3.x - c0.x), y: c0.y + s * (c1.y - c0.y) + t * (c3.y - c0.y) }, off: (s - 0.5) ** 2 + (t - 0.5) ** 2 });
    }
  }
  return points.sort((a, b) => a.off - b.off).map((point) => point.at);
};

/** Every power and signal line as drawn now (along its route once tidied), by id. */
const linesNow = (bench: Bench): Map<string, Vec2[]> =>
  new Map(bench.hooks.scene.wires.map((line) => [line.id, bench.probe.wire(line.id)?.path.map((place) => place.world) ?? [line.from.at, line.to.at]]));

const socketsNow = (bench: Bench): Vec2[] => bench.hooks.scene.parts.flatMap((tile) => tile.ports.filter((port) => port.layer === 'ports').map((port) => port.at));

/** A point on a part where a press reaches the part itself: no socket or line within reach, no part drawn over it. */
const onPart = (bench: Bench, partId: PlacedPartId): Vec2 => {
  const tiles = bench.hooks.scene.parts;
  const tile = tiles.find((candidate) => candidate.id === partId);
  if (!tile) throw new Error(`The canvas shows no part ${partId}.`);
  const sockets = socketsNow(bench);
  const lines = [...linesNow(bench).values()];
  const point = acrossTile(tile.corners).find(
    (p) =>
      [...tiles].reverse().find((other) => inside(other.corners, p))?.id === partId &&
      sockets.every((socket) => distance(socket, p) > SOCKET_REACH_MM) &&
      lines.every((line) => toPath(p, line) > WIRE_REACH_MM),
  );
  if (!point) throw new Error(`no point on ${partId} is clear of sockets, lines and other parts`);
  return point;
};

/**
 * A point on a power or signal line where a press reaches that line: no socket within reach, and no line drawn over it
 * (later in draw order, which a press reaches first) within reach. Lines drawn under it may come near: it wins there.
 */
const onLine = (bench: Bench, wireId: WireId): Vec2 => {
  const lines = linesNow(bench);
  const path = lines.get(wireId);
  if (!path) throw new Error(`The canvas shows no line ${wireId}.`);
  const order = bench.hooks.scene.wires.map((line) => line.id);
  const others = order.slice(order.indexOf(wireId) + 1).map((id) => lines.get(id) ?? []);
  const sockets = socketsNow(bench);
  const lengths = path.slice(1).map((point, k) => distance(path[k] as Vec2, point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const along = (fraction: number): Vec2 => {
    let left = total * fraction;
    for (const [k, length] of lengths.entries()) {
      const a = path[k] as Vec2;
      const b = path[k + 1] as Vec2;
      if (left <= length) {
        const t = length === 0 ? 0 : left / length;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      left -= length;
    }
    return path[path.length - 1] as Vec2;
  };
  // Halfway first, then out towards both ends in steps of 1% of the line.
  for (let step = 0; step <= 96; step++) {
    const fraction = 0.5 + (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.01;
    const p = along(fraction);
    if (sockets.every((socket) => distance(socket, p) > SOCKET_REACH_MM) && others.every((line) => toPath(p, line) > WIRE_REACH_MM)) return p;
  }
  throw new Error(`no point on ${wireId} is clear of sockets and of the lines drawn over it`);
};

/** Empty workbench beside the build, clear of every part, socket and line: where a tap clears the selection. */
const emptyBeside = (bench: Bench): Vec2 => {
  const corners = bench.hooks.scene.parts.flatMap((tile) => tile.corners);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { x: Math.max(...xs) + 40, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

/** Where a handle beside the selection sits now, once the tap that shows it has drawn it. */
const handleAt = async (bench: Bench, kind: 'move' | 'rotate' | 'bin'): Promise<Vec2> => {
  await until(() => bench.probe.handles().has(kind), `no ${kind} handle`);
  return (bench.probe.handles().get(kind) as { readonly world: Vec2 }).world;
};

/** Whether a canvas point (mm) shows on the canvas at the current view. */
const inView = (bench: Bench, world: Vec2): boolean => {
  const at = pageOf(bench, world);
  const box = bench.hooks.canvas.getBoundingClientRect();
  return at.x > box.left && at.x < box.right && at.y > box.top && at.y < box.bottom;
};

/**
 * Where a handle sits once the view shows it with `points`: framed as close as `showPoints` allows, a part's handles
 * can fall beside the view (a wheel's tile at 400%), where a child would zoom out to reach them, as this does.
 */
const handleInView = async (bench: Bench, kind: 'move' | 'rotate' | 'bin', points: readonly Vec2[]): Promise<Vec2> => {
  const first = await handleAt(bench, kind);
  if (inView(bench, first)) return first;
  showPoints(bench, [...points, first], 96, 4);
  await until(() => {
    const handle = bench.probe.handles().get(kind);
    return handle !== undefined && inView(bench, handle.world);
  }, `the ${kind} handle stays outside the view`);
  return handleAt(bench, kind);
};

/** Where a part's port sits relative to its frame origin while the part rides under a finger: turned 0, not mirrored. */
const portOffset = (catalogue: Catalogue, part: PartTypeId, port: PortId): Vec2 => {
  const spec = catalogue.parts.get(part)?.ports.find((candidate) => candidate.id === port);
  if (!spec || spec.type !== 'mechanical') throw new Error(`The ${part} has no mechanical port ${port}.`);
  const at = canvasPoseOf({ x: 0, y: 0, rotation: 0 }, { x: spec.at.x, y: spec.at.y, z: spec.at.z, yaw: 0, mirrored: false });
  return { x: at.x, y: at.y };
};

/** The free spot a loose part takes: where a placement that names no spot lands, by the canvas's own rule (a dry run). */
const freeSpotFor = (bench: Bench, catalogue: Catalogue, part: PartTypeId): Vec2 => {
  const build = buildOf(bench);
  const result = applyEdit(build, { kind: 'place-part', part }, catalogue);
  if (!result.ok) throw new Error(`No free spot: ${result.refusal.code}.`);
  const known = new Set(build.parts.map((placed) => placed.id));
  const added = result.blueprint.parts.find((placed) => !known.has(placed.id));
  if (!added) throw new Error('The dry run placed nothing.');
  return added.position;
};

/** Waits until `ready` holds, checking every 10 ms for up to `timeout` ms; throws `what` otherwise. */
const until = async (ready: () => boolean, what: string, timeout = 5_000): Promise<void> => {
  await vi.waitFor(
    () => {
      if (!ready()) throw new Error(what);
    },
    { timeout, interval: 10 },
  );
};

/** Waits for the step's edit to land: the build's bytes changed. */
const landed = (bench: Bench, before: string, what: string): Promise<void> => until(() => bytesOf(bench.handle.blueprint) !== before, what);

/**
 * Starts a Run of the build as the app's run loop does (task 4.4): Run mode, then the Simulation's tick 0 frame, held
 * there so nothing moves; takes `act` with that frame and every `control` the canvas fires meanwhile; and stops,
 * which gives the build back exactly as it was (ground rule 4).
 */
const inRun = async (bench: Bench, catalogue: Catalogue, act: (frame: RunFrame) => Promise<void>): Promise<readonly ControlInput[]> => {
  const { handle } = bench;
  const build = buildOf(bench);
  const arena = catalogue.arenas?.get(build.arena.preset);
  if (!arena) throw new Error(`No arena preset '${build.arena.preset}'.`);
  const simulation = await createSimulation({ blueprint: build, catalogue, arena, seed: 1 });
  const controls: ControlInput[] = [];
  const off = handle.on('control', (event) => controls.push(event.input));
  handle.setMode('run');
  try {
    handle.applyRunFrame(simulation.frame);
    await frames(2);
    await act(simulation.frame);
    await frames(1);
  } finally {
    off();
    handle.setMode('build');
  }
  return controls;
};

/** In Run mode, a point on a part where a tap reaches it: no part drawn over it where the Run draws them. */
const onPartInRun = (bench: Bench, partId: PlacedPartId): Vec2 => {
  const outlines = bench.hooks.scene.parts.map((tile) => ({ id: tile.id, corners: bench.probe.part(tile.id)?.corners.map((place) => place.world) ?? [] }));
  const own = outlines.find((outline) => outline.id === partId);
  if (!own || own.corners.length < 4) throw new Error(`The Run draws no part ${partId}.`);
  const point = acrossTile(own.corners).find((p) => [...outlines].reverse().find((other) => other.corners.length >= 4 && inside(other.corners, p))?.id === partId);
  if (!point) throw new Error(`no point on ${partId} is clear of other parts in Run mode`);
  return point;
};

// ---------------------------------------------------------------------------------------------------------
// The paths

/** The plain-commands path: every step through the handle's `apply`, as the app, the spec card and the hint ladder send it. */
export const commandsPath = (bench: Bench, catalogue: Catalogue, can: Readonly<Record<StepKind, Capability>>): InputPath => ({
  name: 'commands',
  family: 'commands',
  can,
  build: (plan, steps, signal) =>
    buildWith(bench, plan, steps, signal, async (step, { ids, observe }) => {
      const { handle } = bench;
      if (isBuildStep(step)) {
        const result = handle.apply(commandFor(step, ids));
        if (step.kind !== 'refuse') return accepted(result);
        if (result.ok) throw new Error('apply accepted it');
        if (result.refusal.code !== step.code) throw new Error(`refused as ${result.refusal.code}, not ${step.code}`);
        return;
      }
      switch (step.kind) {
        case 'move': {
          const partId = mapPart(ids, step.ref);
          return accepted(handle.apply({ kind: 'move-part', partId, position: moveSpot(bench, partId) }));
        }
        case 'turn': {
          const partId = mapPart(ids, step.ref);
          const part = buildOf(bench).parts.find((candidate) => candidate.id === partId);
          return accepted(handle.apply({ kind: 'rotate-part', partId, rotation: ((part?.rotation ?? 0) + 90) % 360 }));
        }
        case 'remove':
          return accepted(handle.apply({ kind: 'remove-part', partId: mapPart(ids, step.ref) }));
        case 'disconnect':
          return accepted(handle.apply({ kind: 'disconnect', wireId: stepLine(bench, ids, step) }));
        case 'place-prop':
          return accepted(handle.apply({ kind: 'place-prop', prop: step.prop }));
        case 'move-prop': {
          const prop = childProp(bench, step.index);
          return accepted(handle.apply({ kind: 'move-prop', propId: prop.id, at: { ...propMoveSpot(bench, prop.id), heading: prop.at.heading } }));
        }
        case 'remove-prop':
          return accepted(handle.apply({ kind: 'remove-prop', propId: childProp(bench, step.index).id }));
        case 'tidy':
          await settle(bench);
          accepted(handle.apply({ kind: 'tidy-wires' }));
          return observeRoutes(bench, observe);
        case 'clear-selection':
          handle.select({ kind: 'part', partId: mapPart(ids, step.ref) });
          observe(selectionLine(handle.selection));
          handle.select(null);
          observe(selectionLine(handle.selection));
          return;
        case 'flip': {
          const partId = mapPart(ids, step.ref);
          let closed: boolean | undefined;
          await inRun(bench, catalogue, async (frame) => {
            closed = frame.live.get(partId)?.values.closed;
          });
          if (closed === undefined) throw new Error(`the Run reads no switch state for ${partId}`);
          observe(controlLine({ partId, kind: 'switch', closed: !closed }));
          return;
        }
        case 'reset-arena':
        case 'undo':
          return;
      }
    }),
});

/**
 * The routes every power and signal line is drawn along now, once the tidy has been drawn. Routes go round each part's
 * picture as drawn, so every path tidies only once the pictures have loaded (`settle`), as a child sees them.
 */
const observeRoutes = async (bench: Bench, observe: (line: string) => void): Promise<void> => {
  await frames(2);
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  for (const [id, path] of [...linesNow(bench)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    observe(`route ${id}: ${path.map((point) => `${round(point.x)},${round(point.y)}`).join(' ')}`);
  }
};

export interface GestureStyle {
  readonly hand: Hand;
  /** A drag from the tray and from socket to socket, or tap-then-tap (click-click with a mouse). */
  readonly how: 'drag' | 'tap';
}

export const gestureName = ({ hand, how }: GestureStyle): string =>
  `${hand === 'touch' ? 'touch' : 'pointer'} ${how === 'drag' ? 'drag' : hand === 'touch' ? 'tap-then-tap' : 'click-click'}`;

/**
 * A touch or pointer path. A part comes from the tray: dragged in, let go where its mount or hub sits on its
 * target (or its frame origin on the free spot), or offered by a tap on the tray (the app's `beginPlacement` with no
 * pointer) and placed by a tap on its target. A wire is drawn from socket to socket by a drag, or by a tap on each.
 * A setting goes through `apply`, as the spec card sends it on every path. The edits after the build go by hand too:
 * by a drag (a part or prop dragged to its spot, or to the tray to remove it; a wire dragged to the tray; the rotate
 * handle dragged a quarter turn round its part), or by taps (the part, wire or prop, then its Move, rotate or bin
 * handle, then the spot). Tidy wires is the app's button. Before each gesture the view is moved, as a hand pans and
 * zooms, to show its points.
 */
export const gesturePath = (bench: Bench, catalogue: Catalogue, style: GestureStyle, can: Readonly<Record<StepKind, Capability>>): InputPath => {
  const { handle } = bench;
  const { hand, how } = style;
  const page = (world: Vec2): Vec2 => pageOf(bench, world);
  const tray = (): Vec2 => middleOf(bench.tray);

  const place = async (step: PlaceStep, ids: IdMap): Promise<void> => {
    const target = step.attach ? socketAt(bench, portKey(mapPort(ids, step.attach.onto))) : freeSpotFor(bench, catalogue, step.part);
    const offset = step.attach && how === 'drag' ? portOffset(catalogue, step.part, step.attach.port) : { x: 0, y: 0 };
    const release = { x: target.x - offset.x, y: target.y - offset.y };
    showPoints(bench, [target, release]);
    // Anything still waiting ends here, before this step listens for its own placement.
    handle.cancelPlacement();
    const placements: PlacementEvent[] = [];
    const off = handle.on('placement', (event) => placements.push(event));
    try {
      if (how === 'tap') {
        handle.beginPlacement(step.part);
        await tap(hand, page(release));
      } else {
        bench.offer(step.part);
        await drag(hand, tray(), page(release));
        const [error] = bench.trayErrors();
        if (error !== undefined) throw error;
      }
      await until(() => placements.length > 0, `no placement after the ${how === 'tap' ? (hand === 'touch' ? 'tap' : 'click') : 'drop'}`);
    } catch (error) {
      handle.cancelPlacement();
      throw error;
    } finally {
      bench.offer(undefined);
      off();
    }
    if (!placements[0]?.placed) throw new Error('the part did not land');
  };

  /**
   * A wire from socket to socket. Where a press cannot tell overlapping sockets apart, the canvas fans their crowd
   * out instead (task 3.3), and the hand goes on to the socket it meant, where it went: for the source, after the
   * press that fanned it; for the target, once the tap or the wire's end has fanned it.
   */
  const wire = async (from: PortRef, to: PortRef, ids: IdMap, lands: boolean): Promise<void> => {
    const source = portKey(mapPort(ids, from));
    const target = portKey(mapPort(ids, to));
    showPoints(bench, [socketAt(bench, source), socketAt(bench, target)]);
    const before = bytesOf(handle.blueprint);
    const at = (key: string): Vec2 => page(pressPlaceOf(bench, key));
    const sourceFanned = fannedOut(bench, source);
    if (how === 'tap') {
      await tap(hand, at(source));
      if (!sourceFanned && fannedOut(bench, source)) await tap(hand, at(source));
      const targetFanned = fannedOut(bench, target);
      await tap(hand, at(target));
      if (bytesOf(handle.blueprint) === before && !targetFanned && fannedOut(bench, target)) await tap(hand, at(target));
    } else {
      await holding(async () => {
        let start = at(source);
        await press(hand, start);
        if (!sourceFanned && fannedOut(bench, source)) {
          await lift(hand, start);
          start = at(source);
          await press(hand, start);
        }
        let end = at(target);
        await move(hand, end);
        const there = at(target);
        if (there.x !== end.x || there.y !== end.y) {
          end = there;
          await move(hand, end);
        }
        await lift(hand, end);
      });
    }
    if (lands) await until(() => bytesOf(handle.blueprint) !== before, 'no wire after the gesture');
    else {
      await frames(2);
      // Tapped, a refused wire still waits at its source for another target: a tap on empty workbench lets it go,
      // as a child's would, before the next gesture.
      if (how === 'tap') {
        const empty = emptyBeside(bench);
        showPoints(bench, [empty]);
        await tap(hand, page(empty));
      }
    }
  };

  /** Nothing waiting and nothing selected, as after a tap on empty workbench: the next gesture starts clean. */
  const clean = (): void => {
    handle.cancelPlacement();
    handle.select(null);
  };

  /**
   * Moves a part to the spot the list view names: dragged by a point on it so its frame origin lands on the spot, or
   * tapped, its Move handle tapped, and the spot tapped. Framed as close as the canvas allows (up to 400%), as a child
   * zooms in to put a part down beside the chassis rather than on a mount point: forgiveness radii are screen pixels.
   */
  const movePart = async (partId: PlacedPartId): Promise<void> => {
    clean();
    const spot = moveSpot(bench, partId);
    const part = buildOf(bench).parts.find((candidate) => candidate.id === partId);
    if (!part) throw new Error(`no part ${partId}`);
    const grab = onPart(bench, partId);
    const before = bytesOf(handle.blueprint);
    if (how === 'drag') {
      const release = { x: spot.x + grab.x - part.position.x, y: spot.y + grab.y - part.position.y };
      showPoints(bench, [grab, release], 64, 4);
      await drag(hand, page(grab), page(release));
    } else {
      showPoints(bench, [grab, spot], 96, 4);
      await tap(hand, page(grab));
      await tap(hand, page(await handleInView(bench, 'move', [grab, spot])));
      await tap(hand, page(spot));
    }
    await landed(bench, before, `${partId} did not move`);
  };

  /** Turns a free part a quarter turn clockwise: its rotate handle tapped, or dragged a quarter turn round the part. */
  const turnPart = async (partId: PlacedPartId): Promise<void> => {
    clean();
    const tile = bench.hooks.scene.parts.find((candidate) => candidate.id === partId);
    const part = buildOf(bench).parts.find((candidate) => candidate.id === partId);
    if (!tile || !part) throw new Error(`no part ${partId}`);
    const grab = onPart(bench, partId);
    // Room round the part for its handles and for the handle's quarter turn.
    const reach = Math.max(...tile.corners.map((corner) => distance(corner, part.position))) + 40;
    const { x, y } = part.position;
    showPoints(bench, [grab, { x: x - reach, y: y - reach }, { x: x + reach, y: y + reach }], 16);
    const before = bytesOf(handle.blueprint);
    await tap(hand, page(grab));
    const rotate = await handleAt(bench, 'rotate');
    if (how === 'tap') await tap(hand, page(rotate));
    else {
      // A quarter turn clockwise on the canvas (y down): (dx, dy) to (−dy, dx) about the part's origin.
      const end = { x: x - (rotate.y - y), y: y + (rotate.x - x) };
      await drag(hand, page(rotate), page(end));
    }
    await landed(bench, before, `${partId} did not turn`);
  };

  /** Removes a part: dragged to the tray, or tapped and its bin tapped. */
  const removePart = async (partId: PlacedPartId): Promise<void> => {
    clean();
    const grab = onPart(bench, partId);
    showPoints(bench, [grab]);
    const before = bytesOf(handle.blueprint);
    if (how === 'drag') await drag(hand, page(grab), tray());
    else {
      await tap(hand, page(grab));
      await tap(hand, page(await handleAt(bench, 'bin')));
    }
    await landed(bench, before, `${partId} was not removed`);
  };

  /** Removes a power or signal line: dragged to the tray, or tapped and its bin tapped. */
  const removeLine = async (wireId: WireId): Promise<void> => {
    clean();
    const grab = onLine(bench, wireId);
    showPoints(bench, [grab]);
    const before = bytesOf(handle.blueprint);
    if (how === 'drag') await drag(hand, page(grab), tray());
    else {
      await tap(hand, page(grab));
      await tap(hand, page(await handleAt(bench, 'bin')));
    }
    await landed(bench, before, `${wireId} was not removed`);
  };

  /** Places a prop from the arena strip on the free spot on the floor: dragged there, or offered and tapped there. */
  const placeProp = async (prop: PropTemplate): Promise<void> => {
    clean();
    const target = canvasOfArena(buildOf(bench), catalogue, propLandSpot(bench, catalogue, prop));
    showPoints(bench, [target]);
    const placements: PlacementEvent[] = [];
    const off = handle.on('placement', (event) => placements.push(event));
    try {
      if (how === 'tap') {
        handle.beginPropPlacement(prop);
        await tap(hand, page(target));
      } else {
        bench.offer(prop);
        await drag(hand, tray(), page(target));
        const [error] = bench.trayErrors();
        if (error !== undefined) throw error;
      }
      await until(() => placements.length > 0, 'no placement after the gesture');
    } catch (error) {
      handle.cancelPlacement();
      throw error;
    } finally {
      bench.offer(undefined);
      off();
    }
    if (!placements[0]?.placed) throw new Error('the prop did not land');
  };

  /** Moves one of the child's props to the spot the list view names: dragged by its middle, or tapped, Move, and the spot. */
  const moveProp = async (index: number): Promise<void> => {
    clean();
    const prop = childProp(bench, index);
    const build = buildOf(bench);
    const from = canvasOfArena(build, catalogue, prop.at);
    const to = canvasOfArena(build, catalogue, propMoveSpot(bench, prop.id));
    showPoints(bench, [from, to], 96);
    const before = bytesOf(handle.blueprint);
    if (how === 'drag') await drag(hand, page(from), page(to));
    else {
      await tap(hand, page(from));
      await tap(hand, page(await handleAt(bench, 'move')));
      await tap(hand, page(to));
    }
    await landed(bench, before, `${prop.id} did not move`);
  };

  /** Removes one of the child's props: dragged to the arena strip, or tapped and its bin tapped. */
  const removeProp = async (index: number): Promise<void> => {
    clean();
    const prop = childProp(bench, index);
    const from = canvasOfArena(buildOf(bench), catalogue, prop.at);
    showPoints(bench, [from], 96);
    const before = bytesOf(handle.blueprint);
    if (how === 'drag') await drag(hand, page(from), tray());
    else {
      await tap(hand, page(from));
      await tap(hand, page(await handleAt(bench, 'bin')));
    }
    await landed(bench, before, `${prop.id} was not removed`);
  };

  /** Selects a part by a tap (or click), then clears the selection by a tap on empty workbench. */
  const clearSelection = async (partId: PlacedPartId, observe: (line: string) => void): Promise<void> => {
    clean();
    const grab = onPart(bench, partId);
    const empty = emptyBeside(bench);
    showPoints(bench, [grab, empty]);
    await tap(hand, page(grab));
    observe(selectionLine(handle.selection));
    await tap(hand, page(empty));
    observe(selectionLine(handle.selection));
  };

  /** In Run mode, taps (or clicks) a manual switch where the Run draws it. */
  const flip = async (partId: PlacedPartId, observe: (line: string) => void): Promise<void> => {
    clean();
    const controls = await inRun(bench, catalogue, async () => {
      const at = onPartInRun(bench, partId);
      showPoints(bench, [at]);
      await frames(1);
      await tap(hand, page(onPartInRun(bench, partId)));
    });
    for (const input of controls) observe(controlLine(input));
  };

  return {
    name: gestureName(style),
    family: hand === 'touch' ? 'touch' : 'pointer',
    can,
    build: (plan, steps, signal) =>
      buildWith(bench, plan, steps, signal, async (step, { ids, observe }) => {
        switch (step.kind) {
          case 'place':
            return place(step, ids);
          case 'setting':
            return accepted(handle.apply(commandFor(step, ids)));
          case 'connect':
            return wire(step.from, step.to, ids, true);
          case 'refuse':
            return wire(step.from, step.to, ids, false);
          case 'move':
            return movePart(mapPart(ids, step.ref));
          case 'turn':
            return turnPart(mapPart(ids, step.ref));
          case 'remove':
            return removePart(mapPart(ids, step.ref));
          case 'disconnect':
            return removeLine(stepLine(bench, ids, step));
          case 'place-prop':
            return placeProp(step.prop);
          case 'move-prop':
            return moveProp(step.index);
          case 'remove-prop':
            return removeProp(step.index);
          case 'tidy':
            clean();
            await settle(bench);
            handle.tidyWires();
            return observeRoutes(bench, observe);
          case 'clear-selection':
            return clearSelection(mapPart(ids, step.ref), observe);
          case 'flip':
            return flip(mapPart(ids, step.ref), observe);
          case 'reset-arena':
          case 'undo':
            return;
        }
      }),
  };
};

const samePort = (a: PortRef, b: PortRef): boolean => a.part === b.part && a.port === b.port;

/** Whether a list action does what the step's command does. A loose placement matches the free-spot action. */
const doesStep = (action: ListAction, want: EditCommand): boolean => {
  if (action.does.kind !== 'edit') return false;
  const got = action.does.command;
  if (got.kind === 'place-part' && want.kind === 'place-part') {
    if (got.part !== want.part) return false;
    if (!want.attach) return !got.attach;
    return got.attach !== undefined && got.attach.port === want.attach.port && samePort(got.attach.onto, want.attach.onto);
  }
  if (got.kind === 'set-setting' && want.kind === 'set-setting') return got.partId === want.partId && got.setting === want.setting && got.value === want.value;
  if (got.kind === 'connect' && want.kind === 'connect') {
    return (samePort(got.from, want.from) && samePort(got.to, want.to)) || (samePort(got.from, want.to) && samePort(got.to, want.from));
  }
  return false;
};

/** The list view's DOM, as a screen reader reaches it. */
const listDom = (bench: Bench): HTMLElement => {
  const found = bench.host.querySelector<HTMLElement>('.servo-list-view');
  if (!found) throw new Error('The canvas shows no list view.');
  return found;
};

const subjectKeyOf = (subject: ListSubject): string => {
  switch (subject.kind) {
    case 'part':
      return `part:${subject.partId}`;
    case 'port':
      return `port:${portKey(subject.port)}`;
    case 'wire':
      return `wire:${subject.wireId}`;
    case 'prop':
      return `prop:${subject.propId}`;
  }
};

/**
 * Does a list action through the list view's DOM, as a screen-reader user does: opens the subject's actions (its
 * `Actions` button; in Run mode they show at once), presses the action's button, and closes the subject again.
 */
const pressListAction = (bench: Bench, subject: ListSubject, actionId: string): void => {
  const list = listDom(bench);
  const key = subjectKeyOf(subject);
  const find = (selector: string): HTMLButtonElement | null => list.querySelector<HTMLButtonElement>(selector);
  const toggle = (): HTMLButtonElement | null => find(`[data-key="${CSS.escape(`toggle:${key}`)}"]`);
  if (toggle()?.getAttribute('aria-expanded') === 'false') toggle()?.click();
  const button = find(`button[data-subject="${CSS.escape(key)}"][data-action="${CSS.escape(actionId)}"]`);
  if (!button) throw new Error(`the list view shows no '${actionId}' on ${key}`);
  button.click();
  if (toggle()?.getAttribute('aria-expanded') === 'true') toggle()?.click();
};

/** Presses the list action on `subject` that does the step's command; throws when it offers none. */
const pressMatching = (bench: Bench, subject: ListSubject, want: EditCommand): void => {
  const actions = bench.handle.listView.actionsFor(subject);
  const action = actions.find((candidate) => doesStep(candidate, want));
  if (!action) throw new Error(`the list view offers no action for it (it offers: ${actions.map((candidate) => candidate.label).join('; ') || 'nothing'})`);
  pressListAction(bench, subject, action.id);
};

/**
 * The list view's path (task 3.6): each step is the list action that does it, pressed in the list view's DOM as a
 * screen-reader user presses it; a placement from the tray or the arena strip is the action the app's tray and strip
 * perform through the model (`placementsFor`, `propPlacementsFor`). A refused drop is one the list view never offers.
 */
export const listViewPath = (bench: Bench, catalogue: Catalogue, can: Readonly<Record<StepKind, Capability>>): InputPath => ({
  name: 'list view',
  family: 'list view',
  can,
  build: (plan, steps, signal) =>
    buildWith(bench, plan, steps, signal, async (step, { ids, observe }) => {
      const view = bench.handle.listView;
      const perform = (actions: readonly ListAction[], label: string): void => {
        const [action] = actions;
        if (!action) throw new Error(`the list view offers no ${label}`);
        if (!view.perform(action)) throw new Error(`performing '${action.label}' changed nothing`);
      };
      switch (step.kind) {
        case 'place': {
          const want = commandFor(step, ids);
          return perform(view.placementsFor(step.part).filter((candidate) => doesStep(candidate, want)), `placement for ${step.part}`);
        }
        case 'setting':
          return pressMatching(bench, { kind: 'part', partId: mapPart(ids, step.ref) }, commandFor(step, ids));
        case 'connect': {
          const want = commandFor(step, ids);
          if (want.kind !== 'connect') return;
          return pressMatching(bench, { kind: 'port', port: want.from }, want);
        }
        case 'refuse': {
          const want = commandFor(step, ids);
          if (want.kind !== 'connect') return;
          const offered = [want.from, want.to].flatMap((port) => view.actionsFor({ kind: 'port', port })).filter((action) => doesStep(action, want));
          if (offered.length > 0) throw new Error(`the list view offers it: ${offered.map((action) => action.label).join('; ')}`);
          return;
        }
        case 'move': {
          const partId = mapPart(ids, step.ref);
          return pressListAction(bench, { kind: 'part', partId }, `move:${partId}:free`);
        }
        case 'turn': {
          const partId = mapPart(ids, step.ref);
          return pressListAction(bench, { kind: 'part', partId }, `turn:${partId}:clockwise`);
        }
        case 'remove': {
          const partId = mapPart(ids, step.ref);
          return pressListAction(bench, { kind: 'part', partId }, `remove:${partId}`);
        }
        case 'disconnect': {
          const wireId = stepLine(bench, ids, step);
          return pressListAction(bench, { kind: 'wire', wireId }, `disconnect:${wireId}`);
        }
        case 'place-prop':
          return perform(view.propPlacementsFor(step.prop), `place for a ${step.prop.shape}`);
        case 'move-prop': {
          const { id } = childProp(bench, step.index);
          return pressListAction(bench, { kind: 'prop', propId: id }, `move-prop:${id}:free`);
        }
        case 'remove-prop': {
          const { id } = childProp(bench, step.index);
          return pressListAction(bench, { kind: 'prop', propId: id }, `remove-prop:${id}`);
        }
        case 'tidy': {
          const line = view.wires.find((each) => each.kind === 'power' || each.kind === 'signal');
          if (!line) throw new Error('the list view lists no power or signal line to tidy from');
          await settle(bench);
          pressListAction(bench, { kind: 'wire', wireId: line.wireId }, `tidy-wires:${line.wireId}`);
          return observeRoutes(bench, observe);
        }
        case 'clear-selection': {
          const partId = mapPart(ids, step.ref);
          bench.handle.select(null);
          pressListAction(bench, { kind: 'part', partId }, `select:part:${partId}`);
          observe(selectionLine(bench.handle.selection));
          pressListAction(bench, { kind: 'part', partId }, 'clear-selection');
          observe(selectionLine(bench.handle.selection));
          return;
        }
        case 'flip': {
          const partId = mapPart(ids, step.ref);
          const controls = await inRun(bench, catalogue, async () => {
            pressListAction(bench, { kind: 'part', partId }, `flip:${partId}`);
          });
          for (const input of controls) observe(controlLine(input));
          return;
        }
        case 'reset-arena':
        case 'undo':
          return;
      }
    }),
});

/** A fixture build the probes try commands on: it must have a wire, and ideally a part with a setting. */
export interface Probe {
  readonly start: Blueprint;
  readonly built: Blueprint;
}

const probeSetting = (catalogue: Catalogue, built: Blueprint): EditCommand | undefined => {
  for (const part of built.parts) {
    const setting = catalogue.parts.get(part.part)?.settings[0];
    if (setting) return { kind: 'set-setting', partId: part.id, setting: setting.id };
  }
  return undefined;
};

/**
 * Finds what each path can do on this canvas build by trying one member per kind of step on `probe`, and returns
 * the paths: commands (the reference), touch and pointer by drag and by tap, and the list view. Gestures draw wires
 * through the same command layer task 3.3 builds with the sockets, so a wire waits on a path while `connect` does.
 * Every edit after the build waits on a path as placing does there: the command layer, the hands and the list view
 * that place a part are the ones that move, turn and remove it.
 */
export const discoverPaths = (bench: Bench, catalogue: Catalogue, probe: Probe): { readonly reference: InputPath; readonly others: readonly InputPath[] } => {
  const { handle } = bench;
  const [first] = probe.built.parts;
  const [wire] = probe.built.wires;
  if (!first || !wire) throw new Error('The probe build needs a part and a wire.');
  const onStart = (member: () => unknown) => (): unknown => {
    handle.load(probe.start);
    return member();
  };
  const onBuilt = (member: () => unknown) => (): unknown => {
    handle.load(probe.built);
    return member();
  };
  const setting = probeSetting(catalogue, probe.built);
  const edits = (family: 'commands' | 'touch' | 'pointer' | 'list view', place: Capability): Record<StepKind, Capability> =>
    Object.fromEntries(EDIT_KINDS.map((kind) => [kind, waitingLike(place, family, kind)])) as Record<StepKind, Capability>;
  const place = attempt('commands', 'place', onStart(() => handle.apply({ kind: 'place-part', part: first.part })));
  const commands: Record<StepKind, Capability> = {
    ...edits('commands', place),
    place,
    setting: setting ? attempt('commands', 'setting', onBuilt(() => handle.apply(setting))) : READY,
    connect: attempt('commands', 'connect', onBuilt(() => handle.apply({ kind: 'connect', from: wire.from, to: wire.to }))),
    refuse: attempt('commands', 'refuse', onBuilt(() => handle.apply({ kind: 'connect', from: wire.from, to: wire.to }))),
  };
  if (!setting) commands.setting = commands.place;
  const gestures = (family: 'touch' | 'pointer'): Record<StepKind, Capability> => {
    const placing = attempt(
      family,
      'place',
      onStart(() => {
        handle.beginPlacement(first.part);
        handle.cancelPlacement();
      }),
    );
    return {
      ...edits(family, placing),
      place: placing,
      setting: commands.setting,
      connect: waitingLike(commands.connect, family, 'connect'),
      refuse: waitingLike(commands.refuse, family, 'refuse'),
    };
  };
  const listView = attempt('list view', 'place', () => handle.listView);
  const list = Object.fromEntries(STEP_KINDS.map((kind) => [kind, waitingLike(listView, 'list view', kind)])) as Record<StepKind, Capability>;
  handle.load(probe.start);
  const touch = gestures('touch');
  const pointer = gestures('pointer');
  return {
    reference: commandsPath(bench, catalogue, commands),
    others: [
      gesturePath(bench, catalogue, { hand: 'touch', how: 'drag' }, touch),
      gesturePath(bench, catalogue, { hand: 'touch', how: 'tap' }, touch),
      gesturePath(bench, catalogue, { hand: 'mouse', how: 'drag' }, pointer),
      gesturePath(bench, catalogue, { hand: 'mouse', how: 'tap' }, pointer),
      listViewPath(bench, catalogue, list),
    ],
  };
};

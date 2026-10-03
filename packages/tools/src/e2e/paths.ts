// The input paths the parity check compares (ground rule 8), each building on the same bench: touch and pointer by
// real input through CDP, the list view through its model, and plain commands through the handle's `apply`, the
// reference until the list view exists (task 3.6). Each path finds out what it can do by trying it: a member a later
// task builds throws an error naming that task, and the step waits for it. Runs in the browser. See README.md.
import { vi } from 'vitest';
import { applyEdit } from '@servo/canvas';
import type { EditCommand, EditResult, ListAction, PlacementEvent } from '@servo/canvas';
import { canvasPoseOf, serializeBlueprint } from '@servo/schema';
import type { Blueprint, Catalogue, PartTypeId, PlacedPartId, PortId, PortRef, Vec2 } from '@servo/schema';
import { fannedOut, frames, middleOf, pageOf, pressPlaceOf, showPoints, socketAt } from './bench.ts';
import type { Bench } from './bench.ts';
import { drag, holding, lift, move, press, tap } from './input.ts';
import type { Hand } from './input.ts';
import { READY, attempt, waitingLike } from './parity.ts';
import type { Capability, InputPath, PathBuild } from './parity.ts';
import { STEP_KINDS, commandFor, mapPart, mapPort } from './plan.ts';
import type { BuildPlan, IdMap, PlaceStep, Step, StepKind } from './plan.ts';

const bytesOf = (blueprint: Blueprint | undefined): string => (blueprint ? serializeBlueprint(blueprint) : '');

const portKey = (ref: PortRef): string => `${ref.part}.${ref.port}`;

/** The step's command must have been accepted. */
const accepted = (result: EditResult): void => {
  if (!result.ok) throw new Error(`refused as ${result.refusal.code}: ${result.refusal.message}`);
};

/**
 * Loads the plan's start and takes each step with `take`, checking after each that the build changed (or, for a
 * refused drop, that it did not) and noting the id each placement claimed.
 */
const buildWith = async (
  bench: Bench,
  plan: BuildPlan,
  steps: readonly Step[],
  signal: AbortSignal | undefined,
  take: (step: Step, ids: IdMap) => Promise<void>,
): Promise<PathBuild> => {
  const { handle } = bench;
  const loaded = handle.load(plan.start);
  if (!loaded.ok) return { ok: false, step: -1, reason: `the start did not load: ${loaded.issues.map((issue) => issue.code).join(', ')}` };
  const ids = new Map<PlacedPartId, PlacedPartId>();
  for (const [index, step] of steps.entries()) {
    if (signal?.aborted) return { ok: false, step: index, reason: 'stopped: the test timed out or was cancelled' };
    const before = handle.blueprint;
    const beforeBytes = bytesOf(before);
    try {
      await take(step, ids);
    } catch (error) {
      return { ok: false, step: index, reason: error instanceof Error ? error.message : String(error) };
    }
    const after = handle.blueprint;
    const changed = bytesOf(after) !== beforeBytes;
    if (step.kind === 'refuse') {
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
  const built = handle.blueprint;
  return built ? { ok: true, blueprint: built } : { ok: false, step: steps.length, reason: 'the canvas holds no build' };
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
  const build = bench.handle.blueprint;
  if (!build) throw new Error('No build is loaded.');
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

/** The plain-commands path: every step through the handle's `apply`, as the app, the spec card and the hint ladder send it. */
export const commandsPath = (bench: Bench, can: Readonly<Record<StepKind, Capability>>): InputPath => ({
  name: 'commands',
  family: 'commands',
  can,
  build: (plan, steps, signal) =>
    buildWith(bench, plan, steps, signal, async (step, ids) => {
      const result = bench.handle.apply(commandFor(step, ids));
      if (step.kind !== 'refuse') return accepted(result);
      if (result.ok) throw new Error('apply accepted it');
      if (result.refusal.code !== step.code) throw new Error(`refused as ${result.refusal.code}, not ${step.code}`);
    }),
});

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
 * A setting goes through `apply`, as the spec card sends it on every path. Before each gesture the view is moved,
 * as a hand pans and zooms, to show its points at the default zoom where they fit.
 */
export const gesturePath = (bench: Bench, catalogue: Catalogue, style: GestureStyle, can: Readonly<Record<StepKind, Capability>>): InputPath => {
  const { handle } = bench;
  const { hand, how } = style;

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
        await tap(hand, pageOf(bench, release));
      } else {
        bench.offer(step.part);
        await drag(hand, middleOf(bench.tray), pageOf(bench, release));
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
    const at = (key: string): Vec2 => pageOf(bench, pressPlaceOf(bench, key));
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
    else await frames(2);
  };

  return {
    name: gestureName(style),
    family: hand === 'touch' ? 'touch' : 'pointer',
    can,
    build: (plan, steps, signal) =>
      buildWith(bench, plan, steps, signal, async (step, ids) => {
        switch (step.kind) {
          case 'place':
            return place(step, ids);
          case 'setting':
            return accepted(handle.apply(commandFor(step, ids)));
          case 'connect':
            return wire(step.from, step.to, ids, true);
          case 'refuse':
            return wire(step.from, step.to, ids, false);
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

/**
 * The list view's path (task 3.6): each step is the list action that does it, through `perform`, as a screen-reader
 * user picks it from the list. A refused drop is one the list view never offers.
 */
export const listViewPath = (bench: Bench, can: Readonly<Record<StepKind, Capability>>): InputPath => ({
  name: 'list view',
  family: 'list view',
  can,
  build: (plan, steps, signal) =>
    buildWith(bench, plan, steps, signal, async (step, ids) => {
      const view = bench.handle.listView;
      const want = commandFor(step, ids);
      if (step.kind === 'refuse' && want.kind === 'connect') {
        const offered = [want.from, want.to].flatMap((port) => view.actionsFor({ kind: 'port', port })).filter((action) => doesStep(action, want));
        if (offered.length > 0) throw new Error(`the list view offers it: ${offered.map((action) => action.label).join('; ')}`);
        return;
      }
      const actions =
        step.kind === 'place'
          ? view.placementsFor(step.part)
          : step.kind === 'setting'
            ? view.actionsFor({ kind: 'part', partId: mapPart(ids, step.ref) })
            : want.kind === 'connect'
              ? view.actionsFor({ kind: 'port', port: want.from })
              : [];
      const action = actions.find((candidate) => doesStep(candidate, want));
      if (!action) throw new Error(`the list view offers no action for it (it offers: ${actions.map((candidate) => candidate.label).join('; ') || 'nothing'})`);
      if (!view.perform(action)) throw new Error(`performing '${action.label}' changed nothing`);
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
  const commands: Record<StepKind, Capability> = {
    place: attempt('commands', 'place', onStart(() => handle.apply({ kind: 'place-part', part: first.part }))),
    setting: setting ? attempt('commands', 'setting', onBuilt(() => handle.apply(setting))) : READY,
    connect: attempt('commands', 'connect', onBuilt(() => handle.apply({ kind: 'connect', from: wire.from, to: wire.to }))),
    refuse: attempt('commands', 'refuse', onBuilt(() => handle.apply({ kind: 'connect', from: wire.from, to: wire.to }))),
  };
  if (!setting) commands.setting = commands.place;
  const gestures = (family: 'touch' | 'pointer'): Record<StepKind, Capability> => ({
    place: attempt(
      family,
      'place',
      onStart(() => {
        handle.beginPlacement(first.part);
        handle.cancelPlacement();
      }),
    ),
    setting: commands.setting,
    connect: waitingLike(commands.connect, family, 'connect'),
    refuse: waitingLike(commands.refuse, family, 'refuse'),
  });
  const listView = attempt('list view', 'place', () => handle.listView);
  const list = Object.fromEntries(STEP_KINDS.map((kind) => [kind, waitingLike(listView, 'list view', kind)])) as Record<StepKind, Capability>;
  handle.load(probe.start);
  const touch = gestures('touch');
  const pointer = gestures('pointer');
  return {
    reference: commandsPath(bench, commands),
    others: [
      gesturePath(bench, catalogue, { hand: 'touch', how: 'drag' }, touch),
      gesturePath(bench, catalogue, { hand: 'touch', how: 'tap' }, touch),
      gesturePath(bench, catalogue, { hand: 'mouse', how: 'drag' }, pointer),
      gesturePath(bench, catalogue, { hand: 'mouse', how: 'tap' }, pointer),
      listViewPath(bench, list),
    ],
  };
};

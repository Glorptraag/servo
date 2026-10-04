// The parity check's plan (task 3.8): a content fixture as the steps a child takes to build it from an empty canvas,
// in terms every input path can act on: touch, pointer, the list view and plain commands. Pure: no DOM, no canvas.
// See README.md, "The parity check".
import { checkPortPair, indexPlacedParts, placeParts, resolvePort } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  IssueCode,
  PartTypeId,
  PlacedPartId,
  PortId,
  PortRef,
  SettingId,
  SettingValue,
  Wire,
  WireId,
  WireKind,
} from '@servo/schema';
import type { EditCommand, PropTemplate } from '@servo/canvas';

export type StepKind =
  | 'place'
  | 'setting'
  | 'connect'
  | 'refuse'
  | 'move'
  | 'turn'
  | 'remove'
  | 'disconnect'
  | 'place-prop'
  | 'move-prop'
  | 'remove-prop'
  | 'reset-arena'
  | 'tidy'
  | 'undo'
  | 'clear-selection'
  | 'flip';

export const STEP_KINDS: readonly StepKind[] = [
  'place',
  'setting',
  'connect',
  'refuse',
  'move',
  'turn',
  'remove',
  'disconnect',
  'place-prop',
  'move-prop',
  'remove-prop',
  'reset-arena',
  'tidy',
  'undo',
  'clear-selection',
  'flip',
];

/** The edits a plan makes after the build (task 7.6): every edit a child can make once something is built. */
export const EDIT_KINDS: readonly StepKind[] = STEP_KINDS.filter((kind) => !['place', 'setting', 'connect', 'refuse'].includes(kind));

/** Steps that leave the build's bytes as they were: a refused drop, and what changes only the view, the selection or the Run. */
export const KEEPS_BUILD: ReadonlySet<StepKind> = new Set(['refuse', 'tidy', 'clear-selection', 'flip']);

/**
 * Places a part from the tray. Held in the fixture (by its mount on a mount point, or its hub on a shaft), it lands
 * attached there. Loose, it lands on the free spot: the one place every path can name, since the list view offers no
 * other (packages/canvas/src/interface.ts, `ListView.placementsFor`), so a loose part may sit elsewhere than the
 * fixture has it.
 */
export interface PlaceStep {
  readonly kind: 'place';
  /** The part's id in the fixture. Each path maps it onto the id its own placement claims. */
  readonly ref: PlacedPartId;
  readonly part: PartTypeId;
  /** Its mount or hub (`port`) onto a mount point or shaft of a part placed earlier, named by fixture ids. */
  readonly attach?: { readonly port: PortId; readonly onto: PortRef };
}

/** Sets a setting the fixture gives a non-default value: on the spec card, or in the list view. */
export interface SettingStep {
  readonly kind: 'setting';
  readonly ref: PlacedPartId;
  readonly setting: SettingId;
  readonly value: SettingValue;
}

/** Draws a power line, a signal line or a drive linkage the placements did not make, in fixture ids. */
export interface ConnectStep {
  readonly kind: 'connect';
  readonly from: PortRef;
  readonly to: PortRef;
  readonly wire: Exclude<WireKind, 'mount'>;
}

/** A broken fixture's impossible drop (task 2.6): every path must refuse it and leave the build as it was. */
export interface RefuseStep {
  readonly kind: 'refuse';
  readonly from: PortRef;
  readonly to: PortRef;
  readonly code: IssueCode;
}

/**
 * Moves a placed part to the free spot on the workbench the list view names for it (`Move X to a free spot`): off its
 * mount or shaft, with everything it holds. A hand drags it there, or taps its Move handle and then the spot.
 */
export interface MoveStep {
  readonly kind: 'move';
  readonly ref: PlacedPartId;
}

/** Turns a free part a quarter turn clockwise: its rotate handle tapped, or dragged a quarter turn round the part. */
export interface TurnStep {
  readonly kind: 'turn';
  readonly ref: PlacedPartId;
}

/** Removes a part and its wires (D35): dragged to the tray, or tapped and its bin tapped. */
export interface RemoveStep {
  readonly kind: 'remove';
  readonly ref: PlacedPartId;
}

/**
 * Removes a power or signal line: dragged to the tray, or tapped and its bin tapped. `lines` are the candidates by
 * their ends in fixture ids, the one to try first first: every path removes the first a hand can press on the canvas
 * now, clear of every socket and of the lines drawn over it. A line wholly under others cannot be pressed (README,
 * "Findings").
 */
export interface DisconnectStep {
  readonly kind: 'disconnect';
  readonly lines: readonly { readonly from: PortRef; readonly to: PortRef }[];
}

/** Places a prop from the arena strip on the free spot on the floor the placement rule picks (D36). */
export interface PlacePropStep {
  readonly kind: 'place-prop';
  readonly prop: PropTemplate;
}

/** Moves one of the child's props (by its place among them in id order) to the free spot the list view names for it. */
export interface MovePropStep {
  readonly kind: 'move-prop';
  readonly index: number;
}

/** Removes one of the child's props (by its place among them in id order). */
export interface RemovePropStep {
  readonly kind: 'remove-prop';
  readonly index: number;
}

/** The Run bar's Reset arena (D29): the preset kept, the child's props dropped. An app button on every path. */
export interface ResetArenaStep {
  readonly kind: 'reset-arena';
}

/** Tidy wires (task 3.7): routes change, the build does not, and no edit fires. */
export interface TidyStep {
  readonly kind: 'tidy';
}

/** The Run bar's Undo (task 4.4): the build before the last edit, loaded again. An app button on every path. */
export interface UndoStep {
  readonly kind: 'undo';
}

/** Selects a part (a tap, a click, or the list view's Select) and then clears the selection (empty canvas, or Clear selection). */
export interface ClearSelectionStep {
  readonly kind: 'clear-selection';
  readonly ref: PlacedPartId;
}

/** In Run mode, flips a manual switch: a tap or click on it, or the list view's Open or Close. The build never changes. */
export interface FlipStep {
  readonly kind: 'flip';
  readonly ref: PlacedPartId;
}

export type Step =
  | PlaceStep
  | SettingStep
  | ConnectStep
  | RefuseStep
  | MoveStep
  | TurnStep
  | RemoveStep
  | DisconnectStep
  | PlacePropStep
  | MovePropStep
  | RemovePropStep
  | ResetArenaStep
  | TidyStep
  | UndoStep
  | ClearSelectionStep
  | FlipStep;

export interface BuildPlan {
  /** The fixture's name in `FIXTURES`. */
  readonly fixture: string;
  /** The build every path starts from: the fixture's metadata and arena, nothing placed, no ids claimed. */
  readonly start: Blueprint;
  /** Placements (each holder before what it holds), then settings, then wires, then the refused drop. */
  readonly steps: readonly Step[];
}

/** The part of a content fixture a plan reads. */
export interface PlannedFixture {
  readonly name: string;
  readonly blueprint: Blueprint;
  readonly expect: { readonly refused?: { readonly from: PortRef; readonly to: PortRef; readonly code: IssueCode } };
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Wire ids in number order (`w2` before `w10`), any other id after them in text order. */
const compareWireIds = (a: WireId, b: WireId): number => {
  const number = (id: WireId): number => Number(/^w(\d+)$/.exec(id)?.[1] ?? Number.POSITIVE_INFINITY);
  return number(a) - number(b) || compareText(a, b);
};

interface Holding {
  readonly child: PlacedPartId;
  readonly wire: Wire;
  readonly port: PortId;
  readonly onto: PortRef;
}

/** The wire by which `parent` holds `child`: a mount (child's mount → parent's mount point) or a drive linkage (parent's shaft → child's hub). */
const holdingWire = (blueprint: Blueprint, catalogue: Catalogue, child: PlacedPartId, parent: PlacedPartId, by: 'mount' | 'carried'): Holding => {
  const parts = indexPlacedParts(blueprint.parts);
  for (const wire of [...blueprint.wires].sort((a, b) => compareWireIds(a.id, b.id))) {
    const from = resolvePort(parts, catalogue, wire.from);
    const to = resolvePort(parts, catalogue, wire.to);
    if (!from.found || !to.found) continue;
    const pair = checkPortPair(from.spec, to.spec);
    if (!pair.legal) continue;
    const [source, target] = pair.swap ? [wire.to, wire.from] : [wire.from, wire.to];
    if (by === 'mount' && pair.kind === 'mount' && source.part === child && target.part === parent) {
      return { child, wire, port: source.port, onto: target };
    }
    if (by === 'carried' && pair.kind === 'drive' && target.part === child && source.part === parent) {
      return { child, wire, port: target.port, onto: source };
    }
  }
  throw new Error(`No wire holds '${child}' on '${parent}'.`);
};

/**
 * The steps that build a fixture from an empty canvas. Placements come first: each loose part with everything it
 * holds, the biggest group first (so a robot's chassis takes the empty canvas's free spot, the origin, where the
 * fixtures put it), and within a group each held part after its holder, in the order of the wires that hold them.
 * Then every setting the fixture changes, then every wire the placements did not make (power and signal lines, and
 * drive linkages between held parts), in wire order, then a broken fixture's refused drop, then the edits of the
 * `tours` asked for (`editTour`; every tour by default). Throws when the fixture has a mount that holds nothing, which
 * no step here makes.
 */
export const planFor = (fixture: PlannedFixture, catalogue: Catalogue, tours: ReadonlySet<Tour> = new Set(TOURS)): BuildPlan => {
  const { blueprint } = fixture;
  const parts = indexPlacedParts(blueprint.parts);
  const placements = placeParts(blueprint, catalogue);
  const held: Holding[] = [];
  const loose: PlacedPartId[] = [];
  for (const part of blueprint.parts) {
    const placement = placements.get(part.id);
    if (!placement || placement.by === 'root' || placement.parent === undefined) loose.push(part.id);
    else held.push(holdingWire(blueprint, catalogue, part.id, placement.parent, placement.by));
  }
  const groupSize = (id: PlacedPartId): number => [...placements.values()].filter((placement) => placement.root === id).length;
  loose.sort((a, b) => groupSize(b) - groupSize(a) || compareText(a, b));
  held.sort((a, b) => compareWireIds(a.wire.id, b.wire.id));
  const made = new Set(held.map((holding) => holding.wire.id));

  const steps: Step[] = [];
  const placed = new Set<PlacedPartId>();
  const partOf = (id: PlacedPartId): PartTypeId => parts.get(id)?.part ?? '';
  const ready = (): number => held.findIndex((holding) => placed.has(holding.onto.part));
  for (const root of loose) {
    steps.push({ kind: 'place', ref: root, part: partOf(root) });
    placed.add(root);
    for (let next = ready(); next >= 0; next = ready()) {
      const [holding] = held.splice(next, 1) as [Holding];
      steps.push({ kind: 'place', ref: holding.child, part: partOf(holding.child), attach: { port: holding.port, onto: holding.onto } });
      placed.add(holding.child);
    }
  }
  if (held.length > 0) throw new Error(`${fixture.name}: '${held[0]?.child}' is held by a part that is never placed.`);

  for (const part of [...blueprint.parts].sort((a, b) => compareText(a.id, b.id))) {
    for (const setting of Object.keys(part.settings).sort(compareText)) {
      const value = part.settings[setting];
      if (value !== undefined) steps.push({ kind: 'setting', ref: part.id, setting, value });
    }
  }

  for (const wire of [...blueprint.wires].sort((a, b) => compareWireIds(a.id, b.id))) {
    if (made.has(wire.id)) continue;
    const from = resolvePort(parts, catalogue, wire.from);
    const to = resolvePort(parts, catalogue, wire.to);
    const pair = from.found && to.found ? checkPortPair(from.spec, to.spec) : undefined;
    if (!pair?.legal) throw new Error(`${fixture.name}: wire '${wire.id}' does not join two ports that take it.`);
    if (pair.kind === 'mount') throw new Error(`${fixture.name}: mount '${wire.id}' holds nothing, and no step makes a mount by itself.`);
    steps.push({ kind: 'connect', from: wire.from, to: wire.to, wire: pair.kind });
  }

  const refused = fixture.expect.refused;
  if (refused) steps.push({ kind: 'refuse', from: refused.from, to: refused.to, code: refused.code });

  steps.push(...editTour(fixture, catalogue, steps, tours));

  return {
    fixture: fixture.name,
    start: { ...blueprint, parts: [], wires: [], meta: { ...blueprint.meta, highWater: { parts: 0, wires: 0 } } },
    steps,
  };
};

/** The prop every plan places from the arena strip: the arena strip's box. */
export const PLAN_PROP: PropTemplate = { shape: 'box', size: { x: 80, y: 80, z: 80 }, grams: 200, fixed: false };

/**
 * The edits after a build, in groups a plan takes whole: an edit and the Undo that takes it back, and the props'
 * steps from the first placed to Reset arena, which drops the one left.
 */
export type Tour = 'disconnect' | 'move' | 'turn' | 'remove' | 'props' | 'tidy' | 'clear-selection' | 'flip';

export const TOURS: readonly Tour[] = ['disconnect', 'move', 'turn', 'remove', 'props', 'tidy', 'clear-selection', 'flip'];

const hasManualSwitch = (catalogue: Catalogue, part: PartTypeId): boolean =>
  catalogue.parts.get(part)?.behaviour.some((primitive) => primitive.kind === 'switch' && primitive.actuation.kind === 'manual') ?? false;

/**
 * The edits a child makes once the fixture is built, from the tours asked for, each where the build has something for
 * it: a power or signal line removed and put back by Undo (the line whose parts sit furthest apart first, the rest in
 * that order after it); the last part held by a mount moved off to a free spot (a loose part may already sit on its
 * free spot, where the list view offers no move); the first
 * loose part turned; the first held part removed and put back
 * by Undo; on the open floor with no props, two props placed, the first removed, the other moved to the spot that
 * frees, then Reset arena; the wires tidied; the first loose part selected and the selection cleared; a manual switch
 * flipped in Run mode.
 */
const editTour = (fixture: PlannedFixture, catalogue: Catalogue, built: readonly Step[], tours: ReadonlySet<Tour>): Step[] => {
  const places = built.filter((step): step is PlaceStep => step.kind === 'place');
  const loose = places.filter((step) => !step.attach).map((step) => step.ref);
  const held = places.filter((step) => step.attach).map((step) => step.ref);
  // The line whose parts sit furthest apart in the fixture: a long line a hand can press clear of every socket.
  const at = new Map(fixture.blueprint.parts.map((part) => [part.id, part.position]));
  const span = (step: ConnectStep): number => {
    const a = at.get(step.from.part);
    const b = at.get(step.to.part);
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const lines = built
    .filter((step): step is ConnectStep => step.kind === 'connect' && (step.wire === 'power' || step.wire === 'signal'))
    .sort((a, b) => span(b) - span(a));
  const line = lines[0];
  // Held by a mount, not carried on a shaft: a carried wheel's free spot can overlap its own tile, where a tap after
  // its Move handle leaves it be (README, "Findings").
  const mounted = held.filter((ref) => {
    const step = places.find((place) => place.ref === ref);
    const port = step?.attach && catalogue.parts.get(step.part)?.ports.find((candidate) => candidate.id === step.attach?.port);
    return port?.type === 'mechanical' && port.role === 'mount';
  });
  const switched = places.find((step) => hasManualSwitch(catalogue, step.part));
  const { arena } = fixture.blueprint;
  const steps: Step[] = [];
  for (const tour of TOURS) {
    if (!tours.has(tour)) continue;
    switch (tour) {
      case 'disconnect':
        if (line) steps.push({ kind: 'disconnect', lines: lines.map(({ from, to }) => ({ from, to })) }, { kind: 'undo' });
        break;
      case 'move': {
        const ref = mounted[mounted.length - 1];
        if (ref !== undefined) steps.push({ kind: 'move', ref });
        break;
      }
      case 'turn':
        if (loose[0] !== undefined) steps.push({ kind: 'turn', ref: loose[0] });
        break;
      case 'remove':
        if (held[0] !== undefined) steps.push({ kind: 'remove', ref: held[0] }, { kind: 'undo' });
        break;
      case 'props':
        if (arena.preset === 'open-floor' && arena.props.length === 0) {
          steps.push(
            { kind: 'place-prop', prop: PLAN_PROP },
            { kind: 'place-prop', prop: PLAN_PROP },
            { kind: 'remove-prop', index: 0 },
            { kind: 'move-prop', index: 0 },
            { kind: 'reset-arena' },
          );
        }
        break;
      case 'tidy':
        if (line) steps.push({ kind: 'tidy' });
        break;
      case 'clear-selection':
        if (loose[0] !== undefined) steps.push({ kind: 'clear-selection', ref: loose[0] });
        break;
      case 'flip':
        if (switched) steps.push({ kind: 'flip', ref: switched.ref });
        break;
    }
  }
  return steps;
};

/** The steps that build a fixture, each one command on any build (the edits after it depend on the build they meet). */
export type BuildStep = PlaceStep | SettingStep | ConnectStep | RefuseStep;

export const isBuildStep = (step: Step): step is BuildStep =>
  step.kind === 'place' || step.kind === 'setting' || step.kind === 'connect' || step.kind === 'refuse';

/** Fixture part ids to the ids one path's placements claimed. */
export type IdMap = ReadonlyMap<PlacedPartId, PlacedPartId>;

export const mapPart = (ids: IdMap, ref: PlacedPartId): PlacedPartId => {
  const id = ids.get(ref);
  if (id === undefined) throw new Error(`'${ref}' has not been placed.`);
  return id;
};

export const mapPort = (ids: IdMap, ref: PortRef): PortRef => ({ part: mapPart(ids, ref.part), port: ref.port });

/**
 * The command a step stands for, on the ids this path claimed: what the app, the spec card and the hint ladder send
 * through `apply`, and what the list view's actions carry. A loose placement names no spot, so the placement rule
 * picks the free spot. A refused drop is the `connect` that must be refused.
 */
export const commandFor = (step: BuildStep, ids: IdMap): EditCommand => {
  switch (step.kind) {
    case 'place':
      return step.attach
        ? { kind: 'place-part', part: step.part, attach: { port: step.attach.port, onto: mapPort(ids, step.attach.onto) } }
        : { kind: 'place-part', part: step.part };
    case 'setting':
      return { kind: 'set-setting', partId: mapPart(ids, step.ref), setting: step.setting, value: step.value };
    case 'connect':
    case 'refuse':
      return { kind: 'connect', from: mapPort(ids, step.from), to: mapPort(ids, step.to) };
  }
};

/** One line for messages, in fixture ids: `place dc-motor motor-left on chassis.motor-left-inner`. */
export const describeStep = (step: Step): string => {
  const port = (ref: PortRef): string => `${ref.part}.${ref.port}`;
  switch (step.kind) {
    case 'place':
      return step.attach
        ? `place ${step.part} ${step.ref} by its ${step.attach.port} on ${port(step.attach.onto)}`
        : `place ${step.part} ${step.ref} on the free spot`;
    case 'setting':
      return `set ${step.ref} ${step.setting} to ${String(step.value)}`;
    case 'connect':
      return `connect ${port(step.from)} to ${port(step.to)} (${step.wire})`;
    case 'refuse':
      return `drop ${port(step.from)} on ${port(step.to)}, refused as ${step.code}`;
    case 'move':
      return `move ${step.ref} to a free spot`;
    case 'turn':
      return `turn ${step.ref} a quarter turn clockwise`;
    case 'remove':
      return `remove ${step.ref}`;
    case 'disconnect': {
      const [first] = step.lines;
      return first ? `remove the first line a hand can press, trying ${port(first.from)} to ${port(first.to)} first` : 'remove a line';
    }
    case 'place-prop':
      return `place a ${step.prop.shape} in the arena`;
    case 'move-prop':
      return `move prop ${step.index + 1} to a free spot`;
    case 'remove-prop':
      return `remove prop ${step.index + 1}`;
    case 'reset-arena':
      return 'reset the arena';
    case 'tidy':
      return 'tidy the wires';
    case 'undo':
      return 'undo';
    case 'clear-selection':
      return `select ${step.ref}, then clear the selection`;
    case 'flip':
      return `flip ${step.ref} in Run mode`;
  }
};

/**
 * Which tours each fixture's plan takes, so every edit is compared on several fixtures without every fixture taking
 * every edit (each costs a gesture per path, and the parity shards have CI's ten minutes each). Fixtures in name order
 * each take the `perFixture` tours that fit them and have been taken least so far, ties in `TOURS` order.
 * Deterministic: the same fixtures give the same tours.
 */
export const assignTours = (fixtures: readonly PlannedFixture[], catalogue: Catalogue, perFixture = 1): ReadonlyMap<string, ReadonlySet<Tour>> => {
  const taken = new Map<Tour, number>(TOURS.map((tour) => [tour, 0]));
  const assigned = new Map<string, ReadonlySet<Tour>>();
  for (const fixture of [...fixtures].sort((a, b) => compareText(a.name, b.name))) {
    const built = planFor(fixture, catalogue, new Set()).steps;
    const fits = TOURS.filter((tour) => editTour(fixture, catalogue, built, new Set([tour])).length > 0);
    const chosen = new Set<Tour>();
    for (let k = 0; k < perFixture; k++) {
      const [pick] = fits
        .filter((tour) => !chosen.has(tour))
        .sort((a, b) => (taken.get(a) ?? 0) - (taken.get(b) ?? 0) || TOURS.indexOf(a) - TOURS.indexOf(b));
      if (pick === undefined) break;
      chosen.add(pick);
      taken.set(pick, (taken.get(pick) ?? 0) + 1);
    }
    assigned.set(fixture.name, chosen);
  }
  return assigned;
};

// The list view's actions (task 3.6): the same edits the canvas makes by touch and pointer, offered as a list. Each is
// an EditCommand judged by the rules the canvas uses (`planWire`, `placeTargets`, `moveTargets`, the free spot), so the
// list offers only legal actions and never meets an impossible drop, and what it does goes through the one `applyEdit`
// (ground rule 8). Pure. See README.md, "The list view".
import { planWire } from '@servo/schema';
import type { Blueprint, Catalogue, Level, PartTypeId, PlacedPartId, PortRef, Vec2 } from '@servo/schema';
import type { CanvasMode, EditCommand, ListAction, ListSubject, PropTemplate, Selection } from '../interface.ts';
import { posesOf, readHolding, subtreeOf, takeOff } from '../placement/holding.ts';
import { propSpot } from '../placement/props.ts';
import { moveTargets, movedPartSpot, placeTargets, tileOutline } from '../placement/rules.ts';
import { TIDY_WIRES_ACTION } from '../routing/commands.ts';
import { wireKindOf } from '../wiring/commands.ts';
import { heldPhrase, listOf, midSentence, namesOf, wireDescription, withUnit } from './words.ts';
import type { Names } from './words.ts';

/** What the actions depend on: the build, the mode, the child's level, and switches' states in Run mode. */
export interface ListState {
  readonly blueprint: Blueprint | undefined;
  readonly catalogue: Catalogue;
  readonly level: Level;
  readonly mode: CanvasMode;
  readonly readOnly: boolean;
  /** Run mode: whether a manual switch is closed now. */
  readonly switchClosed: (partId: PlacedPartId) => boolean | undefined;
}

const sameRef = (a: PortRef, b: PortRef): boolean => a.part === b.part && a.port === b.port;
const refKey = (ref: PortRef): string => `${ref.part}.${ref.port}`;

const edit = (id: string, label: string, command: EditCommand): ListAction => ({ id, label, does: { kind: 'edit', command } });
const select = (id: string, label: string, selection: Selection): ListAction => ({ id, label, does: { kind: 'select', selection } });

/** Edits are offered in Build mode, on a canvas that is not read-only, once a build is loaded. */
const editable = (state: ListState): state is ListState & { readonly blueprint: Blueprint } =>
  state.blueprint !== undefined && state.mode === 'build' && !state.readOnly;

/** The manual switch primitive's starting state, for a part whose record has one. */
export const manualSwitch = (state: ListState, partId: PlacedPartId): { readonly initially: 'open' | 'closed' } | undefined => {
  const part = state.blueprint?.parts.find((candidate) => candidate.id === partId);
  const record = part && state.catalogue.parts.get(part.part);
  for (const primitive of record?.behaviour ?? []) {
    if (primitive.kind === 'switch' && primitive.actuation.kind === 'manual') return { initially: primitive.actuation.initially };
  }
  return undefined;
};

/**
 * Where a placed part goes when it is moved to "a free spot": loose, with everything it holds, at the free spot nearest
 * the middle of the rest of the build (the canvas origin when there is no rest), as `defaultSpot` places a new part.
 */
export const freeMoveSpot = (blueprint: Blueprint, catalogue: Catalogue, partId: PlacedPartId): Vec2 => {
  const loose = takeOff(blueprint, catalogue, partId);
  const holding = readHolding(loose, catalogue);
  const group = new Set(subtreeOf(holding, partId));
  const poses = posesOf(holding);
  const points: Vec2[] = [];
  for (const part of loose.parts) {
    const record = catalogue.parts.get(part.part);
    const pose = poses.get(part.id);
    if (!group.has(part.id) && record && pose) points.push(...tileOutline(record, pose));
  }
  const anchor =
    points.length === 0
      ? { x: 0, y: 0 }
      : {
          x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
          y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2,
        };
  return movedPartSpot(blueprint, catalogue, partId, anchor);
};

/** A number setting's value one step up or down, kept to the step's own precision, or undefined beyond the range. */
const stepped = (value: number, step: number, min: number, max: number, direction: 1 | -1): number | undefined => {
  const decimals = (String(step).split('.')[1] ?? '').length;
  const next = Number((value + direction * step).toFixed(decimals));
  return next < min - 1e-9 || next > max + 1e-9 ? undefined : next;
};

const partActions = (state: ListState & { readonly blueprint: Blueprint }, names: Names, partId: PlacedPartId): ListAction[] => {
  const { blueprint, catalogue } = state;
  const part = blueprint.parts.find((candidate) => candidate.id === partId);
  const record = part && catalogue.parts.get(part.part);
  if (!part || !record) return [];
  const title = names.title(partId);
  const actions: ListAction[] = [];
  const placement = names.placement(partId);

  // Move: loose to the free spot, onto a free mount point, or (a hub, not fixed by a mount) onto a free shaft (D34).
  const spot = freeMoveSpot(blueprint, catalogue, partId);
  if (placement?.by !== 'root' || spot.x !== part.position.x || spot.y !== part.position.y) {
    actions.push(edit(`move:${partId}:free`, `Move ${title} to a free spot on the workbench`, { kind: 'move-part', partId, position: spot }));
  }
  const mounts = blueprint.wires.filter((wire) => wire.from.part === partId && wireKindOf(blueprint, catalogue, wire.from, wire.to) === 'mount');
  for (const target of moveTargets(blueprint, catalogue, partId)) {
    if (mounts.some((wire) => wire.from.port === target.port && sameRef(wire.to, target.onto))) continue;
    actions.push(
      edit(`mount:${partId}.${target.port}:${refKey(target.onto)}`, `Move ${title} to ${names.portPhrase(target.onto)}`, {
        kind: 'mount',
        partId,
        port: target.port,
        onto: target.onto,
      }),
    );
  }
  if (placement?.by !== 'mount') {
    const group = new Set(subtreeOf(readHolding(blueprint, catalogue), partId));
    for (const hub of record.ports) {
      if (hub.type !== 'mechanical' || hub.role !== 'drive-in') continue;
      const from = { part: partId, port: hub.id };
      for (const host of names.parts) {
        if (group.has(host.id)) continue;
        for (const shaft of catalogue.parts.get(host.part)?.ports ?? []) {
          if (shaft.type !== 'mechanical' || shaft.role !== 'drive-out') continue;
          const to = { part: host.id, port: shaft.id };
          if (!planWire(blueprint, catalogue, from, to).legal) continue;
          actions.push(edit(`carry:${refKey(from)}:${refKey(to)}`, `Move ${title} onto ${names.portPhrase(to)}`, { kind: 'connect', from, to }));
        }
      }
    }
  }

  // Turn a quarter turn either way.
  actions.push(
    edit(`turn:${partId}:clockwise`, `Turn ${title} a quarter turn clockwise`, { kind: 'rotate-part', partId, rotation: (part.rotation + 90) % 360 }),
    edit(`turn:${partId}:anticlockwise`, `Turn ${title} a quarter turn anticlockwise`, {
      kind: 'rotate-part',
      partId,
      rotation: (part.rotation + 270) % 360,
    }),
  );

  // Settings unlocked at the child's level, a child-sized step at a time.
  for (const setting of record.settings) {
    if (setting.unlockLevel > state.level) continue;
    const label = midSentence(setting.label);
    const current = part.settings[setting.id] ?? setting.default;
    if (setting.kind === 'number') {
      const value = typeof current === 'number' ? current : setting.default;
      for (const [direction, word] of [
        [1, 'up'],
        [-1, 'down'],
      ] as const) {
        const next = stepped(value, setting.step, setting.min, setting.max, direction);
        if (next === undefined) continue;
        actions.push(
          edit(`setting:${partId}:${setting.id}:${word}`, `Set ${title} ${label} to ${withUnit(next, setting.unit)}`, {
            kind: 'set-setting',
            partId,
            setting: setting.id,
            value: next,
          }),
        );
      }
    } else {
      for (const option of setting.options) {
        if (option.id === current) continue;
        actions.push(
          edit(`setting:${partId}:${setting.id}:${option.id}`, `Set ${title} ${label} to ${midSentence(option.label)}`, {
            kind: 'set-setting',
            partId,
            setting: setting.id,
            value: option.id,
          }),
        );
      }
    }
  }

  // Remove: the part and its wires; what it held stays, loose (D35).
  const lines = blueprint.wires.filter((wire) => {
    if (wire.from.part !== partId && wire.to.part !== partId) return false;
    const kind = wireKindOf(blueprint, catalogue, wire.from, wire.to);
    return kind === 'power' || kind === 'signal';
  }).length;
  const held = names.parts.filter((other) => names.placement(other.id)?.parent === partId).map((other) => names.title(other.id));
  const wires = lines === 0 ? '' : lines === 1 ? ' and its wire' : ` and its ${lines} wires`;
  const loose = held.length === 0 ? '' : `, leaving ${listOf(held)} loose`;
  actions.push(edit(`remove:${partId}`, `Remove ${title}${wires}${loose}`, { kind: 'remove-part', partId }));
  return actions;
};

const portActions = (state: ListState & { readonly blueprint: Blueprint }, names: Names, ref: PortRef): ListAction[] => {
  const { blueprint, catalogue } = state;
  const spec = names.port(ref);
  if (!spec) return [];
  const actions: ListAction[] = [];
  const on = blueprint.wires.filter((wire) => sameRef(wire.from, ref) || sameRef(wire.to, ref));
  if (spec.type === 'mechanical' && spec.role === 'mount') {
    const title = names.title(ref.part);
    for (const target of moveTargets(blueprint, catalogue, ref.part)) {
      if (target.port !== ref.port || on.some((wire) => sameRef(wire.to, target.onto))) continue;
      actions.push(
        edit(`mount:${refKey(ref)}:${refKey(target.onto)}`, `Mount ${title} on ${names.portPhrase(target.onto)}`, {
          kind: 'mount',
          partId: ref.part,
          port: ref.port,
          onto: target.onto,
        }),
      );
    }
    for (const wire of on) {
      actions.push(edit(`unmount:${refKey(ref)}`, `Take ${title} off ${names.portPhrase(wire.to)}`, { kind: 'unmount', partId: ref.part, port: ref.port }));
    }
    return actions;
  }
  if (spec.type === 'mechanical' && spec.role === 'mount-point') {
    for (const other of names.parts) {
      if (other.id === ref.part) continue;
      for (const target of moveTargets(blueprint, catalogue, other.id)) {
        if (!sameRef(target.onto, ref) || on.some((wire) => wire.from.part === other.id && wire.from.port === target.port)) continue;
        actions.push(
          edit(`mount:${other.id}.${target.port}:${refKey(ref)}`, `Mount ${names.title(other.id)} on ${names.portPhrase(ref)}`, {
            kind: 'mount',
            partId: other.id,
            port: target.port,
            onto: ref,
          }),
        );
      }
    }
    for (const wire of on) {
      actions.push(
        edit(`unmount:${refKey(wire.from)}`, `Take ${names.title(wire.from.part)} off ${names.portPhrase(ref)}`, {
          kind: 'unmount',
          partId: wire.from.part,
          port: wire.from.port,
        }),
      );
    }
    return actions;
  }
  // Power, signal and drive ports: a wire to every port `planWire` lets it join, legal-but-wrong ones included.
  for (const other of names.parts) {
    for (const port of catalogue.parts.get(other.part)?.ports ?? []) {
      const to = { part: other.id, port: port.id };
      if (sameRef(to, ref) || !planWire(blueprint, catalogue, ref, to).legal || wireKindOf(blueprint, catalogue, ref, to) === 'mount') continue;
      actions.push(edit(`connect:${refKey(ref)}:${refKey(to)}`, `Connect to ${names.title(other.id)}, ${port.label}`, { kind: 'connect', from: ref, to }));
    }
  }
  for (const wire of on) {
    const kind = wireKindOf(blueprint, catalogue, wire.from, wire.to);
    if (kind === undefined || kind === 'mount') continue;
    actions.push(edit(`disconnect:${wire.id}`, `Remove ${wireDescription(names, wire, kind)}`, { kind: 'disconnect', wireId: wire.id }));
  }
  return actions;
};

/** The actions on a part, port, wire or prop in the current mode (interface.ts, `ListView.actionsFor`). */
export const actionsFor = (state: ListState, subject: ListSubject): ListAction[] => {
  const { blueprint, catalogue } = state;
  if (!blueprint) return [];
  const names = namesOf(blueprint, catalogue);
  switch (subject.kind) {
    case 'part': {
      if (!blueprint.parts.some((part) => part.id === subject.partId)) return [];
      const title = names.title(subject.partId);
      const actions = [select(`select:part:${subject.partId}`, `Select ${title}`, { kind: 'part', partId: subject.partId })];
      if (state.readOnly) return actions;
      if (state.mode === 'run') {
        const manual = manualSwitch(state, subject.partId);
        if (manual) {
          const closed = state.switchClosed(subject.partId) ?? manual.initially === 'closed';
          actions.push({
            id: `flip:${subject.partId}`,
            label: closed ? `Open ${title}` : `Close ${title}`,
            does: { kind: 'control', input: { partId: subject.partId, kind: 'switch', closed: !closed } },
          });
        }
        return actions;
      }
      return editable(state) ? [...actions, ...partActions(state, names, subject.partId)] : actions;
    }
    case 'port':
      return editable(state) ? portActions(state, names, subject.port) : [];
    case 'wire': {
      const wire = blueprint.wires.find((candidate) => candidate.id === subject.wireId);
      const kind = wire && wireKindOf(blueprint, catalogue, wire.from, wire.to);
      if (!wire || !kind) return [];
      const description = wireDescription(names, wire, kind);
      const actions = [select(`select:wire:${wire.id}`, `Select ${description}`, { kind: 'wire', wireId: wire.id })];
      if (!editable(state)) return actions;
      if (kind === 'mount') {
        actions.push(
          edit(`unmount:${refKey(wire.from)}`, `Take ${names.title(wire.from.part)} off ${names.portPhrase(wire.to)}`, {
            kind: 'unmount',
            partId: wire.from.part,
            port: wire.from.port,
          }),
        );
      } else {
        actions.push(edit(`disconnect:${wire.id}`, `Remove ${description}`, { kind: 'disconnect', wireId: wire.id }));
      }
      // Tidying routes every power and signal line round the parts (task 3.7): offered with each of them, the one
      // command under an id of the wire's own, so every button stays unique.
      if (kind === 'power' || kind === 'signal') actions.push({ ...TIDY_WIRES_ACTION, id: `${TIDY_WIRES_ACTION.id}:${wire.id}` });
      return actions;
    }
    case 'prop': {
      const preset = catalogue.arenas?.get(blueprint.arena.preset);
      const own = blueprint.arena.props.find((prop) => prop.id === subject.propId);
      const prop = own ?? preset?.props.find((candidate) => candidate.id === subject.propId);
      if (!prop) return [];
      const actions = [select(`select:prop:${prop.id}`, `Select the ${prop.shape}`, { kind: 'prop', propId: prop.id })];
      // Only the child's own props move or go, and only in Build mode (D36).
      if (!own || !editable(state)) return actions;
      const at = propSpot(blueprint, catalogue, own, undefined, own.id, own.at.heading);
      if (at && (at.x !== own.at.x || at.y !== own.at.y)) {
        actions.push(edit(`move-prop:${own.id}:free`, `Move the ${own.shape} to a free spot in the arena`, { kind: 'move-prop', propId: own.id, at }));
      }
      actions.push(edit(`remove-prop:${own.id}`, `Remove the ${own.shape}`, { kind: 'remove-prop', propId: own.id }));
      return actions;
    }
    default:
      return [];
  }
};

/** Where a tray part can go: the free spot on the workbench, and every free mount point or shaft it fits. */
export const placementsFor = (state: ListState, type: PartTypeId): ListAction[] => {
  if (!editable(state)) return [];
  const record = state.catalogue.parts.get(type);
  if (!record) return [];
  const names = namesOf(state.blueprint, state.catalogue);
  const actions = [edit(`place:${type}:free`, `Place ${record.identity.name} on the workbench`, { kind: 'place-part', part: type })];
  for (const target of placeTargets(state.blueprint, state.catalogue, type)) {
    actions.push(
      edit(`place:${type}:${target.port}:${refKey(target.onto)}`, `Place ${record.identity.name} on ${names.portPhrase(target.onto)}`, {
        kind: 'place-part',
        part: type,
        attach: { port: target.port, onto: target.onto },
      }),
    );
  }
  return actions;
};

/** Where a prop from the arena strip can go: a free spot on the floor, chosen by `applyEdit` as it lands. */
export const propPlacementsFor = (state: ListState, prop: PropTemplate): ListAction[] => {
  if (!editable(state) || !propSpot(state.blueprint, state.catalogue, prop)) return [];
  return [edit(`place-prop:${prop.shape}:free`, `Place a ${prop.shape} in the arena`, { kind: 'place-prop', prop })];
};

/** How a part is held, for its description and for saying what a change left loose. */
export const heldOf = (state: ListState, partId: PlacedPartId): string | undefined =>
  state.blueprint ? heldPhrase(namesOf(state.blueprint, state.catalogue), state.blueprint, partId) : undefined;

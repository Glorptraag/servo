// The placement commands of the one command layer (ground rule 8): every EditCommand but wiring, as pure reducers over
// a valid blueprint. `applyEdit` (apply.ts) runs them, then checks and canonicalises what they give. Task 3.3 adds
// `connect` and `disconnect` beside them, reusing `joinPorts` and `settle`. See docs/commands.md and docs/placement.md.
import { checkPortPair, claimPartId, claimWireId, indexPlacedParts, placeParts, planWire, resolvePort } from '@servo/schema';
import type { ArenaRef, Blueprint, Catalogue, IssueCode, PlacedPart, PlacedPartId, PortRef, Pose, Vec2, Wire } from '@servo/schema';
import type { EditCode, EditRefusal, SingleEdit } from '../interface.ts';
import { settle, takeOff } from './holding.ts';
import { nextPropId, propSpot } from './props.ts';
import { defaultSpot } from './rules.ts';

/** What a reducer gives: a draft build, which `applyEdit` checks and canonicalises, or why the command changes nothing. */
export type Draft = { readonly ok: true; readonly blueprint: Blueprint } | { readonly ok: false; readonly refusal: EditRefusal };

export type Reducer<K extends SingleEdit['kind']> = (
  blueprint: Blueprint,
  command: Extract<SingleEdit, { readonly kind: K }>,
  catalogue: Catalogue,
) => Draft;

/** A reducer per command kind. */
export type Reducers = { readonly [K in SingleEdit['kind']]?: Reducer<K> };

export const refuse = (code: IssueCode | EditCode, message: string): Draft => ({ ok: false, refusal: { code, message } });

const draft = (blueprint: Blueprint): Draft => ({ ok: true, blueprint });

// Commands are plain data from the app and the input paths; these guards keep a malformed one a refusal, never a throw.
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;
const isVec2 = (value: unknown): value is Vec2 => isObject(value) && typeof value.x === 'number' && typeof value.y === 'number';
const isPortRef = (value: unknown): value is PortRef => isObject(value) && typeof value.part === 'string' && typeof value.port === 'string';

const findPart = (blueprint: Blueprint, id: unknown): PlacedPart | undefined =>
  typeof id === 'string' ? blueprint.parts.find((part) => part.id === id) : undefined;

const unknownPart = (id: unknown): Draft => refuse('ref.unknown_placed_part', `No placed part has the id '${String(id)}'.`);

const sameRef = (a: PortRef, b: PortRef): boolean => a.part === b.part && a.port === b.port;

/**
 * Joins two ports with the next `w<n>` wire, as the schema's `planWire` judges it and in the orientation it gives.
 * Impossible drops come back with its `wire.*` codes and `mount.cycle`.
 */
export const joinPorts = (blueprint: Blueprint, catalogue: Catalogue, a: PortRef, b: PortRef): Draft => {
  if (!isPortRef(a) || !isPortRef(b)) return refuse('value.wrong_type', 'A port is named by its part and its port.');
  const plan = planWire(blueprint, catalogue, a, b);
  if (!plan.legal) return refuse(plan.code, plan.message);
  const claimed = claimWireId(blueprint);
  const wire: Wire = { id: claimed.id, from: plan.from, to: plan.to };
  return draft({ ...blueprint, wires: [...blueprint.wires, wire], meta: claimed.meta });
};

/** Whether a wire is a mount (its ends are a mount and a mount point). */
const isMount = (blueprint: Blueprint, catalogue: Catalogue, wire: Wire): boolean => {
  const parts = indexPlacedParts(blueprint.parts);
  const from = resolvePort(parts, catalogue, wire.from);
  const to = resolvePort(parts, catalogue, wire.to);
  if (!from.found || !to.found) return false;
  const pair = checkPortPair(from.spec, to.spec);
  return pair.legal && pair.kind === 'mount';
};

/** The build with one part's stored place changed. */
const withPlace = (blueprint: Blueprint, id: PlacedPartId, position: Vec2, rotation: number): Blueprint => ({
  ...blueprint,
  parts: blueprint.parts.map((part) => (part.id === id ? { ...part, position: { x: position.x, y: position.y }, rotation } : part)),
});

/**
 * Moves or turns a part (D34): it comes off whatever holds it, goes where it is told, and everything it holds goes
 * with it, where its mounts and shafts put them.
 */
const relocate = (blueprint: Blueprint, catalogue: Catalogue, id: PlacedPartId, position: Vec2, rotation: number): Blueprint =>
  settle(withPlace(takeOff(blueprint, catalogue, id), id, position, rotation), catalogue);

const placePart: Reducer<'place-part'> = (blueprint, command, catalogue) => {
  const record = typeof command.part === 'string' ? catalogue.parts.get(command.part) : undefined;
  if (!record) return refuse('ref.unknown_part_type', `No part record has the id '${String(command.part)}'.`);
  if (command.position !== undefined && !isVec2(command.position)) return refuse('value.wrong_type', 'A position is x and y in millimetres.');
  const rotation = command.rotation ?? 0;
  if (typeof rotation !== 'number') return refuse('value.wrong_type', 'A rotation is a number of degrees.');
  const claimed = claimPartId(blueprint);
  const placed = (position: Vec2, turn: number): PlacedPart => ({
    id: claimed.id,
    part: record.id,
    position: { x: position.x, y: position.y },
    rotation: turn,
    settings: {},
  });
  const { attach } = command;
  if (attach === undefined) {
    const position = command.position ?? defaultSpot(blueprint, catalogue, record, rotation);
    return draft({ ...blueprint, parts: [...blueprint.parts, placed(position, rotation)], meta: claimed.meta });
  }
  if (!isObject(attach) || typeof attach.port !== 'string' || !isPortRef(attach.onto)) {
    return refuse('value.wrong_type', 'An attachment names the new part’s port and the port it goes onto.');
  }
  const port = record.ports.find((spec) => spec.id === attach.port);
  if (!port) return refuse('ref.unknown_port', `The ${record.identity.name} has no port '${attach.port}'.`);
  if (port.type !== 'mechanical' || (port.role !== 'mount' && port.role !== 'drive-in')) {
    return refuse('port.wrong_kind', `A part attaches as it lands by its mount or its hub; '${port.id}' is neither.`);
  }
  // The mount or the shaft decides where it sits; `position` and `rotation` stand only until then.
  const provisional: Blueprint = {
    ...blueprint,
    parts: [...blueprint.parts, placed(command.position ?? { x: 0, y: 0 }, 0)],
    meta: claimed.meta,
  };
  const joined = joinPorts(provisional, catalogue, { part: claimed.id, port: port.id }, attach.onto);
  if (!joined.ok) return joined;
  const settled = settle(joined.blueprint, catalogue);
  if (placeParts(settled, catalogue).get(claimed.id)?.by !== 'root') return draft(settled);
  // A hub joined to a shaft it cannot line up with (a wheel on a servo arm) is not carried: it lands loose, where it
  // was dropped or at the free spot.
  const loose = command.position ?? defaultSpot(blueprint, catalogue, record, rotation);
  return draft(withPlace(settled, claimed.id, loose, rotation));
};

const movePart: Reducer<'move-part'> = (blueprint, command, catalogue) => {
  const part = findPart(blueprint, command.partId);
  if (!part) return unknownPart(command.partId);
  if (!isVec2(command.position)) return refuse('value.wrong_type', 'A position is x and y in millimetres.');
  return draft(relocate(blueprint, catalogue, part.id, command.position, part.rotation));
};

const rotatePart: Reducer<'rotate-part'> = (blueprint, command, catalogue) => {
  const part = findPart(blueprint, command.partId);
  if (!part) return unknownPart(command.partId);
  if (typeof command.rotation !== 'number') return refuse('value.wrong_type', 'A rotation is a number of degrees.');
  return draft(relocate(blueprint, catalogue, part.id, part.position, command.rotation));
};

/** D35: the part and every wire on its ports go; what it held stays where it is, loose. */
const removePart: Reducer<'remove-part'> = (blueprint, command, catalogue) => {
  const part = findPart(blueprint, command.partId);
  if (!part) return unknownPart(command.partId);
  const rest: Blueprint = {
    ...blueprint,
    parts: blueprint.parts.filter((other) => other.id !== part.id),
    wires: blueprint.wires.filter((wire) => wire.from.part !== part.id && wire.to.part !== part.id),
  };
  return draft(settle(rest, catalogue));
};

const mountPart: Reducer<'mount'> = (blueprint, command, catalogue) => {
  const part = findPart(blueprint, command.partId);
  if (!part) return unknownPart(command.partId);
  const record = catalogue.parts.get(part.part);
  const port = record?.ports.find((spec) => spec.id === command.port);
  if (!record || !port) return refuse('ref.unknown_port', `The ${record?.identity.name ?? 'part'} has no port '${String(command.port)}'.`);
  if (port.type !== 'mechanical' || port.role !== 'mount') return refuse('port.wrong_kind', `'${port.id}' is not a mount: a part is fixed by its mount.`);
  if (!isPortRef(command.onto)) return refuse('value.wrong_type', 'A mount point is named by its part and its port.');
  const ref = { part: part.id, port: port.id };
  const current = blueprint.wires.filter((wire) => sameRef(wire.from, ref) || sameRef(wire.to, ref));
  // Already on that mount point: nothing to change.
  if (current.some((wire) => sameRef(wire.from, command.onto) || sameRef(wire.to, command.onto))) return draft(blueprint);
  // A mount already on that port is replaced, so a re-snap is one change.
  const off: Blueprint = { ...blueprint, wires: blueprint.wires.filter((wire) => !current.includes(wire)) };
  const joined = joinPorts(off, catalogue, ref, command.onto);
  return joined.ok ? draft(settle(joined.blueprint, catalogue)) : joined;
};

const unmountPart: Reducer<'unmount'> = (blueprint, command, catalogue) => {
  const mount = blueprint.wires.find(
    (wire) => wire.from.part === command.partId && wire.from.port === command.port && isMount(blueprint, catalogue, wire),
  );
  if (!mount) return refuse('edit.unknown_wire', `No mount is on port '${String(command.port)}' of '${String(command.partId)}'.`);
  return draft(settle({ ...blueprint, wires: blueprint.wires.filter((wire) => wire !== mount) }, catalogue));
};

const setSetting: Reducer<'set-setting'> = (blueprint, command, catalogue) => {
  const part = findPart(blueprint, command.partId);
  if (!part) return unknownPart(command.partId);
  const record = catalogue.parts.get(part.part);
  const setting = record?.settings.find((candidate) => candidate.id === command.setting);
  if (!setting) return refuse('ref.unknown_setting', `The ${record?.identity.name ?? 'part'} has no setting '${String(command.setting)}'.`);
  // No value goes back to the default; canonical form drops a value equal to the default too.
  const others = Object.entries(part.settings).filter(([id]) => id !== setting.id);
  const settings = Object.fromEntries(command.value === undefined ? others : [...others, [setting.id, command.value]]);
  return draft({ ...blueprint, parts: blueprint.parts.map((other) => (other.id === part.id ? { ...other, settings } : other)) });
};

/** A copy of plain data, so the build never shares objects with the command that made it. */
const copyData = (value: unknown, depth = 0): unknown => {
  if (!isObject(value) || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => copyData(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyData(item, depth + 1)]));
};

const setArena: Reducer<'set-arena'> = (blueprint, command) => draft({ ...blueprint, arena: copyData(command.arena) as ArenaRef });

const placeProp: Reducer<'place-prop'> = (blueprint, command, catalogue) => {
  const template = command.prop;
  if (!isObject(template) || (template.shape !== 'box' && template.shape !== 'cylinder') || !isVec2(template.size)) {
    return refuse('value.wrong_type', 'A prop is a box or a cylinder with its size and weight.');
  }
  const preset = catalogue.arenas?.get(blueprint.arena.preset);
  let at: Pose | undefined = command.at;
  if (at === undefined) {
    if (!preset) return refuse('ref.unknown_arena', `No arena preset '${blueprint.arena.preset}' is loaded, so the prop has no floor.`);
    at = propSpot(blueprint, catalogue, template);
    if (!at) return refuse('arena.outside', 'The floor has no free spot for this prop.');
  }
  const prop = {
    id: nextPropId(preset, blueprint.arena.props),
    shape: template.shape,
    size: copyData(template.size),
    grams: template.grams,
    at: copyData(at),
    fixed: template.fixed,
  };
  return draft({ ...blueprint, arena: { ...blueprint.arena, props: [...blueprint.arena.props, prop as (typeof blueprint.arena.props)[number]] } });
};

const childsProp = (blueprint: Blueprint, id: unknown): Draft | undefined =>
  blueprint.arena.props.some((prop) => prop.id === id)
    ? undefined
    : refuse('edit.unknown_prop', `The arena has no prop of the child's with the id '${String(id)}'.`);

const moveProp: Reducer<'move-prop'> = (blueprint, command) => {
  const missing = childsProp(blueprint, command.propId);
  if (missing) return missing;
  const props = blueprint.arena.props.map((prop) => (prop.id === command.propId ? { ...prop, at: copyData(command.at) as Pose } : prop));
  return draft({ ...blueprint, arena: { ...blueprint.arena, props } });
};

const removeProp: Reducer<'remove-prop'> = (blueprint, command) => {
  const missing = childsProp(blueprint, command.propId);
  if (missing) return missing;
  return draft({ ...blueprint, arena: { ...blueprint.arena, props: blueprint.arena.props.filter((prop) => prop.id !== command.propId) } });
};

const rename: Reducer<'rename'> = (blueprint, command) => draft({ ...blueprint, meta: { ...blueprint.meta, name: command.name } });

/** Every command task 3.2 builds. */
export const PLACEMENT_REDUCERS: Reducers = {
  'place-part': placePart,
  'move-part': movePart,
  'rotate-part': rotatePart,
  'remove-part': removePart,
  mount: mountPart,
  unmount: unmountPart,
  'set-setting': setSetting,
  'set-arena': setArena,
  'place-prop': placeProp,
  'move-prop': moveProp,
  'remove-prop': removeProp,
  rename,
};

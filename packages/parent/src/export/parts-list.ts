// The parts-list export (task 5.3): a pure function of one blueprint and the catalogue, so a family can get the real
// parts and rebuild the build. Every name, family, port label and safety note comes from the part records (ground
// rule 1); nothing here knows any part by its id. Under D23 the app fixes a part on a mirrored mount point as its
// mirror image, so two DC motors wired alike drive forward; a real kit cannot mirror a motor, so the wiring crosses the
// leads of each motor whose turning a mirror flips, and says why (D27).
import { PART_FAMILIES, PORT_TYPE_STYLE } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  ChoiceOption,
  ChoiceSetting,
  MountPointPort,
  PartRecord,
  PlacedPart,
  PlacedPartId,
  PortId,
  PortRef,
  PortSpec,
  SpeedActuator,
  Text,
} from '@servo/schema';
import type { PartsList, PartsListOf } from '../index.ts';

/** Thrown for a blueprint that names a part type or port the catalogue does not have. */
export class UnknownPart extends Error {
  constructor(what: string) {
    super(`The catalogue has no ${what}.`);
    this.name = 'UnknownPart';
  }
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The real-kit lines the wiring adds for a part whose leads are crossed (D27). None has an exclamation mark. */
export const CROSSING_TEXT = {
  marker: 'crossed for a real kit',
  cross: (part: string, pos: Text, neg: Text): string =>
    `In a real kit, cross the two leads of the ${part}: its ${pos} lead goes where the app shows ${neg}, and its ${neg} lead where the app shows ${pos}.`,
  mirrored: (type: Text, point: Text, frame: Text): string =>
    `Why: a real ${type} on the ${point} of the ${frame} faces the other way, so wired as the app shows it, it would turn the wrong way.`,
  setting: (type: Text, setting: Text, option: Text): string =>
    `Why: the app has this ${type}'s ${setting} set to ${option}, and a real ${type} has no such setting.`,
  adult: 'An adult should cross the leads, with the power disconnected.',
} as const;

const familyOrder = new Map<string, number>(PART_FAMILIES.map((family, index) => [family.id, index]));

interface Resolved {
  readonly placed: PlacedPart;
  readonly record: PartRecord;
  readonly port: PortSpec;
}

/** Why a part's two leads are crossed in a real kit, or nothing when they are wired as the app shows. */
type Crossing =
  | { readonly by: 'mirror'; readonly frame: PartRecord; readonly point: MountPointPort }
  | { readonly by: 'setting'; readonly setting: ChoiceSetting; readonly option: ChoiceOption };

const isMountPoint = (port: PortSpec): port is MountPointPort => port.type === 'mechanical' && port.role === 'mount-point';

/** A choice setting bound to the actuator's `reverse` and the option it is at on this placed part, when that turns it backwards. */
const reversedBySetting = (placed: PlacedPart, record: PartRecord, actuator: SpeedActuator): Crossing | undefined => {
  const setting = record.settings.find(
    (candidate): candidate is ChoiceSetting => candidate.kind === 'choice' && candidate.binds.primitive === actuator.id && candidate.binds.param === 'reverse',
  );
  if (!setting) return undefined;
  const chosen = placed.settings[setting.id] ?? setting.default;
  const option = setting.options.find((candidate) => candidate.id === chosen);
  return option?.value === true ? { by: 'setting', setting, option } : undefined;
};

export const partsListFrom: PartsListOf = (blueprint: Blueprint, catalogue: Catalogue): PartsList => {
  const placedById = new Map<PlacedPartId, PlacedPart>(blueprint.parts.map((placed) => [placed.id, placed]));
  const recordOf = (placed: PlacedPart): PartRecord => {
    const record = catalogue.parts.get(placed.part);
    if (!record) throw new UnknownPart(`part type '${placed.part}'`);
    return record;
  };
  const resolve = (ref: PortRef): Resolved => {
    const placed = placedById.get(ref.part);
    if (!placed) throw new UnknownPart(`placed part '${ref.part}'`);
    const record = recordOf(placed);
    const port = record.ports.find((candidate) => candidate.id === ref.port);
    if (!port) throw new UnknownPart(`port '${ref.port}' on '${placed.part}'`);
    return { placed, record, port };
  };
  // Parts in id order (as canonical form keeps them), so numbering and notes do not hang on the order given.
  const ordered = [...blueprint.parts].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const placed of ordered) recordOf(placed);

  // Where each part is fixed: the mount point (and its frame) its mount is wired to.
  const fixedAt = new Map<PlacedPartId, { readonly frame: Resolved; readonly point: MountPointPort }>();
  for (const wire of blueprint.wires) {
    const [a, b] = [resolve(wire.from), resolve(wire.to)];
    for (const [part, frame] of [
      [a, b],
      [b, a],
    ] as const) {
      if (part.port.type === 'mechanical' && part.port.role === 'mount' && isMountPoint(frame.port)) fixedAt.set(part.placed.id, { frame, point: frame.port });
    }
  }

  // How each placed part is named on the list: its real name, and, when the build has more than one of its type, the
  // mount point it is fixed to, or a number in id order. Placed-part ids are never shown.
  const nameOf = new Map<PlacedPartId, string>();
  const byType = new Map<string, PlacedPart[]>();
  for (const placed of ordered) byType.set(placed.part, [...(byType.get(placed.part) ?? []), placed]);
  for (const [, instances] of byType) {
    const name = recordOf(instances[0] as PlacedPart).identity.name;
    if (instances.length === 1) {
      nameOf.set((instances[0] as PlacedPart).id, name);
      continue;
    }
    const labels = instances.map((placed) => fixedAt.get(placed.id)?.point.label);
    let number = 0;
    instances.forEach((placed, index) => {
      const label = labels[index];
      const unique = label !== undefined && labels.filter((other) => other === label).length === 1;
      nameOf.set(placed.id, unique ? `${name} (${label})` : `${name} ${(number += 1)}`);
    });
  }
  const named = (placed: PlacedPart): string => nameOf.get(placed.id) ?? recordOf(placed).identity.name;

  // The parts whose two leads a real kit crosses: each speed actuator that turns the other way when its supply is
  // reversed, fixed as a mirror image or set to turn backwards, but not both (the two cancel).
  const crossings: { readonly placed: PlacedPart; readonly actuator: SpeedActuator; readonly why: Crossing }[] = [];
  for (const placed of ordered) {
    const record = recordOf(placed);
    for (const primitive of record.behaviour) {
      if (primitive.kind !== 'actuator' || primitive.mode !== 'speed' || primitive.whenReversed !== 'reverses') continue;
      const fixed = fixedAt.get(placed.id);
      const mirror: Crossing | undefined = fixed?.point.mirrored ? { by: 'mirror', frame: fixed.frame.record, point: fixed.point } : undefined;
      const setting = reversedBySetting(placed, record, primitive);
      const why = mirror && setting ? undefined : (mirror ?? setting);
      if (why) crossings.push({ placed, actuator: primitive, why });
    }
  }
  const swapped = new Map<PlacedPartId, Map<PortId, PortId>>();
  for (const { placed, actuator } of crossings) {
    const ports = swapped.get(placed.id) ?? new Map<PortId, PortId>();
    ports.set(actuator.supply.pos, actuator.supply.neg);
    ports.set(actuator.supply.neg, actuator.supply.pos);
    swapped.set(placed.id, ports);
  }

  // One line per wire, in build order: mounts, then mechanical linkages, then power lines, then signal lines, each group
  // sorted by its text so the list does not hang on the order the blueprint keeps its wires in.
  const end = (side: Resolved, crossed: boolean): string => {
    const other = crossed ? swapped.get(side.placed.id)?.get(side.port.id) : undefined;
    const port = side.record.ports.find((candidate) => candidate.id === other) ?? side.port;
    return `${named(side.placed)}, ${port.label}`;
  };
  const groups: [string[], string[], string[], string[]] = [[], [], [], []];
  for (const wire of blueprint.wires) {
    const a = resolve(wire.from);
    const b = resolve(wire.to);
    const style = PORT_TYPE_STYLE[a.port.type];
    if (a.port.type === 'mechanical' && b.port.type === 'mechanical') {
      const mount = a.port.role === 'mount' || b.port.role === 'mount';
      if (mount) {
        const [part, frame] = a.port.role === 'mount' ? [a, b] : [b, a];
        groups[0].push(`Mount (${style.colour}): ${named(part.placed)} to ${end(frame, false)}`);
      } else {
        const [from, to] = a.port.role === 'drive-out' ? [a, b] : [b, a];
        groups[1].push(`${capitalise(style.name)} (${style.colour}): ${end(from, false)} to ${end(to, false)}`);
      }
      continue;
    }
    const crossed = (side: Resolved): boolean => swapped.get(side.placed.id)?.has(side.port.id) ?? false;
    const marker = crossed(a) || crossed(b) ? ` (${CROSSING_TEXT.marker})` : '';
    const line = `${capitalise(style.name)} (${style.colour}): ${end(a, crossed(a))} to ${end(b, crossed(b))}${marker}`;
    groups[a.port.type === 'power' ? 2 : 3].push(line);
  }
  const notes = crossings.flatMap(({ placed, actuator, why }) => {
    const record = recordOf(placed);
    const label = (id: PortId): Text => record.ports.find((port) => port.id === id)?.label ?? id;
    const type = record.identity.name;
    return [
      CROSSING_TEXT.cross(named(placed), label(actuator.supply.pos), label(actuator.supply.neg)),
      why.by === 'mirror' ? CROSSING_TEXT.mirrored(type, why.point.label, why.frame.identity.name) : CROSSING_TEXT.setting(type, why.setting.label, why.option.label),
      CROSSING_TEXT.adult,
    ];
  });

  // Each part type once, in family order, then by name.
  const parts = [...byType.entries()]
    .map(([, instances]) => {
      const record = recordOf(instances[0] as PlacedPart);
      return { part: record.id, name: record.identity.name, family: record.identity.family, quantity: instances.length };
    })
    .sort((x, y) => (familyOrder.get(x.family) ?? 0) - (familyOrder.get(y.family) ?? 0) || x.name.localeCompare(y.name, 'en'));

  const safetyNotes: Text[] = [];
  for (const entry of parts) {
    const note = catalogue.parts.get(entry.part)?.card.safetyNote;
    if (note !== undefined && !safetyNotes.includes(note)) safetyNotes.push(note);
  }

  return {
    blueprint: { id: blueprint.meta.id, name: blueprint.meta.name },
    parts,
    wiring: [...groups.flatMap((lines) => lines.sort((x, y) => x.localeCompare(y, 'en'))), ...notes],
    safetyNotes,
  };
};

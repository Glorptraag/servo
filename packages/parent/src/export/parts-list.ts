// The parts-list export (task 5.3): a pure function of one blueprint and the catalogue, so a family can get the real
// parts and rebuild the build. Every name, family, port label and safety note comes from the part records (ground
// rule 1); nothing here knows any part by its id. Under D23 the app fixes a part on a mirrored mount point as its
// mirror image, so two DC motors wired alike drive forward. A real kit cannot mirror a motor, so the connection lines
// are the real kit's, with that motor's leads already crossed and marked, and a separate note says so and why (D27).
// The connection lines are the only steps; the notes never ask for anything to be crossed again.
import { PART_FAMILIES, PORT_TYPE_STYLE, placeParts } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  ChoiceOption,
  ChoiceSetting,
  DriverPrimitive,
  MountPointPort,
  PartRecord,
  PlacedPart,
  PlacedPartId,
  PortId,
  PortRef,
  PortSpec,
  PortType,
  PowerPair,
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

/** Every line the list writes, for the copy pass. None has an exclamation mark or praise (ground rule 7). */
export const LIST_TEXT = {
  /** One end of a connection: the part, then the port. */
  end: (part: string, port: Text): string => `${part}, ${port}`,
  mount: (colour: string, part: string, frame: string): string => `Mount (${colour}): ${part} to ${frame}`,
  connection: (kind: string, colour: string, from: string, to: string): string => `${capitalise(kind)} (${colour}): ${from} to ${to}`,
  marker: 'crossed for a real kit',
  marked: (line: string): string => `${line} (crossed for a real kit)`,
  /** The real-kit notes: explanations, never steps. */
  alreadyCrossed: (part: string, pos: Text, neg: Text): string =>
    `The power lines marked “crossed for a real kit” already swap the ${pos} and ${neg} leads of the ${part}, so wire them as listed. Do not swap them again.`,
  mirrored: (type: Text, point: Text, frame: Text): string =>
    `Why: a real ${type} on the ${point} of the ${frame} faces the other way to the app's, so wired as the app shows it, it would turn the wrong way.`,
  turnedRound: (type: Text): string =>
    `Why: a real ${type} here faces the other way to the app's, so wired as the app shows it, it would turn the wrong way.`,
  setting: (part: string, setting: Text, option: Text): string =>
    `Why: the app has the ${part}'s ${setting} set to ${option}, and the real part has no such setting, so the swap does the same job.`,
  stopped: (part: string, setting: Text, option: Text, pos: Text, neg: Text): string =>
    `The app has the ${part}'s ${setting} set to ${option}, so this list connects nothing to its ${pos} and ${neg}.`,
  adult: 'An adult should make every connection with the power disconnected.',
  polarity: (type: Text): string => `If the real robot drives backward where the app's drives forward, swap the two leads of every ${type}.`,
} as const;

const familyOrder = new Map<string, number>(PART_FAMILIES.map((family, index) => [family.id, index]));

interface Resolved {
  readonly placed: PlacedPart;
  readonly record: PartRecord;
  readonly port: PortSpec;
}

const isMountPoint = (port: PortSpec): port is MountPointPort => port.type === 'mechanical' && port.role === 'mount-point';

/** The option a choice setting bound to `primitive.param` is at on this placed part, if the record has one. */
const chosenOption = (placed: PlacedPart, record: PartRecord, primitive: string, param: string): { setting: ChoiceSetting; option: ChoiceOption } | undefined => {
  const setting = record.settings.find(
    (candidate): candidate is ChoiceSetting => candidate.kind === 'choice' && candidate.binds.primitive === primitive && candidate.binds.param === param,
  );
  if (!setting) return undefined;
  const chosen = placed.settings[setting.id] ?? setting.default;
  const option = setting.options.find((candidate) => candidate.id === chosen);
  return option ? { setting, option } : undefined;
};

/** Leads a real kit swaps, and why: a pair of power ports on one placed part. */
interface Crossing {
  readonly placed: PlacedPart;
  readonly pair: PowerPair;
  readonly why: string;
}

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
  const wires = blueprint.wires.map((wire) => ({ a: resolve(wire.from), b: resolve(wire.to) }));

  // Where each part is fixed: the mount point (and its frame) its mount is wired to.
  const fixedAt = new Map<PlacedPartId, { readonly frame: Resolved; readonly point: MountPointPort }>();
  for (const { a, b } of wires) {
    for (const [part, frame] of [
      [a, b],
      [b, a],
    ] as const) {
      if (part.port.type === 'mechanical' && part.port.role === 'mount' && isMountPoint(frame.port)) fixedAt.set(part.placed.id, { frame, point: frame.port });
    }
  }
  // Whether the app shows a part as a mirror image, composed through every host it is fixed to or carried by.
  const placements = placeParts(blueprint, catalogue);

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
  const signalled = new Set(wires.flatMap(({ a, b }) => (a.port.type === 'signal' ? [`${a.placed.id}/${a.port.id}`, `${b.placed.id}/${b.port.id}`] : [])));

  // The leads a real kit swaps, so the real robot turns as the app's does:
  // - a speed actuator that turns the other way when its supply is reversed (a DC motor), when the app shows it as a
  //   mirror image or has it set to turn backwards, but not both (the two cancel);
  // - a motor-driver channel with no signal, whose setting runs it backwards. One set to stop has nothing connected.
  const crossings: Crossing[] = [];
  const stopped: { readonly placed: PlacedPart; readonly pair: PowerPair; readonly setting: ChoiceSetting; readonly option: ChoiceOption }[] = [];
  let reversingType: Text | undefined;
  for (const placed of ordered) {
    const record = recordOf(placed);
    for (const primitive of record.behaviour) {
      if (primitive.kind === 'actuator' && primitive.mode === 'speed' && primitive.whenReversed === 'reverses') {
        reversingType ??= record.identity.name;
        const actuator: SpeedActuator = primitive;
        const mirrored = placements.get(placed.id)?.placement.mirrored ?? false;
        const chosen = chosenOption(placed, record, actuator.id, 'reverse');
        const backward = chosen?.option.value === true;
        if (mirrored === backward) continue;
        const fixed = fixedAt.get(placed.id);
        const why = backward
          ? LIST_TEXT.setting(named(placed), chosen?.setting.label ?? '', chosen?.option.label ?? '')
          : fixed?.point.mirrored
            ? LIST_TEXT.mirrored(record.identity.name, fixed.point.label, fixed.frame.record.identity.name)
            : LIST_TEXT.turnedRound(record.identity.name);
        crossings.push({ placed, pair: actuator.supply, why });
      }
      if (primitive.kind === 'driver') {
        const driver: DriverPrimitive = primitive;
        if (driver.signal !== undefined && signalled.has(`${placed.id}/${driver.signal}`)) continue;
        const chosen = chosenOption(placed, record, driver.id, 'command');
        const command = typeof chosen?.option.value === 'number' ? chosen.option.value : driver.command;
        if (command < 0 && chosen) crossings.push({ placed, pair: driver.output, why: LIST_TEXT.setting(named(placed), chosen.setting.label, chosen.option.label) });
        if (command === 0 && chosen) stopped.push({ placed, pair: driver.output, ...chosen });
      }
    }
  }
  const swapped = new Map<string, PortId>();
  for (const { placed, pair } of crossings) {
    swapped.set(`${placed.id}/${pair.pos}`, pair.neg);
    swapped.set(`${placed.id}/${pair.neg}`, pair.pos);
  }
  const left = new Set(stopped.flatMap(({ placed, pair }) => [`${placed.id}/${pair.pos}`, `${placed.id}/${pair.neg}`]));
  const keyOf = (side: Resolved): string => `${side.placed.id}/${side.port.id}`;
  const labelOf = (placed: PlacedPart, port: PortId): Text => recordOf(placed).ports.find((candidate) => candidate.id === port)?.label ?? port;

  // One line per wire, in build order: mounts, then mechanical linkages, then power lines, then signal lines, each group
  // sorted by its text so the list does not hang on the order the blueprint keeps its wires in.
  const end = (side: Resolved): string => {
    const port = swapped.get(keyOf(side)) ?? side.port.id;
    return LIST_TEXT.end(named(side.placed), labelOf(side.placed, port));
  };
  const style = (type: PortType) => PORT_TYPE_STYLE[type];
  const groups: [string[], string[], string[], string[]] = [[], [], [], []];
  const crossedParts = new Set<PlacedPartId>();
  for (const { a, b } of wires) {
    if (a.port.type === 'mechanical' && b.port.type === 'mechanical') {
      if (a.port.role === 'mount' || b.port.role === 'mount') {
        const [part, frame] = a.port.role === 'mount' ? [a, b] : [b, a];
        groups[0].push(LIST_TEXT.mount(style('mechanical').colour, named(part.placed), end(frame)));
      } else {
        const [from, to] = a.port.role === 'drive-out' ? [a, b] : [b, a];
        groups[1].push(LIST_TEXT.connection(style('mechanical').name, style('mechanical').colour, end(from), end(to)));
      }
      continue;
    }
    if (left.has(keyOf(a)) || left.has(keyOf(b))) continue;
    const line = LIST_TEXT.connection(style(a.port.type).name, style(a.port.type).colour, end(a), end(b));
    const crossed = [a, b].filter((side) => swapped.has(keyOf(side)));
    for (const side of crossed) crossedParts.add(side.placed.id);
    groups[a.port.type === 'power' ? 2 : 3].push(crossed.length > 0 ? LIST_TEXT.marked(line) : line);
  }

  const realKit = [
    ...crossings
      .filter(({ placed }) => crossedParts.has(placed.id))
      .flatMap(({ placed, pair, why }) => [LIST_TEXT.alreadyCrossed(named(placed), labelOf(placed, pair.pos), labelOf(placed, pair.neg)), why]),
    ...stopped.map(({ placed, pair, setting, option }) => LIST_TEXT.stopped(named(placed), setting.label, option.label, labelOf(placed, pair.pos), labelOf(placed, pair.neg))),
  ];
  if (realKit.length > 0) realKit.push(LIST_TEXT.adult);
  if (reversingType !== undefined) realKit.push(LIST_TEXT.polarity(reversingType));

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
    wiring: groups.flatMap((lines) => lines.sort((x, y) => x.localeCompare(y, 'en'))),
    realKit,
    safetyNotes,
  };
};

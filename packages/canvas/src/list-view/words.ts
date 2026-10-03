// The list view's words (task 3.6): every part, port, wire and prop as one plain line to read aloud, with the real
// names from the part records (ground rule 7). System text: no exclamation marks, no praise, no character voice. Pure.
// See README.md, "The list view".
import { PORT_TYPE_STYLE, cosSin, placeParts } from '@servo/schema';
import type { ArenaPreset, Blueprint, Catalogue, PartPlacement, PartRecord, PlacedPart, PlacedPartId, PortRef, PortSpec, Prop, Wire } from '@servo/schema';
import { compareIds } from '../scene/geometry.ts';

/** Ids in reading order: `p2` before `p10`, as a child counts them. */
export const naturalCompare = (a: string, b: string): number => {
  const ma = /^(.*?)(\d+)$/.exec(a);
  const mb = /^(.*?)(\d+)$/.exec(b);
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]) || compareIds(a, b);
  return compareIds(a, b);
};

/** A label as it reads mid-sentence: `Speed` becomes `speed`, while `LED` stays `LED`. */
export const midSentence = (text: string): string =>
  text.length > 1 && text[0] !== text[0]?.toLowerCase() && text[1] === text[1]?.toLowerCase() ? (text[0]?.toLowerCase() ?? '') + text.slice(1) : text;

/** `a`, `a and b`, `a, b and c`. */
export const listOf = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;

/** A value with its real unit: `60%`, `90°`, `6 V`. */
export const withUnit = (value: number, unit: string): string => (unit === '' || unit === '%' || unit === '°' ? `${value}${unit}` : `${value} ${unit}`);

/** What the list view reads from a build: each part's record and title, and what holds what. */
export interface Names {
  readonly parts: readonly PlacedPart[];
  record(partId: PlacedPartId): PartRecord | undefined;
  /**
   * The part's real name, numbered when the build has more than one of its type (`DC motor 1`, `DC motor 2`, in id
   * order), so a listener can tell them apart.
   */
  title(partId: PlacedPartId): string;
  port(ref: PortRef): PortSpec | undefined;
  /** `DC motor 1 plus (+)`. */
  portPhrase(ref: PortRef): string;
  placement(partId: PlacedPartId): PartPlacement | undefined;
}

export const namesOf = (blueprint: Blueprint, catalogue: Catalogue): Names => {
  const parts = [...blueprint.parts].sort((a, b) => naturalCompare(a.id, b.id));
  const byId = new Map(parts.map((part) => [part.id, part] as const));
  const titles = new Map<PlacedPartId, string>();
  const counts = new Map<string, number>();
  for (const part of parts) counts.set(part.part, (counts.get(part.part) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const part of parts) {
    const name = catalogue.parts.get(part.part)?.identity.name ?? part.part;
    const index = (seen.get(part.part) ?? 0) + 1;
    seen.set(part.part, index);
    titles.set(part.id, (counts.get(part.part) ?? 0) > 1 ? `${name} ${index}` : name);
  }
  let placements: ReadonlyMap<PlacedPartId, PartPlacement> | undefined;
  const record = (partId: PlacedPartId): PartRecord | undefined => {
    const part = byId.get(partId);
    return part && catalogue.parts.get(part.part);
  };
  const port = (ref: PortRef): PortSpec | undefined => record(ref.part)?.ports.find((spec) => spec.id === ref.port);
  const title = (partId: PlacedPartId): string => titles.get(partId) ?? partId;
  return {
    parts,
    record,
    title,
    port,
    portPhrase: (ref) => `${title(ref.part)} ${port(ref)?.label ?? ref.port}`,
    placement: (partId) => {
      placements ??= placeParts(blueprint, catalogue);
      return placements.get(partId);
    },
  };
};

export type WireKindName = 'power' | 'signal' | 'drive' | 'mount';

/** `power line from 2-cell battery pack plus (+) to DC motor 1 plus (+)`. */
export const wireDescription = (names: Names, wire: Wire, kind: WireKindName): string => {
  const from = names.portPhrase(wire.from);
  const to = names.portPhrase(wire.to);
  if (kind === 'mount') return `mount: ${names.title(wire.from.part)} fixed to ${to}`;
  const what = kind === 'drive' ? 'drive linkage' : PORT_TYPE_STYLE[kind].name;
  return `${what} from ${from} to ${to}`;
};

/** How a part is held, as it reads after its title: `mounted on chassis left motor mount`, `on DC motor 1 shaft`, `loose`. */
export const heldPhrase = (names: Names, blueprint: Blueprint, partId: PlacedPartId): string | undefined => {
  const placement = names.placement(partId);
  const holder = placement?.parent;
  if (placement && holder !== undefined && placement.by !== 'root') {
    const wire = blueprint.wires.find(
      (candidate) =>
        (candidate.from.part === partId && candidate.to.part === holder) || (candidate.to.part === partId && candidate.from.part === holder),
    );
    const onto = wire ? (wire.from.part === holder ? wire.from : wire.to) : undefined;
    const where = onto ? names.portPhrase(onto) : names.title(holder);
    return placement.by === 'mount' ? `mounted on ${where}` : `on ${where}`;
  }
  // Only a part that can be fixed or carried is loose; a chassis is simply where it is.
  const canBeHeld = names.record(partId)?.ports.some((spec) => spec.type === 'mechanical' && (spec.role === 'mount' || spec.role === 'drive-in'));
  return canBeHeld ? 'loose' : undefined;
};

/** Which way an arena point lies from the robot's start: `ahead of the robot`, `behind and to the left of the robot`. */
export const directionFrom = (preset: ArenaPreset, point: { readonly x: number; readonly y: number }): string => {
  const dx = point.x - preset.start.x;
  const dy = point.y - preset.start.y;
  const [c, s] = cosSin(preset.start.heading);
  const ahead = dx * c + dy * s;
  const left = -dx * s + dy * c;
  const far = Math.max(Math.abs(ahead), Math.abs(left));
  if (far < 1) return 'where the robot starts';
  const words: string[] = [];
  if (Math.abs(ahead) >= far / 4) words.push(ahead > 0 ? 'ahead' : 'behind');
  if (Math.abs(left) >= far / 4) words.push(left > 0 ? 'to the left' : 'to the right');
  return `${words.join(' and ')} of the robot`;
};

/** `box, 100 by 100 millimetres, ahead of the robot`; a preset's own prop is `part of the arena`. */
export const propDescription = (prop: Prop, preset: ArenaPreset | undefined, ownedByPreset: boolean): string => {
  const size = prop.shape === 'box' ? `${prop.size.x} by ${prop.size.y} millimetres` : `${prop.size.x} millimetres across`;
  const words = [prop.shape, size];
  if (preset) words.push(directionFrom(preset, prop.at));
  if (prop.fixed) words.push('fixed in place');
  if (ownedByPreset) words.push('part of the arena');
  return words.join(', ');
};

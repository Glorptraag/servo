// The tray's tiles (task 4.2): the kit's parts, grouped by the family their part records give them, from data alone
// (ground rule 1). No DOM, so the unit tests read it.
import { PART_FAMILIES } from '@servo/schema';
import type { Catalogue, HexColour, Kit, Level, PartFamily, PartRecord, PartTypeId } from '@servo/schema';
import type { ArtRegistry } from '@servo/content';

export interface TrayTile {
  readonly part: PartTypeId;
  /** The part record's real name as a title: its first letter capitalised (`Large wheel`, `DC motor`). */
  readonly title: string;
  /** The real name as it reads mid-sentence (`large wheel`). */
  readonly name: string;
  /** How many the kit holds. */
  readonly quantity: number;
  /** The swap registry's picture, when there is one. */
  readonly picture: string | undefined;
  /** The record's placeholder colours, for the tile drawn when there is no picture (ground rule 12). */
  readonly colours: { readonly main: HexColour; readonly accent: HexColour };
}

export interface TrayGroup {
  readonly family: PartFamily;
  /** The family's name from the schema's taxonomy (`Structure & Ride`). */
  readonly label: string;
  readonly tiles: readonly TrayTile[];
}

/** A real name as a title: `battery pack` → `Battery pack`; `LED` stays `LED`. */
export const titleOf = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

export const familyLabel = (family: PartFamily): string => PART_FAMILIES.find((each) => each.id === family)?.label ?? family;

export const tileOf = (record: PartRecord, quantity: number, art?: ArtRegistry): TrayTile => ({
  part: record.id,
  title: titleOf(record.identity.name),
  name: record.identity.name,
  quantity,
  picture: art?.get(record.identity.art)?.src,
  colours: record.identity.colours,
});

/**
 * Exactly the kit's parts, each once, grouped by the family in its part record. Groups come in the order the kit's
 * tray first meets each family, and tiles in the kit's tray order; a part the catalogue lacks is left out.
 */
export const trayGroups = (kit: Kit, catalogue: Catalogue, art?: ArtRegistry): TrayGroup[] => {
  const quantities = new Map(kit.parts.map((entry) => [entry.part, entry.quantity]));
  const order = [...kit.tray.flatMap((group) => group.parts), ...kit.parts.map((entry) => entry.part)];
  const groups = new Map<PartFamily, TrayTile[]>();
  const seen = new Set<PartTypeId>();
  for (const part of order) {
    const quantity = quantities.get(part);
    const record = catalogue.parts.get(part);
    if (seen.has(part) || quantity === undefined || !record) continue;
    seen.add(part);
    const family = record.identity.family;
    const tiles = groups.get(family) ?? [];
    tiles.push(tileOf(record, quantity, art));
    groups.set(family, tiles);
  }
  return [...groups].map(([family, tiles]) => ({ family, label: familyLabel(family), tiles }));
};

/** The kit at the child's level: the sandbox's tray until Home chooses one (D68). */
export const kitForLevel = (kits: readonly Kit[], level: Level): Kit | undefined => kits.find((kit) => kit.level === level);

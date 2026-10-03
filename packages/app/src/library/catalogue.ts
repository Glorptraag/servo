// The Parts Library's model (task 4.2): the whole catalogue organised by family, with a family filter and a domain
// filter (brief Section 9), from the part records alone (ground rule 1). No DOM, so the unit tests read it.
import { DOMAINS, PART_FAMILIES } from '@servo/schema';
import type { Domain, Level, PartFamily, PartRecord } from '@servo/schema';
import type { ArtRegistry } from '@servo/content';
import { familyLabel, tileOf } from '../tray/tiles.ts';
import type { TrayTile } from '../tray/tiles.ts';

export interface LibraryCard extends Omit<TrayTile, 'quantity'> {
  readonly family: PartFamily;
  readonly domains: readonly Domain[];
  /** The level the part is introduced at. */
  readonly level: Level;
}

export interface LibraryShelf {
  readonly family: PartFamily;
  readonly label: string;
  readonly cards: readonly LibraryCard[];
}

/** No filter: every family, or every domain. */
export const ALL = 'all';

export interface LibraryFilter {
  readonly family: PartFamily | typeof ALL;
  readonly domain: Domain | typeof ALL;
}

export const NO_FILTER: LibraryFilter = { family: ALL, domain: ALL };

export interface FilterOption<T extends string> {
  readonly id: T;
  readonly label: string;
}

export const domainLabel = (domain: Domain): string => DOMAINS.find((each) => each.id === domain)?.label ?? domain;

const cardOf = (record: PartRecord, art?: ArtRegistry): LibraryCard => {
  const { part, title, name, picture, colours } = tileOf(record, 1, art);
  return { part, title, name, picture, colours, family: record.identity.family, domains: record.identity.domains, level: record.identity.level };
};

/** The families that hold a part, in the taxonomy's order: an empty family is never offered. */
export const familyOptions = (parts: readonly PartRecord[]): FilterOption<PartFamily>[] =>
  PART_FAMILIES.filter((family) => parts.some((part) => part.identity.family === family.id)).map(({ id, label }) => ({ id, label }));

/** The domains some part belongs to, in the taxonomy's order. */
export const domainOptions = (parts: readonly PartRecord[]): FilterOption<Domain>[] =>
  DOMAINS.filter((domain) => parts.some((part) => part.identity.domains.includes(domain.id))).map(({ id, label }) => ({ id, label }));

const matches = (record: PartRecord, filter: LibraryFilter): boolean =>
  (filter.family === ALL || record.identity.family === filter.family) && (filter.domain === ALL || record.identity.domains.includes(filter.domain));

/**
 * The catalogue's parts that pass the filter, on one shelf per family in the taxonomy's order, each shelf by the level
 * a part is introduced at and then by name. An empty shelf is left out.
 */
export const libraryShelves = (parts: readonly PartRecord[], filter: LibraryFilter, art?: ArtRegistry): LibraryShelf[] =>
  PART_FAMILIES.flatMap(({ id: family }): LibraryShelf[] => {
    const cards = parts
      .filter((record) => record.identity.family === family && matches(record, filter))
      .map((record) => cardOf(record, art))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'en'));
    return cards.length > 0 ? [{ family, label: familyLabel(family), cards }] : [];
  });

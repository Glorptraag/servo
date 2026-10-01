import type { ArenaPreset } from '../types/arena.ts';
import type { ArenaPresetId, KitId, PartTypeId } from '../types/common.ts';
import type { Kit } from '../types/kit.ts';
import type { PartRecord } from '../types/part.ts';

/**
 * The content a blueprint, kit, challenge or run record is checked against. Records in it are assumed
 * valid (validate them first). Without `arenas` or `kits`, references to them are not checked.
 */
export interface Catalogue {
  readonly parts: ReadonlyMap<PartTypeId, PartRecord>;
  readonly arenas?: ReadonlyMap<ArenaPresetId, ArenaPreset>;
  readonly kits?: ReadonlyMap<KitId, Kit>;
}

export interface CatalogueInput {
  readonly parts: readonly PartRecord[];
  readonly arenas?: readonly ArenaPreset[];
  readonly kits?: readonly Kit[];
}

const byId = <T extends { readonly id: string }>(items: readonly T[]): ReadonlyMap<string, T> => {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
};

/** Indexes validated records by id. When two share an id, the first wins. */
export const makeCatalogue = (input: CatalogueInput): Catalogue => ({
  parts: byId(input.parts),
  ...(input.arenas ? { arenas: byId(input.arenas) } : {}),
  ...(input.kits ? { kits: byId(input.kits) } : {}),
});

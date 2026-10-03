// Changed builds for the screenshot mutation test: a fixture's build with one wire taken out, or one part with every
// wire on it. Each must fail its screenshot comparison and its probe. Pure. See README.md, "Screenshots".
import { placeParts } from '@servo/schema';
import type { Blueprint, Catalogue, PlacedPartId, WireId } from '@servo/schema';

export const withoutWire = (blueprint: Blueprint, wireId: WireId): Blueprint => {
  if (!blueprint.wires.some((wire) => wire.id === wireId)) throw new Error(`The build has no wire ${wireId}.`);
  return { ...blueprint, wires: blueprint.wires.filter((wire) => wire.id !== wireId) };
};

/** The build without a part and every wire on its ports. Anything it held would stay where it is, loose. */
export const withoutPart = (blueprint: Blueprint, partId: PlacedPartId): Blueprint => {
  if (!blueprint.parts.some((part) => part.id === partId)) throw new Error(`The build has no part ${partId}.`);
  return {
    ...blueprint,
    parts: blueprint.parts.filter((part) => part.id !== partId),
    wires: blueprint.wires.filter((wire) => wire.from.part !== partId && wire.to.part !== partId),
  };
};

/** Parts that hold no other part (by a mount point or a shaft), so taking one out moves nothing else. */
export const leafParts = (blueprint: Blueprint, catalogue: Catalogue): ReadonlySet<PlacedPartId> => {
  const holders = new Set([...placeParts(blueprint, catalogue).values()].flatMap((placement) => (placement.parent === undefined ? [] : [placement.parent])));
  return new Set(blueprint.parts.map((part) => part.id).filter((id) => !holders.has(id)));
};

// What the canvas says in its one plain line (brief Sections 10 and 12): system text in real words, one line, no
// exclamation mark (rule 7), no dialog (rule 9), and no full stop at the end, as a callout. Pure. See docs/placement.md.
import { checkPortPair, indexPlacedParts, resolvePort } from '@servo/schema';
import type { Blueprint, Catalogue } from '@servo/schema';
import { leftLoose } from './holding.ts';

/**
 * The wires a change removed: the power and signal lines a child sees go. Mounts and drive linkages are how parts are
 * held, and the parts they leave loose are named instead.
 */
export const removedWires = (before: Blueprint, after: Blueprint, catalogue: Catalogue): number => {
  const kept = new Set(after.wires.map((wire) => wire.id));
  const parts = indexPlacedParts(before.parts);
  let count = 0;
  for (const wire of before.wires) {
    if (kept.has(wire.id)) continue;
    const from = resolvePort(parts, catalogue, wire.from);
    const to = resolvePort(parts, catalogue, wire.to);
    if (!from.found || !to.found) continue;
    const pair = checkPortPair(from.spec, to.spec);
    if (pair.legal && (pair.kind === 'power' || pair.kind === 'signal')) count += 1;
  }
  return count;
};

/** D35: the real names of the parts left loose, each once, as the spec card lists needs. */
export const looseLine = (names: readonly string[]): string => {
  const distinct = [...new Set(names)];
  const last = distinct.pop() ?? '';
  return `Loose now: ${distinct.length > 0 ? `${distinct.join(', ')} and ${last}` : last}`;
};

/**
 * What a removal says (brief Section 10: "removing a part removes its wires and says so"; D35): the wires that went
 * with it, then the parts it left loose. Undefined when the change removed no part, or the part went alone.
 */
export const removalLine = (before: Blueprint, after: Blueprint, catalogue: Catalogue): string | undefined => {
  const remaining = new Set(after.parts.map((part) => part.id));
  if (before.parts.every((part) => remaining.has(part.id))) return undefined;
  const wires = removedWires(before, after, catalogue);
  const names = leftLoose(before, after, catalogue).map((id) => {
    const type = after.parts.find((part) => part.id === id)?.part ?? '';
    return catalogue.parts.get(type)?.identity.name ?? type;
  });
  const lines = [
    ...(wires > 0 ? [`Removed with it: ${wires} ${wires === 1 ? 'wire' : 'wires'}`] : []),
    ...(names.length > 0 ? [looseLine(names)] : []),
  ];
  return lines.length > 0 ? lines.join('. ') : undefined;
};

/** Why a held part has no rotate handle: its mount or its shaft sets its turn (D34). */
export const heldLine = (by: 'mount' | 'carried'): string =>
  by === 'mount' ? 'Held by its mount: move it off to turn it' : 'Held on a shaft: move it off to turn it';

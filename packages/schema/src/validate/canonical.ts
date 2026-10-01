import type { Blueprint, PlacedPart, SettingValue, Wire } from '../types/blueprint.ts';
import type { PlacedPartId, WireId } from '../types/common.ts';
import type { Catalogue } from './catalogue.ts';
import { compareText, isRecord, sameValue } from './reader.ts';
import { checkPortPair, comparePortRefs, indexPlacedParts, resolvePort } from './wiring.ts';

/**
 * Canonical form, so a blueprint is diffable and the same build is the same bytes whichever input path
 * made it (canvas touch, pointer or list view):
 * - object keys in code-unit order, two-space indent, a final newline;
 * - parts, wires and arena props in id order;
 * - every wire in stored orientation (power wires lower port reference first);
 * - settings only where they differ from the record's default.
 */

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareText)) {
    if (value[key] === undefined) continue;
    // defineProperty, so a key such as '__proto__' stays an ordinary key.
    Object.defineProperty(sorted, key, { value: sortKeys(value[key]), enumerable: true, writable: true, configurable: true });
  }
  return sorted;
};

/** JSON with keys in code-unit order, two-space indent and a final newline. Arrays keep their order. */
export const canonicalJson = (value: unknown): string => `${JSON.stringify(sortKeys(value), null, 2)}\n`;

const byId = <T extends { readonly id: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => compareText(a.id, b.id));

/** The blueprint as canonical JSON: id order for parts, wires and props, then `canonicalJson`. */
export const serializeBlueprint = (blueprint: Blueprint): string =>
  canonicalJson({
    ...blueprint,
    parts: byId(blueprint.parts),
    wires: byId(blueprint.wires),
    arena: { ...blueprint.arena, props: byId(blueprint.arena.props) },
  });

const withoutDefaults = (part: PlacedPart, catalogue: Catalogue): PlacedPart => {
  const record = catalogue.parts.get(part.part);
  if (!record) return part;
  const settings: Record<string, SettingValue> = {};
  for (const [id, value] of Object.entries(part.settings)) {
    const setting = record.settings.find((candidate) => candidate.id === id);
    if (!setting || !sameValue(setting.default, value)) settings[id] = value;
  }
  return { ...part, settings };
};

const oriented = (wire: Wire, parts: ReadonlyMap<string, PlacedPart>, catalogue: Catalogue): Wire => {
  const from = resolvePort(parts, catalogue, wire.from);
  const to = resolvePort(parts, catalogue, wire.to);
  if (!from.found || !to.found) return wire;
  const pair = checkPortPair(from.spec, to.spec);
  if (!pair.legal) return wire;
  const swap = pair.kind === 'power' ? comparePortRefs(wire.from, wire.to) > 0 : pair.swap;
  return swap ? { ...wire, from: wire.to, to: wire.from } : wire;
};

/**
 * Puts a valid blueprint in canonical form: parts, wires and props in id order, wires in stored
 * orientation, default-valued settings dropped. Returns a new blueprint; the input is untouched.
 */
export const canonicalizeBlueprint = (blueprint: Blueprint, catalogue: Catalogue): Blueprint => {
  const parts = indexPlacedParts(blueprint.parts);
  return {
    ...blueprint,
    parts: byId(blueprint.parts.map((part) => withoutDefaults(part, catalogue))),
    wires: byId(blueprint.wires.map((wire) => oriented(wire, parts, catalogue))),
    arena: { ...blueprint.arena, props: byId(blueprint.arena.props) },
  };
};

const nextId = (prefix: string, ids: readonly string[]): string => {
  let highest = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const digits = id.slice(prefix.length);
    if (!/^\d+$/.test(digits)) continue;
    const n = Number(digits);
    if (Number.isSafeInteger(n) && n > highest) highest = n;
  }
  return `${prefix}${highest + 1}`;
};

/**
 * The id for the next placed part: `p` and one more than the highest `p<number>` id in use. Every input
 * path allocates through this, so the same steps give the same ids.
 */
export const nextPlacedPartId = (blueprint: Blueprint): PlacedPartId => nextId('p', blueprint.parts.map((part) => part.id));

/** The id for the next wire: `w` and one more than the highest `w<number>` id in use. */
export const nextWireId = (blueprint: Blueprint): WireId => nextId('w', blueprint.wires.map((wire) => wire.id));

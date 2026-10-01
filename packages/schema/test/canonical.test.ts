import { describe, expect, it } from 'vitest';
import { validBlueprints } from '../src/fixtures.ts';
import {
  canonicalJson,
  canonicalizeBlueprint,
  claimPartId,
  claimWireId,
  planWire,
  serializeBlueprint,
  validateBlueprint,
} from '../src/index.ts';
import type { Blueprint, PartTypeId, PortRef } from '../src/index.ts';
import { catalogue, copy, reasons, unwrap } from './support.ts';

const fixture = (name: string): Blueprint => {
  const found = validBlueprints.find((entry) => entry.name === name);
  if (!found) throw new Error(`No fixture ${name}`);
  return unwrap(validateBlueprint(found.data, catalogue));
};

/** The same document with every object's keys and every id-keyed list in reverse order. */
const scrambled = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scrambled);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, inner]) => [key, ['parts', 'wires', 'props'].includes(key) && Array.isArray(inner) ? scrambled([...inner].reverse()) : scrambled(inner)]),
  );
};

const bytes = (blueprint: Blueprint): string => serializeBlueprint(canonicalizeBlueprint(blueprint, catalogue));

describe('serialisation is deterministic', () => {
  it.each(validBlueprints)('$name: key order and list order do not change the bytes', ({ name }) => {
    const blueprint = fixture(name);
    expect(bytes(scrambled(blueprint) as Blueprint)).toBe(bytes(blueprint));
  });

  it('writes keys in code-unit order with a two-space indent and a final newline', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: true } })).toBe(
      '{\n  "a": {\n    "c": true,\n    "d": [\n      3,\n      {\n        "e": 2,\n        "f": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it('leaves out undefined fields, so a stripped author leaves no trace', () => {
    const blueprint = fixture('rolling-start');
    const shared = { ...blueprint, meta: { ...blueprint.meta, author: undefined } };
    expect(serializeBlueprint(shared)).not.toContain('author');
    expect(reasons(validateBlueprint(JSON.parse(serializeBlueprint(shared)), catalogue))).toEqual([]);
  });

  it('keeps a "__proto__" key as plain data', () => {
    expect(JSON.parse(canonicalJson(JSON.parse('{"__proto__":{"x":1}}')))).toEqual(JSON.parse('{"__proto__":{"x":1}}'));
  });
});

describe('canonicalizeBlueprint', () => {
  it('writes power wires lower port reference first and directional wires source first', () => {
    const blueprint = fixture('motor-off-pin');
    const flipped = { ...blueprint, wires: blueprint.wires.map((wire) => ({ ...wire, from: wire.to, to: wire.from })) };
    expect(reasons(validateBlueprint(flipped, catalogue))).toEqual(['wire.reversed at $.wires[6]']);
    expect(canonicalizeBlueprint(flipped, catalogue)).toEqual(blueprint);
  });

  it('drops settings equal to their default and keeps the rest', () => {
    const blueprint = fixture('bumper-robot');
    const noisy = {
      ...blueprint,
      parts: blueprint.parts.map((part) =>
        part.id === 'driver' ? { ...part, settings: { 'motor-a': 'forward', 'motor-b': 'backward' } } : part,
      ),
    };
    const driver = canonicalizeBlueprint(noisy, catalogue).parts.find((part) => part.id === 'driver');
    expect(driver?.settings).toEqual({ 'motor-b': 'backward' });
  });

  it('returns a new blueprint and leaves its input alone', () => {
    const blueprint = fixture('rolling-start');
    const before = copy(blueprint);
    const reversed = { ...blueprint, parts: [...blueprint.parts].reverse() };
    canonicalizeBlueprint(reversed, catalogue);
    expect(blueprint).toEqual(before);
    expect(reversed.parts[0]?.id).toBe('wheel-right');
  });
});

describe('ids are claimed the same way on every input path, and never reused', () => {
  const base = fixture('led-circuit');
  const empty: Blueprint = { ...base, parts: [], wires: [], meta: { ...base.meta, highWater: { parts: 0, wires: 0 } } };
  const part = (id: string) => ({ id, part: 'led', position: { x: 0, y: 0 }, rotation: 0, settings: {} });

  it('claims one more than the high-water mark and raises it', () => {
    const first = claimPartId(empty);
    expect(first.id).toBe('p1');
    expect(first.meta.highWater).toEqual({ parts: 1, wires: 0 });
    expect(claimWireId(empty)).toMatchObject({ id: 'w1', meta: { highWater: { parts: 0, wires: 1 } } });
  });

  it('does not give a deleted id out again', () => {
    const { id, meta } = claimPartId(empty);
    const withPart: Blueprint = { ...empty, meta, parts: [part(id)] };
    const deleted: Blueprint = { ...withPart, parts: [] };
    expect(claimPartId(deleted).id).toBe('p2');
    expect(reasons(validateBlueprint({ ...deleted, parts: [part('p1')], meta: empty.meta }, catalogue))).toEqual([
      'id.above_high_water at $.parts[0].id',
    ]);
  });

  it('stays above any p<number> already in use in a hand-made blueprint', () => {
    const busy = { ...empty, parts: ['p1', 'p3', 'motor', 'p2x', 'p007'].map(part) };
    expect(claimPartId(busy).id).toBe('p8');
  });

  it('gives byte-identical blueprints when the same build is wired from opposite ends', () => {
    const place = (blueprint: Blueprint, type: PartTypeId): Blueprint => {
      const { id, meta } = claimPartId(blueprint);
      return { ...blueprint, meta, parts: [...blueprint.parts, { ...part(id), part: type }] };
    };
    const wire = (blueprint: Blueprint, a: PortRef, b: PortRef): Blueprint => {
      const plan = planWire(blueprint, catalogue, a, b);
      if (!plan.legal) throw new Error(plan.message);
      const { id, meta } = claimWireId(blueprint);
      return { ...blueprint, meta, wires: [...blueprint.wires, { id, from: plan.from, to: plan.to }] };
    };
    const ref = (part: string, port: string): PortRef => ({ part, port });
    const placed = ['battery-pack-2-cell', 'switch', 'led'].reduce(place, empty);

    // Canvas: each wire dragged from the battery side. List view: each wire picked from the other end.
    const canvas = [
      [ref('p1', 'plus'), ref('p2', 'a')],
      [ref('p2', 'b'), ref('p3', 'plus')],
      [ref('p3', 'minus'), ref('p1', 'minus')],
    ].reduce((blueprint, [a, b]) => wire(blueprint, a as PortRef, b as PortRef), placed);
    const listView = [
      [ref('p2', 'a'), ref('p1', 'plus')],
      [ref('p3', 'plus'), ref('p2', 'b')],
      [ref('p1', 'minus'), ref('p3', 'minus')],
    ].reduce((blueprint, [a, b]) => wire(blueprint, a as PortRef, b as PortRef), placed);

    expect(reasons(validateBlueprint(canvas, catalogue))).toEqual([]);
    expect(serializeBlueprint(listView)).toBe(serializeBlueprint(canvas));
  });
});

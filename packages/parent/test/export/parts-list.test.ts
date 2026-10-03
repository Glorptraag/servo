// The parts-list export (task 5.3), on the live content and its kit fixtures: every part type once with its family and
// quantity, a wiring line per connection, and the real-kit crossing of the motor on a mirrored mount (D27).
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { PART_FAMILIES } from '@servo/schema';
import type { Blueprint, PlacedPart, PortRef } from '@servo/schema';
import { CROSSING_TEXT, UnknownPart, partsListOf } from '../../src/index.ts';
import type { PartsList } from '../../src/index.ts';

const content = loadContent().content;
const catalogue = content.catalogue;
const fixtures = loadFixtures();
const fixture = (name: string): Blueprint => {
  const found = fixtures.fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No fixture ${name}.`);
  return found.blueprint;
};
const KITS = ['kit-rolling-start', 'kit-circuit-crew'] as const;

const familyIndex = (family: string): number => PART_FAMILIES.findIndex((entry) => entry.id === family);

/** Every placed-part id renamed to p1, p2, …, so a test can show no id reaches the list. */
const withPlainIds = (blueprint: Blueprint): Blueprint => {
  const ids = new Map(blueprint.parts.map((placed, index) => [placed.id, `p${index + 1}`]));
  const ref = (end: PortRef): PortRef => ({ ...end, part: ids.get(end.part) ?? end.part });
  return {
    ...blueprint,
    parts: blueprint.parts.map((placed) => ({ ...placed, id: ids.get(placed.id) ?? placed.id })),
    wires: blueprint.wires.map((wire) => ({ ...wire, from: ref(wire.from), to: ref(wire.to) })),
  };
};

const withSetting = (blueprint: Blueprint, id: string, settings: PlacedPart['settings']): Blueprint => ({
  ...blueprint,
  parts: blueprint.parts.map((placed) => (placed.id === id ? { ...placed, settings } : placed)),
});

const textOf = (list: PartsList): string[] => [...list.parts.map((entry) => entry.name), ...list.wiring, ...list.safetyNotes];

const banned = content.terminology.flatMap((file) => (file.data as { banned?: { phrase: string }[] }).banned ?? []).map((entry) => entry.phrase);
const bannedIn = (line: string): string[] =>
  banned.filter((phrase) => new RegExp(`(?<![\\p{L}\\p{N}-])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}-])`, phrase === 'I' ? 'u' : 'iu').test(line));

describe('the kit fixtures load', () => {
  it('with no content or fixture issue', () => {
    expect(fixtures.issues).toEqual([]);
    for (const name of KITS) expect(fixture(name).parts.length).toBeGreaterThan(0);
  });
});

describe.each(KITS)('the parts list of %s', (name) => {
  const blueprint = fixture(name);
  const list = partsListOf(blueprint, catalogue);

  it('lists every part type once, with its real name and family from its record, and how many the build uses', () => {
    const types = [...new Set(blueprint.parts.map((placed) => placed.part))];
    expect(list.parts.map((entry) => entry.part).sort()).toEqual([...types].sort());
    expect(new Set(list.parts.map((entry) => entry.part)).size).toBe(list.parts.length);
    for (const entry of list.parts) {
      const record = catalogue.parts.get(entry.part);
      expect(entry.name).toBe(record?.identity.name);
      expect(entry.family).toBe(record?.identity.family);
      expect(entry.quantity).toBe(blueprint.parts.filter((placed) => placed.part === entry.part).length);
    }
    expect(list.parts.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(blueprint.parts.length);
  });

  it('keeps family order', () => {
    const order = list.parts.map((entry) => familyIndex(entry.family));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('names the blueprint', () => {
    expect(list.blueprint).toEqual({ id: blueprint.meta.id, name: blueprint.meta.name });
  });

  it('gives one wiring line per connection, then the crossing note, reason and adult note (D27)', () => {
    expect(list.wiring).toHaveLength(blueprint.wires.length + 3);
    const notes = list.wiring.slice(blueprint.wires.length);
    expect(notes[0]).toBe(CROSSING_TEXT.cross('DC motor (right motor mount)', 'plus (+)', 'minus (−)'));
    expect(notes[1]).toBe(CROSSING_TEXT.mirrored('DC motor', 'right motor mount', 'chassis'));
    expect(notes[2]).toBe(CROSSING_TEXT.adult);
  });

  it('crosses the leads of the motor on the right motor mount only, in every line that reaches them', () => {
    const crossed = list.wiring.filter((line) => line.includes(CROSSING_TEXT.marker));
    expect(crossed).toHaveLength(2);
    for (const line of crossed) expect(line).toContain('DC motor (right motor mount), ');
    expect(crossed.some((line) => line.includes('DC motor (right motor mount), minus (−)'))).toBe(true);
    expect(crossed.some((line) => line.includes('DC motor (right motor mount), plus (+)'))).toBe(true);
    const left = list.wiring.filter((line) => line.includes('DC motor (left motor mount)') && line.startsWith('Power line'));
    expect(left).toHaveLength(2);
    for (const line of left) expect(line).not.toContain(CROSSING_TEXT.marker);
  });

  it('carries the safety note of each part that has one, once each', () => {
    const notes = list.parts.map((entry) => catalogue.parts.get(entry.part)?.card.safetyNote).filter((note) => note !== undefined);
    expect(list.safetyNotes).toEqual([...new Set(notes)]);
    expect(list.safetyNotes.length).toBeGreaterThan(0);
  });

  it('shows no placed-part id, no exclamation mark and no banned phrase', () => {
    const plain = partsListOf(withPlainIds(blueprint), catalogue);
    expect(plain).toEqual(list);
    for (const line of textOf(plain)) {
      expect(line).not.toMatch(/\bp\d+\b/);
      expect(line).not.toContain('!');
      expect(bannedIn(line), line).toEqual([]);
    }
  });

  it('is the same whatever order the parts and wires are in', () => {
    const shuffled = { ...blueprint, parts: [...blueprint.parts].reverse(), wires: [...blueprint.wires].reverse() };
    expect(partsListOf(shuffled, catalogue)).toEqual(list);
  });
});

describe('the Rolling Start parts list', () => {
  const list = partsListOf(fixture('kit-rolling-start'), catalogue);

  it('reads as a real kit', () => {
    expect(list.parts).toEqual([
      { part: 'battery-pack-2-cell', name: '2-cell battery pack', family: 'power', quantity: 1 },
      { part: 'switch', name: 'switch', family: 'power', quantity: 1 },
      { part: 'dc-motor', name: 'DC motor', family: 'actuators', quantity: 2 },
      { part: 'wheel-large', name: 'large wheel', family: 'drivetrain', quantity: 2 },
      { part: 'caster', name: 'caster', family: 'structure-and-ride', quantity: 1 },
      { part: 'chassis', name: 'chassis', family: 'structure-and-ride', quantity: 1 },
    ]);
    expect(list.wiring).toEqual([
      'Mount (grey): 2-cell battery pack to chassis, rear deck',
      'Mount (grey): caster to chassis, caster mount',
      'Mount (grey): DC motor (left motor mount) to chassis, left motor mount',
      'Mount (grey): DC motor (right motor mount) to chassis, right motor mount',
      'Mount (grey): switch to chassis, front deck',
      'Mechanical linkage (grey): DC motor (left motor mount), shaft to large wheel 1, hub',
      'Mechanical linkage (grey): DC motor (right motor mount), shaft to large wheel 2, hub',
      'Power line (red): 2-cell battery pack, minus (−) to DC motor (left motor mount), minus (−)',
      'Power line (red): 2-cell battery pack, minus (−) to DC motor (right motor mount), plus (+) (crossed for a real kit)',
      'Power line (red): 2-cell battery pack, plus (+) to switch, side A',
      'Power line (red): DC motor (left motor mount), plus (+) to switch, side B',
      'Power line (red): DC motor (right motor mount), minus (−) to switch, side B (crossed for a real kit)',
      CROSSING_TEXT.cross('DC motor (right motor mount)', 'plus (+)', 'minus (−)'),
      CROSSING_TEXT.mirrored('DC motor', 'right motor mount', 'chassis'),
      CROSSING_TEXT.adult,
    ]);
  });
});

describe('the Circuit Crew parts list', () => {
  it('does not cross a part on a mirrored mount whose turning does not hang on its leads', () => {
    const blueprint = fixture('kit-circuit-crew');
    const list = partsListOf(blueprint, catalogue);
    expect(list.wiring).toContain('Mount (grey): switch to chassis, right inner motor mount');
    const switchLines = list.wiring.filter((line) => line.includes(', side A') || line.includes(', side B'));
    expect(switchLines.length).toBeGreaterThan(0);
    for (const line of switchLines.filter((text) => !text.includes('DC motor'))) expect(line).not.toContain(CROSSING_TEXT.marker);
    expect(list.wiring).toContain('Power line (red): motor driver, motor B (+) to DC motor (right motor mount), minus (−) (crossed for a real kit)');
    expect(list.wiring).toContain('Power line (red): motor driver, motor A (+) to DC motor (left motor mount), plus (+)');
  });
});

describe('a DC motor set to turn backwards', () => {
  const blueprint = fixture('kit-circuit-crew');
  const motor = catalogue.parts.get('dc-motor');
  const direction = motor?.settings.find((setting) => setting.id === 'direction');

  it('has its leads crossed, since a real one has no such setting', () => {
    const list = partsListOf(withSetting(blueprint, 'motor-left', { direction: 'backward' }), catalogue);
    const notes = list.wiring.slice(blueprint.wires.length);
    expect(notes).toEqual([
      CROSSING_TEXT.cross('DC motor (left motor mount)', 'plus (+)', 'minus (−)'),
      CROSSING_TEXT.setting('DC motor', direction?.label ?? '', 'Backward'),
      CROSSING_TEXT.adult,
      CROSSING_TEXT.cross('DC motor (right motor mount)', 'plus (+)', 'minus (−)'),
      CROSSING_TEXT.mirrored('DC motor', 'right motor mount', 'chassis'),
      CROSSING_TEXT.adult,
    ]);
    expect(list.wiring).toContain('Power line (red): motor driver, motor A (+) to DC motor (left motor mount), minus (−) (crossed for a real kit)');
  });

  it('on a mirrored mount, is wired as the app shows: the two cancel', () => {
    const list = partsListOf(withSetting(blueprint, 'motor-right', { direction: 'backward' }), catalogue);
    expect(list.wiring).toHaveLength(blueprint.wires.length);
    expect(list.wiring.some((line) => line.includes(CROSSING_TEXT.marker))).toBe(false);
  });
});

describe('a build the catalogue cannot describe', () => {
  it('is refused, never listed short', () => {
    const blueprint = fixture('kit-rolling-start');
    const unknown = { ...blueprint, parts: blueprint.parts.map((placed) => (placed.id === 'caster' ? { ...placed, part: 'hover-pad' } : placed)) };
    expect(() => partsListOf(unknown, catalogue)).toThrow(UnknownPart);
    const badPort = { ...blueprint, wires: [...blueprint.wires, { id: 'w99', from: { part: 'battery', port: 'nowhere' }, to: { part: 'switch', port: 'a' } }] };
    expect(() => partsListOf(badPort, catalogue)).toThrow(UnknownPart);
  });

  it('an empty build lists nothing', () => {
    const blueprint = fixture('kit-rolling-start');
    expect(partsListOf({ ...blueprint, parts: [], wires: [] }, catalogue)).toEqual({ blueprint: { id: blueprint.meta.id, name: blueprint.meta.name }, parts: [], wiring: [], safetyNotes: [] });
  });
});

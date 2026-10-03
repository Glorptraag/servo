// The parts-list export (task 5.3), on the live content and its fixtures: every part type once with its family and
// quantity, a line per connection as a real kit makes it, and the real-kit crossing of the motor on a mirrored mount
// (D27). The printed steps are walked in order on a model of the real kit, and its motors turn as the app's do.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { PART_FAMILIES } from '@servo/schema';
import type { Blueprint, PlacedPart, PortRef } from '@servo/schema';
import { LIST_TEXT, UnknownPart, partsListOf } from '../../src/index.ts';
import type { PartsList } from '../../src/index.ts';
import { appTurning, realTurning } from './kit-model.ts';

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

const textOf = (list: PartsList): string[] => [...list.parts.map((entry) => entry.name), ...list.wiring, ...list.realKit, ...list.safetyNotes];

const banned = content.terminology.flatMap((file) => (file.data as { banned?: { phrase: string }[] }).banned ?? []).map((entry) => entry.phrase);
const bannedIn = (line: string): string[] =>
  banned.filter((phrase) => new RegExp(`(?<![\\p{L}\\p{N}-])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}-])`, phrase === 'I' ? 'u' : 'iu').test(line));

/** A real-kit note that asks for a lead to be crossed or swapped, other than the one conditional on the robot driving backward. */
const asksToCross = (note: string): boolean => /\b(cross|swap)\b/iu.test(note) && !note.startsWith('If ') && !/do not swap/iu.test(note) && !note.startsWith('Why:') && !note.includes('already swap');

const RIGHT = 'DC motor (right motor mount)';
const LEFT = 'DC motor (left motor mount)';

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

  it('gives one connection line per wire, and the real-kit notes apart from them, explaining and never asking (D27)', () => {
    expect(list.wiring).toHaveLength(blueprint.wires.length);
    expect(list.realKit).toEqual([
      LIST_TEXT.alreadyCrossed(RIGHT, 'plus (+)', 'minus (−)'),
      LIST_TEXT.mirrored('DC motor', 'right motor mount', 'chassis'),
      LIST_TEXT.adult,
      LIST_TEXT.polarity('DC motor'),
    ]);
    expect(list.realKit.filter(asksToCross)).toEqual([]);
    expect(list.realKit[0]).toContain('Do not swap them again.');
  });

  it('crosses the leads of the motor on the right motor mount only, in every line that reaches them', () => {
    const crossed = list.wiring.filter((line) => line.includes(LIST_TEXT.marker));
    expect(crossed).toHaveLength(2);
    for (const line of crossed) expect(line).toContain(`${RIGHT}, `);
    expect(crossed.some((line) => line.includes(`${RIGHT}, minus (−)`))).toBe(true);
    expect(crossed.some((line) => line.includes(`${RIGHT}, plus (+)`))).toBe(true);
    const left = list.wiring.filter((line) => line.includes(LEFT) && line.startsWith('Power line'));
    expect(left).toHaveLength(2);
    for (const line of left) expect(line).not.toContain(LIST_TEXT.marker);
  });

  it('walked in order on a real kit, drives both motors forward, as the app does', () => {
    expect(appTurning(blueprint, catalogue)).toEqual(new Map([[LEFT, 1], [RIGHT, 1]]));
    expect(realTurning(list, catalogue)).toEqual(new Map([[LEFT, 1], [RIGHT, 1]]));
  });

  it('would spin the real robot if the marked leads were swapped again: the walk can tell', () => {
    const swapAgain = (line: string): string =>
      line.includes(LIST_TEXT.marker)
        ? line
            .slice(0, -LIST_TEXT.marked('').length)
            .replace(`${RIGHT}, plus (+)`, '\u0000')
            .replace(`${RIGHT}, minus (−)`, `${RIGHT}, plus (+)`)
            .replace('\u0000', `${RIGHT}, minus (−)`)
        : line;
    expect(realTurning({ ...list, wiring: list.wiring.map(swapAgain) }, catalogue)).toEqual(new Map([[LEFT, 1], [RIGHT, -1]]));
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
      `Mount (grey): ${LEFT} to chassis, left motor mount`,
      `Mount (grey): ${RIGHT} to chassis, right motor mount`,
      'Mount (grey): switch to chassis, front deck',
      `Mechanical linkage (grey): ${LEFT}, shaft to large wheel 1, hub`,
      `Mechanical linkage (grey): ${RIGHT}, shaft to large wheel 2, hub`,
      `Power line (red): 2-cell battery pack, minus (−) to ${LEFT}, minus (−)`,
      `Power line (red): 2-cell battery pack, minus (−) to ${RIGHT}, plus (+) (crossed for a real kit)`,
      'Power line (red): 2-cell battery pack, plus (+) to switch, side A',
      `Power line (red): ${LEFT}, plus (+) to switch, side B`,
      `Power line (red): ${RIGHT}, minus (−) to switch, side B (crossed for a real kit)`,
    ]);
  });
});

describe('the Circuit Crew parts list', () => {
  it('does not cross a part on a mirrored mount whose turning does not hang on its leads', () => {
    const list = partsListOf(fixture('kit-circuit-crew'), catalogue);
    expect(list.wiring).toContain('Mount (grey): switch to chassis, right inner motor mount');
    const switchLines = list.wiring.filter((line) => line.includes('switch, side'));
    expect(switchLines.length).toBeGreaterThan(0);
    for (const line of switchLines) expect(line).not.toContain(LIST_TEXT.marker);
    expect(list.wiring).toContain(`Power line (red): motor driver, motor B (+) to ${RIGHT}, minus (−) (crossed for a real kit)`);
    expect(list.wiring).toContain(`Power line (red): motor driver, motor A (+) to ${LEFT}, plus (+)`);
  });
});

describe('a DC motor set to turn backwards', () => {
  const direction = catalogue.parts.get('dc-motor')?.settings.find((setting) => setting.id === 'direction');

  it('has its leads crossed in the real kit, since a real one has no such setting, and turns as in the app', () => {
    const blueprint = withSetting(fixture('kit-circuit-crew'), 'motor-left', { direction: 'backward' });
    const list = partsListOf(blueprint, catalogue);
    expect(list.realKit).toEqual([
      LIST_TEXT.alreadyCrossed(LEFT, 'plus (+)', 'minus (−)'),
      LIST_TEXT.setting(LEFT, direction?.label ?? '', 'Backward'),
      LIST_TEXT.alreadyCrossed(RIGHT, 'plus (+)', 'minus (−)'),
      LIST_TEXT.mirrored('DC motor', 'right motor mount', 'chassis'),
      LIST_TEXT.adult,
      LIST_TEXT.polarity('DC motor'),
    ]);
    expect(list.realKit.filter(asksToCross)).toEqual([]);
    expect(list.wiring).toContain(`Power line (red): motor driver, motor A (+) to ${LEFT}, minus (−) (crossed for a real kit)`);
    expect(appTurning(blueprint, catalogue)).toEqual(new Map([[LEFT, -1], [RIGHT, 1]]));
    expect(realTurning(list, catalogue)).toEqual(appTurning(blueprint, catalogue));
  });

  it('on a mirrored mount, wired the other way round, drives forward in the app and the real kit, with nothing crossed', () => {
    const blueprint = withSetting(fixture('broken-reversed-motor'), 'motor-right', { direction: 'backward' });
    const list = partsListOf(blueprint, catalogue);
    expect(list.wiring.some((line) => line.includes(LIST_TEXT.marker))).toBe(false);
    expect(list.realKit).toEqual([LIST_TEXT.polarity('DC motor')]);
    expect(appTurning(blueprint, catalogue)).toEqual(new Map([[LEFT, 1], [RIGHT, 1]]));
    expect(realTurning(list, catalogue)).toEqual(new Map([[LEFT, 1], [RIGHT, 1]]));
  });

  it('on a mirrored mount, wired as the app shows, cancels the mirror', () => {
    const blueprint = withSetting(fixture('kit-circuit-crew'), 'motor-right', { direction: 'backward' });
    const list = partsListOf(blueprint, catalogue);
    expect(list.wiring.some((line) => line.includes(LIST_TEXT.marker))).toBe(false);
    expect(realTurning(list, catalogue)).toEqual(appTurning(blueprint, catalogue));
    expect(appTurning(blueprint, catalogue).get(RIGHT)).toBe(-1);
  });
});

describe('a motor-driver channel set by its setting', () => {
  it('to Backward, has its outputs crossed in the real kit, and the motors turn as in the app', () => {
    const blueprint = fixture('busy-workbench');
    const list = partsListOf(blueprint, catalogue);
    expect(list.realKit).toContain(LIST_TEXT.setting('motor driver 1', 'Motor B', 'Backward'));
    expect(list.realKit.filter(asksToCross)).toEqual([]);
    const app = appTurning(blueprint, catalogue);
    expect([...app.values()]).toContain(-1);
    expect(realTurning(list, catalogue)).toEqual(app);
  });

  it('to Stop, leaves its outputs unconnected and says so', () => {
    const blueprint = withSetting(fixture('kit-circuit-crew'), 'driver', { 'motor-a': 'stop' });
    const list = partsListOf(blueprint, catalogue);
    expect(list.wiring).toHaveLength(blueprint.wires.length - 2);
    expect(list.wiring.some((line) => line.includes('motor A'))).toBe(false);
    expect(list.realKit).toContain(LIST_TEXT.stopped('motor driver', 'Motor A', 'Stop', 'motor A (+)', 'motor A (−)'));
    expect(appTurning(blueprint, catalogue).get(LEFT)).toBe(0);
    expect(realTurning(list, catalogue).get(LEFT) ?? 0).toBe(0);
    expect(realTurning(list, catalogue).get(RIGHT)).toBe(1);
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
    expect(partsListOf({ ...blueprint, parts: [], wires: [] }, catalogue)).toEqual({
      blueprint: { id: blueprint.meta.id, name: blueprint.meta.name },
      parts: [],
      wiring: [],
      realKit: [],
      safetyNotes: [],
    });
  });
});

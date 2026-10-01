import { describe, expect, it } from 'vitest';
import lightAndMotorText from '../fixtures/v0/light-and-motor.json?raw';
import rollingStartText from '../fixtures/v0/rolling-start.json?raw';
import { ISSUE_CODES, claimPartId, claimWireId, validateBlueprint, validateBlueprintShape } from '../src/index.ts';
import type { Blueprint, ValidationResult } from '../src/index.ts';
import { derivedUuid } from '../src/migrate/digest.ts';
import { V0_ID_SOURCE, v0ToV1 } from '../src/migrate/v0-to-v1.ts';
import type { BlueprintV0 } from '../src/migrate/v0-to-v1.ts';
import { UUID_V4 } from '../src/validate/reader.ts';
import { catalogue, copy, edited, issuesOf, push, reasons, remove, set } from './support.ts';

// The version 0 → 1 step on its own, without the runner.

const rollingStart = JSON.parse(rollingStartText) as BlueprintV0;
const lightAndMotor = JSON.parse(lightAndMotorText) as BlueprintV0;

const step = (document: unknown): ValidationResult<Blueprint> => v0ToV1.migrate(document) as ValidationResult<Blueprint>;

const migrated = (document: unknown): Blueprint => {
  const result = step(document);
  if (!result.ok) throw new Error(`Expected a migration:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

describe('v0ToV1 reads version 0 and writes version 1', () => {
  it('reads from 0 and writes 1', () => {
    expect([v0ToV1.from, v0ToV1.to]).toEqual([0, 1]);
  });

  it.each([
    ['rolling-start', rollingStart],
    ['light-and-motor', lightAndMotor],
  ])('%s validates against the fixture catalogue', (_name, v0) => {
    const blueprint = migrated(v0);
    expect(blueprint.version).toBe(1);
    expect(reasons(validateBlueprint(blueprint, catalogue))).toEqual([]);
  });

  it('renames type to part and turns quarter turns into degrees, keeping ids, places and settings as stored', () => {
    const blueprint = migrated(lightAndMotor);
    expect(blueprint.parts).toEqual([
      { id: 'p1', part: 'battery-pack-2-cell', position: { x: -80, y: 0 }, rotation: 0, settings: {} },
      { id: 'p2', part: 'switch', position: { x: 0, y: -60 }, rotation: 0, settings: {} },
      { id: 'p4', part: 'led', position: { x: 80, y: 0 }, rotation: 90, settings: { colour: 'green' } },
      // The step needs no catalogue, so a stored default stays until canonical form drops it.
      { id: 'p5', part: 'dc-motor', position: { x: 0, y: 60 }, rotation: 270, settings: { direction: 'backward', speed: 100 } },
    ]);
    const turned = (turns: number) => migrated(edited(lightAndMotor, set(['parts', 0, 'turns'], turns))).parts[0]?.rotation;
    expect([0, 1, 2, 3].map(turned)).toEqual([0, 90, 180, 270]);
  });

  it('keeps every wire, its ends and the order they were stored in', () => {
    expect(migrated(rollingStart).wires).toEqual(rollingStart.wires);
    expect(migrated(lightAndMotor).wires).toEqual(lightAndMotor.wires);
  });

  it('makes the arena preset an arena with no props', () => {
    expect(migrated(rollingStart).arena).toEqual({ preset: 'open-floor', props: [] });
    expect(migrated(lightAndMotor).arena).toEqual({ preset: 'wall-stop', props: [] });
  });

  it('renames title to name, writes the times as timestamps and keeps the level and author', () => {
    expect(migrated(rollingStart).meta).toEqual({
      id: '9470c6db-985c-448e-90ed-9437b5cf7263',
      name: 'Rolling robot',
      level: 1,
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:20:00.000Z',
      author: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607',
      highWater: { parts: 0, wires: 12 },
    });
    const shared = migrated(lightAndMotor).meta;
    expect(shared).toMatchObject({ createdAt: '2026-09-14T15:42:07.315Z', updatedAt: '2026-09-20T08:03:59.004Z' });
    expect(Object.keys(shared)).not.toContain('author');
  });

  it.each([
    [0, '1970-01-01T00:00:00.000Z'],
    [951782400000, '2000-02-29T00:00:00.000Z'],
    [1709251199999, '2024-02-29T23:59:59.999Z'],
    [4107587696789, '2100-03-01T12:34:56.789Z'],
    [253402300799999, '9999-12-31T23:59:59.999Z'],
  ])('writes %i milliseconds as %s, which version 1 accepts', (ms, expected) => {
    const blueprint = migrated(edited(rollingStart, set(['meta', 'created'], ms), set(['meta', 'modified'], ms)));
    expect([blueprint.meta.createdAt, blueprint.meta.updatedAt]).toEqual([expected, expected]);
    expect(reasons(validateBlueprintShape(blueprint))).toEqual([]);
  });
});

describe('the derived blueprint id', () => {
  // Pinned on purpose: a different id here would give every stored version 0 blueprint a new identity
  // when it is migrated, and sync would then keep two copies of it.
  it('is pinned for each fixture', () => {
    expect(migrated(rollingStart).meta.id).toBe('9470c6db-985c-448e-90ed-9437b5cf7263');
    expect(migrated(lightAndMotor).meta.id).toBe('47334c53-bab5-49c3-86dc-7d278770b388');
  });

  it('hashes the source line and the stored document in canonical JSON, which the fixture files already are', () => {
    expect(migrated(rollingStart).meta.id).toBe(derivedUuid(`${V0_ID_SOURCE}${rollingStartText}`));
    expect(migrated(lightAndMotor).meta.id).toBe(derivedUuid(`${V0_ID_SOURCE}${lightAndMotorText}`));
  });

  it('is laid out as the UUID v4 that version 1 requires', () => {
    expect(migrated(rollingStart).meta.id).toMatch(UUID_V4);
    expect(migrated(lightAndMotor).meta.id).toMatch(UUID_V4);
  });

  it('does not depend on the order of keys in the stored document', () => {
    const reversed = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversed);
      if (typeof value !== 'object' || value === null) return value;
      return Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reversed(inner)]));
    };
    const reordered = reversed(rollingStart);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(rollingStart));
    expect(migrated(reordered).meta.id).toBe(migrated(rollingStart).meta.id);
  });

  it.each([
    ['the title', set(['meta', 'title'], 'Rolling robot 2')],
    ['the time it was saved', set(['meta', 'modified'], 1790846400001)],
    ['the author', remove(['meta', 'author'])],
    ['a place', set(['parts', 0, 'position', 'x'], 1)],
    ['a turn', set(['parts', 5, 'turns'], 2)],
    ['a wire end', set(['wires', 8, 'to', 'port'], 'a')],
    ['the order of the parts', (document: unknown) => (document as { parts: unknown[] }).parts.reverse()],
  ])('changes with %s', (_change, change) => {
    expect(migrated(edited(rollingStart, change)).meta.id).not.toBe(migrated(rollingStart).meta.id);
  });
});

describe('the high-water marks', () => {
  const marks = (parts: readonly string[], wires: readonly string[]) => {
    const document = {
      ...copy(lightAndMotor),
      parts: parts.map((id) => ({ id, type: 'led', position: { x: 0, y: 0 }, turns: 0, settings: {} })),
      wires: wires.map((id) => ({ id, from: { part: 'a', port: 'plus' }, to: { part: 'b', port: 'minus' } })),
    };
    return migrated(document).meta.highWater;
  };

  it('starts at the highest numbered id in use, so no id in use is given out again', () => {
    expect(marks([], [])).toEqual({ parts: 0, wires: 0 });
    expect(marks(['led', 'battery'], ['power'])).toEqual({ parts: 0, wires: 0 });
    expect(marks(['p1', 'p3', 'motor', 'p2x', 'p007'], ['w2', 'w10', 'w9'])).toEqual({ parts: 7, wires: 10 });
    expect(migrated(lightAndMotor).meta.highWater).toEqual({ parts: 5, wires: 7 });
  });

  it('lets the next claimed ids follow on', () => {
    const blueprint = migrated(lightAndMotor);
    expect(claimPartId(blueprint).id).toBe('p6');
    expect(claimWireId(blueprint).id).toBe('w8');
  });
});

describe('v0ToV1 is pure', () => {
  it('gives the same result every time', () => {
    expect(migrated(lightAndMotor)).toEqual(migrated(lightAndMotor));
    expect(migrated(copy(rollingStart))).toEqual(migrated(rollingStart));
  });

  it('never writes to its input, and shares no object with it', () => {
    const frozen = deepFreeze(copy(lightAndMotor));
    const blueprint = migrated(frozen);
    expect(frozen).toEqual(lightAndMotor);
    blueprint.parts.forEach((part, index) => {
      expect(part.position).not.toBe(frozen.parts[index]?.position);
      expect(part.settings).not.toBe(frozen.parts[index]?.settings);
    });
    blueprint.wires.forEach((wire, index) => {
      expect(wire.from).not.toBe(frozen.wires[index]?.from);
      expect(wire.to).not.toBe(frozen.wires[index]?.to);
    });
  });
});

describe('v0ToV1 reads version 0 strictly, with a named reason for each refusal', () => {
  it.each([
    ['a document of another version', set(['version'], 1), 'value.not_allowed at $.version'],
    ['a document with no version', remove(['version']), 'value.missing at $.version'],
    ['a field version 0 never had', set(['notes'], 'kept'), 'value.unknown_key at $.notes'],
    ['a blueprint id, which version 0 never had', set(['meta', 'id'], '0f8e7d6c-5b4a-4c3d-9e2f-1a0b9c8d7e6f'), 'value.unknown_key at $.meta.id'],
    ['a high-water mark, which version 0 never had', set(['meta', 'highWater'], { parts: 0, wires: 12 }), 'value.unknown_key at $.meta.highWater'],
    ["version 1's name for the title", set(['meta', 'name'], 'Rolling robot'), 'value.unknown_key at $.meta.name'],
    ['a missing title', remove(['meta', 'title']), 'value.missing at $.meta.title'],
    ['an empty title', set(['meta', 'title'], ''), 'value.bad_format at $.meta.title'],
    ['a level above 5', set(['meta', 'level'], 6), 'value.not_allowed at $.meta.level'],
    ['an author that is a name', set(['meta', 'author'], 'Sam'), 'value.bad_format at $.meta.author'],
    ['a time before 1970', set(['meta', 'created'], -1), 'value.out_of_range at $.meta.created'],
    ['a time after 9999', set(['meta', 'modified'], 253402300800000), 'value.out_of_range at $.meta.modified'],
    ['a time in part milliseconds', set(['meta', 'created'], 1790845200000.5), 'value.not_integer at $.meta.created'],
    ['a time written as text', set(['meta', 'created'], '2026-10-01T09:00:00.000Z'), 'value.wrong_type at $.meta.created'],
    ['an arena written as in version 1', set(['arena'], { preset: 'open-floor', props: [] }), 'value.wrong_type at $.arena'],
    ['an arena id that is not an id', set(['arena'], 'Open floor'), 'value.bad_format at $.arena'],
    ["version 1's name for a part's type", set(['parts', 0, 'part'], 'chassis'), 'value.unknown_key at $.parts[0].part'],
    ['a rotation in degrees', set(['parts', 0, 'rotation'], 0), 'value.unknown_key at $.parts[0].rotation'],
    ['four quarter turns', set(['parts', 1, 'turns'], 4), 'value.out_of_range at $.parts[1].turns'],
    ['half a quarter turn', set(['parts', 1, 'turns'], 0.5), 'value.not_integer at $.parts[1].turns'],
    ['a missing type', remove(['parts', 2, 'type']), 'value.missing at $.parts[2].type'],
    ['a position with no y', remove(['parts', 3, 'position', 'y']), 'value.missing at $.parts[3].position.y'],
    ['a setting id that is not an id', set(['parts', 1, 'settings'], { 'Top Speed': 50 }), "value.bad_format at $.parts[1].settings['Top Speed']"],
    ['a setting that is neither a number nor an option', set(['parts', 1, 'settings'], { speed: true }), 'value.wrong_type at $.parts[1].settings.speed'],
    ['two parts with one id', set(['parts', 2, 'id'], 'motor-left'), 'id.duplicate at $.parts[2].id'],
    ['two wires with one id', set(['wires', 1, 'id'], 'w1'), 'id.duplicate at $.wires[1].id'],
    ['a wire end written as text', set(['wires', 0, 'from'], 'motor-left.mount'), 'value.wrong_type at $.wires[0].from'],
    ['a wire end with no port', remove(['wires', 0, 'to', 'port']), 'value.missing at $.wires[0].to.port'],
    ['a wire that is not an object', push(['wires'], 'w13'), 'value.wrong_type at $.wires[12]'],
  ])('refuses %s', (_name, change, expected) => {
    const result = step(edited(rollingStart, change));
    expect(reasons(result)).toEqual([expected]);
    expect(issuesOf(result)[0]?.message).toMatch(/\S/);
  });

  it('reports every problem it finds, not only the first', () => {
    const broken = edited(rollingStart, set(['meta', 'title'], ''), set(['parts', 1, 'turns'], 4), set(['arena'], 'Open floor'));
    expect(reasons(step(broken))).toEqual([
      'value.out_of_range at $.parts[1].turns',
      'value.bad_format at $.arena',
      'value.bad_format at $.meta.title',
    ]);
  });

  it.each([
    ['nothing', () => undefined],
    ['null', () => null],
    ['a list', () => []],
    ['a string', () => 'blueprint'],
    ['an object whose parts throw', () => {
      const document = copy(rollingStart) as unknown as Record<string, unknown>;
      Object.defineProperty(document, 'parts', {
        enumerable: true,
        get() {
          throw new Error('boom');
        },
      });
      return document;
    }],
    ['a Proxy that throws on every read', () => new Proxy({}, { ownKeys: () => { throw new Error('no keys'); }, get: () => { throw new Error('no reads'); } })],
  ])('never throws, and refuses %s with named reasons', (_name, make) => {
    let result: ValidationResult<Blueprint> | undefined;
    expect(() => (result = step(make()))).not.toThrow();
    expect(result?.ok).toBe(false);
    const issues = result ? issuesOf(result) : [];
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(Object.keys(ISSUE_CODES)).toContain(issue.code);
  });
});

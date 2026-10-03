// The tray's tiles from the kits (src/tray/tiles.ts): exactly each kit's parts, each once, grouped by the family in
// its part record (ground rule 1), in the kit's tray order.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { makeCatalogue } from '@servo/schema';
import type { Kit, PartRecord } from '@servo/schema';
import { familyLabel, kitForLevel, titleOf, trayGroups } from '../../src/tray/tiles.ts';

const { content } = loadContent();

describe('trayGroups', () => {
  it('has kits to show', () => {
    expect(content.kits.map((kit) => kit.id).sort()).toEqual(['circuit-crew', 'rolling-start']);
  });

  for (const kit of content.kits) {
    describe(kit.name, () => {
      const groups = trayGroups(kit, content.catalogue, content.art);
      const tiles = groups.flatMap((group) => group.tiles);

      it("shows exactly the kit's parts, each once, with the kit's quantities", () => {
        expect(tiles.map((tile) => tile.part).sort()).toEqual(kit.parts.map((entry) => entry.part).sort());
        for (const entry of kit.parts) expect(tiles.find((tile) => tile.part === entry.part)?.quantity).toBe(entry.quantity);
      });

      it('groups each tile under the family its part record names, each family once', () => {
        for (const group of groups) {
          expect(group.label).toBe(familyLabel(group.family));
          for (const tile of group.tiles) expect(content.catalogue.parts.get(tile.part)?.identity.family).toBe(group.family);
        }
        expect(new Set(groups.map((group) => group.family)).size).toBe(groups.length);
      });

      it("keeps the kit's tray order", () => {
        expect(tiles.map((tile) => tile.part)).toEqual(kit.tray.flatMap((group) => group.parts));
      });

      it('names each part by its real name from the record, as a title', () => {
        for (const tile of tiles) {
          const record = content.catalogue.parts.get(tile.part);
          expect(tile.name).toBe(record?.identity.name);
          expect(tile.title).toBe(titleOf(tile.name));
          expect(tile.title).not.toMatch(/!/);
        }
      });
    });
  }

  it('groups by the part record, whatever the kit says, and leaves out parts the catalogue lacks', () => {
    const records = [...content.catalogue.parts.values()];
    const motor = records.find((record) => record.id === 'dc-motor') as PartRecord;
    const wheel = records.find((record) => record.id === 'wheel-large') as PartRecord;
    const kit: Kit = {
      id: 'mixed',
      name: 'Mixed',
      level: 1,
      parts: [
        { part: wheel.id, quantity: 2 },
        { part: motor.id, quantity: 1 },
        { part: 'no-such-part', quantity: 1 },
      ],
      tray: [{ family: 'power', parts: [wheel.id, motor.id, 'no-such-part'] }],
    };
    const groups = trayGroups(kit, makeCatalogue({ parts: records }));
    expect(groups.map((group) => [group.family, group.tiles.map((tile) => tile.part)])).toEqual([
      [wheel.identity.family, [wheel.id]],
      [motor.identity.family, [motor.id]],
    ]);
    expect(groups.flatMap((group) => group.tiles).every((tile) => tile.picture === undefined)).toBe(true);
  });

  it('capitalises only the first letter of a title', () => {
    expect(titleOf('large wheel')).toBe('Large wheel');
    expect(titleOf('DC motor')).toBe('DC motor');
    expect(titleOf('2-cell battery pack')).toBe('2-cell battery pack');
  });
});

describe('kitForLevel', () => {
  it("gives the kit at the child's level", () => {
    expect(kitForLevel(content.kits, 1)?.id).toBe('rolling-start');
    expect(kitForLevel(content.kits, 2)?.id).toBe('circuit-crew');
    expect(kitForLevel(content.kits, 5)).toBeUndefined();
  });
});

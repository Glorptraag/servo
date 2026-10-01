import type { ValidationResult } from '../types/issue.ts';
import type { Kit } from '../types/kit.ts';
import { PART_FAMILIES } from '../types/taxonomy.ts';
import type { Catalogue } from './catalogue.ts';
import {
  at,
  field,
  isRecord,
  readEnum,
  readLevel,
  readList,
  readNumber,
  readObject,
  readSlug,
  readText,
  report,
  reportDuplicateIds,
  reportRepeats,
  runValidator,
} from './reader.ts';
import type { Ctx } from './reader.ts';

const FAMILY_IDS = PART_FAMILIES.map((family) => family.id);

export const readKit = (ctx: Ctx, value: unknown, path: string): Kit | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'name', 'level', 'parts', 'tray']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  readText(ctx, field(record, 'name'), at(path, 'name'));
  readLevel(ctx, field(record, 'level'), at(path, 'level'));

  const partsPath = at(path, 'parts');
  const parts = field(record, 'parts');
  readList(
    ctx,
    parts,
    partsPath,
    (c, v, p) => {
      const m = c.issues.length;
      const entry = readObject(c, v, p, ['part', 'quantity']);
      if (!entry) return undefined;
      readSlug(c, field(entry, 'part'), at(p, 'part'));
      readNumber(c, field(entry, 'quantity'), at(p, 'quantity'), { min: 1, integer: true });
      return c.issues.length === m ? entry : undefined;
    },
    1,
  );
  reportDuplicateIds(ctx, Array.isArray(parts) ? parts : undefined, partsPath, 'part');

  const trayPath = at(path, 'tray');
  const tray = field(record, 'tray');
  readList(
    ctx,
    tray,
    trayPath,
    (c, v, p) => {
      const m = c.issues.length;
      const group = readObject(c, v, p, ['family', 'parts']);
      if (!group) return undefined;
      readEnum(c, field(group, 'family'), at(p, 'family'), FAMILY_IDS);
      const members = field(group, 'parts');
      readList(c, members, at(p, 'parts'), readSlug, 1);
      reportRepeats(c, Array.isArray(members) ? members : undefined, at(p, 'parts'));
      return c.issues.length === m ? group : undefined;
    },
    1,
  );
  if (Array.isArray(tray)) {
    const families = new Set<unknown>();
    tray.forEach((group, index) => {
      const family = isRecord(group) ? field(group, 'family') : undefined;
      if (typeof family !== 'string') return;
      if (families.has(family)) report(ctx, 'value.duplicate', at(at(trayPath, index), 'family'), `The ${family} family already has a tray group.`);
      families.add(family);
    });
  }
  if (ctx.issues.length !== mark) return undefined;

  // Every entry sits in exactly one tray group, and the tray shows nothing the kit lacks.
  const kit = record as unknown as Kit;
  const listed = new Set(kit.parts.map((entry) => entry.part));
  const shown = new Set<string>();
  kit.tray.forEach((group, g) =>
    group.parts.forEach((part, index) => {
      const partPath = at(at(at(trayPath, g), 'parts'), index);
      if (!listed.has(part)) report(ctx, 'kit.tray_mismatch', partPath, `The tray shows '${part}', which the kit does not hold.`);
      else if (shown.has(part)) report(ctx, 'kit.tray_mismatch', partPath, `'${part}' already sits in another tray group.`);
      shown.add(part);
    }),
  );
  kit.parts.forEach((entry, index) => {
    if (!shown.has(entry.part)) report(ctx, 'kit.tray_mismatch', at(at(partsPath, index), 'part'), `'${entry.part}' is in no tray group.`);
  });
  return ctx.issues.length === mark ? kit : undefined;
};

/** Checks each part exists, belongs to its tray group's family, and is introduced no later than the kit's level. */
export const checkKit = (ctx: Ctx, kit: Kit, path: string, catalogue: Catalogue): void => {
  kit.parts.forEach((entry, index) => {
    const record = catalogue.parts.get(entry.part);
    const entryPath = at(at(path, 'parts'), index);
    if (!record) report(ctx, 'ref.unknown_part_type', at(entryPath, 'part'), `No part record has the id '${entry.part}'.`);
    else if (record.identity.level > kit.level) {
      report(ctx, 'kit.part_above_level', at(entryPath, 'part'), `The ${record.identity.name} is introduced at level ${record.identity.level}.`);
    }
  });
  kit.tray.forEach((group, g) =>
    group.parts.forEach((part, index) => {
      const record = catalogue.parts.get(part);
      if (record && record.identity.family !== group.family) {
        report(
          ctx,
          'kit.wrong_family',
          at(at(at(at(path, 'tray'), g), 'parts'), index),
          `The ${record.identity.name} belongs to the ${record.identity.family} family, not ${group.family}.`,
        );
      }
    }),
  );
};

/** Checks a kit's structure, its tray against its entries, and its parts against the catalogue. */
export const validateKit = (value: unknown, catalogue: Catalogue): ValidationResult<Kit> =>
  runValidator(value, (ctx, root) => {
    const mark = ctx.issues.length;
    const kit = readKit(ctx, root, '$');
    if (kit) checkKit(ctx, kit, '$', catalogue);
    return ctx.issues.length === mark ? kit : undefined;
  });

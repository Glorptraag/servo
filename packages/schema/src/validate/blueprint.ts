import type { Blueprint, BlueprintMeta, PlacedPart, SettingValue, Wire } from '../types/blueprint.ts';
import type { ValidationResult } from '../types/issue.ts';
import type { Setting } from '../types/part.ts';
import type { PortRef } from '../types/port.ts';
import { checkArenaRef, readArenaRef } from './arena.ts';
import type { Catalogue } from './catalogue.ts';
import {
  DEGREES,
  SLUG,
  at,
  field,
  inRange,
  isRecord,
  onStep,
  readLevel,
  readList,
  readName,
  readNumber,
  readObject,
  readOpaqueId,
  readSlug,
  readTimestamp,
  readVec2,
  report,
  reportDuplicateIds,
  runValidator,
  shown,
} from './reader.ts';
import type { Ctx } from './reader.ts';
import { addWire, emptyWiring, indexPlacedParts, judgeWire, resolvePort } from './wiring.ts';
import type { PortEnd } from './wiring.ts';

const readSettingValues = (ctx: Ctx, value: unknown, path: string): void => {
  if (value === undefined) return;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected an object of setting values.');
    return;
  }
  for (const key of Object.keys(value)) {
    const entry = field(value, key);
    if (!SLUG.test(key) || key.length > 64) {
      report(ctx, 'value.bad_format', at(path, key), 'Setting ids are lower-case words joined by hyphens.');
    } else if (typeof entry === 'number' ? !Number.isFinite(entry) : typeof entry !== 'string') {
      report(ctx, 'value.wrong_type', at(path, key), 'Expected a number or an option id.');
    }
  }
};

const readPlacedPart = (ctx: Ctx, value: unknown, path: string): PlacedPart | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'part', 'position', 'rotation', 'settings']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  readSlug(ctx, field(record, 'part'), at(path, 'part'));
  readVec2(ctx, field(record, 'position'), at(path, 'position'));
  readNumber(ctx, field(record, 'rotation'), at(path, 'rotation'), DEGREES);
  readSettingValues(ctx, field(record, 'settings'), at(path, 'settings'));
  return ctx.issues.length === mark ? (record as unknown as PlacedPart) : undefined;
};

export const readPortRef = (ctx: Ctx, value: unknown, path: string): PortRef | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['part', 'port']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'part'), at(path, 'part'));
  readSlug(ctx, field(record, 'port'), at(path, 'port'));
  return ctx.issues.length === mark ? (record as unknown as PortRef) : undefined;
};

const readWire = (ctx: Ctx, value: unknown, path: string): Wire | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'from', 'to']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  readPortRef(ctx, field(record, 'from'), at(path, 'from'));
  readPortRef(ctx, field(record, 'to'), at(path, 'to'));
  return ctx.issues.length === mark ? (record as unknown as Wire) : undefined;
};

const readMeta = (ctx: Ctx, value: unknown, path: string): BlueprintMeta | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['name', 'level', 'createdAt', 'updatedAt'], ['author']);
  if (!record) return undefined;
  readName(ctx, field(record, 'name'), at(path, 'name'));
  readLevel(ctx, field(record, 'level'), at(path, 'level'));
  readTimestamp(ctx, field(record, 'createdAt'), at(path, 'createdAt'));
  readTimestamp(ctx, field(record, 'updatedAt'), at(path, 'updatedAt'));
  readOpaqueId(ctx, field(record, 'author'), at(path, 'author'));
  return ctx.issues.length === mark ? (record as unknown as BlueprintMeta) : undefined;
};

/** Structure only: fields, formats, ids unique. Needs no catalogue. */
export const readBlueprintShape = (ctx: Ctx, value: unknown, path: string): Blueprint | undefined => {
  const mark = ctx.issues.length;
  if (isRecord(value)) {
    const version = field(value, 'version');
    if (version !== undefined && version !== 1) {
      report(
        ctx,
        'blueprint.unsupported_version',
        at(path, 'version'),
        typeof version === 'number' || typeof version === 'string'
          ? `This schema reads version 1 blueprints; this one is version ${shown(String(version))}. Migrate it first.`
          : 'This schema reads version 1 blueprints; this version is not a number.',
      );
      return undefined;
    }
  }
  const record = readObject(ctx, value, path, ['version', 'parts', 'wires', 'arena', 'meta']);
  if (!record) return undefined;
  const parts = field(record, 'parts');
  readList(ctx, parts, at(path, 'parts'), readPlacedPart);
  reportDuplicateIds(ctx, Array.isArray(parts) ? parts : undefined, at(path, 'parts'));
  const wires = field(record, 'wires');
  readList(ctx, wires, at(path, 'wires'), readWire);
  reportDuplicateIds(ctx, Array.isArray(wires) ? wires : undefined, at(path, 'wires'));
  readArenaRef(ctx, field(record, 'arena'), at(path, 'arena'));
  readMeta(ctx, field(record, 'meta'), at(path, 'meta'));
  return ctx.issues.length === mark ? (record as unknown as Blueprint) : undefined;
};

/** Checks one blueprint setting value against its setting. */
export const checkSettingValue = (ctx: Ctx, setting: Setting, value: SettingValue, path: string): void => {
  if (setting.kind === 'number') {
    if (typeof value !== 'number') {
      report(ctx, 'setting.wrong_type', path, `'${setting.id}' takes a number.`);
    } else if (!inRange(value, { min: setting.min, max: setting.max })) {
      report(ctx, 'setting.out_of_range', path, `'${setting.id}' runs from ${setting.min} to ${setting.max}; found ${value}.`);
    } else if (!onStep(value, setting.min, setting.step)) {
      report(ctx, 'setting.off_step', path, `'${setting.id}' moves in steps of ${setting.step} from ${setting.min}; found ${value}.`);
    }
  } else if (typeof value !== 'string') {
    report(ctx, 'setting.wrong_type', path, `'${setting.id}' takes an option id.`);
  } else if (!setting.options.some((option) => option.id === value)) {
    report(ctx, 'ref.unknown_option', path, `'${setting.id}' has no option '${value}'.`);
  }
};

/** Checks part types, settings, wire ends and wiring legality against the catalogue. */
export const checkBlueprint = (ctx: Ctx, blueprint: Blueprint, path: string, catalogue: Catalogue): void => {
  const partsPath = at(path, 'parts');
  blueprint.parts.forEach((part, index) => {
    const partPath = at(partsPath, index);
    const record = catalogue.parts.get(part.part);
    if (!record) {
      report(ctx, 'ref.unknown_part_type', at(partPath, 'part'), `No part record has the id '${part.part}'.`);
      return;
    }
    for (const [id, value] of Object.entries(part.settings)) {
      const settingPath = at(at(partPath, 'settings'), id);
      const setting = record.settings.find((candidate) => candidate.id === id);
      if (!setting) report(ctx, 'ref.unknown_setting', settingPath, `The ${record.identity.name} has no setting '${id}'.`);
      else checkSettingValue(ctx, setting, value, settingPath);
    }
  });

  const placed = indexPlacedParts(blueprint.parts);
  const wiresPath = at(path, 'wires');
  const end = (ref: PortRef, endPath: string): PortEnd | undefined => {
    const resolved = resolvePort(placed, catalogue, ref);
    if (resolved.found) return resolved;
    // An unknown part type is reported once, on the part.
    if (resolved.code === 'ref.unknown_placed_part') report(ctx, resolved.code, at(endPath, 'part'), resolved.message);
    if (resolved.code === 'ref.unknown_port') report(ctx, resolved.code, at(endPath, 'port'), resolved.message);
    return undefined;
  };
  const state = emptyWiring();
  blueprint.wires.forEach((wire, index) => {
    const wirePath = at(wiresPath, index);
    const from = end(wire.from, at(wirePath, 'from'));
    const to = end(wire.to, at(wirePath, 'to'));
    if (!from || !to) return;
    const judgement = judgeWire(state, from, to);
    if (!judgement.legal) {
      report(ctx, judgement.code, wirePath, judgement.message);
      return;
    }
    if (judgement.kind !== 'power' && (judgement.from.part !== wire.from.part || judgement.from.port !== wire.from.port)) {
      report(ctx, 'wire.reversed', wirePath, `This ${judgement.kind} wire is written from its in end; swap 'from' and 'to'.`);
    }
    addWire(state, judgement);
  });
  checkArenaRef(ctx, blueprint.arena, at(path, 'arena'), catalogue);
};

export const readBlueprint = (ctx: Ctx, value: unknown, path: string, catalogue: Catalogue): Blueprint | undefined => {
  const mark = ctx.issues.length;
  const blueprint = readBlueprintShape(ctx, value, path);
  if (blueprint) checkBlueprint(ctx, blueprint, path, catalogue);
  return ctx.issues.length === mark ? blueprint : undefined;
};

/** Structure only: use it where no content is loaded. A blueprint that passes may still hold impossible wires. */
export const validateBlueprintShape = (value: unknown): ValidationResult<Blueprint> =>
  runValidator(value, (ctx, root) => readBlueprintShape(ctx, root, '$'));

/**
 * The full check: structure, part types, settings, wire ends, wiring legality (impossible drops,
 * full ports, duplicates, stored orientation, mount loops) and the arena. Legal-but-wrong wiring passes.
 */
export const validateBlueprint = (value: unknown, catalogue: Catalogue): ValidationResult<Blueprint> =>
  runValidator(value, (ctx, root) => readBlueprint(ctx, root, '$', catalogue));

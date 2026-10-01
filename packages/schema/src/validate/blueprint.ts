import { canvasPoseOf, mountPlacement, normalizeDegrees } from '../geometry/frames.ts';
import { placeParts } from '../geometry/robot.ts';
import type { Blueprint, BlueprintMeta, PlacedPart, SettingValue, Wire } from '../types/blueprint.ts';
import type { ValidationResult } from '../types/issue.ts';
import type { Setting } from '../types/part.ts';
import type { MountPointPort, MountPort, PortRef } from '../types/port.ts';
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
  readSlug,
  readTimestamp,
  readUuid,
  readVec2,
  report,
  reportDuplicateIds,
  runValidator,
  shown,
} from './reader.ts';
import type { Ctx } from './reader.ts';
import { addWire, emptyWiring, indexPlacedParts, judgeWire, resolvePort } from './wiring.ts';
import type { PortEnd } from './wiring.ts';

/** How far, in mm and degrees, a mounted part may sit from where its mount puts it. */
export const PLACEMENT_TOLERANCE = { mm: 0.01, degrees: 0.01 } as const;

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

/** A high-water mark: a whole number up to Number.MAX_SAFE_INTEGER, so every id below it is exact. */
const COUNT = { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true } as const;

const readMeta = (ctx: Ctx, value: unknown, path: string): BlueprintMeta | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'name', 'level', 'createdAt', 'updatedAt', 'highWater'], ['author']);
  if (!record) return undefined;
  readUuid(ctx, field(record, 'id'), at(path, 'id'));
  readName(ctx, field(record, 'name'), at(path, 'name'));
  readLevel(ctx, field(record, 'level'), at(path, 'level'));
  readTimestamp(ctx, field(record, 'createdAt'), at(path, 'createdAt'));
  readTimestamp(ctx, field(record, 'updatedAt'), at(path, 'updatedAt'));
  readUuid(ctx, field(record, 'author'), at(path, 'author'));
  const highWater = readObject(ctx, field(record, 'highWater'), at(path, 'highWater'), ['parts', 'wires']);
  if (highWater) {
    readNumber(ctx, field(highWater, 'parts'), at(at(path, 'highWater'), 'parts'), COUNT);
    readNumber(ctx, field(highWater, 'wires'), at(at(path, 'highWater'), 'wires'), COUNT);
  }
  return ctx.issues.length === mark ? (record as unknown as BlueprintMeta) : undefined;
};

/** The number in a `p<n>` or `w<n>` id, or undefined for any other id. */
export const idNumber = (prefix: 'p' | 'w', id: string): number | undefined => {
  if (!id.startsWith(prefix) || !/^\d+$/.test(id.slice(1))) return undefined;
  const n = Number(id.slice(1));
  return Number.isSafeInteger(n) ? n : undefined;
};

const checkHighWater = (ctx: Ctx, blueprint: Blueprint, path: string): void => {
  const lists = [
    ['parts', 'p', blueprint.parts, blueprint.meta.highWater.parts],
    ['wires', 'w', blueprint.wires, blueprint.meta.highWater.wires],
  ] as const;
  for (const [list, prefix, items, mark] of lists) {
    items.forEach((item, index) => {
      const n = idNumber(prefix, item.id);
      if (n !== undefined && n > mark) {
        report(ctx, 'id.above_high_water', at(at(at(path, list), index), 'id'), `'${item.id}' is above meta.highWater.${list} (${mark}).`);
      }
    });
  }
};

/** Structure only: fields, formats, ids unique and under the high-water mark. Needs no catalogue. */
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
  if (ctx.issues.length !== mark) return undefined;
  const blueprint = record as unknown as Blueprint;
  checkHighWater(ctx, blueprint, path);
  return ctx.issues.length === mark ? blueprint : undefined;
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

const angleGap = (a: number, b: number): number => {
  const gap = normalizeDegrees(a - b);
  return Math.min(gap, 360 - gap);
};

/** A mounted part must sit where its mount puts it: the mount is authoritative for its place. */
const checkMountedPlace = (
  ctx: Ctx,
  blueprint: Blueprint,
  partsPath: string,
  fixing: { readonly child: PlacedPart; readonly host: PlacedPart; readonly mount: MountPort; readonly point: MountPointPort },
  hostMirrored: boolean,
): void => {
  const { child, host, mount, point } = fixing;
  const expected = canvasPoseOf({ ...host.position, rotation: host.rotation, mirrored: hostMirrored }, mountPlacement(point, mount));
  const index = blueprint.parts.indexOf(child);
  const where = `On '${host.id}' at '${point.id}', '${child.id}' sits at (${expected.x}, ${expected.y}) turned ${expected.rotation}°.`;
  const offX = Math.abs(child.position.x - expected.x) > PLACEMENT_TOLERANCE.mm;
  const offY = Math.abs(child.position.y - expected.y) > PLACEMENT_TOLERANCE.mm;
  if (offX || offY) report(ctx, 'mount.misplaced', at(at(partsPath, index), 'position'), where);
  else if (angleGap(child.rotation, expected.rotation) > PLACEMENT_TOLERANCE.degrees) {
    report(ctx, 'mount.misplaced', at(at(partsPath, index), 'rotation'), where);
  }
};

/** Checks part types, settings, wire ends, wiring legality and mounted places against the catalogue. */
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
  const mounts: { child: PlacedPart; host: PlacedPart; mount: MountPort; point: MountPointPort }[] = [];
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
    if (judgement.kind === 'mount') {
      const [mountEnd, pointEnd] = judgement.from === from.ref ? [from, to] : [to, from];
      const child = placed.get(mountEnd.ref.part);
      const host = placed.get(pointEnd.ref.part);
      if (child && host) mounts.push({ child, host, mount: mountEnd.spec as MountPort, point: pointEnd.spec as MountPointPort });
    }
  });
  if (mounts.length > 0) {
    // A host that is itself mirrored on the canvas mirrors where its own mounts put their parts.
    const placements = placeParts(blueprint, catalogue);
    for (const fixing of mounts) {
      checkMountedPlace(ctx, blueprint, partsPath, fixing, placements.get(fixing.host.id)?.placement.mirrored ?? false);
    }
  }
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
 * The full check: structure, part types, settings, wire ends, wiring legality (impossible drops, full
 * ports, duplicates, stored orientation, mount loops), mounted places and the arena. Legal-but-wrong
 * wiring passes.
 */
export const validateBlueprint = (value: unknown, catalogue: Catalogue): ValidationResult<Blueprint> =>
  runValidator(value, (ctx, root) => readBlueprint(ctx, root, '$', catalogue));

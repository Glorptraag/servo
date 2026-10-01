import type { Blueprint, SettingValue } from '../types/blueprint.ts';
import type { ArenaPresetId, Level, PartTypeId, PlacedPartId, ProfileId, SettingId, Vec2, WireId } from '../types/common.ts';
import type { PortRef } from '../types/port.ts';
import { idNumber } from '../validate/blueprint.ts';
import { canonicalJson } from '../validate/canonical.ts';
import {
  SLUG,
  at,
  field,
  isRecord,
  readLevel,
  readList,
  readName,
  readNumber,
  readObject,
  readSlug,
  readUuid,
  readVec2,
  report,
  reportDuplicateIds,
  runValidator,
} from '../validate/reader.ts';
import type { Ctx } from '../validate/reader.ts';
import { derivedUuid } from './digest.ts';
import type { MigrationStep } from './runner.ts';

/**
 * Version 0: a synthetic format from before the first release, kept to prove the migration path from day
 * one (ground rule 5). It differs from version 1 in five ways:
 * - a placed part names its part record as `type`, and turns in whole quarter turns clockwise as `turns`;
 * - `arena` is the preset id alone, because version 0 had no props;
 * - `meta.title` is the build's name;
 * - `meta.created` and `meta.modified` are whole milliseconds since 1970-01-01T00:00:00.000Z;
 * - `meta` has no `id` and no `highWater`.
 * Part ids, positions and settings, the wires, the level and the author are as in version 1, and
 * directional wires were already written source first. See docs/migrations.md.
 */
export interface BlueprintV0 {
  readonly version: 0;
  readonly parts: readonly PlacedPartV0[];
  readonly wires: readonly WireV0[];
  readonly arena: ArenaPresetId;
  readonly meta: BlueprintMetaV0;
}

export interface PlacedPartV0 {
  readonly id: PlacedPartId;
  readonly type: PartTypeId;
  readonly position: Vec2;
  /** Quarter turns clockwise on the canvas. */
  readonly turns: 0 | 1 | 2 | 3;
  readonly settings: Readonly<Record<SettingId, SettingValue>>;
}

export interface WireV0 {
  readonly id: WireId;
  readonly from: PortRef;
  readonly to: PortRef;
}

export interface BlueprintMetaV0 {
  readonly title: string;
  readonly level: Level;
  /** Milliseconds since 1970-01-01T00:00:00.000Z. */
  readonly created: number;
  readonly modified: number;
  readonly author?: ProfileId;
}

const QUARTER_TURNS = { min: 0, max: 3, integer: true } as const;

/** From 1970 to 9999-12-31T23:59:59.999Z, the last moment a timestamp with a four-digit year can name. */
const EPOCH_MS = { min: 0, max: 253_402_300_799_999, integer: true } as const;

// Version 0's own reader. It is frozen with version 0, so it uses only the reader kit's primitives and
// never version 1's readers, which a later version may change.

const readSettings = (ctx: Ctx, value: unknown, path: string): void => {
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

const readPart = (ctx: Ctx, value: unknown, path: string): PlacedPartV0 | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'type', 'position', 'turns', 'settings']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  readSlug(ctx, field(record, 'type'), at(path, 'type'));
  readVec2(ctx, field(record, 'position'), at(path, 'position'));
  readNumber(ctx, field(record, 'turns'), at(path, 'turns'), QUARTER_TURNS);
  readSettings(ctx, field(record, 'settings'), at(path, 'settings'));
  return ctx.issues.length === mark ? (record as unknown as PlacedPartV0) : undefined;
};

const readPortRef = (ctx: Ctx, value: unknown, path: string): PortRef | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['part', 'port']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'part'), at(path, 'part'));
  readSlug(ctx, field(record, 'port'), at(path, 'port'));
  return ctx.issues.length === mark ? (record as unknown as PortRef) : undefined;
};

const readWire = (ctx: Ctx, value: unknown, path: string): WireV0 | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'from', 'to']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  readPortRef(ctx, field(record, 'from'), at(path, 'from'));
  readPortRef(ctx, field(record, 'to'), at(path, 'to'));
  return ctx.issues.length === mark ? (record as unknown as WireV0) : undefined;
};

const readMeta = (ctx: Ctx, value: unknown, path: string): BlueprintMetaV0 | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['title', 'level', 'created', 'modified'], ['author']);
  if (!record) return undefined;
  readName(ctx, field(record, 'title'), at(path, 'title'));
  readLevel(ctx, field(record, 'level'), at(path, 'level'));
  readNumber(ctx, field(record, 'created'), at(path, 'created'), EPOCH_MS);
  readNumber(ctx, field(record, 'modified'), at(path, 'modified'), EPOCH_MS);
  readUuid(ctx, field(record, 'author'), at(path, 'author'));
  return ctx.issues.length === mark ? (record as unknown as BlueprintMetaV0) : undefined;
};

/** Reads a version 0 blueprint strictly, reporting every problem with a path into it. */
const readBlueprintV0 = (ctx: Ctx, value: unknown): BlueprintV0 | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, '$', ['version', 'parts', 'wires', 'arena', 'meta']);
  if (!record) return undefined;
  const version = field(record, 'version');
  if (version !== undefined && version !== 0) {
    report(
      ctx,
      'value.not_allowed',
      '$.version',
      typeof version === 'number' ? `This step reads version 0; this document is version ${version}.` : 'This step reads version 0; this version is not a number.',
    );
  }
  const parts = field(record, 'parts');
  readList(ctx, parts, '$.parts', readPart);
  reportDuplicateIds(ctx, Array.isArray(parts) ? parts : undefined, '$.parts');
  const wires = field(record, 'wires');
  readList(ctx, wires, '$.wires', readWire);
  reportDuplicateIds(ctx, Array.isArray(wires) ? wires : undefined, '$.wires');
  readSlug(ctx, field(record, 'arena'), '$.arena');
  readMeta(ctx, field(record, 'meta'), '$.meta');
  return ctx.issues.length === mark ? (record as unknown as BlueprintV0) : undefined;
};

/** What the derived id hashes before the document, so it never matches an id derived for anything else. */
export const V0_ID_SOURCE = 'servo-blueprint-v0\n';

/**
 * Version 0 had no blueprint id, so one is derived from the whole stored document: the same version 0
 * document gets the same id on every device and every load, whether or not the migrated form is saved.
 */
const derivedBlueprintId = (v0: BlueprintV0): string => derivedUuid(`${V0_ID_SOURCE}${canonicalJson(v0)}`);

/** The highest number already in a `p<n>` or `w<n>` id, so no id in use is given out again. */
const highest = (prefix: 'p' | 'w', items: readonly { readonly id: string }[]): number =>
  items.reduce((top, item) => Math.max(top, idNumber(prefix, item.id) ?? 0), 0);

/** A pure conversion of a stored number, exactly as version 1 writes timestamps. No clock is read. */
const timestamp = (ms: number): string => new Date(ms).toISOString();

/** The same build as version 1. Every object is new, so the result shares nothing with the input. */
const toVersion1 = (v0: BlueprintV0): Blueprint => ({
  version: 1,
  parts: v0.parts.map((part) => ({
    id: part.id,
    part: part.type,
    position: { x: part.position.x, y: part.position.y },
    rotation: part.turns * 90,
    settings: { ...part.settings },
  })),
  wires: v0.wires.map((wire) => ({
    id: wire.id,
    from: { part: wire.from.part, port: wire.from.port },
    to: { part: wire.to.part, port: wire.to.port },
  })),
  arena: { preset: v0.arena, props: [] },
  meta: {
    id: derivedBlueprintId(v0),
    name: v0.meta.title,
    level: v0.meta.level,
    createdAt: timestamp(v0.meta.created),
    updatedAt: timestamp(v0.meta.modified),
    ...(v0.meta.author === undefined ? {} : { author: v0.meta.author }),
    highWater: { parts: highest('p', v0.parts), wires: highest('w', v0.wires) },
  },
});

/** Version 0 → version 1. Needs no catalogue: wires keep the ends and order they were stored with. */
export const v0ToV1: MigrationStep = {
  from: 0,
  to: 1,
  migrate: (document) =>
    runValidator(document, (ctx, root) => {
      const v0 = readBlueprintV0(ctx, root);
      return v0 && toVersion1(v0);
    }),
};

import type { ArenaPreset, ArenaRef, Prop } from '../types/arena.ts';
import type { Vec2 } from '../types/common.ts';
import type { ValidationResult } from '../types/issue.ts';
import type { Catalogue } from './catalogue.ts';
import {
  POSITIVE,
  at,
  field,
  isRecord,
  readBoolean,
  readEnum,
  readList,
  readNumber,
  readObject,
  readPose,
  readSlug,
  readText,
  readVec2,
  readVec3,
  report,
  reportDuplicateIds,
  runValidator,
} from './reader.ts';
import type { Ctx } from './reader.ts';

const inside = (point: Vec2, size: Vec2): boolean => point.x >= 0 && point.y >= 0 && point.x <= size.x && point.y <= size.y;

const checkInside = (ctx: Ctx, point: Vec2 | undefined, size: Vec2 | undefined, path: string): void => {
  if (point && size && !inside(point, size)) {
    report(ctx, 'arena.outside', path, `(${point.x}, ${point.y}) lies outside the ${size.x} × ${size.y} mm floor.`);
  }
};

const readRectangle = (ctx: Ctx, record: Readonly<Record<string, unknown>>, path: string, size: Vec2 | undefined): void => {
  const from = readVec2(ctx, field(record, 'from'), at(path, 'from'));
  const to = readVec2(ctx, field(record, 'to'), at(path, 'to'));
  if (from && to && (from.x >= to.x || from.y >= to.y)) {
    report(ctx, 'value.inconsistent', at(path, 'to'), "'to' must be above and to the right of 'from'.");
  }
  checkInside(ctx, from, size, at(path, 'from'));
  checkInside(ctx, to, size, at(path, 'to'));
};

export const readProp = (ctx: Ctx, value: unknown, path: string, size?: Vec2): Prop | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'shape', 'size', 'grams', 'at', 'fixed']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  const shape = readEnum(ctx, field(record, 'shape'), at(path, 'shape'), ['box', 'cylinder'] as const);
  const dimensions = readVec3(ctx, field(record, 'size'), at(path, 'size'), POSITIVE);
  if (shape === 'cylinder' && dimensions && dimensions.x !== dimensions.y) {
    report(ctx, 'value.inconsistent', at(path, 'size'), "A cylinder's size gives its diameter as both x and y.");
  }
  readNumber(ctx, field(record, 'grams'), at(path, 'grams'), POSITIVE);
  const pose = readPose(ctx, field(record, 'at'), at(path, 'at'));
  checkInside(ctx, pose, size, at(path, 'at'));
  readBoolean(ctx, field(record, 'fixed'), at(path, 'fixed'));
  return ctx.issues.length === mark ? (record as unknown as Prop) : undefined;
};

const FEATURE_LISTS = ['walls', 'zones', 'lines', 'ramps', 'props'] as const;

export const readArenaPreset = (ctx: Ctx, value: unknown, path: string): ArenaPreset | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'name', 'size', 'friction', 'start', ...FEATURE_LISTS]);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  readText(ctx, field(record, 'name'), at(path, 'name'));
  const size = readVec2(ctx, field(record, 'size'), at(path, 'size'), POSITIVE);
  readNumber(ctx, field(record, 'friction'), at(path, 'friction'), POSITIVE);
  const start = readPose(ctx, field(record, 'start'), at(path, 'start'));
  checkInside(ctx, start, size, at(path, 'start'));

  readList(ctx, field(record, 'walls'), at(path, 'walls'), (c, v, p) => {
    const m = c.issues.length;
    const wall = readObject(c, v, p, ['id', 'from', 'to', 'thicknessMm']);
    if (!wall) return undefined;
    readSlug(c, field(wall, 'id'), at(p, 'id'));
    const from = readVec2(c, field(wall, 'from'), at(p, 'from'));
    const to = readVec2(c, field(wall, 'to'), at(p, 'to'));
    if (from && to && from.x === to.x && from.y === to.y) report(c, 'value.inconsistent', at(p, 'to'), 'A wall’s two ends must be different points.');
    checkInside(c, from, size, at(p, 'from'));
    checkInside(c, to, size, at(p, 'to'));
    readNumber(c, field(wall, 'thicknessMm'), at(p, 'thicknessMm'), POSITIVE);
    return c.issues.length === m ? wall : undefined;
  });
  readList(ctx, field(record, 'zones'), at(path, 'zones'), (c, v, p) => {
    const m = c.issues.length;
    const zone = readObject(c, v, p, ['id', 'from', 'to']);
    if (!zone) return undefined;
    readSlug(c, field(zone, 'id'), at(p, 'id'));
    readRectangle(c, zone, p, size);
    return c.issues.length === m ? zone : undefined;
  });
  readList(ctx, field(record, 'lines'), at(path, 'lines'), (c, v, p) => {
    const m = c.issues.length;
    const line = readObject(c, v, p, ['id', 'points', 'widthMm']);
    if (!line) return undefined;
    readSlug(c, field(line, 'id'), at(p, 'id'));
    const points = readList(c, field(line, 'points'), at(p, 'points'), (cc, vv, pp) => readVec2(cc, vv, pp), 2);
    points?.forEach((point, index) => checkInside(c, point, size, at(at(p, 'points'), index)));
    readNumber(c, field(line, 'widthMm'), at(p, 'widthMm'), POSITIVE);
    return c.issues.length === m ? line : undefined;
  });
  readList(ctx, field(record, 'ramps'), at(path, 'ramps'), (c, v, p) => {
    const m = c.issues.length;
    const ramp = readObject(c, v, p, ['id', 'from', 'to', 'riseMm', 'uphill']);
    if (!ramp) return undefined;
    readSlug(c, field(ramp, 'id'), at(p, 'id'));
    readRectangle(c, ramp, p, size);
    readNumber(c, field(ramp, 'riseMm'), at(p, 'riseMm'), POSITIVE);
    readEnum(c, field(ramp, 'uphill'), at(p, 'uphill'), ['+x', '-x', '+y', '-y'] as const);
    return c.issues.length === m ? ramp : undefined;
  });
  readList(ctx, field(record, 'props'), at(path, 'props'), (c, v, p) => readProp(c, v, p, size));

  // Walls, zones, lines, ramps and props share one id space, so a goal's reference is never ambiguous.
  const seen = new Set<string>();
  for (const list of FEATURE_LISTS) {
    const items = field(record, list);
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      const id = isRecord(item) ? field(item, 'id') : undefined;
      if (typeof id !== 'string') return;
      if (seen.has(id)) report(ctx, 'id.duplicate', at(at(at(path, list), index), 'id'), `The id '${id}' is already used in this arena.`);
      seen.add(id);
    });
  }
  return ctx.issues.length === mark ? (record as unknown as ArenaPreset) : undefined;
};

/** Checks an arena preset: floor, start, walls, zones, lines, ramps and props, all on the floor. */
export const validateArenaPreset = (value: unknown): ValidationResult<ArenaPreset> =>
  runValidator(value, (ctx, root) => readArenaPreset(ctx, root, '$'));

/** The structure of a blueprint's or challenge's arena: a preset id and the props the child added. */
export const readArenaRef = (ctx: Ctx, value: unknown, path: string): ArenaRef | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['preset', 'props']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'preset'), at(path, 'preset'));
  const props = field(record, 'props');
  readList(ctx, props, at(path, 'props'), (c, v, p) => readProp(c, v, p));
  reportDuplicateIds(ctx, Array.isArray(props) ? props : undefined, at(path, 'props'));
  return ctx.issues.length === mark ? (record as unknown as ArenaRef) : undefined;
};

/** Checks an arena reference against the catalogue's presets, when it has them. */
export const checkArenaRef = (ctx: Ctx, arena: ArenaRef, path: string, catalogue: Catalogue): ArenaPreset | undefined => {
  if (!catalogue.arenas) return undefined;
  const preset = catalogue.arenas.get(arena.preset);
  if (!preset) {
    report(ctx, 'ref.unknown_arena', at(path, 'preset'), `No arena preset has the id '${arena.preset}'.`);
    return undefined;
  }
  const taken = new Set(FEATURE_LISTS.flatMap((list) => preset[list].map((feature) => feature.id)));
  arena.props.forEach((prop, index) => {
    const propPath = at(at(path, 'props'), index);
    if (taken.has(prop.id)) report(ctx, 'id.duplicate', at(propPath, 'id'), `The preset already uses the id '${prop.id}'.`);
    checkInside(ctx, prop.at, preset.size, at(propPath, 'at'));
  });
  return preset;
};

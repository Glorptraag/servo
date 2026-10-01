import { BINDABLE_PARAMS, PRIMITIVE_KINDS } from '../types/behaviour.ts';
import type { Primitive, PrimitiveKind } from '../types/behaviour.ts';
import type { ValidationResult } from '../types/issue.ts';
import { EFFECTS, UNMET } from '../types/part.ts';
import type { FailureMode, Need, NeedKind, PartIdentity, PartRecord, Setting } from '../types/part.ts';
import { AXES } from '../types/port.ts';
import type { MechanicalRole, PortSpec } from '../types/port.ts';
import { DOMAINS, PART_FAMILIES } from '../types/taxonomy.ts';
import {
  FRACTION,
  NON_NEGATIVE,
  POSITIVE,
  at,
  field,
  inRange,
  isRecord,
  onStep,
  readArray,
  readAssetKey,
  readBoolean,
  readEnum,
  readHexColour,
  readLevel,
  readList,
  readNumber,
  readObject,
  readQuarterTurn,
  readSlug,
  readString,
  readText,
  readVec2,
  readVec3,
  report,
  reportDuplicateIds,
  reportRepeats,
  runValidator,
  sameValue,
} from './reader.ts';
import type { Ctx, Range } from './reader.ts';

const FAMILY_IDS = PART_FAMILIES.map((family) => family.id);
const DOMAIN_IDS = DOMAINS.map((domain) => domain.id);
const NEED_KINDS = Object.keys(UNMET) as NeedKind[];

// ---------------------------------------------------------------------------------------------
// Structure

const readIdentity = (ctx: Ctx, value: unknown, path: string): PartIdentity | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['name', 'family', 'domains', 'level', 'art', 'colours']);
  if (!record) return undefined;
  readText(ctx, field(record, 'name'), at(path, 'name'));
  readEnum(ctx, field(record, 'family'), at(path, 'family'), FAMILY_IDS);
  const domains = field(record, 'domains');
  readList(ctx, domains, at(path, 'domains'), (c, v, p) => readEnum(c, v, p, DOMAIN_IDS), 1);
  reportRepeats(ctx, Array.isArray(domains) ? domains : undefined, at(path, 'domains'));
  readLevel(ctx, field(record, 'level'), at(path, 'level'));
  readAssetKey(ctx, field(record, 'art'), at(path, 'art'));
  const colours = readObject(ctx, field(record, 'colours'), at(path, 'colours'), ['main', 'accent']);
  if (colours) {
    readHexColour(ctx, field(colours, 'main'), at(at(path, 'colours'), 'main'));
    readHexColour(ctx, field(colours, 'accent'), at(at(path, 'colours'), 'accent'));
  }
  return ctx.issues.length === mark ? (record as unknown as PartIdentity) : undefined;
};

const readBody = (ctx: Ctx, value: unknown, path: string): void => {
  const record = readObject(ctx, value, path, ['grams', 'size', 'centreOfMass']);
  if (!record) return;
  readNumber(ctx, field(record, 'grams'), at(path, 'grams'), POSITIVE);
  const size = readVec3(ctx, field(record, 'size'), at(path, 'size'), POSITIVE);
  const centre = readVec3(ctx, field(record, 'centreOfMass'), at(path, 'centreOfMass'));
  if (size && centre) {
    const inside =
      Math.abs(centre.x) <= size.x / 2 && Math.abs(centre.y) <= size.y / 2 && centre.z >= 0 && centre.z <= size.z;
    if (!inside) {
      report(ctx, 'value.inconsistent', at(path, 'centreOfMass'), 'The centre of mass lies outside the part’s box.');
    }
  }
};

const readPort = (ctx: Ctx, value: unknown, path: string): PortSpec | undefined => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected an object.');
    return undefined;
  }
  const type = readEnum(ctx, field(value, 'type'), at(path, 'type'), ['power', 'signal', 'mechanical'] as const);
  if (type === 'power') {
    const record = readObject(ctx, value, path, ['id', 'type', 'label', 'polarity']);
    if (record) readEnum(ctx, field(record, 'polarity'), at(path, 'polarity'), ['positive', 'negative', 'none'] as const);
  } else if (type === 'signal') {
    const record = readObject(ctx, value, path, ['id', 'type', 'label', 'direction']);
    if (record) readEnum(ctx, field(record, 'direction'), at(path, 'direction'), ['in', 'out'] as const);
  } else if (type === 'mechanical') {
    const role = readEnum(ctx, field(value, 'role'), at(path, 'role'), ['drive-out', 'drive-in', 'mount', 'mount-point'] as const);
    if (role === 'drive-out' || role === 'drive-in') {
      readObject(ctx, value, path, ['id', 'type', 'label', 'role', 'at', 'axis']);
      readEnum(ctx, field(value, 'axis'), at(path, 'axis'), AXES);
    } else if (role === 'mount') {
      readObject(ctx, value, path, ['id', 'type', 'label', 'role', 'at', 'yaw']);
      readQuarterTurn(ctx, field(value, 'yaw'), at(path, 'yaw'));
    } else if (role === 'mount-point') {
      readObject(ctx, value, path, ['id', 'type', 'label', 'role', 'at', 'yaw', 'mirrored']);
      readQuarterTurn(ctx, field(value, 'yaw'), at(path, 'yaw'));
      readBoolean(ctx, field(value, 'mirrored'), at(path, 'mirrored'));
    }
    readVec3(ctx, field(value, 'at'), at(path, 'at'));
  } else if (field(value, 'type') === undefined) {
    report(ctx, 'value.missing', at(path, 'type'), "Missing 'type'.");
  }
  readSlug(ctx, field(value, 'id'), at(path, 'id'));
  readText(ctx, field(value, 'label'), at(path, 'label'));
  return ctx.issues.length === mark ? (value as unknown as PortSpec) : undefined;
};

const readPair = (ctx: Ctx, value: unknown, path: string): void => {
  const record = readObject(ctx, value, path, ['pos', 'neg']);
  if (!record) return;
  readSlug(ctx, field(record, 'pos'), at(path, 'pos'));
  readSlug(ctx, field(record, 'neg'), at(path, 'neg'));
};

const readSlugList = (ctx: Ctx, value: unknown, path: string, minItems = 0): void => {
  readList(ctx, value, path, readSlug, minItems);
  reportRepeats(ctx, Array.isArray(value) ? value : undefined, path);
};

const readNeed = (ctx: Ctx, value: unknown, path: string): Need | undefined => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected an object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), NEED_KINDS);
  if (kind === undefined && field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
  readSlug(ctx, field(value, 'id'), at(path, 'id'));
  switch (kind) {
    case 'power': {
      readObject(ctx, value, path, ['id', 'kind', 'supply', 'minVolts', 'maxVolts']);
      readPair(ctx, field(value, 'supply'), at(path, 'supply'));
      const min = readNumber(ctx, field(value, 'minVolts'), at(path, 'minVolts'), NON_NEGATIVE);
      const max = readNumber(ctx, field(value, 'maxVolts'), at(path, 'maxVolts'), POSITIVE);
      if (min !== undefined && max !== undefined && min >= max) {
        report(ctx, 'value.inconsistent', at(path, 'maxVolts'), 'maxVolts must be above minVolts.');
      }
      break;
    }
    case 'signal':
    case 'mount':
    case 'drive':
    case 'torque':
      readObject(ctx, value, path, ['id', 'kind', 'port']);
      readSlug(ctx, field(value, 'port'), at(path, 'port'));
      break;
    case 'loop':
    case 'isolation': {
      readObject(ctx, value, path, ['id', 'kind', 'ports']);
      const ports = readArray(ctx, field(value, 'ports'), at(path, 'ports'));
      if (ports && ports.length !== 2) report(ctx, 'value.wrong_count', at(path, 'ports'), 'Names exactly two power ports.');
      readSlugList(ctx, ports, at(path, 'ports'));
      break;
    }
    case 'floor':
    case 'balance':
      readObject(ctx, value, path, ['id', 'kind']);
      break;
    case undefined:
      break;
  }
  return ctx.issues.length === mark ? (value as unknown as Need) : undefined;
};

type FieldReader = (ctx: Ctx, value: unknown, path: string) => unknown;

const num =
  (range: Range = {}): FieldReader =>
  (ctx, value, path) =>
    readNumber(ctx, value, path, range);

const oneOf =
  (words: readonly string[]): FieldReader =>
  (ctx, value, path) =>
    readEnum(ctx, value, path, words);

const readActuation = (ctx: Ctx, value: unknown, path: string): void => {
  if (!isRecord(value)) {
    if (value !== undefined) report(ctx, 'value.wrong_type', path, 'Expected an object.');
    return;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), ['manual', 'contact'] as const);
  if (kind === 'manual') {
    readObject(ctx, value, path, ['kind', 'initially']);
    readEnum(ctx, field(value, 'initially'), at(path, 'initially'), ['open', 'closed'] as const);
  } else if (kind === 'contact') {
    readObject(ctx, value, path, ['kind', 'normally', 'probe']);
    readEnum(ctx, field(value, 'normally'), at(path, 'normally'), ['open', 'closed'] as const);
    const probe = readObject(ctx, field(value, 'probe'), at(path, 'probe'), ['from', 'to']);
    if (probe) {
      const from = readVec2(ctx, field(probe, 'from'), at(at(path, 'probe'), 'from'));
      const to = readVec2(ctx, field(probe, 'to'), at(at(path, 'probe'), 'to'));
      if (from && to && from.x === to.x && from.y === to.y) {
        report(ctx, 'value.inconsistent', at(path, 'probe'), 'The probe’s two ends must be different points.');
      }
    }
  } else if (field(value, 'kind') === undefined) {
    report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
  }
};

const readEmits = (ctx: Ctx, value: unknown, path: string): void => {
  if (value === undefined) return;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected an object.');
    return;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), ['light', 'sound'] as const);
  if (kind === 'light') {
    readObject(ctx, value, path, ['kind', 'colour']);
    readHexColour(ctx, field(value, 'colour'), at(path, 'colour'));
  } else if (kind === 'sound') {
    readObject(ctx, value, path, ['kind', 'hz']);
    readNumber(ctx, field(value, 'hz'), at(path, 'hz'), POSITIVE);
  } else if (field(value, 'kind') === undefined) {
    report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
  }
};

const PRIMITIVE_FIELDS: Record<string, Readonly<Record<string, FieldReader>>> = {
  source: {
    output: readPair,
    volts: num(POSITIVE),
    emptyVolts: num(NON_NEGATIVE),
    internalOhms: num(POSITIVE),
    capacityMah: num(POSITIVE),
  },
  switch: {
    terminals: (ctx, value, path) => {
      const list = readArray(ctx, value, path);
      if (list && list.length !== 2) report(ctx, 'value.wrong_count', path, 'Names exactly two power ports.');
      readSlugList(ctx, list, path);
    },
    actuation: readActuation,
  },
  load: {
    supply: readPair,
    whenReversed: oneOf(['blocks', 'works']),
    onVolts: num(NON_NEGATIVE),
    ratedVolts: num(POSITIVE),
    ratedMilliamps: num(POSITIVE),
  },
  'actuator:speed': {
    supply: readPair,
    drive: readSlug,
    whenReversed: oneOf(['reverses', 'blocks']),
    ratedVolts: num(POSITIVE),
    startVolts: num(NON_NEGATIVE),
    noLoadRpm: num(POSITIVE),
    stallTorqueNmm: num(POSITIVE),
    noLoadMilliamps: num(POSITIVE),
    stallMilliamps: num(POSITIVE),
    throttle: num(FRACTION),
    reverse: readBoolean,
  },
  'actuator:position': {
    supply: readPair,
    drive: readSlug,
    command: readSlug,
    ratedVolts: num(POSITIVE),
    startVolts: num(NON_NEGATIVE),
    minDeg: num(),
    maxDeg: num(),
    restDeg: num(),
    target: num(),
    degPerSecond: num(POSITIVE),
    holdingTorqueNmm: num(POSITIVE),
    idleMilliamps: num(NON_NEGATIVE),
    stallMilliamps: num(POSITIVE),
  },
  driver: {
    supply: readPair,
    output: readPair,
    command: num({ min: -1, max: 1 }),
    onVolts: num(NON_NEGATIVE),
    dropVolts: num(NON_NEGATIVE),
    maxMilliamps: num(POSITIVE),
    idleMilliamps: num(NON_NEGATIVE),
  },
  regulator: {
    supply: readPair,
    output: readPair,
    volts: num(POSITIVE),
    dropoutVolts: num(NON_NEGATIVE),
    maxMilliamps: num(POSITIVE),
  },
  program: {
    supply: readPair,
    onVolts: num(NON_NEGATIVE),
    milliamps: num(NON_NEGATIVE),
    inputs: (ctx, value, path) => readSlugList(ctx, value, path),
    outputs: (ctx, value, path) => readSlugList(ctx, value, path),
  },
  ratio: {
    input: readSlug,
    output: readSlug,
    mount: readSlug,
    ratio: num(POSITIVE),
    efficiency: num({ min: 0, above: true, max: 1 }),
  },
  wheel: {
    hub: readSlug,
    radiusMm: num(POSITIVE),
    widthMm: num(POSITIVE),
    grip: num(POSITIVE),
  },
  support: {
    mount: readSlug,
    rollingFriction: num(NON_NEGATIVE),
  },
};

const OPTIONAL_PRIMITIVE_FIELDS: Record<string, Readonly<Record<string, FieldReader>>> = {
  load: { emits: readEmits },
  driver: { signal: readSlug },
};

const inconsistent = (ctx: Ctx, path: string, message: string): void => report(ctx, 'value.inconsistent', path, message);

/** Cross-field rules inside one primitive. Runs only on a structurally valid primitive. */
const checkPrimitiveNumbers = (ctx: Ctx, primitive: Primitive, path: string): void => {
  switch (primitive.kind) {
    case 'source':
      if (primitive.emptyVolts >= primitive.volts) inconsistent(ctx, at(path, 'emptyVolts'), 'emptyVolts must be below volts.');
      break;
    case 'switch':
      if (primitive.terminals[0] === primitive.terminals[1]) inconsistent(ctx, at(path, 'terminals'), 'The two terminals must be different ports.');
      break;
    case 'load':
      if (primitive.onVolts >= primitive.ratedVolts) inconsistent(ctx, at(path, 'onVolts'), 'onVolts must be below ratedVolts.');
      break;
    case 'actuator':
      if (primitive.startVolts >= primitive.ratedVolts) inconsistent(ctx, at(path, 'startVolts'), 'startVolts must be below ratedVolts.');
      if (primitive.mode === 'speed') {
        if (primitive.noLoadMilliamps > primitive.stallMilliamps) {
          inconsistent(ctx, at(path, 'noLoadMilliamps'), 'noLoadMilliamps must not be above stallMilliamps.');
        }
      } else {
        if (primitive.minDeg >= primitive.maxDeg) inconsistent(ctx, at(path, 'maxDeg'), 'maxDeg must be above minDeg.');
        const range: Range = { min: primitive.minDeg, max: primitive.maxDeg };
        if (!inRange(primitive.restDeg, range)) inconsistent(ctx, at(path, 'restDeg'), 'restDeg must lie between minDeg and maxDeg.');
        if (!inRange(primitive.target, range)) inconsistent(ctx, at(path, 'target'), 'target must lie between minDeg and maxDeg.');
        if (primitive.idleMilliamps > primitive.stallMilliamps) {
          inconsistent(ctx, at(path, 'idleMilliamps'), 'idleMilliamps must not be above stallMilliamps.');
        }
      }
      break;
    default:
      break;
  }
};

const readPrimitive = (ctx: Ctx, value: unknown, path: string): Primitive | undefined => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected an object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), PRIMITIVE_KINDS);
  if (kind === undefined) {
    if (field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
    return undefined;
  }
  let shape = kind as string;
  if (kind === 'actuator') {
    const mode = readEnum(ctx, field(value, 'mode'), at(path, 'mode'), ['speed', 'position'] as const);
    if (mode === undefined) {
      if (field(value, 'mode') === undefined) report(ctx, 'value.missing', at(path, 'mode'), "Missing 'mode'.");
      return undefined;
    }
    shape = `actuator:${mode}`;
  }
  const fields = PRIMITIVE_FIELDS[shape] ?? {};
  const optional = OPTIONAL_PRIMITIVE_FIELDS[kind] ?? {};
  const fixed = kind === 'actuator' ? ['id', 'kind', 'mode'] : ['id', 'kind'];
  readObject(ctx, value, path, [...fixed, ...Object.keys(fields)], Object.keys(optional));
  readSlug(ctx, field(value, 'id'), at(path, 'id'));
  for (const [key, read] of [...Object.entries(fields), ...Object.entries(optional)]) read(ctx, field(value, key), at(path, key));
  if (ctx.issues.length !== mark) return undefined;
  checkPrimitiveNumbers(ctx, value as unknown as Primitive, path);
  return ctx.issues.length === mark ? (value as unknown as Primitive) : undefined;
};

const readSetting = (ctx: Ctx, value: unknown, path: string): Setting | undefined => {
  const mark = ctx.issues.length;
  if (!isRecord(value)) {
    report(ctx, 'value.wrong_type', path, 'Expected an object.');
    return undefined;
  }
  const kind = readEnum(ctx, field(value, 'kind'), at(path, 'kind'), ['number', 'choice'] as const);
  if (kind === undefined && field(value, 'kind') === undefined) report(ctx, 'value.missing', at(path, 'kind'), "Missing 'kind'.");
  const common = ['id', 'kind', 'label', 'unlockLevel', 'binds'];
  readSlug(ctx, field(value, 'id'), at(path, 'id'));
  readText(ctx, field(value, 'label'), at(path, 'label'));
  readLevel(ctx, field(value, 'unlockLevel'), at(path, 'unlockLevel'));
  const binds = readObject(ctx, field(value, 'binds'), at(path, 'binds'), ['primitive', 'param'], ['range']);
  if (binds) {
    readSlug(ctx, field(binds, 'primitive'), at(at(path, 'binds'), 'primitive'));
    readString(ctx, field(binds, 'param'), at(at(path, 'binds'), 'param'));
    const range = field(binds, 'range');
    if (range !== undefined) {
      const pair = readList(ctx, range, at(at(path, 'binds'), 'range'), (c, v, p) => readNumber(c, v, p));
      if (pair && pair.length !== 2) report(ctx, 'value.wrong_count', at(at(path, 'binds'), 'range'), 'A range is two numbers.');
    }
  }
  if (kind === 'number') {
    readObject(ctx, value, path, [...common, 'min', 'max', 'step', 'default', 'unit']);
    const min = readNumber(ctx, field(value, 'min'), at(path, 'min'));
    const max = readNumber(ctx, field(value, 'max'), at(path, 'max'));
    const step = readNumber(ctx, field(value, 'step'), at(path, 'step'), POSITIVE);
    const fallback = readNumber(ctx, field(value, 'default'), at(path, 'default'));
    const unit = readString(ctx, field(value, 'unit'), at(path, 'unit'));
    if (unit !== undefined && (unit.length > 12 || unit.trim() !== unit)) {
      report(ctx, 'value.bad_format', at(path, 'unit'), "Expected a short unit such as '°' or '%'.");
    }
    if (min !== undefined && max !== undefined && step !== undefined && fallback !== undefined) {
      if (min >= max) inconsistent(ctx, at(path, 'max'), 'max must be above min.');
      else if (!onStep(max, min, step)) inconsistent(ctx, at(path, 'step'), 'max must be a whole number of steps from min.');
      if (!inRange(fallback, { min, max }) || !onStep(fallback, min, step)) {
        inconsistent(ctx, at(path, 'default'), 'default must be one of the steps between min and max.');
      }
    }
  } else if (kind === 'choice') {
    readObject(ctx, value, path, [...common, 'options', 'default']);
    const options = field(value, 'options');
    readList(
      ctx,
      options,
      at(path, 'options'),
      (c, v, p) => {
        const m = c.issues.length;
        const option = readObject(c, v, p, ['id', 'label', 'value']);
        if (!option) return undefined;
        readSlug(c, field(option, 'id'), at(p, 'id'));
        readText(c, field(option, 'label'), at(p, 'label'));
        const optionValue = field(option, 'value');
        if (optionValue !== undefined && !['number', 'boolean', 'string'].includes(typeof optionValue)) {
          report(c, 'value.wrong_type', at(p, 'value'), 'Expected a number, true or false, or a string.');
        } else if (typeof optionValue === 'number' && !Number.isFinite(optionValue)) {
          report(c, 'value.wrong_type', at(p, 'value'), 'Expected a finite number.');
        }
        return c.issues.length === m ? option : undefined;
      },
      2,
    );
    reportDuplicateIds(ctx, Array.isArray(options) ? options : undefined, at(path, 'options'));
    const fallback = readSlug(ctx, field(value, 'default'), at(path, 'default'));
    if (fallback !== undefined && Array.isArray(options) && !options.some((o) => isRecord(o) && field(o, 'id') === fallback)) {
      report(ctx, 'ref.unknown_option', at(path, 'default'), `No option has the id '${fallback}'.`);
    }
  }
  return ctx.issues.length === mark ? (value as unknown as Setting) : undefined;
};

const readFailureMode = (ctx: Ctx, value: unknown, path: string): FailureMode | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'need', 'unmet', 'shows', 'teachingNote', 'cardLine'], ['hint']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  readSlug(ctx, field(record, 'need'), at(path, 'need'));
  readString(ctx, field(record, 'unmet'), at(path, 'unmet'));
  const shows = field(record, 'shows');
  readList(ctx, shows, at(path, 'shows'), (c, v, p) => readEnum(c, v, p, EFFECTS), 1);
  reportRepeats(ctx, Array.isArray(shows) ? shows : undefined, at(path, 'shows'));
  readText(ctx, field(record, 'teachingNote'), at(path, 'teachingNote'));
  readText(ctx, field(record, 'cardLine'), at(path, 'cardLine'));
  readText(ctx, field(record, 'hint'), at(path, 'hint'));
  return ctx.issues.length === mark ? (record as unknown as FailureMode) : undefined;
};

const readCard = (ctx: Ctx, value: unknown, path: string): void => {
  const record = readObject(ctx, value, path, ['does', 'needs', 'gives', 'popularMechanics'], ['specLine', 'realWorldArt', 'safetyNote']);
  if (!record) return;
  for (const key of ['does', 'needs', 'gives', 'popularMechanics', 'specLine', 'safetyNote']) {
    readText(ctx, field(record, key), at(path, key));
  }
  readAssetKey(ctx, field(record, 'realWorldArt'), at(path, 'realWorldArt'));
};

// ---------------------------------------------------------------------------------------------
// Cross-references inside the record

type PortUse =
  | { readonly type: 'power'; readonly as: 'pos' | 'neg' | 'terminal' }
  | { readonly type: 'signal'; readonly direction: 'in' | 'out' }
  | { readonly type: 'mechanical'; readonly role: MechanicalRole };

const describeUse = (use: PortUse): string =>
  use.type === 'power' ? 'a power port' : use.type === 'signal' ? `a signal ${use.direction} port` : `a ${use.role} port`;

const checkPortUse = (ctx: Ctx, ports: ReadonlyMap<string, PortSpec>, id: string, path: string, use: PortUse): boolean => {
  const spec = ports.get(id);
  if (!spec) {
    report(ctx, 'ref.unknown_port', path, `The part has no port '${id}'.`);
    return false;
  }
  const fits =
    spec.type === use.type &&
    (spec.type !== 'signal' || use.type !== 'signal' || spec.direction === use.direction) &&
    (spec.type !== 'mechanical' || use.type !== 'mechanical' || spec.role === use.role);
  if (!fits) {
    report(ctx, 'port.wrong_kind', path, `Port '${id}' is used as ${describeUse(use)}.`);
    return false;
  }
  if (spec.type === 'power' && use.type === 'power') {
    if ((use.as === 'pos' && spec.polarity === 'negative') || (use.as === 'neg' && spec.polarity === 'positive')) {
      report(ctx, 'port.wrong_polarity', path, `Port '${id}' is marked ${spec.polarity} but used as the ${use.as === 'pos' ? '+' : '−'} side.`);
      return false;
    }
  }
  return true;
};

const checkPairUse = (
  ctx: Ctx,
  ports: ReadonlyMap<string, PortSpec>,
  pair: { readonly pos: string; readonly neg: string },
  path: string,
): void => {
  checkPortUse(ctx, ports, pair.pos, at(path, 'pos'), { type: 'power', as: 'pos' });
  checkPortUse(ctx, ports, pair.neg, at(path, 'neg'), { type: 'power', as: 'neg' });
  if (pair.pos === pair.neg) inconsistent(ctx, at(path, 'neg'), 'pos and neg must be different ports.');
};

/** Checks every port a primitive uses; signal and mechanical ports may be used by one primitive only. */
const checkPrimitivePorts = (
  ctx: Ctx,
  ports: ReadonlyMap<string, PortSpec>,
  primitive: Primitive,
  path: string,
  owners: Map<string, string>,
): void => {
  const own = (id: string, portPath: string, use: PortUse): void => {
    if (!checkPortUse(ctx, ports, id, portPath, use)) return;
    const owner = owners.get(id);
    if (owner !== undefined) {
      report(ctx, 'port.bound_twice', portPath, `Port '${id}' is already used by primitive '${owner}'.`);
      return;
    }
    owners.set(id, primitive.id);
  };
  switch (primitive.kind) {
    case 'source':
      checkPairUse(ctx, ports, primitive.output, at(path, 'output'));
      break;
    case 'switch':
      primitive.terminals.forEach((id, index) =>
        checkPortUse(ctx, ports, id, at(at(path, 'terminals'), index), { type: 'power', as: 'terminal' }),
      );
      break;
    case 'load':
      checkPairUse(ctx, ports, primitive.supply, at(path, 'supply'));
      break;
    case 'actuator':
      checkPairUse(ctx, ports, primitive.supply, at(path, 'supply'));
      own(primitive.drive, at(path, 'drive'), { type: 'mechanical', role: 'drive-out' });
      if (primitive.mode === 'position') own(primitive.command, at(path, 'command'), { type: 'signal', direction: 'in' });
      break;
    case 'driver':
      checkPairUse(ctx, ports, primitive.supply, at(path, 'supply'));
      checkPairUse(ctx, ports, primitive.output, at(path, 'output'));
      if (primitive.signal !== undefined) own(primitive.signal, at(path, 'signal'), { type: 'signal', direction: 'in' });
      break;
    case 'regulator':
      checkPairUse(ctx, ports, primitive.supply, at(path, 'supply'));
      checkPairUse(ctx, ports, primitive.output, at(path, 'output'));
      break;
    case 'program':
      checkPairUse(ctx, ports, primitive.supply, at(path, 'supply'));
      primitive.inputs.forEach((id, index) => own(id, at(at(path, 'inputs'), index), { type: 'signal', direction: 'in' }));
      primitive.outputs.forEach((id, index) => own(id, at(at(path, 'outputs'), index), { type: 'signal', direction: 'out' }));
      break;
    case 'ratio':
      own(primitive.input, at(path, 'input'), { type: 'mechanical', role: 'drive-in' });
      own(primitive.output, at(path, 'output'), { type: 'mechanical', role: 'drive-out' });
      own(primitive.mount, at(path, 'mount'), { type: 'mechanical', role: 'mount' });
      break;
    case 'wheel':
      own(primitive.hub, at(path, 'hub'), { type: 'mechanical', role: 'drive-in' });
      break;
    case 'support':
      own(primitive.mount, at(path, 'mount'), { type: 'mechanical', role: 'mount' });
      break;
  }
};

const checkNeedPorts = (
  ctx: Ctx,
  ports: ReadonlyMap<string, PortSpec>,
  need: Need,
  path: string,
  behaviour: readonly Primitive[] | undefined,
): void => {
  switch (need.kind) {
    case 'power':
      checkPairUse(ctx, ports, need.supply, at(path, 'supply'));
      break;
    case 'signal':
      checkPortUse(ctx, ports, need.port, at(path, 'port'), { type: 'signal', direction: 'in' });
      break;
    case 'mount':
      checkPortUse(ctx, ports, need.port, at(path, 'port'), { type: 'mechanical', role: 'mount' });
      break;
    case 'drive':
      checkPortUse(ctx, ports, need.port, at(path, 'port'), { type: 'mechanical', role: 'drive-in' });
      break;
    case 'torque':
      if (
        checkPortUse(ctx, ports, need.port, at(path, 'port'), { type: 'mechanical', role: 'drive-out' }) &&
        behaviour &&
        !behaviour.some((primitive) => primitive.kind === 'actuator' && primitive.drive === need.port)
      ) {
        report(ctx, 'port.wrong_kind', at(path, 'port'), `A torque need names an actuator's drive port; no actuator drives '${need.port}'.`);
      }
      break;
    case 'loop':
    case 'isolation':
      need.ports.forEach((id, index) => checkPortUse(ctx, ports, id, at(at(path, 'ports'), index), { type: 'power', as: 'terminal' }));
      if (need.ports[0] === need.ports[1]) inconsistent(ctx, at(path, 'ports'), 'The two ports must be different ports.');
      break;
    case 'floor':
      if (behaviour && !behaviour.some((primitive) => primitive.kind === 'wheel' || primitive.kind === 'support')) {
        report(ctx, 'need.wrong_part', path, 'A floor need belongs to a part with a wheel or support primitive.');
      }
      break;
    case 'balance':
      break;
  }
};

type ParamDomain = { readonly type: 'number'; readonly range: Range } | { readonly type: 'boolean' } | { readonly type: 'colour' };

/** The parameter a setting may drive on this primitive, with its allowed values, and its value in the record. */
const bindable = (
  primitive: Primitive,
  param: string,
): { readonly domain: ParamDomain; readonly current: number | boolean | string } | undefined => {
  const names: Readonly<Record<string, string>> = BINDABLE_PARAMS[primitive.kind as PrimitiveKind];
  if (!Object.hasOwn(names, param)) return undefined;
  switch (primitive.kind) {
    case 'actuator':
      if (primitive.mode === 'speed' && param === 'throttle') return { domain: { type: 'number', range: FRACTION }, current: primitive.throttle };
      if (primitive.mode === 'speed' && param === 'reverse') return { domain: { type: 'boolean' }, current: primitive.reverse };
      if (primitive.mode === 'position' && param === 'target') {
        return { domain: { type: 'number', range: { min: primitive.minDeg, max: primitive.maxDeg } }, current: primitive.target };
      }
      return undefined;
    case 'load':
      if (param === 'colour' && primitive.emits?.kind === 'light') return { domain: { type: 'colour' }, current: primitive.emits.colour };
      if (param === 'hz' && primitive.emits?.kind === 'sound') return { domain: { type: 'number', range: POSITIVE }, current: primitive.emits.hz };
      return undefined;
    case 'driver':
      return { domain: { type: 'number', range: { min: -1, max: 1 } }, current: primitive.command };
    case 'ratio':
      return { domain: { type: 'number', range: POSITIVE }, current: primitive.ratio };
    default:
      return undefined;
  }
};

const fitsDomain = (value: unknown, domain: ParamDomain): boolean => {
  if (domain.type === 'number') return typeof value === 'number' && inRange(value, domain.range);
  if (domain.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
};

/** A number setting's value mapped onto its parameter. */
export const mapSettingValue = (setting: { readonly min: number; readonly max: number; readonly binds: { readonly range?: readonly [number, number] } }, value: number): number => {
  const range = setting.binds.range;
  if (!range) return value;
  return range[0] + ((value - setting.min) / (setting.max - setting.min)) * (range[1] - range[0]);
};

const checkSettingBinding = (ctx: Ctx, setting: Setting, path: string, behaviour: readonly Primitive[], bound: Map<string, string>): void => {
  const bindsPath = at(path, 'binds');
  const primitive = behaviour.find((p) => p.id === setting.binds.primitive);
  if (!primitive) {
    report(ctx, 'ref.unknown_primitive', at(bindsPath, 'primitive'), `The part has no primitive '${setting.binds.primitive}'.`);
    return;
  }
  const target = bindable(primitive, setting.binds.param);
  if (!target) {
    report(ctx, 'setting.bad_binding', at(bindsPath, 'param'), `A setting cannot drive '${setting.binds.param}' on this ${primitive.kind}.`);
    return;
  }
  const key = `${primitive.id}.${setting.binds.param}`;
  const other = bound.get(key);
  if (other !== undefined) {
    report(ctx, 'setting.duplicate_binding', bindsPath, `Setting '${other}' already drives '${key}'.`);
    return;
  }
  bound.set(key, setting.id);
  if (setting.kind === 'number') {
    if (target.domain.type !== 'number') {
      report(ctx, 'setting.bad_binding', at(bindsPath, 'param'), `'${setting.binds.param}' takes ${target.domain.type === 'boolean' ? 'true or false' : 'a colour'}; use a choice setting.`);
      return;
    }
    if (setting.binds.range && setting.binds.range.length !== 2) return;
    const low = mapSettingValue(setting, setting.min);
    const high = mapSettingValue(setting, setting.max);
    if (!inRange(low, target.domain.range) || !inRange(high, target.domain.range)) {
      report(ctx, 'setting.bad_binding', bindsPath, `The setting maps outside what '${setting.binds.param}' allows.`);
      return;
    }
    if (!sameValue(mapSettingValue(setting, setting.default), target.current)) {
      report(ctx, 'setting.default_mismatch', at(path, 'default'), `The default gives ${String(mapSettingValue(setting, setting.default))}, but the primitive has ${String(target.current)}.`);
    }
  } else {
    if (setting.binds.range !== undefined) {
      report(ctx, 'setting.bad_binding', at(bindsPath, 'range'), 'Only a number setting maps a range.');
      return;
    }
    let optionsFit = true;
    setting.options.forEach((option, index) => {
      if (!fitsDomain(option.value, target.domain)) {
        report(ctx, 'setting.bad_option', at(at(at(path, 'options'), index), 'value'), `This value does not suit '${setting.binds.param}'.`);
        optionsFit = false;
      }
    });
    const chosen = setting.options.find((option) => option.id === setting.default);
    if (optionsFit && chosen && !sameValue(chosen.value, target.current)) {
      report(ctx, 'setting.default_mismatch', at(path, 'default'), `The default option gives ${String(chosen.value)}, but the primitive has ${String(target.current)}.`);
    }
  }
};

// ---------------------------------------------------------------------------------------------
// The record

const arrayOrUndefined = (value: unknown): readonly unknown[] | undefined => (Array.isArray(value) ? value : undefined);

export const readPartRecord = (ctx: Ctx, value: unknown, path: string): PartRecord | undefined => {
  const mark = ctx.issues.length;
  const record = readObject(ctx, value, path, ['id', 'identity', 'body', 'ports', 'needs', 'behaviour', 'settings', 'failureModes', 'card']);
  if (!record) return undefined;
  readSlug(ctx, field(record, 'id'), at(path, 'id'));
  const identity = readIdentity(ctx, field(record, 'identity'), at(path, 'identity'));
  readBody(ctx, field(record, 'body'), at(path, 'body'));

  const portsPath = at(path, 'ports');
  const ports = readList(ctx, field(record, 'ports'), portsPath, readPort, 1);
  reportDuplicateIds(ctx, arrayOrUndefined(field(record, 'ports')), portsPath);
  const needsPath = at(path, 'needs');
  const needs = readList(ctx, field(record, 'needs'), needsPath, readNeed);
  reportDuplicateIds(ctx, arrayOrUndefined(field(record, 'needs')), needsPath);
  const behaviourPath = at(path, 'behaviour');
  const behaviour = readList(ctx, field(record, 'behaviour'), behaviourPath, readPrimitive);
  reportDuplicateIds(ctx, arrayOrUndefined(field(record, 'behaviour')), behaviourPath);
  const settingsPath = at(path, 'settings');
  const settings = readList(ctx, field(record, 'settings'), settingsPath, readSetting);
  reportDuplicateIds(ctx, arrayOrUndefined(field(record, 'settings')), settingsPath);
  const failuresPath = at(path, 'failureModes');
  const failureModes = readList(ctx, field(record, 'failureModes'), failuresPath, readFailureMode);
  reportDuplicateIds(ctx, arrayOrUndefined(field(record, 'failureModes')), failuresPath);
  readCard(ctx, field(record, 'card'), at(path, 'card'));

  if (ports) {
    const portMap = new Map(ports.map((port) => [port.id, port] as const));
    const owners = new Map<string, string>();
    const beforeBindings = ctx.issues.length;
    behaviour?.forEach((primitive, index) => checkPrimitivePorts(ctx, portMap, primitive, at(behaviourPath, index), owners));
    // A torque need is checked against the actuators only when their own bindings are sound, to avoid a cascade.
    const bound = ctx.issues.length === beforeBindings ? behaviour : undefined;
    needs?.forEach((need, index) => checkNeedPorts(ctx, portMap, need, at(needsPath, index), bound));
  }
  if (settings && behaviour) {
    const bound = new Map<string, string>();
    settings.forEach((setting, index) => checkSettingBinding(ctx, setting, at(settingsPath, index), behaviour, bound));
  }
  if (settings && identity) {
    settings.forEach((setting, index) => {
      if (setting.unlockLevel < identity.level) {
        report(ctx, 'setting.unlock_before_part', at(at(settingsPath, index), 'unlockLevel'), `The part is introduced at level ${identity.level}.`);
      }
    });
  }
  if (failureModes && needs) {
    const seen = new Set<string>();
    failureModes.forEach((mode, index) => {
      const need = needs.find((n) => n.id === mode.need);
      const modePath = at(failuresPath, index);
      if (!need) {
        report(ctx, 'ref.unknown_need', at(modePath, 'need'), `The part has no need '${mode.need}'.`);
        return;
      }
      const ways: readonly string[] = UNMET[need.kind];
      if (!ways.includes(mode.unmet)) {
        report(ctx, 'failure.bad_unmet', at(modePath, 'unmet'), `A ${need.kind} need goes unmet as ${ways.map((w) => `'${w}'`).join(', ')}.`);
        return;
      }
      if (need.kind === 'floor' && mode.unmet === 'slipping' && behaviour && !behaviour.some((primitive) => primitive.kind === 'wheel')) {
        report(ctx, 'failure.bad_unmet', at(modePath, 'unmet'), 'Only a part with a wheel primitive slips.');
        return;
      }
      const key = `${mode.need}.${mode.unmet}`;
      if (seen.has(key)) report(ctx, 'failure.duplicate_condition', modePath, `Another failure mode already covers '${key}'.`);
      seen.add(key);
    });
  }
  return ctx.issues.length === mark ? (record as unknown as PartRecord) : undefined;
};

/** Checks a part record: structure, text rules, and every port, primitive, need and setting reference inside it. */
export const validatePartRecord = (value: unknown): ValidationResult<PartRecord> =>
  runValidator(value, (ctx, root) => readPartRecord(ctx, root, '$'));

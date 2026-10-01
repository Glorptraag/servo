import { mapSettingValue } from '@servo/schema';
import type { PartRecord, PlacedPart, Primitive, Setting } from '@servo/schema';

/**
 * Settings drive primitive parameters through their `binds` (the schema's BINDABLE_PARAMS). The graph keeps the
 * child's values unapplied in `placed.settings`; here they replace the record's values, once per Run.
 */

/** What a setting gives its parameter on a placed part: the child's value or the default, mapped by `mapSettingValue` or read from the chosen option. */
const settingValue = (setting: Setting, placed: PlacedPart): number | boolean | string | undefined => {
  const value = placed.settings[setting.id] ?? setting.default;
  if (setting.kind === 'choice') return setting.options.find((option) => option.id === value)?.value;
  return typeof value === 'number' ? mapSettingValue(setting, value) : undefined;
};

const within = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);

/** The primitive with one bindable parameter replaced, when the value suits it; otherwise unchanged. */
const withParam = (primitive: Primitive, param: string, value: number | boolean | string | undefined): Primitive => {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  switch (primitive.kind) {
    case 'actuator':
      if (primitive.mode === 'speed') {
        if (param === 'throttle' && number !== undefined) return { ...primitive, throttle: within(number, 0, 1) };
        if (param === 'reverse' && typeof value === 'boolean') return { ...primitive, reverse: value };
        return primitive;
      }
      if (param === 'target' && number !== undefined) return { ...primitive, target: within(number, primitive.minDeg, primitive.maxDeg) };
      return primitive;
    case 'load':
      if (param === 'colour' && typeof value === 'string' && primitive.emits?.kind === 'light') return { ...primitive, emits: { ...primitive.emits, colour: value } };
      if (param === 'hz' && number !== undefined && number > 0 && primitive.emits?.kind === 'sound') return { ...primitive, emits: { ...primitive.emits, hz: number } };
      return primitive;
    case 'driver':
      if (param === 'command' && number !== undefined) return { ...primitive, command: within(number, -1, 1) };
      return primitive;
    case 'ratio':
      if (param === 'ratio' && number !== undefined && number > 0) return { ...primitive, ratio: number };
      return primitive;
    default:
      return primitive;
  }
};

/**
 * A placed part's primitives in the record's order, each parameter a setting binds set to that setting's value
 * on the part. Values apply as the blueprint stores them, as the schema's `wiredNeeds` reads a channel's setting.
 */
export const settledPrimitives = (record: PartRecord, placed: PlacedPart): readonly Primitive[] =>
  record.behaviour.map((primitive) =>
    record.settings
      .filter((setting) => setting.binds.primitive === primitive.id)
      .reduce((settled, setting) => withParam(settled, setting.binds.param, settingValue(setting, placed)), primitive),
  );

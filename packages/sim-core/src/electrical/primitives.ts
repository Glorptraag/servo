import { mapSettingValue } from '@servo/schema';
import type { PositionActuator, PrimitiveId, SourcePrimitive, SpeedActuator } from '@servo/schema';
import type { GraphPart } from '../graph/index.ts';

/**
 * The electrical model of each primitive kind, from its record's parameters alone (ground rule 1). Units
 * inside the solver are volts, amps and ohms; records give milliamps, so they are divided by 1000 here.
 * See docs/electrical.md.
 */

/**
 * The value a placed part's setting gives one of its primitive's parameters, or undefined when no setting
 * binds it. A number setting maps its range onto the parameter (`mapSettingValue`); a choice gives its
 * option's value. The graph keeps the child's values unapplied, in `placed.settings`.
 */
export const settingValue = (part: GraphPart, primitive: PrimitiveId, param: string): number | boolean | string | undefined => {
  const setting = part.record.settings.find((each) => each.binds.primitive === primitive && each.binds.param === param);
  if (!setting) return undefined;
  const value = part.placed.settings[setting.id] ?? setting.default;
  if (setting.kind === 'choice') return setting.options.find((option) => option.id === value)?.value;
  return typeof value === 'number' ? mapSettingValue(setting, value) : undefined;
};

/** A speed actuator's throttle (0–1) and reverse flag on a placed part: its settings' values, or the record's own. */
export const speedSettings = (part: GraphPart, spec: SpeedActuator): { readonly throttle: number; readonly reverse: boolean } => {
  const throttle = settingValue(part, spec.id, 'throttle');
  const reverse = settingValue(part, spec.id, 'reverse');
  return {
    throttle: typeof throttle === 'number' ? Math.min(1, Math.max(0, throttle)) : spec.throttle,
    reverse: typeof reverse === 'boolean' ? reverse : spec.reverse,
  };
};

/** A battery's open-circuit volts at a charge: `volts` when full, falling in a straight line to `emptyVolts` when drained. */
export const batteryEmf = (spec: SourcePrimitive, charge: number): number => {
  const left = charge > 1 ? 1 : charge > 0 ? charge : 0;
  return spec.emptyVolts + (spec.volts - spec.emptyVolts) * left;
};

/**
 * A speed actuator (a DC motor) as the circuit sees it: a winding with resistance and a back-EMF that grows
 * with speed, and a no-load draw while it turns.
 * - `ohms`: ratedVolts over the stall current, so at its rated volts a stalled motor draws stallMilliamps.
 * - `voltsPerRpm`: ratedVolts over noLoadRpm, so with no load its speed is ∝ voltage × throttle, as the record says.
 * - `nmmPerAmp`: stallTorqueNmm over the stall current: the torque the winding current gives.
 * - `noLoadAmps`: noLoadMilliamps, drawn on top of the winding current while it turns. So turning a load costs
 *   the same current at any voltage, and a lower voltage drains more for each revolution (D17).
 */
export interface SpeedActuatorModel {
  readonly ohms: number;
  readonly voltsPerRpm: number;
  readonly nmmPerAmp: number;
  readonly noLoadAmps: number;
}

export const speedActuatorModel = (spec: SpeedActuator): SpeedActuatorModel => {
  const stallAmps = spec.stallMilliamps / 1000;
  return {
    ohms: spec.ratedVolts / stallAmps,
    voltsPerRpm: spec.ratedVolts / spec.noLoadRpm,
    nmmPerAmp: spec.stallTorqueNmm / stallAmps,
    noLoadAmps: spec.noLoadMilliamps / 1000,
  };
};

/**
 * The speed a speed actuator settles at, in shaft rpm, with `volts` across its supply and `loadNmm` (at least 0)
 * holding it back: noLoadRpm × (throttle × volts ÷ ratedVolts − load ÷ stallTorqueNmm), the record's "speed ∝
 * voltage × throttle, reduced by load". It is still below startVolts, and stalled once the load reaches the
 * torque it can give at that voltage. Reversed supply turns it the other way, or not at all when it blocks; the
 * reverse flag turns the shaft the other way. The electrical model's steady state: with this speed fed back,
 * its winding current is exactly what the load needs. For the behaviour runtime and the mechanical solver.
 */
export const steadyRpm = (spec: SpeedActuator, volts: number, loadNmm = 0, throttle = spec.throttle, reverse = spec.reverse): number => {
  const drive = throttle * volts;
  if (drive === 0 || (drive < 0 && spec.whenReversed === 'blocks')) return 0;
  const size = drive < 0 ? -drive : drive;
  if (size < spec.startVolts) return 0;
  const share = size / spec.ratedVolts - (loadNmm > 0 ? loadNmm : 0) / spec.stallTorqueNmm;
  if (share <= 0) return 0;
  const rpm = spec.noLoadRpm * share;
  return (drive < 0) !== reverse ? -rpm : rpm;
};

/**
 * What a position actuator (a servo motor) draws while it has power: idleMilliamps holding still with no
 * load, rising in a straight line to stallMilliamps as its load reaches holdingTorqueNmm.
 */
export const positionActuatorMilliamps = (spec: PositionActuator, loadNmm: number): number => {
  const share = Math.min(1, (loadNmm < 0 ? -loadNmm : loadNmm) / spec.holdingTorqueNmm);
  return spec.idleMilliamps + (spec.stallMilliamps - spec.idleMilliamps) * share;
};

import type { DriverPrimitive, LoadPrimitive, PositionActuator, ProgramPrimitive, RegulatorPrimitive, SpeedActuator } from '@servo/schema';

/**
 * The rule of each primitive kind, from its record's parameters alone (ground rule 1): no part's id, name or
 * family is read anywhere in this package. Rated values are measured at `ratedVolts`, so speed, torque and
 * sweep rate all scale with volts over ratedVolts. Plain arithmetic in a fixed order (ground rule 2). See
 * docs/behaviour.md.
 */

/** A current this small is numerical noise, not flow, mA. */
export const FLOWING_MILLIAMPS = 0.001;

/** Rounds −0 to 0, so equal states give equal bytes. */
export const clean = (value: number): number => (value === 0 ? 0 : value);

export const magnitude = (value: number): number => (value < 0 ? -value : value);

/** A signal level read as 0–1. Anything that is not a finite number carries no signal. */
export const signalLevel = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value < 0 ? 0 : value > 1 ? 1 : value;
};

export interface SpeedRule {
  readonly state: 'idle' | 'turning' | 'stalled';
  readonly rpm: number;
  readonly reversed: boolean;
  readonly capacityNmm: number;
  /** The volts that drive it: throttle × supply volts, as a size. 0 when idle. */
  readonly drive: number;
}

/**
 * A speed actuator (brief Section 6: shaft speed ∝ voltage, reduced by load; stalls above a load limit). The
 * drive is throttle × volts; reversed supply turns it the other way (`reverses`) or not at all (`blocks`), and
 * `reverse` flips it again. Below startVolts it does not turn. Otherwise its speed is noLoadRpm × (drive ÷
 * ratedVolts − load ÷ stallTorqueNmm), and where that reaches 0 it has stalled: the load is at least the torque
 * it can give at this drive, stallTorqueNmm × drive ÷ ratedVolts.
 */
export const speedRule = (spec: SpeedActuator, volts: number, loadNmm: number): SpeedRule => {
  const drive = spec.whenReversed === 'blocks' && volts < 0 ? 0 : spec.throttle * volts;
  const size = magnitude(drive);
  if (size === 0 || size < spec.startVolts) return { state: 'idle', rpm: 0, reversed: false, capacityNmm: 0, drive: 0 };
  const capacityNmm = (spec.stallTorqueNmm * size) / spec.ratedVolts;
  const share = size / spec.ratedVolts - loadNmm / spec.stallTorqueNmm;
  if (share <= 0) return { state: 'stalled', rpm: 0, reversed: false, capacityNmm, drive: size };
  const rpm = spec.noLoadRpm * share;
  const reversed = drive < 0;
  return { state: 'turning', rpm: reversed !== spec.reverse ? -rpm : rpm, reversed, capacityNmm, drive: size };
};

export interface PositionRule {
  readonly state: 'idle' | 'sweeping' | 'settled' | 'holding' | 'stalled';
  readonly angle: number;
  readonly commanded?: number;
  readonly sweep: number;
  readonly capacityNmm: number;
}

/**
 * A position actuator (a servo motor), from `angle` for `seconds`. It works only the right way round, from
 * startVolts. With power:
 * - a load at or past what it can push (holdingTorqueNmm × volts ÷ ratedVolts) stalls it where it is;
 * - with no signal it holds where it is (and hums);
 * - with a signal it sweeps towards the angle the level commands (0 at minDeg, 1 at maxDeg), at degPerSecond ×
 *   (volts ÷ ratedVolts − load ÷ holdingTorqueNmm), and settles there.
 * `target` is not read here: how a Level 3 program uses it is the program runtime's.
 */
export const positionRule = (spec: PositionActuator, angle: number, volts: number, level: number | undefined, loadNmm: number, seconds: number): PositionRule => {
  if (!(volts > 0) || volts < spec.startVolts) return { state: 'idle', angle, sweep: 0, capacityNmm: 0 };
  const capacityNmm = (spec.holdingTorqueNmm * volts) / spec.ratedVolts;
  const share = volts / spec.ratedVolts - loadNmm / spec.holdingTorqueNmm;
  if (share <= 0) return { state: 'stalled', angle, sweep: 0, capacityNmm };
  if (level === undefined) return { state: 'holding', angle, sweep: 0, capacityNmm };
  const commanded = spec.minDeg + level * (spec.maxDeg - spec.minDeg);
  if (angle === commanded) return { state: 'settled', angle, commanded, sweep: 0, capacityNmm };
  const sweep = spec.degPerSecond * share;
  const step = sweep * (seconds > 0 ? seconds : 0);
  const gap = commanded - angle;
  const next = magnitude(gap) <= step ? commanded : gap < 0 ? angle - step : angle + step;
  return { state: 'sweeping', angle: next, commanded, sweep, capacityNmm };
};

/** How fast a position actuator sweeps at its rated volts against a load: what `slow` compares with. */
export const ratedSweep = (spec: PositionActuator, loadNmm: number): number => {
  const share = 1 - loadNmm / spec.holdingTorqueNmm;
  return share > 0 ? spec.degPerSecond * share : 0;
};

/**
 * A load's light or sound, 0–1: its current over ratedMilliamps. It draws nothing up to onVolts and rises in a
 * straight line to ratedMilliamps at ratedVolts (the rule the electrical solver solves the circuit with), so the
 * level is (volts − onVolts) ÷ (ratedVolts − onVolts), at most 1. Reversed, `blocks` gives nothing and `works`
 * gives the same as the right way round.
 */
export const loadLevel = (spec: LoadPrimitive, volts: number): number => {
  const across = volts < 0 ? (spec.whenReversed === 'blocks' ? 0 : -volts) : volts;
  if (!(across > spec.onVolts)) return 0;
  const level = (across - spec.onVolts) / (spec.ratedVolts - spec.onVolts);
  return level > 1 ? 1 : level;
};

/** A motor-driver channel or a brain does nothing below onVolts on its supply. */
export const switchedOn = (spec: DriverPrimitive | ProgramPrimitive, volts: number): boolean => volts > 0 && volts >= spec.onVolts;

/** A regulator holds its output at its volts while its supply is at least volts + dropoutVolts. */
export const regulating = (spec: RegulatorPrimitive, volts: number): boolean => volts >= spec.volts + spec.dropoutVolts;

/** A motor-driver channel's command: a driven signal's level sets it; otherwise its control's setting does (NaN reads as stop). */
export const channelCommand = (level: number | undefined, setting: number): number => {
  const command = level ?? (Number.isFinite(setting) ? setting : 0);
  return command < -1 ? -1 : command > 1 ? 1 : command;
};

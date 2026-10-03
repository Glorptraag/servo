// The spec card's live readouts in Run mode: each value a part reports (sim-core's frame.live, the fold of the
// RunEvents so far), with its real unit. The value shown is the run record's value, rounded only for reading.
import type { ValuePayload } from '@servo/schema';

export type ReadoutKey = keyof ValuePayload;

interface ReadoutSpec {
  readonly key: ReadoutKey;
  readonly label: string;
  /** How a number reads: decimals kept, a factor (0–1 fractions read as percent) and the unit beside it. */
  readonly decimals: number;
  readonly scale: number;
  readonly unit: string;
}

/** In ValuePayload's order. `closed` reads as words, so it has no unit. */
export const READOUT_SPECS: readonly ReadoutSpec[] = [
  { key: 'volts', label: 'Voltage', decimals: 1, scale: 1, unit: ' V' },
  { key: 'milliamps', label: 'Current', decimals: 0, scale: 1, unit: ' mA' },
  { key: 'charge', label: 'Charge', decimals: 0, scale: 100, unit: '%' },
  { key: 'rpm', label: 'Speed', decimals: 0, scale: 1, unit: ' rpm' },
  { key: 'angle', label: 'Angle', decimals: 0, scale: 1, unit: '°' },
  { key: 'light', label: 'Light', decimals: 0, scale: 100, unit: '%' },
  { key: 'signal', label: 'Signal', decimals: 0, scale: 100, unit: '%' },
  { key: 'closed', label: 'Switch', decimals: 0, scale: 1, unit: '' },
];

export const SWITCH_WORDS = { closed: 'Closed', open: 'Open' } as const;

export interface Readout {
  readonly key: ReadoutKey;
  readonly label: string;
  /** Exactly the run record's value. */
  readonly value: number | boolean;
  /** What the card shows: the value rounded for reading, with its unit. */
  readonly text: string;
}

/** A number rounded to `decimals`, with a real minus sign, and never `−0`. */
const rounded = (value: number, decimals: number): string => {
  const fixed = value.toFixed(decimals);
  const zero = Number(fixed) === 0;
  return zero ? Math.abs(Number(fixed)).toFixed(decimals) : fixed.replace('-', '−');
};

export const formatReadout = (key: ReadoutKey, value: number | boolean): string => {
  const spec = READOUT_SPECS.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`No readout '${key}'.`);
  if (typeof value === 'boolean') return value ? SWITCH_WORDS.closed : SWITCH_WORDS.open;
  return `${rounded(value * spec.scale, spec.decimals)}${spec.unit}`;
};

/** Every readout a part reports now, in ValuePayload's order. */
export const readoutsOf = (values: ValuePayload): readonly Readout[] =>
  READOUT_SPECS.flatMap((spec) => {
    const value = values[spec.key];
    return value === undefined ? [] : [{ key: spec.key, label: spec.label, value, text: formatReadout(spec.key, value) }];
  });

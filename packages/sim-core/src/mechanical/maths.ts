/**
 * The mechanical solver's deterministic arithmetic (ground rule 2). Only +, −, ×, ÷, Math.sqrt and the exact helpers
 * (abs, min, max, floor, sign) appear here, so every result is bit-identical on every engine. Angles that feed a Run
 * go through the schema's `cosSin`; the one inverse this package needs, the arctangent of a slope, is the fixed series
 * below. No Math.sin, cos, tan, atan2, pow, exp, log or hypot.
 */

export const DEGREES_PER_RADIAN = 180 / Math.PI;
export const RADIANS_PER_DEGREE = Math.PI / 180;

/** Adds zero, so a −0 never reaches a state, an output or a snapshot. */
export const clean = (value: number): number => value + 0;

export const finite = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? value : 0);

export const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);

export const magnitude = (value: number): number => (value < 0 ? -value : value);

export const length = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** An angle in radians brought into (−π, π]. */
export const wrapRadians = (angle: number): number => {
  let turned = angle;
  while (turned > Math.PI) turned -= 2 * Math.PI;
  while (turned <= -Math.PI) turned += 2 * Math.PI;
  return turned;
};

const SQRT3 = Math.sqrt(3);
// tan(π/12) = 2 − √3: past it, atan(a) = π/6 + atan((a√3 − 1) / (a + √3)) brings the argument back below it.
const TAN_PI_12 = 2 - SQRT3;

/** atan(y) for |y| ≤ tan(π/12) ≈ 0.268, by its Taylor series to y^31 (the first term left out is below 1e-19). */
const atanNear = (y: number): number => {
  const y2 = y * y;
  let sum = 0;
  for (let n = 31; n >= 3; n -= 2) sum = y2 * ((n % 4 === 1 ? 1 : -1) / n + sum);
  return y + y * sum;
};

/** The arctangent of a slope, in degrees: −90 to 90. Exact at 0 and plain arithmetic throughout. */
export const atanDegrees = (slope: number): number => {
  if (!Number.isFinite(slope)) return Number.isNaN(slope) ? 0 : slope > 0 ? 90 : -90;
  const sign = slope < 0 ? -1 : 1;
  const size = magnitude(slope);
  // Past 1, atan(a) = π/2 − atan(1/a).
  const flip = size > 1;
  const a = flip ? 1 / size : size;
  const near = a > TAN_PI_12 ? Math.PI / 6 + atanNear((a * SQRT3 - 1) / (a + SQRT3)) : atanNear(a);
  const radians = flip ? Math.PI / 2 - near : near;
  return clean(sign * radians * DEGREES_PER_RADIAN);
};

/**
 * Solves the 3 × 3 system A x = b by Gaussian elimination with partial pivoting, in a fixed order. `a` is row-major.
 * Undefined when A is singular to working precision.
 */
export const solve3 = (a: readonly number[], b: readonly number[]): readonly [number, number, number] | undefined => {
  const m = [
    [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0],
    [a[3] ?? 0, a[4] ?? 0, a[5] ?? 0, b[1] ?? 0],
    [a[6] ?? 0, a[7] ?? 0, a[8] ?? 0, b[2] ?? 0],
  ];
  let scale = 0;
  for (const row of m) for (let column = 0; column < 3; column += 1) scale = Math.max(scale, magnitude(row[column] ?? 0));
  if (!(scale > 0)) return undefined;
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (magnitude(m[row]?.[column] ?? 0) > magnitude(m[pivot]?.[column] ?? 0)) pivot = row;
    }
    const top = m[pivot] as number[];
    if (magnitude(top[column] ?? 0) <= scale * 1e-12) return undefined;
    if (pivot !== column) {
      m[pivot] = m[column] as number[];
      m[column] = top;
    }
    for (let row = column + 1; row < 3; row += 1) {
      const target = m[row] as number[];
      const factor = (target[column] ?? 0) / (top[column] ?? 1);
      for (let k = column; k < 4; k += 1) target[k] = (target[k] ?? 0) - factor * (top[k] ?? 0);
    }
  }
  const x = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    const line = m[row] as number[];
    let sum = line[3] ?? 0;
    for (let k = row + 1; k < 3; k += 1) sum -= (line[k] ?? 0) * (x[k] ?? 0);
    x[row] = sum / (line[row] ?? 1);
  }
  return [x[0] ?? 0, x[1] ?? 0, x[2] ?? 0];
};

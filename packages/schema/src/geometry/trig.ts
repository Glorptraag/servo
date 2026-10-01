/**
 * Deterministic sine and cosine of an angle in degrees: exact range reduction to 0–45°, then fixed
 * polynomials (the Taylor series to x^15 and x^16, in Horner form). Every step is an IEEE 754 double +, −,
 * ×, ÷ or %, which every JavaScript engine rounds the same way, so the results are bit-identical on every
 * device. Quarter turns are exact; elsewhere the error is below 1e-15.
 *
 * This is the trigonometry sim-core uses. Nothing on a path that feeds a Run may call the engine's own
 * sin, cos, tan, atan2, exp, log or pow: their last bit differs between engines. See docs/geometry.md.
 */

// Math.PI is one exactly specified double, and one correctly rounded division gives the same value everywhere.
const RADIANS_PER_DEGREE = Math.PI / 180;

// Taylor coefficients ±1/n!, each a correctly rounded division.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = -1 / 1307674368000;
const C2 = -1 / 2;
const C4 = 1 / 24;
const C6 = -1 / 720;
const C8 = 1 / 40320;
const C10 = -1 / 3628800;
const C12 = 1 / 479001600;
const C14 = -1 / 87178291200;
const C16 = 1 / 20922789888000;

/** sin x for 0 ≤ x ≤ π/4, in Horner form. The first term left out is below 5e-17. */
const sinNear = (x: number): number => {
  const x2 = x * x;
  return x + x * x2 * (S3 + x2 * (S5 + x2 * (S7 + x2 * (S9 + x2 * (S11 + x2 * (S13 + x2 * S15))))));
};

/** cos x for 0 ≤ x ≤ π/4, in Horner form. The first term left out is below 3e-18. */
const cosNear = (x: number): number => {
  const x2 = x * x;
  return 1 + x2 * (C2 + x2 * (C4 + x2 * (C6 + x2 * (C8 + x2 * (C10 + x2 * (C12 + x2 * (C14 + x2 * C16)))))));
};

/** Adds zero, so a −0 never escapes. */
const clean = (value: number): number => value + 0;

/** The cosine and sine of an angle in degrees, deterministically. */
export const cosSin = (degrees: number): readonly [number, number] => {
  // % is exact; adding 360 to a tiny negative remainder can round up to 360, which is 0.
  let turn = degrees % 360;
  if (turn < 0) turn += 360;
  if (turn >= 360) turn = 0;
  const quadrant = turn < 90 ? 0 : turn < 180 ? 1 : turn < 270 ? 2 : 3;
  // Exact by Sterbenz's lemma: turn lies within a factor of two of quadrant × 90.
  const within = turn - quadrant * 90;
  let c: number;
  let s: number;
  if (within === 0) {
    c = 1;
    s = 0;
  } else if (within <= 45) {
    const x = within * RADIANS_PER_DEGREE;
    c = cosNear(x);
    s = sinNear(x);
  } else {
    // 90 − within is exact for 45 ≤ within ≤ 90.
    const x = (90 - within) * RADIANS_PER_DEGREE;
    c = sinNear(x);
    s = cosNear(x);
  }
  if (quadrant === 0) return [clean(c), clean(s)];
  if (quadrant === 1) return [clean(-s), clean(c)];
  if (quadrant === 2) return [clean(-c), clean(-s)];
  return [clean(s), clean(-c)];
};

/** Deterministic sine of an angle in degrees. */
export const sinDegrees = (degrees: number): number => cosSin(degrees)[1];

/** Deterministic cosine of an angle in degrees. */
export const cosDegrees = (degrees: number): number => cosSin(degrees)[0];

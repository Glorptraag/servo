// The zoom control's ladder (src/shell/zoom.ts): half powers of two, with the default and 400% on it.
import { describe, expect, it } from 'vitest';
import { zoomInFrom, zoomOutFrom } from '../../src/shell/zoom.ts';

describe('the zoom ladder', () => {
  it('climbs from the default zoom to 400% in four taps', () => {
    const steps = [1];
    while (steps.length < 5) steps.push(zoomInFrom(steps.at(-1) ?? 1));
    expect(steps.map((zoom) => Number(zoom.toFixed(4)))).toEqual([1, 1.4142, 2, 2.8284, 4]);
  });

  it('comes back down the same rungs', () => {
    const steps = [4];
    while (steps.length < 7) steps.push(zoomOutFrom(steps.at(-1) ?? 4));
    expect(steps.map((zoom) => Number(zoom.toFixed(4)))).toEqual([4, 2.8284, 2, 1.4142, 1, 0.7071, 0.5]);
  });

  it('lands on the nearest rung after a pinch leaves the zoom between two', () => {
    expect(zoomInFrom(1.3)).toBeCloseTo(Math.SQRT2, 12);
    expect(zoomOutFrom(1.3)).toBe(1);
    expect(zoomInFrom(0.6)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(zoomOutFrom(0.6)).toBe(0.5);
  });

  it('never skips a rung for float error', () => {
    expect(zoomInFrom(Math.SQRT2 * (1 + 1e-12))).toBeCloseTo(2, 12);
    expect(zoomInFrom(Math.SQRT2 * (1 - 1e-12))).toBeCloseTo(2, 12);
    expect(zoomOutFrom(2 * (1 + 1e-12))).toBeCloseTo(Math.SQRT2, 12);
    expect(zoomOutFrom(2 * (1 - 1e-12))).toBeCloseTo(Math.SQRT2, 12);
  });
});

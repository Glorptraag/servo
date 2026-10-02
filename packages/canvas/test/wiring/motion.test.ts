// How wiring moves (task 3.3, brief Sections 10 and 11): short UI motion, an elastic settle, a soft spring back. Pure.
import { describe, expect, it } from 'vitest';
import { FAN_MS, REACH_MS, SETTLE_MS, SPRING_BACK_MS, easeOut, elastic } from '../../src/wiring/motion.ts';

const samples = (curve: (t: number) => number): number[] => Array.from({ length: 101 }, (_, k) => curve(k / 100));

describe('wiring motion', () => {
  it('keeps every motion short: 120–200 ms (brief Section 11)', () => {
    for (const ms of [FAN_MS, SETTLE_MS, SPRING_BACK_MS, REACH_MS]) {
      expect(ms).toBeGreaterThanOrEqual(120);
      expect(ms).toBeLessThanOrEqual(200);
    }
  });

  it('settles a wire elastically: past its socket a little, then back, ending on it', () => {
    const curve = samples(elastic);
    expect(curve[0]).toBe(0);
    expect(curve[100]).toBe(1);
    const peak = Math.max(...curve);
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.25);
    expect(Math.abs((curve[90] as number) - 1)).toBeLessThan(0.02);
  });

  it('springs back softly: fast, then slowing to a stop, never past its end', () => {
    const curve = samples(easeOut);
    expect(curve[0]).toBe(0);
    expect(curve[100]).toBe(1);
    for (let k = 1; k <= 100; k++) expect(curve[k] as number).toBeGreaterThanOrEqual(curve[k - 1] as number);
    expect((curve[50] as number) - (curve[0] as number)).toBeGreaterThan((curve[100] as number) - (curve[50] as number));
  });
});

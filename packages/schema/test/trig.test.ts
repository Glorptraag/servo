import { describe, expect, it } from 'vitest';
import { arenaPoseOf, canvasPoseOf, cosDegrees, cosSin, sinDegrees } from '../src/index.ts';

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** The source with its comments removed, so a comment that names a function does not count as a call. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('deterministic sine and cosine', () => {
  it('is exact at every quarter turn, with no −0', () => {
    const quarters: [number, number, number][] = [
      [0, 1, 0],
      [90, 0, 1],
      [180, -1, 0],
      [270, 0, -1],
      [360, 1, 0],
      [450, 0, 1],
      [-90, 0, -1],
      [-180, -1, 0],
      [-270, 0, 1],
      [-360, 1, 0],
      [-0, 1, 0],
      [360 * 1e9 + 90, 0, 1],
    ];
    for (const [degrees, cos, sin] of quarters) {
      const [c, s] = cosSin(degrees);
      expect(c, `cos ${degrees}`).toBe(cos);
      expect(s, `sin ${degrees}`).toBe(sin);
    }
  });

  it('keeps the quadrant symmetries exactly', () => {
    const broken: number[] = [];
    for (let step = 0; step < 90 * 64; step += 1) {
      const degrees = step / 64;
      const [c, s] = cosSin(degrees);
      const turned = [cosSin(degrees + 90), cosSin(degrees + 180), cosSin(degrees + 270), cosSin(degrees - 360)];
      const expected = [
        [0 - s, c],
        [0 - c, 0 - s],
        [s, 0 - c],
        [c, s],
      ];
      if (turned.some((pair, index) => !Object.is(pair[0], expected[index]?.[0]) || !Object.is(pair[1], expected[index]?.[1]))) broken.push(degrees);
    }
    expect(broken).toEqual([]);
  });

  it('stays within 1e-15 of the true values', () => {
    let worst = 0;
    for (let step = 0; step <= 90_000; step += 1) {
      const degrees = step / 1000;
      const radians = (degrees * Math.PI) / 180;
      const [c, s] = cosSin(degrees);
      worst = Math.max(worst, Math.abs(c - Math.cos(radians)), Math.abs(s - Math.sin(radians)));
    }
    expect(worst).toBeLessThan(1e-15);
    let off = 0;
    for (let step = -7200; step <= 7200; step += 1) {
      const [c, s] = cosSin(step / 10 + 0.0123);
      off = Math.max(off, Math.abs(c * c + s * s - 1));
    }
    expect(off).toBeLessThan(1e-15);
    expect(Math.abs(sinDegrees(30) - 0.5)).toBeLessThan(1e-16);
    expect(Math.abs(cosDegrees(60) - 0.5)).toBeLessThan(1e-16);
    expect(Math.abs(sinDegrees(45) - Math.SQRT1_2)).toBeLessThan(2e-16);
  });

  it('is what the canvas and the Run start use', () => {
    const start = { x: 300, y: 600, heading: 30 };
    const root = { x: 0, y: 0, rotation: 0 };
    expect(arenaPoseOf(start, root, { x: 100, y: 0, rotation: 0 })).toEqual({ x: 300 + cosDegrees(30) * 100, y: 600 + sinDegrees(30) * 100, heading: 30 });
    expect(canvasPoseOf({ x: 0, y: 0, rotation: 30 }, { x: 100, y: 0, z: 0, yaw: 0, mirrored: false })).toMatchObject({
      x: cosDegrees(30) * 100,
      y: sinDegrees(30) * 100,
    });
  });

  it('leaves the engine’s own approximated maths out of every source file', () => {
    const exact = new Set(['PI', 'SQRT1_2', 'abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'sign', 'sqrt']);
    const used = Object.entries(sources).flatMap(([file, text]) =>
      [...code(text).matchAll(/\bMath\.([A-Za-z0-9_]+)/g)].map((match) => `${file}: Math.${match[1] ?? ''}`),
    );
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(used.filter((use) => !exact.has(use.slice(use.lastIndexOf('.') + 1)))).toEqual([]);
  });
});

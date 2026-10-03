import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@servo/schema';
import { distanceToSegment } from '../../src/scene/geometry.ts';
import { LABEL_STOPS, placeLabel, pointAlong } from '../../src/selection/label.ts';

const size = { w: 20, h: 10 };
const straight: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

describe('where the label of a selected wire sits', () => {
  it('sits on the middle of the line when nothing is in the way', () => {
    expect(placeLabel({ path: straight, size, avoid: [], others: [], reach: 4.8 })).toEqual({ x: 50, y: 0 });
  });

  it('slides along the line, never off it, when the middle would cover a socket or the bin', () => {
    const at = placeLabel({ path: straight, size, avoid: [{ x: 50, y: 0, r: 12 }], others: [], reach: 4.8 });
    expect(at.y).toBe(0);
    expect(Math.abs(at.x - 50)).toBeGreaterThanOrEqual(22 - 1e-9);
  });

  it('keeps off another line where it can, and stays on its own when it cannot', () => {
    const crossing: Vec2[] = [
      { x: 50, y: -40 },
      { x: 50, y: 40 },
    ];
    const off = placeLabel({ path: straight, size, avoid: [], others: [crossing], reach: 4.8 });
    expect(off.y).toBe(0);
    expect(Math.abs(off.x - 50)).toBeGreaterThan(10 + 4.8);
    const alongside: Vec2[] = [
      { x: 0, y: 2 },
      { x: 100, y: 2 },
    ];
    expect(placeLabel({ path: straight, size, avoid: [], others: [alongside], reach: 4.8 })).toEqual({ x: 50, y: 0 });
  });

  it('sits just beside a line too short to hold it, never far off', () => {
    const short: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ];
    const sockets = [
      { x: 0, y: 0, r: 8 },
      { x: 4, y: 0, r: 8 },
    ];
    const at = placeLabel({ path: short, size, avoid: sockets, others: [], reach: 4.8 });
    expect(at.x).toBeCloseTo(2);
    expect(Math.abs(at.y)).toBeGreaterThan(5);
    expect(Math.abs(at.y)).toBeLessThanOrEqual(4.8 + 5 + 2 * 10 + 1e-9);
  });

  it('stays on a line long enough to hold it even where every stop meets a socket', () => {
    const crowded = LABEL_STOPS.map((t) => ({ ...pointAlong(straight, t), r: 3 }));
    expect(placeLabel({ path: straight, size, avoid: crowded, others: [], reach: 4.8 })).toEqual({ x: 50, y: 0 });
  });

  it('follows a bent path, as a tidied route will draw one (task 3.7)', () => {
    const route: Vec2[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
    ];
    expect(placeLabel({ path: route, size, avoid: [], others: [], reach: 4.8 })).toEqual({ x: 50, y: 0 });
    const [a, b, c] = route as [Vec2, Vec2, Vec2];
    for (const t of LABEL_STOPS) {
      const point = pointAlong(route, t);
      expect(Math.min(distanceToSegment(point, a, b), distanceToSegment(point, b, c))).toBeLessThan(1e-9);
    }
  });
});

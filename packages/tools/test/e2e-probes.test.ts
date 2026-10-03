// The part probes' model of a tile (src/e2e/probes.ts): the colour a tile and its picture give at a point on screen,
// laid out as the canvas lays them, turned and flipped with the tile. The browser half
// (test/e2e/screenshots.e2e.ts and screenshot-mutations.e2e.ts) proves the probes on real screenshots.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@servo/schema';
import { rgbOf } from '../src/e2e/pixels.ts';
import { expectedColour } from '../src/e2e/probes.ts';
import type { Picture } from '../src/e2e/probes.ts';

const TILE = rgbOf(0xf8f6f2);
const RED = 0xd04e4e;
const GREEN = 0x2e7d32;
const BLUE = 0x1565c0;

/** A picture from rows of colours, top first; undefined is transparent. */
const pictureOf = (rows: readonly (readonly (number | undefined)[])[]): Picture => {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    row.forEach((colour, x) => {
      if (colour !== undefined) data.set([...rgbOf(colour), 255], (y * width + x) * 4);
    }),
  );
  return { width, height, data };
};

// A 60 × 20 mm tile at zoom 1 is 150 × 50 px. Its picture, 4 × 2, fits the 140 × 40 px inside the padding at 20 px
// a pixel, 80 × 40 px, centred: columns at 35, 55, 75 and 95 px across, rows at 5 and 25 px down.
const SIZE = { w: 60, h: 20 };
const PICTURE = pictureOf([
  [RED, RED, BLUE, undefined],
  [GREEN, RED, BLUE, undefined],
]);

/** The corners in the scene's order: the tile's own top left, top right, bottom right, bottom left. */
const corners = (topLeft: Vec2, across: Vec2, down: Vec2): Vec2[] => [
  topLeft,
  { x: topLeft.x + across.x, y: topLeft.y + across.y },
  { x: topLeft.x + across.x + down.x, y: topLeft.y + across.y + down.y },
  { x: topLeft.x + down.x, y: topLeft.y + down.y },
];

const UPRIGHT = corners({ x: 100, y: 100 }, { x: 150, y: 0 }, { x: 0, y: 50 });

describe('expectedColour', () => {
  it('gives the picture’s colour on its faces, and the tile’s around the picture and where it is transparent', () => {
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 145, y: 115 })?.colour).toEqual(rgbOf(RED));
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 145, y: 135 })?.colour).toEqual(rgbOf(GREEN));
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 185, y: 130 })?.colour).toEqual(rgbOf(BLUE));
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 120, y: 125 })?.colour).toEqual(TILE);
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 205, y: 125 })?.colour).toEqual(TILE);
  });

  it('gives nothing where the colour changes nearby, or near the tile’s edge and rounded corners', () => {
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 175, y: 130 })).toBeUndefined();
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 135, y: 130 })).toBeUndefined();
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 145, y: 125 })).toBeUndefined();
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 105, y: 125 })).toBeUndefined();
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 245, y: 125 })).toBeUndefined();
    expect(expectedColour(UPRIGHT, SIZE, PICTURE, { x: 120, y: 104 })).toBeUndefined();
  });

  it('turns the picture with the tile', () => {
    // A quarter turn clockwise on screen: the tile's across runs down the screen, its down runs to the left.
    const turned = corners({ x: 100, y: 100 }, { x: 0, y: 150 }, { x: -50, y: 0 });
    expect(expectedColour(turned, SIZE, PICTURE, { x: 85, y: 145 })?.colour).toEqual(rgbOf(RED));
    expect(expectedColour(turned, SIZE, PICTURE, { x: 65, y: 145 })?.colour).toEqual(rgbOf(GREEN));
    expect(expectedColour(turned, SIZE, PICTURE, { x: 70, y: 185 })?.colour).toEqual(rgbOf(BLUE));
  });

  it('flips the picture with a mirrored tile', () => {
    // Flipped across its own x axis, the tile's top left is at the bottom left on screen.
    const mirrored = corners({ x: 100, y: 150 }, { x: 150, y: 0 }, { x: 0, y: -50 });
    expect(expectedColour(mirrored, SIZE, PICTURE, { x: 145, y: 135 })?.colour).toEqual(rgbOf(RED));
    expect(expectedColour(mirrored, SIZE, PICTURE, { x: 145, y: 115 })?.colour).toEqual(rgbOf(GREEN));
  });

  it('scales the padding and the corners with the zoom', () => {
    // The same tile at zoom 2: the picture's first column now starts at 70 px across.
    const zoomed = corners({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 100 });
    expect(expectedColour(zoomed, SIZE, PICTURE, { x: 90, y: 30 })?.colour).toEqual(rgbOf(RED));
    expect(expectedColour(zoomed, SIZE, PICTURE, { x: 60, y: 30 })?.colour).toEqual(TILE);
    expect(expectedColour(zoomed, SIZE, PICTURE, { x: 15, y: 50 })).toBeUndefined();
  });

  it('allows the screen more where the picture shades a little within reach, and only noise where it is even', () => {
    // Two faces 5 levels apart meet 55 px across: one colour still, but not an even one.
    const shaded = pictureOf([
      [0x232e33, 0x263238, 0x263238, 0x263238],
      [0x232e33, 0x263238, 0x263238, 0x263238],
    ]);
    const near = expectedColour(UPRIGHT, SIZE, shaded, { x: 156, y: 125 });
    const far = expectedColour(UPRIGHT, SIZE, shaded, { x: 185, y: 125 });
    expect(near?.colour).toEqual(rgbOf(0x263238));
    expect(far?.colour).toEqual(rgbOf(0x263238));
    expect(near && far && near.tolerance > far.tolerance).toBe(true);
    expect(far?.tolerance).toBeLessThan(5);
  });
});

// The screenshot rule and the colour names the probes read (src/e2e/pixels.ts), on plain arrays in Node. The browser
// half (test/e2e/screenshot-mutations.e2e.ts) proves the rule on real screenshots of changed builds.
import { describe, expect, it } from 'vitest';
import { PIXEL_RULE, colourName, comparePixels, diffImage, hsv, rgbOf } from '../src/e2e/pixels.ts';
import type { Pixels } from '../src/e2e/pixels.ts';

/** A `width` × 1 image of one colour, with `changes` pixels from the left moved by `by` in the red channel. */
const strip = (width: number, base: number, changes = 0, by = 0): Pixels => {
  const data = new Uint8ClampedArray(width * 4);
  const [r, g, b] = rgbOf(base);
  for (let x = 0; x < width; x++) data.set([x < changes ? r + by : r, g, b, 255], x * 4);
  return { width, height: 1, data };
};

describe('comparePixels', () => {
  it('counts pixels whose largest channel difference passes the delta, however big the image', () => {
    const reference = strip(1000, 0x808080);
    expect(comparePixels(reference, strip(1000, 0x808080, 10, PIXEL_RULE.channelDelta))).toMatchObject({ changed: 0, matches: true, largestDelta: 24 });
    expect(comparePixels(reference, strip(1000, 0x808080, 10, PIXEL_RULE.channelDelta + 1))).toMatchObject({ changed: 10, matches: true, total: 1000 });
  });

  it('fails once more pixels change than the rule allows, a count rather than a share of the image', () => {
    const reference = strip(10_000, 0x808080);
    const rule = { channelDelta: 24, maxChangedPixels: 400 };
    expect(comparePixels(reference, strip(10_000, 0x808080, 400, 60), rule).matches).toBe(true);
    expect(comparePixels(reference, strip(10_000, 0x808080, 401, 60), rule).matches).toBe(false);
  });

  it('fails images of different sizes, counting every pixel', () => {
    const result = comparePixels(strip(10, 0), strip(11, 0));
    expect(result).toMatchObject({ sameSize: false, matches: false, changed: 11 });
  });

  it('draws a diff: changed pixels in red, the rest of the reference faded towards white', () => {
    const diff = diffImage(strip(2, 0x000000), strip(2, 0x000000, 1, 200));
    expect([...diff]).toEqual([255, 0, 0, 255, 191, 191, 191, 255]);
  });
});

describe('colourName', () => {
  it('names the canvas’s power line and its edge red, and a signal line and its edge yellow', () => {
    expect(colourName(rgbOf(0xd63a3a))).toBe('red');
    expect(colourName(rgbOf(0x8c2020))).toBe('red');
    expect(colourName(rgbOf(0xf2b31a))).toBe('yellow');
    expect(colourName(rgbOf(0x8f6a00))).toBe('yellow');
  });

  it('names nothing on the workbench, a tile, a grey linkage or a blue chassis', () => {
    for (const colour of [0xebe8e3, 0xf8f6f2, 0x8f8a82, 0x4f8bd0, 0x1565c0]) expect(colourName(rgbOf(colour)), colour.toString(16)).toBeUndefined();
  });

  it('reads hue, saturation and value', () => {
    expect(hsv(rgbOf(0xff0000))).toEqual({ hue: 0, saturation: 1, value: 1 });
    expect(hsv(rgbOf(0x808080))).toMatchObject({ saturation: 0 });
  });
});

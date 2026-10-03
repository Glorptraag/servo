// Comparing screenshots pixel by pixel, and naming a pixel's colour. Pure: plain RGBA arrays, no DOM, so the rule is
// tested in Node (test/e2e-pixels.test.ts) and the browser half only decodes and encodes PNGs. See README.md,
// "Screenshots".

/** An RGBA image, as `ImageData` holds one: four bytes a pixel, row by row. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * How a screenshot is compared with its reference. A pixel has changed when any of its colour channels differs by
 * more than `channelDelta` (out of 255); the screenshot matches while at most `maxChangedPixels` pixels have changed.
 * Counting pixels, not averaging over the image, means a small change fails however big the screenshot is.
 */
export interface PixelRule {
  readonly channelDelta: number;
  readonly maxChangedPixels: number;
}

/**
 * The harness's rule. Anti-aliasing between machines moves a channel by a few levels, so 24 leaves it out. Measured on
 * the 19 content fixtures: a build drawn again changes no pixel at all, and the smallest real change, a removed part
 * or wire, changes 1,110 pixels (busy-workbench's caster; every removed wire changes 2,862 or more). So 400 pixels,
 * 0.01% of a 2360 × 1640 screenshot, catches each with room to spare.
 */
export const PIXEL_RULE: PixelRule = { channelDelta: 24, maxChangedPixels: 400 };

export interface PixelComparison {
  /** Pixels whose largest channel difference passes the rule's delta; every pixel when the sizes differ. */
  readonly changed: number;
  readonly total: number;
  readonly sameSize: boolean;
  readonly matches: boolean;
  /** The largest channel difference seen anywhere. */
  readonly largestDelta: number;
}

const channelsDiffer = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number): number =>
  Math.max(Math.abs((a[i] as number) - (b[i] as number)), Math.abs((a[i + 1] as number) - (b[i + 1] as number)), Math.abs((a[i + 2] as number) - (b[i + 2] as number)));

/** Compares two images by `rule`. Alpha is ignored: screenshots are opaque. */
export const comparePixels = (reference: Pixels, actual: Pixels, rule: PixelRule = PIXEL_RULE): PixelComparison => {
  const total = reference.width * reference.height;
  if (reference.width !== actual.width || reference.height !== actual.height) {
    return { changed: Math.max(total, actual.width * actual.height), total, sameSize: false, matches: false, largestDelta: 255 };
  }
  let changed = 0;
  let largestDelta = 0;
  for (let i = 0; i < reference.data.length; i += 4) {
    const delta = channelsDiffer(reference.data, actual.data, i);
    if (delta > largestDelta) largestDelta = delta;
    if (delta > rule.channelDelta) changed += 1;
  }
  return { changed, total, sameSize: true, matches: changed <= rule.maxChangedPixels, largestDelta };
};

/**
 * A readable diff of two same-sized images: the reference faded towards white, with every changed pixel in solid
 * red. The same size as the reference.
 */
export const diffImage = (reference: Pixels, actual: Pixels, rule: PixelRule = PIXEL_RULE): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(reference.data.length);
  for (let i = 0; i < reference.data.length; i += 4) {
    const changed = reference.width === actual.width && reference.height === actual.height ? channelsDiffer(reference.data, actual.data, i) > rule.channelDelta : true;
    if (changed) {
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 0;
    } else {
      for (let c = 0; c < 3; c++) out[i + c] = 255 - ((255 - (reference.data[i + c] as number)) * 0.25);
    }
    out[i + 3] = 255;
  }
  return out;
};

export type Rgb = readonly [number, number, number];

/** The largest difference in any channel. */
export const colourDistance = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

export const rgbOf = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

/** `#rrggbb` to a colour. */
export const rgbOfHex = (colour: string): Rgb => rgbOf(Number.parseInt(colour.replace(/^#/, ''), 16));

export const describeRgb = (rgb: Rgb): string => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** Hue in degrees [0, 360), saturation and value in [0, 1]. */
export const hsv = ([r, g, b]: Rgb): { readonly hue: number; readonly saturation: number; readonly value: number } => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return { hue: (hue + 360) % 360, saturation: max === 0 ? 0 : delta / max, value: max / 255 };
};

/**
 * The colour names PORT_TYPE_STYLE gives power and signal lines (brief Section 13), as a pixel shows them: red for
 * power and yellow for signal, core or darker edge alike. Named by hue, so a tweak to the palette's exact values
 * keeps the probes working.
 */
export const colourName = (rgb: Rgb): 'red' | 'yellow' | undefined => {
  const { hue, saturation, value } = hsv(rgb);
  if (saturation < 0.45 || value < 0.4) return undefined;
  if (hue <= 15 || hue >= 345) return 'red';
  if (hue >= 30 && hue <= 60) return 'yellow';
  return undefined;
};

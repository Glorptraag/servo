// Screenshots: whole-element diffs against stored references, and pixel probes that read one colour from a real
// screenshot. Every screenshot is taken as the compositor shows it, rendered on SwiftShader so the pixels are the same
// on a laptop and on CI. The comparator, its tolerance and where references and diffs go are set in vitest.config.ts.
// Runs in the browser. See README.md, "Screenshots".
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import type { Vec2 } from '@servo/schema';

export type Rgb = readonly [number, number, number];

export const rgbOf = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

/** `#rrggbb` to a colour. */
export const rgbOfHex = (colour: string): Rgb => rgbOf(Number.parseInt(colour.replace(/^#/, ''), 16));

/** The largest difference in any channel. */
export const colourDistance = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

export const describeRgb = (rgb: Rgb): string => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

export interface Shot {
  /** In device pixels. */
  readonly width: number;
  readonly height: number;
  /** The colour at a point given in CSS pixels from the element's top left. */
  at(point: Vec2): Rgb;
}

/** A real screenshot of `element`, decoded for pixel probes. */
export const shoot = async (element: Element): Promise<Shot> => {
  const base64 = await page.screenshot({ element, save: false });
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D context to decode the screenshot in.');
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const box = element.getBoundingClientRect();
  const ratio = bitmap.width / box.width;
  return {
    width: bitmap.width,
    height: bitmap.height,
    at: ({ x, y }) => {
      const px = Math.min(bitmap.width - 1, Math.max(0, Math.floor(x * ratio)));
      const py = Math.min(bitmap.height - 1, Math.max(0, Math.floor(y * ratio)));
      const i = (py * bitmap.width + px) * 4;
      return [data[i] as number, data[i + 1] as number, data[i + 2] as number];
    },
  };
};

/** A pixel probe: the colour at `at` (CSS pixels from the shot element's top left) is within `tolerance` of `expected`. */
export const expectColour = (shot: Shot, at: Vec2, expected: Rgb, what: string, tolerance = 12): void => {
  const actual = shot.at(at);
  expect(colourDistance(actual, expected), `${what}: ${describeRgb(actual)} where ${describeRgb(expected)} was expected`).toBeLessThanOrEqual(tolerance);
};

/** A pixel probe: the colour at `at` is further than `tolerance` from `unexpected`. */
export const expectNotColour = (shot: Shot, at: Vec2, unexpected: Rgb, what: string, tolerance = 12): void => {
  const actual = shot.at(at);
  expect(colourDistance(actual, unexpected), `${what}: ${describeRgb(actual)}, too close to ${describeRgb(unexpected)}`).toBeGreaterThan(tolerance);
};

/**
 * Compares a screenshot of `element` with the stored reference `name`, within the tolerance vitest.config.ts sets.
 * The first run writes the reference. A failure leaves the actual image and a diff image, differing pixels in red
 * over a faded reference, under packages/tools/node_modules/.vitest-screenshots/, and names them in its message.
 */
export const expectScreenshot = async (element: Element, name: string): Promise<void> => {
  await expect.element(page.elementLocator(element)).toMatchScreenshot(name);
};

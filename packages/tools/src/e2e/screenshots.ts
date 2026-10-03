// Screenshots: whole-element comparisons with stored references by the per-pixel rule in pixels.ts, and pixel probes
// that read colours from a real screenshot. Every screenshot is taken as the compositor shows it, rendered on
// SwiftShader so the pixels are the same on a laptop and on CI. Runs in the browser. See README.md, "Screenshots".
import { expect } from 'vitest';
import { commands, page, server } from 'vitest/browser';
import type { Vec2 } from '@servo/schema';
import { PIXEL_RULE, colourDistance, comparePixels, describeRgb, diffImage } from './pixels.ts';
import type { PixelComparison, PixelRule, Pixels, Rgb } from './pixels.ts';

export { colourDistance, describeRgb, rgbOf, rgbOfHex } from './pixels.ts';
export type { Rgb } from './pixels.ts';

/** References, relative to packages/tools: one PNG per name, the same for every machine. */
export const REFERENCES = 'test/e2e/__screenshots__';
/** Where a failed comparison leaves the reference, the actual screenshot and their diff, relative to packages/tools. */
export const DIFFS = 'node_modules/e2e-screenshots';

export interface Shot extends Pixels {
  /** The colour at a point given in CSS pixels from the element's top left. */
  at(point: Vec2): Rgb;
  /** Device pixels per CSS pixel. */
  readonly ratio: number;
}

const decode = async (png: Blob, cssWidth: number): Promise<Shot> => {
  const bitmap = await createImageBitmap(png, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D context to decode a screenshot in.');
  context.drawImage(bitmap, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const ratio = width / cssWidth;
  return {
    width,
    height,
    data,
    ratio,
    at: ({ x, y }) => {
      const px = Math.min(width - 1, Math.max(0, Math.floor(x * ratio)));
      const py = Math.min(height - 1, Math.max(0, Math.floor(y * ratio)));
      const i = (py * width + px) * 4;
      return [data[i] as number, data[i + 1] as number, data[i + 2] as number];
    },
  };
};

const fromBase64 = async (base64: string): Promise<Blob> => (await fetch(`data:image/png;base64,${base64}`)).blob();

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const png = async (pixels: Pixels, data: Uint8ClampedArray): Promise<string> => {
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D context to encode a diff in.');
  context.putImageData(new ImageData(new Uint8ClampedArray(data), pixels.width, pixels.height), 0, 0);
  return toBase64(await canvas.convertToBlob({ type: 'image/png' }));
};

/** A real screenshot of `element`, decoded, and its PNG as base64. */
export const capture = async (element: Element): Promise<{ readonly shot: Shot; readonly png: string }> => {
  const base64 = await page.screenshot({ element, save: false });
  return { shot: await decode(await fromBase64(base64), element.getBoundingClientRect().width), png: base64 };
};

/** A real screenshot of `element`, decoded for pixel probes. */
export const shoot = async (element: Element): Promise<Shot> => (await capture(element)).shot;

export interface ScreenshotResult extends PixelComparison {
  readonly name: string;
  /** The screenshot compared, decoded, for probes on the same pixels. */
  readonly shot: Shot;
  /** No reference existed, or `vitest -u` asked: this screenshot was written as the reference. */
  readonly written: boolean;
  /** Where the reference, actual and diff images went when they differ, relative to packages/tools. */
  readonly diffs?: string;
}

const referenceOf = (name: string): string => `${REFERENCES}/${name}.png`;

const readReference = async (name: string, cssWidth: number): Promise<Shot | undefined> => {
  try {
    return await decode(await fromBase64(await commands.readFile(referenceOf(name), 'base64')), cssWidth);
  } catch {
    return undefined;
  }
};

/** `vitest -u` (update all snapshots, `pnpm e2e -u`) rewrites references instead of comparing with them. */
const updating = (): boolean => server.config.snapshotOptions.updateSnapshot === 'all';

export interface CompareOptions {
  readonly rule?: PixelRule;
  /** When they differ, write the reference, the actual screenshot and their diff under DIFFS. Default true. */
  readonly writeDiffs?: boolean;
}

/**
 * Compares a screenshot of `element` with the reference `name` by the rule, and never throws on a difference or
 * writes a reference: a missing reference throws. When they differ it writes the reference, the actual screenshot
 * and a diff (changed pixels in red over a faded reference) under DIFFS.
 */
export const compareWithReference = async (element: Element, name: string, options: CompareOptions = {}): Promise<ScreenshotResult> => {
  const rule = options.rule ?? PIXEL_RULE;
  const reference = await readReference(name, element.getBoundingClientRect().width);
  if (!reference) throw new Error(`No reference ${referenceOf(name)} to compare with.`);
  const { shot, png: actualPng } = await capture(element);
  const comparison = comparePixels(reference, shot, rule);
  if (comparison.matches || options.writeDiffs === false) return { name, shot, written: false, ...comparison };
  const diffs = `${DIFFS}/${name}`;
  await commands.writeFile(`${diffs}.actual.png`, actualPng, 'base64');
  await commands.writeFile(`${diffs}.reference.png`, await commands.readFile(referenceOf(name), 'base64'), 'base64');
  if (comparison.sameSize) await commands.writeFile(`${diffs}.diff.png`, await png(reference, diffImage(reference, shot, rule)), 'base64');
  return { name, shot, written: false, ...comparison, diffs };
};

/** Describes a comparison in one line, for assertion messages. */
export const describeComparison = (result: ScreenshotResult, rule: PixelRule = PIXEL_RULE): string =>
  result.sameSize
    ? `${result.name}: ${result.changed} of ${result.total} pixels changed by more than ${rule.channelDelta} in a channel (at most ${rule.maxChangedPixels} may)` +
      (result.diffs ? `; see ${result.diffs}.{reference,actual,diff}.png under packages/tools` : '')
    : `${result.name}: the screenshot is not the reference's size` + (result.diffs ? `; see ${result.diffs}.{reference,actual}.png under packages/tools` : '');

/**
 * The screenshot of `element` matches the reference `name` by the rule. A missing reference is written from this
 * screenshot, and the test fails so it is reviewed; `pnpm e2e -u` rewrites every reference.
 */
export const expectScreenshot = async (element: Element, name: string, rule: PixelRule = PIXEL_RULE): Promise<ScreenshotResult> => {
  const missing = !(await readReference(name, element.getBoundingClientRect().width));
  if (missing || updating()) {
    const { shot, png: actualPng } = await capture(element);
    await commands.writeFile(referenceOf(name), actualPng, 'base64');
    if (missing && !updating()) expect.fail(`No reference for ${name}: wrote ${referenceOf(name)} from this run. Review it, then run again.`);
    return { name, shot, written: true, changed: 0, total: shot.width * shot.height, sameSize: true, matches: true, largestDelta: 0 };
  }
  const result = await compareWithReference(element, name, { rule });
  expect(result.matches, describeComparison(result, rule)).toBe(true);
  return result;
};

/** A pixel probe: the colour at `at` (CSS pixels from the shot element's top left) is within `tolerance` of `expected`. */
export const expectColour = (shot: Shot, at: Vec2, expected: Rgb, what: string, tolerance = 12): void => {
  const actual = shot.at(at);
  expect(colourDistance(actual, expected), `${what}: ${describeRgb(actual)} where ${describeRgb(expected)} was expected`).toBeLessThanOrEqual(tolerance);
};

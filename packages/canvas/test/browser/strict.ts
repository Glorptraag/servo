// A strict screenshot rule beside Vitest's `toMatchScreenshot` (which keeps the reference and its loose 0.5% ratio):
// a pixel has changed when any channel moves by more than 24, and at most 400 may change, the rule of the e2e harness
// (packages/tools/src/e2e/pixels.ts). Counting pixels, not a share of the image, a missing label, ring or line fails.
// Text is drawn in the device's own fonts (the canvas loads none), so a test may mask the box its glyphs sit in and
// check that box with probes instead.
import { expect } from 'vitest';
import { commands, page } from 'vitest/browser';

export const STRICT_RULE = { channelDelta: 24, maxChangedPixels: 400 } as const;

/** A box in CSS pixels from the element's top left. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const decode = async (base64: string): Promise<ImageData> => {
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D context');
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
};

/**
 * The element matches the reference `test/browser/__screenshots__/<file>/<name>.png` (written by `toMatchScreenshot`)
 * by the strict rule, outside `masks`.
 */
export const expectStrictShot = async (element: Element, file: string, name: string, masks: readonly Box[] = []): Promise<void> => {
  const reference = await decode(await commands.readFile(`test/browser/__screenshots__/${file}/${name}.png`, 'base64'));
  const actual = await decode(await page.screenshot({ element, save: false }));
  expect([actual.width, actual.height], `${name}: the screenshot's size`).toEqual([reference.width, reference.height]);
  const ratio = actual.width / element.getBoundingClientRect().width;
  const masked = (px: number, py: number): boolean =>
    masks.some((box) => px >= box.x * ratio && px < (box.x + box.width) * ratio && py >= box.y * ratio && py < (box.y + box.height) * ratio);
  let changed = 0;
  for (let i = 0; i < reference.data.length; i += 4) {
    const delta = Math.max(
      Math.abs((reference.data[i] as number) - (actual.data[i] as number)),
      Math.abs((reference.data[i + 1] as number) - (actual.data[i + 1] as number)),
      Math.abs((reference.data[i + 2] as number) - (actual.data[i + 2] as number)),
    );
    if (delta <= STRICT_RULE.channelDelta) continue;
    const p = i / 4;
    if (!masked(p % reference.width, Math.floor(p / reference.width))) changed += 1;
  }
  expect(changed, `${name}: ${changed} pixels changed by more than ${STRICT_RULE.channelDelta} (at most ${STRICT_RULE.maxChangedPixels} may)`).toBeLessThanOrEqual(
    STRICT_RULE.maxChangedPixels,
  );
};

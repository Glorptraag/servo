import type { PartRecord } from '@servo/schema';
import { drawPart } from './forms.ts';
import { num, project } from './view.ts';
import type { Point } from './view.ts';

/** The tile's longer side at its natural size, in pixels: the largest part tile in brief Section 9. */
export const TILE_PX = 160;

/** Outline width as a share of the longer side of the body box as seen, so every tile reads the same at tray size. */
const STROKE = 0.012;

/** The tile's frame in the SVG's user space: millimetres as the camera sees them, with the part's origin at 0, 0. */
export interface TileFrame {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  /** The outline width, which is also the margin round the body box. */
  readonly stroke: number;
}

/**
 * The tile's frame: the part's body box seen from the camera, plus a margin as wide as the outline.
 * Every form stays inside the body box, so the frame depends on `body.size` alone.
 */
export const tileFrame = (record: PartRecord): TileFrame => {
  const { x, y, z } = record.body.size;
  const corners: Point[] = [];
  for (const cx of [-x / 2, x / 2]) for (const cy of [-y / 2, y / 2]) for (const cz of [0, z]) corners.push(project([cx, cy, cz]));
  const xs = corners.map(([px]) => px);
  const ys = corners.map(([, py]) => py);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const stroke = STROKE * Math.max(spanX, spanY);
  return { minX: minX - stroke, minY: minY - stroke, width: spanX + 2 * stroke, height: spanY + 2 * stroke, stroke };
};

/**
 * The placeholder tile for a validated part record, as SVG text. Pure: the same record gives the same
 * bytes. It reads only `body.size`, `identity.colours` and the kinds of the record's behaviour primitives
 * (with an actuator's mode, a switch's actuation and what a load gives). Ports are drawn by the canvas.
 */
export const placeholderSvg = (record: PartRecord): string => {
  const frame = tileFrame(record);
  const longer = Math.max(frame.width, frame.height);
  const width = (TILE_PX * frame.width) / longer;
  const height = (TILE_PX * frame.height) / longer;
  const viewBox = [frame.minX, frame.minY, frame.width, frame.height].map(num).join(' ');
  const marks = drawPart(record)
    .map(({ d, fill, stroke }) => `<path d="${d}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}/>`)
    .join('\n');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${num(width)}" height="${num(height)}">`,
    `<g stroke-width="${num(frame.stroke)}" stroke-linejoin="round">`,
    marks,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
};

// How big a part's picture is drawn on its tile: the renderer's own sizing, kept free of Pixi. views.ts sizes every
// sprite with `drawnPictureSize`, and the tidy-wires router (task 3.7) sizes the body it keeps clear of with the same
// function and the same picture, so it routes round the picture the child sees (D85). See docs/renderer.md,
// "Pictures".
import type { TileSize } from '../scene/layout.ts';
import { mmOf } from '../scene/units.ts';

/** Space between a tile's edge and its picture or name. */
export const TILE_PADDING_MM = mmOf(5);

/** A picture's proportions: any width and height, such as a texture's pixels or an SVG's width and height. */
export interface Proportions {
  readonly width: number;
  readonly height: number;
}

/** The room inside a tile for its picture or name: the tile less its padding on every side. */
export const pictureRoom = (tile: TileSize): { readonly w: number; readonly h: number } => ({
  w: Math.max(tile.w - 2 * TILE_PADDING_MM, 1),
  h: Math.max(tile.h - 2 * TILE_PADDING_MM, 1),
});

/** The picture's drawn size in the part's frame (w along its x, h along its y), fitted in the room, keeping its proportions. */
export const pictureSize = (tile: TileSize, art: Proportions): { readonly w: number; readonly h: number } => {
  const room = pictureRoom(tile);
  const fit = Math.min(room.w / art.width, room.h / art.height);
  return { w: art.width * fit, h: art.height * fit };
};

/**
 * The one sizing the renderer draws with and the router routes round: the picture as drawn for `art` (the picture's
 * own proportions, a loaded texture's), centred on the tile. With no picture to draw (none in the registry, still
 * loading, or failed), the whole room a picture or name takes, which holds any picture that may come.
 */
export const drawnPictureSize = (tile: TileSize, art: Proportions | undefined): { readonly w: number; readonly h: number } =>
  art ? pictureSize(tile, art) : pictureRoom(tile);

/** An SVG's proportions from its width and height, or its viewBox: a picture sized before it loads (tests, tools). */
export const svgProportions = (svg: string): Proportions | undefined => {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0];
  if (!tag) return undefined;
  const attribute = (name: string): number | undefined => {
    const value = new RegExp(`\\s${name}="([0-9.eE+-]+)"`).exec(tag)?.[1];
    return value === undefined ? undefined : Number(value);
  };
  const width = attribute('width');
  const height = attribute('height');
  if (width && height) return { width, height };
  const box = /\sviewBox="([^"]+)"/.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number);
  return box && box.length === 4 && (box[2] as number) > 0 && (box[3] as number) > 0 ? { width: box[2] as number, height: box[3] as number } : undefined;
};

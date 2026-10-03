// How big a part's picture is drawn on its tile: the renderer's own sizing (views.ts draws with it), kept free of
// Pixi so the tidy-wires router (task 3.7) and its tests measure the same picture the child sees. See
// docs/renderer.md, "Pictures".
import type { PartRecord } from '@servo/schema';
import type { TileSize } from '../scene/layout.ts';
import { mmOf } from '../scene/units.ts';

/** Space between a tile's edge and its picture or name. */
export const TILE_PADDING_MM = mmOf(5);

/** A picture's proportions: any width and height, such as a texture's pixels. */
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
 * The part's body as the child sees it: its picture, centred on the tile. Placeholder art fills the footprint box in
 * true proportions (`body.size` x by y), so the drawn body is that box scaled up as `pictureSize` scales it.
 */
export const drawnBodySize = (record: PartRecord, tile: TileSize): { readonly w: number; readonly h: number } =>
  pictureSize(tile, { width: Math.max(record.body.size.x, 1e-3), height: Math.max(record.body.size.y, 1e-3) });

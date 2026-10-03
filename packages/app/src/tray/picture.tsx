// A part's picture on a tray tile or a library card: the swap registry's art, or, when it has none, a tile in the
// part record's placeholder colours (ground rule 12). Never draggable, so a mouse drag never starts a native drag.
import type { TrayTile } from './tiles.ts';

export const TilePicture = ({ tile }: { readonly tile: Pick<TrayTile, 'picture' | 'colours'> }) =>
  tile.picture ? (
    <img className="tray-picture" src={tile.picture} alt="" draggable={false} />
  ) : (
    <span className="tray-picture tray-swatch" style={{ background: tile.colours.main, borderColor: tile.colours.accent }} />
  );

// The tray's keyboard and screen-reader path (D84, ground rule 8): a tile pressed with Enter or Space, or by a screen
// reader's click, lists where the part can go, as the canvas's list view judges it (`listView.placementsFor`): the
// free spot on the workbench and every free mount point or shaft it fits. Choosing one places it through the same
// path as touch and pointer.
import { useEffect, useId, useRef } from 'react';
import type { CanvasHandle, ListAction } from '@servo/canvas';
import type { TrayTile } from './tiles.ts';

export interface PlacesProps {
  readonly canvas: CanvasHandle;
  readonly tile: TrayTile;
  /** Called with whether the part was placed, or undefined when the child closed the list. */
  readonly onDone: (placed: boolean | undefined) => void;
}

export const Places = ({ canvas, tile, onDone }: PlacesProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const actions: readonly ListAction[] = canvas.mode === 'build' ? canvas.listView.placementsFor(tile.part) : [];
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // Escape closes it the same way as Close. Headless Chromium was seen to close a dialog on Escape without firing
    // `close`, so the tray does not wait for that event.
    const cancelled = (event: Event): void => {
      event.preventDefault();
      done.current(undefined);
    };
    const closed = (): void => done.current(undefined);
    dialog.addEventListener('cancel', cancelled);
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('cancel', cancelled);
      dialog.removeEventListener('close', closed);
      dialog.close();
    };
  }, []);

  const perform = (action: ListAction): void => done.current(canvas.listView.perform(action));

  return (
    <dialog ref={ref} className="tray-places" aria-labelledby={headingId}>
      <h2 id={headingId}>{actions.length > 0 ? `Where the ${tile.name} can go` : `The ${tile.name} has nowhere to go now`}</h2>
      <ul>
        {actions.map((action) => (
          <li key={action.id}>
            <button type="button" className="shell-button tray-place" onClick={() => perform(action)}>
              {action.label}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="shell-button" onClick={() => done.current(undefined)}>
        Close
      </button>
    </dialog>
  );
};

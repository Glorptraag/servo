// The part tray (brief Sections 9 and 10, task 4.2): the kit's parts as big tiles grouped by family, and the Library
// button. A tile places its part through the canvas's own placement: drag it onto the canvas, or tap it and then tap
// where it goes (`beginPlacement`), with a finger or a pointer; from the keyboard or a screen reader it lists the
// places the list view offers (places.tsx). A tile takes every press itself (`touch-action: none`), so a drag in any
// direction hands its pointer to the canvas; the tray scrolls from the room round the tiles.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { PartTypeId } from '@servo/schema';
import { Library } from '../library/index.ts';
import { DRAG_PX, useShell } from '../shell/index.ts';
import { TilePicture } from './picture.tsx';
import { Places } from './places.tsx';
import { trayGroups } from './tiles.ts';
import type { TrayTile } from './tiles.ts';
import './tray.css';

/** A press on a tile that travels this far (CSS px at drag sensitivity 1) is a drag; less is a tap. The canvas's own threshold. */
export const TILE_DRAG_PX = DRAG_PX;

/** A part the canvas is carrying for a pointer from a tile, and whether the browser cancelled that pointer. */
interface Carry {
  readonly part: PartTypeId;
  cancelled: boolean;
  readonly release: () => void;
}

interface Press {
  readonly part: PartTypeId;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly release: () => void;
}

export const Tray = () => {
  const { content, kit, canvas, mode, prefs, layout } = useShell();
  const groups = useMemo(() => (kit ? trayGroups(kit, content.catalogue, content.art) : []), [kit, content]);
  const ids = useId();
  const tileRefs = useRef(new Map<PartTypeId, HTMLButtonElement>());
  // The tile whose part waits for a tap on the canvas (tap-then-tap).
  const [waiting, setWaitingState] = useState<PartTypeId | null>(null);
  const waitingRef = useRef<PartTypeId | null>(null);
  const setWaiting = (part: PartTypeId | null): void => {
    waitingRef.current = part;
    setWaitingState(part);
  };
  const [listing, setListing] = useState<TrayTile | null>(null);
  const [said, setSaid] = useState('');
  // The tile to focus once the places list has gone.
  const refocus = useRef<PartTypeId | null>(null);
  const press = useRef<Press | null>(null);
  const carried = useRef<Carry | null>(null);
  const latest = useRef({ canvas, prefs });
  latest.current = { canvas, prefs };
  const shown = mode === 'build' && layout.shown.tray;

  // Every placement ends with `placement`, landed or not, so the tile lets go then. A part dropped because the browser
  // cancelled the finger carrying it (a system gesture, an alert) is never lost: it waits for a tap on the canvas
  // instead, its tile marked and the places it can go ringed, as after a tap on the tile.
  useEffect(
    () =>
      canvas?.on('placement', (event) => {
        const carry = carried.current;
        carried.current = null;
        carry?.release();
        if (carry?.cancelled && event.kind === 'part' && !event.placed && event.part === carry.part) {
          queueMicrotask(() => {
            const handle = latest.current.canvas;
            if (handle?.mode !== 'build') return;
            handle.beginPlacement(carry.part);
            setWaiting(carry.part);
          });
          return;
        }
        setWaiting(null);
      }),
    [canvas],
  );

  // Run mode and a tucked tray end whatever the tray had begun.
  useEffect(() => {
    if (shown) return;
    if (waitingRef.current !== null) latest.current.canvas?.cancelPlacement();
    setWaiting(null);
    setListing(null);
    press.current?.release();
  }, [shown]);

  useEffect(
    () => () => {
      press.current?.release();
      carried.current?.release();
    },
    [],
  );

  const pressed = (tile: TrayTile, event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!canvas || canvas.mode !== 'build' || !event.isPrimary || event.button !== 0) return;
    press.current?.release();
    const element = event.currentTarget;
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const moved = (move: PointerEvent): void => {
      const current = press.current;
      if (!current || move.pointerId !== current.pointerId) return;
      const threshold = TILE_DRAG_PX / Math.max(latest.current.prefs.dragSensitivity, 0.05);
      if (Math.hypot(move.clientX - current.x, move.clientY - current.y) < threshold) return;
      current.release();
      if (waitingRef.current !== null) setWaiting(null);
      carry(element, view, current.part, move);
    };
    const lifted = (up: PointerEvent): void => {
      const current = press.current;
      if (!current || up.pointerId !== current.pointerId) return;
      current.release();
      tapped(current.part);
    };
    const cancelled = (cancel: PointerEvent): void => {
      if (press.current && cancel.pointerId === press.current.pointerId) press.current.release();
    };
    const release = (): void => {
      view.removeEventListener('pointermove', moved, true);
      view.removeEventListener('pointerup', lifted, true);
      view.removeEventListener('pointercancel', cancelled, true);
      if (press.current?.release === release) press.current = null;
    };
    view.addEventListener('pointermove', moved, true);
    view.addEventListener('pointerup', lifted, true);
    view.addEventListener('pointercancel', cancelled, true);
    press.current = { part: tile.part, pointerId: event.pointerId, x: event.clientX, y: event.clientY, release };
  };

  /**
   * Hands a pointer that has travelled the drag threshold, in any direction, to the canvas, which carries the part from
   * here wherever the pointer's events go. The tile keeps the pointer (capture), and the tray listens, before the
   * canvas does, for the browser cancelling it.
   */
  const carry = (element: HTMLElement, view: Window, part: PartTypeId, pointer: PointerEvent): void => {
    const handle = latest.current.canvas;
    if (!handle) return;
    carried.current?.release();
    const ended = (end: PointerEvent): void => {
      if (end.pointerId !== pointer.pointerId || carried.current !== state) return;
      if (end.type === 'pointercancel') state.cancelled = true;
    };
    const release = (): void => {
      view.removeEventListener('pointercancel', ended, true);
      view.removeEventListener('pointerup', ended, true);
    };
    const state: Carry = { part, cancelled: false, release };
    view.addEventListener('pointercancel', ended, true);
    view.addEventListener('pointerup', ended, true);
    carried.current = state;
    try {
      element.setPointerCapture(pointer.pointerId);
    } catch {
      // A pointer already gone cannot be captured; the canvas's own window listeners still see it end.
    }
    handle.beginPlacement(part, pointer);
  };

  // A tap: the part waits for the next tap on the canvas. A second tap on the same tile lets it go.
  const tapped = (part: PartTypeId): void => {
    const handle = latest.current.canvas;
    if (!handle) return;
    if (waitingRef.current === part) {
      handle.cancelPlacement();
      setWaiting(null);
      return;
    }
    handle.beginPlacement(part);
    setWaiting(handle.mode === 'build' ? part : null);
  };

  const clicked = (tile: TrayTile, event: ReactMouseEvent<HTMLButtonElement>): void => {
    // A click with no pointer behind it: Enter, or a screen reader's activation. (Space is Run and Stop, D42.)
    if (event.detail !== 0 || !canvas || canvas.mode !== 'build') return;
    if (waitingRef.current !== null) canvas.cancelPlacement();
    setWaiting(null);
    setSaid('');
    setListing(tile);
  };

  const listed = (placed: boolean | undefined): void => {
    const tile = listing;
    setListing(null);
    if (!tile) return;
    if (placed !== undefined) setSaid(placed ? `Placed the ${tile.name}.` : `The ${tile.name} was not placed.`);
    refocus.current = tile.part;
  };

  // Focus goes back to the tile once the list is gone, never to the page.
  useEffect(() => {
    if (listing !== null || refocus.current === null) return;
    tileRefs.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [listing]);

  return (
    <div className="tray">
      <Library available={shown} />
      {groups.map((group) => (
        <section key={group.family} className="tray-group" aria-labelledby={`${ids}-${group.family}`} data-family={group.family}>
          <h3 id={`${ids}-${group.family}`} className="tray-family">
            {group.label}
          </h3>
          <ul className="tray-tiles">
            {group.tiles.map((tile) => (
              <li key={tile.part}>
                <button
                  ref={(element) => {
                    if (element) tileRefs.current.set(tile.part, element);
                    else tileRefs.current.delete(tile.part);
                  }}
                  type="button"
                  className="tray-tile"
                  data-part={tile.part}
                  aria-label={`${tile.title}, ${tile.quantity} in the kit`}
                  aria-pressed={waiting === tile.part}
                  onPointerDown={(event) => pressed(tile, event)}
                  onClick={(event) => clicked(tile, event)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <TilePicture tile={tile} />
                  <span className="tray-name">{tile.title}</span>
                  <span className="tray-count" aria-hidden="true">
                    × {tile.quantity}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="tray-said" role="status">
        {said}
      </p>
      {listing && canvas ? <Places canvas={canvas} tile={listing} onDone={listed} /> : null}
    </div>
  );
};

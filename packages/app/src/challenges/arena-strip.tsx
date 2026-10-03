// The arena strip (brief Section 9, D68), in the shell's arenaStrip slot: the arena preset picker and the props to bring
// in (D36), in Build mode only. In Run mode the controls rest and the canvas shows the arena round the robot. Every
// change goes through `canvas.apply`, so each is one Undo step and Save hears it.
// - A preset button sets the arena (`set-arena`), dropping the props the child added, as Reset arena does (D29). While
//   a challenge is on the canvas its arena stays: the other presets are `aria-disabled`, so a keyboard or screen reader
//   still reaches them and hears why.
// - A prop has the three paths of a tray tile (ground rule 8): drag it onto the canvas; tap it, then tap where it goes;
//   or press Enter on it (keyboard and screen reader), which puts it on the nearest free spot of the floor, as the
//   canvas's list view does.
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PropTemplate } from '@servo/canvas';
import type { Challenge } from '@servo/schema';
import { useShell } from '../shell/context.ts';
import { DRAG_PX } from '../shell/index.ts';
import { CHALLENGE_TEXT } from './text.ts';
import './challenges.css';

/** A prop the strip offers: what it is called, read aloud, and drawn as. */
export interface PaletteProp {
  readonly id: string;
  readonly label: string;
  /** Read aloud with the label: its real size and weight. */
  readonly spoken: string;
  readonly prop: PropTemplate;
}

/**
 * The short preset list of props (D36): the two of the bump-props arena preset, a light box the robot can push and a
 * post that does not move.
 */
export const PROP_PALETTE: readonly PaletteProp[] = [
  {
    id: 'box',
    label: 'Box',
    spoken: '80 by 80 millimetres, 50 grams, moves when pushed',
    prop: { shape: 'box', size: { x: 80, y: 80, z: 60 }, grams: 50, fixed: false },
  },
  {
    id: 'post',
    label: 'Post',
    spoken: '100 millimetres across, 700 grams, fixed in place',
    prop: { shape: 'cylinder', size: { x: 100, y: 100, z: 150 }, grams: 700, fixed: true },
  },
];

interface Press {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  dragged: boolean;
}

export interface ArenaStripProps {
  /** The challenge on the canvas, whose arena preset stays; none in the sandbox. */
  readonly challenge: Challenge | null;
}

export const ArenaStrip = ({ challenge }: ArenaStripProps) => {
  const { content, canvas, blueprint, mode, prefs } = useShell();
  const [pending, setPending] = useState<string | null>(null);
  const press = useRef<Press | null>(null);
  const building = mode === 'build' && canvas !== null && blueprint !== undefined;

  // A tap-then-tap placement ends with the canvas's `placement` event, landed or not, and with Run.
  useEffect(
    () =>
      canvas?.on('placement', (event) => {
        if (event.kind === 'prop') setPending(null);
      }),
    [canvas],
  );
  useEffect(() => {
    if (mode !== 'build') setPending(null);
  }, [mode]);

  const choose = (preset: string): void => {
    if (!canvas || !blueprint || !building || blueprint.arena.preset === preset) return;
    canvas.apply({ kind: 'set-arena', arena: { preset, props: [] } });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!building || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  };

  // A press that moves past the drag threshold hands the pointer to the canvas, which carries the prop from there.
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>, item: PaletteProp): void => {
    const start = press.current;
    if (!canvas || !start || start.dragged || start.pointerId !== event.pointerId || event.buttons === 0) return;
    const threshold = DRAG_PX / Math.max(prefs.dragSensitivity, 0.05);
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < threshold) return;
    start.dragged = true;
    setPending(null);
    canvas.beginPropPlacement(item.prop, event.nativeEvent);
  };

  const onClick = (event: { readonly detail: number }, item: PaletteProp): void => {
    const start = press.current;
    press.current = null;
    if (start?.dragged || !canvas || !building) return;
    // A click with no pointer behind it is Enter on a focused button: the keyboard and screen-reader path.
    if (event.detail === 0) {
      canvas.apply({ kind: 'place-prop', prop: item.prop });
      return;
    }
    if (pending === item.id) {
      canvas.cancelPlacement();
      setPending(null);
      return;
    }
    canvas.beginPropPlacement(item.prop);
    setPending(item.id);
  };

  const current = blueprint?.arena.preset;
  return (
    <div className="arena-strip">
      <div className="arena-strip-group" role="group" aria-label={CHALLENGE_TEXT.arena}>
        {content.arenas.map((preset) => {
          const kept = challenge !== null && challenge.arena.preset !== preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className="arena-strip-button"
              aria-pressed={current === preset.id}
              aria-disabled={kept || undefined}
              disabled={!building}
              onClick={() => {
                if (!kept) choose(preset.id);
              }}
            >
              {preset.name}
              {kept ? <span className="challenge-spoken">, {CHALLENGE_TEXT.setByChallenge}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="arena-strip-group" role="group" aria-label={CHALLENGE_TEXT.props}>
        {PROP_PALETTE.map((item) => (
          <button
            key={item.id}
            type="button"
            className="arena-strip-button arena-strip-prop"
            aria-pressed={pending === item.id}
            disabled={!building}
            onPointerDown={onPointerDown}
            onPointerMove={(event) => onPointerMove(event, item)}
            onPointerCancel={() => {
              press.current = null;
            }}
            onClick={(event) => onClick(event, item)}
          >
            <svg className="arena-strip-shape" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              {item.prop.shape === 'box' ? <rect x="4" y="4" width="12" height="12" rx="1.5" /> : <circle cx="10" cy="10" r="6.5" />}
            </svg>
            {item.label}
            <span className="challenge-spoken">, {item.spoken}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

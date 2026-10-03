// The sound control, in the header's sound slot (brief Section 9): one switch that turns sound off and on for this
// device. A native button with the switch role, so a tap, a click, Enter (Space stays Run and Stop, D42) and a screen
// reader all reach it the same way (ground rule 8). It also starts the layer listening to the canvas for wires landing,
// and to the child's gestures, which let the page start audio.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useShell } from '../shell/context.ts';
import type { SoundLayer } from './layer.ts';
import './sound.css';

/** Every word the control shows or says: real words, no praise, no exclamation marks (ground rule 7). */
export const SOUND_TEXT = { label: 'Sound', on: 'On', off: 'Off' } as const;

export interface SoundControlProps {
  readonly layer: SoundLayer;
}

export const SoundControl = ({ layer }: SoundControlProps) => {
  const { canvas } = useShell();
  const button = useRef<HTMLButtonElement>(null);
  const muted = useSyncExternalStore(layer.subscribe, () => layer.muted);

  // In the commit that shows the canvas, as Undo's history hears it (run-bar.tsx), so no landing goes unheard.
  useLayoutEffect(() => {
    layer.hear(canvas);
    return () => layer.hear(null);
  }, [layer, canvas]);

  useEffect(() => {
    const view = button.current?.ownerDocument.defaultView;
    return view ? layer.attach(view) : undefined;
  }, [layer]);

  return (
    <button ref={button} type="button" role="switch" aria-checked={!muted} className="shell-button sound-control" data-muted={muted} onClick={() => layer.toggle()}>
      <svg className="sound-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path className="sound-control-speaker" d="M3 9.5 H7 L12 5 V19 L7 14.5 H3 Z" />
        {muted ? (
          <path className="sound-control-off" d="M15.5 9 L21 15 M21 9 L15.5 15" />
        ) : (
          <path className="sound-control-waves" d="M15 9 Q17 12 15 15 M17.8 6.5 Q21.5 12 17.8 17.5" />
        )}
      </svg>
      <span>{SOUND_TEXT.label}</span>
      <span className="sound-control-state" aria-hidden="true">
        {muted ? SOUND_TEXT.off : SOUND_TEXT.on}
      </span>
    </button>
  );
};

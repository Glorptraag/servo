// The spec card (brief Sections 4, 9, 10 and 12, task 4.3): the selected part's real name and picture, its layered
// text by the child's level, its ports, its settings, and in Run mode its live readouts and the card line of each
// failure happening now. Everything on it comes from the part record (ground rule 1). It sits in the shell's
// `specCard` slot, which slides in while a part is selected; see README.md beside this file.
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { PlacedPartId, PortType, SettingValue } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core';
import { useShell } from '../shell/index.ts';
import type { RunFrames } from './frames.ts';
import { cardModel, failureNotes } from './model.ts';
import type { UnlockedSetting } from './model.ts';
import { PartPicture, RealWorldPicture } from './picture.tsx';
import { readoutsOf } from './readouts.ts';
import { SettingControl } from './settings.tsx';
import { pageSpeech, speak, spokenLines } from './speech.ts';
import type { SpeechPort } from './speech.ts';
import './spec-card.css';

export interface SpecCardProps {
  /** The Run frames the run loop hands on (task 4.4). Without them the card shows no readouts. */
  readonly frames?: RunFrames;
  /** Speak-it's voice. Default: the page's speechSynthesis; null (or a browser without one) hides the button. */
  readonly speech?: SpeechPort | null;
  /** Settings to show before their unlock level. Default none; the Level 3 slot names the servo motor's angle (task 6.6). */
  readonly unlocked?: UnlockedSetting;
}

const NO_FRAMES = { subscribe: () => () => {}, frame: null };

/** What the card shows of a frame for one part: its exact values and faults. Frames that leave it alone draw nothing. */
const liveKey = (frame: RunFrame | null, partId: PlacedPartId | null): string => {
  if (!frame) return '';
  const live = partId === null ? undefined : frame.live.get(partId);
  return live ? JSON.stringify([live.values, live.faults]) : '-';
};

/** The latest frame, read again only when what it holds for `partId` changed (task 6.1, docs/perf.md). */
const useFrame = (frames: RunFrames | undefined, partId: PlacedPartId | null): RunFrame | null => {
  const source = frames ?? NO_FRAMES;
  useSyncExternalStore(source.subscribe, () => liveKey(source.frame, partId));
  return source.frame;
};

/** The socket shape of each port type, as the canvas draws it (schema PORT_TYPE_STYLE), so colour is never the only cue. */
const Socket = ({ type }: { readonly type: PortType }) => (
  <svg className="spec-card-socket" data-type={type} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    {type === 'power' && <circle cx="8" cy="8" r="6" />}
    {type === 'signal' && <rect x="2" y="2" width="12" height="12" rx="1" />}
    {type === 'mechanical' && <polygon points="8,1.5 13.6,4.75 13.6,11.25 8,14.5 2.4,11.25 2.4,4.75" />}
  </svg>
);

const SpeakIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** The part the card shows: the selected part, or, while the card slides out, the one it last showed. */
const useShownPart = (): PlacedPartId | null => {
  const { selection } = useShell();
  const last = useRef<PlacedPartId | null>(null);
  if (selection?.kind === 'part') last.current = selection.partId;
  return last.current;
};

/**
 * The card steps aside while a wire is on its way by any path, drag, tap-then-tap or the list view, so it never covers
 * a port being wired (D66, task 7.8), and comes back once the wire lands or is let go. The shell's own drag watch
 * stays as it was.
 */
const useStepAsideForWires = (): void => {
  const { canvas, setSpecCardAside } = useShell();
  useEffect(() => {
    if (!canvas) return;
    const off = canvas.on('wire', (event) => setSpecCardAside(event.wire !== null));
    return () => {
      off();
      setSpecCardAside(false);
    };
  }, [canvas, setSpecCardAside]);
};

export const SpecCard = ({ frames, speech = pageSpeech(), unlocked }: SpecCardProps) => {
  const { content, level, canvas, mode, blueprint } = useShell();
  useStepAsideForWires();
  const partId = useShownPart();
  const frame = useFrame(frames, partId);
  const titleId = useId();
  const card = useRef<HTMLElement>(null);

  const placed = partId === null ? undefined : blueprint?.parts.find((part) => part.id === partId);
  const record = placed && content.catalogue.parts.get(placed.part);
  if (!placed || !record) return null;

  const model = cardModel(record, placed, level, unlocked);
  const { text } = model;
  const running = mode === 'run';
  const live = running ? frame?.live.get(placed.id) : undefined;
  const readouts = live ? readoutsOf(live.values) : [];
  const notes = live ? failureNotes(record, live.faults) : [];

  const change = (setting: string, value: SettingValue): boolean =>
    canvas?.apply({ kind: 'set-setting', partId: placed.id, setting, value }).ok ?? false;
  const readAloud = (): void => {
    if (speech && card.current) speak(speech, spokenLines(card.current), document.documentElement.lang);
  };

  return (
    <article ref={card} className="spec-card" aria-labelledby={titleId} data-part={record.id} data-level={level} data-mode={mode}>
      <header className="spec-card-head">
        <PartPicture record={record} art={content.art} />
        <h2 id={titleId} className="spec-card-name" data-speak="">
          {text.title}
        </h2>
        {speech && (
          <button type="button" className="spec-card-speak" aria-label="Read aloud" title="Read aloud" onClick={readAloud}>
            <SpeakIcon />
          </button>
        )}
      </header>

      {running && readouts.length > 0 && (
        <dl className="spec-card-readouts" aria-label="Live readouts">
          {readouts.map((readout) => (
            <div key={readout.key} className="spec-card-readout" data-readout={readout.key} data-value={String(readout.value)}>
              <dt data-speak="">{readout.label}</dt>
              <dd data-speak="">{readout.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {running && (
        <ul className="spec-card-faults" aria-live="polite">
          {notes.map((line) => (
            <li key={line} data-speak="">
              {line}
            </li>
          ))}
        </ul>
      )}

      {text.does && (
        <p className="spec-card-line" data-layer="does" data-speak="">
          {text.does}
        </p>
      )}
      {text.needs && (
        <p className="spec-card-line" data-layer="needs" data-speak="">
          {text.needs}
        </p>
      )}
      {text.gives && (
        <p className="spec-card-line" data-layer="gives" data-speak="">
          {text.gives}
        </p>
      )}

      <ul className="spec-card-ports" aria-label="Ports">
        {model.ports.map((port) => (
          <li key={port.id} className="spec-card-port" data-port={port.id} data-type={port.type}>
            <Socket type={port.type} />
            <span data-speak="">{port.label}</span>
          </li>
        ))}
      </ul>

      {model.settings.length > 0 && (
        <div className="spec-card-settings">
          {model.settings.map((entry) => (
            <SettingControl
              key={entry.setting.id}
              entry={entry}
              locked={running || !canvas}
              onChange={(value) => change(entry.setting.id, value)}
            />
          ))}
        </div>
      )}

      {text.specLine && (
        <p className="spec-card-line" data-layer="spec-line" data-speak="">
          {text.specLine}
        </p>
      )}
      {text.popularMechanics && (
        <div className="spec-card-popular">
          <RealWorldPicture assetKey={record.card.realWorldArt} art={content.art} />
          <p className="spec-card-line" data-layer="popular-mechanics" data-speak="">
            {text.popularMechanics}
          </p>
        </div>
      )}
      {text.safetyNote && (
        <p className="spec-card-line spec-card-safety" data-layer="safety" data-speak="">
          {text.safetyNote}
        </p>
      )}
    </article>
  );
};

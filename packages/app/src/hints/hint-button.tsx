// The hint button (brief Section 9: "a small button beside the goal"), in the header's hints slot. Each tap is the
// next step of the ladder (controller.ts); the rungs are drawn on the canvas, never here. One native button, so touch,
// pointer, keyboard (Enter; Space stays Run and Stop, D42) and screen readers take the same path (ground rule 8), and
// the canvas's list view reads the rung drawn now. The step's line is the text twin, said in a polite status; do-it's
// line, saying what it did, also shows beside the button. No dialog (ground rule 9). Nothing in the sandbox, or for a
// challenge with no ladder (an unscripted build).
import { useEffect, useRef, useState } from 'react';
import type { Challenge, Timestamp } from '@servo/schema';
import type { RunLoop } from '../run-bar/run-loop.ts';
import { useShell } from '../shell/context.ts';
import { HintLadderController, NO_HINT } from './controller.ts';
import type { HintState } from './controller.ts';
import type { HintLog } from './log.ts';
import { HINT_TEXT } from './text.ts';
import './hints.css';

export interface HintButtonProps {
  /** The challenge on the canvas; none in the sandbox. */
  readonly challenge: Challenge | null;
  /** The Run bar's run loop, whose Runs that miss the goal count towards an offer. */
  readonly loop: RunLoop | null;
  /** Where the steps used are kept for the run record; the Run bar's recorder reads the same log. */
  readonly log: HintLog;
  /** Wall-clock times for the hint uses. Default now, as toISOString writes it. */
  readonly now?: () => Timestamp;
}

export const HintButton = ({ challenge, loop, log, now }: HintButtonProps) => {
  const { canvas, content, blueprint, mode } = useShell();
  const [controller, setController] = useState<HintLadderController | null>(null);
  const [state, setState] = useState<HintState>(NO_HINT);
  const clock = useRef(now);
  clock.current = now;

  useEffect(() => {
    // Steps used under another challenge, or before the sandbox, are not about this one's Runs.
    log.clear();
    if (!canvas || !challenge || challenge.hints.length === 0) return undefined;
    const made = new HintLadderController({
      canvas,
      catalogue: content.catalogue,
      challenge,
      log,
      loop,
      now: () => (clock.current ?? (() => new Date().toISOString()))(),
    });
    setController(made);
    setState(made.state);
    const off = made.subscribe(setState);
    return () => {
      off();
      made.dispose();
      setController(null);
      setState(NO_HINT);
    };
  }, [canvas, challenge, content, loop, log]);

  useEffect(() => {
    controller?.buildChanged();
  }, [controller, blueprint]);

  if (!challenge || challenge.hints.length === 0) return null;
  const usable = state.available && mode === 'build';
  return (
    <div className="hint-ladder">
      <button
        type="button"
        className="hint-button"
        data-offered={state.offered}
        aria-disabled={!usable}
        onClick={() => {
          if (usable) controller?.ask();
        }}
      >
        {HINT_TEXT.button}
      </button>
      {state.said ? (
        <span className="hint-said" aria-hidden="true">
          {state.said}
        </span>
      ) : null}
      <span className="hint-spoken" role="status">
        {state.shown?.line ?? ''}
      </span>
    </div>
  );
};

// The header's goal line (brief Section 9): a challenge's one-line goal from content, and a plain check mark beside it
// once a Run meets the goal. No points, praise or celebration (ground rule 7), and no dialog (ground rule 9). The check
// is judged live from the run loop's frames by a GoalWatch, the same judge the golden harness uses on run records. It
// shows from the tick the goal is met until the next Run starts or the build changes, so it always describes the
// build on the canvas. The check's text twin, "Goal met", is read aloud as it appears. A what-if has no right answer
// (brief Sections 4 and 5, D131): its line is the change to make and the thing to watch, and nothing is judged here,
// so it shows no check and says nothing; its goal keeps meaning "the change was observed" for the run record and Home.
import { useEffect, useRef, useState } from 'react';
import type { Challenge } from '@servo/schema';
import { runKeyOf } from '../run-bar/run-loop.ts';
import type { RunLoop } from '../run-bar/run-loop.ts';
import { useShell } from '../shell/context.ts';
import { GoalWatch, NOT_MET } from './goal.ts';
import type { GoalVerdict } from './goal.ts';
import { introducedPartId } from './home.tsx';
import { CHALLENGE_TEXT } from './text.ts';
import './challenges.css';

export interface GoalLineProps {
  /** The challenge on the canvas; none in the sandbox, where the line is empty. */
  readonly challenge: Challenge | null;
  /** The Run bar's run loop, whose frames are judged. */
  readonly loop: RunLoop | null;
}

export const GoalLine = ({ challenge, loop }: GoalLineProps) => {
  const { canvas, content, blueprint } = useShell();
  const [verdict, setVerdict] = useState<GoalVerdict>(NOT_MET);
  /** The run key of the build the verdict is about. */
  const judged = useRef<string | null>(null);
  /** Whether a Run's verdict shows at all: not for a what-if (D131). */
  const shows = challenge !== null && challenge.kind !== 'what-if';

  useEffect(() => {
    setVerdict(NOT_MET);
    judged.current = null;
    if (!loop || !challenge || !canvas || !shows) return undefined;
    let watch: GoalWatch | undefined;
    let last = -1;
    return loop.subscribe((state, frame) => {
      if (!frame) {
        // A new Run is being prepared: the last verdict no longer describes what is about to play.
        if (state.phase === 'loading') setVerdict(NOT_MET);
        return;
      }
      // Tick 0, or a tick at or before the last, is a Run starting again from its snapshot.
      if (!watch || frame.tick === 0 || frame.tick <= last) {
        const build = canvas.blueprint;
        if (!build) return;
        watch = new GoalWatch({ challenge, blueprint: build, catalogue: content.catalogue });
        judged.current = runKeyOf(build);
        setVerdict(NOT_MET);
      }
      last = frame.tick;
      const wasMet = watch.verdict.met;
      const now = watch.push(frame.tick, frame.events);
      if (now.met && !wasMet) {
        setVerdict(now);
        // A part introduction ends on its part's card, with the live readouts of the Run that met the goal (task 7.27).
        const introduced = introducedPartId(challenge, canvas.blueprint);
        if (introduced !== undefined) canvas.select({ kind: 'part', partId: introduced });
      }
    });
  }, [loop, challenge, canvas, content, shows]);

  // An edit to the build after the Run clears the check: it described the build that ran.
  useEffect(() => {
    if (!blueprint || judged.current === null || runKeyOf(blueprint) === judged.current) return;
    judged.current = null;
    setVerdict(NOT_MET);
  }, [blueprint]);

  if (!challenge) return null;
  if (!shows) {
    return (
      <p className="challenge-goal" data-kind={challenge.kind}>
        <span className="challenge-goal-line">{challenge.goalLine}</span>
      </p>
    );
  }
  return (
    <p className="challenge-goal" data-kind={challenge.kind} data-met={verdict.met}>
      <span className="challenge-goal-line">{challenge.goalLine}</span>
      <svg className="challenge-tick" data-shown={verdict.met} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M4 10.5 L8.5 15 L16 5.5" />
      </svg>
      <span className="challenge-spoken" role="status">
        {verdict.met ? CHALLENGE_TEXT.met : ''}
      </span>
    </p>
  );
};

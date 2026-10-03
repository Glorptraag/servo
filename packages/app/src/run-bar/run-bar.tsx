// The Run bar (brief Sections 9 and 10, task 4.4), in the shell's runBar slot: bottom centre, always there, never
// moving (D67). One large Run/Stop toggle; the clock, from normal speed down to 1 tick a second, with a visual twin of
// the tick sound for each step in slow motion; Undo; Reset arena (D29). Run is off, with one plain line saying why,
// until a part is placed (ground rule 9: a line, never a dialog). Every control is a native button, so touch,
// pointer, keyboard and screen readers all take the same path (ground rule 8); Space is Run and Stop too (D42).
// The run loop itself is run-loop.ts, which the shared build's replay shares.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Blueprint, Challenge, Timestamp } from '@servo/schema';
import type { ProgramRuntime } from '@servo/sim-core';
import type { HintUses } from '../hints/log.ts';
import { useShell } from '../shell/context.ts';
import { UndoHistory } from './history.ts';
import { isRunKey } from './keys.ts';
import { RunRecorder } from './record.ts';
import { CLOCK_RATES, NORMAL_RATE, RunLoop, isSlowMotion, pageClock } from './run-loop.ts';
import type { RunClock, RunState } from './run-loop.ts';
import './run-bar.css';

/** Every line the Run bar shows or says: real words, no praise, no exclamation marks (ground rule 7). */
export const RUN_BAR_TEXT = {
  run: 'Run',
  stop: 'Stop',
  undo: 'Undo',
  resetArena: 'Reset arena',
  clock: 'Clock speed',
  slower: 'Slower',
  faster: 'Faster',
  tick: 'Tick',
  nothingPlaced: 'Place a part first.',
  cannotRun: 'This build could not be run.',
  cannotDraw: 'This Run could not be shown on this device.',
} as const;

/** The clock's speed read aloud, with its real unit. */
export const rateWords = (rate: number): string => `${rate} ${rate === 1 ? 'tick' : 'ticks'} a second${isSlowMotion(rate) ? ', slow motion' : ''}`;

export interface RunBarProps {
  /** Default the page's `performance.now` and `requestAnimationFrame`. Tests drive their own. */
  readonly clock?: RunClock;
  /** The seed of each new Simulation. Default a fresh random one, kept while the build is unchanged (D37). */
  readonly seed?: (blueprint: Blueprint) => number;
  /** Wall-clock times for the run records. Default now, as toISOString writes it. */
  readonly now?: () => Timestamp;
  /** Hands out the run loop once the bar shows it, and null as it goes: the spec card, sound and challenges listen to it. */
  readonly onLoop?: (loop: RunLoop | null) => void;
  /** The challenge on the canvas (task 4.5): its Runs are kept with its id and the goal's verdict. None in the sandbox. */
  readonly challenge?: Challenge | null;
  /** The brains' program for each new Simulation (the Level 3 slot, task 6.6). Default none: the no-op brain (D41). */
  readonly program?: (blueprint: Blueprint) => ProgramRuntime | undefined;
  /** The hint steps used since the last Run kept (task 4.6), which each Run's record keeps. Default none. */
  readonly hints?: HintUses;
}

const BUILD: RunState = { phase: 'build', tick: 0, rate: NORMAL_RATE };

export const RunBar = ({ clock, seed, now, onLoop, challenge = null, program, hints }: RunBarProps) => {
  const { canvas, content, child, blueprint, mode, setMode, load } = useShell();
  const reasonId = useId();
  const barRef = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState<RunLoop | null>(null);
  const [run, setRun] = useState<RunState>(BUILD);
  const [history] = useState(() => new UndoHistory());
  const [undoSteps, setUndoSteps] = useState(0);
  const recorderRef = useRef<RunRecorder | null>(null);
  const latest = useRef({ setMode, child, clock, seed, now, onLoop, challenge, program, hints, rate: run.rate });
  latest.current = { setMode, child, clock, seed, now, onLoop, challenge, program, hints, rate: run.rate };

  // One loop per canvas. Frames at normal speed redraw nothing here, so the bar re-renders only for what it shows.
  useEffect(() => {
    const view = barRef.current?.ownerDocument.defaultView;
    if (!canvas || !view) return undefined;
    const given = latest.current;
    const recorder = new RunRecorder({
      child: () => latest.current.child,
      challenge: () => latest.current.challenge,
      catalogue: content.catalogue,
      hints: {
        pending: (build) => latest.current.hints?.pending(build) ?? [],
        recorded: (count) => latest.current.hints?.recorded(count),
      },
      ...(given.now ? { now: given.now } : {}),
    });
    recorderRef.current = recorder;
    if (canvas.blueprint) recorder.prepare(canvas.blueprint);
    const made = new RunLoop({
      canvas,
      catalogue: content.catalogue,
      clock: given.clock ?? pageClock(view),
      setMode: (next) => latest.current.setMode(next),
      ...(given.seed ? { seed: given.seed } : {}),
      program: (build) => latest.current.program?.(build),
      rate: given.rate,
      onStart: (build) => recorder.start(build),
      onEnd: (simulation) => recorder.end(simulation),
      lines: { cannotRun: RUN_BAR_TEXT.cannotRun, cannotDraw: RUN_BAR_TEXT.cannotDraw },
    });
    const off = made.subscribe((state, frame) => {
      if (frame && !isSlowMotion(state.rate)) return;
      setRun(state);
    });
    setLoop(made);
    setRun(made.state);
    return () => {
      off();
      made.dispose();
      setLoop(null);
      recorderRef.current = null;
      latest.current.onLoop?.(null);
    };
  }, [canvas, content]);

  // Handed out once the bar shows it, so whoever holds the loop finds Run ready to take a press.
  useEffect(() => {
    if (loop) latest.current.onLoop?.(loop);
  }, [loop]);

  // Undo's history hears every edit as it happens, in the commit that shows the build, as Save does.
  useLayoutEffect(() => {
    if (!canvas) return undefined;
    return canvas.on('edit', (event) => {
      history.edited(event.blueprint);
      setUndoSteps(history.size);
    });
  }, [canvas, history]);

  // A build loaded by anything but an edit or Undo (the first build, Home choosing another) starts the history again.
  useLayoutEffect(() => {
    if (blueprint) recorderRef.current?.prepare(blueprint);
    if (!blueprint || blueprint === history.current) return;
    history.loaded(blueprint);
    setUndoSteps(history.size);
  }, [blueprint, history]);

  const placed = (blueprint?.parts.length ?? 0) > 0;
  const busy = run.phase === 'loading' || run.phase === 'spin-up' || run.phase === 'running';
  const playing = run.phase === 'spin-up' || run.phase === 'running';
  const building = mode === 'build' && !busy;
  const canRun = busy || placed;

  const toggle = useCallback(() => {
    if (!loop) return;
    if (loop.busy) loop.stop();
    else if ((canvas?.blueprint?.parts.length ?? 0) > 0) void loop.run();
  }, [loop, canvas]);

  // Space is Run and Stop wherever focus is, except in a field the child types in (keys.ts). Taken on keydown, and kept
  // from activating a focused button on keyup, so one press is one toggle.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const view = barRef.current?.ownerDocument.defaultView;
    if (!view) return undefined;
    let taken = false;
    const onDown = (event: KeyboardEvent): void => {
      if (!isRunKey(event)) return;
      event.preventDefault();
      taken = true;
      if (!event.repeat) toggleRef.current();
    };
    const onUp = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || !taken) return;
      taken = false;
      event.preventDefault();
    };
    view.addEventListener('keydown', onDown);
    view.addEventListener('keyup', onUp);
    return () => {
      view.removeEventListener('keydown', onDown);
      view.removeEventListener('keyup', onUp);
    };
  }, []);

  const undo = (): void => {
    if (!canvas || !building) return;
    const previous = history.undo();
    if (!previous) return;
    const result = load(previous);
    if (result.ok) history.settle(result.value);
    else if (canvas.blueprint) history.loaded(canvas.blueprint);
    setUndoSteps(history.size);
  };

  const resetArena = (): void => {
    const build = canvas?.blueprint;
    if (!canvas || !build || !building) return;
    canvas.apply({ kind: 'set-arena', arena: { preset: build.arena.preset, props: [] } });
  };

  const rateIndex = CLOCK_RATES.findIndex((rate) => rate >= run.rate);
  const step = (by: -1 | 1): void => {
    const next = CLOCK_RATES[Math.min(CLOCK_RATES.length - 1, Math.max(0, rateIndex + by))];
    if (next !== undefined) loop?.setRate(next);
  };

  const reason = !canRun ? RUN_BAR_TEXT.nothingPlaced : run.phase === 'failed' ? (run.problem ?? RUN_BAR_TEXT.cannotRun) : null;
  const twin = playing && isSlowMotion(run.rate);
  return (
    <div ref={barRef} className="run-bar" data-phase={run.phase}>
      <button
        type="button"
        className="run-bar-toggle"
        data-run={busy ? 'stop' : 'run'}
        aria-keyshortcuts="Space"
        aria-busy={run.phase === 'loading'}
        aria-describedby={reason ? reasonId : undefined}
        aria-disabled={!canRun}
        disabled={!loop}
        onClick={toggle}
      >
        <svg className="run-bar-shape" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          {busy ? <rect x="4" y="4" width="12" height="12" rx="1.5" /> : <path d="M5 3.5 L16.5 10 L5 16.5 Z" />}
        </svg>
        {busy ? RUN_BAR_TEXT.stop : RUN_BAR_TEXT.run}
      </button>
      {reason ? (
        <p id={reasonId} className="run-bar-reason" role="status">
          {reason}
        </p>
      ) : (
        <div className="run-bar-clock" role="group" aria-label={RUN_BAR_TEXT.clock}>
          <button type="button" className="run-bar-step" aria-label={RUN_BAR_TEXT.slower} disabled={!loop || rateIndex <= 0} onClick={() => step(-1)}>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <rect x="4" y="9" width="12" height="2.5" rx="1" />
            </svg>
          </button>
          <div className="run-bar-readout">
            <output className="run-bar-rate" aria-live="polite">
              <span aria-hidden="true">
                {run.rate}
                <span className="run-bar-unit"> ticks/s</span>
              </span>
              <span className="run-bar-spoken">{rateWords(run.rate)}</span>
            </output>
            <span className="run-bar-twin" data-shown={twin} data-tick={run.tick} data-beat={run.tick % 2 === 0 ? 'even' : 'odd'} aria-hidden="true">
              <span className="run-bar-beat" key={run.tick} />
              {RUN_BAR_TEXT.tick} {run.tick}
            </span>
          </div>
          <button
            type="button"
            className="run-bar-step"
            aria-label={RUN_BAR_TEXT.faster}
            disabled={!loop || rateIndex >= CLOCK_RATES.length - 1}
            onClick={() => step(1)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <rect x="4" y="9" width="12" height="2.5" rx="1" />
              <rect x="8.75" y="4.25" width="2.5" height="12" rx="1" />
            </svg>
          </button>
        </div>
      )}
      <button type="button" className="run-bar-button" disabled={!building || undoSteps === 0} onClick={undo}>
        {RUN_BAR_TEXT.undo}
      </button>
      <button type="button" className="run-bar-button run-bar-reset" disabled={!building || (blueprint?.arena.props.length ?? 0) === 0} onClick={resetArena}>
        {RUN_BAR_TEXT.resetArena}
      </button>
    </div>
  );
};

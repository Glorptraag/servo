// Where the run loop (task 4.4) hands the spec card each Run frame: the run loop pushes every frame it gives the
// canvas, in tick order, and clears on Stop; the card reads `frame.live` for the selected part. No wall clock here.
import type { RunFrame } from '@servo/sim-core';

export interface RunFrames {
  /** The latest frame, or null outside a Run. */
  readonly frame: RunFrame | null;
  push(frame: RunFrame): void;
  clear(): void;
  /** Calls `listener` after each push and clear; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const createRunFrames = (): RunFrames => {
  let frame: RunFrame | null = null;
  const listeners = new Set<() => void>();
  const changed = (next: RunFrame | null): void => {
    frame = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get frame() {
      return frame;
    },
    push: (next) => changed(next),
    clear: () => changed(null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/**
 * At 15 ticks a second and faster the readouts move every third tick: quick enough to read, and the card is not drawn
 * again at every tick of a Run (task 6.1, docs/perf.md). Slower, every tick reaches the card, as slow motion shows
 * each tick as a step (brief Section 10).
 */
export const READOUT_EVERY_TICKS = 3;

/** The clock rate, in ticks a second, from which the readouts move every third tick. */
export const READOUT_PACE_FROM_RATE = 15;

const sameFaults = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((fault, i) => fault === b[i]);

/**
 * Whether the run loop's next frame goes to the card, at a clock of `rate` ticks a second: every frame below
 * READOUT_PACE_FROM_RATE; otherwise the Run's first frame, a Run that started again, every third tick, and any tick
 * where a switch opened or closed or a fault started or ended, so those always show at their tick.
 */
export const readoutFrameDue = (shown: RunFrame | null, frame: RunFrame, rate: number): boolean => {
  if (rate < READOUT_PACE_FROM_RATE || !shown || frame.tick <= shown.tick || frame.tick % READOUT_EVERY_TICKS === 0) return true;
  for (const [subject, live] of frame.live) {
    const was = shown.live.get(subject);
    if (!was || live.values.closed !== was.values.closed || !sameFaults(live.faults, was.faults)) return true;
  }
  return false;
};

/** What the run loop tells its listeners: the clock's rate, and whether a Run plays. */
export interface RunLoopState {
  readonly phase: string;
  readonly rate: number;
}

/**
 * App.tsx's listener on the run loop for the card: hands it the frames readoutFrameDue picks. A change without a frame
 * (a new speed, Stop, a failed Run) first hands over the frame last held back, so the card never ends behind the canvas,
 * then clears whenever no Run plays.
 */
export const followRun = (frames: RunFrames): ((state: RunLoopState, frame?: RunFrame) => void) => {
  let held: RunFrame | undefined;
  return (state, frame) => {
    if (frame) {
      held = readoutFrameDue(frames.frame, frame, state.rate) ? undefined : frame;
      if (!held) frames.push(frame);
      return;
    }
    if (held) frames.push(held);
    held = undefined;
    if (state.phase !== 'spin-up' && state.phase !== 'running') frames.clear();
  };
};

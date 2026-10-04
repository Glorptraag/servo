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
 * The readouts move every third tick, ten times a simulated second: quick enough to read, and the card is not drawn
 * again at every tick of a Run (task 6.1, docs/perf.md).
 */
export const READOUT_EVERY_TICKS = 3;

const sameFaults = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((fault, i) => fault === b[i]);

/**
 * Whether the run loop's next frame goes to the card: the Run's first frame, a Run that started again, every third
 * tick, and any tick where a switch opened or closed or a fault started or ended, so those always show at their tick.
 */
export const readoutFrameDue = (shown: RunFrame | null, frame: RunFrame): boolean => {
  if (!shown || frame.tick <= shown.tick || frame.tick % READOUT_EVERY_TICKS === 0) return true;
  for (const [subject, live] of frame.live) {
    const was = shown.live.get(subject);
    if (!was || live.values.closed !== was.values.closed || !sameFaults(live.faults, was.faults)) return true;
  }
  return false;
};

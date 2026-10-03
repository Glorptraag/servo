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

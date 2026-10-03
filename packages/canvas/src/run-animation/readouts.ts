// When the list view's live readouts (task 3.6) are worth redrawing. Its DOM is rebuilt on every change, and a screen
// reader would re-read it, so it is not told of every tick: only of the Run's first frame, of a switch that opened or
// closed or a fault that started or ended (things the child acts on), and otherwise once a simulated second. Counted
// in ticks, never by a clock. Pure. See docs/run-animation.md.
import { TICK_RATE } from '@servo/schema';
import type { RunFrame } from '@servo/sim-core/interface';

const sameFaults = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((fault, i) => fault === b[i]);

/** Whether `frame` changes something discrete: a switch's position or a part's faults. */
export const discreteChange = (before: RunFrame, frame: RunFrame): boolean => {
  for (const [subject, live] of frame.live) {
    const was = before.live.get(subject);
    if (!was) return true;
    if (live.values.closed !== was.values.closed) return true;
    if (!sameFaults(live.faults, was.faults)) return true;
  }
  return false;
};

/** Whether the list view should read the frames again, given the frame before and the tick it last read them at. */
export const readoutsDue = (before: RunFrame | undefined, frame: RunFrame, listedTick: number | undefined): boolean => {
  if (!before || listedTick === undefined || frame.tick < listedTick) return true;
  if (frame.tick - listedTick >= TICK_RATE) return true;
  return discreteChange(before, frame);
};

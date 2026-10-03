// When the list view (task 3.6) reads a Run's live readouts again: the first frame, a switch or a fault changing, and
// otherwise once a simulated second, counted in ticks.
import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '@servo/schema';
import { readoutsDue } from '../../src/run-animation/readouts.ts';
import { rollingStartFrame } from '../helpers/run-frames.ts';

describe('the list view’s live readouts', () => {
  it('are read on the first frame and after a restore', () => {
    expect(readoutsDue(undefined, rollingStartFrame(0), undefined)).toBe(true);
    expect(readoutsDue(rollingStartFrame(9), rollingStartFrame(0), 5)).toBe(true);
  });

  it('wait for a simulated second while only values change', () => {
    expect(readoutsDue(rollingStartFrame(1), rollingStartFrame(2), 0)).toBe(false);
    expect(readoutsDue(rollingStartFrame(TICK_RATE - 1), rollingStartFrame(TICK_RATE), 0)).toBe(true);
  });

  it('are read at once when a switch flips or a fault starts', () => {
    expect(readoutsDue(rollingStartFrame(3), rollingStartFrame(4, { milliamps: 0, rpm: 0 }), 0)).toBe(true);
    expect(readoutsDue(rollingStartFrame(3), rollingStartFrame(4, { faults: { 'motor-left': ['overload'] } }), 0)).toBe(true);
  });
});

// The shared build's replay (task 5.6): the app's run loop (src/run-bar/run-loop.ts, task 4.4) on a read-only canvas
// (D43). It makes one Simulation from the shared blueprint and the link's seed, snapshots tick 0, puts the canvas in Run
// mode, holds tick 0 for the one-second spin-up, then steps 30 ticks a second until Stop, which restores tick 0 and
// returns the canvas to Build mode. Run again starts from that same tick 0, so every replay of a link is the same run.
// A read-only canvas emits no control, so the replay has no inputs. Nothing here writes anywhere: no store, no record,
// no address. Framework-free; the wall clock is injected, and lives only in the run loop, never in sim-core.

import type { CanvasHandle } from '@servo/canvas';
import type { Blueprint, Catalogue } from '@servo/schema';
import { RunLoop } from '../run-bar/run-loop.ts';
import type { RunClock, RunPhase } from '../run-bar/run-loop.ts';

export { MAX_STEPS_PER_FRAME, SPIN_UP_MS, pageClock } from '../run-bar/run-loop.ts';

/** The replay's wall clock: the run loop's. */
export type ReplayClock = RunClock;

/**
 * - `loading`: the Simulation is being made (the physics engine loads at the first Run, D11).
 * - `spin-up`, `running`: the replay plays; Stop ends it.
 * - `stopped`: back at tick 0 in Build mode; Run again plays it again.
 * - `failed`: the run could not be made or drawn on this device; the build stays on the canvas.
 */
export type ReplayPhase = 'loading' | 'spin-up' | 'running' | 'stopped' | 'failed';

const phaseOf = (phase: RunPhase): ReplayPhase => (phase === 'build' ? 'stopped' : phase);

export interface ReplayOptions {
  readonly canvas: CanvasHandle;
  /** Validated and canonical: what readShareFragment gives. */
  readonly blueprint: Blueprint;
  readonly catalogue: Catalogue;
  readonly seed: number;
  readonly clock: ReplayClock;
  /** Called on every change of phase, and with each tick drawn while running. */
  readonly onChange?: (phase: ReplayPhase, tick: number) => void;
}

export class Replay {
  private readonly loop: RunLoop;

  constructor(options: ReplayOptions) {
    const { canvas, blueprint, catalogue, seed, clock, onChange } = options;
    this.loop = new RunLoop({
      canvas,
      catalogue,
      clock,
      blueprint: () => blueprint,
      seed: () => seed,
      lines: { cannotRun: 'The shared build could not be run.', cannotDraw: 'The replay could not be drawn.' },
    });
    if (onChange) {
      this.loop.subscribe((state, frame) => {
        if (!frame || state.phase === 'running') onChange(phaseOf(state.phase), state.tick);
      });
    }
  }

  get phase(): ReplayPhase {
    return phaseOf(this.loop.phase);
  }

  /** The tick on the canvas: 0 before the first step and after Stop. */
  get tick(): number {
    return this.loop.tick;
  }

  /** Plays from tick 0. Does nothing while the replay is already loading or playing. Never rejects. */
  play(): Promise<void> {
    return this.loop.run();
  }

  /** Stops the replay: tick 0 again, and the canvas back in Build mode, exactly as the build was. */
  stop(): void {
    this.loop.stop();
  }

  /** Stops and frees the Simulation. The replay cannot be used afterwards. */
  dispose(): void {
    this.loop.dispose();
  }
}

// The shared build's replay (task 5.6): the Run flow of docs/run-loop.md on a read-only canvas (D43). It makes one
// Simulation from the shared blueprint and the link's seed, snapshots tick 0, puts the canvas in Run mode, holds tick
// 0 for the one-second spin-up, then steps 30 ticks a second until Stop, which restores tick 0 and returns the canvas
// to Build mode. Run again starts from that same tick 0, so every replay of a link is the same run. A read-only canvas
// emits no control, so the replay has no inputs. Nothing here writes anywhere: no store, no record, no address.
// Framework-free; the wall clock is injected, and lives only here, never in sim-core.

import type { CanvasHandle } from '@servo/canvas';
import { TICK_RATE } from '@servo/schema';
import type { Blueprint, Catalogue } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame, SimSnapshot, Simulation } from '@servo/sim-core';

/** Tick 0 stays on screen this long before the robot moves, as in the Run loop. */
export const SPIN_UP_MS = 1000;

/** At most this many ticks are stepped in one animation frame; a longer gap (a hidden tab) is skipped, not caught up. */
export const MAX_STEPS_PER_FRAME = 4;

const TICK_MS = 1000 / TICK_RATE;

/** The replay's wall clock: `performance.now` and `requestAnimationFrame` in a page; tests drive their own. */
export interface ReplayClock {
  now(): number;
  /** Calls back once, at the next frame. Returns a cancel. */
  frame(callback: () => void): () => void;
}

export const pageClock = (view: Window): ReplayClock => ({
  now: () => view.performance.now(),
  frame: (callback) => {
    const id = view.requestAnimationFrame(() => callback());
    return () => view.cancelAnimationFrame(id);
  },
});

/**
 * - `loading`: the Simulation is being made (the physics engine loads at the first Run, D11).
 * - `spin-up`, `running`: the replay plays; Stop ends it.
 * - `stopped`: back at tick 0 in Build mode; Run again plays it again.
 * - `failed`: the run could not be made or drawn on this device; the build stays on the canvas.
 */
export type ReplayPhase = 'loading' | 'spin-up' | 'running' | 'stopped' | 'failed';

export interface ReplayOptions {
  readonly canvas: CanvasHandle;
  /** Validated and canonical: what readShareFragment gives. */
  readonly blueprint: Blueprint;
  readonly catalogue: Catalogue;
  readonly seed: number;
  readonly clock: ReplayClock;
  /** Called on every change of phase, and with each tick drawn. */
  readonly onChange?: (phase: ReplayPhase, tick: number) => void;
}

export class Replay {
  private phaseNow: ReplayPhase = 'stopped';
  private simulation: Simulation | undefined;
  private start: SimSnapshot | undefined;
  private cancel: (() => void) | undefined;
  private nextAt = 0;
  private disposed = false;
  private readonly options: ReplayOptions;

  constructor(options: ReplayOptions) {
    this.options = options;
  }

  get phase(): ReplayPhase {
    return this.phaseNow;
  }

  /** The tick on the canvas: 0 before the first step and after Stop. */
  get tick(): number {
    return this.simulation?.tick ?? 0;
  }

  /** Plays from tick 0. Does nothing while the replay is already loading or playing. Never rejects. */
  async play(): Promise<void> {
    if (this.disposed || this.phaseNow === 'loading' || this.phaseNow === 'spin-up' || this.phaseNow === 'running') return;
    const { canvas, blueprint, catalogue, seed, clock } = this.options;
    if (!this.simulation) {
      this.set('loading');
      const arena = catalogue.arenas?.get(blueprint.arena.preset);
      try {
        if (!arena) throw new Error(`The catalogue has no arena '${blueprint.arena.preset}'.`);
        const made = await createSimulation({ blueprint, catalogue, arena, seed });
        if (this.disposed) {
          made.dispose();
          return;
        }
        this.simulation = made;
        this.start = made.snapshot();
      } catch (error) {
        this.fail('The shared build could not be run.', error);
        return;
      }
      // Stop while it loaded: the Simulation is kept for Run again, and nothing plays.
      if (this.phase !== 'loading') return;
    }
    const simulation = this.simulation;
    const start = this.start;
    if (!start) return;
    simulation.restore(start);
    canvas.setMode('run');
    if (!this.draw(simulation.frame)) return;
    this.nextAt = clock.now() + SPIN_UP_MS;
    this.set('spin-up');
    this.schedule();
  }

  /** Stops the replay: tick 0 again, and the canvas back in Build mode, exactly as the build was. */
  stop(): void {
    if (this.disposed) return;
    this.halt();
    this.set('stopped');
  }

  /** Stops and frees the Simulation. The replay cannot be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.halt();
    this.disposed = true;
    this.simulation?.dispose();
    this.simulation = undefined;
  }

  private halt(): void {
    this.cancel?.();
    this.cancel = undefined;
    if (this.simulation && this.start) this.simulation.restore(this.start);
    if (this.options.canvas.mode === 'run') this.options.canvas.setMode('build');
  }

  private schedule(): void {
    this.cancel = this.options.clock.frame(() => this.onFrame());
  }

  private onFrame(): void {
    this.cancel = undefined;
    const simulation = this.simulation;
    if (this.disposed || !simulation || (this.phaseNow !== 'spin-up' && this.phaseNow !== 'running')) return;
    const now = this.options.clock.now();
    let steps = 0;
    while (now >= this.nextAt && steps < MAX_STEPS_PER_FRAME) {
      if (!this.draw(simulation.step())) return;
      this.nextAt += TICK_MS;
      steps += 1;
    }
    if (now - this.nextAt > TICK_MS * MAX_STEPS_PER_FRAME) this.nextAt = now + TICK_MS;
    if (steps > 0 && this.phaseNow === 'spin-up') this.set('running');
    else if (steps > 0) this.options.onChange?.(this.phaseNow, simulation.tick);
    this.schedule();
  }

  /** Hands a frame to the canvas. A canvas that cannot draw it ends the replay with a plain line, never a dialog. */
  private draw(frame: RunFrame): boolean {
    try {
      this.options.canvas.applyRunFrame(frame);
      return true;
    } catch (error) {
      this.fail('The replay could not be drawn.', error);
      return false;
    }
  }

  private fail(message: string, error: unknown): void {
    console.warn(message, error);
    this.halt();
    this.set('failed');
  }

  private set(phase: ReplayPhase): void {
    this.phaseNow = phase;
    this.options.onChange?.(phase, this.tick);
  }
}

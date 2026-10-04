// The app's one run loop (task 4.4, docs/run-loop.md): the child's Run bar drives it, and the shared build's replay
// (task 5.6, src/sharing/replay.ts) is a thin wrapper round it. Run makes a Simulation from the build, or keeps the
// one made from the same build (D37: the same seed while the build is unchanged), snapshots tick 0, puts the canvas
// in Run mode and gives it tick 0's frame, holds it for the one-second spin-up, then steps the Simulation at the
// clock's rate, 30 ticks a second down to 1 in slow motion, giving every frame once, in tick order, to the canvas and
// to its listeners. Stop restores tick 0 and returns the canvas to Build mode, where the build is exactly as it was:
// nothing here edits or loads a build (ground rule 4). A switch flip from the canvas reaches the Simulation as input.
// Framework-free. The wall clock is injected and lives only here, never in sim-core (ground rule 2).
import type { CanvasHandle, CanvasMode } from '@servo/canvas';
import { canonicalJson } from '@servo/schema';
import type { Blueprint, Catalogue } from '@servo/schema';
import type { ControlInput, CreateSimulation, ProgramRuntime, RunFrame, SimSnapshot, Simulation } from '@servo/sim-core';

/**
 * sim-core, with the physics engine and its inlined WebAssembly (about 1.4 MB gzipped), imported at the first Run, so the
 * bundle splits it into a chunk of its own that cold start never downloads or parses (D11, docs/perf.md). The service
 * worker keeps the chunk for offline Runs (task 5.5). Later calls reuse the first import.
 */
export const loadCreateSimulation = async (): Promise<CreateSimulation> => (await import('@servo/sim-core')).createSimulation;

/** sim-core's chunk did not load: offline before the service worker had it, or a tab older than the release it asks for. */
class EngineUnavailable extends Error {
  override readonly name = 'EngineUnavailable';
}

/** Tick 0 stays on screen this long before the robot moves, so the child sees the wires light first (brief Section 10). */
export const SPIN_UP_MS = 1000;

/** At most this many ticks are stepped in one animation frame; a longer gap (a hidden tab) is skipped, not caught up. */
export const MAX_STEPS_PER_FRAME = 4;

/** The clock's speeds, in ticks a second of display: slow motion at the low end, normal at 30 (the schema's TICK_RATE). */
export const CLOCK_RATES = [1, 2, 3, 5, 10, 15, 30] as const;

/** The normal speed: one simulated second each second. */
export const NORMAL_RATE = 30;

/** At or below this many ticks a second the clock is in slow motion: each tick is a step the child can see (brief Section 10). */
export const SLOW_MOTION_RATE = 5;

export const isSlowMotion = (rate: number): boolean => rate <= SLOW_MOTION_RATE;

/** The wall clock: `performance.now` and `requestAnimationFrame` in a page; tests drive their own. */
export interface RunClock {
  now(): number;
  /** Calls back once, at the next frame. Returns a cancel. */
  frame(callback: () => void): () => void;
}

export const pageClock = (view: Window): RunClock => ({
  now: () => view.performance.now(),
  frame: (callback) => {
    const id = view.requestAnimationFrame(() => callback());
    return () => view.cancelAnimationFrame(id);
  },
});

/** A fresh unsigned 32-bit seed for a new Simulation. */
export const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

/**
 * What makes two builds the same Run (D37): the build's id, parts, wires and arena. A new name or the store's dates
 * do not change how it runs, so they keep the Simulation and its seed.
 */
export const runKeyOf = (blueprint: Blueprint): string =>
  canonicalJson({ id: blueprint.meta.id, parts: blueprint.parts, wires: blueprint.wires, arena: blueprint.arena });

/**
 * - `build`: no Run; the canvas is in Build mode.
 * - `loading`: the Simulation is being made (the physics engine loads at the first Run, D11), or `onStart` is
 *   preparing; the canvas is still in Build mode.
 * - `spin-up`: Run mode, tick 0 held for its second.
 * - `running`: stepping at the clock's rate.
 * - `failed`: the build could not be run or drawn on this device; the canvas is back in Build mode.
 */
export type RunPhase = 'build' | 'loading' | 'spin-up' | 'running' | 'failed';

export interface RunState {
  readonly phase: RunPhase;
  /** The tick on the canvas: 0 before the first step and after Stop. */
  readonly tick: number;
  /** Ticks a second of display. */
  readonly rate: number;
  /** Why the last Run failed, in plain words; only in `failed`. */
  readonly problem?: string;
}

/**
 * Called on every change of phase or rate without a frame, and with every frame the canvas is given, in tick order,
 * tick 0 first. The spec card's readouts, the sound layer and the challenge runner listen here.
 */
export type RunListener = (state: RunState, frame?: RunFrame) => void;

export interface RunLines {
  /** The build could not be made into a Simulation. */
  readonly cannotRun: string;
  /** The canvas could not draw a frame. */
  readonly cannotDraw: string;
  /** The first Run could not load sim-core and the physics engine. Default RUN_LINES's. */
  readonly cannotLoad?: string;
}

/** The line when the first Run cannot load sim-core, in the brief's plain voice (Section 12). */
export const CANNOT_LOAD_LINE = 'The Run could not start. Try again once this device is online.';

export const RUN_LINES: RunLines = {
  cannotRun: 'This build could not be run.',
  cannotDraw: 'This Run could not be shown on this device.',
  cannotLoad: CANNOT_LOAD_LINE,
};

export interface RunLoopOptions {
  readonly canvas: CanvasHandle;
  readonly catalogue: Catalogue;
  readonly clock: RunClock;
  /** Switches the canvas between Build and Run. The app passes the shell's, which moves the layout too. Default `canvas.setMode`. */
  readonly setMode?: (mode: CanvasMode) => void;
  /** The build a Run starts from. Default the canvas's. */
  readonly blueprint?: () => Blueprint | undefined;
  /** The seed of a new Simulation, made whenever the build has changed since the last one. Default `freshSeed`. */
  readonly seed?: (blueprint: Blueprint) => number;
  /** Ticks a second at first. Default NORMAL_RATE. */
  readonly rate?: number;
  /** The brains' program for a new Simulation of this build (the Level 3 slot, task 6.6). Default none: the no-op brain (D41). */
  readonly program?: (blueprint: Blueprint) => ProgramRuntime | undefined;
  /**
   * Called as each Run is pressed. A promise it returns is awaited (phase `loading`) before the spin-up, so the app's
   * recorder returns none: the store is never on a Run's path. Must not reject.
   */
  readonly onStart?: (blueprint: Blueprint) => Promise<void> | void;
  /** Called as each Run that reached the spin-up ends, before the Simulation is restored, so it can be recorded. */
  readonly onEnd?: (simulation: Simulation) => void;
  readonly lines?: RunLines;
}

const clampRate = (rate: number): number => (Number.isFinite(rate) ? Math.min(NORMAL_RATE, Math.max(1, rate)) : NORMAL_RATE);

export class RunLoop {
  private phaseNow: RunPhase = 'build';
  private rateNow: number;
  private problemNow: string | undefined;
  private simulation: Simulation | undefined;
  private builtFrom = '';
  private start: SimSnapshot | undefined;
  private cancel: (() => void) | undefined;
  private nextAt = 0;
  /** A Run reached the spin-up and has not ended yet. */
  private started = false;
  /** Counts Run presses, Stops and disposal, so a Run still loading knows it was overtaken. */
  private attempt = 0;
  private disposed = false;
  private readonly listeners = new Set<RunListener>();
  private readonly options: RunLoopOptions;
  private readonly unlisten: () => void;

  constructor(options: RunLoopOptions) {
    this.options = options;
    this.rateNow = clampRate(options.rate ?? NORMAL_RATE);
    this.unlisten = options.canvas.on('control', ({ input }) => {
      this.input(input);
    });
  }

  get phase(): RunPhase {
    return this.phaseNow;
  }

  get rate(): number {
    return this.rateNow;
  }

  get tick(): number {
    return this.simulation?.tick ?? 0;
  }

  /** True while a Run is loading or playing: the Run/Stop toggle then stops it. */
  get busy(): boolean {
    return this.phaseNow === 'loading' || this.playing;
  }

  /** True in the spin-up and while running: the canvas is in Run mode. */
  get playing(): boolean {
    return this.phaseNow === 'spin-up' || this.phaseNow === 'running';
  }

  get state(): RunState {
    const state = { phase: this.phaseNow, tick: this.tick, rate: this.rateNow };
    return this.problemNow === undefined ? state : { ...state, problem: this.problemNow };
  }

  subscribe(listener: RunListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Runs the build from tick 0. Does nothing while a Run is loading or playing, or with no build. Never rejects. */
  async run(): Promise<void> {
    if (this.disposed || this.busy) return;
    let blueprint = this.blueprintNow();
    if (!blueprint) return;
    this.attempt += 1;
    const attempt = this.attempt;
    const overtaken = (): boolean => this.disposed || attempt !== this.attempt;
    this.problemNow = undefined;
    for (;;) {
      const key = runKeyOf(blueprint);
      const fresh = !this.simulation || this.builtFrom !== key;
      const preparing = this.options.onStart?.(blueprint);
      if (fresh || preparing instanceof Promise) this.set('loading');
      try {
        if (fresh) {
          this.simulation?.dispose();
          this.simulation = undefined;
          const arena = this.options.catalogue.arenas?.get(blueprint.arena.preset);
          if (!arena) throw new Error(`The catalogue has no arena '${blueprint.arena.preset}'.`);
          const seed = (this.options.seed ?? freshSeed)(blueprint);
          const program = this.options.program?.(blueprint);
          const createSimulation = await loadCreateSimulation().catch((error: unknown) => {
            throw new EngineUnavailable('sim-core could not be loaded.', { cause: error });
          });
          const made = await createSimulation({ blueprint, catalogue: this.options.catalogue, arena, seed, ...(program ? { program } : {}) });
          if (overtaken() || this.simulation) {
            made.dispose();
            return;
          }
          this.simulation = made;
          this.builtFrom = key;
          this.start = made.snapshot();
        }
        await preparing;
      } catch (error) {
        if (!overtaken()) this.fail(error instanceof EngineUnavailable ? (this.lines.cannotLoad ?? CANNOT_LOAD_LINE) : this.lines.cannotRun, error);
        return;
      }
      if (overtaken()) return;
      // The canvas stays in Build mode while the Run loads, so the child may have changed the build meanwhile: run
      // the build as it is now.
      const now = this.blueprintNow();
      if (!now || runKeyOf(now) === key) break;
      if (now.parts.length === 0) {
        // Every part was taken away meanwhile: there is nothing to run (brief Section 9).
        this.set('build');
        return;
      }
      blueprint = now;
    }
    const simulation = this.simulation;
    const start = this.start;
    if (!simulation || !start) return;
    simulation.restore(start);
    this.setMode('run');
    this.set('spin-up');
    if (!this.draw(simulation.frame)) return;
    this.started = true;
    this.nextAt = this.options.clock.now() + SPIN_UP_MS;
    this.schedule();
  }

  /** Stops the Run: tick 0 again, and the canvas back in Build mode with the build exactly as it was. */
  stop(): void {
    if (this.disposed || this.phaseNow === 'build') return;
    this.attempt += 1;
    this.halt();
    this.problemNow = undefined;
    this.set('build');
  }

  /** Run when there is no Run, Stop when there is one: the Run/Stop toggle and Space. */
  toggle(): void {
    if (this.busy) this.stop();
    else void this.run();
  }

  /** Ticks a second, from 1 to 30. A faster clock takes effect at once; a slower one from the next tick. */
  setRate(rate: number): void {
    const next = clampRate(rate);
    if (this.disposed || next === this.rateNow) return;
    this.rateNow = next;
    if (this.phaseNow === 'running') this.nextAt = Math.min(this.nextAt, this.options.clock.now() + 1000 / next);
    this.emit();
  }

  /** A switch flip during a Run, from the canvas's `control` event or the spec card. False when no Run is playing. */
  input(control: ControlInput): boolean {
    if (!this.playing || !this.simulation) return false;
    return this.simulation.input(control);
  }

  /** Stops and frees the Simulation. The loop cannot be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.attempt += 1;
    try {
      this.halt();
    } catch (error) {
      // The canvas may be gone already: the shell destroys it as the app closes.
      console.warn('The Run could not be stopped cleanly.', error);
    }
    this.disposed = true;
    this.unlisten();
    this.simulation?.dispose();
    this.simulation = undefined;
    this.listeners.clear();
  }

  private get lines(): RunLines {
    return this.options.lines ?? RUN_LINES;
  }

  private blueprintNow(): Blueprint | undefined {
    return this.options.blueprint ? this.options.blueprint() : this.options.canvas.blueprint;
  }

  private setMode(mode: CanvasMode): void {
    if (this.options.setMode) this.options.setMode(mode);
    else this.options.canvas.setMode(mode);
  }

  private halt(): void {
    this.cancel?.();
    this.cancel = undefined;
    const simulation = this.simulation;
    const ended = this.started;
    this.started = false;
    if (ended && simulation) {
      try {
        this.options.onEnd?.(simulation);
      } catch (error) {
        console.warn('The end of the Run could not be noted.', error);
      }
    }
    if (simulation && this.start) simulation.restore(this.start);
    if (this.options.canvas.mode === 'run') this.setMode('build');
  }

  private schedule(): void {
    this.cancel = this.options.clock.frame(() => this.onFrame());
  }

  private onFrame(): void {
    this.cancel = undefined;
    const simulation = this.simulation;
    if (this.disposed || !simulation || !this.playing) return;
    const now = this.options.clock.now();
    let steps = 0;
    while (now >= this.nextAt && steps < MAX_STEPS_PER_FRAME) {
      if (this.phaseNow === 'spin-up') this.set('running');
      if (!this.draw(simulation.step())) return;
      this.nextAt += 1000 / this.rateNow;
      steps += 1;
    }
    const tickMs = 1000 / this.rateNow;
    if (now - this.nextAt > tickMs * MAX_STEPS_PER_FRAME) this.nextAt = now + tickMs;
    this.schedule();
  }

  /** Hands a frame to the canvas, then to the listeners. A canvas that cannot draw it ends the Run with a plain line. */
  private draw(frame: RunFrame): boolean {
    try {
      this.options.canvas.applyRunFrame(frame);
    } catch (error) {
      this.fail(this.lines.cannotDraw, error);
      return false;
    }
    this.emit(frame);
    return true;
  }

  private fail(problem: string, error: unknown): void {
    console.warn(problem, error);
    this.halt();
    this.problemNow = problem;
    this.set('failed');
  }

  private set(phase: RunPhase): void {
    this.phaseNow = phase;
    this.emit();
  }

  private emit(frame?: RunFrame): void {
    const state = this.state;
    for (const listener of [...this.listeners]) {
      try {
        listener(state, frame);
      } catch (error) {
        console.warn('A Run listener failed.', error);
      }
    }
  }
}

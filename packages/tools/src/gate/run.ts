// The gate page's Run and Stop: the run loop of packages/app/docs/run-loop.md, which the app builds in task 4.4, and
// the same clock as task 5.6's shared-link replay (packages/app/src/sharing/replay.ts): one Simulation, tick 0
// snapshotted, held for the one-second spin-up, then stepped 30 ticks a second, each frame given once to the canvas's
// applyRunFrame. Unlike the replay it takes the child's switch flips (the canvas's `control` event), and it keeps the
// Simulation while the build is unchanged (D37). The replay is not exported from @servo/app, and the app is not
// this page's to change, so its loop is repeated here in its shape and its constants. Stop restores tick 0 and returns
// the canvas to Build mode, exactly as the build was (ground rule 4). Wall-clock time lives here, never in sim-core.
import type { CanvasHandle } from '@servo/canvas';
import { TICK_RATE, serializeBlueprint } from '@servo/schema';
import type { Blueprint, Catalogue } from '@servo/schema';
import { createSimulation } from '@servo/sim-core';
import type { ControlInput, RunFrame, SimSnapshot, Simulation } from '@servo/sim-core';

/** Tick 0 stays on screen this long before the robot moves, as in the run loop and the replay. */
export const SPIN_UP_MS = 1000;
/** At most this many ticks in one animation frame; a longer gap (a hidden tab) is skipped, not caught up. */
export const MAX_STEPS_PER_FRAME = 4;
const TICK_MS = 1000 / TICK_RATE;

/** `loading` while the Simulation is made (the physics engine loads at the first Run, D11); `failed` leaves Build mode as it was. */
export type RunPhase = 'build' | 'loading' | 'spin-up' | 'running' | 'failed';

export interface GateRunOptions {
  readonly canvas: CanvasHandle;
  readonly catalogue: Catalogue;
  readonly seed: number;
  /** Every change of phase, and every frame drawn. */
  readonly onChange: (phase: RunPhase, frame: RunFrame | undefined, problem?: string) => void;
}

export class GateRun {
  private phaseNow: RunPhase = 'build';
  private simulation: Simulation | undefined;
  private builtFrom = '';
  private ranFrom: string | undefined;
  private start: SimSnapshot | undefined;
  private cancel: (() => void) | undefined;
  private nextAt = 0;
  private lastFrame: RunFrame | undefined;
  private readonly options: GateRunOptions;
  private readonly unlisten: () => void;

  constructor(options: GateRunOptions) {
    this.options = options;
    this.unlisten = options.canvas.on('control', ({ input }) => this.input(input));
  }

  get phase(): RunPhase {
    return this.phaseNow;
  }

  get frame(): RunFrame | undefined {
    return this.lastFrame;
  }

  /** The build the last Run started from, serialised: Stop must give it back exactly. */
  get startedFrom(): string | undefined {
    return this.ranFrom;
  }

  /** Runs the canvas's build from tick 0. Does nothing while a Run is loading or playing. Never rejects. */
  async run(): Promise<void> {
    if (this.phaseNow === 'loading' || this.phaseNow === 'spin-up' || this.phaseNow === 'running') return;
    const { canvas, catalogue, seed } = this.options;
    const blueprint: Blueprint | undefined = canvas.blueprint;
    if (!blueprint) return;
    const bytes = serializeBlueprint(blueprint);
    this.ranFrom = bytes;
    if (!this.simulation || this.builtFrom !== bytes) {
      this.simulation?.dispose();
      this.simulation = undefined;
      this.set('loading', undefined);
      try {
        const arena = catalogue.arenas?.get(blueprint.arena.preset);
        if (!arena) throw new Error(`The catalogue has no arena '${blueprint.arena.preset}'.`);
        const made = await createSimulation({ blueprint, catalogue, arena, seed });
        this.simulation = made;
        this.builtFrom = bytes;
        this.start = made.snapshot();
      } catch (error) {
        this.fail('This build could not be run.', error);
        return;
      }
      // Stopped while it loaded: nothing plays.
      if (this.phase !== 'loading') return;
    }
    const simulation = this.simulation;
    if (this.start) simulation.restore(this.start);
    canvas.setMode('run');
    if (!this.draw(simulation.frame)) return;
    this.nextAt = performance.now() + SPIN_UP_MS;
    this.set('spin-up', simulation.frame);
    this.schedule();
  }

  /** Back to Build mode at tick 0, the build exactly as it was. */
  stop(): void {
    this.halt();
    this.lastFrame = undefined;
    this.set('build', undefined);
  }

  /** A switch flip, while a Run plays. */
  input(control: ControlInput): void {
    if (this.phaseNow === 'spin-up' || this.phaseNow === 'running') this.simulation?.input(control);
  }

  dispose(): void {
    this.halt();
    this.unlisten();
    this.simulation?.dispose();
    this.simulation = undefined;
  }

  private halt(): void {
    if (this.cancel !== undefined) this.cancel();
    this.cancel = undefined;
    if (this.simulation && this.start) this.simulation.restore(this.start);
    if (this.options.canvas.mode === 'run') this.options.canvas.setMode('build');
  }

  private schedule(): void {
    const id = requestAnimationFrame(() => this.onFrame());
    this.cancel = () => cancelAnimationFrame(id);
  }

  private onFrame(): void {
    this.cancel = undefined;
    const simulation = this.simulation;
    if (!simulation || (this.phaseNow !== 'spin-up' && this.phaseNow !== 'running')) return;
    const now = performance.now();
    let steps = 0;
    let frame: RunFrame | undefined;
    while (now >= this.nextAt && steps < MAX_STEPS_PER_FRAME) {
      frame = simulation.step();
      if (!this.draw(frame)) return;
      this.nextAt += TICK_MS;
      steps += 1;
    }
    if (now - this.nextAt > TICK_MS * MAX_STEPS_PER_FRAME) this.nextAt = now + TICK_MS;
    if (frame) this.set('running', frame);
    this.schedule();
  }

  /** Hands a frame to the canvas. A canvas that cannot draw it ends the Run with a plain line, never a dialog. */
  private draw(frame: RunFrame): boolean {
    try {
      this.options.canvas.applyRunFrame(frame);
      this.lastFrame = frame;
      return true;
    } catch (error) {
      this.fail('This Run could not be drawn.', error);
      return false;
    }
  }

  private fail(problem: string, error: unknown): void {
    console.warn(problem, error);
    this.halt();
    this.lastFrame = undefined;
    this.set('failed', undefined, problem);
  }

  private set(phase: RunPhase, frame: RunFrame | undefined, problem?: string): void {
    this.phaseNow = phase;
    this.options.onChange(phase, frame, problem);
  }
}

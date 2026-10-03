// The hint ladder at work (brief Sections 5, 10 and 12; task 4.6): pulse the part → pulse the port → ghost wire → do it
// for me, each step a tap on the one button beside the goal. Framework-free; the button (hint-button.tsx) drives it.
// - Which ladder: the challenge's first ladder whose trigger holds for the build on the canvas and the last Run's faults
//   (ladder.ts). The same ladder about the same part keeps its place; another one starts at its first step.
// - Drawn rungs go to `canvas.showHint`, narrowed to the part the trigger found. A rung the canvas cannot draw (nothing
//   matches it) is passed over for the next one. The canvas draws it above everything and clear of every port, hides it
//   in Run mode and shows it again on Stop.
// - Do-it is one `batch` through `canvas.apply`, so it is one Undo step, the list view and Save hear it, and the wire
//   is one the schema's rules allow. Its line says what it did.
// - After two Runs in a row that miss the goal, the ladder offers its next drawn rung itself and the button pulses
//   gently. An offer never does do-it: only a tap changes the build. A Run that meets the goal clears the ladder.
// - Runs are judged as they play by the challenge's GoalWatch over the run loop's frames: the judge the goal line, the
//   Run bar's recorder (`judgeRun`) and `pnpm golden` use, so a missed Run here is a record with `goal.met` false.
// No dialogs (ground rule 9). Every step used goes to the HintLog for the run record.
import type { CanvasHandle, DrawnHintStep } from '@servo/canvas';
import type { Catalogue, Challenge, HintStep, HintStepKind, PlacedPartId, RunEvent, Text, Timestamp } from '@servo/schema';
import { GoalWatch } from '../challenges/goal.ts';
import { runKeyOf } from '../run-bar/run-loop.ts';
import type { RunListener, RunLoop } from '../run-bar/run-loop.ts';
import { chooseLadder, doItCommand, narrowStep, partOfStep } from './ladder.ts';
import type { LadderChoice, RunFault } from './ladder.ts';
import type { HintLog } from './log.ts';

/** Runs in a row that miss the goal before the ladder offers a rung (brief Section 5). */
export const MISSED_RUNS_BEFORE_OFFER = 2;

/** What the canvas does for the ladder: the handle's own methods. */
export type HintCanvas = Pick<CanvasHandle, 'mode' | 'blueprint' | 'showHint' | 'clearHints' | 'apply'>;

export interface HintState {
  /** A tap would draw a rung or do the last step. */
  readonly available: boolean;
  /** The ladder offered a rung after two missed Runs: the button pulses until it is tapped. */
  readonly offered: boolean;
  /** The step shown or done last, with its line: the text twin read aloud. */
  readonly shown: { readonly step: HintStepKind; readonly line: Text } | undefined;
  /** Do-it's line, saying what it did, until the build changes again or a Run starts. */
  readonly said: Text | undefined;
}

export const NO_HINT: HintState = { available: false, offered: false, shown: undefined, said: undefined };

export interface HintLadderOptions {
  readonly canvas: HintCanvas;
  readonly catalogue: Catalogue;
  readonly challenge: Challenge;
  readonly log: HintLog;
  /** The Run bar's run loop, whose Runs are judged. None, and no Run ever offers a rung. */
  readonly loop?: RunLoop | null;
  /** Wall-clock times for the hint uses, as toISOString writes them. */
  readonly now?: () => Timestamp;
}

/** Where the child is on one ladder about one part. */
interface Place {
  readonly key: string;
  /** The next step to show or do. */
  next: number;
  /** The build do-it left, by run key: the ladder is done until the build is changed again. */
  doneOn: string | undefined;
}

const isDrawn = (step: HintStep): step is DrawnHintStep => step.step !== 'do-it';

export class HintLadderController {
  private readonly options: HintLadderOptions;
  private readonly listeners = new Set<(state: HintState) => void>();
  private readonly unlisten: () => void;
  private stateNow: HintState = NO_HINT;
  private choice: LadderChoice | undefined;
  private place: Place | undefined;
  private drawn = false;
  private offered = false;
  private shown: HintState['shown'];
  private said: { readonly line: Text; readonly on: string } | undefined;
  /** Runs in a row that missed the goal since the last step shown. */
  private missed = 0;
  /** The faults the last Run showed. */
  private faults: readonly RunFault[] = [];
  private disposed = false;

  constructor(options: HintLadderOptions) {
    this.options = options;
    this.unlisten = options.loop ? options.loop.subscribe(this.judge()) : () => undefined;
    this.sync();
  }

  get state(): HintState {
    return this.stateNow;
  }

  /** Called with every change of state. Returns the unsubscribe function. */
  subscribe(listener: (state: HintState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A tap on the hint button: the next step. False when there was nothing to show or do (in Run mode, for one). */
  ask(): boolean {
    return this.step('asked');
  }

  /** The build on the canvas changed: by an edit, Undo or a load. */
  buildChanged(): void {
    this.sync();
  }

  /** The ladder goes with its challenge: its rung is cleared. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlisten();
    try {
      this.clearDrawn();
    } catch {
      // The canvas is gone already: the shell destroys it as the app closes, and its rung went with it.
    }
    this.listeners.clear();
  }

  /** Watches each Run as it plays: its faults, and whether it met the goal by the time it stopped. */
  private judge(): RunListener {
    let watch: GoalWatch | undefined;
    let last = -1;
    let stepped = false;
    let faults = new Map<string, RunFault>();
    return (state, frame) => {
      if (this.disposed) return;
      if (!frame) {
        if (state.phase === 'build' && stepped && watch) this.ended(watch.verdict.met, [...faults.values()]);
        if (state.phase !== 'spin-up' && state.phase !== 'running') {
          stepped = false;
          watch = undefined;
        }
        if (state.phase === 'loading' || state.phase === 'spin-up') this.runStarts();
        return;
      }
      if (!watch || frame.tick === 0 || frame.tick <= last) {
        const build = this.options.canvas.blueprint;
        if (!build) return;
        watch = new GoalWatch({ challenge: this.options.challenge, blueprint: build, catalogue: this.options.catalogue });
        faults = new Map();
        stepped = false;
      }
      last = frame.tick;
      if (frame.tick > 0) stepped = true;
      watch.push(frame.tick, frame.events);
      for (const event of frame.events) noteFault(faults, event);
    };
  }

  private runStarts(): void {
    if (!this.said) return;
    this.said = undefined;
    this.emit();
  }

  private ended(met: boolean, faults: readonly RunFault[]): void {
    this.faults = faults;
    if (met) {
      this.missed = 0;
      this.offered = false;
      this.shown = undefined;
      this.clearDrawn();
      this.place = undefined;
      this.sync();
      return;
    }
    this.missed += 1;
    this.sync();
    if (this.missed >= MISSED_RUNS_BEFORE_OFFER && !this.step('offered') && this.stateNow.available) {
      // Only do-it is left: the button pulses, and the child decides.
      this.offered = true;
      this.missed = 0;
      this.emit();
    }
  }

  /** Shows or does the next step. An offer only ever draws. */
  private step(by: 'asked' | 'offered'): boolean {
    const { canvas } = this.options;
    if (this.disposed || canvas.mode !== 'build') return false;
    this.sync();
    const choice = this.choice;
    const place = this.place;
    const blueprint = canvas.blueprint;
    if (!choice || !place || !blueprint) return false;
    const steps = choice.ladder.steps;
    for (let index = place.next; index < steps.length; index += 1) {
      const step = narrowStep(steps[index] as HintStep, blueprint, choice.part);
      const part = partOfStep(step, choice.part);
      if (isDrawn(step)) {
        if (!canvas.showHint(step)) continue;
        this.drawn = true;
        place.next = index + 1;
        this.used(step.step, by, part);
        this.shown = { step: step.step, line: step.line };
        this.offered = by === 'offered';
        this.missed = 0;
        this.emit();
        return true;
      }
      if (by === 'offered') return false;
      const doIt = doItCommand(step.changes, blueprint, this.options.catalogue);
      if (!doIt.ok) {
        console.warn('The last hint step does not fit this build.', doIt.reason);
        return false;
      }
      this.clearDrawn();
      const applied = canvas.apply(doIt.command);
      if (!applied.ok) {
        console.warn('The last hint step could not be applied.', applied.refusal.message);
        this.sync();
        return false;
      }
      // The canvas's edit may already have moved the build onto another ladder (this one's trigger no longer holds).
      // A ladder still in place is done until the build changes again.
      this.sync();
      const on = runKeyOf(applied.blueprint);
      if (this.place === place) {
        place.next = steps.length;
        place.doneOn = on;
      }
      this.used('do-it', by, part);
      this.shown = { step: 'do-it', line: step.line };
      this.said = { line: step.line, on };
      this.offered = false;
      this.missed = 0;
      this.emit();
      return true;
    }
    return false;
  }

  private used(step: HintStepKind, trigger: 'asked' | 'offered', partId: PlacedPartId | undefined): void {
    const at = (this.options.now ?? (() => new Date().toISOString()))();
    this.options.log.add(partId === undefined ? { at, step, trigger } : { at, step, trigger, partId });
  }

  /** Re-reads which ladder applies to the build now, and what a tap would do. */
  private sync(): void {
    if (this.disposed) return;
    const blueprint = this.options.canvas.blueprint;
    const choice = blueprint ? chooseLadder(this.options.challenge, blueprint, this.faults) : undefined;
    const key = blueprint ? runKeyOf(blueprint) : '';
    this.choice = choice;
    if (choice?.key !== this.place?.key) {
      this.clearDrawn();
      this.shown = undefined;
      this.offered = false;
      this.place = choice ? { key: choice.key, next: 0, doneOn: undefined } : undefined;
    }
    if (this.place?.doneOn !== undefined && this.place.doneOn !== key) {
      this.place.next = 0;
      this.place.doneOn = undefined;
    }
    if (this.said && this.said.on !== key) this.said = undefined;
    this.emit();
  }

  /** True when a tap could show or do something on the build as it is. */
  private available(): boolean {
    const blueprint = this.options.canvas.blueprint;
    const choice = this.choice;
    const place = this.place;
    if (!blueprint || !choice || !place) return false;
    const rest = choice.ladder.steps.slice(place.next);
    if (rest.some(isDrawn)) return true;
    const last = rest.at(-1);
    if (!last) return false;
    const narrowed = narrowStep(last, blueprint, choice.part);
    return narrowed.step === 'do-it' && doItCommand(narrowed.changes, blueprint, this.options.catalogue).ok;
  }

  private clearDrawn(): void {
    if (!this.drawn) return;
    this.drawn = false;
    this.options.canvas.clearHints();
  }

  private emit(): void {
    if (this.disposed) return;
    const next: HintState = {
      available: this.available(),
      offered: this.offered,
      shown: this.shown,
      said: this.said?.line,
    };
    const now = this.stateNow;
    if (next.available === now.available && next.offered === now.offered && next.shown === now.shown && next.said === now.said) return;
    this.stateNow = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}

/** Keeps each fault that starts on a placed part (props have none the ladder can name). */
const noteFault = (faults: Map<string, RunFault>, event: RunEvent): void => {
  if (event.kind !== 'fault' || !event.payload.active || event.partId.startsWith('arena:')) return;
  const key = `${event.partId} ${event.payload.failure}`;
  if (!faults.has(key)) faults.set(key, { partId: event.partId, failure: event.payload.failure });
};

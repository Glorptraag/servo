// Keeping each Run (docs/run-loop.md, "Stop"): as Run is pressed the recorder numbers the Run among the child's Runs of
// this build in the sandbox and finds the one before it (which gives the record's `fixed`, D31); as the Run ends, before
// the Simulation is restored, it takes the run record and adds it to the child's store. A store that cannot read or
// keep Runs is a console warning, never a dialog, and never stops a Run. The challenge's verdict (task 4.5) and the
// hint steps used (task 4.6) join the record when those tasks land.
import type { Blueprint, RunId, RunRecord, Timestamp } from '@servo/schema';
import type { Simulation } from '@servo/sim-core';
import type { ProfileStore } from '../store/index.ts';
import { uuidV4 } from '../store/uuid.ts';

export interface RunRecorderOptions {
  /** The child whose Runs are kept, as it is when Run is pressed. Null keeps nothing. */
  readonly child: () => ProfileStore | null;
  /** Wall-clock times, as toISOString writes them. */
  readonly now?: () => Timestamp;
  readonly newId?: () => RunId;
}

interface Pressed {
  readonly child: ProfileStore;
  readonly startedAt: Timestamp;
  readonly runNumber: number;
  readonly previous: RunRecord | undefined;
}

export class RunRecorder {
  private readonly options: RunRecorderOptions;
  private pressed: Pressed | undefined;
  private keeping: Promise<void> = Promise.resolve();

  constructor(options: RunRecorderOptions) {
    this.options = options;
  }

  private now(): Timestamp {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  /** Run was pressed for `blueprint`. Waits for the last Run to be kept, so the count includes it. Never rejects. */
  async start(blueprint: Blueprint): Promise<void> {
    this.pressed = undefined;
    const child = this.options.child();
    if (!child) return;
    const startedAt = this.now();
    await this.keeping;
    try {
      const runs = await child.runs.list({ blueprintId: blueprint.meta.id, challenge: null });
      this.pressed = { child, startedAt, runNumber: runs.length + 1, previous: runs.at(-1) };
    } catch (error) {
      console.warn('The earlier Runs of this build could not be read, so this Run is not kept.', error);
    }
  }

  /** The Run ends: its record goes to the child's store. Call before the Simulation is restored. */
  end(simulation: Simulation): void {
    const pressed = this.pressed;
    this.pressed = undefined;
    if (!pressed) return;
    let record: RunRecord;
    try {
      record = simulation.record({
        id: (this.options.newId ?? uuidV4)(),
        startedAt: pressed.startedAt,
        endedAt: this.now(),
        runNumber: pressed.runNumber,
        profile: pressed.child.profile,
        hints: [],
        ...(pressed.previous ? { previous: pressed.previous } : {}),
      });
    } catch (error) {
      console.warn('This Run could not be recorded.', error);
      return;
    }
    this.keeping = pressed.child.runs.add(record).catch((error: unknown) => {
      console.warn('This Run could not be kept on this device.', error);
    });
  }

  /** Resolves once every Run ended so far is kept, or has failed to be. */
  settled(): Promise<void> {
    return this.keeping;
  }
}

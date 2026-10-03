// Keeping each Run (docs/run-loop.md, "Stop"). The store is never on a Run's path: pressing Run only notes the time.
// The build's earlier Runs are read in the background as the build comes onto the canvas (`prepare`). As a Run that stepped at
// least once ends, before the Simulation is restored, the recorder numbers it among the child's Runs of this build in
// the sandbox, links the Run before it (which gives the record's `fixed`, D31), takes the run record and adds it to the
// child's store in the background. A Run stopped in its spin-up showed nothing, so it is not kept: it would otherwise
// mark every fault of the Run before as fixed (review R-4.4, finding 1). A store that has not answered by the time a
// Run ends, or that cannot keep Runs, is a console warning, never a dialog, and never delays or stops a Run. The
// challenge's verdict (task 4.5) and the hint steps used (task 4.6) join the record when those tasks land.
import type { Blueprint, BlueprintId, RunId, RunRecord, Timestamp } from '@servo/schema';
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
  readonly blueprintId: BlueprintId;
  readonly key: string;
  readonly startedAt: Timestamp;
}

/** What the recorder knows of one child's Runs of one build: how many there are, and the latest. */
interface Known {
  count: number;
  last: RunRecord | undefined;
}

const keyOf = (child: ProfileStore, blueprintId: BlueprintId): string => `${child.profile} ${blueprintId}`;

export class RunRecorder {
  private readonly options: RunRecorderOptions;
  private pressed: Pressed | undefined;
  private readonly known = new Map<string, Known>();
  private readonly reading = new Set<string>();
  private keeping: Promise<void> = Promise.resolve();

  constructor(options: RunRecorderOptions) {
    this.options = options;
  }

  private now(): Timestamp {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  /**
   * Starts reading the build's earlier Runs in the background, once per build, so they are known before its first Run
   * ends. The Run bar calls it as a build comes onto the canvas; Run calls it too.
   */
  prepare(blueprint: Blueprint): void {
    const child = this.options.child();
    if (child) this.read(child, blueprint.meta.id);
  }

  private read(child: ProfileStore, blueprintId: BlueprintId): void {
    const key = keyOf(child, blueprintId);
    if (this.known.has(key) || this.reading.has(key)) return;
    this.reading.add(key);
    const read = this.keeping
      .then(() => child.runs.list({ blueprintId, challenge: null }))
      .then((runs) => {
        if (!this.known.has(key)) this.known.set(key, { count: runs.length, last: runs.at(-1) });
      })
      .catch((error: unknown) => {
        console.warn('The earlier Runs of this build could not be read.', error);
      })
      .finally(() => this.reading.delete(key));
    this.keeping = read;
  }

  /** Run was pressed for `blueprint`. Returns at once: the store is never on a Run's path. */
  start(blueprint: Blueprint): void {
    this.pressed = undefined;
    const child = this.options.child();
    if (!child) return;
    this.pressed = { child, blueprintId: blueprint.meta.id, key: keyOf(child, blueprint.meta.id), startedAt: this.now() };
    this.read(child, blueprint.meta.id);
  }

  /** The Run ends: its record goes to the child's store in the background. Call before the Simulation is restored. */
  end(simulation: Simulation): void {
    const pressed = this.pressed;
    this.pressed = undefined;
    if (!pressed || simulation.tick === 0) return;
    const known = this.known.get(pressed.key);
    if (!known) {
      console.warn('The earlier Runs of this build were not read in time, so this Run is not kept.');
      return;
    }
    let record: RunRecord;
    try {
      record = simulation.record({
        id: (this.options.newId ?? uuidV4)(),
        startedAt: pressed.startedAt,
        endedAt: this.now(),
        runNumber: known.count + 1,
        profile: pressed.child.profile,
        hints: [],
        ...(known.last ? { previous: known.last } : {}),
      });
    } catch (error) {
      console.warn('This Run could not be recorded.', error);
      return;
    }
    known.count += 1;
    known.last = record;
    const { child, blueprintId, key } = pressed;
    this.keeping = this.keeping
      .then(() => child.runs.add(record))
      .catch((error: unknown) => {
        // What the store holds is no longer what the recorder counted: read it again.
        console.warn('This Run could not be kept on this device.', error);
        this.known.delete(key);
        this.read(child, blueprintId);
      });
  }

  /** Resolves once every read and every Run ended so far is kept, or has failed to be. */
  async settled(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.keeping;
      await seen;
    } while (seen !== this.keeping);
  }
}

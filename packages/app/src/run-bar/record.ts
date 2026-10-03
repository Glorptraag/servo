// Keeping each Run (docs/run-loop.md, "Stop"). The store is never on a Run's path: pressing Run only notes the time.
// The build's earlier Runs are read in the background as the build comes onto the canvas (`prepare`). As a Run that stepped at
// least once ends, before the Simulation is restored, the recorder numbers it among the child's Runs of this build in
// the sandbox, links the Run before it (which gives the record's `fixed`, D31), takes the run record and adds it to the
// child's store in the background. A Run stopped in its spin-up showed nothing, so it is not kept: it would otherwise
// mark every fault of the Run before as fixed (review R-4.4, finding 1). A store that has not answered by the time a
// Run ends, or that cannot keep Runs, is a console warning, never a dialog, and never delays or stops a Run.
// A Run made under a challenge (task 4.5) is numbered among the child's Runs of that challenge and linked to the last of
// them, as the schema says, and keeps the challenge's id and the goal judge's verdict (`goal`), judged from its own
// record by the same judge as the goal line and `pnpm golden`. A sandbox Run keeps neither. The hint steps used
// (task 4.6) join the record when that task lands.
import type { Blueprint, BlueprintId, Catalogue, Challenge, RunId, RunRecord, Timestamp } from '@servo/schema';
import type { Simulation } from '@servo/sim-core';
import { judgeRun } from '../challenges/goal.ts';
import type { ProfileStore } from '../store/index.ts';
import { uuidV4 } from '../store/uuid.ts';

export interface RunRecorderOptions {
  /** The child whose Runs are kept, as it is when Run is pressed. Null keeps nothing. */
  readonly child: () => ProfileStore | null;
  /** Wall-clock times, as toISOString writes them. */
  readonly now?: () => Timestamp;
  readonly newId?: () => RunId;
  /** The challenge on the canvas as Run is pressed, or null in the sandbox. Default none. */
  readonly challenge?: () => Challenge | null;
  /** The part records and arena presets a challenge Run is judged with. Needed with `challenge`. */
  readonly catalogue?: Catalogue;
}

/** Whose Runs a Run counts among: the build's in the sandbox, or the challenge's. */
type Series = { readonly blueprintId: BlueprintId; readonly challenge?: undefined } | { readonly blueprintId: BlueprintId; readonly challenge: Challenge };

interface Pressed {
  readonly child: ProfileStore;
  readonly series: Series;
  readonly key: string;
  readonly startedAt: Timestamp;
}

/** What the recorder knows of one child's Runs of one build or challenge: how many there are, and the latest. */
interface Known {
  count: number;
  last: RunRecord | undefined;
}

const keyOf = (child: ProfileStore, series: Series): string =>
  series.challenge ? `${child.profile} challenge ${series.challenge.id}` : `${child.profile} build ${series.blueprintId}`;

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
    if (child) this.read(child, this.seriesOf(blueprint));
  }

  private seriesOf(blueprint: Blueprint): Series {
    const challenge = this.options.challenge?.() ?? null;
    return challenge ? { blueprintId: blueprint.meta.id, challenge } : { blueprintId: blueprint.meta.id };
  }

  private read(child: ProfileStore, series: Series): void {
    const key = keyOf(child, series);
    if (this.known.has(key) || this.reading.has(key)) return;
    this.reading.add(key);
    const filter = series.challenge ? { challenge: series.challenge.id } : { blueprintId: series.blueprintId, challenge: null };
    const read = this.keeping
      .then(() => child.runs.list(filter))
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
    const series = this.seriesOf(blueprint);
    this.pressed = { child, series, key: keyOf(child, series), startedAt: this.now() };
    this.read(child, series);
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
      const context = {
        id: (this.options.newId ?? uuidV4)(),
        startedAt: pressed.startedAt,
        endedAt: this.now(),
        runNumber: known.count + 1,
        profile: pressed.child.profile,
        hints: [],
        ...(known.last ? { previous: known.last } : {}),
      };
      record = simulation.record(context);
      const { challenge } = pressed.series;
      if (challenge) {
        if (!this.options.catalogue) throw new Error('A challenge Run needs the catalogue to be judged.');
        const goal = judgeRun(challenge, record, this.options.catalogue);
        record = simulation.record({ ...context, challenge: challenge.id, goal });
      }
    } catch (error) {
      console.warn('This Run could not be recorded.', error);
      return;
    }
    known.count += 1;
    known.last = record;
    const { child, series, key } = pressed;
    this.keeping = this.keeping
      .then(() => child.runs.add(record))
      .catch((error: unknown) => {
        // What the store holds is no longer what the recorder counted: read it again.
        console.warn('This Run could not be kept on this device.', error);
        this.known.delete(key);
        this.read(child, series);
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

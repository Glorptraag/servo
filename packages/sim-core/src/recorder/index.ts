// The run recorder (task 1.5): a Run's logs and the app's context as the schema's RunRecord. See docs/runs.md.
import { TICK_RATE } from '@servo/schema';
import type { Blueprint, FaultSeen, RunEvent, RunInput, RunRecord } from '@servo/schema';
import type { RunRecordContext } from '../interface.ts';
import { fixedFaults } from './changes.ts';

export { buildChanges, fixedFaults } from './changes.ts';

/** What sim-core knows about a Run when it is recorded. */
export interface RunLog {
  /** The canonical blueprint snapshot that ran. */
  readonly blueprint: Blueprint;
  readonly seed: number;
  /** The last tick simulated: 0 before the first step. */
  readonly ticks: number;
  /** The child's switch flips, in tick order. */
  readonly inputs: readonly RunInput[];
  /** Every event from tick 0, in tick order and each tick's fixed order. */
  readonly events: readonly RunEvent[];
  /** Each fault that started, once, at its first tick. */
  readonly faults: readonly FaultSeen[];
}

/**
 * The schema's RunRecord of a Run so far: the blueprint snapshot and its id, the seed, `tickRate`, `ticks`, the inputs,
 * the events (left out when `context.events` is 'drop'), the faults and `fixed` from sim-core; the id, the wall-clock
 * times, `runNumber`, profile, challenge, goal and hints from the app, as given. Lists are copies; events and the
 * blueprint are frozen, so the record can share them.
 */
export const runRecordOf = (log: RunLog, context: RunRecordContext): RunRecord => ({
  version: 1,
  id: context.id,
  blueprintId: log.blueprint.meta.id,
  blueprint: log.blueprint,
  ...(context.challenge === undefined ? {} : { challenge: context.challenge }),
  ...(context.profile === undefined ? {} : { profile: context.profile }),
  seed: log.seed,
  tickRate: TICK_RATE,
  startedAt: context.startedAt,
  endedAt: context.endedAt,
  runNumber: context.runNumber,
  ticks: log.ticks,
  inputs: [...log.inputs],
  ...(context.events === 'drop' ? {} : { events: [...log.events] }),
  faults: [...log.faults],
  fixed: fixedFaults(context.previous, log.faults, log.blueprint),
  ...(context.goal === undefined ? {} : { goal: { met: context.goal.met, ...(context.goal.tick === undefined ? {} : { tick: context.goal.tick }) } }),
  hints: [...context.hints],
});

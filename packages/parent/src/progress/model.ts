// The progress read model (task 5.2): one child's figures, derived from their run records and card-game rounds every
// time the parent view opens. Pure: no store, no clock, no DOM. Every figure points back at the records it came from
// (run ids and times), so it can be checked against them. See ../../README.md, "The progress view".
import type { CardGameResult, Content } from '@servo/app/store';
import type { Blueprint, ChallengeId, FailureModeId, PlacedPartId, RunRecord, Wire } from '@servo/schema';
import type { FaultFixed, PartMet, Progress, ProgressInput, UnscriptedPass } from '../index.ts';

/**
 * The Runs progress counts: those that stepped at least once, oldest first by `startedAt`, keeping the given order for
 * equal times. The app keeps no Run stopped before tick 1 (task 4.4), but an older store may hold one, and it showed
 * nothing.
 */
export const countedRuns = (runs: readonly RunRecord[]): readonly RunRecord[] =>
  runs
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.ticks >= 1)
    .sort((a, b) => (a.run.startedAt < b.run.startedAt ? -1 : a.run.startedAt > b.run.startedAt ? 1 : a.index - b.index))
    .map(({ run }) => run);

/**
 * The Runs one Run is counted among, as the app numbers them (`runNumber`) and links them for `fixed`: a challenge's
 * Runs, or one build's Runs in the sandbox.
 */
export const seriesOf = (run: RunRecord): string => (run.challenge ? `challenge ${run.challenge}` : `build ${run.blueprintId}`);

const portKey = (part: PlacedPartId, port: string): string => `${part} ${port}`;

/** A wire as the two ports it joins, either way round, as sim-core compares them. */
const wireKey = (wire: Wire): string => [portKey(wire.from.part, wire.from.port), portKey(wire.to.part, wire.to.port)].sort().join('|');

const wiresOn = (blueprint: Blueprint, part: PlacedPartId): ReadonlySet<string> =>
  new Set(blueprint.wires.filter((wire) => wire.from.part === part || wire.to.part === part).map(wireKey));

/**
 * Whether `after` differs from `before` on one placed part (D75, D76): the part added, removed or of another type, a
 * setting of it changed, or a wire on one of its ports added or removed. Moving it is no change; mounting it is a wire.
 * The same reading as sim-core's `fixed` (packages/sim-core/src/recorder/changes.ts), so the two agree on every pair.
 */
export const differsOn = (before: Blueprint, after: Blueprint, part: PlacedPartId): boolean => {
  const was = before.parts.find((placed) => placed.id === part);
  const now = after.parts.find((placed) => placed.id === part);
  if (!was || !now) return was !== now;
  if (was.part !== now.part) return true;
  const settings = new Set([...Object.keys(was.settings), ...Object.keys(now.settings)]);
  for (const setting of settings) {
    const prior = Object.hasOwn(was.settings, setting) ? was.settings[setting] : undefined;
    const value = Object.hasOwn(now.settings, setting) ? now.settings[setting] : undefined;
    if (prior !== value) return true;
  }
  const wiresBefore = wiresOn(before, part);
  const wiresAfter = wiresOn(after, part);
  return wiresBefore.size !== wiresAfter.size || [...wiresBefore].some((key) => !wiresAfter.has(key));
};

const partsMetIn = (runs: readonly RunRecord[]): readonly PartMet[] => {
  const met = new Map<string, PartMet>();
  for (const run of runs) {
    for (const part of [...new Set(run.blueprint.parts.map((placed) => placed.part))].sort()) {
      if (!met.has(part)) met.set(part, { part, firstRun: run.id, at: run.startedAt });
    }
  }
  return [...met.values()];
};

const unscriptedPassesIn = (runs: readonly RunRecord[], content: Content): readonly UnscriptedPass[] => {
  const unscripted = new Set<ChallengeId>(content.challenges.filter((challenge) => challenge.kind === 'unscripted-build').map((challenge) => challenge.id));
  const passed = new Map<ChallengeId, UnscriptedPass>();
  for (const run of runs) {
    if (!run.challenge || !unscripted.has(run.challenge) || run.goal?.met !== true || passed.has(run.challenge)) continue;
    passed.set(run.challenge, { challenge: run.challenge, run: run.id, runNumber: run.runNumber, at: run.startedAt });
  }
  return [...passed.values()];
};

/** A fault on one placed part, shown by one or more Runs of a series and not yet fixed or gone. */
interface Open {
  readonly partId: PlacedPartId;
  readonly failure: FailureModeId;
  /** The first Run that showed it: time-to-fix starts here. */
  readonly first: RunRecord;
  /** Its place among the series' counted Runs. */
  readonly firstIndex: number;
  /** The latest Run that showed it: a fix is a change from this build. */
  last: RunRecord;
  /** The tick it showed at in `last`: a later Run must pass it without the fault (D96). */
  tick: number;
}

/**
 * Faults fixed (D31, with the defaults of D75, D76 and D96). In each series, a fault (a failure mode on a placed part)
 * stays open from the first Run that shows it. The first later Run that passes the tick it showed at in the latest Run
 * that showed it (`ticks` past `firstTick`), without showing it, settles it: the fault is fixed when that Run's build
 * differs from the latest showing Run's build on the faulted part, its ports or its wires, and otherwise it went with no
 * fix and is not counted. A Run that stopped before that tick settles nothing. A Run that shows the fault again keeps it
 * open, from its own build and tick. Once settled, a later showing is a new fault.
 */
const faultsFixedIn = (runs: readonly RunRecord[]): readonly FaultFixed[] => {
  const fixed: FaultFixed[] = [];
  const bySeries = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const series = bySeries.get(seriesOf(run)) ?? [];
    series.push(run);
    bySeries.set(seriesOf(run), series);
  }
  for (const series of bySeries.values()) {
    const open = new Map<string, Open>();
    series.forEach((run, index) => {
      const shown = new Map(run.faults.map((fault) => [`${fault.partId} ${fault.failure}`, fault]));
      for (const [key, fault] of open) {
        if (shown.has(key) || run.ticks <= fault.tick) continue;
        open.delete(key);
        const { partId, failure } = fault;
        if (!differsOn(fault.last.blueprint, run.blueprint, partId)) continue;
        const part = fault.last.blueprint.parts.find((placed) => placed.id === partId)?.part ?? '';
        fixed.push({
          partId,
          part,
          failure,
          firstSeen: fault.first.startedAt,
          fixedBy: run.id,
          fixedAt: run.startedAt,
          runs: index - fault.firstIndex + 1,
        });
      }
      for (const [key, seen] of shown) {
        const known = open.get(key);
        if (known) {
          known.last = run;
          known.tick = seen.firstTick;
        } else {
          open.set(key, { partId: seen.partId, failure: seen.failure, first: run, firstIndex: index, last: run, tick: seen.firstTick });
        }
      }
    });
  }
  return fixed.sort((a, b) => (a.fixedAt < b.fixedAt ? -1 : a.fixedAt > b.fixedAt ? 1 : 0));
};

/** The round that counts (D40): the one played last; of two at the same moment, the later in the list. */
const latestRound = (rounds: readonly CardGameResult[]): CardGameResult | undefined =>
  rounds.reduce<CardGameResult | undefined>((latest, round) => (!latest || round.playedAt >= latest.playedAt ? round : latest), undefined);

/** One child's progress from their records. The child's records only: the caller reads them through that child's scope. */
export const progressFrom = ({ runs, content, cardGames }: ProgressInput): Progress => {
  const counted = countedRuns(runs);
  const round = latestRound(cardGames);
  return {
    partsMet: partsMetIn(counted),
    unscriptedBuildsPassed: unscriptedPassesIn(counted, content),
    faultsFixed: faultsFixedIn(counted),
    // Time in the sandbox is absent until task 6.2's telemetry exists (D39).
    ...(round
      ? { partsNamed: { named: round.cards.filter((card) => card.named).length, of: round.cards.length, playedAt: round.playedAt } }
      : {}),
  };
};

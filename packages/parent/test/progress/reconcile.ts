// Checks a Progress against the run records it was read from, figure by figure, without the model's own code: every
// figure must point at records that bear it out, and every fact the records state must be in the figures.
import { expect } from 'vitest';
import type { Content } from '@servo/app/store';
import type { RunRecord } from '@servo/schema';
import type { Progress } from '../../src/index.ts';

const seriesOf = (run: RunRecord): string => (run.challenge ? `challenge ${run.challenge}` : `build ${run.blueprintId}`);
const shows = (run: RunRecord, partId: string, failure: string) => run.faults.find((fault) => fault.partId === partId && fault.failure === failure);

/** `fromSim`: the records came from sim-core, so each one's `fixed` is sim-core's own, which is then checked too. */
export const reconcile = (runs: readonly RunRecord[], content: Content, progress: Progress, fromSim = true): void => {
  const counted = runs.filter((run) => run.ticks >= 1);
  const byId = new Map(counted.map((run) => [run.id, run]));

  // Parts met: exactly the part types of the counted Runs' blueprints, each from the first Run that had it.
  const types = new Set(counted.flatMap((run) => run.blueprint.parts.map((part) => part.part)));
  expect(new Set(progress.partsMet.map((met) => met.part))).toEqual(types);
  expect(progress.partsMet).toHaveLength(types.size);
  for (const met of progress.partsMet) {
    const first = counted.find((run) => run.blueprint.parts.some((part) => part.part === met.part));
    expect(met.firstRun).toBe(first?.id);
    expect(met.at).toBe(first?.startedAt);
  }

  // Unscripted builds passed: one per unscripted challenge with a met Run, the first such Run, with its own runNumber.
  const unscripted = new Set(content.challenges.filter((challenge) => challenge.kind === 'unscripted-build').map((challenge) => challenge.id));
  const passing = counted.filter((run) => run.challenge !== undefined && unscripted.has(run.challenge) && run.goal?.met === true);
  expect(new Set(progress.unscriptedBuildsPassed.map((pass) => pass.challenge))).toEqual(new Set(passing.map((run) => run.challenge)));
  for (const pass of progress.unscriptedBuildsPassed) {
    const first = passing.find((run) => run.challenge === pass.challenge);
    expect(pass).toEqual({ challenge: pass.challenge, run: first?.id, runNumber: first?.runNumber, at: first?.startedAt });
  }

  // Faults fixed: each one shown by an earlier Run of the same series, then run past without it by the fixing Run.
  for (const fault of progress.faultsFixed) {
    const fixing = byId.get(fault.fixedBy);
    if (!fixing) throw new Error(`fixedBy ${fault.fixedBy} is not a counted Run`);
    const series = counted.filter((run) => seriesOf(run) === seriesOf(fixing));
    const at = series.indexOf(fixing);
    const showing = series.slice(0, at).filter((run) => shows(run, fault.partId, fault.failure));
    const last = showing.at(-1);
    if (!last) throw new Error(`no earlier Run showed ${fault.partId} ${fault.failure}`);
    expect(shows(fixing, fault.partId, fault.failure)).toBeUndefined();
    expect(fixing.ticks).toBeGreaterThan(shows(last, fault.partId, fault.failure)?.firstTick ?? Infinity);
    expect(fault.fixedAt).toBe(fixing.startedAt);
    expect(fault.part).toBe(last.blueprint.parts.find((part) => part.id === fault.partId)?.part);
    const first = series.find((run) => run.startedAt === fault.firstSeen && shows(run, fault.partId, fault.failure));
    expect(first).toBeDefined();
    expect(fault.runs).toBe(at - series.indexOf(first as RunRecord) + 1);
    // When the Run before it showed the fault, sim-core's own `fixed` lists it, with changes to the part (D31, D75).
    if (fromSim && series[at - 1] === last) {
      const listed = fixing.fixed.find((entry) => entry.partId === fault.partId && entry.failure === fault.failure);
      expect(listed?.changes.length ?? 0).toBeGreaterThan(0);
    }
  }

  // And every fix the records state between two Runs in a row is counted: listed in `fixed` with a change to the part,
  // and run past the tick it showed at.
  for (const [index, run] of counted.entries()) {
    const previous = counted.slice(0, index).filter((candidate) => seriesOf(candidate) === seriesOf(run)).at(-1);
    if (!previous) continue;
    for (const entry of run.fixed) {
      const seen = shows(previous, entry.partId, entry.failure);
      if (!seen || entry.changes.length === 0 || run.ticks <= seen.firstTick) continue;
      expect(progress.faultsFixed).toContainEqual(expect.objectContaining({ fixedBy: run.id, partId: entry.partId, failure: entry.failure }));
    }
  }
};

// Task 5.2's acceptance: the figures reconcile to the run records for all fixtures. Every content fixture is run through
// sim-core as the app records it, alone and then followed by a Run with each faulted part taken out (a change to that
// part, D75), and the schema's run-record fixture is read as stored. The checker (reconcile.ts) holds each figure up
// against the records, and sim-core's own `fixed` against the faults counted fixed.
import { describe, expect, it } from 'vitest';
import { validateBlueprint } from '@servo/schema';
import type { RunRecord } from '@servo/schema';
import { exampleRunRecords } from '@servo/schema/fixtures';
import { progressOf } from '../../src/index.ts';
import { differsOn } from '../../src/progress/index.ts';
import { reconcile } from './reconcile.ts';
import { content, fixtures, planOf, runAll, shipped, without } from './runs.ts';

const SLOW = 600_000;

/** The faulted fixtures whose fix was run, so the last test can say fixes were tried at all. */
const fixesRun: string[] = [];

describe('figures reconcile to the run records of every fixture', () => {
  it('has fixtures to run', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(19);
  });

  for (const spec of fixtures) {
    it(`${spec.name}: alone, then with each faulted part taken out`, async () => {
      const [first] = await runAll([planOf(spec)]);
      if (!first) throw new Error('no record');
      // The Run shows what the fixture says, so the records here are the fixture's.
      expect(new Set(first.faults.map((fault) => `${fault.partId} ${fault.failure}`))).toEqual(
        new Set(spec.expect.faults.map((fault) => `${fault.partId} ${fault.failure}`)),
      );
      const alone = progressOf({ runs: [first], content, cardGames: [] });
      reconcile([first], content, alone);
      expect(alone.faultsFixed).toEqual([]);

      for (const fault of first.faults) {
        const fixedBuild = without(spec.blueprint, fault.partId);
        if (!validateBlueprint(fixedBuild, shipped.catalogue).ok) continue;
        const runs = await runAll([planOf(spec), { ...planOf(spec), blueprint: fixedBuild }]);
        fixesRun.push(`${spec.name} ${fault.partId} ${fault.failure}`);
        const progress = progressOf({ runs, content, cardGames: [] });
        reconcile(runs, content, progress);
        const [before, after] = runs as [RunRecord, RunRecord];
        expect(differsOn(before.blueprint, after.blueprint, fault.partId)).toBe(true);
        // The part is gone, so the fault is too, and the second Run ran as long as the first: fixed, in 2 Runs.
        expect(progress.faultsFixed).toContainEqual(
          expect.objectContaining({ partId: fault.partId, failure: fault.failure, fixedBy: after.id, runs: 2 }),
        );
        // sim-core and the model read a change to a part alike, for every fault of the first Run (D75, D76).
        for (const entry of after.fixed) expect(differsOn(before.blueprint, after.blueprint, entry.partId)).toBe(entry.changes.length > 0);
      }
    }, SLOW);
  }

  it('every fixture run in turn, as one child, reconciles as a whole', async () => {
    const runs = await runAll(fixtures.map(planOf), 100);
    const progress = progressOf({ runs, content, cardGames: [] });
    reconcile(runs, content, progress);
    expect(progress.partsMet.length).toBe(new Set(fixtures.flatMap((spec) => spec.blueprint.parts.map((part) => part.part))).size);
  }, SLOW);

  it('ran a fix for most faulted fixtures', () => {
    expect(fixesRun.length).toBeGreaterThanOrEqual(5);
  });

  it("the schema's stored run record: its parts are met, and a fix whose earlier Run is not here is not counted", () => {
    const record = exampleRunRecords[0]?.data as RunRecord;
    const progress = progressOf({ runs: [record], content, cardGames: [] });
    reconcile([record], content, progress);
    // Its `fixed` names a caster fix from a Run 1 this child's records do not hold: without that Run's tick the fix
    // cannot be checked against D96, so it is not counted.
    expect(record.fixed.length).toBeGreaterThan(0);
    expect(progress.faultsFixed).toEqual([]);
    // Cross and stop is unscripted, and this Run missed it.
    expect(progress.unscriptedBuildsPassed).toEqual([]);
  });
});

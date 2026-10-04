// Ground rule 8 on the content fixtures (task 3.8), one group of them per test file (parity-1 … parity-4.e2e.ts), so CI
// runs the groups as parallel shards and `pnpm e2e` runs them all. Built from an empty canvas by touch, by pointer and
// by the list view, and then edited (task 7.6: each fixture takes one tour of edits, `assignTours`), each path must
// give the same canonical blueprint as plain commands, byte for byte, and observe the same selections, switch flips
// and routes. Touch and pointer each go by drag and by tap-then-tap (click-click). A step left out or a path waiting
// fails as a difference does, unless SERVO_PARITY_STRICT=0 lets only a real difference fail. The report prints one
// line per fixture when the run ends (src/e2e/reporter.ts).
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import { benchContent, mountBench, reduceMotion } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { checkParity, fixtureGroups, passes, reportLine } from '../../src/e2e/parity.ts';
import type { InputPath } from '../../src/e2e/parity.ts';
import { discoverPaths } from '../../src/e2e/paths.ts';
import { assignTours, planFor } from '../../src/e2e/plan.ts';
import { PARITY_ANNOTATION } from '../../src/e2e/reporter.ts';

/** The parity files the fixtures are split between, by work (their plans' steps). */
export const PARITY_GROUPS = 4;

/**
 * A canvas smaller than the profile: each input waits for a drawn frame, and a software GPU (SwiftShader, as on CI)
 * draws a small canvas much faster. Each gesture is framed at the default zoom where its points fit, so forgiveness
 * radii, which are screen pixels, cover what they would for a child at the default zoom.
 */
const CANVAS = { width: 480, height: 360 };

/**
 * A guard against a hang, not a budget: on a loaded two-core machine a fixture's gestures on five paths can take
 * minutes, and a test that times out stops its paths between steps (`signal`), so none sends input into the next.
 */
const FIXTURE_TIMEOUT = 360_000;

/** Defines the parity tests for fixture group `group` (1 to PARITY_GROUPS). */
export const parityTests = (group: number): void => {
  const { fixtures, issues } = loadFixtures();
  const { catalogue } = benchContent();
  const tours = inject('parityAllTours') ? undefined : assignTours(fixtures, catalogue);
  const planned = fixtures.map((fixture) => ({ fixture, plan: planFor(fixture, catalogue, tours?.get(fixture.name)) }));
  const groups = fixtureGroups(planned, PARITY_GROUPS, ({ plan }) => plan.steps.length);
  const mine = groups[group - 1] ?? [];
  const strict = inject('parityStrict');

  let bench: Bench;
  let reference: InputPath;
  let others: readonly InputPath[];

  beforeAll(async () => {
    // Fades and slides are instant, so the canvas draws only when something changes.
    await reduceMotion(true);
    bench = await mountBench({ size: CANVAS });
    const probe = fixtures.find((fixture) => fixture.blueprint.wires.length > 0);
    if (!probe) throw new Error('No content fixture has a wire to probe the paths with.');
    ({ reference, others } = discoverPaths(bench, catalogue, { start: planFor(probe, catalogue, new Set()).start, built: probe.blueprint }));
  });

  afterAll(async () => {
    bench.destroy();
    await reduceMotion(false);
  });

  describe(`touch, pointer and the list view build fixture group ${group} of ${PARITY_GROUPS} byte for byte alike`, () => {
    it('has its share of the fixtures, and every fixture is in one group', () => {
      expect(issues).toEqual([]);
      expect(mine.length).toBeGreaterThan(0);
      expect(groups.flat().map(({ fixture }) => fixture.name).sort()).toEqual(fixtures.map((fixture) => fixture.name).sort());
    });

    for (const { fixture, plan } of mine) {
      it(fixture.name, { timeout: FIXTURE_TIMEOUT }, async ({ annotate, signal }) => {
        const result = await checkParity(plan, reference, others, signal);
        await annotate(reportLine(result), PARITY_ANNOTATION);
        if (passes(result, strict)) return;
        const [first] = result.mismatches;
        const got = first && result.bytes.get(first.path);
        const want = result.bytes.get(reference.name);
        // The canonical JSON side by side: Vitest prints the diff.
        if (first && got !== undefined && want !== undefined) expect(got, `${first.path}: ${first.detail}`).toBe(want);
        expect.fail(`${strict && result.verdict !== 'mismatch' ? 'strict: ' : ''}${reportLine(result)}`);
      });
    }
  });
};

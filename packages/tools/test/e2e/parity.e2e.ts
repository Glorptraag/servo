// Ground rule 8 on every content fixture (task 3.8): built from an empty canvas by touch, by pointer and by the list
// view, each path must give the same canonical blueprint as plain commands, byte for byte. Touch and pointer each
// place by a drag from the tray and by tap-then-tap (click-click), and wire by a drag and by a tap on each socket.
// A step no path can take yet is left out with the task it waits for, and only a real difference fails. The report
// prints one line per fixture when the run ends (src/e2e/reporter.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import { benchContent, mountBench, reduceMotion } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { checkParity, reportLine, reportSummary } from '../../src/e2e/parity.ts';
import type { InputPath, ParityResult } from '../../src/e2e/parity.ts';
import { discoverPaths } from '../../src/e2e/paths.ts';
import { planFor } from '../../src/e2e/plan.ts';
import { PARITY_ANNOTATION } from '../../src/e2e/reporter.ts';

const { fixtures, issues } = loadFixtures();
const { catalogue } = benchContent();

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

let bench: Bench;
let reference: InputPath;
let others: readonly InputPath[];
const results: ParityResult[] = [];

beforeAll(async () => {
  // Fades and slides are instant, so the canvas draws only when something changes.
  await reduceMotion(true);
  bench = await mountBench({ size: CANVAS });
  const probe = fixtures.find((fixture) => fixture.blueprint.wires.length > 0);
  if (!probe) throw new Error('No content fixture has a wire to probe the paths with.');
  ({ reference, others } = discoverPaths(bench, catalogue, { start: planFor(probe, catalogue).start, built: probe.blueprint }));
});

afterAll(async () => {
  bench.destroy();
  await reduceMotion(false);
});

describe('touch, pointer and the list view build every content fixture byte for byte alike', () => {
  it('has fixtures to build', () => {
    expect(issues).toEqual([]);
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(fixture.name, { timeout: FIXTURE_TIMEOUT }, async ({ annotate, signal }) => {
      const result = await checkParity(planFor(fixture, catalogue), reference, others, signal);
      results.push(result);
      await annotate(reportLine(result), PARITY_ANNOTATION);
      const [first] = result.mismatches;
      if (!first) return;
      const got = result.bytes.get(first.path);
      const want = result.bytes.get(reference.name);
      // The canonical JSON side by side: Vitest prints the diff.
      if (got !== undefined && want !== undefined) expect(got, `${first.path}: ${first.detail}`).toBe(want);
      expect.fail(reportLine(result));
    });
  }

  it('reports every fixture', async ({ annotate }) => {
    await annotate(reportSummary(results), PARITY_ANNOTATION);
    expect(results.map((result) => result.fixture)).toEqual(fixtures.map((fixture) => fixture.name));
  });
});

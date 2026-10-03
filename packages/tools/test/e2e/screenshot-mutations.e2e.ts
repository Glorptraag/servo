// The screenshot rule and the probes, proven on changed builds (review R-3.8, finding 1). For every content fixture,
// its build with one power or signal line taken out, and with one part and every wire on it taken out, is drawn in
// the reference's own view. Each must fail its comparison with the fixture's reference (src/e2e/pixels.ts), and the
// probe of what was taken out must fail too (src/e2e/probes.ts). What is taken out is the least the probes can see:
// the line with the fewest uncovered samples, and the part with the smallest uncovered tile that holds no other part.
// Nothing here writes a reference.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { benchContent, mountBench, settle } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { leafParts, withoutPart, withoutWire } from '../../src/e2e/mutations.ts';
import { PIXEL_RULE } from '../../src/e2e/pixels.ts';
import { describeProbe, loadPictures, probeBuild } from '../../src/e2e/probes.ts';
import type { Pictures, Probe } from '../../src/e2e/probes.ts';
import { IPAD } from '../../src/e2e/profile.ts';
import { compareWithReference, describeComparison } from '../../src/e2e/screenshots.ts';

const { fixtures } = loadFixtures();
const { catalogue } = benchContent();

let bench: Bench;
let pictures: Pictures;

beforeAll(async () => {
  bench = await mountBench({ trayWidth: 0, size: IPAD });
  pictures = await loadPictures(benchContent());
});

afterAll(() => bench.destroy());

/** The probed line or part with the fewest uncovered samples, among `candidates`. */
const leastSeen = (probes: readonly Probe[], kind: Probe['kind'], candidates?: ReadonlySet<string>): Probe | undefined =>
  probes
    .filter((probe) => probe.kind === kind && probe.probed && (!candidates || candidates.has(probe.id)))
    .sort((a, b) => a.samples - b.samples || (a.id < b.id ? -1 : 1))[0];

describe('a fixture without one wire, or without one part, fails its screenshot and its probe', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const { handle } = bench;
      expect(handle.load(fixture.blueprint).ok).toBe(true);
      handle.fit();
      await settle(bench);
      // The whole build's geometry, to probe the changed builds for what they lost.
      const scene = bench.hooks.scene;
      const reference = await compareWithReference(bench.host, `${fixture.name}-build`, { writeDiffs: false });
      expect(reference.matches, describeComparison(reference)).toBe(true);
      const probes = probeBuild(bench, reference.shot, pictures);
      const line = leastSeen(probes, 'line');
      const part = leastSeen(probes, 'part', leafParts(fixture.blueprint, catalogue));
      if (!line || !part) throw new Error(`${fixture.name} has no probed line or no probed part that holds nothing.`);
      const changes: readonly [Probe, Blueprint][] = [
        [line, withoutWire(fixture.blueprint, line.id)],
        [part, withoutPart(fixture.blueprint, part.id)],
      ];
      for (const [gone, changed] of changes) {
        // `load` keeps the view, so the changed build is drawn exactly where the reference was.
        expect(handle.load(changed).ok).toBe(true);
        await settle(bench);
        const result = await compareWithReference(bench.host, `${fixture.name}-build`, { writeDiffs: false });
        expect(result.matches, `without ${gone.what}: ${describeComparison(result)}`).toBe(false);
        expect(result.changed, `without ${gone.what}`).toBeGreaterThan(PIXEL_RULE.maxChangedPixels);
        const probe = probeBuild(bench, result.shot, pictures, scene).find((each) => each.kind === gone.kind && each.id === gone.id);
        expect(probe && !probe.seen, `without ${gone.what}, its probe still sees it: ${probe ? describeProbe(probe) : 'no probe'}`).toBe(true);
      }
      handle.load(fixture.blueprint);
    });
  }
});

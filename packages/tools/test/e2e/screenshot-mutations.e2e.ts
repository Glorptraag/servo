// The screenshot rule and the probes, proven on changed builds (review R-3.8, finding 1). For every content fixture,
// its build with one power or signal line taken out, and with one part and every wire on it taken out, is drawn in
// the reference's own view. Each must fail its comparison with the fixture's reference (src/e2e/pixels.ts), and the
// probe of what was taken out must fail too (src/e2e/probes.ts). What is taken out is the least the probes can see:
// the line with the fewest uncovered samples, and the part with the smallest uncovered tile that holds no other part.
// A line taken out can let another line lose its bend (task 7.9) and run over where it was, leaving nothing of it to
// judge; then the next line is taken out instead. Nothing here writes a reference.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint } from '@servo/schema';
import { benchContent, mountBench, settle } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { leafParts, withoutPart, withoutWire } from '../../src/e2e/mutations.ts';
import { PIXEL_RULE } from '../../src/e2e/pixels.ts';
import { describeProbe, drawnPaths, loadPictures, probeBuild } from '../../src/e2e/probes.ts';
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

/** The probed lines or parts, the fewest uncovered samples first, among `candidates`. */
const leastSeen = (probes: readonly Probe[], kind: Probe['kind'], candidates?: ReadonlySet<string>): Probe[] =>
  probes
    .filter((probe) => probe.kind === kind && probe.probed && (!candidates || candidates.has(probe.id)))
    .sort((a, b) => a.samples - b.samples || (a.id < b.id ? -1 : 1));

describe('a fixture without one wire, or without one part, fails its screenshot and its probe', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const { handle } = bench;
      expect(handle.load(fixture.blueprint).ok).toBe(true);
      handle.fit();
      await settle(bench);
      // The whole build's geometry, to probe the changed builds for what they lost.
      const scene = bench.hooks.scene;
      const paths = drawnPaths(bench);
      const reference = await compareWithReference(bench.host, `${fixture.name}-build`, { writeDiffs: false });
      expect(reference.matches, describeComparison(reference)).toBe(true);
      const probes = probeBuild(bench, reference.shot, pictures);
      const lines = leastSeen(probes, 'line');
      const [part] = leastSeen(probes, 'part', leafParts(fixture.blueprint, catalogue));
      if (lines.length === 0 || !part) throw new Error(`${fixture.name} has no probed line or no probed part that holds nothing.`);
      /** Takes `gone` out; false when nothing of it is left to judge, as with a line another now runs over. */
      const takeOut = async (gone: Probe, changed: Blueprint): Promise<boolean> => {
        // `load` keeps the view, so the changed build is drawn exactly where the reference was.
        expect(handle.load(changed).ok).toBe(true);
        await settle(bench);
        const result = await compareWithReference(bench.host, `${fixture.name}-build`, { writeDiffs: false });
        expect(result.matches, `without ${gone.what}: ${describeComparison(result)}`).toBe(false);
        expect(result.changed, `without ${gone.what}`).toBeGreaterThan(PIXEL_RULE.maxChangedPixels);
        const probe = probeBuild(bench, result.shot, pictures, scene, paths, drawnPaths(bench)).find((each) => each.kind === gone.kind && each.id === gone.id);
        if (probe && !probe.probed && gone.kind === 'line') return false;
        expect(probe && !probe.seen, `without ${gone.what}, its probe still sees it: ${probe ? describeProbe(probe) : 'no probe'}`).toBe(true);
        return true;
      };
      let judged = false;
      for (const line of lines) {
        judged = await takeOut(line, withoutWire(fixture.blueprint, line.id));
        if (judged) break;
      }
      expect(judged, `${fixture.name}: no line taken out leaves anything of it to judge`).toBe(true);
      await takeOut(part, withoutPart(fixture.blueprint, part.id));
      handle.load(fixture.blueprint);
    });
  }
});

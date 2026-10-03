// Every content fixture as the canvas draws it with the real placeholder pictures (`pnpm art`), fitted in Build mode:
// compared with its stored reference by the per-pixel rule (src/e2e/pixels.ts), and probed for every power and signal
// line and every part it must show (src/e2e/probes.ts). And the two arena presets the fixtures use, laid down in Run
// mode. The iPad profile, on SwiftShader, so one set of references serves every machine. References are in
// __screenshots__/; `pnpm e2e -u` rewrites them. screenshot-mutations.e2e.ts proves the rule and the probes catch a
// missing wire or part.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import type { Vec2 } from '@servo/schema';
import { benchContent, mountBench, settle } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { describeProbe, loadPictures, probeBuild } from '../../src/e2e/probes.ts';
import type { Pictures } from '../../src/e2e/probes.ts';
import { IPAD } from '../../src/e2e/profile.ts';
import { colourDistance, describeRgb, expectScreenshot, shoot } from '../../src/e2e/screenshots.ts';

const { fixtures } = loadFixtures();

let bench: Bench;
let pictures: Pictures;

beforeAll(async () => {
  bench = await mountBench({ trayWidth: 0, size: IPAD });
  pictures = await loadPictures(benchContent());
});

afterAll(() => bench.destroy());

const show = async (fixture: ContentFixture, mode: 'build' | 'run'): Promise<void> => {
  const { handle } = bench;
  if (handle.mode === 'run') handle.setMode('build');
  expect(handle.load(fixture.blueprint).ok).toBe(true);
  handle.setMode(mode);
  handle.fit();
  await settle(bench);
};

/** A canvas point (mm) in CSS pixels from the canvas's top left. */
const screen = (point: Vec2): Vec2 => bench.hooks.camera.worldToScreen(point);

/** Inside the fit's padding, clear of the build: bare workbench in Build mode. */
const CORNER = { x: 12, y: 12 };

describe('every content fixture in Build mode, with its pictures', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      await show(fixture, 'build');
      // The canvas fills its host, so the host's screenshot is the canvas's, point for point.
      const { shot } = await expectScreenshot(bench.host, `${fixture.name}-build`);
      const probes = probeBuild(bench, shot, pictures);
      expect(probes.filter((probe) => !probe.seen).map(describeProbe), 'lines and parts not drawn').toEqual([]);
      expect(probes.filter((probe) => probe.kind === 'line' && probe.probed).length, 'power and signal lines probed').toBeGreaterThan(0);
      expect(probes.filter((probe) => probe.kind === 'part' && probe.probed).length, 'parts probed').toBeGreaterThan(0);
    });
  }
});

describe('the arena presets in Run mode', () => {
  // A kit robot where one uses the preset: its chassis sits at the canvas origin, which a Run lays on the start pose.
  const byPreset = new Map<string, ContentFixture>();
  const kitsFirst = [...fixtures].sort((a, b) => Number(!a.name.startsWith('kit-')) - Number(!b.name.startsWith('kit-')));
  for (const fixture of kitsFirst) if (!byPreset.has(fixture.blueprint.arena.preset)) byPreset.set(fixture.blueprint.arena.preset, fixture);

  for (const [preset, fixture] of byPreset) {
    it(`${preset}, around ${fixture.name}`, async () => {
      await show(fixture, 'build');
      const workbench = (await shoot(bench.hooks.canvas)).at(CORNER);
      await show(fixture, 'run');
      const { shot } = await expectScreenshot(bench.host, `${preset}-run`);
      // 150 mm behind the chassis: on the floor, which both presets start the robot 300 mm in from.
      const floor = shot.at(screen({ x: -150, y: 0 }));
      expect(colourDistance(floor, workbench), `the floor (${describeRgb(floor)}) is laid over the workbench (${describeRgb(workbench)})`).toBeGreaterThan(12);
      bench.handle.setMode('build');
    });
  }
});

// Every content fixture as the canvas draws it with the real placeholder pictures (`pnpm art`), fitted in Build mode,
// against a stored reference; and the two arena presets the fixtures use, laid down in Run mode. Pixel probes say
// what a reference alone cannot: something is drawn where every part sits, and Run mode lays the floor down. The
// iPad profile, on SwiftShader, so one set of references serves every machine. References are in __screenshots__/;
// delete one and run `pnpm e2e` to write it again.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import type { Vec2 } from '@servo/schema';
import { mountBench, settle } from '../../src/e2e/bench.ts';
import type { Bench } from '../../src/e2e/bench.ts';
import { IPAD } from '../../src/e2e/profile.ts';
import { colourDistance, describeRgb, expectNotColour, expectScreenshot, shoot } from '../../src/e2e/screenshots.ts';

const { fixtures } = loadFixtures();

let bench: Bench;

beforeAll(async () => {
  bench = await mountBench({ trayWidth: 0, size: IPAD });
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
      const shot = await shoot(bench.hooks.canvas);
      const workbench = shot.at(CORNER);
      for (const part of fixture.blueprint.parts) expectNotColour(shot, screen(part.position), workbench, `${part.id} (${part.part}) is drawn`);
      await expectScreenshot(bench.host, `${fixture.name}-build`);
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
      const run = await shoot(bench.hooks.canvas);
      // 150 mm behind the chassis: on the floor, which both presets start the robot 300 mm in from.
      const floor = run.at(screen({ x: -150, y: 0 }));
      expect(colourDistance(floor, workbench), `the floor (${describeRgb(floor)}) is laid over the workbench (${describeRgb(workbench)})`).toBeGreaterThan(12);
      await expectScreenshot(bench.host, `${preset}-run`);
      bench.handle.setMode('build');
    });
  }
});

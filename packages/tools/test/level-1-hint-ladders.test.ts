// Level 1's hint ladders, walked as a child would climb them (review R-4.7). From each challenge's start and from each
// of its failing fixtures, a walk Runs the build, takes the ladder the app would choose for that build and the Run's
// faults (task 4.6's chooseLadder), and follows it: either its ghost wire, drawn by hand, or its do-it, as the app
// applies it (doItCommand, through the canvas's own commands). Whichever the child follows, every ladder chosen must
// still have a usable do-it, and the walk must reach the goal.
import { describe, expect, it } from 'vitest';
import { judgeRun } from '@servo/app/goal';
import { chooseLadder, doItCommand, narrowStep } from '@servo/app/hint-ladder';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint, Challenge, HintStep, RunInput } from '@servo/schema';
import { runCase } from '../src/golden-runs/run.ts';

const { content } = loadContent();
const { fixtures } = loadFixtures();
const catalogue = content.catalogue;
const LEVEL_1 = content.challenges.filter((challenge) => challenge.level === 1);

/** More than any Level 1 ladder needs: the most is drive-forward's four do-its. */
const MOST_STEPS = 10;

type Follow = 'do-it' | 'ghost-wire';

/** Walks a build to the goal. Returns the steps taken, or throws with the build's state where a ladder fails. */
const walk = async (challenge: Challenge, start: Blueprint, inputs: readonly RunInput[], ticks: number, follow: Follow): Promise<string[]> => {
  let build = start;
  const taken: string[] = [];
  for (let step = 0; step < MOST_STEPS; step += 1) {
    const { record } = await runCase({ id: challenge.id, blueprint: build, catalogue, seed: 1, inputs, ticks, challenge: challenge.id });
    if (judgeRun(challenge, record, catalogue).met) return taken;
    const choice = chooseLadder(challenge, build, record.faults);
    const faults = record.faults.map((fault) => `${fault.partId} ${fault.failure}`).join(', ') || 'no fault';
    if (!choice) throw new Error(`No ladder applies after ${taken.join(' → ') || 'the start'} (${faults}).`);
    const steps = choice.ladder.steps.map((each) => narrowStep(each, build, choice.part));
    const ghost = steps.find((each): each is Extract<HintStep, { step: 'ghost-wire' }> => each.step === 'ghost-wire');
    if (follow === 'ghost-wire' && ghost) {
      const drawn = doItCommand([{ kind: 'add-wire', from: ghost.from, to: ghost.to }], build, catalogue);
      if (drawn.ok) {
        build = drawn.blueprint;
        taken.push(`ladder ${choice.index} ghost wire`);
        continue;
      }
    }
    const last = steps.at(-1);
    if (last?.step !== 'do-it') throw new Error(`Ladder ${choice.index} does not end with do-it.`);
    const done = doItCommand(last.changes, build, catalogue);
    if (!done.ok) throw new Error(`Ladder ${choice.index}'s do-it is refused after ${taken.join(' → ') || 'the start'} (${faults}): ${done.reason}`);
    build = done.blueprint;
    taken.push(`ladder ${choice.index} do-it`);
  }
  throw new Error(`The goal is still not met after ${MOST_STEPS} steps: ${taken.join(' → ')}.`);
};

describe('Level 1 hint ladders, climbed from every start and failing fixture', () => {
  it('has fifteen Level 1 challenges, and only the unscripted build has no ladder', () => {
    expect(LEVEL_1).toHaveLength(15);
    expect(LEVEL_1.filter((challenge) => challenge.hints.length === 0).map((challenge) => challenge.kind)).toEqual(['unscripted-build']);
  });

  for (const challenge of LEVEL_1.filter((each) => each.hints.length > 0)) {
    const own = fixtures.filter((fixture) => fixture.challenge === challenge.id);
    // The passing fixture's switch presses and length: the Run a fixed build must pass.
    const passing = own.find((fixture) => fixture.expect.goal?.met === true);
    const starts = [
      ...(challenge.start ? [{ name: 'start', blueprint: challenge.start }] : []),
      ...own.filter((fixture) => fixture.expect.goal?.met === false).map((fixture) => ({ name: fixture.name, blueprint: fixture.blueprint })),
    ];
    for (const follow of ['do-it', 'ghost-wire'] as const) {
      it(`${challenge.id}: reaches the goal from each failing build, following each ${follow}`, async () => {
        expect(passing, 'a passing fixture').toBeDefined();
        if (!passing) return;
        expect(starts.length).toBeGreaterThan(0);
        for (const start of starts) {
          await expect(walk(challenge, start.blueprint, passing.inputs, passing.ticks, follow), start.name).resolves.toBeDefined();
        }
      }, 60_000);
    }
  }
});

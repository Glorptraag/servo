// Level 1's hint ladders, walked as a child would climb them (review R-4.7). From each challenge's start and from each
// of its failing fixtures, a walk Runs the build, takes the ladder the app would choose for that build and the Run's
// faults (task 4.6's chooseLadder), and follows it: either its ghost wire, drawn by hand, or its do-it, as the app
// applies it (doItCommand, through the canvas's own commands). Whichever the child follows, every ladder chosen must
// still have a usable do-it, and the walk must reach the goal with no fault the challenge's passing fixtures do not show
// (review R-4.8 F1: a ladder that wired two battery packs together reached the goal on a short circuit).
import { describe, expect, it } from 'vitest';
import { judgeRun } from '@servo/app/goal';
import { chooseLadder, doItCommand, narrowStep } from '@servo/app/hint-ladder';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint, Challenge, HintChange, HintStep, RunInput } from '@servo/schema';
import { runCase } from '../src/golden-runs/run.ts';

const { content } = loadContent();
const { fixtures } = loadFixtures();
const catalogue = content.catalogue;
const LEVEL_1 = content.challenges.filter((challenge) => challenge.level === 1);

/** More than any Level 1 ladder needs: the most is drive-forward's four do-its. */
const MOST_STEPS = 10;

type Follow = 'do-it' | 'ghost-wire';

/** Failure modes that join plus to minus with nothing that uses power: never where a ladder leads. */
const SHORTS: ReadonlySet<string> = new Set(['short-circuit', 'across-the-pack']);

const typeOf = (build: Blueprint, partId: string): string => build.parts.find((part) => part.id === partId)?.part ?? partId;

/** The faults a challenge means a passing Run to show, by part type and failure: those of its passing fixtures. */
const intendedFaults = (challenge: Challenge): ReadonlySet<string> =>
  new Set(
    fixtures
      .filter((fixture) => fixture.challenge === challenge.id && fixture.expect.goal?.met === true)
      .flatMap((fixture) => fixture.expect.faults.map((fault) => `${typeOf(fixture.blueprint, fault.partId)} ${fault.failure}`)),
  );

/** Walks a build to the goal. Returns the steps taken, or throws with the build's state where a ladder fails. */
const walk = async (challenge: Challenge, start: Blueprint, inputs: readonly RunInput[], ticks: number, follow: Follow): Promise<string[]> => {
  let build = start;
  const taken: string[] = [];
  for (let step = 0; step < MOST_STEPS; step += 1) {
    const { record } = await runCase({ id: challenge.id, blueprint: build, catalogue, seed: 1, inputs, ticks, challenge: challenge.id });
    if (judgeRun(challenge, record, catalogue).met) {
      // A what-if has no right answer, so any fault its change shows may stand, but never a short circuit.
      const unintended = record.faults.filter((fault) =>
        challenge.kind === 'what-if' ? SHORTS.has(fault.failure) : !intendedFaults(challenge).has(`${typeOf(build, fault.partId)} ${fault.failure}`),
      );
      if (unintended.length > 0) {
        const shown = unintended.map((fault) => `${fault.partId} ${fault.failure}`).join(', ');
        throw new Error(`The goal is met after ${taken.join(' → ') || 'the start'} with faults no passing fixture shows: ${shown}.`);
      }
      return taken;
    }
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
    // Partial fixes the child makes by hand (review R-4.7 R1): from each failing build, every subset of each ladder's
    // wire changes, made by hand, then the ladders climbed by do-it. "Do it for me" must still finish the fix.
    it(`${challenge.id}: reaches the goal from every part of every ladder's fix made by hand`, async () => {
      if (!passing) throw new Error('no passing fixture');
      const tried: string[] = [];
      for (const start of starts) {
        for (const [index, ladder] of challenge.hints.entries()) {
          const last = ladder.steps.at(-1);
          if (last?.step !== 'do-it') continue;
          const wires = last.changes.filter((change) => change.kind === 'add-wire' || change.kind === 'remove-wire');
          for (let mask = 1; mask < 2 ** wires.length; mask += 1) {
            const subset = wires.filter((_, bit) => (mask >> bit) & 1);
            const made = doItCommand(subset, start.blueprint, catalogue);
            // A subset with nothing left to do, or that does not fit this build, is not a state the child reaches this way.
            if (!made.ok) continue;
            const name = `${start.name}, ladder ${index} changes ${mask.toString(2)}`;
            tried.push(name);
            await expect(walk(challenge, made.blueprint, passing.inputs, passing.ticks, 'do-it'), name).resolves.toBeDefined();
          }
        }
      }
      // meet-the-caster and what-if-one-wheel have no wire change that fits a failing build (the caster is not placed
      // yet; the wheel comes off as a part), so they try none here.
      expect(tried.length > 0 || ['meet-the-caster', 'what-if-one-wheel'].includes(challenge.id)).toBe(true);
    }, 300_000);

    // The child places the part a do-it adds before anything else, loose on the canvas or on its mount point, while the
    // old build is still wired (review R-4.8 F1). The ladders from there must still finish the job without a fault.
    const added = [
      ...new Set(
        challenge.hints.flatMap((ladder) => {
          const last = ladder.steps.at(-1);
          return last?.step === 'do-it' ? last.changes.flatMap((change) => (change.kind === 'add-part' ? [JSON.stringify(change)] : [])) : [];
        }),
      ),
    ].map((text) => JSON.parse(text) as Extract<HintChange, { kind: 'add-part' }>);
    if (added.length > 0) {
      it(`${challenge.id}: reaches the goal with the new part placed first, loose or mounted`, async () => {
        if (!passing) throw new Error('no passing fixture');
        const tried: string[] = [];
        for (const start of starts) {
          for (const change of added) {
            for (const placed of [{ kind: 'add-part', part: change.part } as const, change]) {
              const made = doItCommand([placed], start.blueprint, catalogue);
              if (!made.ok) continue;
              const name = `${start.name}, ${change.part} placed ${'mountOn' in placed ? 'on its mount point' : 'loose'}`;
              tried.push(name);
              await expect(walk(challenge, made.blueprint, passing.inputs, passing.ticks, 'do-it'), name).resolves.toBeDefined();
            }
          }
        }
        expect(tried.length).toBeGreaterThan(0);
      }, 300_000);
    }

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

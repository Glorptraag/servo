// Real run records for the progress tests: content's fixtures run through sim-core's public createSimulation, recorded
// as the app's recorder records them (packages/app/src/run-bar/record.ts): numbered within their challenge, or their
// build in the sandbox, linked to the Run before, which gives `fixed` (D31), and a challenge Run judged by the app's own
// goal judge. The progress model never sees sim-core; only these tests do.
import { judgeRun } from '@servo/app/goal';
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import { validateChallenge } from '@servo/schema';
import type { Blueprint, Challenge, ChallengeId, PlacedPartId, RunInput, RunRecord } from '@servo/schema';
import { exampleChallenges } from '@servo/schema/fixtures';
import { createSimulation } from '@servo/sim-core';

export const { content: shipped } = loadContent();
export const fixtures: readonly ContentFixture[] = loadFixtures().fixtures;

export const fixture = (name: string): ContentFixture => {
  const found = fixtures.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name} fixture`);
  return found;
};

/** Content's own challenges, then the schema's example challenges that validate against the shipped parts and share no id with them. */
export const challenges: readonly Challenge[] = [
  ...shipped.challenges,
  ...exampleChallenges.flatMap((example) => {
    const result = validateChallenge(example.data, shipped.catalogue);
    return result.ok && !shipped.challenges.some((own) => own.id === result.value.id) ? [result.value] : [];
  }),
];

/** The shipped content with the example challenges, as the parent view would read it once content has challenges. */
export const content: Content = { ...shipped, challenges };

export const challenge = (id: string): Challenge => {
  const found = challenges.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} challenge`);
  return found;
};

export interface RunPlan {
  readonly blueprint: Blueprint;
  readonly ticks: number;
  readonly inputs?: readonly RunInput[];
  readonly seed?: number;
  readonly challenge?: ChallengeId;
}

/** A clock that moves one minute per Run, so the times say which Run came first and time-to-fix is easy to read. */
export const minute = (n: number): string => new Date(Date.UTC(2026, 9, 1, 9, n)).toISOString();

let ids = 0;
/** Run ids that are UUID v4s and say which test Run they are. */
const nextId = (): string => `00000000-0000-4000-8000-${(ids += 1).toString(16).padStart(12, '0')}`;

/** The challenge's Runs, or the build's in the sandbox: what the app numbers a Run among and links it to. */
const seriesKey = (plan: RunPlan): string => (plan.challenge ? `challenge ${plan.challenge}` : `build ${plan.blueprint.meta.id}`);

/**
 * One child's Runs, one after another, each a minute after the last. Each is numbered and linked as the app's recorder
 * does, so sim-core works out its `fixed` from the Run before it in its series.
 */
export const runAll = async (plans: readonly RunPlan[], start = 0): Promise<RunRecord[]> => {
  const records: RunRecord[] = [];
  const series = new Map<string, RunRecord[]>();
  for (const [index, plan] of plans.entries()) {
    const arena = shipped.catalogue.arenas?.get(plan.blueprint.arena.preset);
    if (!arena) throw new Error(`no arena ${plan.blueprint.arena.preset}`);
    const simulation = await createSimulation({ blueprint: plan.blueprint, catalogue: shipped.catalogue, arena, seed: plan.seed ?? 1 });
    try {
      while (simulation.tick < plan.ticks) {
        for (const input of plan.inputs ?? []) {
          if (input.tick === simulation.tick) simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
        }
        simulation.step();
      }
      const before = series.get(seriesKey(plan)) ?? [];
      const context = {
        id: nextId(),
        startedAt: minute(start + index),
        endedAt: minute(start + index),
        runNumber: before.length + 1,
        hints: [],
        ...(before.length > 0 ? { previous: before[before.length - 1] } : {}),
      };
      let record = simulation.record({ ...context, events: 'keep' });
      if (plan.challenge) {
        const goal = judgeRun(challenge(plan.challenge), record, shipped.catalogue);
        record = simulation.record({ ...context, challenge: plan.challenge, goal, events: 'drop' });
      } else {
        record = simulation.record({ ...context, events: 'drop' });
      }
      before.push(record);
      series.set(seriesKey(plan), before);
      records.push(record);
    } finally {
      simulation.dispose();
    }
  }
  return records;
};

/** A fixture's own Run, as its spec says. */
export const planOf = (spec: ContentFixture): RunPlan => ({
  blueprint: spec.blueprint,
  ticks: spec.ticks,
  inputs: spec.inputs,
  seed: spec.seed,
  ...(spec.challenge === undefined ? {} : { challenge: spec.challenge }),
});

/** The build without one placed part and the wires on its ports: a change to that part (D75). */
export const without = (blueprint: Blueprint, part: PlacedPartId): Blueprint => ({
  ...blueprint,
  parts: blueprint.parts.filter((placed) => placed.id !== part),
  wires: blueprint.wires.filter((wire) => wire.from.part !== part && wire.to.part !== part),
});

/** The build with one part moved by `dx` mm: no change to the part as D75 reads it. */
export const moved = (blueprint: Blueprint, part: PlacedPartId, dx: number): Blueprint => ({
  ...blueprint,
  parts: blueprint.parts.map((placed) => (placed.id === part ? { ...placed, position: { x: placed.position.x + dx, y: placed.position.y } } : placed)),
});

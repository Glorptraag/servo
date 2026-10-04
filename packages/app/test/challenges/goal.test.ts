// The goal judge (task 4.5) on real Runs: each Level 1–2 challenge fixture against builds that meet it and builds that
// do not, run through sim-core. The schema's example challenges run on the catalogue they are written for (the schema's
// example parts, arenas and kits); those that also validate against the content run on content's fixtures. Level 1's
// unscripted build (D26) has no record yet, so a stand-in written to its job checks `in-zone`. Every content fixture
// that names a challenge and expects a goal is judged too, as `pnpm golden` does.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import { makeCatalogue, validateArenaPreset, validateChallenge, validateKit, validatePartRecord } from '@servo/schema';
import type { Blueprint, Catalogue, Challenge, RunInput, RunRecord, ValidationResult, Wire } from '@servo/schema';
import { exampleArenas, exampleChallenges, exampleParts, validBlueprints, validKits } from '@servo/schema/fixtures';
import { createSimulation } from '@servo/sim-core';
import { GoalWatch, goalJudgeFor, judgeRun, namedFaultsShown } from '../../src/challenges/goal.ts';
import type { GoalVerdict } from '../../src/challenges/goal.ts';

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`).join('\n'));
  return result.value;
};

const schemaParts = exampleParts.map((part) => unwrap(validatePartRecord(part)));
const schemaArenas = exampleArenas.map((arena) => unwrap(validateArenaPreset(arena)));
const partsAndArenas = makeCatalogue({ parts: schemaParts, arenas: schemaArenas });
const schemaCatalogue = makeCatalogue({ parts: schemaParts, arenas: schemaArenas, kits: validKits.map((kit) => unwrap(validateKit(kit.data, partsAndArenas))) });

const { content } = loadContent();
const fixtures = loadFixtures().fixtures;

const challengeOf = (name: string, catalogue: Catalogue): Challenge => {
  const found = exampleChallenges.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`no example challenge ${name}`);
  return unwrap(validateChallenge(found.data, catalogue));
};

const exampleBlueprint = (name: string): Blueprint => {
  const found = validBlueprints.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`no example blueprint ${name}`);
  return found.data as Blueprint;
};

const fixtureOf = (name: string): ContentFixture => {
  const found = fixtures.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`no content fixture ${name}`);
  return found;
};

interface RunPlan {
  readonly inputs?: readonly RunInput[];
  readonly ticks: number;
  readonly seed?: number;
  readonly challenge?: Challenge;
}

interface Judged {
  readonly record: RunRecord;
  /** The live verdict: a GoalWatch fed each frame as the app's run loop gives them. */
  readonly live?: GoalVerdict;
}

/** Runs a build to its last tick with its switch presses, keeping every event. */
const runOf = async (blueprint: Blueprint, catalogue: Catalogue, plan: RunPlan): Promise<Judged> => {
  const arena = catalogue.arenas?.get(blueprint.arena.preset);
  if (!arena) throw new Error(`no arena ${blueprint.arena.preset}`);
  const simulation = await createSimulation({ blueprint, catalogue, arena, seed: plan.seed ?? 1 });
  try {
    const watch = plan.challenge ? new GoalWatch({ challenge: plan.challenge, blueprint: simulation.blueprint, catalogue }) : undefined;
    watch?.push(0, simulation.frame.events);
    while (simulation.tick < plan.ticks) {
      for (const input of plan.inputs ?? []) if (input.tick === simulation.tick) simulation.input(input);
      const frame = simulation.step();
      watch?.push(frame.tick, frame.events);
    }
    const record = simulation.record({ id: '0b7c4f2e-9d1a-4e3b-8c5f-1a2b3c4d5e6f', startedAt: '2026-10-03T09:00:00.000Z', endedAt: '2026-10-03T09:00:10.000Z', runNumber: 1, hints: [] });
    return { record, ...(watch ? { live: watch.verdict } : {}) };
  } finally {
    simulation.dispose();
  }
};

/** Judges a Run both ways, live and from its record, and checks they agree. */
const verdictOf = async (challenge: Challenge, blueprint: Blueprint, catalogue: Catalogue, plan: Omit<RunPlan, 'challenge'>): Promise<GoalVerdict> => {
  const { record, live } = await runOf(blueprint, catalogue, { ...plan, challenge });
  const judged = judgeRun(challenge, record, catalogue);
  expect(live).toEqual(judged);
  return judged;
};

const withWires = (blueprint: Blueprint, remove: readonly string[], add: readonly Omit<Wire, 'id'>[]): Blueprint => {
  let next = blueprint.meta.highWater.wires;
  const added = add.map((wire): Wire => {
    next += 1;
    return { id: `w${next}`, ...wire };
  });
  return {
    ...blueprint,
    wires: [...blueprint.wires.filter((wire) => !remove.includes(wire.id)), ...added],
    meta: { ...blueprint.meta, highWater: { ...blueprint.meta.highWater, wires: next } },
  };
};

const inArena = (blueprint: Blueprint, preset: string): Blueprint => ({ ...blueprint, arena: { preset, props: [] } });

describe('meet-the-switch: part introduction, Level 1', () => {
  const challenge = challengeOf('meet-the-switch', schemaCatalogue);
  const start = challenge.start as Blueprint;
  const wired = withWires(start, [], [
    { from: { part: 'battery', port: 'plus' }, to: { part: 'switch', port: 'a' } },
    { from: { part: 'motor', port: 'plus' }, to: { part: 'switch', port: 'b' } },
  ]);
  const press = [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }] as const;

  it('is not met by the build it starts from: the motor never turns', async () => {
    expect(await verdictOf(challenge, start, schemaCatalogue, { ticks: 90, inputs: press })).toEqual({ met: false });
  });

  it('is met once the switch is in the power line and pressed: the motor turns, then stands still with the switch open', async () => {
    const verdict = await verdictOf(challenge, wired, schemaCatalogue, { ticks: 90, inputs: press });
    expect(verdict.met).toBe(true);
    // The motor turns from tick 0, so its 15 ticks are met at tick 14; the switch opens at tick 31 and 15 ticks on is 45.
    expect(verdict.tick).toBeGreaterThanOrEqual(45);
    expect(verdict.tick).toBeLessThan(60);
  });

  it('is not met while the switch is never pressed: the second step never holds', async () => {
    expect(await verdictOf(challenge, wired, schemaCatalogue, { ticks: 90 })).toEqual({ met: false });
  });

  it('is not met when the switch is pressed before the motor has turned for its 15 ticks: the steps come in order', async () => {
    const early = [{ tick: 5, partId: 'switch', kind: 'switch', closed: false }] as const;
    expect(await verdictOf(challenge, wired, schemaCatalogue, { ticks: 90, inputs: early })).toEqual({ met: false });
  });
});

describe('one-motor-backwards: breakdown, Level 2 (D48)', () => {
  const challenge = challengeOf('one-motor-backwards', schemaCatalogue);
  const start = challenge.start as Blueprint;
  const fixed = withWires(start, ['w10', 'w12'], [
    { from: { part: 'switch', port: 'b' }, to: { part: 'motor-right', port: 'plus' } },
    { from: { part: 'motor-right', port: 'minus' }, to: { part: 'battery', port: 'minus' } },
  ]);
  const flipped: Blueprint = {
    ...start,
    parts: start.parts.map((part) => (part.id === 'motor-right' ? { ...part, settings: { direction: 'backward' } } : part)),
  };

  /** The backwards motor taken away and a new DC motor put in its place, wired backwards again, its Direction flipped. */
  const replaced: Blueprint = (() => {
    const swap = (id: string): string => (id === 'motor-right' ? 'p1' : id);
    return {
      ...flipped,
      parts: flipped.parts.map((part) => (part.id === 'motor-right' ? { ...part, id: 'p1' } : part)),
      wires: flipped.wires.map((wire) => ({ ...wire, from: { ...wire.from, part: swap(wire.from.part) }, to: { ...wire.to, part: swap(wire.to.part) } })),
      meta: { ...flipped.meta, highWater: { ...flipped.meta.highWater, parts: 1 } },
    };
  })();
  const named = (record: RunRecord): string[] => namedFaultsShown(challenge, record).map((fault) => `${fault.partId} ${fault.failure}`);

  it('is not met by the build it starts from: the robot spins on the spot', async () => {
    expect(await verdictOf(challenge, start, schemaCatalogue, { ticks: 90 })).toEqual({ met: false });
    const { record } = await runOf(start, schemaCatalogue, { ticks: 90 });
    expect(named(record)).toEqual(['motor-right reversed']);
  });

  it('is met once the right motor’s wires are swapped: it drives straight with no fault', async () => {
    const verdict = await verdictOf(challenge, fixed, schemaCatalogue, { ticks: 90 });
    expect(verdict.met).toBe(true);
    expect(verdict.tick).toBeLessThan(90);
    const { record } = await runOf(fixed, schemaCatalogue, { ticks: 90 });
    expect(record.faults).toEqual([]);
    expect(named(record)).toEqual([]);
  });

  it('is not met by flipping the motor’s Direction setting: it drives straight, but the named fault stays', async () => {
    expect(await verdictOf(challenge, flipped, schemaCatalogue, { ticks: 90 })).toEqual({ met: false });
    const { record } = await runOf(flipped, schemaCatalogue, { ticks: 90 });
    expect(named(record)).toEqual(['motor-right reversed']);
    // The motion alone meets the goal; the breakdown's named fault is what keeps it from passing.
    expect(judgeRun({ ...challenge, kind: 'guided' }, record, schemaCatalogue).met).toBe(true);
    expect(namedFaultsShown({ ...challenge, kind: 'guided' }, record)).toEqual([]);
  });

  it('is not met by a new DC motor wired backwards in the old one’s place, its Direction flipped (R-4.5 finding 2)', async () => {
    expect(await verdictOf(challenge, replaced, schemaCatalogue, { ticks: 90 })).toEqual({ met: false });
    const { record } = await runOf(replaced, schemaCatalogue, { ticks: 90 });
    expect(named(record)).toEqual(['p1 reversed']);
    expect(judgeRun({ ...challenge, kind: 'guided' }, record, schemaCatalogue).met).toBe(true);
  });
});

describe('drive-and-light: guided, Level 2', () => {
  const challenge = challengeOf('drive-and-light', content.catalogue);
  const lit = fixtureOf('led-and-buzzer-robot');

  it('is met by a robot that drives forward with its LED lit', async () => {
    const verdict = await verdictOf(challenge, lit.blueprint, content.catalogue, { ticks: lit.ticks, inputs: lit.inputs });
    expect(verdict.met).toBe(true);
  });

  it('is not met by a robot that drives with no LED', async () => {
    const roller = fixtureOf('level-1-roller');
    expect(await verdictOf(challenge, roller.blueprint, content.catalogue, { ticks: roller.ticks })).toEqual({ met: false });
  });

  it('is not met by an LED lit on the workbench with no robot', async () => {
    const board = exampleBlueprint('led-circuit');
    const onSchema = challengeOf('drive-and-light', schemaCatalogue);
    expect(await verdictOf(onSchema, board, schemaCatalogue, { ticks: 60 })).toEqual({ met: false });
  });

  it('is not met by the lit robot reversing: speed along its heading counts, not speed alone', async () => {
    const backward: Blueprint = {
      ...lit.blueprint,
      parts: lit.blueprint.parts.map((part) => (part.part === 'dc-motor' ? { ...part, settings: { ...part.settings, direction: 'backward' } } : part)),
    };
    expect(await verdictOf(challenge, backward, content.catalogue, { ticks: lit.ticks, inputs: lit.inputs })).toEqual({ met: false });
  });
});

describe('cross-and-stop: unscripted build, Level 2 (D26)', () => {
  const challenge = challengeOf('cross-and-stop', content.catalogue);

  it('is met by the bumper robot, which stops at the far wall with its motors off', async () => {
    const bumper = fixtureOf('bumper-stops-at-wall');
    const verdict = await verdictOf(challenge, bumper.blueprint, content.catalogue, { ticks: bumper.ticks, inputs: bumper.inputs });
    expect(verdict.met).toBe(true);
  });

  it('is met by the Circuit Crew kit robot, which stops the same way', async () => {
    const kit = fixtureOf('kit-circuit-crew');
    expect((await verdictOf(challenge, kit.blueprint, content.catalogue, { ticks: kit.ticks })).met).toBe(true);
  });

  it('is not met by the Level 1 roller, which reaches the wall but keeps its motors powered against it', async () => {
    const roller = inArena(fixtureOf('level-1-roller').blueprint, 'wall-stop');
    expect(await verdictOf(challenge, roller, content.catalogue, { ticks: 300 })).toEqual({ met: false });
  });

  it('is not met by a robot stopped by its switch short of the wall', async () => {
    const kit = inArena(fixtureOf('kit-rolling-start').blueprint, 'wall-stop');
    const stop = [{ tick: 60, partId: 'switch', kind: 'switch', closed: false }] as const;
    expect(await verdictOf(challenge, kit, content.catalogue, { ticks: 180, inputs: stop })).toEqual({ met: false });
  });
});

describe('the Level 1 unscripted build: cross the arena to the far side (D26)', () => {
  // No content record yet (task 4.7): a stand-in written to the job, on the content's wall-stop arena and its far-side zone.
  const challenge = unwrap(
    validateChallenge(
      {
        id: 'cross-the-arena',
        kind: 'unscripted-build',
        level: 1,
        title: 'Cross the arena',
        goalLine: 'Cross the arena to the far side',
        goal: { kind: 'holds', when: { kind: 'in-zone', target: { part: 'chassis' }, zone: 'far-side' }, forTicks: 1 },
        arena: { preset: 'wall-stop', props: [] },
        kit: 'rolling-start',
        hints: [],
      },
      content.catalogue,
    ),
  );

  it('is met by the Level 1 roller driving across', async () => {
    const roller = inArena(fixtureOf('level-1-roller').blueprint, 'wall-stop');
    const verdict = await verdictOf(challenge, roller, content.catalogue, { ticks: 240 });
    expect(verdict.met).toBe(true);
  });

  it('is not met by a robot that turns away with one motor unwired', async () => {
    const turning = inArena(fixtureOf('broken-missing-return-wire').blueprint, 'wall-stop');
    expect(await verdictOf(challenge, turning, content.catalogue, { ticks: 240 })).toEqual({ met: false });
  });

  it('is not met by a robot stopped by its switch on the near side', async () => {
    const kit = inArena(fixtureOf('kit-rolling-start').blueprint, 'wall-stop');
    const stop = [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }] as const;
    expect(await verdictOf(challenge, kit, content.catalogue, { ticks: 240, inputs: stop })).toEqual({ met: false });
  });
});

describe('content fixtures with a goal', () => {
  it('each meets or misses its challenge as its expect says, as pnpm golden checks', async () => {
    const judge = goalJudgeFor(content);
    for (const fixture of fixtures.filter((candidate) => candidate.challenge !== undefined && candidate.expect.goal)) {
      const { record } = await runOf(fixture.blueprint, content.catalogue, { ticks: fixture.ticks, inputs: fixture.inputs, seed: fixture.seed });
      expect(judge(record, fixture.challenge as string).met, fixture.name).toBe(fixture.expect.goal?.met);
    }
  }, 30_000);

  it('never meets a challenge the content does not have', async () => {
    const roller = fixtureOf('level-1-roller');
    const { record } = await runOf(roller.blueprint, content.catalogue, { ticks: 30 });
    expect(goalJudgeFor(content)(record, 'no-such-challenge')).toEqual({ met: false });
  });
});

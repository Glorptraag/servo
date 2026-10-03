// sim-core's tick loop (task 1.5) replayed: every content fixture (@servo/content/fixtures), with its own inputs and
// ticks, and every valid schema blueprint (@servo/schema/fixtures), for one simulated second with its manual switches
// flipped both ways, gives the same run record, byte for byte, on every run, and every record validates.
// - The default run, part of `pnpm check`: three representative content fixtures 100 times, and every other content
//   fixture and every schema blueprint 10 times.
// - The sweep, `pnpm --filter @servo/tools test:determinism` (SERVO_DETERMINISM=sweep): every one of them 100 times. It is
//   slow, so it is not part of `pnpm check`.
// These run here, after every other package's tests, so that they never crowd sim-core's timing tests.
//
// Each fixture's `expect` (its faults, and its goal with a challenge) is reported, not asserted: asserting it is task
// 1.7's golden-run harness. A mismatch is a finding for task 1.7 and the content tasks.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import { canonicalJson, makeCatalogue, validateArenaPreset, validatePartRecord, validateRunRecord } from '@servo/schema';
import type { ArenaPreset, Blueprint, Catalogue, PartRecord, RunInput, RunRecord, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { createSimulation } from '@servo/sim-core';
import type { RunRecordContext, Simulation } from '@servo/sim-core';

vi.setConfig({ testTimeout: 3_600_000 });

const SWEEP = process.env.SERVO_DETERMINISM === 'sweep';

const { content } = loadContent();
const { fixtures, issues } = loadFixtures();

/** Run 100 times in the default run: a switch flipped both ways and the coast, a behaviour fault, and an electrical fault with its drain. */
const REPRESENTATIVE = new Set(['switch-in-the-line', 'broken-servo-without-signal', 'broken-short-circuit']);

const runsOf = (name: string): number => (SWEEP || REPRESENTATIVE.has(name) ? 100 : 10);

const CONTEXT: RunRecordContext = {
  id: '6f1c2d3e-4a5b-4c6d-8e7f-8091a2b3c4d5',
  startedAt: '2026-10-01T09:00:00.000Z',
  endedAt: '2026-10-01T09:00:05.000Z',
  runNumber: 1,
  hints: [],
};

/** What a replayed Run needs. */
interface Replay {
  readonly blueprint: Blueprint;
  readonly catalogue: Catalogue;
  readonly seed: number;
  readonly inputs: readonly RunInput[];
  readonly ticks: number;
  readonly challenge?: string;
}

const simulationOf = (replay: Replay): Promise<Simulation> => {
  const arena = replay.catalogue.arenas?.get(replay.blueprint.arena.preset);
  if (!arena) throw new Error(`No arena preset '${replay.blueprint.arena.preset}'.`);
  return createSimulation({ blueprint: replay.blueprint, catalogue: replay.catalogue, arena, seed: replay.seed });
};

/** The Run: each input made at its tick, before the step that applies it, to the last tick. */
const play = (simulation: Simulation, replay: Replay): RunRecord => {
  while (simulation.tick < replay.ticks) {
    for (const input of replay.inputs) if (input.tick === simulation.tick) simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
    simulation.step();
  }
  return simulation.record({ ...CONTEXT, ...(replay.challenge ? { challenge: replay.challenge } : {}) });
};

/**
 * `runs` Runs of one replay, compared byte for byte with the first: every other run a fresh Simulation, the rest restoring
 * tick 0 as Stop does. The first record must validate and keep exactly the inputs given. Gives the first record.
 */
const replayRuns = async (replay: Replay, runs: number): Promise<RunRecord> => {
  const simulation = await simulationOf(replay);
  const start = simulation.snapshot();
  const first = play(simulation, replay);
  const valid = validateRunRecord(JSON.parse(JSON.stringify(first)), replay.catalogue);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  expect(first.inputs).toEqual(replay.inputs);
  expect(first.ticks).toBe(replay.ticks);
  const reference = canonicalJson(first);
  for (let run = 1; run < runs; run += 1) {
    if (run % 2 === 0) {
      const fresh = await simulationOf(replay);
      expect(canonicalJson(play(fresh, replay))).toBe(reference);
      fresh.dispose();
    } else {
      simulation.restore(start);
      expect(canonicalJson(play(simulation, replay))).toBe(reference);
    }
  }
  simulation.dispose();
  return first;
};

const contentReplay = (fixture: ContentFixture): Replay => ({
  blueprint: fixture.blueprint,
  catalogue: content.catalogue,
  seed: fixture.seed,
  inputs: fixture.inputs,
  ticks: fixture.ticks,
  ...(fixture.challenge ? { challenge: fixture.challenge } : {}),
});

const faultText = (faults: readonly { readonly partId: string; readonly failure: string }[]): string =>
  faults
    .map((fault) => `${fault.partId}: ${fault.failure}`)
    .sort()
    .join(', ') || 'none';

beforeAll(() => {
  expect(issues).toEqual([]);
  expect(fixtures.length).toBeGreaterThan(0);
});

describe('the tick loop over the content fixtures', () => {
  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('replays %s the same, byte for byte', async (name, fixture) => {
    await replayRuns(contentReplay(fixture), runsOf(name));
  });

  it('reports each fixture’s expect: its faults (task 1.7 asserts them)', async () => {
    const lines: string[] = [];
    for (const fixture of fixtures) {
      const simulation = await simulationOf(contentReplay(fixture));
      const record = play(simulation, contentReplay(fixture));
      simulation.dispose();
      const shown = faultText(record.faults);
      const expected = faultText(fixture.expect.faults);
      const goal = fixture.expect.goal ? ` · goal ${fixture.expect.goal.met ? 'met' : 'unmet'} expected, judged by the challenge runner (task 4.5)` : '';
      const firsts = record.faults.map((fault) => `${fault.partId}: ${fault.failure} from tick ${fault.firstTick}`).join(', ');
      lines.push(shown === expected ? `holds      ${fixture.name}: ${shown}${goal}` : `MISMATCH   ${fixture.name}: shows ${firsts || 'none'}; expects ${expected}${goal}`);
    }
    console.log(`Content fixtures against their expect:\n${lines.join('\n')}`);
    expect(lines).toHaveLength(fixtures.length);
  });

  it('reports the time per tick of the 25-part build', async () => {
    const fixture = fixtures.find((each) => each.name === 'busy-workbench');
    if (!fixture) throw new Error('No busy-workbench fixture.');
    const simulation = await simulationOf(contentReplay(fixture));
    expect(new Set(simulation.blueprint.parts.map((part) => part.id)).size).toBe(25);
    const start = simulation.snapshot();
    play(simulation, contentReplay(fixture));
    // The fastest of 15 Runs: what the loop costs when it has the processor, so a busy machine does not decide it. The
    // median is printed beside it.
    const perTick = Array.from({ length: 15 }, () => {
      simulation.restore(start);
      const begin = performance.now();
      while (simulation.tick < fixture.ticks) simulation.step();
      return (performance.now() - begin) / fixture.ticks;
    }).sort((p, q) => p - q);
    simulation.dispose();
    console.log(`sim-core: ${perTick[0]?.toFixed(3)} ms a tick for the 25-part busy-workbench (fastest of 15 Runs of ${fixture.ticks} ticks; median ${perTick[7]?.toFixed(3)} ms)`);
    expect(perTick[0]).toBeGreaterThan(0);
  });
});

// The schema's valid blueprints: one simulated second each, with every manual switch flipped at tick 10 and back at tick 20.
describe('the tick loop over the schema blueprints', () => {
  const unwrap = <T>(result: ValidationResult<T>): T => {
    if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
    return result.value;
  };
  const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
  const arenas: readonly ArenaPreset[] = exampleArenas.map((arena) => unwrap(validateArenaPreset(arena)));
  const catalogue = makeCatalogue({ parts, arenas });
  const manual = (type: string): boolean =>
    parts.find((record) => record.id === type)?.behaviour.some((primitive) => primitive.kind === 'switch' && primitive.actuation.kind === 'manual') === true;
  const runs = SWEEP ? 100 : 10;

  it.each(validBlueprints.map((entry) => [entry.name, entry.data as Blueprint] as const))(`replays %s the same, byte for byte, ${runs} times`, async (_, blueprint) => {
    const switches = blueprint.parts.filter((part) => manual(part.part)).map((part) => part.id);
    const inputs = [10, 20].flatMap((tick, index) => switches.map((partId): RunInput => ({ tick, partId, kind: 'switch', closed: index === 1 })));
    await replayRuns({ blueprint, catalogue, seed: 2026, inputs, ticks: 30 }, runs);
  });
});

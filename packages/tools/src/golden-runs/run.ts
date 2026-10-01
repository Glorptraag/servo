// One golden Run: a case through sim-core's public createSimulation, tick by tick, kept as a GoldenFile beside the run
// record it gives.
import { createHash } from 'node:crypto';
import { canonicalJson } from '@servo/schema';
import type { Blueprint, Catalogue, ChallengeId, RunInput, RunRecord } from '@servo/schema';
import type { FixtureVerdict } from '@servo/content/fixtures';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame, RunRecordContext } from '@servo/sim-core';
import type { GoldenFile, GoldenTick } from './file.ts';
import { summarizeLive } from './summary.ts';

/** One Run the harness keeps a reference for. */
export interface GoldenCase {
  /** `content/<fixture>` or `schema/<blueprint>`: where its golden file lives inside packages/sim-core/golden/. */
  readonly id: string;
  readonly blueprint: Blueprint;
  /** The part records and arena presets the Run reads. */
  readonly catalogue: Catalogue;
  readonly seed: number;
  /** The switch presses, as a run record keeps them: each made at its tick and effective from the next step. */
  readonly inputs: readonly RunInput[];
  readonly ticks: number;
  readonly challenge?: ChallengeId;
  /** A content fixture's verdict, checked against the Run (expect.ts). The schema's blueprints have none. */
  readonly expect?: FixtureVerdict;
}

/** A case's Run: its golden file as it would be written now, and the run record it summarizes. */
export interface GoldenRun {
  readonly file: GoldenFile;
  readonly record: RunRecord;
}

/** What only the app knows about a Run, fixed, so the run record and its hash depend on the Run alone. */
export const RECORD_CONTEXT: RunRecordContext = {
  id: '0b7c4f2e-9d1a-4e3b-8c5f-1a2b3c4d5e6f',
  startedAt: '2026-10-01T09:00:00.000Z',
  endedAt: '2026-10-01T09:00:05.000Z',
  runNumber: 1,
  hints: [],
};

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const tickOf = (frame: RunFrame): GoldenTick => ({
  tick: frame.tick,
  hash: sha256(canonicalJson(frame.events)).slice(0, 8),
  state: summarizeLive(frame.live),
});

const inputsText = (inputs: readonly RunInput[]): string =>
  inputs.map((input) => `${input.partId} ${input.closed ? 'closed' : 'open'} at tick ${input.tick}`).join(', ') || 'none';

/**
 * Runs a case: every input made at its tick, before the step that applies it, to the last tick. Throws when the arena
 * is missing, createSimulation refuses the build, or the run record does not keep exactly the case's inputs.
 */
export const runCase = async (golden: GoldenCase): Promise<GoldenRun> => {
  const arena = golden.catalogue.arenas?.get(golden.blueprint.arena.preset);
  if (!arena) throw new Error(`The catalogue has no arena preset '${golden.blueprint.arena.preset}'.`);
  const simulation = await createSimulation({ blueprint: golden.blueprint, catalogue: golden.catalogue, arena, seed: golden.seed });
  try {
    const frames = [tickOf(simulation.frame)];
    while (simulation.tick < golden.ticks) {
      for (const input of golden.inputs) {
        if (input.tick === simulation.tick) simulation.input({ partId: input.partId, kind: input.kind, closed: input.closed });
      }
      frames.push(tickOf(simulation.step()));
    }
    const record = simulation.record({ ...RECORD_CONTEXT, ...(golden.challenge === undefined ? {} : { challenge: golden.challenge }) });
    if (canonicalJson(record.inputs) !== canonicalJson(golden.inputs)) {
      throw new Error(`The Run kept the inputs ${inputsText(record.inputs)}, not ${inputsText(golden.inputs)}: an input refused, or after the last step.`);
    }
    const partTypes = [...new Set(simulation.blueprint.parts.map((part) => part.part))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const file: GoldenFile = {
      id: golden.id,
      seed: golden.seed,
      ticks: golden.ticks,
      inputs: record.inputs,
      blueprint: sha256(canonicalJson(simulation.blueprint)).slice(0, 16),
      arena: { id: arena.id, hash: sha256(canonicalJson(arena)).slice(0, 16) },
      parts: partTypes.map((id) => ({ id, hash: sha256(canonicalJson(golden.catalogue.parts.get(id) ?? null)).slice(0, 16) })),
      record: sha256(canonicalJson(record)),
      faults: record.faults,
      subjects: [...simulation.frame.live.keys()],
      frames,
    };
    return { file, record };
  } finally {
    simulation.dispose();
  }
};

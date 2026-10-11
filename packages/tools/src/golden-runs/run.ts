// One golden Run: a case through sim-core's public createSimulation, tick by tick, kept as a GoldenFile beside the run
// record it gives.
import { createHash } from 'node:crypto';
import { canonicalJson } from '@servo/schema';
import type { Blueprint, Catalogue, ChallengeId, PartRecord, RunInput, RunRecord } from '@servo/schema';
import type { FixtureVerdict } from '@servo/content/fixtures';
import { createSimulation } from '@servo/sim-core';
import type { RunFrame, RunRecordContext } from '@servo/sim-core';
import type { GoldenFile, GoldenTick } from './file.ts';
import { summarizeFlows, summarizeLive } from './summary.ts';

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

/** `value` with every `label` field, at any depth, left out. */
const withoutLabels = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutLabels);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'label')
      .map(([key, each]) => [key, withoutLabels(each)]),
  );
};

/**
 * The part of a record the simulation reads (task 7.12): its body, ports, needs, behaviour and settings less their
 * labels, and each failure mode's id, need and unmet. The identity, the spec card, the teaching notes, hints, card lines,
 * the effects a mode shows and every label are the app's and the content validator's, so the golden file's part hash is
 * over this and a copy edit changes no golden.
 */
export const simulatedPart = (record: PartRecord): unknown => ({
  id: record.id,
  body: record.body,
  ports: withoutLabels(record.ports),
  needs: record.needs,
  behaviour: record.behaviour,
  settings: withoutLabels(record.settings),
  failureModes: record.failureModes.map(({ id, need, unmet }) => ({ id, need, unmet })),
});

const tickOf = (frame: RunFrame): GoldenTick => ({
  tick: frame.tick,
  hash: sha256(canonicalJson(frame.events)).slice(0, 8),
  state: new Map([...summarizeLive(frame.live), ...summarizeFlows(frame.flows)]),
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
      parts: partTypes.map((id) => {
        const record = golden.catalogue.parts.get(id);
        return { id, hash: sha256(canonicalJson(record ? simulatedPart(record) : null)).slice(0, 16) };
      }),
      record: sha256(canonicalJson(record)),
      faults: record.faults,
      subjects: [...frames[0]?.state.keys() ?? []],
      frames,
    };
    return { file, record };
  } finally {
    simulation.dispose();
  }
};

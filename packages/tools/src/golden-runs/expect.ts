// A content fixture's `expect` against its real Run (reviews R-2.3 and R-2.6): exactly the faults the run record lists,
// by part and failure mode; the named fault; an impossible drop refused by the schema's wiring module; and the goal of
// a named challenge. Checked on every Run, whatever its golden file says, so a reference can never lock a fault in.
import { planWire } from '@servo/schema';
import type { ChallengeId, PortRef, RunRecord } from '@servo/schema';
import type { FaultExpectation } from '@servo/content/fixtures';
import type { GoldenCase, GoldenRun } from './run.ts';

/** A challenge's verdict on a Run: the challenge runner's (task 4.5), once it exists. */
export type GoalJudge = (record: RunRecord, challenge: ChallengeId) => { readonly met: boolean; readonly tick?: number };

export interface ExpectReport {
  /** True when every check holds. */
  readonly holds: boolean;
  /** What the fixture shows, in one line: its faults (the named one marked), a refused drop, a goal. */
  readonly shows: string;
  /** One line for each check that does not hold, with the Run's numbers. */
  readonly mismatches: readonly string[];
}

const faultName = (fault: FaultExpectation): string => `${fault.partId} ${fault.failure}`;
const portName = (port: PortRef): string => `${port.part}.${port.port}`;
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A part's summarized readouts at a tick, without its faults. */
const readouts = (run: GoldenRun, partId: string, tick: number): string => {
  const fields = [...(run.file.frames[tick]?.state.get(partId) ?? [])].filter(([field]) => field !== 'faults');
  return fields.length === 0 ? 'no readouts' : fields.map(([field, value]) => `${field} ${value}`).join(', ');
};

/** The ticks a failure mode is active on a part, as the Run's live state shows it. */
const activeTicks = (run: GoldenRun, fault: FaultExpectation): number[] =>
  run.file.frames.flatMap((frame) => (frame.state.get(fault.partId)?.get('faults')?.split(',').includes(fault.failure) ? [frame.tick] : []));

/** Checks a case's `expect` against its Run. A case with no `expect` (a schema blueprint) holds. */
export const checkExpect = (golden: GoldenCase, run: GoldenRun, judge?: GoalJudge): ExpectReport => {
  const expect = golden.expect;
  if (!expect) return { holds: true, shows: '', mismatches: [] };
  const mismatches: string[] = [];
  const last = run.file.ticks;
  const shown = run.record.faults;
  const expected = new Set(expect.faults.map(faultName));
  for (const fault of shown) {
    if (expected.has(faultName(fault))) continue;
    const active = activeTicks(run, fault);
    mismatches.push(
      `shows ${faultName(fault)}, which expect does not list: from tick ${fault.firstTick}, active ${active.length} of ${last + 1} ticks` +
        ` (last at tick ${active.at(-1) ?? fault.firstTick}); ${fault.partId} at tick ${fault.firstTick}: ${readouts(run, fault.partId, fault.firstTick)}`,
    );
  }
  const seen = new Set(shown.map(faultName));
  for (const fault of expect.faults) {
    if (seen.has(faultName(fault))) continue;
    mismatches.push(`expects ${faultName(fault)}, which the Run never shows; ${fault.partId} at tick ${last}: ${readouts(run, fault.partId, last)}`);
  }
  const named = expect.namedFault;
  if (named && !seen.has(faultName(named))) mismatches.push(`its named fault ${faultName(named)} is not shown`);
  const parts: string[] = [
    expect.faults.length === 0 ? 'no fault' : expect.faults.map((fault) => (named && faultName(named) === faultName(fault) ? `${faultName(fault)} (named)` : faultName(fault))).join(', '),
  ];
  const refused = expect.refused;
  if (refused) {
    const plan = planWire(golden.blueprint, golden.catalogue, refused.from, refused.to);
    const wire = `${portName(refused.from)} → ${portName(refused.to)}`;
    if (plan.legal) mismatches.push(`planWire accepts ${wire}, which expect says it refuses with ${refused.code}`);
    else if (plan.code !== refused.code) mismatches.push(`planWire refuses ${wire} with ${plan.code}, not ${refused.code}`);
    parts.push(`planWire refuses ${wire} (${refused.code})`);
  }
  const goal = expect.goal;
  if (goal) {
    const wanted = goal.met ? 'met' : 'unmet';
    if (golden.challenge === undefined) mismatches.push(`expects the goal ${wanted}, but names no challenge`);
    else if (!judge) mismatches.push(`expects the goal of ${golden.challenge} ${wanted}, and nothing can judge it yet: the challenge runner is task 4.5`);
    else {
      const verdict = judge(run.record, golden.challenge);
      if (verdict.met !== goal.met) {
        mismatches.push(`expects the goal of ${golden.challenge} ${wanted}; the Run ${verdict.met ? `meets it at tick ${verdict.tick ?? '?'}` : `does not meet it in ${plural(last, 'tick')}`}`);
      }
    }
    parts.push(`goal ${wanted}`);
  }
  return { holds: mismatches.length === 0, shows: parts.join('; '), mismatches };
};

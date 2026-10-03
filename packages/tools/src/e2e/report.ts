// The parity report: one line per fixture, sorted, then a summary line. Pure and free of dependencies, so the CI
// step that merges the shards' reports (merge-report.ts) runs it with plain Node. See README.md, "The report".

/**
 * - `identical`: every path built every step of the plan to the reference's bytes;
 * - `partial`: the paths compared were identical, but steps were left out, or a path waited;
 * - `mismatch`: a path's bytes differ, or it could not take a step it said it could;
 * - `pending`: no step could be compared on two paths yet.
 */
export type Verdict = 'identical' | 'partial' | 'mismatch' | 'pending';

export const PARITY_HEADING = 'Input-path parity, per fixture (touch, pointer and the list view, each against plain commands):';

/** Where a run writes its report lines for merging, relative to packages/tools. */
export const REPORT_FILE = 'node_modules/e2e-report/parity.json';

/** The closing line: how many fixtures were identical, partial, mismatched and pending. */
export const reportSummary = (verdicts: readonly Verdict[]): string => {
  const count = (verdict: Verdict): number => verdicts.filter((each) => each === verdict).length;
  return `${verdicts.length} fixtures: ${count('identical')} identical, ${count('partial')} partial, ${count('mismatch')} mismatched, ${count('pending')} pending`;
};

/** A report line's fixture and verdict: `kit-rolling-start: partial: identical on …` gives `kit-rolling-start`, `partial`. */
export const readLine = (line: string): { readonly fixture: string; readonly verdict: Verdict } | undefined => {
  const match = /^([^:\s]+): (MISMATCH|identical|partial|pending)\b/.exec(line);
  if (!match) return undefined;
  const word = match[2] as string;
  return { fixture: match[1] as string, verdict: word === 'MISMATCH' ? 'mismatch' : (word as Verdict) };
};

/** The report for a set of lines, from one run or merged from several: the heading, each line once by fixture, the summary. */
export const reportText = (lines: readonly string[]): string[] => {
  const byFixture = new Map<string, string>();
  for (const line of lines) {
    const read = readLine(line);
    if (read) byFixture.set(read.fixture, line);
  }
  const sorted = [...byFixture.keys()].sort().map((fixture) => byFixture.get(fixture) as string);
  const verdicts = sorted.map((line) => (readLine(line) as { readonly verdict: Verdict }).verdict);
  return [PARITY_HEADING, ...sorted.map((line) => `  ${line}`), `  ${reportSummary(verdicts)}`];
};

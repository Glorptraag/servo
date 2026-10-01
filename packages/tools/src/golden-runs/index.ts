// Golden runs (task 1.7): a reference per content fixture and valid schema blueprint, diffed on every commit. See README.md.
export { SCHEMA_PROTOCOL, contentCase, readContentFixtures, schemaCases } from './cases.ts';
export type { ContentOnDisk } from './cases.ts';
export { USAGE, runGolden } from './cli.ts';
export type { CaseLoad, GoldenEnvironment } from './cli.ts';
export { SHOWN_CHANGES, describeDiff, diffGolden } from './diff.ts';
export type { FieldChange, GoldenDiff, TickChange } from './diff.ts';
export { checkExpect } from './expect.ts';
export type { ExpectReport, GoalJudge } from './expect.ts';
export { GOLDEN_EXTENSION, GOLDEN_FORMAT, formatGolden, parseGolden } from './file.ts';
export type { GoldenFile, GoldenParse, GoldenTick, InputHash } from './file.ts';
export { RECORD_CONTEXT, runCase, sha256 } from './run.ts';
export type { GoldenCase, GoldenRun } from './run.ts';
export { FIELD_ORDER, NONE, PRECISION, applyChanges, changedFields, formatNumber, summarizeLive, summarizeSubject } from './summary.ts';
export type { SubjectState, TickState } from './summary.ts';

import type { Issue, ValidationResult } from '../types/issue.ts';
import { reportNewerVersion } from '../validate/blueprint.ts';
import { field, isRecord, readNumber, report, runValidator } from '../validate/reader.ts';
import type { Ctx } from '../validate/reader.ts';

/**
 * One pure migration step: it reads a document of version `from` strictly and writes the same build as
 * version `to`, which is always `from + 1`. Pure means the same document always gives the same result:
 * no clock, no randomness, no I/O and no catalogue, since content changes between releases. A step never
 * throws: a document it cannot read comes back as issues whose paths point into that document. Once a
 * step has shipped it never changes, because stored blueprints depend on exactly what it writes.
 */
export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly migrate: (document: unknown) => ValidationResult<unknown>;
}

/** The migrated document and the version it was stored at, or every reason it could not be migrated. */
export type MigrationResult<T> =
  | { readonly ok: true; readonly value: T; readonly from: number }
  | { readonly ok: false; readonly issues: readonly Issue[] };

const readVersion = (ctx: Ctx, root: unknown, oldest: number, current: number): number | undefined => {
  if (!isRecord(root)) {
    report(ctx, 'value.wrong_type', '$', 'Expected an object.');
    return undefined;
  }
  const version = field(root, 'version');
  if (version === undefined) {
    report(ctx, 'value.missing', '$.version', "Missing 'version'. A document without one is never guessed at.");
    return undefined;
  }
  const found = readNumber(ctx, version, '$.version', { min: oldest, integer: true });
  if (found === undefined) return undefined;
  if (found > current) {
    reportNewerVersion(ctx, '$.version', found, current);
    return undefined;
  }
  // Adding zero turns a stored -0 into 0.
  return found + 0;
};

const UNREADABLE: Issue = { code: 'value.unreadable', path: '$', message: 'The data could not be read: a property threw or the structure loops.' };

/**
 * A refusal. Issues about a document the steps made, rather than the stored one, keep their codes and
 * paths (which point into that document) and say in their message which document they mean.
 */
const refused = (issues: readonly Issue[], from: number, reached: number): MigrationResult<never> => ({
  ok: false,
  issues:
    reached === from
      ? issues
      : issues.map((issue) => ({ ...issue, message: `After migrating from version ${from} to version ${reached}: ${issue.message}` })),
});

const attempt = <T>(run: () => ValidationResult<T>): ValidationResult<T> => {
  try {
    return run();
  } catch {
    return { ok: false, issues: [UNREADABLE] };
  }
};

/**
 * Migrates a stored document to version `current` one step at a time, then checks the result with `read`,
 * the current version's own reader. Never throws.
 * - `version` is read first. Missing, not a whole number, or below the oldest step is refused with the
 *   reader kit's codes; above `current` is refused as `blueprint.newer_version`.
 * - The step that reads each version from the stored one up runs in turn, and the first refusal ends the run.
 * - A document already at `current` runs no step, and `from` equals `current`.
 */
export const runMigrations = <T>(
  value: unknown,
  steps: readonly MigrationStep[],
  current: number,
  read: (document: unknown) => ValidationResult<T>,
): MigrationResult<T> => {
  const oldest = steps.reduce((lowest, step) => Math.min(lowest, step.from), current);
  const version = runValidator(value, (ctx, root) => readVersion(ctx, root, oldest, current));
  if (!version.ok) return version;
  const from = version.value;
  let document = value;
  for (let at = from; at < current; at += 1) {
    const step = steps.find((candidate) => candidate.from === at && candidate.to === at + 1);
    if (!step) return refused([{ code: 'value.out_of_range', path: '$.version', message: `No migration reads version ${at}.` }], from, at);
    const result = attempt(() => step.migrate(document));
    if (!result.ok) return refused(result.issues, from, at);
    document = result.value;
  }
  const checked = attempt(() => read(document));
  return checked.ok ? { ok: true, value: checked.value, from } : refused(checked.issues, from, current);
};

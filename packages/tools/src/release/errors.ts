/** A problem that stops a release, said so a person can fix it: a summary line, then one line per problem. */
export class ReleaseError extends Error {
  readonly problems: readonly string[];

  constructor(summary: string, problems: readonly string[] = []) {
    super([summary, ...problems.map((problem) => `  - ${problem}`)].join('\n'));
    this.name = 'ReleaseError';
    this.problems = problems;
  }
}

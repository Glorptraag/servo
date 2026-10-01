// Prints the parity report when the run ends: the line each parity test annotated for its fixture, in the order the
// tests ran, then the summary line. Runs in Node, in Vitest's reporter chain (vitest.config.ts).
import type { Reporter, TestCase, Vitest } from 'vitest/node';

/** The annotation type the parity tests give their report lines. */
export const PARITY_ANNOTATION = 'parity';

export const PARITY_HEADING = 'Input-path parity, per fixture (touch, pointer and the list view, each against plain commands):';

export class ParityReporter implements Reporter {
  private lines: string[] = [];
  private vitest: Vitest | undefined;

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
  }

  onTestRunStart(): void {
    this.lines = [];
  }

  onTestCaseAnnotate(_testCase: TestCase, annotation: { readonly type: string; readonly message: string }): void {
    if (annotation.type === PARITY_ANNOTATION) this.lines.push(annotation.message);
  }

  onTestRunEnd(): void {
    if (this.lines.length === 0) return;
    const log = (line: string): void => {
      if (this.vitest) this.vitest.logger.log(line);
      else process.stdout.write(`${line}\n`);
    };
    log('');
    log(PARITY_HEADING);
    for (const line of this.lines) log(`  ${line}`);
  }
}

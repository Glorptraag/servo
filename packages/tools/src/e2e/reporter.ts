// Prints the parity report when the run ends, from the line each parity test annotated for its fixture: sorted by
// fixture, with a summary line (report.ts). It also writes the lines to REPORT_FILE, so CI can merge the shards'
// reports into one (merge-report.ts). Runs in Node, in Vitest's reporter chain (vitest.config.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, Vitest } from 'vitest/node';
import { REPORT_FILE, reportText } from './report.ts';

/** The annotation type the parity tests give their report lines. */
export const PARITY_ANNOTATION = 'parity';

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
    for (const line of reportText(this.lines)) log(line);
    const file = path.resolve(this.vitest?.config.root ?? process.cwd(), REPORT_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ lines: this.lines }, null, 2)}\n`);
  }
}

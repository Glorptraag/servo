// Prints one parity report merged from the reports of the CI shards that ran the parity check:
//   node packages/tools/src/e2e/merge-report.ts <folder>
// reads every parity.json below <folder> (each shard's REPORT_FILE, downloaded as an artifact). Plain Node: no
// dependencies. See README.md, "CI".
import fs from 'node:fs';
import path from 'node:path';
import { reportText } from './report.ts';

const folder = process.argv[2];
if (!folder) {
  process.stderr.write('Usage: node packages/tools/src/e2e/merge-report.ts <folder of parity.json reports>\n');
  process.exit(2);
}
const files = fs
  .readdirSync(folder, { recursive: true, encoding: 'utf8' })
  .filter((name) => path.basename(name) === 'parity.json')
  .sort();
const lines = files.flatMap((name) => {
  const data = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')) as { readonly lines?: unknown };
  return Array.isArray(data.lines) ? data.lines.filter((line): line is string => typeof line === 'string') : [];
});
if (lines.length === 0) {
  process.stderr.write(`No parity report lines under ${folder}.\n`);
  process.exit(1);
}
process.stdout.write(`${reportText(lines).join('\n')}\n`);

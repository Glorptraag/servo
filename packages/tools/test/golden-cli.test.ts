// `pnpm golden` (task 1.7) on a temporary golden folder: a missing reference, --accept, a Run that matches, one that
// changed, stale and unreadable files, a case that cannot run, a fixture whose expect does not hold, and misuse. The
// real command's cases and its plain-Node entry are checked by spawning it in its own describe block.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { makeCatalogue } from '@servo/schema';
import type { PartRecord } from '@servo/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { USAGE, contentCase, formatGolden, runCase, runGolden, schemaCases } from '../src/golden-runs/index.ts';
import type { CaseLoad, GoldenCase } from '../src/golden-runs/index.ts';

vi.setConfig({ testTimeout: 120_000 });

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = fileURLToPath(new URL('../src/golden-runs/main.ts', import.meta.url));

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

/** A fresh folder for golden files, removed after each test. */
const goldenFolder = (): string => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'servo-golden-')));
  made.push(folder);
  return path.join(folder, 'golden');
};

const schemaCase = (name: string): GoldenCase => {
  const found = schemaCases().find((each) => each.id === `schema/${name}`);
  if (!found) throw new Error(`No schema case '${name}'.`);
  return found;
};

const TWO = [schemaCase('led-circuit'), schemaCase('rolling-start')];

interface Ran {
  readonly status: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

const golden = async (folder: string, argv: readonly string[], load: CaseLoad | readonly GoldenCase[] = TWO): Promise<Ran> => {
  const out: string[] = [];
  const err: string[] = [];
  const cases = 'cases' in load ? load : { cases: load, issues: [] };
  const status = await runGolden(argv, { cwd: path.dirname(folder), goldenDir: folder, cases: () => cases, out: (line) => out.push(line), err: (line) => err.push(line) });
  return { status, out, err };
};

const statusOf = (ran: Ran, id: string): string | undefined =>
  ran.out.map((line) => line.trim().split(/\s+/)).find((words) => words[1] === id)?.[0];

const read = (folder: string, id: string): string => fs.readFileSync(path.join(folder, `${id}.golden`), 'utf8');

/** The rolling-start robot's DC motors 5% slower: a change that moves every tick it drives. */
const slowerMotors = (golden: GoldenCase): GoldenCase => {
  const parts = [...golden.catalogue.parts.values()].map((record): PartRecord =>
    record.id !== 'dc-motor'
      ? record
      : {
          ...record,
          behaviour: record.behaviour.map((primitive) =>
            primitive.kind === 'actuator' && primitive.mode === 'speed' ? { ...primitive, noLoadRpm: primitive.noLoadRpm * 0.95 } : primitive,
          ),
        },
  );
  return { ...golden, catalogue: makeCatalogue({ parts, arenas: [...(golden.catalogue.arenas?.values() ?? [])] }) };
};

describe('pnpm golden', () => {
  it('fails while a case has no golden file, and --accept writes it', async () => {
    const folder = goldenFolder();
    const first = await golden(folder, []);
    expect(first.status).toBe(1);
    expect(first.out[0]).toBe('golden: 2 Runs (2 schema blueprints) against golden/');
    expect(statusOf(first, 'schema/led-circuit')).toBe('MISSING');
    expect(first.out).toContain('golden: 2 cases do not match their golden files.');
    expect(first.out).toContain('  If the change is intended, run `pnpm golden --accept schema/led-circuit schema/rolling-start` and note why for the orchestrator (docs/plan.md Section 8).');
    expect(fs.existsSync(folder)).toBe(false);

    const accepted = await golden(folder, ['--accept']);
    expect(accepted.status).toBe(0);
    expect(statusOf(accepted, 'schema/rolling-start')).toBe('written');
    expect(accepted.out.at(-1)).toBe('golden --accept: wrote 2 golden files (0 changed, 2 new), removed 0, left 0 unchanged.');
    expect(read(folder, 'schema/rolling-start')).toBe(formatGolden((await runCase(schemaCase('rolling-start'))).file));

    const again = await golden(folder, []);
    expect(again.status).toBe(0);
    expect(again.out).toEqual(['golden: 2 Runs (2 schema blueprints) against golden/', '  same       schema/led-circuit', '  same       schema/rolling-start', 'golden: 2 Runs match their golden files.']);
  });

  it('fails a changed Run with a readable diff, and --accept takes the change and prints it', async () => {
    const folder = goldenFolder();
    await golden(folder, ['--accept']);
    const changed = [schemaCase('led-circuit'), slowerMotors(schemaCase('rolling-start'))];

    const check = await golden(folder, [], changed);
    expect(check.status).toBe(1);
    expect(statusOf(check, 'schema/led-circuit')).toBe('same');
    expect(statusOf(check, 'schema/rolling-start')).toBe('DIFFERS');
    const at = check.out.findIndex((line) => line.includes('schema/rolling-start'));
    expect(check.out.slice(at + 1, at + 3)).toEqual(['             inputs: the part record dc-motor changed', expect.stringMatching(/^ {13}ticks: \d+ of 31 differ, the first at tick 0:$/)]);
    expect(check.out).toContainEqual(expect.stringMatching(/^ {15}motor-left\.rpm +[\d.]+ → [\d.]+$/));
    expect(check.out).toContainEqual(expect.stringMatching(/^ {13}run record: sha256 [0-9a-f]{12}… → [0-9a-f]{12}…$/));

    const accepted = await golden(folder, ['--accept', 'rolling-start'], changed);
    expect(accepted.status).toBe(0);
    expect(statusOf(accepted, 'schema/rolling-start')).toBe('accepted');
    expect(accepted.out).toContainEqual(expect.stringMatching(/^ {15}motor-left\.rpm +[\d.]+ → [\d.]+$/));
    expect(accepted.out.at(-1)).toBe('golden --accept: wrote 1 golden file (1 changed, 0 new), removed 0, left 0 unchanged.');
    expect((await golden(folder, [], changed)).status).toBe(0);
  });

  it('reports a golden file a hand changed, line by line, as the Run sees it', async () => {
    const folder = goldenFolder();
    await golden(folder, ['--accept']);
    const file = path.join(folder, 'schema/rolling-start.golden');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.replace(/^( {2}chassis x=)([\d.]+)/m, '$1999'));
    const check = await golden(folder, []);
    expect(check.status).toBe(1);
    expect(check.out).toContainEqual(expect.stringMatching(/^ {15}chassis\.x {2}999 → [\d.]+$/));
    // Line endings a checkout changed are no change.
    fs.writeFileSync(file, text.replaceAll('\n', '\r\n'));
    expect((await golden(folder, [])).status).toBe(0);
  });

  it('reports golden files no case has, and --accept removes them', async () => {
    const folder = goldenFolder();
    await golden(folder, ['--accept']);
    fs.copyFileSync(path.join(folder, 'schema/led-circuit.golden'), path.join(folder, 'schema/gone.golden'));
    const check = await golden(folder, []);
    expect(check.status).toBe(1);
    expect(statusOf(check, 'schema/gone')).toBe('STALE');
    expect(check.out.slice(-2)).toEqual(['golden: 1 case does not match its golden file.', '  `pnpm golden --accept`, with no case named, removes golden files no case has.']);
    expect((await golden(folder, ['led-circuit'])).status).toBe(0);
    const accepted = await golden(folder, ['--accept']);
    expect(statusOf(accepted, 'schema/gone')).toBe('removed');
    expect(fs.existsSync(path.join(folder, 'schema/gone.golden'))).toBe(false);
    expect((await golden(folder, [])).status).toBe(0);
  });

  it('reports a golden file it cannot read, and --accept rewrites it', async () => {
    const folder = goldenFolder();
    await golden(folder, ['--accept']);
    fs.writeFileSync(path.join(folder, 'schema/led-circuit.golden'), '<<<<<<< HEAD\n');
    const check = await golden(folder, []);
    expect(check.status).toBe(1);
    expect(statusOf(check, 'schema/led-circuit')).toBe('UNREADABLE');
    expect(check.out).toContain("             its golden file cannot be read, line 1: Unknown line '<<<<<<< HEAD'.");
    expect((await golden(folder, ['--accept'])).status).toBe(0);
    expect((await golden(folder, [])).status).toBe(0);
  });

  it('fails a case that cannot run, and never writes it', async () => {
    const folder = goldenFolder();
    const broken = { ...schemaCase('led-circuit'), blueprint: { ...schemaCase('led-circuit').blueprint, arena: { preset: 'nowhere', props: [] } } };
    for (const argv of [[], ['--accept']]) {
      const ran = await golden(folder, argv, [broken]);
      expect(ran.status).toBe(1);
      expect(statusOf(ran, 'schema/led-circuit')).toBe('FAILED');
      expect(ran.out).toContain("             could not run: The catalogue has no arena preset 'nowhere'.");
      expect(ran.out).toContain('golden: 1 case could not run.');
    }
    expect(fs.existsSync(path.join(folder, 'schema/led-circuit.golden'))).toBe(false);
  });

  it('fails a fixture whose expect does not hold, even with --accept', async () => {
    const folder = goldenFolder();
    const { content } = loadContent();
    const fixture = loadFixtures().fixtures.find((each) => each.name === 'broken-servo-without-signal');
    if (!fixture) throw new Error('No broken-servo-without-signal fixture.');
    const wrong = { ...contentCase(fixture, content.catalogue), expect: { faults: [] } };
    for (const argv of [['--accept'], []]) {
      const ran = await golden(folder, argv, [wrong]);
      expect(ran.status).toBe(1);
      expect(ran.out[1]).toMatch(/^ {2}(written|same) +content\/broken-servo-without-signal {2}expect DOES NOT HOLD: no fault$/);
      expect(ran.out).toContainEqual(expect.stringMatching(/^ {13}expect: shows servo no-signal, which expect does not list: from tick 2, active 59 of 61 ticks/));
      expect(ran.out.at(-1)).toBe(
        'golden: the expect of 1 content fixture does not hold: content/broken-servo-without-signal. That is a finding for the fixture or the simulation, and --accept never makes it hold.',
      );
    }
  });

  it('stops on content issues, and on misuse', async () => {
    const folder = goldenFolder();
    const issues = await golden(folder, [], { cases: TWO, issues: ['parts/dc-motor.json: value.missing at $.ports: Missing ports.'] });
    expect(issues.status).toBe(1);
    expect(issues.err).toEqual([
      'parts/dc-motor.json: value.missing at $.ports: Missing ports.',
      'golden: the content has 1 issue, so its fixtures cannot run. `pnpm validate-content packages/content` says more.',
    ]);
    const unknown = await golden(folder, ['no-such-case']);
    expect(unknown.status).toBe(2);
    expect(unknown.err[0]).toMatch(/^golden: no case 'no-such-case'\./);
    expect((await golden(folder, ['--force'])).status).toBe(2);
    const help = await golden(folder, ['--help']);
    expect(help).toEqual({ status: 0, out: [USAGE], err: [] });
  });

  it('picks cases by id, by name or by kind', async () => {
    const folder = goldenFolder();
    const cases = [...TWO, schemaCase('short-circuit'), schemaCase('switch-across-pack')];
    expect((await golden(folder, ['--accept', 'schema/led-circuit'], cases)).out[0]).toBe('golden --accept: 1 Run (1 schema blueprint) against golden/');
    expect((await golden(folder, ['short-circuit', 'led-circuit'], cases)).out.slice(1, 3).map((line) => line.trim().split(/\s+/)[1])).toEqual([
      'schema/led-circuit',
      'schema/short-circuit',
    ]);
    const kind = await golden(folder, ['schema'], cases);
    expect(kind.out[0]).toBe('golden: 4 Runs (4 schema blueprints) against golden/');
    // Past three cases, the hint names none.
    expect(kind.out.slice(-2)).toEqual([
      'golden: 3 cases do not match their golden files.',
      '  If the change is intended, run `pnpm golden --accept schema/rolling-start schema/short-circuit schema/switch-across-pack` and note why for the orchestrator (docs/plan.md Section 8).',
    ]);
    fs.rmSync(path.join(folder, 'schema/led-circuit.golden'));
    expect((await golden(folder, [], cases)).out.at(-1)).toBe(
      '  If every change is intended, run `pnpm golden --accept`, or name the cases you meant, and note why for the orchestrator (docs/plan.md Section 8).',
    );
  });
});

describe('pnpm golden, the command', () => {
  it('runs under plain Node and prints its help', () => {
    const ran = spawnSync(process.execPath, [MAIN, '--help'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(`${USAGE}\n`);
  });

  it('checks one real case against packages/sim-core/golden', () => {
    const ran = spawnSync(process.execPath, [MAIN, 'content/switch-in-the-line'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, INIT_CWD: REPO_ROOT } });
    expect(ran.stderr).toBe('');
    expect(ran.stdout.split('\n')[0]).toBe(`golden: 1 Run (1 content fixture) against ${path.join('packages', 'sim-core', 'golden')}${path.sep}`);
    expect(ran.status).toBe(0);
  });
});

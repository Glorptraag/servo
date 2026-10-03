// The golden-run harness's parts (task 1.7): the per-tick summary, the golden file's text both ways, the diff and its
// lines, each content fixture's expect, and content read from disk as the command reads it. The command itself is in
// golden-cli.test.ts.
import { fileURLToPath } from 'node:url';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import type { ContentFixture } from '@servo/content/fixtures';
import { canonicalJson, validateRunRecord } from '@servo/schema';
import type { IssueCode, RunEvent } from '@servo/schema';
import type { LiveState } from '@servo/sim-core';
import { describe, expect, it, vi } from 'vitest';
import {
  NONE,
  SCHEMA_PROTOCOL,
  applyChanges,
  changedFields,
  checkExpect,
  contentCase,
  describeDiff,
  diffGolden,
  formatGolden,
  formatNumber,
  parseGolden,
  readContentFixtures,
  runCase,
  schemaCases,
  sha256,
  summarizeSubject,
} from '../src/golden-runs/index.ts';
import type { GoldenCase, GoldenFile, GoldenRun, GoldenTick, SubjectState } from '../src/golden-runs/index.ts';

vi.setConfig({ testTimeout: 120_000 });

const CONTENT = fileURLToPath(new URL('../../content/', import.meta.url));

const { content } = loadContent();
const { fixtures } = loadFixtures();

const fixture = (name: string): ContentFixture => {
  const found = fixtures.find((each) => each.name === name);
  if (!found) throw new Error(`No content fixture '${name}'.`);
  return found;
};

const schemaCase = (name: string): GoldenCase => {
  const found = schemaCases().find((each) => each.id === `schema/${name}`);
  if (!found) throw new Error(`No schema case '${name}'.`);
  return found;
};

const runs = new Map<string, Promise<GoldenRun>>();
/** Each case runs once per file: the tests below only read its Run. */
const ran = (golden: GoldenCase): Promise<GoldenRun> => {
  const run = runs.get(golden.id) ?? runCase(golden);
  runs.set(golden.id, run);
  return run;
};

const live = (state: Partial<LiveState>): LiveState => ({ values: {}, sounds: [], faults: [], ...state });

/** A copy of a golden file with one tick's state or hash changed. */
const withTick = (file: GoldenFile, tick: number, change: (frame: GoldenTick) => GoldenTick): GoldenFile => ({
  ...file,
  frames: file.frames.map((frame) => (frame.tick === tick ? change(frame) : frame)),
});

const withField = (frame: GoldenTick, subject: string, field: string, value: string): GoldenTick => ({
  ...frame,
  state: new Map([...frame.state].map(([name, fields]) => [name, name === subject ? applyChanges(fields, new Map([[field, value]])) : fields])),
});

describe('golden runs: the per-tick summary', () => {
  it('rounds each number to its precision, drops trailing zeros and never writes -0', () => {
    expect(formatNumber(2.792544558615017, 3)).toBe('2.793');
    expect(formatNumber(2.9, 3)).toBe('2.9');
    expect(formatNumber(1, 4)).toBe('1');
    expect(formatNumber(300, 1)).toBe('300');
    expect(formatNumber(-0.04, 1)).toBe('0');
    expect(formatNumber(-0, 2)).toBe('0');
    expect(formatNumber(-12.25, 1)).toBe('-12.3');
    expect(formatNumber(Number.NaN, 1)).toBe('NaN');
  });

  it('summarizes readouts, the pose, sounds and faults, in a fixed order', () => {
    const state = summarizeSubject(
      live({
        values: { closed: true, rpm: 71.36894800449964, volts: 2.792544558615017, milliamps: 258.3456007203669 },
        motion: { x: 328.9544677734375, y: 600, heading: -0.004, pitch: 0, roll: 0 },
        sounds: [
          { sound: 'buzz', level: 0.8, hz: 2400 },
          { sound: 'motor', level: 0.3568447400224982 },
        ],
        faults: ['low-voltage', 'overload'],
      }),
    );
    expect([...state]).toEqual([
      ['volts', '2.793'],
      ['milliamps', '258.3'],
      ['rpm', '71.4'],
      ['closed', 'true'],
      ['x', '329'],
      ['y', '600'],
      ['heading', '0'],
      ['pitch', '0'],
      ['roll', '0'],
      ['sound.motor', '0.357'],
      ['sound.buzz', '0.8@2400hz'],
      ['faults', 'low-voltage,overload'],
    ]);
  });

  it('writes what changed, with none for a sound that stopped or faults that ended, and folds it back', () => {
    const was: SubjectState = new Map([
      ['volts', '2.9'],
      ['sound.motor', '0.5'],
      ['faults', 'overload'],
    ]);
    const now: SubjectState = new Map([
      ['volts', '2.8'],
      ['sound.hum', '0.2'],
    ]);
    const changes = changedFields(now, was);
    expect([...changes]).toEqual([
      ['volts', '2.8'],
      ['sound.motor', NONE],
      ['sound.hum', '0.2'],
      ['faults', NONE],
    ]);
    expect([...applyChanges(was, changes)]).toEqual([...now]);
    expect(changedFields(now, now).size).toBe(0);
  });
});

describe('golden runs: a Run', () => {
  it('keeps every tick, each tick hashing its events, and the hash of the whole run record', async () => {
    const golden = schemaCase('switch-across-pack');
    const { file, record } = await ran(golden);
    expect(file.frames.map((frame) => frame.tick)).toEqual(Array.from({ length: SCHEMA_PROTOCOL.ticks + 1 }, (_, tick) => tick));
    expect(file.record).toBe(sha256(canonicalJson(record)));
    const valid = validateRunRecord(JSON.parse(JSON.stringify(record)), golden.catalogue);
    expect(valid.ok ? [] : valid.issues).toEqual([]);
    const byTick = (tick: number): RunEvent[] => (record.events ?? []).filter((event) => event.tick === tick);
    expect(file.frames.map((frame) => frame.hash)).toEqual(file.frames.map((frame) => sha256(canonicalJson(byTick(frame.tick))).slice(0, 8)));
    expect(file.inputs).toEqual(golden.inputs);
    expect(file.faults).toEqual(record.faults);
    // The parts, then each wire's flow (D78): the canvas's moving dots follow them.
    expect(file.subjects).toEqual(['battery', 'switch', 'wire:w1', 'wire:w2']);
    // Debounced: the short shows from tick 2, ends 3 ticks after the switch opens at tick 10, and shows again from tick 23.
    const shorted = file.frames.filter((frame) => frame.state.get('battery')?.get('faults') === 'short-circuit').map((frame) => frame.tick);
    expect(shorted[0]).toBe(2);
    expect(file.faults.map((fault) => `${fault.partId} ${fault.failure} ${fault.firstTick}`)).toEqual(['battery short-circuit 2', 'switch across-the-pack 2']);
  });

  it('gives the same file on every Run', async () => {
    const golden = schemaCase('rolling-start');
    expect(formatGolden((await runCase(golden)).file)).toBe(formatGolden((await ran(golden)).file));
  });

  it('refuses a case whose inputs the Run does not keep', async () => {
    const golden = schemaCase('rolling-start');
    // The switch starts closed, so closing it is refused and the run record keeps no input.
    await expect(runCase({ ...golden, inputs: [{ tick: 0, partId: 'switch', kind: 'switch', closed: true }] })).rejects.toThrow(
      'The Run kept the inputs none, not switch closed at tick 0: an input refused, or after the last step.',
    );
    await expect(runCase({ ...golden, inputs: [{ tick: 30, partId: 'switch', kind: 'switch', closed: false }] })).rejects.toThrow(/not switch open at tick 30/);
    await expect(runCase({ ...golden, blueprint: { ...golden.blueprint, arena: { preset: 'nowhere', props: [] } } })).rejects.toThrow("The catalogue has no arena preset 'nowhere'.");
  });
});

describe('golden runs: the golden file', () => {
  it('reads back to the same file, for content fixtures and schema blueprints alike', async () => {
    for (const golden of [schemaCase('switch-across-pack'), contentCase(fixture('switch-in-the-line'), content.catalogue)]) {
      const { file } = await ran(golden);
      const text = formatGolden(file);
      const parsed = parseGolden(text);
      if (!parsed.ok) throw new Error(`line ${parsed.line}: ${parsed.message}`);
      expect(parsed.file).toEqual(file);
      expect(formatGolden(parsed.file)).toBe(text);
      expect(parseGolden(text.replaceAll('\n', '\r\n'))).toEqual(parsed);
    }
  });

  it('writes the header, then each tick with only what changed', async () => {
    const text = formatGolden((await ran(schemaCase('switch-across-pack'))).file);
    const lines = text.split('\n');
    expect(lines.slice(2, 16)).toEqual([
      'golden 1',
      'case schema/switch-across-pack',
      'seed 2026',
      'ticks 30',
      'input 10 switch closed=false',
      'input 20 switch closed=true',
      expect.stringMatching(/^blueprint [0-9a-f]{16}$/),
      expect.stringMatching(/^arena open-floor [0-9a-f]{16}$/),
      expect.stringMatching(/^part battery-pack-2-cell [0-9a-f]{16}$/),
      expect.stringMatching(/^part switch [0-9a-f]{16}$/),
      expect.stringMatching(/^record [0-9a-f]{64}$/),
      'fault battery short-circuit first-tick=2',
      'fault switch across-the-pack first-tick=2',
      'subjects battery switch wire:w1 wire:w2',
    ]);
    expect(lines[16]).toMatch(/^tick 0 [0-9a-f]{8}$/);
    expect(lines[17]).toBe('  battery volts=0 milliamps=7500 charge=1 x=240 y=600 heading=0');
    // What flows along each wire, signed from its `from` port to its `to` port: round the short and back.
    expect(lines.slice(19, 21)).toEqual(['  wire:w1 milliamps=7500', '  wire:w2 milliamps=-7500']);
    expect(lines.filter((line) => line.startsWith('tick '))).toHaveLength(31);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('says where a file cannot be read', async () => {
    const text = formatGolden((await ran(schemaCase('switch-across-pack'))).file);
    const unreadable = (changed: string): string => {
      const parsed = parseGolden(changed);
      return parsed.ok ? 'read' : `line ${parsed.line}: ${parsed.message}`;
    };
    expect(unreadable(text.replace('golden 1', 'golden 2'))).toBe('line 3: This file is format 2; this harness reads format 1.');
    expect(unreadable(text.replace('seed 2026\n', ''))).toBe('line 16: The header lacks seed.');
    expect(unreadable(text.replace(/tick 4 [0-9a-f]{8}\n/, ''))).toMatch(/^line \d+: Expected tick 4, not tick 5\.$/);
    expect(unreadable(text.replace('charge=1 ', 'charge=1 gear=2 '))).toBe("line 18: 'gear' is not a field a golden file keeps.");
    expect(unreadable(text.replace('  battery volts=0', '  motor volts=0'))).toBe("line 18: 'motor' is not in the subjects line.");
    expect(unreadable(text.replace(/^record [0-9a-f]+$/m, 'record 1234'))).toBe("line 13: Expected the run record's hash as 64 lower-case hex digits, not '1234'.");
    const last = text.split('\n').length - 1;
    expect(unreadable(text.replace('ticks 30', 'ticks 31'))).toBe(`line ${last}: The Run has 31 ticks, so the file needs ticks 0 to 31; it has 0 to 30.`);
    expect(unreadable(`${text}<<<<<<< HEAD\n`)).toBe(`line ${last + 1}: '<<<<<<<' belongs in the header, before the first tick.`);
    expect(unreadable(text.replace('subjects battery switch', 'subjects battery switch battery'))).toBe('line 16: A subject is listed twice.');
  });
});

describe('golden runs: the diff', () => {
  it('finds no difference between a Run and its own file', async () => {
    const { file } = await ran(schemaCase('rolling-start'));
    expect(diffGolden(file, file)).toBeUndefined();
  });

  it('names the first tick that differs, its fields old and new, and how many ticks differ', async () => {
    const { file } = await ran(schemaCase('rolling-start'));
    const was = withTick(withTick(file, 7, (frame) => withField(frame, 'motor-left', 'rpm', '1.5')), 9, (frame) => ({ ...frame, hash: '00000000' }));
    const diff = diffGolden(was, file);
    expect(diff?.differing).toEqual([7, 9]);
    expect(diff?.first).toEqual({ tick: 7, changes: [{ subject: 'motor-left', field: 'rpm', was: '1.5', now: file.frames[7]?.state.get('motor-left')?.get('rpm') }] });
    expect(diff?.inputs).toEqual([]);
    expect(describeDiff(diff ?? (undefined as never))).toEqual([
      'inputs: the same blueprint, arena, part records, seed, ticks and switch presses, so the simulation changed',
      'ticks: 2 of 31 differ, the first at tick 7:',
      `  motor-left.rpm  1.5 → ${file.frames[7]?.state.get('motor-left')?.get('rpm') ?? ''}`,
      'faults: the same',
    ]);
  });

  it('says when the events differ below the summary’s precision', async () => {
    const { file } = await ran(schemaCase('rolling-start'));
    const diff = diffGolden(withTick(file, 3, (frame) => ({ ...frame, hash: 'ffffffff' })), file);
    expect(describeDiff(diff ?? (undefined as never)).slice(1, 3)).toEqual([
      'ticks: 1 of 31 differ, the first at tick 3:',
      "  every summarized field is the same: the events differ below the summary's precision",
    ]);
  });

  it('shows the first summarized difference too when it comes later', async () => {
    const { file } = await ran(schemaCase('rolling-start'));
    const was = withTick(withTick(file, 3, (frame) => ({ ...frame, hash: 'ffffffff' })), 5, (frame) => withField(frame, 'chassis', 'x', '1'));
    const lines = describeDiff(diffGolden(was, file) ?? (undefined as never));
    expect(lines[1]).toBe('ticks: 2 of 31 differ, the first at tick 3:');
    expect(lines[3]).toBe('the first summarized difference is at tick 5:');
    expect(lines[4]).toMatch(/^ {2}chassis\.x {2}1 → \d/);
  });

  it('says which input changed, the faults that differ and the run record’s hash', async () => {
    const { file } = await ran(schemaCase('switch-across-pack'));
    const was: GoldenFile = {
      ...file,
      seed: 1,
      parts: file.parts.map((part) => (part.id === 'switch' ? { ...part, hash: '0123456789abcdef' } : part)),
      faults: [{ partId: 'battery', failure: 'short-circuit', firstTick: 0 }],
      record: '0'.repeat(64),
    };
    expect(describeDiff(diffGolden(was, file) ?? (undefined as never))).toEqual([
      'inputs: the part record switch changed; the seed is 2026, not 1',
      'ticks: all 31 are the same',
      'faults:',
      '  − battery short-circuit from tick 0',
      '  + battery short-circuit from tick 2',
      '  + switch across-the-pack from tick 2',
      `run record: sha256 000000000000… → ${file.record.slice(0, 12)}…`,
    ]);
  });

  it('counts the ticks only one Run has', async () => {
    const { file } = await ran(schemaCase('rolling-start'));
    const shorter: GoldenFile = { ...file, ticks: 20, frames: file.frames.slice(0, 21) };
    const diff = diffGolden(shorter, file);
    expect(diff?.inputs).toEqual(['it runs 30 ticks, not 20']);
    expect(diff?.differing).toEqual(Array.from({ length: 10 }, (_, index) => 21 + index));
  });

  it('lists at most 12 fields of a tick, then how many more', async () => {
    const { file } = await ran(schemaCase('rolling-start'));
    const empty = withTick(file, 0, (frame) => ({ ...frame, state: new Map([...frame.state].map(([subject]) => [subject, new Map()])) }));
    const lines = describeDiff(diffGolden(empty, file) ?? (undefined as never));
    const listed = lines.slice(2).filter((line) => line.startsWith('  '));
    expect(listed).toHaveLength(13);
    expect(listed.at(-1)).toMatch(/^ {2}and \d+ more fields$/);
    expect(listed[0]).toMatch(/^ {2}battery\.volts +none → \d/);
  });
});

describe('golden runs: each content fixture’s expect', () => {
  it('holds for a broken fixture that shows its named fault', async () => {
    const golden = contentCase(fixture('broken-servo-without-signal'), content.catalogue);
    expect(checkExpect(golden, await ran(golden))).toEqual({ holds: true, shows: 'servo no-signal (named)', mismatches: [] });
  });

  it('holds for an impossible drop that planWire refuses', async () => {
    const golden = contentCase(fixture('broken-wrong-type-wire'), content.catalogue);
    expect(checkExpect(golden, await ran(golden))).toEqual({
      holds: true,
      shows: 'no fault; planWire refuses battery.plus → driver.in-a (wire.type_mismatch)',
      mismatches: [],
    });
  });

  it('reports a fault the Run shows that expect does not list, with its ticks and readouts', async () => {
    const golden = contentCase(fixture('broken-servo-without-signal'), content.catalogue);
    const report = checkExpect({ ...golden, expect: { faults: [] } }, await ran(golden));
    expect(report.holds).toBe(false);
    expect(report.mismatches).toEqual([expect.stringMatching(/^shows servo no-signal, which expect does not list: from tick 2, active 59 of 61 ticks \(last at tick 60\); servo at tick 2: volts \d/)]);
  });

  it('reports an expected fault the Run never shows, and a named fault it does not show', async () => {
    const golden = contentCase(fixture('broken-wrong-type-wire'), content.catalogue);
    const missing = { partId: 'driver', failure: 'low-voltage' };
    const report = checkExpect({ ...golden, expect: { faults: [missing], namedFault: missing } }, await ran(golden));
    expect(report.mismatches).toEqual([
      expect.stringMatching(/^expects driver low-voltage, which the Run never shows; driver at tick 30: volts \d/),
      'its named fault driver low-voltage is not shown',
    ]);
  });

  it('reports a drop planWire accepts, or refuses for another reason', async () => {
    const golden = contentCase(fixture('broken-wrong-type-wire'), content.catalogue);
    const run = await ran(golden);
    const refused = golden.expect?.refused;
    if (!refused) throw new Error('broken-wrong-type-wire refuses a drop.');
    const other = checkExpect({ ...golden, expect: { faults: [], refused: { ...refused, code: 'wire.duplicate' as IssueCode } } }, run);
    expect(other.mismatches).toEqual(['planWire refuses battery.plus → driver.in-a with wire.type_mismatch, not wire.duplicate']);
    const legal = checkExpect({ ...golden, expect: { faults: [], refused: { ...refused, to: { part: 'motor', port: 'plus' } } } }, run);
    expect(legal.mismatches).toEqual(['planWire accepts battery.plus → motor.plus, which expect says it refuses with wire.type_mismatch']);
  });

  it('judges a goal only through a challenge runner, and says so while there is none', async () => {
    const unnamed = { ...contentCase(fixture('level-1-roller'), content.catalogue), expect: { faults: [], goal: { met: true } } };
    const golden = { ...unnamed, challenge: 'drive-forward' };
    const run = await ran(contentCase(fixture('level-1-roller'), content.catalogue));
    expect(checkExpect(golden, run).mismatches).toEqual(['expects the goal of drive-forward met, and nothing can judge it yet: the challenge runner is task 4.5']);
    expect(checkExpect(golden, run, () => ({ met: true, tick: 40 }))).toEqual({ holds: true, shows: 'no fault; goal met', mismatches: [] });
    expect(checkExpect(golden, run, () => ({ met: false })).mismatches).toEqual(['expects the goal of drive-forward met; the Run does not meet it in 90 ticks']);
    expect(checkExpect(unnamed, run).mismatches).toEqual(['expects the goal met, but names no challenge']);
  });

  it('leaves a schema blueprint, which has no expect, alone', async () => {
    const golden = schemaCase('short-circuit');
    expect(checkExpect(golden, await ran(golden))).toEqual({ holds: true, shows: '', mismatches: [] });
  });
});

describe('golden runs: the cases', () => {
  it('reads the same content and fixtures from disk as the loaders read through Vite', () => {
    const disk = readContentFixtures(CONTENT);
    expect(disk.issues).toEqual([]);
    expect(disk.fixtures).toEqual(fixtures);
    expect(disk.fixtures).toHaveLength(51);
    for (const kind of ['parts', 'arenas', 'kits', 'challenges'] as const) expect(disk.content[kind]).toEqual(content[kind]);
  });

  it('runs every content fixture with its own seed, inputs and ticks, and every valid schema blueprint under one protocol', () => {
    const golden = contentCase(fixture('switch-in-the-line'), content.catalogue);
    expect(golden).toMatchObject({ id: 'content/switch-in-the-line', seed: 1, ticks: 90, inputs: fixture('switch-in-the-line').inputs });
    const schema = schemaCases();
    expect(schema.map((each) => each.id)).toEqual([
      'schema/rolling-start',
      'schema/led-circuit',
      'schema/reversed-motor',
      'schema/short-circuit',
      'schema/switch-across-pack',
      'schema/bumper-robot',
      'schema/motor-off-pin',
    ]);
    expect(schema.every((each) => each.seed === 2026 && each.ticks === 30 && !each.expect)).toBe(true);
    expect(schemaCase('led-circuit').inputs).toEqual([
      { tick: 10, partId: 'switch', kind: 'switch', closed: false },
      { tick: 20, partId: 'switch', kind: 'switch', closed: true },
    ]);
  });
});

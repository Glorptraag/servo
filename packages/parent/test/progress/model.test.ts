// The progress model's rules, each on records written by hand around a content fixture's blueprint, so every case is
// exact: what counts as a fault fixed (D31 with D75, D76 and D96), the Runs left out, the series a Run belongs to, the
// unscripted passes, and the card game's latest round (D40). Then one real Run of an unscripted build, through sim-core.
import { describe, expect, it } from 'vitest';
import type { CardGameResult } from '@servo/app/store';
import type { Blueprint, FaultSeen, RunRecord } from '@servo/schema';
import { progressOf } from '../../src/index.ts';
import { differsOn } from '../../src/progress/index.ts';
import { reconcile } from './reconcile.ts';
import { challenge, content, fixture, minute, moved, runAll, without } from './runs.ts';

const spinner = fixture('broken-reversed-motor').blueprint;
const MOTOR = 'motor-right';
const REVERSED: FaultSeen = { partId: MOTOR, failure: 'reversed', firstTick: 30 };

/** The spinner with its right motor's leads swapped back: a change to two wires on its ports. */
const swapped = (blueprint: Blueprint): Blueprint => ({
  ...blueprint,
  wires: blueprint.wires.map((wire) => {
    const flip = (port: string): string => (port === 'plus' ? 'minus' : port === 'minus' ? 'plus' : port);
    return {
      ...wire,
      from: wire.from.part === MOTOR ? { ...wire.from, port: flip(wire.from.port) } : wire.from,
      to: wire.to.part === MOTOR ? { ...wire.to, port: flip(wire.to.port) } : wire.to,
    };
  }),
});

const fixedBuild = swapped(spinner);

let count = 0;
const rec = (n: number, blueprint: Blueprint, options: Partial<RunRecord> = {}): RunRecord => ({
  version: 1,
  id: `10000000-0000-4000-8000-${(count += 1).toString(16).padStart(12, '0')}`,
  blueprintId: blueprint.meta.id,
  blueprint,
  seed: 1,
  tickRate: 30,
  startedAt: minute(n),
  endedAt: minute(n),
  runNumber: n,
  ticks: 90,
  inputs: [],
  faults: [],
  fixed: [],
  hints: [],
  ...options,
});

const progress = (runs: readonly RunRecord[], cardGames: readonly CardGameResult[] = []) => {
  const read = progressOf({ runs, content, cardGames });
  reconcile(runs, content, read, false);
  return read;
};

describe('faults fixed (D31, D75, D76, D96)', () => {
  it('counts a fault a later Run runs past without, with a change to the part, with its Runs and times', () => {
    const runs = [rec(1, spinner, { faults: [REVERSED] }), rec(2, fixedBuild)];
    expect(progress(runs).faultsFixed).toEqual([
      { partId: MOTOR, part: 'dc-motor', failure: 'reversed', firstSeen: minute(1), fixedBy: runs[1]?.id, fixedAt: minute(2), runs: 2 },
    ]);
  });

  it('does not count a fault that went with no change to the part (D75)', () => {
    expect(progress([rec(1, spinner, { faults: [REVERSED] }), rec(2, spinner)]).faultsFixed).toEqual([]);
  });

  it('does not count a change to another part only, such as the battery pack that fed it (D76)', () => {
    const otherChanged = without(spinner, 'caster');
    expect(differsOn(spinner, otherChanged, MOTOR)).toBe(false);
    expect(progress([rec(1, spinner, { faults: [REVERSED] }), rec(2, otherChanged)]).faultsFixed).toEqual([]);
  });

  it('does not count moving the part: a move is no change (D75, as sim-core reads it)', () => {
    expect(progress([rec(1, spinner, { faults: [REVERSED] }), rec(2, moved(spinner, MOTOR, 5))]).faultsFixed).toEqual([]);
  });

  it('counts taking the part out, a setting changed on it, and a wire on its ports', () => {
    expect(differsOn(spinner, without(spinner, MOTOR), MOTOR)).toBe(true);
    const set = { ...spinner, parts: spinner.parts.map((part) => (part.id === MOTOR ? { ...part, settings: { direction: 'backward' } } : part)) };
    expect(differsOn(spinner, set, MOTOR)).toBe(true);
    expect(differsOn(spinner, fixedBuild, MOTOR)).toBe(true);
    expect(differsOn(spinner, spinner, MOTOR)).toBe(false);
  });

  it('waits for a Run that passes the tick the fault showed at (D96): a short Run settles nothing', () => {
    const runs = [rec(1, spinner, { faults: [REVERSED] }), rec(2, fixedBuild, { ticks: 30 }), rec(3, fixedBuild)];
    expect(progress(runs.slice(0, 2)).faultsFixed).toEqual([]);
    expect(progress(runs).faultsFixed).toEqual([expect.objectContaining({ fixedBy: runs[2]?.id, firstSeen: minute(1), runs: 3 })]);
  });

  it('keeps a fault open while Runs show it again, timed from the first, and compares with the latest build that showed it', () => {
    const tried = moved(spinner, 'caster', 3);
    const runs = [rec(1, spinner, { faults: [REVERSED] }), rec(2, tried, { faults: [{ ...REVERSED, firstTick: 40 }] }), rec(3, swapped(tried))];
    expect(progress(runs).faultsFixed).toEqual([expect.objectContaining({ firstSeen: minute(1), fixedAt: minute(3), runs: 3 })]);
  });

  it('starts a new fault once one was settled, so a fault that went with no fix and came back counts once fixed', () => {
    const runs = [rec(1, spinner, { faults: [REVERSED] }), rec(2, spinner), rec(3, spinner, { faults: [REVERSED] }), rec(4, fixedBuild)];
    expect(progress(runs).faultsFixed).toEqual([expect.objectContaining({ firstSeen: minute(3), fixedBy: runs[3]?.id, runs: 2 })]);
  });

  it("keeps a challenge's Runs apart from the sandbox's, and one build's from another's", () => {
    const other = { ...fixedBuild, meta: { ...fixedBuild.meta, id: '7e1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b' } };
    expect(progress([rec(1, spinner, { faults: [REVERSED] }), rec(2, other)]).faultsFixed).toEqual([]);
    expect(progress([rec(1, spinner, { faults: [REVERSED] }), rec(2, fixedBuild, { challenge: 'one-motor-backwards' })]).faultsFixed).toEqual([]);
    // A challenge's Runs are one series across the builds it was started from, as the app numbers and links them.
    const fresh = { ...other, meta: { ...other.meta } };
    const runs = [rec(1, spinner, { challenge: 'one-motor-backwards', faults: [REVERSED] }), rec(2, fresh, { challenge: 'one-motor-backwards' })];
    expect(progress(runs).faultsFixed).toHaveLength(1);
  });
});

describe('what the figures leave out and keep', () => {
  it('skips a Run of 0 ticks in every figure', () => {
    const empty = rec(1, spinner, { ticks: 0, faults: [] });
    expect(progress([empty])).toEqual({ partsMet: [], unscriptedBuildsPassed: [], faultsFixed: [] });
  });

  it('meets each part type once, from the first Run that had it, in the order met', () => {
    const roller = fixture('level-1-roller').blueprint;
    const runs = [rec(1, roller), rec(2, spinner), rec(3, roller)];
    const met = progress(runs).partsMet;
    expect(met.filter((part) => part.firstRun === runs[0]?.id).length).toBe(new Set(roller.parts.map((part) => part.part)).size);
    expect(met.every((part) => part.firstRun !== runs[2]?.id)).toBe(true);
  });

  it('gives the same figures whatever order Runs of different times arrive in', () => {
    const runs = [rec(1, spinner, { faults: [REVERSED] }), rec(2, fixedBuild), rec(3, fixture('level-1-roller').blueprint)];
    expect(progressOf({ runs: [...runs].reverse(), content, cardGames: [] })).toEqual(progressOf({ runs, content, cardGames: [] }));
  });

  it('counts the first passing Run of each unscripted build only, with its runNumber', () => {
    const bumper = fixture('bumper-stops-at-wall').blueprint;
    const runs = [
      rec(1, bumper, { challenge: 'cross-and-stop', goal: { met: false } }),
      rec(2, bumper, { challenge: 'cross-and-stop', goal: { met: true, tick: 80 } }),
      rec(3, bumper, { challenge: 'cross-and-stop', goal: { met: true, tick: 80 } }),
      rec(4, bumper, { challenge: 'drive-and-light', goal: { met: true, tick: 20 } }),
    ];
    expect(progress(runs).unscriptedBuildsPassed).toEqual([{ challenge: 'cross-and-stop', run: runs[1]?.id, runNumber: 2, at: minute(2) }]);
  });

  it('reads the latest card-game round (D40), and none when no round was played; time in the sandbox stays absent (D39)', () => {
    const round = (at: number, named: readonly boolean[]): CardGameResult => ({
      id: `20000000-0000-4000-8000-00000000000${at}`,
      profile: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607',
      playedAt: minute(at),
      cards: named.map((value) => ({ part: 'dc-motor', named: value })),
    });
    const read = progress([], [round(2, [true, false, true]), round(1, [false])]);
    expect(read.partsNamed).toEqual({ named: 2, of: 3, playedAt: minute(2) });
    expect(read.timeInSandboxMs).toBeUndefined();
    expect(progress([]).partsNamed).toBeUndefined();
  });
});

describe('a real unscripted build', () => {
  it('passes cross and stop with the bumper robot, judged by the app, and the figure reconciles', async () => {
    expect(challenge('cross-and-stop').kind).toBe('unscripted-build');
    const bumper = fixture('bumper-stops-at-wall');
    const runs = await runAll([{ blueprint: bumper.blueprint, ticks: Math.max(bumper.ticks, 450), challenge: 'cross-and-stop' }]);
    expect(runs[0]?.goal?.met).toBe(true);
    const read = progressOf({ runs, content, cardGames: [] });
    reconcile(runs, content, read);
    expect(read.unscriptedBuildsPassed).toEqual([expect.objectContaining({ challenge: 'cross-and-stop', runNumber: 1 })]);
  }, 600_000);
});

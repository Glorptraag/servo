// The hint ladder at work (task 4.6) in Node: the controller on a stand-in canvas whose build changes only through the
// canvas's own applyEdit, and the real run loop on the real sim-core with a clock the test moves. Each tap is the next
// rung, in ladder order, ending with do-it as one batch that leaves a valid build; a rung the canvas cannot draw is
// passed over; another ladder starts at its first step; two Runs that miss the goal offer a rung and pulse the button,
// never do-it; a Run stopped in its spin-up does not count; a breakdown's ladder waits for the Run that shows its
// fault; a Run that meets the goal clears the ladder; every step used is in the log for the run record.
import { describe, expect, it } from 'vitest';
import { applyEdit } from '@servo/canvas';
import type { CanvasHandle, CanvasMode, DrawnHintStep, EditCommand, EditResult } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { validateBlueprint } from '@servo/schema';
import type { Blueprint, Challenge } from '@servo/schema';
import { HintLadderController } from '../../src/hints/controller.ts';
import { partsMatching } from '../../src/hints/ladder.ts';
import { HintLog } from '../../src/hints/log.ts';
import { RunLoop, SPIN_UP_MS } from '../../src/run-bar/run-loop.ts';
import type { RunClock } from '../../src/run-bar/run-loop.ts';
import { contentFixture, example, fixture } from './support.ts';

const { catalogue } = loadContent().content;

/** The canvas as far as the ladder and the run loop reach it. A rung draws when something on the build matches it. */
class StandIn {
  mode: CanvasMode = 'build';
  blueprint: Blueprint | undefined;
  readonly drawn: (DrawnHintStep | null)[] = [];
  readonly applied: EditCommand[] = [];
  /** Steps of these kinds draw nothing, as when nothing on the canvas matches them. */
  readonly blank = new Set<string>();
  constructor(blueprint: Blueprint) {
    this.blueprint = blueprint;
  }
  get shown(): DrawnHintStep | null {
    return this.drawn.at(-1) ?? null;
  }
  showHint(step: DrawnHintStep): boolean {
    const build = this.blueprint;
    if (!build || this.blank.has(step.step)) return false;
    const matches = step.step === 'ghost-wire' ? partsMatching(build, step.from).length > 0 && partsMatching(build, step.to).length > 0 : partsMatching(build, step.target).length > 0;
    if (matches) this.drawn.push(step);
    return matches;
  }
  clearHints(): void {
    if (this.shown) this.drawn.push(null);
  }
  apply(command: EditCommand): EditResult {
    if (!this.blueprint || this.mode !== 'build') return { ok: false, refusal: { code: 'edit.locked', message: 'locked' } };
    const result = applyEdit(this.blueprint, command, catalogue);
    if (result.ok) {
      this.blueprint = result.blueprint;
      this.applied.push(command);
    }
    return result;
  }
  setMode(mode: CanvasMode): void {
    this.mode = mode;
  }
  applyRunFrame(): void {}
  on(): () => void {
    return () => undefined;
  }
}

class TestClock implements RunClock {
  time = 0;
  private waiting: (() => void) | undefined;
  now(): number {
    return this.time;
  }
  frame(callback: () => void): () => void {
    this.waiting = callback;
    return () => {
      if (this.waiting === callback) this.waiting = undefined;
    };
  }
  advance(ms: number): void {
    this.time += ms;
    const callback = this.waiting;
    this.waiting = undefined;
    callback?.();
  }
}

const setUp = (challenge: Challenge, start: Blueprint) => {
  const canvas = new StandIn(start);
  const clock = new TestClock();
  const loop = new RunLoop({ canvas: canvas as unknown as CanvasHandle, catalogue, clock, seed: () => 5 });
  const log = new HintLog();
  let second = 0;
  const now = (): string => new Date(Date.UTC(2026, 9, 3, 9, 0, (second += 1))).toISOString();
  const ladder = new HintLadderController({ canvas, catalogue, challenge, log, loop, now });
  const runFor = async (ticks: number): Promise<void> => {
    await loop.run();
    clock.advance(SPIN_UP_MS);
    for (let tick = 1; tick < ticks; tick += 1) clock.advance(1000 / 30);
    loop.stop();
  };
  return { canvas, clock, loop, log, ladder, runFor };
};

const MEET = example('meet-the-switch');

describe('climbing the ladder by tapping', () => {
  it('draws each rung in turn, then does it as one batch that leaves a valid build, then starts the next ladder', () => {
    const { canvas, log, ladder } = setUp(MEET, MEET.start as Blueprint);
    expect(ladder.state).toMatchObject({ available: true, offered: false, shown: undefined });
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown).toMatchObject({ step: 'pulse-part', target: { placed: 'switch' } });
    expect(ladder.state.shown).toEqual({ step: 'pulse-part', line: 'The switch goes in the power line' });
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown).toMatchObject({ step: 'pulse-port', target: { placed: 'switch', port: 'a' } });
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown).toMatchObject({ step: 'ghost-wire', from: { placed: 'battery', port: 'plus' }, to: { placed: 'switch', port: 'a' } });
    expect(canvas.applied).toEqual([]);

    expect(ladder.ask()).toBe(true);
    expect(canvas.applied).toEqual([{ kind: 'batch', commands: [{ kind: 'connect', from: { part: 'battery', port: 'plus' }, to: { part: 'switch', port: 'a' } }] }]);
    expect(canvas.shown, 'the ghost wire is cleared once the wire is there').toBeNull();
    const after = canvas.blueprint as Blueprint;
    expect(validateBlueprint(after, catalogue).ok).toBe(true);
    expect(after.wires.length).toBe((MEET.start as Blueprint).wires.length + 1);
    expect(ladder.state.said).toBe("Wired the battery pack's plus to side A");
    expect(ladder.state.shown?.step).toBe('do-it');

    // Side A is wired, so the first ladder's trigger no longer holds: the second ladder starts at its first step.
    expect(ladder.state.available).toBe(true);
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown).toMatchObject({ step: 'pulse-port', target: { placed: 'switch', port: 'b' } });
    expect(ladder.ask()).toBe(true);
    expect(canvas.applied).toHaveLength(2);
    expect(validateBlueprint(canvas.blueprint as Blueprint, catalogue).ok).toBe(true);
    // Every ladder is done for this build: a tap does nothing.
    expect(ladder.state.available).toBe(false);
    expect(ladder.ask()).toBe(false);

    expect(log.pending(canvas.blueprint as Blueprint).map((use) => [use.step, use.trigger, use.partId])).toEqual([
      ['pulse-part', 'asked', 'switch'],
      ['pulse-port', 'asked', 'switch'],
      ['ghost-wire', 'asked', 'switch'],
      ['do-it', 'asked', 'switch'],
      ['pulse-port', 'asked', 'switch'],
      ['do-it', 'asked', undefined],
    ]);
    ladder.dispose();
  });

  it('passes over a rung the canvas cannot draw', () => {
    const { canvas, ladder } = setUp(MEET, MEET.start as Blueprint);
    canvas.blank.add('pulse-part');
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown?.step).toBe('pulse-port');
    ladder.dispose();
  });

  it('keeps its place while the same ladder applies, starts again when another does, and clears its rung', () => {
    const { canvas, ladder } = setUp(MEET, MEET.start as Blueprint);
    ladder.ask();
    ladder.ask();
    // An unrelated edit keeps the place.
    canvas.apply({ kind: 'rename', name: 'My switch' });
    ladder.buildChanged();
    ladder.ask();
    expect(canvas.shown?.step).toBe('ghost-wire');
    // The child wires side A: the next ladder applies, and the old rung goes.
    canvas.apply({ kind: 'connect', from: { part: 'battery', port: 'plus' }, to: { part: 'switch', port: 'a' } });
    ladder.buildChanged();
    expect(canvas.shown).toBeNull();
    expect(ladder.state.shown).toBeUndefined();
    ladder.ask();
    expect(canvas.shown).toMatchObject({ step: 'pulse-port', target: { placed: 'switch', port: 'b' } });
    ladder.dispose();
  });

  it('does nothing in Run mode, and is cleared when it goes', () => {
    const { canvas, ladder } = setUp(MEET, MEET.start as Blueprint);
    canvas.mode = 'run';
    expect(ladder.ask()).toBe(false);
    canvas.mode = 'build';
    ladder.ask();
    ladder.dispose();
    expect(canvas.shown).toBeNull();
  });
});

describe('Runs that miss the goal', { timeout: 60_000 }, () => {
  it('offers the first rung after two, pulsing the button, and the next tap goes on from there', async () => {
    const { canvas, log, ladder, loop, runFor } = setUp(MEET, MEET.start as Blueprint);
    await runFor(20);
    expect(canvas.shown).toBeNull();
    expect(ladder.state.offered).toBe(false);
    // Stopped in its spin-up, a Run shows nothing, so it does not count.
    await loop.run();
    loop.stop();
    expect(canvas.shown).toBeNull();
    await runFor(20);
    expect(canvas.shown).toMatchObject({ step: 'pulse-part', target: { placed: 'switch' } });
    expect(ladder.state.offered).toBe(true);
    expect(log.pending(canvas.blueprint as Blueprint).map((use) => [use.step, use.trigger])).toEqual([['pulse-part', 'offered']]);
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown?.step).toBe('pulse-port');
    expect(ladder.state.offered).toBe(false);
    loop.dispose();
    ladder.dispose();
  });

  it('never offers do-it: with only do-it left, the button pulses and the build is untouched', async () => {
    const { canvas, ladder, loop, runFor } = setUp(MEET, MEET.start as Blueprint);
    ladder.ask();
    ladder.ask();
    ladder.ask();
    await runFor(10);
    await runFor(10);
    expect(canvas.applied).toEqual([]);
    expect(ladder.state).toMatchObject({ offered: true, available: true });
    loop.dispose();
    ladder.dispose();
  });

  it('waits for a Run that shows a breakdown’s fault, then narrows to the part it showed on', async () => {
    const challenge = example('one-motor-backwards', fixture('broken-reversed-motor'));
    const { canvas, ladder, loop, runFor } = setUp(challenge, fixture('broken-reversed-motor'));
    expect(ladder.state.available).toBe(false);
    expect(ladder.ask()).toBe(false);
    await runFor(60);
    expect(ladder.state.available).toBe(true);
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown).toMatchObject({ step: 'pulse-part', target: { placed: 'motor-right' } });
    ladder.ask();
    ladder.ask();
    expect(ladder.ask()).toBe(true);
    const fixed = canvas.blueprint as Blueprint;
    expect(validateBlueprint(fixed, catalogue).ok).toBe(true);
    // The fixed robot drives straight: its Run meets the goal and shows no fault, so no ladder applies.
    await runFor(90);
    expect(ladder.state).toMatchObject({ available: false, offered: false, shown: undefined });
    loop.dispose();
    ladder.dispose();
  });

  it('retires a fault ladder once do-it fixes the fault, through later edits, until a Run shows the fault again (R-4.6)', async () => {
    const broken = fixture('broken-reversed-motor');
    const challenge = example('one-motor-backwards', broken);
    const { canvas, log, ladder, loop, runFor } = setUp(challenge, broken);
    await runFor(60);
    for (let tap = 0; tap < 4; tap += 1) expect(ladder.ask()).toBe(true);
    expect(canvas.applied).toHaveLength(1);
    // A later edit, with no Run between: the motor is wired right now, so the ladder stays retired.
    canvas.apply({ kind: 'place-part', part: 'led' });
    ladder.buildChanged();
    expect(ladder.state.available).toBe(false);
    expect(ladder.ask()).toBe(false);
    expect(canvas.shown).toBeNull();
    expect(log.pending(canvas.blueprint as Blueprint).map((use) => use.step)).toEqual(['pulse-part', 'pulse-port', 'ghost-wire', 'do-it']);
    // The motor wired backwards again: the ladder waits for the Run that shows the fault, then starts from its first rung.
    canvas.blueprint = broken;
    ladder.buildChanged();
    expect(ladder.state.available).toBe(false);
    await runFor(60);
    expect(ladder.state.available).toBe(true);
    expect(ladder.ask()).toBe(true);
    expect(canvas.shown).toMatchObject({ step: 'pulse-part', target: { placed: 'motor-right' } });
    loop.dispose();
    ladder.dispose();
  });

  it('clears the rung and the count when a Run meets the goal', async () => {
    const lit = contentFixture('led-and-buzzer-robot');
    const base = example('drive-and-light', lit.blueprint);
    const challenge: Challenge = { ...base, hints: [{ steps: [{ step: 'pulse-part', target: { part: 'led' }, line: 'The LED' }, { step: 'do-it', changes: [{ kind: 'remove-part', target: { part: 'buzzer' } }], line: 'Took the buzzer away' }] }] };
    const { canvas, ladder, loop, runFor } = setUp(challenge, lit.blueprint);
    ladder.ask();
    expect(canvas.shown?.step).toBe('pulse-part');
    await runFor(lit.ticks);
    expect(canvas.shown).toBeNull();
    expect(ladder.state).toMatchObject({ offered: false, shown: undefined });
    loop.dispose();
    ladder.dispose();
  });
});

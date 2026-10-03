// The Web Audio sink (task 4.10) in Node, on a stand-in AudioContext that writes down the oscillators it makes. No
// audio before the child's first gesture or while sound is off; a held sound (motor, hum, buzz, squeal) is one voice
// per part that follows its level, with the motor's pitch rising with its speed and the buzzer at its record's pitch;
// a knock, the whir, the tick and the click stop by themselves, so nothing ever loops; sound off stops every voice and
// suspends the context, and sound on brings back what the Run is making now.
import { describe, expect, it } from 'vitest';
import { WebAudioSink } from '../../src/sound/index.ts';
import type { MachineCue } from '../../src/sound/index.ts';

class Param {
  value = 0;
  readonly targets: number[] = [];
  setTargetAtTime(value: number): this {
    this.targets.push(value);
    this.value = value;
    return this;
  }
  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
}

class Node {
  connect<T>(next: T): T {
    return next;
  }
  disconnect(): void {}
}

class Oscillator extends Node {
  type = 'sine';
  readonly frequency = new Param();
  started = false;
  stopAt: number | undefined;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(at: number): void {
    this.stopAt = at;
  }
}

class Context {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  readonly destination = new Node();
  readonly oscillators: Oscillator[] = [];
  readonly gains: { readonly gain: Param }[] = [];
  suspends = 0;
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.suspends += 1;
    this.state = 'suspended';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
  createOscillator(): Oscillator {
    const made = new Oscillator();
    this.oscillators.push(made);
    return made;
  }
  createGain() {
    const made = Object.assign(new Node(), { gain: new Param() });
    this.gains.push(made);
    return made;
  }
  createBiquadFilter() {
    return Object.assign(new Node(), { type: 'lowpass', frequency: new Param() });
  }
  /** Oscillators started and not told to stop. */
  get sounding(): Oscillator[] {
    return this.oscillators.filter((oscillator) => oscillator.started && oscillator.stopAt === undefined);
  }
}

const sinkOf = () => {
  const made: Context[] = [];
  const sink = new WebAudioSink(() => {
    const context = new Context();
    made.push(context);
    return context as unknown as AudioContext;
  });
  return { sink, made, context: (): Context => made[0] ?? (() => { throw new Error('no context yet'); })() };
};

const motor = (level: number, partId = 'p3'): MachineCue => ({ kind: 'machine', tick: 1, partId, sound: 'motor', level });

describe('the Web Audio sink', () => {
  it('makes no audio before the first gesture, then hears what the Run is making now', async () => {
    const { sink, made, context } = sinkOf();
    sink.play({ kind: 'whir' });
    sink.play(motor(0.5));
    sink.play({ kind: 'click' });
    expect(made).toEqual([]);
    sink.unlock();
    expect(made).toHaveLength(1);
    await Promise.resolve();
    expect(context().state).toBe('running');
    // The whir and the click were moments that passed; the motor is still turning.
    expect(context().sounding.map((oscillator) => oscillator.type)).toEqual(['sawtooth']);
    sink.unlock();
    expect(made).toHaveLength(1);
  });

  it('keeps one voice per part and sound that follows its level, pitched by speed, and stops it at level 0', () => {
    const { sink, context } = sinkOf();
    sink.unlock();
    sink.play(motor(0.2));
    sink.play(motor(0.2, 'p4'));
    sink.play(motor(0.9));
    const [first, second] = context().oscillators;
    expect(context().sounding).toHaveLength(2);
    expect(first?.frequency.targets[0]).toBeLessThan(first?.frequency.targets[1] ?? 0);
    expect(second?.frequency.targets).toHaveLength(1);
    sink.play(motor(0));
    expect(first?.stopAt).toBeDefined();
    expect(context().sounding).toEqual([second]);
    sink.play({ kind: 'hush' });
    expect(context().sounding).toEqual([]);
  });

  it('buzzes at the pitch the run event carries', () => {
    const { sink, context } = sinkOf();
    sink.unlock();
    sink.play({ kind: 'machine', tick: 0, partId: 'p5', sound: 'buzz', level: 1, hz: 2300 });
    expect(context().sounding[0]?.frequency.value).toBe(2300);
  });

  it('lets knocks, the whir, the tick and the click stop by themselves: nothing loops', () => {
    const { sink, context } = sinkOf();
    sink.unlock();
    sink.play({ kind: 'machine', tick: 4, partId: 'p1', sound: 'knock', level: 0.4 });
    sink.play({ kind: 'machine', tick: 5, partId: 'p1', sound: 'knock', level: 0 });
    sink.play({ kind: 'whir' });
    sink.play({ kind: 'tick', tick: 3 });
    sink.play({ kind: 'click' });
    expect(context().oscillators).toHaveLength(4);
    for (const oscillator of context().oscillators) expect(oscillator.stopAt).toBeLessThanOrEqual(1.5);
  });

  it('goes silent with sound off and suspends; sound on brings back the sounds playing now', () => {
    const { sink, context } = sinkOf();
    sink.unlock();
    sink.play(motor(0.5));
    sink.play({ kind: 'machine', tick: 1, partId: 'p2', sound: 'hum', level: 0.3 });
    expect(context().sounding).toHaveLength(2);
    sink.setMuted(true);
    expect(context().sounding).toEqual([]);
    expect(context().suspends).toBe(1);
    sink.play(motor(0.7));
    sink.play({ kind: 'machine', tick: 2, partId: 'p2', sound: 'hum', level: 0 });
    sink.play({ kind: 'click' });
    expect(context().sounding).toEqual([]);
    sink.setMuted(false);
    expect(context().sounding).toHaveLength(1);
    expect(context().sounding[0]?.type).toBe('sawtooth');
  });

  it('never makes a context while sound is off, even at a gesture', () => {
    const { sink, made } = sinkOf();
    sink.setMuted(true);
    sink.unlock();
    expect(made).toEqual([]);
    sink.setMuted(false);
    expect(made).toHaveLength(1);
  });

  it('closes, and plays nothing afterwards', async () => {
    const { sink, context } = sinkOf();
    sink.unlock();
    sink.play(motor(0.5));
    sink.close();
    await Promise.resolve();
    expect(context().state).toBe('closed');
    expect(context().sounding).toEqual([]);
    sink.play(motor(0.5));
    sink.unlock();
    expect(context().oscillators).toHaveLength(1);
  });

  it('stays silent where the page has no Web Audio', () => {
    const sink = new WebAudioSink(() => null);
    sink.unlock();
    expect(() => sink.play(motor(1))).not.toThrow();
  });
});

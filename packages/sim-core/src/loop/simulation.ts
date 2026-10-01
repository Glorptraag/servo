import type { Blueprint, ControlId, FaultSeen, RunEvent, RunInput, RunRecord } from '@servo/schema';
import type { ControlInput, RunFrame, RunRecordContext, SimSnapshot, Simulation } from '../interface.ts';
import { runRecordOf } from '../recorder/index.ts';
import { eventsOf, frozenEvent, liveOf } from './frame.ts';
import type { Models } from './models.ts';
import type { Setup } from './setup.ts';
import { decodeSnapshot, encodeSnapshot, snapshotHeader } from './snapshot.ts';
import { solveTick, startState } from './tick.ts';
import type { LoopState } from './tick.ts';

/** What a Run holds while it lives; dropped by `dispose`. */
interface Held {
  readonly models: Models;
  state: LoopState;
  inputs: RunInput[];
  events: RunEvent[];
  faults: FaultSeen[];
  /** `partId failure` for every fault in `faults`. */
  seen: Set<string>;
}

const faultKey = (partId: string, failure: string): string => `${partId} ${failure}`;

/** The frame of the state's tick: the events of that tick (the log's tail), its live state and its flows. */
const frameOf = (state: LoopState, events: readonly RunEvent[]): RunFrame => {
  let first = events.length;
  while (first > 0 && events[first - 1]?.tick === state.tick) first -= 1;
  return Object.freeze({ tick: state.tick, events: Object.freeze(events.slice(first)), live: state.live, flows: state.flows });
};

/**
 * One Run: the tick loop around the solvers, its logs, snapshots and records. The caller steps it; it never reads a
 * clock. See docs/loop.md and docs/runs.md.
 */
export class Run implements Simulation {
  readonly blueprint: Blueprint;
  readonly seed: number;
  readonly #print: number;
  #held: Held | undefined;
  #tick: number;
  #frame: RunFrame;

  constructor(setup: Setup, models: Models) {
    this.blueprint = setup.blueprint;
    this.seed = setup.seed;
    this.#print = setup.print;
    const held: Held = { models, state: startState(models), inputs: [], events: [], faults: [], seen: new Set() };
    this.#held = held;
    this.#tick = 0;
    this.#frame = this.#advance(held, 0);
  }

  get tick(): number {
    return this.#tick;
  }

  get frame(): RunFrame {
    return this.#frame;
  }

  #run(): Held {
    if (!this.#held) throw new Error('This Simulation has been disposed of.');
    return this.#held;
  }

  /** Solves `tick` from the held state, logs its events and faults, and makes its frame. */
  #advance(held: Held, tick: number): RunFrame {
    const before = held.state;
    const solved = solveTick(held.models, before, tick);
    const events = eventsOf(held.models, tick, solved.readouts, before.live).map(frozenEvent);
    const live = liveOf(held.models, solved.readouts, before.live, events);
    held.state = { ...solved.state, live };
    for (const event of events) {
      held.events.push(event);
      if (event.kind !== 'fault' || !event.payload.active) continue;
      const key = faultKey(event.partId, event.payload.failure);
      if (held.seen.has(key)) continue;
      held.seen.add(key);
      held.faults.push(Object.freeze({ partId: event.partId, failure: event.payload.failure, firstTick: tick }));
    }
    this.#tick = tick;
    this.#frame = Object.freeze({ tick, events: Object.freeze(events), live, flows: held.state.flows });
    return this.#frame;
  }

  step(): RunFrame {
    const held = this.#run();
    return this.#advance(held, held.state.tick + 1);
  }

  input(control: ControlInput): boolean {
    const held = this.#run();
    const closed: unknown = control.closed;
    const switches = held.models.manual.get(control.partId);
    if (control.kind !== 'switch' || typeof closed !== 'boolean' || !switches) return false;
    const manual = held.state.manual;
    if (switches.every((id) => manual[id] === closed)) return false;
    const next: Record<ControlId, boolean> = { ...manual };
    for (const id of switches) next[id] = closed;
    held.state = { ...held.state, manual: next };
    held.inputs.push(Object.freeze({ tick: held.state.tick, partId: control.partId, kind: 'switch', closed }));
    return true;
  }

  snapshot(): SimSnapshot {
    const held = this.#run();
    return Object.freeze({ tick: held.state.tick, bytes: encodeSnapshot(this.#print, held.state, held) });
  }

  restore(snapshot: SimSnapshot): RunFrame {
    const held = this.#run();
    const header = snapshotHeader(snapshot.bytes);
    if (!header || header.print !== this.#print || header.tick !== snapshot.tick) throw new Error('This snapshot came from another Simulation.');
    const { state, logs } = decodeSnapshot(held.models, snapshot.bytes);
    held.state = state;
    held.inputs = [...logs.inputs];
    held.events = [...logs.events];
    held.faults = [...logs.faults];
    held.seen = new Set(logs.faults.map((fault) => faultKey(fault.partId, fault.failure)));
    this.#tick = state.tick;
    this.#frame = frameOf(state, held.events);
    return this.#frame;
  }

  record(context: RunRecordContext): RunRecord {
    const held = this.#run();
    return runRecordOf({ blueprint: this.blueprint, seed: this.seed, ticks: held.state.tick, inputs: held.inputs, events: held.events, faults: held.faults }, context);
  }

  dispose(): void {
    this.#held = undefined;
  }
}

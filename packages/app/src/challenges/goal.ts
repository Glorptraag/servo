// The goal judge (task 4.5): whether a Run meets its challenge's goal, and at which tick, read from the Run's events
// alone. One code path serves the app and the golden harness: the app feeds a GoalWatch each frame as the Run plays,
// and `judgeRun` feeds it a run record's events, so both give the same verdict for the same Run. Pure and
// framework-free (no DOM, React, clock or Vite): packages/tools imports it as `@servo/app/goal` under plain Node.
import type { Blueprint, Catalogue, Challenge, ChallengeId, FailureModeId, FaultSeen, Goal, PartTarget, PlacedPartId, RunEvent, RunRecord } from '@servo/schema';
import { RunWorld } from './world.ts';

/** A Run's verdict: met, and the tick it was met at, or not met. */
export interface GoalVerdict {
  readonly met: boolean;
  /** Present exactly when `met`. */
  readonly tick?: number;
}

/** The challenge runner's verdict on a run record, as the golden harness takes it (`env.judge`). */
export type GoalJudge = (record: RunRecord, challenge: ChallengeId) => GoalVerdict;

export const NOT_MET: GoalVerdict = { met: false };

/** One goal's progress through a Run: the tick it was met at, once met. */
interface Tracker {
  readonly met: number | undefined;
  step(world: RunWorld): void;
}

/** Tracks a goal from tick `from` on: nothing before it counts (a later step of a sequence). */
const track = (goal: Goal, from: number): Tracker => {
  switch (goal.kind) {
    case 'holds': {
      let run = 0;
      let met: number | undefined;
      return {
        get met() {
          return met;
        },
        step(world) {
          if (met !== undefined || world.tick < from) return;
          run = world.holds(goal.when) ? run + 1 : 0;
          if (run >= goal.forTicks) met = world.tick;
        },
      };
    }
    case 'uses': {
      let met: number | undefined;
      let judged = false;
      return {
        get met() {
          return met;
        },
        step(world) {
          if (judged || world.tick < from) return;
          judged = true;
          if (world.partsOf({ part: goal.part }).length >= goal.count) met = world.tick;
        },
      };
    }
    case 'all':
    case 'any': {
      const inner = goal.of.map((sub) => track(sub, from));
      let met: number | undefined;
      return {
        get met() {
          return met;
        },
        step(world) {
          if (met !== undefined) return;
          for (const tracker of inner) tracker.step(world);
          const done = inner.filter((tracker) => tracker.met !== undefined);
          if (goal.kind === 'all' ? done.length === inner.length : done.length > 0) met = world.tick;
        },
      };
    }
    case 'sequence': {
      // Each step starts the tick after the one before it is met, so the same ticks never meet two steps.
      let index = 0;
      let current = goal.of.length > 0 ? track(goal.of[0] as Goal, from) : undefined;
      let met: number | undefined;
      return {
        get met() {
          return met;
        },
        step(world) {
          if (met !== undefined || world.tick < from) return;
          if (!current) {
            met = world.tick;
            return;
          }
          current.step(world);
          if (current.met === undefined) return;
          index += 1;
          const next = goal.of[index];
          if (next) current = track(next, world.tick + 1);
          else met = world.tick;
        },
      };
    }
  }
};

/**
 * The faults a breakdown is about (D48): its goal is met only while the named fault is gone, not on the right motion
 * alone, so flipping a motor's Direction setting does not pass a motor wired backwards. A breakdown names its fault in
 * its hint ladders' `fault` triggers; one that names none counts every fault.
 */
export const namedFaults = (challenge: Challenge): readonly { readonly target: PartTarget; readonly failure: FailureModeId }[] | 'any' => {
  if (challenge.kind !== 'breakdown') return [];
  const named = challenge.hints.flatMap((ladder) => (ladder.when?.kind === 'fault' ? [{ target: ladder.when.target, failure: ladder.when.failure }] : []));
  return named.length > 0 ? named : 'any';
};

/** A named fault as it applies to one build: the parts it may show on (every part when `parts` is undefined), and the failure. */
interface NamedOnBuild {
  readonly parts: ReadonlySet<PlacedPartId> | undefined;
  readonly failure: FailureModeId;
}

/**
 * Where a breakdown's named faults can show in the build that ran. A `placed` target the child has taken away stands
 * for every part of its type in the challenge's start (review R-4.5 finding 2): a new DC motor wired backwards again is
 * the same fault. With no start to read the type from, it stands for every part. Undefined when every fault counts.
 */
const namedOnBuild = (challenge: Challenge, blueprint: Blueprint): readonly NamedOnBuild[] | undefined => {
  const named = namedFaults(challenge);
  if (named === 'any') return undefined;
  const typeOf = (id: PlacedPartId, build: Blueprint | undefined): string | undefined => build?.parts.find((part) => part.id === id)?.part;
  const ofType = (type: string): ReadonlySet<PlacedPartId> => new Set(blueprint.parts.filter((part) => part.part === type).map((part) => part.id));
  return named.map(({ target, failure }) => {
    if ('part' in target) return { parts: ofType(target.part), failure };
    if (typeOf(target.placed, blueprint) !== undefined) return { parts: new Set([target.placed]), failure };
    const type = typeOf(target.placed, challenge.start);
    return { parts: type === undefined ? undefined : ofType(type), failure };
  });
};

const showsNamed = (named: readonly NamedOnBuild[] | undefined, partId: PlacedPartId, failure: FailureModeId): boolean =>
  named === undefined || named.some((fault) => fault.failure === failure && (fault.parts === undefined || fault.parts.has(partId)));

/**
 * The breakdown's named faults a Run showed (D48), read from its record's `faults`: what the parent view reads beside
 * `goal`, since a stored record keeps its verdict as `{ met, tick }` only. Empty when the fault was gone, and for any
 * other kind of challenge. Exported from `@servo/app/store` for the parent view.
 */
export const namedFaultsShown = (challenge: Challenge, record: RunRecord): readonly FaultSeen[] => {
  if (challenge.kind !== 'breakdown') return [];
  const named = namedOnBuild(challenge, record.blueprint);
  return record.faults.filter((fault) => showsNamed(named, fault.partId, fault.failure));
};

export interface GoalWatchOptions {
  readonly challenge: Challenge;
  /** The build that runs: the Run's snapshot. */
  readonly blueprint: Blueprint;
  /** The part records and arena presets the Run reads. */
  readonly catalogue: Catalogue;
}

/**
 * Watches one Run for its challenge's goal. Give it every tick's events in order from tick 0 (`push`); once met, the
 * verdict stays. For a breakdown, a named fault seen at any tick up to the goal's keeps it from being met (D48).
 */
export class GoalWatch {
  private readonly world: RunWorld;
  private readonly goal: Tracker;
  private readonly faults: readonly NamedOnBuild[] | undefined;
  private readonly breakdown: boolean;
  private faulted = false;
  private verdictNow: GoalVerdict = NOT_MET;

  constructor({ challenge, blueprint, catalogue }: GoalWatchOptions) {
    this.world = new RunWorld(blueprint, catalogue, catalogue.arenas?.get(blueprint.arena.preset));
    this.goal = track(challenge.goal, 0);
    this.breakdown = challenge.kind === 'breakdown';
    this.faults = namedOnBuild(challenge, blueprint);
  }

  get verdict(): GoalVerdict {
    return this.verdictNow;
  }

  /** The last tick pushed: −1 before the first. */
  get tick(): number {
    return this.world.tick;
  }

  /** Feeds one tick's events, ticks in order from 0, and gives the verdict so far. */
  push(tick: number, events: readonly RunEvent[]): GoalVerdict {
    if (this.verdictNow.met || this.faulted) return this.verdictNow;
    this.world.advance(tick, events);
    if (this.faultShown()) {
      this.faulted = true;
      return this.verdictNow;
    }
    this.goal.step(this.world);
    if (this.goal.met !== undefined) this.verdictNow = { met: true, tick: this.goal.met };
    return this.verdictNow;
  }

  private faultShown(): boolean {
    return this.breakdown && this.world.activeFaults().some(({ partId, failure }) => showsNamed(this.faults, partId, failure));
  }
}

/**
 * Judges a run record against its challenge, from its events, tick 0 to its last. A stored summary without events
 * cannot be judged again: its own verdict stands, or none.
 */
export const judgeRun = (challenge: Challenge, record: RunRecord, catalogue: Catalogue): GoalVerdict => {
  const events = record.events;
  if (!events) return record.goal ?? NOT_MET;
  const watch = new GoalWatch({ challenge, blueprint: record.blueprint, catalogue });
  let next = 0;
  for (let tick = 0; tick <= record.ticks; tick += 1) {
    const start = next;
    while (next < events.length && (events[next] as RunEvent).tick === tick) next += 1;
    if (watch.push(tick, events.slice(start, next)).met) break;
  }
  return watch.verdict;
};

/** A GoalJudge over a set of challenges: the golden harness's `env.judge`. An unknown challenge is never met. */
export const goalJudgeFor =
  (content: { readonly challenges: readonly Challenge[]; readonly catalogue: Catalogue }): GoalJudge =>
  (record, id) => {
    const challenge = content.challenges.find((candidate) => candidate.id === id);
    return challenge ? judgeRun(challenge, record, content.catalogue) : NOT_MET;
  };

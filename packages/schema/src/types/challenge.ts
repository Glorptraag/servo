import type { ArenaRef } from './arena.ts';
import type { Blueprint, SettingValue } from './blueprint.ts';
import type {
  ArenaFeatureId,
  ChallengeId,
  FailureModeId,
  KitId,
  Level,
  PartTypeId,
  PlacedPartId,
  PortId,
  SettingId,
  Text,
} from './common.ts';

export const CHALLENGE_KINDS = ['part-introduction', 'guided', 'breakdown', 'what-if', 'unscripted-build'] as const;

export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/**
 * A part in a goal or hint: one placed part of the starting blueprint, or any placed part of a type.
 * A condition on a type holds when it holds for any part of that type.
 */
export type PartTarget = { readonly placed: PlacedPartId } | { readonly part: PartTypeId };

/** A port on a part target, for example `{ "part": "dc-motor", "port": "plus" }`. */
export type PortTarget = PartTarget & { readonly port: PortId };

/** What a part can be observed doing at a tick. */
export const PART_STATES = [
  'powered',
  'unpowered',
  'turning',
  'still',
  'lit',
  'dark',
  'sounding',
  'silent',
  'closed',
  'open',
  'upright',
  'tipped',
] as const;

export type PartState = (typeof PART_STATES)[number];

/** Something true or false at one tick of a run. */
export type Condition =
  | { readonly kind: 'and'; readonly of: readonly Condition[] }
  | { readonly kind: 'or'; readonly of: readonly Condition[] }
  | { readonly kind: 'not'; readonly of: Condition }
  | { readonly kind: 'in-zone'; readonly target: PartTarget; readonly zone: ArenaFeatureId }
  | { readonly kind: 'near-wall'; readonly target: PartTarget; readonly wall: ArenaFeatureId; readonly withinMm: number }
  /** Speed across the floor in mm/s. At least one bound. */
  | { readonly kind: 'speed'; readonly target: PartTarget; readonly atLeast?: number; readonly atMost?: number }
  /** Turning rate in degrees per second, either way. At least one bound. */
  | { readonly kind: 'turn-rate'; readonly target: PartTarget; readonly atLeast?: number; readonly atMost?: number }
  | { readonly kind: 'state'; readonly target: PartTarget; readonly state: PartState }
  | { readonly kind: 'fault'; readonly target: PartTarget; readonly failure: FailureModeId };

/**
 * A goal is a predicate over a run record (brief Section 5). Examples: reach a zone
 * (`holds` + `in-zone`), stop near a wall (`holds` for 30 ticks of `near-wall` and a low `speed`),
 * an LED lit while moving (`holds` of `and` [state lit, speed at least]).
 */
export type Goal =
  /** Every sub-goal is met at some point in the run. */
  | { readonly kind: 'all'; readonly of: readonly Goal[] }
  | { readonly kind: 'any'; readonly of: readonly Goal[] }
  /** Sub-goals met one after another, in order. */
  | { readonly kind: 'sequence'; readonly of: readonly Goal[] }
  /** The condition holds for `forTicks` ticks in a row. */
  | { readonly kind: 'holds'; readonly when: Condition; readonly forTicks: number }
  /** The build that ran has at least `count` of this part. */
  | { readonly kind: 'uses'; readonly part: PartTypeId; readonly count: number };

/** Hint-ladder steps, in ladder order (brief Section 10; ground rule 9). */
export const HINT_STEPS = ['pulse-part', 'pulse-port', 'ghost-wire', 'do-it'] as const;

export type HintStepKind = (typeof HINT_STEPS)[number];

/** A build change the last hint step makes. `add-part` places a part from the kit, mounted on `mountOn` when given. */
export type HintChange =
  | { readonly kind: 'add-wire'; readonly from: PortTarget; readonly to: PortTarget }
  | { readonly kind: 'remove-wire'; readonly from: PortTarget; readonly to: PortTarget }
  | { readonly kind: 'add-part'; readonly part: PartTypeId; readonly mountOn?: PortTarget }
  | { readonly kind: 'remove-part'; readonly target: PartTarget }
  | { readonly kind: 'set-setting'; readonly target: PartTarget; readonly setting: SettingId; readonly value: SettingValue };

/** Every step carries its line: the text twin read by the list view and speak-it. */
export type HintStep =
  | { readonly step: 'pulse-part'; readonly target: PartTarget; readonly line: Text }
  | { readonly step: 'pulse-port'; readonly target: PortTarget; readonly line: Text }
  | { readonly step: 'ghost-wire'; readonly from: PortTarget; readonly to: PortTarget; readonly line: Text }
  /** Does the change and says what it did. */
  | { readonly step: 'do-it'; readonly changes: readonly HintChange[]; readonly line: Text };

/** When a ladder applies: the last Run showed a fault, the build lacks a part, or a port has no wire. */
export type HintTrigger =
  | { readonly kind: 'fault'; readonly target: PartTarget; readonly failure: FailureModeId }
  | { readonly kind: 'missing'; readonly part: PartTypeId }
  | ({ readonly kind: 'unwired' } & PortTarget);

/**
 * A hint ladder. Steps run in ladder order (pulse part → pulse port → ghost wire → do it), may skip a
 * rung, and end with `do-it`. The app uses the first ladder whose trigger holds; a ladder without a
 * trigger always applies.
 */
export interface HintLadder {
  readonly when?: HintTrigger;
  readonly steps: readonly HintStep[];
}

/** A challenge laid over the canvas: a goal, an arena preset and a kit (brief Sections 5 and 9). */
export interface Challenge {
  readonly id: ChallengeId;
  readonly kind: ChallengeKind;
  readonly level: Level;
  readonly title: Text;
  /** The header's one-line goal. */
  readonly goalLine: Text;
  readonly goal: Goal;
  readonly arena: ArenaRef;
  readonly kit: KitId;
  /** The build the child starts from. Required for breakdowns and what-ifs; its arena preset matches `arena`. */
  readonly start?: Blueprint;
  /** The part a part introduction meets. Present exactly when kind is `part-introduction`. */
  readonly introduces?: PartTypeId;
  readonly hints: readonly HintLadder[];
}

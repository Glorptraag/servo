import type { Blueprint, SettingValue } from './blueprint.ts';
import type { HintStepKind } from './challenge.ts';
import type {
  ChallengeId,
  FailureModeId,
  PartTypeId,
  PlacedPartId,
  ProfileId,
  RunId,
  SettingId,
  Timestamp,
} from './common.ts';
import type { PortRef } from './port.ts';

/** Simulated ticks per simulated second. The clock control changes how fast ticks play, not their length. */
export const TICK_RATE = 30;

/**
 * Who an event is about: a placed part's id, or `arena:<propId>` for a prop in the arena.
 * The `arena:` prefix can never be a placed part's id.
 */
export type EventSubject = string;

/** Live readouts that changed this tick. At least one field. */
export interface ValuePayload {
  /** Volts across the part's supply, or across a battery pack's terminals. */
  readonly volts?: number;
  /** Current through the part. */
  readonly milliamps?: number;
  /** A battery pack's charge left, 0–1. */
  readonly charge?: number;
  /** Drive speed; negative when turning the other way. */
  readonly rpm?: number;
  /** Arm angle, degrees. */
  readonly angle?: number;
  /** Light given, 0–1. */
  readonly light?: number;
  /** Level on the part's signal output, 0–1. */
  readonly signal?: number;
  /** A switch's state. */
  readonly closed?: boolean;
}

/** Where a moving body is on the arena floor. `pitch` and `roll` (degrees) show tilting and tipping. */
export interface MotionPayload {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly pitch?: number;
  readonly roll?: number;
}

export const RUN_SOUNDS = ['motor', 'hum', 'buzz', 'squeal', 'knock'] as const;

export type RunSound = (typeof RUN_SOUNDS)[number];

/** A machine sound starting, changing or stopping (level 0). Every sound has a visual twin in the app. */
export interface SoundPayload {
  readonly sound: RunSound;
  /** 0–1; 0 means it stopped. */
  readonly level: number;
  readonly hz?: number;
}

/** A failure mode starting (`active: true`) or ending on the part. */
export interface FaultPayload {
  readonly failure: FailureModeId;
  readonly active: boolean;
}

/** The event stream sim-core publishes (task 0.4) and a full run record keeps. */
export type RunEvent =
  | { readonly tick: number; readonly partId: EventSubject; readonly kind: 'value'; readonly payload: ValuePayload }
  | { readonly tick: number; readonly partId: EventSubject; readonly kind: 'motion'; readonly payload: MotionPayload }
  | { readonly tick: number; readonly partId: EventSubject; readonly kind: 'sound'; readonly payload: SoundPayload }
  | { readonly tick: number; readonly partId: EventSubject; readonly kind: 'fault'; readonly payload: FaultPayload };

export type RunEventKind = RunEvent['kind'];

/** Something the child did during the Run, kept so the run replays exactly: pressing a switch. */
export interface RunInput {
  readonly tick: number;
  readonly partId: PlacedPartId;
  readonly kind: 'switch';
  readonly closed: boolean;
}

/** A failure mode that appeared in this Run. */
export interface FaultSeen {
  readonly partId: PlacedPartId;
  readonly failure: FailureModeId;
  readonly firstTick: number;
}

/** A change between the previous Run's build and this one. A setting change without `value` went back to the default. */
export type BuildChange =
  | { readonly kind: 'add-part'; readonly partId: PlacedPartId; readonly part: PartTypeId }
  | { readonly kind: 'remove-part'; readonly partId: PlacedPartId; readonly part: PartTypeId }
  | { readonly kind: 'add-wire'; readonly from: PortRef; readonly to: PortRef }
  | { readonly kind: 'remove-wire'; readonly from: PortRef; readonly to: PortRef }
  | { readonly kind: 'change-setting'; readonly partId: PlacedPartId; readonly setting: SettingId; readonly value?: SettingValue }
  | { readonly kind: 'change-arena' };

/** A fault the previous Run showed that this Run does not, and the build changes that fixed it. */
export interface FixedFault {
  readonly partId: PlacedPartId;
  readonly failure: FailureModeId;
  readonly changes: readonly BuildChange[];
}

/** A hint step used since the previous Run: asked for, or offered after two Runs that missed the goal. */
export interface HintUse {
  readonly at: Timestamp;
  readonly step: HintStepKind;
  readonly trigger: 'asked' | 'offered';
  readonly partId?: PlacedPartId;
}

/**
 * One Run of one blueprint. It feeds the parent view and the brief's Section 14 measures: parts used
 * (from `blueprint`), the number of Runs (`runNumber`), faults and how they were fixed, whether the goal
 * was met, and hint use. A full record keeps `events`; a stored summary may leave them out.
 */
export interface RunRecord {
  readonly version: 1;
  readonly id: RunId;
  /** The snapshot that ran (ground rule 4). */
  readonly blueprint: Blueprint;
  readonly challenge?: ChallengeId;
  /** Omitted when shared. */
  readonly profile?: ProfileId;
  /** Unsigned 32-bit. Same blueprint, arena and seed give the same run (ground rule 2). */
  readonly seed: number;
  readonly tickRate: typeof TICK_RATE;
  readonly startedAt: Timestamp;
  readonly endedAt: Timestamp;
  /** This Run's place, from 1, among the child's Runs of this challenge or blueprint. */
  readonly runNumber: number;
  /** Ticks simulated. */
  readonly ticks: number;
  /** In tick order. */
  readonly inputs: readonly RunInput[];
  /** In tick order. */
  readonly events?: readonly RunEvent[];
  readonly faults: readonly FaultSeen[];
  readonly fixed: readonly FixedFault[];
  /** Present when run inside a challenge; `tick` is present exactly when `met`. */
  readonly goal?: { readonly met: boolean; readonly tick?: number };
  readonly hints: readonly HintUse[];
}

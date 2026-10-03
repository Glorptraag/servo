// Every telemetry event Servo emits (task 6.2), and nothing else: the four that brief Section 14's measures are read
// from. Each kind lists its fields; an event is its kind, when it happened (`at`) and those fields, and the child's
// profile id is kept beside it on this device only, so it can be deleted with the profile. No field is free text, a
// name, a build or a part: each is checked against a closed set or the content's challenge ids as it is emitted.
// docs/data-note.md lists the same kinds and fields for the adult, and test/telemetry/emitters.test.ts holds the two,
// and every emitter in the source, to one another.
import type { Content } from '@servo/content';
import type { ChallengeId, HintStepKind, Timestamp } from '@servo/schema';

/** What each kind of event keeps besides its kind and time. */
export interface TelemetryFields {
  /** The first start of a session: a build chosen on Home, or the first Run on the build the app opened with. */
  readonly 'session-start': { readonly mode: 'sandbox' | 'challenge' };
  /** A Run of a challenge, once it is kept in the child's run records. Sandbox Runs feed no measure and emit nothing. */
  readonly run: { readonly challenge: ChallengeId; readonly runNumber: number; readonly goalMet: boolean };
  /** A hint step shown or done. */
  readonly hint: { readonly challenge: ChallengeId; readonly step: HintStepKind };
  /** A parts list made in the parent view, or a link to a build copied there. */
  readonly export: { readonly what: 'parts-list' | 'share-link' };
}

export type TelemetryKind = keyof TelemetryFields;

export type TelemetryEvent = {
  readonly [K in TelemetryKind]: { readonly kind: K; readonly at: Timestamp } & TelemetryFields[K];
}[TelemetryKind];

type Check = (value: unknown, content: Content) => boolean;

const oneOf =
  (...values: readonly unknown[]): Check =>
  (value) =>
    values.includes(value);

const challengeId: Check = (value, content) => typeof value === 'string' && content.challenges.some((challenge) => challenge.id === value);

interface Spec<K extends TelemetryKind> {
  readonly fields: { readonly [F in keyof TelemetryFields[K]]-?: Check };
  /** Emitted at most once for each child's session (each opening of the app for them). */
  readonly once?: true;
}

/** The registry: the only kinds there are, the only fields each keeps, and how each field is checked. */
export const TELEMETRY_EVENTS: { readonly [K in TelemetryKind]: Spec<K> } = {
  'session-start': { fields: { mode: oneOf('sandbox', 'challenge') }, once: true },
  run: {
    fields: {
      challenge: challengeId,
      runNumber: (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1,
      goalMet: oneOf(true, false),
    },
  },
  hint: { fields: { challenge: challengeId, step: oneOf('pulse-part', 'pulse-port', 'ghost-wire', 'do-it') } },
  export: { fields: { what: oneOf('parts-list', 'share-link') } },
};

export const TELEMETRY_KINDS = Object.keys(TELEMETRY_EVENTS) as readonly TelemetryKind[];

/** The event to keep, with exactly the registry's fields, or undefined when the kind or any field is not one it allows. */
export const eventOf = <K extends TelemetryKind>(kind: K, at: Timestamp, fields: TelemetryFields[K], content: Content): TelemetryEvent | undefined => {
  if (!Object.hasOwn(TELEMETRY_EVENTS, kind)) return undefined;
  const checks: Readonly<Record<string, Check>> = TELEMETRY_EVENTS[kind].fields;
  const given = fields as Readonly<Record<string, unknown>>;
  if (typeof given !== 'object' || given === null) return undefined;
  if (Object.keys(given).some((name) => !Object.hasOwn(checks, name))) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [name, check] of Object.entries(checks)) {
    if (!check(given[name], content)) return undefined;
    kept[name] = given[name];
  }
  return { kind, at, ...kept } as TelemetryEvent;
};

// The words docs/data-note.md uses for each telemetry kind and field (R-6.2 F4, task 7.7). The note speaks to the adult
// in plain words, so the code names live here, for tests only: each kind is paired with the words its list item opens
// with, and each field with the words in that item that say what it keeps (three words or more, matched as whole
// words). emitters.test.ts holds this table to the registry and to the note, so a new or renamed kind or field fails
// until it is described here and the note says it.
import type { TelemetryFields, TelemetryKind } from '../../src/telemetry/events.ts';

export interface NoteWords<K extends TelemetryKind> {
  /** The words the kind's item in the note's events list opens with. */
  readonly event: string;
  /** For each field, the words in that item that say what it keeps. */
  readonly fields: { readonly [F in keyof TelemetryFields[K]]-?: string };
}

export const NOTE_WORDS: { readonly [K in TelemetryKind]: NoteWords<K> } = {
  'session-start': {
    event: 'Each time Servo opens for a child',
    fields: { mode: 'whether they build on their own or take a challenge' },
  },
  run: {
    event: 'Each Run of a challenge',
    fields: {
      challenge: 'which challenge it was',
      runNumber: 'how many times the child has run it',
      goalMet: 'whether the robot met the goal',
    },
  },
  hint: {
    event: 'Each hint shown or done',
    fields: { challenge: 'which challenge it was in', step: 'which step of the hint ladder it was' },
  },
  export: {
    event: 'Each time a parts list or a link to a build is made in this parent view',
    fields: { what: 'which of the two was made' },
  },
};

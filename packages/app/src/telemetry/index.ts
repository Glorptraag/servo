// Telemetry for brief Section 14's success measures only (task 6.2). See the README's "Telemetry" and docs/data-note.md.
export { TELEMETRY_EVENTS, TELEMETRY_KINDS, eventOf } from './events.ts';
export type { TelemetryEvent, TelemetryFields, TelemetryKind } from './events.ts';
export { emitTelemetry, telemetryOf, withTelemetry } from './emit.ts';
export type { EmitOptions } from './emit.ts';
export { DATA_NOTE, noteBlocks } from './note.ts';
export type { NoteBlock, NoteSpan } from './note.ts';

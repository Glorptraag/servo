// What the e2e config hands its tests (vitest.config.ts, `provide`), read in a test with `inject`.
import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** True unless SERVO_PARITY_STRICT=0: a parity fixture with a step left out or a path waiting fails. */
    parityStrict: boolean;
    /** SERVO_PARITY_TOURS=all: every parity fixture takes every tour of edits, not the one `assignTours` gives it. */
    parityAllTours: boolean;
  }
}

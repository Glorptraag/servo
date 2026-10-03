// What the e2e config hands its tests (vitest.config.ts, `provide`), read in a test with `inject`.
import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** SERVO_PARITY_STRICT=1, for gate G3: a parity fixture with a step left out or a path waiting fails. */
    parityStrict: boolean;
  }
}

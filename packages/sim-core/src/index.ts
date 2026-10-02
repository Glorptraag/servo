// @servo/sim-core: the simulation engine (Phase 1). createSimulation runs a blueprint through the tick loop (task 1.5).
// The canvas never imports this file, only ./interface.ts. See README.md.
export type * from './interface.ts';
export { createSimulation } from './loop/index.ts';

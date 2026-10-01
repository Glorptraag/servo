// @servo/sim-core: the simulation engine (Phase 1). Task 1.5 replaces the createSimulation stub with the tick loop.
// The canvas never imports this file, only ./interface.ts. See README.md.
import type { CreateSimulation } from './interface.ts';

export type * from './interface.ts';

export const createSimulation: CreateSimulation = () => Promise.reject(new Error('createSimulation is not implemented yet (task 1.5).'));

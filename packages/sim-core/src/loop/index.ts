// The tick loop (task 1.5): createSimulation, a Run's steps, snapshots and records. See docs/loop.md and docs/runs.md.
import type { CreateSimulation } from '../interface.ts';
import { initMechanics } from '../mechanical/index.ts';
import { buildModels } from './models.ts';
import { prepare } from './setup.ts';
import { Run } from './simulation.ts';
import { warmControls } from './warm.ts';

/**
 * Validates the inputs (a SimulationSetupError for invalid ones, never for a legal-but-wrong build), copies the
 * blueprint in canonical form, loads the physics engine's WebAssembly the first time (D11), builds every solver's model,
 * warms the electrical solver's caches for every switch position, and solves tick 0.
 */
export const createSimulation: CreateSimulation = async (options) => {
  const setup = prepare(options);
  await initMechanics();
  const models = buildModels(setup.graph, setup.arena, options.program);
  warmControls(models);
  return new Run(setup, models);
};

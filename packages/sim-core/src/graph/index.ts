// The graph builder (task 1.1): a valid blueprint and its catalogue → the wired graph the solvers read.
// See packages/sim-core/docs/graph.md.

export { GraphInputError, buildGraph } from './build.ts';
export { LIVE_TABLE_CONTROLS, liveAt } from './live.ts';
export type {
  BoundPort,
  BoundPrimitive,
  DriveLink,
  GraphPart,
  LiveNets,
  MountLink,
  NetPair,
  PowerLine,
  PowerNet,
  PowerSource,
  PowerSwitch,
  PowerUse,
  SignalLink,
  SimGraph,
} from './types.ts';

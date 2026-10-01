// @servo/schema: the v1 types, validators, wiring rules and canonical form every package builds on.
// See packages/schema/README.md.

export * from './types/common.ts';
export * from './types/taxonomy.ts';
export * from './types/port.ts';
export * from './types/behaviour.ts';
export * from './types/part.ts';
export * from './types/arena.ts';
export * from './types/blueprint.ts';
export * from './types/kit.ts';
export * from './types/challenge.ts';
export * from './types/run.ts';
export * from './types/issue.ts';

export { makeCatalogue } from './validate/catalogue.ts';
export type { Catalogue, CatalogueInput } from './validate/catalogue.ts';

export {
  SOCKET_CAPACITY,
  addWire,
  checkPortPair,
  comparePortRefs,
  emptyWiring,
  indexPlacedParts,
  judgeWire,
  planWire,
  resolvePort,
  socketOf,
} from './validate/wiring.ts';
export type {
  PairRefusal,
  PairVerdict,
  PortEnd,
  ResolvedPort,
  Socket,
  WireJudgement,
  WireKind,
  WirePlan,
  WireRefusal,
  WiringState,
} from './validate/wiring.ts';

export { mapSettingValue, validatePartRecord } from './validate/part.ts';
export { validateArenaPreset } from './validate/arena.ts';
export { validateBlueprint, validateBlueprintShape } from './validate/blueprint.ts';
export { validateKit } from './validate/kit.ts';
export { MAX_GOAL_DEPTH, validateChallenge } from './validate/challenge.ts';
export { validateRunRecord } from './validate/run.ts';
export {
  canonicalJson,
  canonicalizeBlueprint,
  nextPlacedPartId,
  nextWireId,
  serializeBlueprint,
} from './validate/canonical.ts';

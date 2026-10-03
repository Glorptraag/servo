// Sync (task 5.5): the store's Sync over a pluggable SyncRemote (D10, D13), with the conflict rule "latest blueprint
// wins, both versions kept". The store opens it (src/store/open.ts); nothing else needs to. See README.md.
export { applyPull, markPushed, outbox } from './changes.ts';
export type { KeptCopy, Outbox } from './changes.ts';
export { syncFor } from './engine.ts';
export type { StoreSync, SyncOptions } from './engine.ts';
export { browserNetwork, manualNetwork } from './network.ts';
export type { ManualNetwork, Network } from './network.ts';
export { RemoteUnreachable, httpRemote, memoryRemote } from './remotes.ts';
export type { HttpRemoteConfig, MemoryRemote } from './remotes.ts';

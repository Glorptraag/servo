// @servo/app/store: the local-first store's typed interface (task 0.4). Task 4.9 implements it on Dexie and
// task 5.5 adds sync; until then openStore rejects. packages/parent imports only this module (CLAUDE.md package
// map), so it reads content through `ServoStore.content`. See packages/app/README.md.

import type { Content } from '@servo/content';
import type { ArenaRef, Blueprint, BlueprintId, ChallengeId, Issue, Level, ProfileId, RunId, RunRecord, Timestamp } from '@servo/schema';

export interface StoreOptions {
  /** The IndexedDB database name. Tests pass their own. Default 'servo'. */
  readonly name?: string;
  /** Where sync goes. Omitted, the store is local-only: the default until a host is chosen (D10, D13). */
  readonly remote?: SyncRemote;
  /** The clock for timestamps, as toISOString writes them. Tests pass a fixed one. */
  readonly now?: () => Timestamp;
}

/**
 * Opens the store on this device, creating it on first use, and asks the browser to keep it
 * (`navigator.storage.persist()`: Safari may otherwise evict it). Loads and validates the content once.
 * Rejects when the content does not validate.
 */
export type OpenStore = (options?: StoreOptions) => Promise<ServoStore>;

export const openStore: OpenStore = () => Promise.reject(new Error('openStore is not implemented yet (task 4.9).'));

export interface ServoStore {
  /**
   * The validated content (`@servo/content` loadContent) the store checks blueprints against. The parent view
   * reads part names, families, challenge kinds and art from here, since the package map gives it no other way.
   */
  readonly content: Content;
  readonly profiles: Profiles;
  /** One child's records. A scope reads and writes only its own profile's blueprints and runs. */
  forProfile(profile: ProfileId): ProfileStore;
  readonly sync: Sync;
  close(): void;
}

/** A child profile under the one adult account on this device: no email, no chat, nothing public. */
export interface Profile {
  /** A UUID v4 the store generates. It never carries the name. */
  readonly id: ProfileId;
  /** What the adult calls the profile on the profile switch. */
  readonly name: string;
  readonly createdAt: Timestamp;
}

export interface Profiles {
  /** Oldest first. */
  list(): Promise<readonly Profile[]>;
  create(name: string): Promise<Profile>;
  rename(id: ProfileId, name: string): Promise<Profile>;
  /** Removes the profile with every blueprint and run it owns. An adult's action; the app never removes anything on its own. */
  remove(id: ProfileId): Promise<void>;
}

export interface ProfileStore {
  readonly profile: ProfileId;
  readonly blueprints: Blueprints;
  readonly runs: Runs;
}

/** Blueprint CRUD, keyed by `meta.id`. The blueprint is the only persisted build format (ground rule 5). */
export interface Blueprints {
  /** Newest `updatedAt` first. */
  list(): Promise<readonly BlueprintSummary[]>;
  /** A new, empty build: a fresh `meta.id` (UUID v4), this profile as author, created and updated now, high-water marks at 0. */
  create(init: { readonly name: string; readonly level: Level; readonly arena: ArenaRef }): Promise<Blueprint>;
  /**
   * Migrates the stored document to the current version (the schema's `migrateBlueprint`, task 0.3) and validates
   * it against `content`. A document that fails comes back with its issues and stays stored, untouched: nothing is lost.
   */
  load(id: BlueprintId): Promise<BlueprintLoad>;
  /** Stores the blueprint in canonical form under its `meta.id`, with `updatedAt` stamped now. Rejects one that does not validate, or another profile's. */
  save(blueprint: Blueprint): Promise<Blueprint>;
  /** A copy under a fresh `meta.id`, with its own name. Its runs start again from 1. */
  duplicate(id: BlueprintId, name: string): Promise<Blueprint>;
  remove(id: BlueprintId): Promise<void>;
}

export interface BlueprintSummary {
  readonly id: BlueprintId;
  readonly name: string;
  readonly level: Level;
  readonly updatedAt: Timestamp;
  /** Set on a copy kept by the sync conflict rule: the `meta.id` of the blueprint it was kept from. */
  readonly keptFrom?: BlueprintId;
}

export type BlueprintLoad =
  | { readonly ok: true; readonly blueprint: Blueprint; readonly migratedFrom?: number }
  | { readonly ok: false; readonly issues: readonly Issue[] };

/** Run records: the parent view's progress, `runNumber` and the previous Run that gives `fixed` all come from here. */
export interface Runs {
  add(record: RunRecord): Promise<void>;
  /** Oldest first. */
  list(filter?: RunFilter): Promise<readonly RunRecord[]>;
  get(id: RunId): Promise<RunRecord | undefined>;
}

export interface RunFilter {
  readonly blueprintId?: BlueprintId;
  /** A challenge's Runs, or with null the sandbox's (Runs with no challenge). */
  readonly challenge?: ChallengeId | null;
}

/**
 * Sync (task 5.5) goes through a pluggable remote: an in-memory one for tests, an HTTP one disabled until a host
 * is configured (D10, D13). Conflict rule: when one `meta.id` changed on two devices since the last sync, the
 * copy with the later `meta.updatedAt` keeps the id and the other is kept as its own blueprint with a fresh
 * `meta.id` (`keptFrom`). Blueprints are never merged and never dropped.
 */
export interface SyncRemote {
  /** Changes on the remote since `cursor`, or all of them when it is undefined. */
  pull(cursor: string | undefined): Promise<SyncPull>;
  push(changes: readonly SyncChange[]): Promise<void>;
}

export interface SyncPull {
  readonly changes: readonly SyncChange[];
  readonly cursor: string;
}

export interface SyncChange {
  readonly collection: 'profiles' | 'blueprints' | 'runs';
  readonly id: string;
  readonly profile?: ProfileId;
  readonly updatedAt: Timestamp;
  /** The record as stored (a blueprint as `serializeBlueprint` writes it, parsed), or absent when it was removed. */
  readonly document?: unknown;
}

export type SyncState = 'local-only' | 'idle' | 'syncing' | 'offline' | 'failed';

export interface Sync {
  readonly state: SyncState;
  /** Pulls, applies the conflict rule, then pushes. Resolves at once when local-only. */
  now(): Promise<void>;
  /** Called whenever `state` changes. Returns the unsubscribe function. */
  subscribe(listener: (state: SyncState) => void): () => void;
}

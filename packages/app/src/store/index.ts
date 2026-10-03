// @servo/app/store: the local-first store's typed interface (task 0.4), implemented on Dexie over IndexedDB by task
// 4.9 (open.ts and its neighbours); task 5.5 adds sync. packages/parent imports only this module (CLAUDE.md package
// map), so it reads content, and content's types, through here. See packages/app/docs/store.md.

import { loadContent } from '@servo/content';
import type { Content, ContentIssue } from '@servo/content';
import type { ArenaRef, Blueprint, BlueprintId, ChallengeId, Issue, Level, PartTypeId, ProfileId, RunId, RunRecord, Timestamp } from '@servo/schema';
import { openStoreWith } from './open.ts';

export type { ArtEntry, ArtRegistry, Content, ContentIssue, TerminologyFile } from '@servo/content';

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
 * (`navigator.storage.persist()`: Safari may otherwise evict it). Loads the content once with `loadContent`.
 * A content defect never stops it opening: the defective record is left out, and only builds that use it fail to
 * load. Rejects only when the device's storage cannot be opened.
 */
export type OpenStore = (options?: StoreOptions) => Promise<ServoStore>;

export const openStore: OpenStore = (options) => openStoreWith(loadContent(), options);

export interface ServoStore {
  /**
   * Every content record that validates (`@servo/content`). The store checks blueprints against it, and the parent
   * view reads part names, families, challenge kinds and art from it, since the package map gives it no other way.
   */
  readonly content: Content;
  /** What was wrong with the content as loaded, for a developer's eyes. Empty in a shipped build: CI fails otherwise. */
  readonly contentIssues: readonly ContentIssue[];
  readonly profiles: Profiles;
  /** One child's records. A scope reads and writes only its own profile's blueprints, runs and card games. */
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
  /**
   * The profile in use on this device, whose records the child's app opens (task 5.1): the one chosen with `use`, or
   * the only one when the device has one. Undefined when several are on the device and none of them is chosen.
   */
  inUse(): Promise<Profile | undefined>;
  /**
   * Chooses the profile in use on this device: the parent view's profile switch (task 5.1). The choice is this
   * device's alone and never syncs. Refuses a profile that is not on the device, and a device whose page storage is
   * blocked.
   */
  use(id: ProfileId): Promise<Profile>;
  /**
   * Deletes the profile and everything it owns: its blueprints, runs and card-game results (D38), and what this device
   * noted for it outside the database: builds the autosave journal holds, and the choice of it as the profile in use.
   * The parent view asks the adult to confirm first. The app never deletes anything on its own.
   */
  remove(id: ProfileId): Promise<void>;
}

export interface ProfileStore {
  readonly profile: ProfileId;
  readonly blueprints: Blueprints;
  readonly runs: Runs;
  readonly cardGames: CardGames;
}

/** Blueprint CRUD, keyed by `meta.id`. The blueprint is the only persisted build format (ground rule 5). */
export interface Blueprints {
  /** Newest `updatedAt` first. */
  list(): Promise<readonly BlueprintSummary[]>;
  /** A new, empty build: a fresh `meta.id` (UUID v4), this profile as author, created and updated now, high-water marks at 0. */
  create(init: { readonly name: string; readonly level: Level; readonly arena: ArenaRef }): Promise<Blueprint>;
  /**
   * Keeps a build that comes from outside this profile as the child's own: a challenge's `start` (a breakdown or a
   * what-if), or a shared link's blueprint (D43, "keep a copy"). It is migrated and validated like a stored one, then
   * stored with a fresh `meta.id`, this profile as author, created and updated now, and `name` when given; its parts,
   * wires, settings, arena and high-water marks are kept. Nothing is stored when it does not validate.
   */
  copy(source: unknown, name?: string): Promise<BlueprintLoad>;
  /**
   * Migrates the stored document to the current version (the schema's `migrateBlueprint`, task 0.3) and validates it
   * against `content`. A document that fails comes back with its issues and stays stored, untouched: nothing is lost.
   */
  load(id: BlueprintId): Promise<BlueprintLoad>;
  /**
   * Stores a build this profile already holds, in canonical form under its `meta.id`, with `updatedAt` stamped now.
   * Refuses a `meta.id` the profile does not hold (new builds come from create, copy or duplicate), another
   * profile's build, and one that does not validate. The `updatedAt` given names the stored version the build was
   * saved from (as load and save return it): when the stored build has changed since, in another tab, the stored
   * version is kept as its own blueprint (`keptFrom`) and this one keeps the id, as sync's conflict rule below.
   */
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
 * The name-the-part card game's results (task 5.4, D40): rounds of ten cards drawn from Level 1–2 parts, each marked
 * by the adult. The latest round counts. Only the adult sees a result; the child never sees a score.
 */
export interface CardGames {
  /** Stores a finished round for this child, stamped now. */
  add(cards: readonly CardMark[]): Promise<CardGameResult>;
  /** Oldest first. */
  list(): Promise<readonly CardGameResult[]>;
  /** The round that counts: the latest. */
  latest(): Promise<CardGameResult | undefined>;
}

export interface CardMark {
  readonly part: PartTypeId;
  /** Whether the child named the part, as the adult marked it. */
  readonly named: boolean;
}

export interface CardGameResult {
  /** A UUID v4 the store generates. */
  readonly id: string;
  readonly profile: ProfileId;
  readonly playedAt: Timestamp;
  /** The cards in the order they were shown. */
  readonly cards: readonly CardMark[];
}

/**
 * Sync (task 5.5) goes through a pluggable remote: an in-memory one for tests, an HTTP one disabled until a host is
 * configured (D10, D13). Conflict rule: when one `meta.id` changed on two devices since the last sync, the copy
 * with the later `meta.updatedAt` keeps the id and the other is kept as its own blueprint with a fresh `meta.id`
 * (`keptFrom`). Blueprints are never merged and never dropped. Runs and card-game results are only ever added.
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

export type SyncCollection = 'profiles' | 'blueprints' | 'runs' | 'card-games';

export interface SyncChange {
  readonly collection: SyncCollection;
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

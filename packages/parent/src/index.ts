// @servo/parent: the adult's side of Servo (tasks 5.1–5.4). Typed stubs until those tasks land; each throws.
// Task 5.1 has landed: the account and child profiles, in accounts/.
// Imports only @servo/schema and @servo/app/store (the package map). See README.md.

import type { CardGameResult, Content, ServoStore } from '@servo/app/store';
import type {
  Blueprint,
  BlueprintId,
  Catalogue,
  ChallengeId,
  FailureModeId,
  PartFamily,
  PartTypeId,
  PlacedPartId,
  RunId,
  RunRecord,
  Text,
  Timestamp,
} from '@servo/schema';
import { mountParentWith } from './accounts/index.ts';

/** What the progress view reads for one child: nothing the child has to do (brief Section 7). */
export interface ProgressInput {
  /** The child's run records, oldest first. */
  readonly runs: readonly RunRecord[];
  /** Part records and challenge kinds. */
  readonly content: Content;
  readonly cardGames: readonly CardGameResult[];
}

/** One child's progress, derived whenever the view opens; never stored, never shown to the child. */
export interface Progress {
  /** Each part type in the blueprint of any Run, from the first such Run. */
  readonly partsMet: readonly PartMet[];
  /** The first passing Run of each unscripted build. */
  readonly unscriptedBuildsPassed: readonly UnscriptedPass[];
  /** Each fault a later Run no longer showed, with what the run record says fixed it. */
  readonly faultsFixed: readonly FaultFixed[];
  /** Total time in the sandbox. Absent until task 6.2's telemetry exists (D39). */
  readonly timeInSandboxMs?: number;
  /** The latest card-game round, which is the one that counts (D40). The adult sees it; the child never does. */
  readonly partsNamed?: { readonly named: number; readonly of: number; readonly playedAt: Timestamp };
}

export interface PartMet {
  readonly part: PartTypeId;
  readonly firstRun: RunId;
  readonly at: Timestamp;
}

export interface UnscriptedPass {
  readonly challenge: ChallengeId;
  readonly run: RunId;
  /** The pass-rate measure counts a pass within 3 Runs (brief Section 14). */
  readonly runNumber: number;
  readonly at: Timestamp;
}

export interface FaultFixed {
  readonly partId: PlacedPartId;
  readonly part: PartTypeId;
  readonly failure: FailureModeId;
  /** The first Run that showed it, where time-to-fix starts. */
  readonly firstSeen: Timestamp;
  /** The Run whose record lists it in `fixed`. */
  readonly fixedBy: RunId;
  readonly fixedAt: Timestamp;
  /** Runs from the first that showed it to the one that fixed it. */
  readonly runs: number;
}

export type ProgressOf = (input: ProgressInput) => Progress;

/** The progress read model (task 5.2): pure, and it reconciles to the run records. */
export const progressOf: ProgressOf = () => {
  throw new Error('progressOf is not implemented yet (task 5.2).');
};

/** A printable parts list for one blueprint (task 5.3). */
export interface PartsList {
  readonly blueprint: { readonly id: BlueprintId; readonly name: string };
  /** Each part type once, in family order, with its real name and how many the build uses. */
  readonly parts: readonly { readonly part: PartTypeId; readonly name: Text; readonly family: PartFamily; readonly quantity: number }[];
  /** The wiring in plain words, one line per connection, crossing one motor's leads where a real kit needs it (D27). */
  readonly wiring: readonly string[];
  /** The adult-supervision notes of the parts that have one (`card.safetyNote`). */
  readonly safetyNotes: readonly Text[];
}

export type PartsListOf = (blueprint: Blueprint, catalogue: Catalogue) => PartsList;

export const partsListOf: PartsListOf = () => {
  throw new Error('partsListOf is not implemented yet (task 5.3).');
};

/** Ten part types drawn from the Level 1–2 parts in `content`, in the order to show them (D40). Same seed, same deck. */
export type DrawCards = (content: Content, seed: number) => readonly PartTypeId[];

export const drawCards: DrawCards = () => {
  throw new Error('drawCards is not implemented yet (task 5.4).');
};

export interface ParentHandle {
  /** Removes the parent view from its host. */
  destroy(): void;
}

/**
 * The parent view on its own page of the web build, behind the parental gate (D28): the profile list and switch,
 * then progress, exports and the card game per child (task 5.1). The caller opens the store and closes it.
 */
export type MountParent = (host: HTMLElement, store: ServoStore) => ParentHandle;

export const mountParent: MountParent = (host, store) => mountParentWith(host, store);

export {
  ChoiceNotKept,
  NAME_MAX,
  NameRefused,
  PARENT_TEXT,
  ShareRefused,
  addChild,
  mountParentWith,
  nameOf,
  readAccounts,
  removeChild,
  renameChild,
  shareLinkFor,
  switchChild,
} from './accounts/index.ts';
export type { Accounts, ParentOptions } from './accounts/index.ts';

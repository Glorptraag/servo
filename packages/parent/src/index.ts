// @servo/parent: the adult's side of Servo (tasks 5.1–5.4). Typed stubs until those tasks land; each throws.
// Tasks 5.1, 5.2 and 5.3 have landed: the account and child profiles, in accounts/, progress, in progress/, and the
// parts-list export, in export/.
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
import { partsListFrom } from './export/index.ts';
import { progressFrom } from './progress/index.ts';

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
  /** Each part type in the blueprint of any Run, from the first such Run. Every figure skips a Run of 0 ticks. */
  readonly partsMet: readonly PartMet[];
  /** The first passing Run of each unscripted build, in the order they were passed. */
  readonly unscriptedBuildsPassed: readonly UnscriptedPass[];
  /**
   * Each fault a later Run of the same challenge, or of the same build in the sandbox, ran past without, with a change
   * to the faulted part, its ports or its wires (D31, D75, D76, D96). In the order they were fixed.
   */
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
  /** The first later Run that ran past the tick the fault showed at without it, with a change to the part. */
  readonly fixedBy: RunId;
  readonly fixedAt: Timestamp;
  /** Runs of its challenge or build from the first that showed it to the one that fixed it, both counted: at least 2. */
  readonly runs: number;
}

export type ProgressOf = (input: ProgressInput) => Progress;

/** The progress read model (task 5.2): pure, and it reconciles to the run records. */
export const progressOf: ProgressOf = progressFrom;

/** A printable parts list for one blueprint (task 5.3). */
export interface PartsList {
  readonly blueprint: { readonly id: BlueprintId; readonly name: string };
  /** Each part type once, in family order, with its real name and how many the build uses. */
  readonly parts: readonly { readonly part: PartTypeId; readonly name: Text; readonly family: PartFamily; readonly quantity: number }[];
  /**
   * The connections in plain words, one line per wire, as a real kit makes them: the only steps on the page. Where the
   * real kit needs a motor's leads crossed (D27), its lines already cross them and are marked.
   */
  readonly wiring: readonly string[];
  /** Notes for the real kit: which marked lines already cross which leads, why, and what is left unconnected. Never steps. */
  readonly realKit: readonly string[];
  /** The adult-supervision notes of the parts that have one (`card.safetyNote`). */
  readonly safetyNotes: readonly Text[];
}

/** Throws `UnknownPart` for a blueprint that names a part type or port the catalogue does not have. */
export type PartsListOf = (blueprint: Blueprint, catalogue: Catalogue) => PartsList;

export const partsListOf: PartsListOf = partsListFrom;

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
export { EXPORT_TEXT, LIST_TEXT, UnknownPart } from './export/index.ts';
export { PROGRESS_TEXT, readProgress } from './progress/index.ts';
export type { ProgressRead } from './progress/index.ts';

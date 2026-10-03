// Every line the challenge runner, the arena strip and Home show or say: real words, no praise, no exclamation marks
// (ground rule 7). Challenge titles and goal lines come from content; build names are the child's.
import type { ChallengeKind } from '@servo/schema';

export const CHALLENGE_TEXT = {
  /** Read aloud when the goal's check mark appears. A plain fact, never praise. */
  met: 'Goal met',
  home: 'Home',
  back: 'Back to the build',
  build: 'Build',
  newBuild: 'New build',
  savedBuilds: 'Saved builds',
  noSavedBuilds: 'No saved builds yet.',
  notKept: 'Builds are not being kept on this device.',
  reading: 'Finding saved builds.',
  challenges: 'Challenges',
  noChallenges: 'No challenges yet.',
  cannotOpen: 'This build could not be opened.',
  arena: 'Arena',
  props: 'Props',
  /** The arena preset a challenge sets, which the picker keeps while the challenge is on the canvas. */
  setByChallenge: 'This challenge sets the arena.',
} as const;

/** The brief's names for each kind of challenge (Section 5). */
export const KIND_WORDS: Readonly<Record<ChallengeKind, string>> = {
  'part-introduction': 'Part introduction',
  guided: 'Guided challenge',
  breakdown: 'Breakdown',
  'what-if': 'What-if',
  'unscripted-build': 'Unscripted build',
};

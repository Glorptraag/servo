// Reading one child's progress from the store (task 5.2): their Runs and card-game rounds, through their own scope
// only (store.forProfile), so no other child's records are ever asked for.
import type { ServoStore } from '@servo/app/store';
import type { ProfileId } from '@servo/schema';
import type { Progress } from '../index.ts';
import { countedRuns, progressFrom } from './model.ts';

export interface ProgressRead {
  readonly progress: Progress;
  /** How many Runs the figures were read from: every Run of the child's that stepped at least once. */
  readonly runs: number;
}

/**
 * One child's progress, or undefined for a profile that is not on this device. Runs a sync left behind for a profile
 * removed elsewhere (R-5.5) are shown under no one: the scope reads only rows of this profile, and a record that names
 * another profile in its own `profile` field is left out too.
 */
export const readProgress = async (store: ServoStore, profile: ProfileId): Promise<ProgressRead | undefined> => {
  const profiles = await store.profiles.list();
  if (!profiles.some((candidate) => candidate.id === profile)) return undefined;
  const child = store.forProfile(profile);
  const [runs, cardGames] = await Promise.all([child.runs.list(), child.cardGames.list()]);
  const own = runs.filter((run) => run.profile === undefined || run.profile === profile);
  return {
    progress: progressFrom({ runs: own, content: store.content, cardGames: cardGames.filter((round) => round.profile === profile) }),
    runs: countedRuns(own).length,
  };
};

// Shared links (task 5.6): read-only links between adults, with the build in the URL fragment and no profile data
// (D10, D21, D43). See the package README, "Shared links".
import { isShareFragment } from './link.ts';

export {
  LINK_FORMAT,
  MAX_DOCUMENT_BYTES,
  MAX_FRAGMENT_LENGTH,
  SHARED_BUILD_NAME,
  SHARED_META_KEYS,
  SHARE_KEY,
  fragmentOf,
  isShareFragment,
  readShareFragment,
  seedOf,
  shareLinkOf,
  sharedCopyOf,
} from './link.ts';
export type { ShareOptions, ShareResult, SharedRead } from './link.ts';
export { MAX_STEPS_PER_FRAME, Replay, SPIN_UP_MS, pageClock } from './replay.ts';
export type { ReplayClock, ReplayOptions, ReplayPhase } from './replay.ts';
export { SHARE_TEXT, mountSharedPage, prefersReducedMotion } from './view.tsx';
export type { SharedPageHandle, SharedPageOptions } from './view.tsx';

/**
 * Reloads the page when its fragment moves into, out of or between shared links (a link pasted into a tab already
 * open), so the page always opens what its address says: the child's app saves what waits as the page goes.
 */
export const followShareFragment = (view: Window): void => {
  let current = view.location.hash;
  view.addEventListener('hashchange', () => {
    const next = view.location.hash;
    if ((isShareFragment(current) || isShareFragment(next)) && next !== current) view.location.reload();
    current = next;
  });
};

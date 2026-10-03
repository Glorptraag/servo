// The hint ladder (task 4.6): which ladder and rung, drawn through the canvas's showHint, and do-it as one `batch`.
// See the README, "Hints".
export { HintLadderController, MISSED_RUNS_BEFORE_OFFER, NO_HINT } from './controller.ts';
export type { HintCanvas, HintLadderOptions, HintState } from './controller.ts';
export { HintButton } from './hint-button.tsx';
export type { HintButtonProps } from './hint-button.tsx';
export { chooseLadder, doItCommand, narrowStep, partOfStep, partsMatching, triggerParts } from './ladder.ts';
export type { DoIt, LadderChoice, RunFault } from './ladder.ts';
export { HintLog } from './log.ts';
export type { HintUses } from './log.ts';
export { HINT_TEXT } from './text.ts';

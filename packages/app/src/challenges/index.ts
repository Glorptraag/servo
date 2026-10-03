// The challenge runner (task 4.5): the goal judge, the header's goal line, the arena strip and Home. See the README,
// "Challenges". The judge (goal.ts, world.ts) is pure and is also exported alone as `@servo/app/goal`.
export { ArenaStrip, PROP_PALETTE } from './arena-strip.tsx';
export type { ArenaStripProps, PaletteProp } from './arena-strip.tsx';
export { GoalWatch, NOT_MET, goalJudgeFor, judgeRun, namedFaults } from './goal.ts';
export type { GoalJudge, GoalVerdict, GoalWatchOptions } from './goal.ts';
export { GoalLine } from './goal-line.tsx';
export type { GoalLineProps } from './goal-line.tsx';
export { BUILD_NAME, Home, challengesByLevel, nextBuildName, sandboxArena } from './home.tsx';
export type { HomeProps } from './home.tsx';
export { CHALLENGE_TEXT, KIND_WORDS } from './text.ts';
export { LIT_LEVEL, POWERED_VOLTS, RunWorld, TIPPED_DEGREES, TURNING_DEGREES, TURNING_RPM } from './world.ts';
export type { FloorPose } from './world.ts';

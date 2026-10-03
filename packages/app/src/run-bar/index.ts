// The Run bar and the app's run loop (task 4.4). See the README, "The Run bar", and docs/run-loop.md.
export { UNDO_STEPS, UndoHistory } from './history.ts';
export { isRunKey, spaceBelongsTo } from './keys.ts';
export { RunRecorder } from './record.ts';
export type { RunRecorderOptions } from './record.ts';
export { RUN_BAR_TEXT, RunBar, rateWords } from './run-bar.tsx';
export type { RunBarProps } from './run-bar.tsx';
export {
  CLOCK_RATES,
  MAX_STEPS_PER_FRAME,
  NORMAL_RATE,
  RUN_LINES,
  RunLoop,
  SLOW_MOTION_RATE,
  SPIN_UP_MS,
  freshSeed,
  isSlowMotion,
  pageClock,
  runKeyOf,
} from './run-loop.ts';
export type { RunClock, RunLines, RunListener, RunLoopOptions, RunPhase, RunState } from './run-loop.ts';

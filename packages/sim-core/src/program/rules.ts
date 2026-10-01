import type { PlacedPartId, PortId } from '@servo/schema';
import { clean, signalLevel } from '../behaviour/primitives.ts';
import type { ProgramRuntime, ProgramState } from '../interface.ts';
import { levelOf } from './signals.ts';
import type { BlockCondition, BlockProgram } from './types.ts';

const isRecord = (value: ProgramState | undefined): value is { readonly [key: string]: ProgramState } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The levels in code-unit order of their ports, as canonicalJson writes keys, so equal levels give equal states. */
const sorted = (levels: Readonly<Record<PortId, number>>): Record<PortId, number> => {
  const ordered: Record<PortId, number> = {};
  for (const port of Object.keys(levels).sort()) ordered[port] = levels[port] as number;
  return ordered;
};

/** The levels a brain holds on its outputs, from its state `{ levels }`. Anything else holds none. */
const heldLevels = (state: ProgramState): Record<PortId, number> => {
  const levels = isRecord(state) && Object.hasOwn(state, 'levels') ? state.levels : undefined;
  const held: Record<PortId, number> = {};
  if (!isRecord(levels)) return held;
  for (const port of Object.keys(levels)) {
    const value = levels[port];
    const level = typeof value === 'number' ? signalLevel(value) : undefined;
    if (level !== undefined) held[port] = clean(level);
  }
  return held;
};

/** Whether a condition holds on this tick's inputs. A kind this runtime does not know never holds. */
const holds = (when: BlockCondition, inputs: Readonly<Record<PortId, number>>): boolean => {
  if (when.kind === 'always') return true;
  if (when.kind === 'reading') {
    const level = levelOf(inputs, when.input);
    if (level === undefined) return false;
    return when.compare === 'above' ? level > when.level : when.compare === 'below' ? level < when.level : false;
  }
  return false;
};

/**
 * The block-rule runtime: a ProgramRuntime that runs each brain's BlockProgram, the same way for every brain
 * (ground rule 1). Each tick the brain is on, its rules run in order, and when a rule's condition holds its actions
 * run in order, so a later action on the same output wins.
 * - An output carries no signal until an action sets it, then keeps that level, as a real microcontroller's pin
 *   does, until another action sets it.
 * - The levels set so far are the brain's state, `{ levels }`: plain JSON, so a Run replays and restores exactly.
 *   The slot starts the state again when the brain loses power, so its outputs go back to carrying no signal.
 * - A brain with no program in `programs` drives nothing, like the no-op brain. A level that is not a finite
 *   number sets nothing, and an action or condition of a kind it does not know does nothing.
 * Pure: the same programs, tick and state give the same step.
 */
export const blockRuleRuntime = (programs: ReadonlyMap<PlacedPartId, BlockProgram>): ProgramRuntime => ({
  start: () => ({ levels: {} }),
  run: (tick, state) => {
    const levels = heldLevels(state);
    for (const rule of programs.get(tick.partId)?.rules ?? []) {
      if (!holds(rule.when, tick.inputs)) continue;
      for (const action of rule.then) {
        if (action.kind !== 'set') continue;
        const level = signalLevel(action.level);
        if (level !== undefined) levels[action.output] = clean(level);
      }
    }
    return { outputs: sorted(levels), state: { levels: sorted(levels) } };
  },
});

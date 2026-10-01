import { EFFECTS } from '@servo/schema';
import type { Effect, SoundPayload } from '@servo/schema';
import { magnitude } from './primitives.ts';
import type { PrimitiveOutput } from './types.ts';

/**
 * The effects the behaviour runtime shows: what a part's failure modes claim about its own output, sound and
 * light, and about the part as a whole. The schema's other effects are other solvers' to show: `drain` (the
 * battery pack feeding the part) the electrical solver's, and `slip`, `tip` and `drag` the mechanical solver's.
 */
export const BEHAVIOUR_EFFECTS = ['still', 'slow', 'reverse', 'stall', 'hold', 'hum', 'silent', 'quiet', 'dark', 'dim', 'off'] as const satisfies readonly Effect[];

export type BehaviourEffect = (typeof BEHAVIOUR_EFFECTS)[number];

/** Whether a turning output is at rest because nothing drives it: an idle actuator, or a gearbox output or wheel that does not turn. */
const still = (output: PrimitiveOutput): boolean | undefined => {
  if (output.kind === 'actuator') return output.state === 'idle';
  if (output.kind === 'ratio' || output.kind === 'wheel') return output.rpm === 0;
  return undefined;
};

/** Doing what it does, for a primitive that gives, carries or takes power. */
const working = (output: PrimitiveOutput): boolean | undefined =>
  output.kind === 'ratio' || output.kind === 'wheel' || output.kind === 'support' ? undefined : output.working;

/** The brightest light or loudest sound among a part's loads that give it, or undefined when none does. */
const brightest = (outputs: readonly PrimitiveOutput[], emits: 'light' | 'sound'): number | undefined =>
  outputs.reduce<number | undefined>((top, output) => (output.kind === 'load' && output.emits === emits ? Math.max(top ?? 0, output.level) : top), undefined);

/**
 * What a part shows now, in the schema's words, from its primitives' outputs and its sounds (EFFECTS order):
 * - `still`: every turning output is at rest because nothing drives it;
 * - `slow`: an actuator turns or sweeps, but less than at its rated volts with the same load and settings;
 * - `reverse`: a speed actuator turns the other way from the way its settings turn it;
 * - `stall`: an actuator is driven but its load is more than it can turn; `hold`: a position actuator holds where
 *   it is, with power and no signal; `hum`: it hums;
 * - `dark` and `silent`: it gives no light, or no sound; `dim` and `quiet`: less than at its rated volts;
 * - `off`: nothing in it that gives, carries or takes power is working.
 * `slow`, `dim` and `quiet` compare with the rated volts (the schema's definition), so a part run below its
 * rated volts shows them whether or not a failure mode is active.
 */
export const effectsOf = (outputs: readonly PrimitiveOutput[], sounds: readonly SoundPayload[]): readonly Effect[] => {
  const shown = new Set<Effect>();
  const turning = outputs.map(still).filter((each): each is boolean => each !== undefined);
  if (turning.length > 0 && turning.every(Boolean)) shown.add('still');
  for (const output of outputs) {
    if (output.kind !== 'actuator') continue;
    if (output.state === 'stalled') shown.add('stall');
    if (output.mode === 'speed' && output.state === 'turning') {
      if (magnitude(output.rpm) < magnitude(output.ratedRpm)) shown.add('slow');
      if (output.reversed) shown.add('reverse');
    }
    if (output.mode === 'position') {
      if (output.state === 'sweeping' && output.sweep < output.ratedSweep) shown.add('slow');
      if (output.state === 'holding') shown.add('hold');
    }
  }
  if (sounds.some((sound) => sound.sound === 'hum' && sound.level > 0)) shown.add('hum');
  const light = brightest(outputs, 'light');
  if (light === 0) shown.add('dark');
  if (light !== undefined && light > 0 && light < 1) shown.add('dim');
  const sound = brightest(outputs, 'sound');
  if (sound === 0) shown.add('silent');
  if (sound !== undefined && sound > 0 && sound < 1) shown.add('quiet');
  const powered = outputs.map(working).filter((each): each is boolean => each !== undefined);
  if (powered.length > 0 && !powered.some(Boolean)) shown.add('off');
  return EFFECTS.filter((effect) => shown.has(effect));
};

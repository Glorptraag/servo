import type { ControlId } from '@servo/schema';
import type { Model } from '../electrical/model.ts';
import { settle, situationOf, wiredAt } from '../electrical/situation.ts';
import type { Models } from './models.ts';

/** The most switches whose positions are warmed: 2^6 = 64 settings, each searching at most 63 others. */
export const WARM_SWITCHES = 6;

/**
 * Warms the electrical solver's caches for every position of the switches, with each motor-driver channel at its setting:
 * the circuit at each setting and the schema's wiring verdicts on it (`wiredNeeds`, whose control search is the costly
 * part, review N14). A Level 1–2 Run moves only switches, by a flip or a bumper switch's touch; its channels stay at their
 * settings. Warmed, no setting a Run can reach searches inside a tick (review R-1.2, minor 4). The cap counts switches,
 * not controls, so a build with many channels is still warmed (review R-6.4, SIM-1): at most WARM_SWITCHES switches, so
 * at most 64 settings. A bigger build (none at Levels 1–2) searches each setting the first time a tick meets it. The caches
 * are keyed by what decides their value, so warming changes no answer.
 */
export const warmControls = (models: Models): void => {
  const switches = models.graph.controls.filter((control) => control.kind === 'switch');
  if (switches.length > WARM_SWITCHES) return;
  const model = models.electrical as Model;
  for (let mask = 0; mask < 1 << switches.length; mask += 1) {
    const positions: Record<ControlId, boolean> = {};
    switches.forEach((control, index) => {
      positions[control.id] = (mask & (1 << index)) !== 0;
    });
    wiredAt(model, situationOf(model, settle(model, { switches: positions })));
  }
};

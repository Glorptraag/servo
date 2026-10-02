import type { ControlId } from '@servo/schema';
import type { Model } from '../electrical/model.ts';
import { settle, situationOf, wiredAt } from '../electrical/situation.ts';
import { LIVE_TABLE_CONTROLS } from '../graph/index.ts';
import type { Models } from './models.ts';

/**
 * Warms the electrical solver's caches for every position of the switches, with each motor-driver channel at its setting:
 * the circuit at each setting and the schema's wiring verdicts on it (`wiredNeeds`, whose control search is the costly
 * part, review N14). A Run can reach any of those settings, by a flip or a bumper switch's touch; warmed, none of them
 * searches inside a tick (review R-1.2, minor 4). Only a kit-sized build is warmed: at most LIVE_TABLE_CONTROLS (6)
 * controls, so at most 64 settings, each searching at most 63 others. A bigger build (none at Levels 1–2) searches each
 * setting the first time a tick meets it. The caches are keyed by what decides their value, so warming changes no answer.
 */
export const warmControls = (models: Models): void => {
  const controls = models.graph.controls;
  if (controls.length > LIVE_TABLE_CONTROLS) return;
  const switches = controls.filter((control) => control.kind === 'switch');
  const model = models.electrical as Model;
  for (let mask = 0; mask < 1 << switches.length; mask += 1) {
    const positions: Record<ControlId, boolean> = {};
    switches.forEach((control, index) => {
      positions[control.id] = (mask & (1 << index)) !== 0;
    });
    wiredAt(model, situationOf(model, settle(model, { switches: positions })));
  }
};

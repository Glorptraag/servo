// The Level 3 slot's test bench. The content has no brain yet (no Level 3 part is authored), so these tests add the
// schema's example microcontroller to the real content: a servo motor powered as the broken-servo-without-signal
// fixture powers it (two 2-cell battery packs in series, D50), with a microcontroller on the same packs and its out 1
// on the servo motor's signal in.
import { loadContent } from '@servo/content';
import type { Content } from '@servo/content';
import { makeCatalogue, validatePartRecord } from '@servo/schema';
import type { Blueprint, PartRecord, SettingValue } from '@servo/schema';
import { exampleParts } from '@servo/schema/fixtures';

const exampleMicrocontroller = (): PartRecord => {
  const found = exampleParts.find((part) => (part as { id?: unknown }).id === 'microcontroller');
  const checked = validatePartRecord(found);
  if (!checked.ok) throw new Error('the schema has no valid example microcontroller');
  return checked.value;
};

export const microcontroller: PartRecord = exampleMicrocontroller();

const { content: launchContent } = loadContent();

/** The real content with the schema's example microcontroller added. */
export const benchContent = (record: PartRecord = microcontroller): Content => {
  const parts = [...launchContent.parts, record];
  return { ...launchContent, parts, catalogue: makeCatalogue({ parts, arenas: launchContent.arenas, kits: launchContent.kits }) };
};

/** The servo motor on a microcontroller's out 1, with the servo motor's settings as given. */
export const servoOnBrain = (servoSettings: Readonly<Record<string, SettingValue>> = {}, brainPart = 'microcontroller'): Blueprint => ({
  version: 1,
  meta: {
    id: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607',
    name: 'Servo motor on a microcontroller',
    level: 3,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    highWater: { parts: 0, wires: 6 },
  },
  arena: { preset: 'open-floor', props: [] },
  parts: [
    { id: 'battery-1', part: 'battery-pack-2-cell', position: { x: -80, y: 30 }, rotation: 0, settings: {} },
    { id: 'battery-2', part: 'battery-pack-2-cell', position: { x: -80, y: -30 }, rotation: 0, settings: {} },
    { id: 'brain', part: brainPart, position: { x: 0, y: 60 }, rotation: 0, settings: {} },
    { id: 'servo', part: 'servo-motor', position: { x: 60, y: 0 }, rotation: 0, settings: servoSettings },
  ],
  wires: [
    { id: 'w1', from: { part: 'battery-1', port: 'plus' }, to: { part: 'battery-2', port: 'minus' } },
    { id: 'w2', from: { part: 'battery-2', port: 'plus' }, to: { part: 'servo', port: 'plus' } },
    { id: 'w3', from: { part: 'battery-1', port: 'minus' }, to: { part: 'servo', port: 'minus' } },
    { id: 'w4', from: { part: 'battery-2', port: 'plus' }, to: { part: 'brain', port: 'plus' } },
    { id: 'w5', from: { part: 'battery-1', port: 'minus' }, to: { part: 'brain', port: 'minus' } },
    { id: 'w6', from: { part: 'brain', port: 'out-1' }, to: { part: 'servo', port: 'signal' } },
  ],
});

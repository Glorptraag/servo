// The spec card's layers by level (brief Section 12, SPEC_CARD_LAYERS), worked out from the real part records: every
// Level 1–2 part at Levels 1 and 2, its ports in order, the settings unlocked at the level with their current values,
// and failure notes in the record's order.
import { describe, expect, it } from 'vitest';
import { loadContent } from '@servo/content';
import type { Level, PartRecord, PlacedPart } from '@servo/schema';
import { cardModel, failureNotes, layerShows, settingValue, titleOf, withUnit } from '../../src/spec-card/index.ts';

const { content } = loadContent();
const launchParts = content.parts.filter((part) => part.identity.level <= 2);
const placedAs = (record: PartRecord, settings: PlacedPart['settings'] = {}): PlacedPart => ({
  id: 'p1',
  part: record.id,
  position: { x: 0, y: 0 },
  rotation: 0,
  settings,
});
const part = (id: string): PartRecord => {
  const record = content.catalogue.parts.get(id);
  if (!record) throw new Error(`no part ${id}`);
  return record;
};

describe('the spec card model', () => {
  it('has every Level 1–2 part in the content', () => {
    expect(launchParts.map((record) => record.id).sort()).toEqual(
      [
        'battery-pack-1-cell',
        'battery-pack-2-cell',
        'bumper-switch',
        'buzzer',
        'caster',
        'chassis',
        'dc-motor',
        'gearbox',
        'led',
        'motor-driver',
        'servo-motor',
        'switch',
        'wheel-large',
        'wheel-small',
      ].sort(),
    );
  });

  it('shows the layers the schema gives each level', () => {
    expect([1, 2, 3, 4, 5].map((level) => layerShows('does', level as Level))).toEqual([true, true, true, true, true]);
    expect([1, 2, 3, 4, 5].map((level) => layerShows('needs-gives', level as Level))).toEqual([false, true, true, true, true]);
    expect([1, 2, 3, 4, 5].map((level) => layerShows('popular-mechanics', level as Level))).toEqual([false, true, true, true, true]);
    expect([1, 2, 3, 4, 5].map((level) => layerShows('spec-line', level as Level))).toEqual([false, false, false, true, true]);
    expect(layerShows('settings', 5)).toBe(false);
    expect(layerShows('failure-notes', 5)).toBe(false);
  });

  for (const record of launchParts) {
    it(`${record.id}: name and what it does at Level 1; needs, gives, popular mechanics and the safety note from Level 2`, () => {
      const one = cardModel(record, placedAs(record), 1);
      expect(one.text).toEqual({ title: titleOf(record.identity.name), does: record.card.does });
      const two = cardModel(record, placedAs(record), 2);
      expect(two.text).toEqual({
        title: titleOf(record.identity.name),
        does: record.card.does,
        needs: record.card.needs,
        gives: record.card.gives,
        popularMechanics: record.card.popularMechanics,
        ...(record.card.safetyNote ? { safetyNote: record.card.safetyNote } : {}),
      });
      for (const [level, model] of [[1, one], [2, two]] as const) {
        expect(model.ports).toEqual(record.ports.map((port) => ({ id: port.id, label: port.label, type: port.type })));
        expect(model.settings.map(({ setting }) => setting.id)).toEqual(
          record.settings.filter((setting) => setting.unlockLevel <= level).map((setting) => setting.id),
        );
      }
      for (const line of Object.values(two.text)) expect(line).not.toMatch(/!/);
    });
  }

  it('titles a real name by its first letter only', () => {
    expect(titleOf('DC motor')).toBe('DC motor');
    expect(titleOf('servo motor')).toBe('Servo motor');
    expect(titleOf('LED')).toBe('LED');
    expect(titleOf('2-cell battery pack')).toBe('2-cell battery pack');
  });

  it('offers only the settings unlocked at the level, with the placed part’s value or the default (D15)', () => {
    const motor = part('dc-motor');
    expect(cardModel(motor, placedAs(motor), 1).settings).toEqual([]);
    expect(cardModel(motor, placedAs(motor), 2).settings.map(({ setting, value }) => [setting.id, value])).toEqual([['direction', 'forward']]);
    expect(cardModel(motor, placedAs(motor, { direction: 'backward' }), 2).settings.map(({ value }) => value)).toEqual(['backward']);
    expect(cardModel(motor, placedAs(motor), 3).settings.map(({ setting, value }) => [setting.id, value])).toEqual([
      ['direction', 'forward'],
      ['speed', 100],
    ]);
    const driver = part('motor-driver');
    expect(cardModel(driver, placedAs(driver, { 'motor-b': 'stop' }), 2).settings.map(({ setting, value }) => [setting.id, value])).toEqual([
      ['motor-a', 'forward'],
      ['motor-b', 'stop'],
    ]);
    const led = part('led');
    expect(cardModel(led, placedAs(led), 2).settings).toEqual([]);
    const servo = part('servo-motor');
    const angle = servo.settings[0];
    if (!angle) throw new Error('no angle');
    expect(settingValue(angle, placedAs(servo, { angle: 45 }))).toBe(45);
    expect(settingValue(angle, placedAs(servo, { angle: 'wide' }))).toBe(90);
  });

  it('writes each value with its real unit', () => {
    expect(withUnit(90, '°')).toBe('90°');
    expect(withUnit(50, '%')).toBe('50%');
    expect(withUnit(6, 'V')).toBe('6 V');
  });

  it('gives the card lines of the failures happening now, in the record’s order', () => {
    const motor = part('dc-motor');
    expect(failureNotes(motor, [])).toEqual([]);
    expect(failureNotes(motor, ['reversed', 'no-circuit'])).toEqual([
      'No complete circuit: the shaft stays still.',
      'Wires swapped: it turns the other way.',
    ]);
  });
});

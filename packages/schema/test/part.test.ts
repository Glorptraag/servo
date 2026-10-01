import { describe, expect, it } from 'vitest';
import { EFFECTS, PRIMITIVE_KINDS, UNMET, validatePartRecord } from '../src/index.ts';
import { edited, part, parts, push, reasons, remove, set } from './support.ts';
import type { Change } from './support.ts';

/** The reasons an example record is refused after the given changes. */
const refusal = (id: string, ...changes: readonly Change[]): string[] => reasons(validatePartRecord(edited(part(id), ...changes)));

describe('part records: structure and text', () => {
  it('needs every field', () => {
    expect(refusal('led', remove(['card']))).toEqual(['value.missing at $.card']);
  });

  it('refuses fields the schema does not define', () => {
    expect(refusal('led', set(['mascot'], 'Sparky'))).toEqual(['value.unknown_key at $.mascot']);
  });

  it('refuses an exclamation mark in system text', () => {
    expect(refusal('led', set(['card', 'does'], 'Gives light!'))).toEqual(['text.exclamation at $.card.does']);
  });

  it('keeps system text to one trimmed line', () => {
    expect(refusal('led', set(['failureModes', 0, 'teachingNote'], 'One line.\nTwo lines.'))).toEqual([
      'text.format at $.failureModes[0].teachingNote',
    ]);
    expect(refusal('led', set(['card', 'gives'], ' Gives: light.'))).toEqual(['text.format at $.card.gives']);
  });

  it('takes families and domains from the brief, not free strings', () => {
    expect(refusal('led', set(['identity', 'family'], 'lights'))).toEqual(['value.not_allowed at $.identity.family']);
    expect(refusal('led', set(['identity', 'domains'], []))).toEqual(['value.empty at $.identity.domains']);
    expect(refusal('led', push(['identity', 'domains'], 'electronics-and-power'))).toEqual(['value.duplicate at $.identity.domains[1]']);
  });

  it('checks formats: ids, colours and asset keys', () => {
    expect(refusal('led', set(['id'], 'Big LED'))).toEqual(['value.bad_format at $.id']);
    expect(refusal('led', set(['identity', 'colours', 'main'], '#E53935'))).toEqual(['value.bad_format at $.identity.colours.main']);
    expect(refusal('led', set(['identity', 'art'], 'LED.png'))).toEqual(['value.bad_format at $.identity.art']);
  });

  it('keeps the centre of mass inside the body', () => {
    expect(refusal('led', set(['body', 'centreOfMass', 'z'], 11))).toEqual(['value.inconsistent at $.body.centreOfMass']);
  });

  it('refuses ports that share an id', () => {
    expect(refusal('led', push(['ports'], part('led').ports[0]))).toEqual(['id.duplicate at $.ports[2].id']);
  });
});

describe('part records: behaviour primitives', () => {
  it('takes primitive kinds from the closed vocabulary only', () => {
    expect(refusal('dc-motor', set(['behaviour', 0, 'kind'], 'motor'))).toEqual(['value.not_allowed at $.behaviour[0].kind']);
  });

  it('binds primitives to ports of the right type, role and polarity', () => {
    expect(refusal('dc-motor', set(['behaviour', 0, 'drive'], 'plus'))).toEqual(['port.wrong_kind at $.behaviour[0].drive']);
    expect(refusal('dc-motor', set(['behaviour', 0, 'drive'], 'axle'))).toEqual(['ref.unknown_port at $.behaviour[0].drive']);
    expect(refusal('battery-pack-2-cell', set(['behaviour', 0, 'output'], { pos: 'minus', neg: 'plus' }))).toEqual([
      'port.wrong_polarity at $.behaviour[0].output.pos',
      'port.wrong_polarity at $.behaviour[0].output.neg',
    ]);
    expect(refusal('servo-motor', set(['behaviour', 0, 'command'], 'arm'))).toEqual(['port.wrong_kind at $.behaviour[0].command']);
  });

  it('lets only one primitive drive or read a signal or mechanical port', () => {
    expect(refusal('wheel-large', push(['behaviour'], { ...part('wheel-large').behaviour[0], id: 'second' }))).toEqual([
      'port.bound_twice at $.behaviour[1].hub',
    ]);
  });

  it('checks numbers inside a primitive against each other', () => {
    expect(refusal('battery-pack-2-cell', set(['behaviour', 0, 'emptyVolts'], 3))).toEqual(['value.inconsistent at $.behaviour[0].emptyVolts']);
    expect(refusal('servo-motor', set(['behaviour', 0, 'restDeg'], 200))).toEqual(['value.inconsistent at $.behaviour[0].restDeg']);
    expect(refusal('dc-motor', set(['behaviour', 0, 'throttle'], 2))).toEqual(['value.out_of_range at $.behaviour[0].throttle']);
  });

  it('takes exactly two switch terminals', () => {
    expect(refusal('switch', set(['behaviour', 0, 'terminals'], ['a', 'b', 'mount']))).toEqual(['value.wrong_count at $.behaviour[0].terminals']);
  });

  it('asks each actuator mode for its own fields', () => {
    expect(refusal('dc-motor', set(['behaviour', 0, 'mode'], 'position'))).toContain('value.missing at $.behaviour[0].command');
  });
});

describe('part records: needs and failure modes', () => {
  it('names a need that exists, and a way that need can go unmet', () => {
    expect(refusal('led', set(['failureModes', 0, 'need'], 'light'))).toEqual(['ref.unknown_need at $.failureModes[0].need']);
    expect(refusal('led', set(['failureModes', 0, 'unmet'], 'shorted'))).toEqual(['failure.bad_unmet at $.failureModes[0].unmet']);
  });

  it('refuses two failure modes for the same need and way', () => {
    expect(refusal('led', push(['failureModes'], { ...part('led').failureModes[0], id: 'again' }))).toEqual([
      'failure.duplicate_condition at $.failureModes[3]',
    ]);
  });

  it('shows at least one effect from the vocabulary', () => {
    expect(refusal('led', set(['failureModes', 0, 'shows'], []))).toEqual(['value.empty at $.failureModes[0].shows']);
    expect(refusal('led', set(['failureModes', 0, 'shows'], ['explodes']))).toEqual(['value.not_allowed at $.failureModes[0].shows[0]']);
  });

  it('ties a torque need to an actuator drive', () => {
    expect(refusal('gearbox', push(['needs'], { id: 'load', kind: 'torque', port: 'output' }))).toEqual(['port.wrong_kind at $.needs[1].port']);
  });
});

describe('part records: settings', () => {
  it('drives a parameter its primitive has', () => {
    expect(refusal('dc-motor', set(['settings', 0, 'binds', 'primitive'], 'engine'))).toEqual([
      'ref.unknown_primitive at $.settings[0].binds.primitive',
    ]);
    expect(refusal('dc-motor', set(['settings', 0, 'binds', 'param'], 'ratedVolts'))).toEqual(['setting.bad_binding at $.settings[0].binds.param']);
    expect(refusal('servo-motor', set(['settings', 0, 'binds', 'param'], 'throttle'))).toEqual(['setting.bad_binding at $.settings[0].binds.param']);
  });

  it('matches the setting default to the value in the primitive', () => {
    expect(refusal('dc-motor', set(['settings', 1, 'default'], 50))).toEqual(['setting.default_mismatch at $.settings[1].default']);
    expect(refusal('dc-motor', set(['settings', 0, 'default'], 'backward'))).toEqual(['setting.default_mismatch at $.settings[0].default']);
  });

  it('gives choice options values the parameter can take', () => {
    expect(refusal('dc-motor', set(['settings', 0, 'options', 1, 'value'], 1))).toEqual(['setting.bad_option at $.settings[0].options[1].value']);
    expect(refusal('led', set(['settings', 0, 'options', 1, 'value'], 'green'))).toEqual(['setting.bad_option at $.settings[0].options[1].value']);
  });

  it('keeps a number setting on whole steps within its range', () => {
    expect(refusal('servo-motor', set(['settings', 0, 'default'], 100))).toEqual(['value.inconsistent at $.settings[0].default']);
    expect(refusal('servo-motor', set(['settings', 0, 'max'], 170))).toEqual(['value.inconsistent at $.settings[0].step']);
    expect(refusal('dc-motor', set(['settings', 1, 'binds', 'range'], [0, 2]))).toEqual(['setting.bad_binding at $.settings[1].binds']);
  });

  it('refuses two settings for one parameter, and a setting that unlocks before its part', () => {
    expect(refusal('servo-motor', push(['settings'], { ...part('servo-motor').settings[0], id: 'angle-two' }))).toEqual([
      'setting.duplicate_binding at $.settings[1].binds',
    ]);
    expect(refusal('servo-motor', set(['settings', 0, 'unlockLevel'], 1))).toEqual(['setting.unlock_before_part at $.settings[0].unlockLevel']);
  });
});

describe('the vocabulary covers the Level 1–2 roster and the Level 3 slot', () => {
  it('uses every primitive kind, need kind and effect in the example records', () => {
    expect(new Set(parts.flatMap((r) => r.behaviour.map((p) => p.kind)))).toEqual(new Set(PRIMITIVE_KINDS));
    expect(new Set(parts.flatMap((r) => r.needs.map((n) => n.kind)))).toEqual(new Set(Object.keys(UNMET)));
    expect(new Set(parts.flatMap((r) => r.failureModes.flatMap((f) => f.shows)))).toEqual(new Set(EFFECTS));
  });

  const failureOf = (id: string, failure: string) => {
    const record = part(id);
    const mode = record.failureModes.find((f) => f.id === failure);
    const need = record.needs.find((n) => n.id === mode?.need);
    return { need: need?.kind, unmet: mode?.unmet, shows: mode?.shows };
  };

  it.each([
    ['no complete circuit: the part stays still', 'dc-motor', 'no-circuit', { need: 'power', unmet: 'open', shows: ['still'] }],
    ['low voltage: slow, and the battery drains faster', 'dc-motor', 'low-voltage', { need: 'power', unmet: 'low', shows: ['slow', 'drain'] }],
    ['overload: stall and hum', 'dc-motor', 'overload', { need: 'torque', unmet: 'exceeded', shows: ['stall', 'hum'] }],
    ['reversed polarity: a motor turns backwards', 'dc-motor', 'reversed', { need: 'power', unmet: 'reversed', shows: ['reverse'] }],
    ['reversed polarity: an LED stays dark', 'led', 'reversed', { need: 'power', unmet: 'reversed', shows: ['dark'] }],
    ['short circuit: rapid drain', 'battery-pack-2-cell', 'short-circuit', { need: 'isolation', unmet: 'shorted', shows: ['drain'] }],
    ['servo with power but no signal: holds and hums', 'servo-motor', 'no-signal', { need: 'signal', unmet: 'absent', shows: ['hold', 'hum'] }],
    ['top-heavy chassis: tips over', 'chassis', 'top-heavy', { need: 'balance', unmet: 'lost', shows: ['tip'] }],
    ['loose caster: drags', 'caster', 'loose', { need: 'mount', unmet: 'absent', shows: ['drag'] }],
  ])('%s', (_name, id, failure, expected) => {
    expect(failureOf(id, failure)).toEqual(expected);
  });

  it('gives the microcontroller a no-op brain and a weak 3V pin', () => {
    expect(part('microcontroller').behaviour.map((p) => p.kind)).toEqual(['program', 'regulator']);
  });
});

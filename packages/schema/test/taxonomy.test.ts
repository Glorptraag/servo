import { describe, expect, it } from 'vitest';
import validationDoc from '../docs/validation.md?raw';
import {
  DOMAINS,
  ISSUE_CODES,
  LEVELS,
  PART_FAMILIES,
  PORT_TYPE_STYLE,
  SCHEMA_VERSION,
  SPEC_CARD_LAYERS,
} from '../src/index.ts';

describe('families, domains and levels come from brief Sections 2 and 3', () => {
  it('names the ten part families in catalogue order', () => {
    expect(PART_FAMILIES.map((family) => family.label)).toEqual([
      'Power',
      'Brain',
      'Sense',
      'Actuators',
      'Drivetrain',
      'Structure & Ride',
      'Output',
      'Comms',
      'Connection',
      'End Effectors',
    ]);
  });

  it('names the five curriculum domains', () => {
    expect(DOMAINS.map((domain) => domain.label)).toEqual([
      'Mechanics',
      'Robotic system components',
      'Electronics and power',
      'Sensing and feedback loops',
      'Programs and computing',
    ]);
  });

  it('maps levels 1 to 5 onto Name, Connect, Configure, Diagnose and Design', () => {
    expect(LEVELS.map(({ level, label, skillLabel }) => `${level} ${label}: ${skillLabel}`)).toEqual([
      '1 Parts: Name',
      '2 Circuits: Connect',
      '3 Control: Configure',
      '4 Systems: Diagnose',
      '5 Design: Design',
    ]);
  });

  it('is schema version 1.0', () => {
    expect(SCHEMA_VERSION).toBe('1.0');
  });
});

describe('spec card layers and wire styles follow brief Sections 11–13', () => {
  it('shows each layer from the level the brief gives, and each setting from its own unlock level', () => {
    expect(Object.fromEntries(SPEC_CARD_LAYERS.map(({ layer, from }) => [layer, from]))).toEqual({
      name: 1,
      picture: 1,
      does: 1,
      'needs-gives': 2,
      'popular-mechanics': 2,
      settings: 'each-setting-unlock',
      'spec-line': 4,
      'failure-notes': 'when-it-happens',
    });
  });

  it('keeps one colour to one meaning, with a line style and socket shape as twins', () => {
    expect(PORT_TYPE_STYLE.power).toMatchObject({ colour: 'red', line: 'solid', socket: 'round' });
    expect(PORT_TYPE_STYLE.signal).toMatchObject({ colour: 'yellow', line: 'dashed', socket: 'square' });
    expect(PORT_TYPE_STYLE.mechanical).toMatchObject({ colour: 'grey', line: 'thick', socket: 'hexagon' });
  });
});

describe('issue codes', () => {
  it.each(Object.entries(ISSUE_CODES))('%s is a stable dotted code with a plain meaning', (code, meaning) => {
    expect(code).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(meaning).toMatch(/^[A-Z].*\.$/);
    expect(meaning).not.toContain('!');
  });

  it('lists exactly these codes and meanings in docs/validation.md', () => {
    const rows = validationDoc
      .split('\n')
      .map((line) => /^\| `([a-z]+\.[a-z_]+)` \| (.*) \|$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(([, code, meaning]) => [code, meaning]);
    expect(Object.fromEntries(rows)).toEqual(ISSUE_CODES);
  });
});

// The real terminology lists in packages/content/terminology (task 2.5), checked through the validator.
import { exampleChallenges, exampleParts } from '@servo/schema/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bannedFindings, compileTerminology, glossFindings, loadTerminology, partNameFindings } from '../src/validate-content/terminology.ts';
import {
  changed,
  cli,
  CONTENT_TERMINOLOGY,
  partFixture,
  removeTempFolders,
  REPO_ROOT,
  shown,
  spawnCli,
  tempFolder,
  write,
  writeSchemaFixtures,
} from './validate-content/support.ts';

// Tests here spawn the CLI as a Node process, which takes well past Vitest's 5 s default on a machine at load 200–350
// with many agents running.
vi.setConfig({ testTimeout: 120_000 });

afterEach(removeTempFolders);

const lists = loadTerminology(CONTENT_TERMINOLOGY);
const { components, qualifiers, banned, allowed } = lists.terminology;
const matcher = compileTerminology(lists.terminology);
const codes = (findings: readonly { readonly code: string }[]): string[] => findings.map((finding) => finding.code);
/** Everything the terminology checks say about one line of system text. */
const textFindings = (text: string): string[] => codes([...bannedFindings(text, matcher), ...glossFindings(text, matcher)]);

const SUMMARY = /^validate-content: \d+ records? checked, /;
const issueLines = (out: readonly string[]): string[] => out.filter((line) => !line.startsWith('note: ') && !SUMMARY.test(line));
/** An issue line without its file. */
const withoutFile = (line: string): string => line.slice(line.indexOf(': ') + 2);

/** A DC motor record with one change, written under parts/ in a fresh folder. */
const partFile = (name: string, change: (part: Record<string, unknown>) => void): string =>
  write(tempFolder(), `parts/${name}.json`, changed(partFixture('dc-motor'), change));
const card = (part: Record<string, unknown>): Record<string, unknown> => part.card as Record<string, unknown>;
const identity = (part: Record<string, unknown>): Record<string, unknown> => part.identity as Record<string, unknown>;
const run = (file: string) => cli([file, '--terminology', CONTENT_TERMINOLOGY]);

describe('the real lists', () => {
  it('load with no issues', () => {
    expect(lists.issues).toEqual([]);
    expect(lists.missing).toEqual([]);
  });

  it("name every real component in CLAUDE.md's terminology and ground rule 7, and the wire and port terms", () => {
    const names = components.map(({ name }) => name);
    for (const name of [
      'battery pack',
      'switch',
      'bumper switch',
      'DC motor',
      'servo motor',
      'motor driver',
      'gearbox',
      'wheel',
      'caster',
      'chassis',
      'LED',
      'buzzer',
      'microcontroller',
      'line sensor',
      'ultrasonic sensor',
      'power line',
      'signal line',
      'mechanical linkage',
      'mount',
      'mount point',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('give only the glosses the brief gives: chassis (frame) and microcontroller (brain)', () => {
    expect(components.filter(({ glosses }) => glosses.length > 0)).toEqual([
      { name: 'chassis', glosses: ['frame'] },
      { name: 'microcontroller', glosses: ['brain'] },
    ]);
  });

  it('list the qualifiers the Level 1–2 parts need', () => {
    expect(qualifiers).toEqual(expect.arrayContaining(['1-cell', '2-cell', 'large', 'small']));
  });

  it('ban the words CLAUDE.md, ground rule 7 and brief Section 12 name, and allow mount points (D22)', () => {
    const phrases = banned.map(({ phrase }) => phrase);
    for (const phrase of ['mascot', 'brain-y bit', 'zappy wire', 'points', 'coins', 'streaks', 'lives', 'score', 'earn', 'level up']) {
      expect(phrases).toContain(phrase);
    }
    for (const phrase of ['great job', 'well done', 'awesome', 'amazing', 'good job']) expect(phrases).toContain(phrase);
    for (const phrase of ['coin', 'zappy', 'brainy', 'great', 'brilliant', 'excellent', 'perfect', 'fantastic', 'nice one', 'nicely done']) {
      expect(phrases).toContain(phrase);
    }
    expect(allowed).toEqual(expect.arrayContaining(['mount points', 'do it for me', 'place it for me']));
  });

  it('ban the reward words, robot sounds and cheers R-6.4 CON-2 and TLS-2 name', () => {
    const phrases = banned.map(({ phrase }) => phrase);
    for (const phrase of [
      'star',
      'stars',
      'trophy',
      'reward',
      'rewards',
      'prize',
      'medal',
      'win',
      'won',
      'winner',
      'confetti',
      'unlock',
      'unlocked',
      'point',
      'life',
      'beep',
      'boop',
      'woo hoo',
    ]) {
      expect(phrases).toContain(phrase);
    }
  });

  it('give every ban a reason that cites ground rule 7, the brief or D22', () => {
    for (const { reason } of banned) expect(reason).toMatch(/ \((?:ground rule 7|brief Sections? \d+|D22)[^()]*\)\.$/);
  });

  it('never ban a word inside a listed name, gloss or qualifier', () => {
    const terms = [...components.flatMap(({ name, glosses }) => [name, ...glosses]), ...qualifiers];
    for (const term of terms) expect(bannedFindings(term, matcher)).toEqual([]);
  });
});

describe('done when: fails a record that uses a banned word', () => {
  it.each(banned.map(({ phrase, reason }) => [phrase, reason]))('refuses %s in system text', (phrase, reason) => {
    const file = partFile('banned', (part) => (card(part).popularMechanics = `A hand-held fan spins on one: ${phrase}.`));
    const result = run(file);
    expect(result.status).toBe(1);
    expect(issueLines(result.out)).toEqual([
      `${shown(file)}: terminology.banned at $.card.popularMechanics: '${phrase}' is on the banned list: ${reason}`,
    ]);
  });

  it('refuses a banned word in any case and in every system-text field', () => {
    const file = partFile('praise', (part) => {
      card(part).does = 'Great job, it turns electricity into spinning.';
      const [first] = part.failureModes as Record<string, unknown>[];
      if (first) first.hint = 'Earn points by closing the loop';
    });
    const result = run(file);
    expect(result.status).toBe(1);
    expect(issueLines(result.out).map(withoutFile)).toEqual([
      "terminology.banned at $.failureModes[0].hint: 'points' is on the banned list: Servo keeps no score (ground rule 7, D22).",
      "terminology.banned at $.failureModes[0].hint: 'Earn' is on the banned list: Nothing in Servo is earned: a level opens when a build does its job (ground rule 7, D22).",
      "terminology.banned at $.card.does: 'Great job' is on the banned list: System text never praises the child (ground rule 7, brief Section 12).",
    ]);
  });

  it("refuses speech in the robot's voice", () => {
    expect(textFindings('I need power to spin')).toEqual(['terminology.banned']);
    expect(textFindings('Give me a signal')).toEqual(['terminology.banned']);
    expect(textFindings('My wheels are stuck')).toEqual(['terminology.banned']);
  });

  it("allows the hint ladder's last rung, which the child says (rule 9, brief Sections 5 and 10)", () => {
    for (const text of ['Do it for me', 'Place it for me', 'Tap do it for me to see the wire placed']) expect(textFindings(text)).toEqual([]);
    expect(textFindings('Do it for me, then show me')).toEqual(['terminology.banned']);
  });

  it('refuses the other forms of the listed words', () => {
    for (const text of [
      'Collect a coin for each wire',
      'Join the zappy wires to plus',
      'Join the zappy one to plus',
      'The brainy bit needs power',
      'The brain-y one needs power',
      'Scoring starts when the robot moves',
      'Keep earning while it runs',
      'Levelling up opens new parts',
    ]) {
      expect(textFindings(text)).toEqual(['terminology.banned']);
    }
  });

  it('refuses common praise and cheering', () => {
    for (const word of [
      'Brilliant',
      'Excellent',
      'Perfect',
      'Fantastic',
      'Great',
      'Nice one',
      'Nicely done',
      'Top job',
      'You got it',
      'Superb',
      'Nailed it',
      'Hooray',
      'Yay',
      'Wow',
    ]) {
      expect(textFindings(`${word}, the motor turns`)).toEqual(['terminology.banned']);
    }
  });

  it('gives one issue for a banned word inside a longer banned phrase', () => {
    expect(bannedFindings('Great job, the motor turns', matcher).map((finding) => finding.message)).toEqual([
      "'Great job' is on the banned list: System text never praises the child (ground rule 7, brief Section 12).",
    ]);
    expect(textFindings('Plug in the zappy wire')).toEqual(['terminology.banned']);
    expect(textFindings('The brain-y bit and the brainy one')).toEqual(['terminology.banned', 'terminology.banned']);
    expect(textFindings('A great job and a great robot')).toEqual(['terminology.banned', 'terminology.banned']);
  });

  it('passes a challenge hint line that names the last rung', () => {
    const [challenge] = exampleChallenges.filter((fixture) => fixture.name === 'drive-and-light');
    const file = write(
      tempFolder(),
      'challenges/drive-and-light.json',
      changed(challenge?.data as Record<string, unknown>, (data) => {
        const [ladder] = data.hints as { steps: { line: string }[] }[];
        const [step] = ladder?.steps ?? [];
        if (step) step.line = 'Tap do it for me and the wire is placed';
      }),
    );
    const result = run(file);
    expect(issueLines(result.out)).toEqual([]);
    expect(result.status).toBe(0);
  });

  it('leaves exclamation marks to the schema', () => {
    const result = run(partFile('shout', (part) => (card(part).does = 'Turns electricity into spinning!')));
    expect(result.status).toBe(1);
    expect(issueLines(result.out)).toEqual([expect.stringContaining(': text.exclamation at $.card.does: ')]);
  });
});

describe('done when: passes a record that uses only listed terms', () => {
  it('passes a part whose name and text use the listed names, glosses and qualifiers', () => {
    const file = partFile('listed', (part) => {
      identity(part).name = 'DC motor';
      card(part).needs = 'Needs: a power line (red) from a 2-cell battery pack, and a mount on the chassis (frame).';
      card(part).gives = 'Gives: a spinning shaft for a large wheel or a gearbox, through a mechanical linkage (grey).';
      card(part).popularMechanics = 'A microcontroller (brain) and a motor driver turn the same kind of motor in a robot vacuum.';
    });
    const result = run(file);
    expect(issueLines(result.out)).toEqual([]);
    expect(result.out).toEqual(['validate-content: 1 record checked, no issues.']);
    expect(result.status).toBe(0);
  });

  it('accepts every listed name as a part name, alone and with each qualifier', () => {
    for (const { name } of components) {
      expect(partNameFindings(name, matcher)).toEqual([]);
      for (const qualifier of qualifiers) expect(partNameFindings(`${qualifier} ${name}`, matcher)).toEqual([]);
    }
  });

  it('accepts each listed name beside its gloss in system text', () => {
    for (const { name, glosses } of components) {
      for (const gloss of glosses) expect(textFindings(`Fix it to the ${name} (${gloss}).`)).toEqual([]);
    }
  });

  it("accepts the brief's own example sentences: colour words and short names are not glosses", () => {
    for (const text of [
      // Section 12: the servo motor's spec card, the hint examples and the popular-mechanics thread.
      'Turns to an angle you choose, and holds it.',
      'Needs: power (red) and a signal (yellow). Gives: a turning arm.',
      'Angle: 0° to 180°',
      '4.8–6 V · 180° · holds 1.8 kg·cm',
      'The same part steers a radio-controlled car and moves a camera gimbal.',
      'No signal: the arm stays where it is and hums.',
      'This motor has power in but no way out',
      'The servo is waiting for a signal',
      'Try a bigger battery',
      "A lift counterweight, a bike's gears, a car's headlights, an automatic door's sensor",
      // Section 6: the DC motor's spec card.
      'Turns electricity into spinning',
      'stall torque 0.4 kg·cm at 6 V',
      // Section 4: how builds fail, and a what-if prompt.
      'A motor with no return path does nothing',
      'A motor on a weak battery turns slowly and the battery icon drains fast',
      'A servo with power but no signal sits still and hums',
      'Correct builds move: wheels spin, servos sweep, LEDs light, buzzers sound, sensors show live numbers.',
      'What happens with one wheel bigger than the other?',
      // Section 5: a part introduction, the challenge goals and the hint ladder's last rung.
      'Meet the switch',
      'Put it in the power line, press it, the motor stops and starts',
      'Make the robot drive forward and light the LED at the same time',
      'One motor wired backwards so the robot spins on the spot',
      'Swap the 2-cell battery for a 1-cell battery and watch the speed',
      'Cross the arena and stop at the wall',
      'Do it for me',
      // Section 10: the hint ladder.
      'Pulse the part, pulse the port, draw a ghost wire, place it for me',
      // Sections 2, 3 and 13.
      'Wires a motor through a switch to a battery and it runs',
      'Add a brain (microcontroller)',
      "A car's differential, a lift's counterweight, a washing machine's sensor",
      'DC motor, connected to battery pack power out',
      // Section 4's kits, and the colour words of a part's card.
      'Rolling Start',
      'Line Runner',
      'Needs: power (red), from plus round to minus.',
    ]) {
      expect(textFindings(text)).toEqual([]);
    }
  });
});

// The schema's chassis example still says "move that point", which content's chassis rewords as "move that centre".
// Since R-7.2 bans the singular `point` (R-6.4 TLS-2), the real lists refuse that one line; rewording the example is
// a schema task. Every other example passes.
const SCHEMA_CHASSIS_POINT = "parts/chassis.json: terminology.banned at $.failureModes[0].teachingNote: 'point' is on the banned list: Servo keeps no score (ground rule 7, D22).";

describe('the schema examples pass with the real lists, but for the chassis example\'s point', () => {
  it.each(exampleParts.map((part) => [(part as { identity: { name: string } }).identity.name]))('accepts the part name %s', (name) => {
    expect(partNameFindings(name, matcher)).toEqual([]);
  });

  it('accepts every valid schema fixture, laid out as content', () => {
    const folder = tempFolder();
    const files = writeSchemaFixtures(folder);
    const result = cli([folder, '--catalogue', folder, '--terminology', CONTENT_TERMINOLOGY]);
    expect(issueLines(result.out)).toEqual([`${shown(folder)}/${SCHEMA_CHASSIS_POINT}`]);
    expect(result.out).toContain(`validate-content: ${files.length} records checked, 1 issue in 1 file.`);
    expect(result.status).toBe(1);
  });

  it('reads the real lists by default when run as pnpm validate-content does', () => {
    const result = spawnCli(['packages/schema/fixtures/parts'], REPO_ROOT);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`packages/schema/fixtures/${SCHEMA_CHASSIS_POINT}\nvalidate-content: 14 records checked, 1 issue in 1 file.\n`);
    expect(result.status).toBe(1);
  });
});

describe('part names (ground rule 7)', () => {
  it.each([
    ['sparky the DC motor', ['terminology.not_qualifier', 'terminology.not_qualifier']],
    ['Sparky the DC motor', ['terminology.proper_name', 'terminology.not_qualifier']],
    ['🤖', ['terminology.not_real_name', 'text.symbol']],
    ['???', ['terminology.not_real_name', 'text.question']],
    ['Sparky', ['terminology.not_real_name']],
    ['DC motor 🤖', ['terminology.not_qualifier', 'text.symbol']],
    ['turbo wheel', ['terminology.not_qualifier']],
  ])('refuses %s', (name, expected) => {
    const result = run(partFile('named', (part) => (identity(part).name = name)));
    expect(result.status).toBe(1);
    expect(issueLines(result.out).map((line) => withoutFile(line).split(': ')[0])).toEqual(expected.map((code) => `${code} at $.identity.name`));
  });

  it('accepts the Level 1–2 parts the plan names (tasks 2.1 and 2.2)', () => {
    for (const name of [
      'battery pack',
      '2-cell battery pack',
      '1-cell battery pack',
      'switch',
      'DC motor',
      'wheel',
      'large wheel',
      'small wheel',
      'caster',
      'chassis',
      'chassis (frame)',
      'LED',
      'motor driver',
      'buzzer',
      'gearbox',
      'bumper switch',
      'servo motor',
    ]) {
      expect(partNameFindings(name, matcher)).toEqual([]);
    }
  });
});

describe('mount points (D22)', () => {
  it('passes mount points, but not points on their own', () => {
    expect(textFindings('Needs: parts fixed to its mount points (grey).')).toEqual([]);
    expect(textFindings('Fix the caster to a mount point')).toEqual([]);
    expect(textFindings('The arm points forward')).toEqual(['terminology.banned']);
    expect(bannedFindings('Score points on the mount points', matcher).map((finding) => finding.message)).toEqual([
      "'points' is on the banned list: Servo keeps no score (ground rule 7, D22).",
      "'Score' is on the banned list: Servo keeps no score (ground rule 7, D22).",
    ]);
  });

  it('passes a record that names mount points', () => {
    const result = run(partFile('mounts', (part) => (card(part).needs = 'Needs: power (red), and a place on the chassis mount points (grey).')));
    expect(result.out).toEqual(['validate-content: 1 record checked, no issues.']);
    expect(result.status).toBe(0);
  });
});

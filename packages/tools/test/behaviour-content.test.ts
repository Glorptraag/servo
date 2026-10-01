// Behaviour fixtures generated from the part records (task 1.3): each teaching claim has a test (brief Section 6).
// For every Level 1–2 part and every one of its failure modes, a bench build and one tick's inputs are generated
// from the record alone: every need met, except the one the failure mode names, unmet in its way. They go straight
// to sim-core's behaviour runtime, without the electrical or mechanical solver: the generator writes what those
// solvers would give (volts and currents at the ports, the load on each actuator). The record's `shows` effects
// must appear, and with every need met none may. A claim the runtime does not show is the electrical solver's
// (`drain`) or the mechanical solver's (`slip`, `tip`, `drag`), and is listed as theirs.
import { describe, expect, it } from 'vitest';
import { EFFECTS, canvasPoseOf, controlId, makeCatalogue, mountPlacement, validateArenaPreset, validateBlueprint, validatePartRecord } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  Effect,
  FailureMode,
  MountPointPort,
  MountPort,
  Need,
  NeedKind,
  PartRecord,
  PlacedPart,
  PowerNeed,
  Unmet,
  ValidationResult,
} from '@servo/schema';
import { exampleArenas, exampleParts } from '@servo/schema/fixtures';
import { loadContent } from '@servo/content';
import { BEHAVIOUR_EFFECTS, behaviourModelOf, behaviourTick, startBehaviour } from '@servo/sim-core/behaviour';
import type { BehaviourInputs, PartBehaviour, PartPower, PowerReading } from '@servo/sim-core/behaviour';

// ---------------------------------------------------------------------------------------------
// Who shows what. The behaviour runtime judges signal, torque, drive and mount needs, and shows BEHAVIOUR_EFFECTS.

const JUDGED_BY: Readonly<Record<NeedKind, 'electrical solver (task 1.2)' | 'behaviour runtime' | 'mechanical solver (task 1.4)'>> = {
  power: 'electrical solver (task 1.2)',
  loop: 'electrical solver (task 1.2)',
  isolation: 'electrical solver (task 1.2)',
  signal: 'behaviour runtime',
  torque: 'behaviour runtime',
  drive: 'behaviour runtime',
  mount: 'behaviour runtime',
  floor: 'mechanical solver (task 1.4)',
  balance: 'mechanical solver (task 1.4)',
};

/** Effects another solver shows, and which. */
const SHOWN_ELSEWHERE: Readonly<Partial<Record<Effect, string>>> = {
  drain: 'electrical solver (task 1.2): the battery pack drains (D17: more for each turn at low volts)',
  slip: 'mechanical solver (task 1.4): the wheel turns but does not move the robot',
  tip: 'mechanical solver (task 1.4): the robot tips over',
  drag: 'mechanical solver (task 1.4): the robot drags its frame',
};

const ours = (effect: Effect): boolean => (BEHAVIOUR_EFFECTS as readonly Effect[]).includes(effect);

// ---------------------------------------------------------------------------------------------
// The generator: a bench build and one tick's inputs for a part, from its record alone.

/** Current through a part in a working loop, mA: any current at all, which the runtime reads only as flowing. */
const WORKING_MILLIAMPS = 100;
/** How far below its range a low-voltage condition sits: just past the bottom, where the failure starts. */
const LOW_MARGIN_VOLTS = 0.01;
const HIGH_MARGIN_VOLTS = 0.01;
const SUBJECT = 'part';
const FRAME = 'frame';

type Ends = readonly [from: string, to: string];

interface Scene {
  readonly mountOn?: { readonly mount: string; readonly point: MountPointPort; readonly frame: PartRecord };
  readonly helpers: readonly { readonly id: string; readonly record: PartRecord }[];
  readonly wires: readonly Ends[];
  readonly volts: Readonly<Record<string, number>>;
  readonly milliamps: Readonly<Record<string, number>>;
  readonly signals: Readonly<Record<string, number>>;
  readonly loads: Readonly<Record<string, number>>;
  readonly switches: Readonly<Record<string, boolean>>;
}

const EMPTY: Scene = { helpers: [], wires: [], volts: {}, milliamps: {}, signals: {}, loads: {}, switches: {} };

/** The volts a power need works at: the rated volts of the primitive on that supply, when in its range; otherwise the middle of its range. */
const workingVolts = (part: PartRecord, need: PowerNeed): number => {
  const user = part.behaviour.find(
    (spec) => (spec.kind === 'load' || spec.kind === 'actuator') && spec.supply.pos === need.supply.pos && spec.supply.neg === need.supply.neg,
  );
  const rated = user?.kind === 'load' || user?.kind === 'actuator' ? user.ratedVolts : undefined;
  return rated !== undefined && rated >= need.minVolts && rated <= need.maxVolts ? rated : (need.minVolts + need.maxVolts) / 2;
};

/** `volts` across a supply, + over −; negative volts put the − port above the + port. */
const across = (scene: Scene, id: string, pos: string, neg: string, volts: number): Scene => ({
  ...scene,
  volts: { ...scene.volts, [`${id}.${pos}`]: volts > 0 ? volts : 0, [`${id}.${neg}`]: volts < 0 ? -volts : 0 },
});

const pairOf = (ports: readonly [string, string], a: string, b: string): boolean => (ports[0] === a && ports[1] === b) || (ports[0] === b && ports[1] === a);

const isActuator = (record: PartRecord): boolean => record.behaviour.some((spec) => spec.kind === 'actuator' && spec.mode === 'speed');

/** One need of the subject, met (`working`) or unmet in its way, written into the scene; or why it cannot be. */
const withNeed = (scene: Scene, part: PartRecord, need: Need, way: 'working' | Unmet, records: readonly PartRecord[]): Scene | string => {
  switch (need.kind) {
    case 'power': {
      const working = workingVolts(part, need);
      const ways: Readonly<Record<string, number>> = { working, open: 0, low: need.minVolts - LOW_MARGIN_VOLTS, high: need.maxVolts + HIGH_MARGIN_VOLTS, reversed: -working };
      const volts = ways[way];
      if (volts === undefined) return `a power need goes unmet as open, low, high or reversed, not '${way}'`;
      if (way === 'low' && !(volts > 0)) return `its power need starts at ${need.minVolts} V, so nothing is below it`;
      return across(scene, SUBJECT, need.supply.pos, need.supply.neg, volts);
    }
    case 'loop':
    case 'isolation': {
      const source = part.behaviour.find((spec) => spec.kind === 'source' && pairOf(need.ports, spec.output.pos, spec.output.neg));
      const contacts = part.behaviour.find((spec) => spec.kind === 'switch' && pairOf(need.ports, spec.terminals[0], spec.terminals[1]));
      if (source?.kind === 'source') {
        // Out of its + into the loop; shorted, its volts ÷ internalOhms flow and nothing is left across it.
        const short = (source.volts / source.internalOhms) * 1000;
        const flow = way === 'shorted' ? short : way === 'working' ? WORKING_MILLIAMPS : 0;
        return {
          ...across(scene, SUBJECT, source.output.pos, source.output.neg, way === 'shorted' ? 0 : source.volts),
          milliamps: { ...scene.milliamps, [`${SUBJECT}.${source.output.pos}`]: -flow, [`${SUBJECT}.${source.output.neg}`]: flow },
        };
      }
      if (contacts?.kind === 'switch') {
        const short = Math.max(...records.flatMap((each) => each.behaviour.flatMap((spec) => (spec.kind === 'source' ? [(spec.volts / spec.internalOhms) * 1000] : []))));
        const flow = way === 'shorted' ? short : way === 'working' ? WORKING_MILLIAMPS : 0;
        return {
          ...scene,
          switches: { ...scene.switches, [controlId(SUBJECT, contacts.id)]: true },
          milliamps: { ...scene.milliamps, [`${SUBJECT}.${contacts.terminals[0]}`]: flow, [`${SUBJECT}.${contacts.terminals[1]}`]: -flow },
        };
      }
      return `no battery or switch of the part joins ${need.ports.join(' and ')}`;
    }
    case 'signal': {
      if (way !== 'working') return scene;
      // A level that moves a position actuator off its rest angle, so its sweep can be seen; otherwise full.
      const arm = part.behaviour.find((spec) => spec.kind === 'actuator' && spec.mode === 'position' && spec.command === need.port);
      const level = arm?.kind === 'actuator' && arm.mode === 'position' && arm.restDeg - arm.minDeg > arm.maxDeg - arm.restDeg ? 0 : 1;
      return { ...scene, signals: { ...scene.signals, [`${SUBJECT}.${need.port}`]: level } };
    }
    case 'torque': {
      const actuator = part.behaviour.find((spec) => spec.kind === 'actuator' && spec.drive === need.port);
      if (actuator?.kind !== 'actuator') return `no actuator drives '${need.port}'`;
      if (way === 'working') return scene;
      // Exactly the torque it can give at its working volts: its rated limit, scaled by volts over its rated volts.
      const supply = part.needs.find((each): each is PowerNeed => each.kind === 'power' && each.supply.pos === actuator.supply.pos && each.supply.neg === actuator.supply.neg);
      const volts = supply ? workingVolts(part, supply) : actuator.ratedVolts;
      const limit = ((actuator.mode === 'speed' ? actuator.stallTorqueNmm : actuator.holdingTorqueNmm) * volts) / actuator.ratedVolts;
      return { ...scene, loads: { ...scene.loads, [`${SUBJECT}.${actuator.id}`]: limit } };
    }
    case 'drive': {
      if (way !== 'working') return scene;
      // Turned by the first actuator record there is, at its working volts.
      const helper = records.find(isActuator);
      const shaft = helper?.behaviour.find((spec) => spec.kind === 'actuator');
      if (!helper || shaft?.kind !== 'actuator') return 'there is no actuator to turn its drive-in';
      const id = `helper-${scene.helpers.length + 1}`;
      const powered = helper.needs.reduce<Scene>((built, each) => (each.kind === 'power' ? across(built, id, each.supply.pos, each.supply.neg, workingVolts(helper, each)) : built), scene);
      return { ...powered, helpers: [...scene.helpers, { id, record: helper }], wires: [...scene.wires, [`${id}.${shaft.drive}`, `${SUBJECT}.${need.port}`]] };
    }
    case 'mount': {
      if (way !== 'working') return scene;
      const frame = records.find((each) => each.ports.some((port) => port.type === 'mechanical' && port.role === 'mount-point'));
      const point = frame?.ports.find((port): port is MountPointPort => port.type === 'mechanical' && port.role === 'mount-point');
      if (!frame || !point) return 'there is no frame to fix its mount to';
      return { ...scene, mountOn: { mount: need.port, point, frame }, wires: [...scene.wires, [`${SUBJECT}.${need.port}`, `${FRAME}.${point.id}`]] };
    }
    case 'floor':
    case 'balance':
      return scene;
  }
};

/** Every need met, or every need met but `broken`, unmet in its way. */
const sceneOf = (part: PartRecord, records: readonly PartRecord[], broken?: { readonly need: Need; readonly unmet: Unmet }): Scene | string => {
  let scene: Scene | string = EMPTY;
  for (const need of part.needs) {
    if (need !== broken?.need && typeof scene !== 'string') scene = withNeed(scene, part, need, 'working', records);
  }
  // Unmet last, so it wins over a met need on the same ports (a battery's loop and its isolation).
  if (broken && typeof scene !== 'string') scene = withNeed(scene, part, broken.need, broken.unmet, records);
  return scene;
};

const ARENA = 'open-floor';

const blueprintOf = (part: PartRecord, scene: Scene): unknown => {
  const placed = (id: string, type: string, x: number, y: number, rotation = 0): PlacedPart => ({ id, part: type, position: { x, y }, rotation, settings: {} });
  const parts: PlacedPart[] = [];
  if (scene.mountOn) {
    const mount = part.ports.find((port): port is MountPort => port.id === scene.mountOn?.mount && port.type === 'mechanical' && port.role === 'mount');
    if (!mount) throw new Error(`The ${part.identity.name} has no mount '${scene.mountOn.mount}'.`);
    const pose = canvasPoseOf({ x: 0, y: 0, rotation: 0 }, mountPlacement(scene.mountOn.point, mount));
    parts.push(placed(FRAME, scene.mountOn.frame.id, 0, 0), placed(SUBJECT, part.id, pose.x, pose.y, pose.rotation));
  } else {
    parts.push(placed(SUBJECT, part.id, 0, 0));
  }
  scene.helpers.forEach((helper, index) => parts.push(placed(helper.id, helper.record.id, 300 * (index + 1), 300)));
  const end = (text: string) => {
    const [id = '', port = ''] = text.split('.');
    return { part: id, port };
  };
  return {
    version: 1,
    parts,
    wires: scene.wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: end(from), to: end(to) })),
    arena: { preset: ARENA, props: [] },
    meta: {
      id: '0b6f3c1e-9d2a-4e5b-8c7f-1a2b3c4d5e6f',
      name: `${part.identity.name} on the bench`,
      level: 2,
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
      highWater: { parts: 0, wires: scene.wires.length },
    },
  };
};

const unwrap = <T>(result: ValidationResult<T>, what: string): T => {
  if (!result.ok) throw new Error(`${what} is not valid: ${result.issues.map(({ code, path, message }) => `${code} at ${path} (${message})`).join('; ')}`);
  return result.value;
};

const portsOf = (scene: Scene): ReadonlyMap<string, PartPower> => {
  const byPart = new Map<string, Map<string, PowerReading>>();
  for (const end of new Set([...Object.keys(scene.volts), ...Object.keys(scene.milliamps)])) {
    const [part = '', port = ''] = end.split('.');
    const ports = byPart.get(part) ?? new Map<string, PowerReading>();
    ports.set(port, { volts: scene.volts[end] ?? 0, milliamps: scene.milliamps[end] ?? 0 });
    byPart.set(part, ports);
  }
  return new Map([...byPart].map(([part, ports]) => [part, { ports }]));
};

const byPart = (values: Readonly<Record<string, number>>): ReadonlyMap<string, Readonly<Record<string, number>>> => {
  const grouped = new Map<string, Record<string, number>>();
  for (const [end, value] of Object.entries(values)) {
    const [part = '', key = ''] = end.split('.');
    grouped.set(part, { ...grouped.get(part), [key]: value });
  }
  return grouped;
};

/** How long each condition runs: the claims must show on every tick of it. */
const TICKS = 3;

/** The subject's behaviour on each tick of a generated condition. */
const behave = (part: PartRecord, scene: Scene, catalogue: Catalogue): readonly PartBehaviour[] => {
  const blueprint: Blueprint = unwrap(validateBlueprint(blueprintOf(part, scene), catalogue), `The bench build for the ${part.identity.name}`);
  const model = behaviourModelOf(blueprint, catalogue);
  const inputs: BehaviourInputs = { power: portsOf(scene), signals: byPart(scene.signals), loads: byPart(scene.loads), controls: { switches: scene.switches } };
  const ticks: PartBehaviour[] = [];
  let state = startBehaviour(model);
  for (let tick = 0; tick < TICKS; tick += 1) {
    const step = behaviourTick(model, state, inputs);
    const subject = step.parts.get(SUBJECT);
    if (!subject) throw new Error('The bench build lost its subject.');
    ticks.push(subject);
    state = step.state;
  }
  return ticks;
};

// ---------------------------------------------------------------------------------------------

interface Roster {
  readonly name: string;
  readonly parts: readonly PartRecord[];
  readonly catalogue: Catalogue;
}

const { content, issues } = loadContent();

const rosters: readonly Roster[] = [
  { name: 'the content records', parts: content.parts.filter((part) => part.identity.level <= 2), catalogue: content.catalogue },
  // Until task 2.2 authors the Level 2 records (the buzzer and the servo motor among them), the schema's example
  // records run through the same generator.
  (() => {
    const parts = exampleParts.map((data) => unwrap(validatePartRecord(data), 'An example part'));
    const arenas = exampleArenas.map((data) => unwrap(validateArenaPreset(data), 'An example arena'));
    return { name: "the schema's example records", parts: parts.filter((part) => part.identity.level <= 2), catalogue: makeCatalogue({ parts, arenas }) };
  })(),
];

interface Case {
  readonly part: string;
  readonly mode: string;
  readonly record: PartRecord;
  readonly failure: FailureMode;
  readonly need: Need;
}

const casesOf = (roster: Roster): Case[] =>
  roster.parts.flatMap((record) =>
    record.failureModes.map((failure) => {
      const need = record.needs.find((each) => each.id === failure.need);
      if (!need) throw new Error(`The ${record.identity.name}'s failure mode '${failure.id}' names no need of it.`);
      return { part: record.id, mode: failure.id, record, failure, need };
    }),
  );

describe('who shows each effect', () => {
  it('gives every effect in the schema one owner: the behaviour runtime or one named solver', () => {
    for (const effect of EFFECTS) expect([ours(effect), SHOWN_ELSEWHERE[effect] !== undefined], effect).toContain(true);
    expect(EFFECTS.filter((effect) => ours(effect) && SHOWN_ELSEWHERE[effect] !== undefined)).toEqual([]);
  });

  it('loads the content records without issues, Levels 1 and 2 among them', () => {
    expect(issues.filter((issue) => issue.file.startsWith('parts/'))).toEqual([]);
    expect(content.parts.filter((part) => part.identity.level <= 2).map((part) => part.id)).toEqual(expect.arrayContaining(['dc-motor', 'led', 'switch']));
  });
});

describe.each(rosters)('$name', (roster) => {
  const cases = casesOf(roster);

  it.each(roster.parts.map((record) => ({ part: record.id, record })))('$part works with every need met, showing nothing wrong', ({ record }) => {
    const scene = sceneOf(record, roster.parts);
    if (typeof scene === 'string') throw new Error(`No working condition for the ${record.identity.name}: ${scene}`);
    for (const tick of behave(record, scene, roster.catalogue)) {
      expect(tick.effects).toEqual([]);
      expect(tick.faults).toEqual([]);
    }
  });

  it.each(cases.filter(({ need }) => JUDGED_BY[need.kind] !== 'mechanical solver (task 1.4)'))(
    '$part · $mode: its claims show while the need goes unmet',
    ({ record, failure, need }) => {
      const scene = sceneOf(record, roster.parts, { need, unmet: failure.unmet });
      if (typeof scene === 'string') throw new Error(`The ${record.identity.name}'s '${failure.id}' cannot be produced from its primitives: ${scene}`);
      for (const tick of behave(record, scene, roster.catalogue)) {
        // Every claim this runtime shows appears on every tick of the condition.
        expect(tick.effects).toEqual(expect.arrayContaining(failure.shows.filter(ours)));
        // A failure of a need this runtime judges is active; the electrical solver judges the others.
        if (JUDGED_BY[need.kind] === 'behaviour runtime') expect(tick.faults).toContain(failure.id);
      }
      // Every other claim is a named solver's to show.
      for (const effect of failure.shows.filter((each) => !ours(each))) expect(SHOWN_ELSEWHERE[effect], `'${effect}' has no solver to show it`).toBeDefined();
    },
  );

  it.each(cases.filter(({ need }) => JUDGED_BY[need.kind] === 'mechanical solver (task 1.4)'))(
    '$part · $mode: judged by the mechanical solver, which shows its claims',
    ({ failure }) => {
      for (const effect of failure.shows) expect(SHOWN_ELSEWHERE[effect], `'${effect}' is not the mechanical solver's`).toMatch(/^mechanical solver/);
    },
  );
});

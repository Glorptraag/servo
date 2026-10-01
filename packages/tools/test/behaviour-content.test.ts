// Behaviour fixtures generated from the part records (task 1.3): each teaching claim has a test (brief Section 6).
// For every Level 1–2 content record, probes are generated from the record alone: a bench build and one tick's
// inputs, given straight to sim-core's behaviour runtime without the electrical or mechanical solver. The generator
// writes what those solvers would give: volts and currents at the ports, and the load on each actuator.
// - With every need met, at its rated volts, the part shows no effect and no fault, and reads its rated figures.
// - For each failure mode, every need is met but the one it names, unmet in its way. The part shows exactly the
//   record's claims, with what they bring (a part none of whose primitives works is also off, and an idle actuator
//   silent), and exactly that failure if this runtime judges the need.
// - Below its start volts it does nothing; halfway to its rated volts and at the top of its range it reads in
//   proportion; with no power its missing signal is not judged; and each setting moves the parameter it binds.
// A claim this runtime does not show is the electrical solver's (`drain`) or the mechanical solver's (`slip`, `tip`,
// `drag`), and is listed as theirs.
import { describe, expect, it } from 'vitest';
import { EFFECTS, canvasPoseOf, controlId, mapSettingValue, mountPlacement, validateBlueprint } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  Effect,
  MountPointPort,
  MountPort,
  Need,
  NeedKind,
  PartRecord,
  PlacedPart,
  PowerNeed,
  PowerPair,
  Primitive,
  Setting,
  Unmet,
  ValidationResult,
} from '@servo/schema';
import { loadContent } from '@servo/content';
import { BEHAVIOUR_EFFECTS, behaviourModelOf, behaviourTick, startBehaviour } from '@servo/sim-core/behaviour';
import type { BehaviourInputs, PartBehaviour, PartPower, PowerReading, PrimitiveOutput } from '@servo/sim-core/behaviour';

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

const inOrder = (effects: Iterable<Effect>): Effect[] => {
  const set = new Set(effects);
  return EFFECTS.filter((effect) => set.has(effect));
};

// ---------------------------------------------------------------------------------------------
// The primitives, read from the record by kind, as the schema documents them.

type Powered = Extract<Primitive, { kind: 'load' | 'actuator' | 'driver' | 'regulator' | 'program' }>;
type Electrical = Extract<Primitive, { kind: 'source' | 'switch' }> | Powered;

const isPowered = (spec: Primitive): spec is Powered =>
  spec.kind === 'load' || spec.kind === 'actuator' || spec.kind === 'driver' || spec.kind === 'regulator' || spec.kind === 'program';
const isElectrical = (spec: Primitive): spec is Electrical => spec.kind === 'source' || spec.kind === 'switch' || isPowered(spec);

const electrical = (part: PartRecord): Electrical[] => part.behaviour.filter(isElectrical);

const samePair = (a: PowerPair, b: PowerPair): boolean => a.pos === b.pos && a.neg === b.neg;

/** The primitives that take power from a power need's supply. */
const onSupply = (part: PartRecord, need: PowerNeed): Powered[] => part.behaviour.filter(isPowered).filter((spec) => samePair(spec.supply, need.supply));

/** The least volts at which a primitive does anything: its start or turn-on volts, or a regulator's volts plus its dropout. */
const startOf = (spec: Powered): number => {
  if (spec.kind === 'actuator') return spec.startVolts;
  if (spec.kind === 'regulator') return spec.volts + spec.dropoutVolts;
  return spec.onVolts;
};

const ratedOf = (spec: Powered): number | undefined => (spec.kind === 'load' || spec.kind === 'actuator' ? spec.ratedVolts : undefined);

/** What a part shows with these of its primitives doing nothing: an actuator still and silent, a light dark, a sounder silent; off when nothing in it works. */
const atRest = (part: PartRecord, resting: readonly Primitive[]): Effect[] => {
  const shown = new Set<Effect>();
  for (const spec of resting) {
    if (spec.kind === 'actuator') {
      shown.add('still');
      shown.add('silent');
    }
    if (spec.kind === 'load' && spec.emits?.kind === 'light') shown.add('dark');
    if (spec.kind === 'load' && spec.emits?.kind === 'sound') shown.add('silent');
  }
  const all = electrical(part);
  if (all.length > 0 && all.every((spec) => resting.includes(spec))) shown.add('off');
  return inOrder(shown);
};

/** Whether a failure mode's claims leave a primitive doing nothing: an actuator still, a light dark, a sounder silent, anything else off. */
const restsBy = (spec: Electrical, claims: readonly Effect[]): boolean => {
  if (spec.kind === 'actuator') return claims.includes('still');
  if (spec.kind === 'load' && spec.emits) return claims.includes(spec.emits.kind === 'light' ? 'dark' : 'silent');
  return claims.includes('off');
};

/** Exactly what a failure mode shows: its claims this runtime shows, and, when they leave nothing in the part working, the rest of the part at rest. */
const expectedFor = (part: PartRecord, claims: readonly Effect[]): Effect[] => {
  const mine = claims.filter(ours);
  const all = electrical(part);
  return all.length > 0 && all.every((spec) => restsBy(spec, mine)) ? inOrder([...mine, ...atRest(part, all)]) : inOrder(mine);
};

// ---------------------------------------------------------------------------------------------
// Scenes: a bench build and one tick's inputs for a part, from its record alone.

/** Current through a part in a working loop, mA: any current at all, which the runtime reads only as flowing. */
const WORKING_MILLIAMPS = 100;
/** How far past a boundary of its range a probe sits: just past it, where the change starts. */
const MARGIN_VOLTS = 0.01;
const SUBJECT = 'part';
const FRAME = 'frame';
const ARENA = 'open-floor';
/** How long each probe runs: what it expects must show on every tick. */
const TICKS = 3;

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
  readonly settings: Readonly<Record<string, string | number>>;
}

const EMPTY: Scene = { helpers: [], wires: [], volts: {}, milliamps: {}, signals: {}, loads: {}, switches: {}, settings: {} };

interface Broken {
  readonly need: Need;
  readonly unmet: Unmet;
}

/** How a probe differs from every need met at its working volts. */
interface Variation {
  /** Needs left unmet, each in its way. */
  readonly broken?: readonly Broken[];
  /** A power need's supply at these volts instead of its working volts. */
  readonly volts?: { readonly need: PowerNeed; readonly volts: number };
  /** The subject's setting values. */
  readonly settings?: Readonly<Record<string, string | number>>;
  /** Its switches open by their controls, so nothing flows through them. */
  readonly open?: boolean;
}

/** The volts a power need works at: the rated volts of the primitive on that supply, when in its range; otherwise the middle of its range. */
const workingVolts = (part: PartRecord, need: PowerNeed): number => {
  const rated = onSupply(part, need).map(ratedOf).find((volts) => volts !== undefined);
  return rated !== undefined && rated >= need.minVolts && rated <= need.maxVolts ? rated : (need.minVolts + need.maxVolts) / 2;
};

/** `volts` across a supply, + over −; negative volts put the − port above the + port. */
const across = (scene: Scene, id: string, pair: PowerPair, volts: number): Scene => ({
  ...scene,
  volts: { ...scene.volts, [`${id}.${pair.pos}`]: volts > 0 ? volts : 0, [`${id}.${pair.neg}`]: volts < 0 ? -volts : 0 },
});

const pairOf = (ports: readonly [string, string], a: string, b: string): boolean => (ports[0] === a && ports[1] === b) || (ports[0] === b && ports[1] === a);

/** The first speed actuator in the catalogue: it turns a drive-in for the probes, at its working volts. */
const helperOf = (records: readonly PartRecord[]) => {
  const record = records.find((each) => each.behaviour.some((spec) => spec.kind === 'actuator' && spec.mode === 'speed'));
  const shaft = record?.behaviour.find((spec) => spec.kind === 'actuator' && spec.mode === 'speed');
  return record && shaft?.kind === 'actuator' && shaft.mode === 'speed' ? { record, shaft } : undefined;
};

/** The largest short-circuit current of any pack in the catalogue, mA: what a switch across a pack carries. */
const shortMilliamps = (records: readonly PartRecord[]): number =>
  Math.max(...records.flatMap((each) => each.behaviour.flatMap((spec) => (spec.kind === 'source' ? [(spec.volts / spec.internalOhms) * 1000] : []))));

/** One need of the subject, met (`working`) or unmet in its way, written into the scene; or why it cannot be. */
const withNeed = (scene: Scene, part: PartRecord, need: Need, way: 'working' | Unmet, records: readonly PartRecord[], volts?: number): Scene | string => {
  switch (need.kind) {
    case 'power': {
      const working = volts ?? workingVolts(part, need);
      const ways: Readonly<Record<string, number>> = {
        working,
        open: 0,
        low: need.minVolts - MARGIN_VOLTS,
        high: need.maxVolts + MARGIN_VOLTS,
        reversed: -workingVolts(part, need),
      };
      const chosen = ways[way];
      if (chosen === undefined) return `a power need goes unmet as open, low, high or reversed, not '${way}'`;
      if (way === 'low' && !(chosen > 0)) return `its power need starts at ${need.minVolts} V, so nothing is below it`;
      return across(scene, SUBJECT, need.supply, chosen);
    }
    case 'loop':
    case 'isolation': {
      const source = part.behaviour.find((spec) => spec.kind === 'source' && pairOf(need.ports, spec.output.pos, spec.output.neg));
      const contacts = part.behaviour.find((spec) => spec.kind === 'switch' && pairOf(need.ports, spec.terminals[0], spec.terminals[1]));
      if (source?.kind === 'source') {
        // Out of its + into the loop; shorted, its volts ÷ internalOhms flow and nothing is left across it.
        const flow = way === 'shorted' ? (source.volts / source.internalOhms) * 1000 : way === 'working' ? WORKING_MILLIAMPS : 0;
        return {
          ...across(scene, SUBJECT, source.output, way === 'shorted' ? 0 : source.volts),
          milliamps: { ...scene.milliamps, [`${SUBJECT}.${source.output.pos}`]: -flow, [`${SUBJECT}.${source.output.neg}`]: flow },
        };
      }
      if (contacts?.kind === 'switch') {
        const flow = way === 'shorted' ? shortMilliamps(records) : way === 'working' ? WORKING_MILLIAMPS : 0;
        return {
          ...scene,
          switches: { ...scene.switches, [controlId(SUBJECT, contacts.id)]: true },
          milliamps: { ...scene.milliamps, [`${SUBJECT}.${contacts.terminals[0]}`]: flow, [`${SUBJECT}.${contacts.terminals[1]}`]: -flow },
        };
      }
      return `no battery or switch of the part joins ${need.ports.join(' and ')}`;
    }
    case 'signal':
      return way === 'working' ? { ...scene, signals: { ...scene.signals, [`${SUBJECT}.${need.port}`]: levelFor(part, need.port) } } : scene;
    case 'torque': {
      const actuator = part.behaviour.find((spec) => spec.kind === 'actuator' && spec.drive === need.port);
      if (actuator?.kind !== 'actuator') return `no actuator drives '${need.port}'`;
      if (way === 'working') return scene;
      // Exactly the torque it can give at its working volts: its rated limit, scaled by volts over its rated volts.
      const supply = part.needs.find((each): each is PowerNeed => each.kind === 'power' && samePair(each.supply, actuator.supply));
      const at = supply ? workingVolts(part, supply) : actuator.ratedVolts;
      const limit = ((actuator.mode === 'speed' ? actuator.stallTorqueNmm : actuator.holdingTorqueNmm) * at) / actuator.ratedVolts;
      return { ...scene, loads: { ...scene.loads, [`${SUBJECT}.${actuator.id}`]: limit } };
    }
    case 'drive': {
      if (way !== 'working') return scene;
      const helper = helperOf(records);
      if (!helper) return 'there is no actuator to turn its drive-in';
      const id = `helper-${scene.helpers.length + 1}`;
      const powered = helper.record.needs.reduce<Scene>(
        (built, each) => (each.kind === 'power' ? across(built, id, each.supply, workingVolts(helper.record, each)) : built),
        scene,
      );
      return { ...powered, helpers: [...scene.helpers, { id, record: helper.record }], wires: [...scene.wires, [`${id}.${helper.shaft.drive}`, `${SUBJECT}.${need.port}`]] };
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

/** A level that moves a position actuator off its rest angle, so its sweep shows: the end of its range farther from rest. Otherwise full. */
const levelFor = (part: PartRecord, port: string): number => {
  const arm = part.behaviour.find((spec) => spec.kind === 'actuator' && spec.mode === 'position' && spec.command === port);
  return arm?.kind === 'actuator' && arm.mode === 'position' && arm.restDeg - arm.minDeg > arm.maxDeg - arm.restDeg ? 0 : 1;
};

/** Every need met at its working volts, but as the variation says; or why the record cannot give it. */
const sceneOf = (part: PartRecord, records: readonly PartRecord[], variation: Variation = {}): Scene | string => {
  const broken = variation.broken ?? [];
  let scene: Scene | string = { ...EMPTY, settings: variation.settings ?? {} };
  for (const need of part.needs) {
    if (typeof scene === 'string' || broken.some((each) => each.need === need)) continue;
    scene = withNeed(scene, part, need, 'working', records, variation.volts?.need === need ? variation.volts.volts : undefined);
  }
  // Unmet last, so each wins over a met need on the same ports (a battery's loop and its isolation).
  for (const each of broken) if (typeof scene !== 'string') scene = withNeed(scene, part, each.need, each.unmet, records);
  if (!variation.open || typeof scene === 'string') return scene;
  let opened: Scene = scene;
  for (const spec of part.behaviour) {
    if (spec.kind !== 'switch') continue;
    opened = {
      ...opened,
      switches: { ...opened.switches, [controlId(SUBJECT, spec.id)]: false },
      milliamps: { ...opened.milliamps, [`${SUBJECT}.${spec.terminals[0]}`]: 0, [`${SUBJECT}.${spec.terminals[1]}`]: 0 },
    };
  }
  return opened;
};

const blueprintOf = (part: PartRecord, scene: Scene): unknown => {
  const placed = (id: string, type: string, x: number, y: number, rotation = 0, settings = {}): PlacedPart => ({ id, part: type, position: { x, y }, rotation, settings });
  const parts: PlacedPart[] = [];
  if (scene.mountOn) {
    const mount = part.ports.find((port): port is MountPort => port.id === scene.mountOn?.mount && port.type === 'mechanical' && port.role === 'mount');
    if (!mount) throw new Error(`The ${part.identity.name} has no mount '${scene.mountOn.mount}'.`);
    const pose = canvasPoseOf({ x: 0, y: 0, rotation: 0 }, mountPlacement(scene.mountOn.point, mount));
    parts.push(placed(FRAME, scene.mountOn.frame.id, 0, 0), placed(SUBJECT, part.id, pose.x, pose.y, pose.rotation, scene.settings));
  } else {
    parts.push(placed(SUBJECT, part.id, 0, 0, 0, scene.settings));
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

/** The subject's behaviour on each tick of a scene. */
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
// Probes: what each scene must show, from the record.

/** One reading of one primitive's output, as the record gives it. Numbers are compared to 9 decimal places. */
interface Read {
  readonly primitive: string;
  readonly field: string;
  readonly value: number | string | boolean;
}

interface Probe {
  readonly name: string;
  readonly variation: Variation;
  /** Exactly the effects every tick shows. */
  readonly effects: readonly Effect[];
  /** Exactly the failure modes this runtime makes active. */
  readonly faults: readonly string[];
  readonly reads: readonly Read[];
}

/** A setting's value as the primitive parameter it binds receives it: a number mapped by its range, or a choice's option value. */
const bound = (setting: Setting, value: string | number): number | string | boolean | undefined =>
  setting.kind === 'number' ? (typeof value === 'number' ? mapSettingValue(setting, value) : undefined) : setting.options.find((option) => option.id === value)?.value;

/** A setting's values other than its default: every other option, or every step from min to max. */
const otherValues = (setting: Setting): (string | number)[] => {
  if (setting.kind === 'choice') return setting.options.map((option) => option.id).filter((id) => id !== setting.default);
  const values: number[] = [];
  for (let step = 0; setting.min + step * setting.step <= setting.max; step += 1) values.push(setting.min + step * setting.step);
  return values.filter((value) => value !== setting.default);
};

/** The volts across a primitive's supply in a scene with every need met at its working volts. */
const voltsAt = (part: PartRecord, supply: PowerPair): number => {
  const need = part.needs.find((each): each is PowerNeed => each.kind === 'power' && samePair(each.supply, supply));
  return need ? workingVolts(part, need) : 0;
};

/**
 * What each primitive reads at `volts` across its supply, from the schema's rules: a speed actuator turns at
 * noLoadRpm × throttle × volts ÷ ratedVolts with no load, the way its settings turn it, and not at all below its
 * start volts; a position actuator sweeps at degPerSecond × volts ÷ ratedVolts towards the angle its signal
 * commands; a load gives `level` (full at its rated volts). Settings stand as the probe sets them.
 */
const readsAt = (spec: Powered, volts: number, settled: Readonly<Record<string, number | string | boolean>>, level?: number): Read[] => {
  if (spec.kind === 'actuator' && spec.mode === 'speed') {
    const throttle = typeof settled.throttle === 'number' ? settled.throttle : spec.throttle;
    const reverse = typeof settled.reverse === 'boolean' ? settled.reverse : spec.reverse;
    const drive = throttle * volts;
    const rpm = drive === 0 || drive < spec.startVolts ? 0 : ((reverse ? -1 : 1) * spec.noLoadRpm * drive) / spec.ratedVolts;
    return [{ primitive: spec.id, field: 'rpm', value: rpm }];
  }
  if (spec.kind === 'actuator') {
    const commanded = spec.minDeg + (spec.restDeg - spec.minDeg > spec.maxDeg - spec.restDeg ? 0 : 1) * (spec.maxDeg - spec.minDeg);
    if (volts < spec.startVolts) return [{ primitive: spec.id, field: 'sweep', value: 0 }];
    return [
      { primitive: spec.id, field: 'sweep', value: (spec.degPerSecond * volts) / spec.ratedVolts },
      { primitive: spec.id, field: 'commanded', value: commanded },
    ];
  }
  if (spec.kind === 'load' && level !== undefined) {
    const emits = spec.emits;
    return [
      { primitive: spec.id, field: 'level', value: level },
      ...(emits?.kind === 'light' ? [{ primitive: spec.id, field: 'colour', value: typeof settled.colour === 'string' ? settled.colour : emits.colour }] : []),
      ...(emits?.kind === 'sound' ? [{ primitive: spec.id, field: 'hz', value: typeof settled.hz === 'number' ? settled.hz : emits.hz }] : []),
    ];
  }
  if (spec.kind === 'driver') return [{ primitive: spec.id, field: 'command', value: typeof settled.command === 'number' ? settled.command : spec.command }];
  return [];
};

/** The settings a probe gives each primitive, as the parameters they bind receive them. */
const settledBy = (part: PartRecord, settings: Readonly<Record<string, string | number>>): ReadonlyMap<string, Readonly<Record<string, number | string | boolean>>> => {
  const byPrimitive = new Map<string, Record<string, number | string | boolean>>();
  for (const setting of part.settings) {
    const given = settings[setting.id];
    const value = given === undefined ? undefined : bound(setting, given);
    if (value === undefined) continue;
    byPrimitive.set(setting.binds.primitive, { ...byPrimitive.get(setting.binds.primitive), [setting.binds.param]: value });
  }
  return byPrimitive;
};

/** What each primitive reads with every need met at its working volts and these settings. */
const workingReads = (part: PartRecord, records: readonly PartRecord[], settings: Readonly<Record<string, string | number>> = {}): Read[] => {
  const settled = settledBy(part, settings);
  const helper = helperOf(records);
  const helperRpm = helper ? (readsAt(helper.shaft, voltsAt(helper.record, helper.shaft.supply), {})[0]?.value as number) : 0;
  return part.behaviour.flatMap((spec): Read[] => {
    const own = settled.get(spec.id) ?? {};
    if (isPowered(spec)) {
      const volts = voltsAt(part, spec.supply);
      return readsAt(spec, volts, own, spec.kind === 'load' ? (volts >= spec.ratedVolts ? 1 : undefined) : undefined);
    }
    if (spec.kind === 'switch') return [{ primitive: spec.id, field: 'closed', value: true }];
    if (spec.kind === 'ratio') return [{ primitive: spec.id, field: 'rpm', value: helperRpm / (typeof own.ratio === 'number' ? own.ratio : spec.ratio) }];
    if (spec.kind === 'wheel') return [{ primitive: spec.id, field: 'rpm', value: helperRpm }];
    if (spec.kind === 'support') return [{ primitive: spec.id, field: 'fixed', value: true }];
    return [];
  });
};

/** Volts as a probe's name shows them. */
const shown = (volts: number): string => `${Number(volts.toFixed(3))} V`;

/** Every probe of a record. */
const probesOf = (part: PartRecord, records: readonly PartRecord[]): Probe[] => {
  const probes: Probe[] = [{ name: 'every need met: nothing wrong, and its rated figures', variation: {}, effects: [], faults: [], reads: workingReads(part, records) }];
  for (const failure of part.failureModes) {
    const need = part.needs.find((each) => each.id === failure.need);
    if (!need || JUDGED_BY[need.kind] === 'mechanical solver (task 1.4)') continue;
    probes.push({
      name: `${failure.id}: ${need.id} ${failure.unmet}, showing ${failure.shows.join(' and ')}`,
      variation: { broken: [{ need, unmet: failure.unmet }] },
      effects: expectedFor(part, failure.shows),
      faults: JUDGED_BY[need.kind] === 'behaviour runtime' ? [failure.id] : [],
      reads: [],
    });
  }
  for (const need of part.needs) {
    if (need.kind !== 'power') continue;
    const users = onSupply(part, need);
    if (users.length === 0) continue;
    const below = Math.min(...users.map(startOf)) - MARGIN_VOLTS;
    if (below > 0) {
      probes.push({
        name: `${need.id} at ${shown(below)}, below where anything on it starts: at rest`,
        variation: { volts: { need, volts: below } },
        effects: atRest(part, users),
        faults: [],
        reads: users.flatMap((spec) => readsAt(spec, below, {}, 0)),
      });
    }
    const rated = users.map(ratedOf);
    if (rated.every((volts) => volts === undefined || need.maxVolts >= volts)) {
      probes.push({
        name: `${need.id} at ${shown(need.maxVolts)}, the top of its range: full`,
        variation: { volts: { need, volts: need.maxVolts } },
        effects: [],
        faults: [],
        reads: users.flatMap((spec) => readsAt(spec, need.maxVolts, {}, 1)),
      });
    }
    const [only] = users;
    if (users.length === 1 && only && (only.kind === 'actuator' || only.kind === 'load')) {
      const middle = (startOf(only) + only.ratedVolts) / 2;
      const less: Effect[] = only.kind === 'actuator' ? ['slow'] : only.emits?.kind === 'sound' ? ['quiet'] : only.emits?.kind === 'light' ? ['dim'] : [];
      probes.push({
        name: `${need.id} at ${shown(middle)}, halfway from its start to its rated volts: in proportion`,
        variation: { volts: { need, volts: middle } },
        effects: less,
        faults: [],
        reads: readsAt(only, middle, {}, 0.5),
      });
    }
  }
  for (const need of part.needs) {
    if (need.kind !== 'signal') continue;
    const reader = part.behaviour.find(
      (spec) =>
        (spec.kind === 'actuator' && spec.mode === 'position' && spec.command === need.port) ||
        (spec.kind === 'driver' && spec.signal === need.port) ||
        (spec.kind === 'program' && spec.inputs.includes(need.port)),
    );
    const power = reader && isPowered(reader) ? part.needs.find((each): each is PowerNeed => each.kind === 'power' && samePair(each.supply, reader.supply)) : undefined;
    if (!power) continue;
    probes.push({
      name: `${power.id} open and no signal: ${need.id} is not judged without power`,
      variation: { broken: [{ need: power, unmet: 'open' }, { need, unmet: 'absent' }] },
      effects: atRest(part, onSupply(part, power)),
      faults: [],
      reads: [],
    });
  }
  const switches = part.behaviour.filter((spec) => spec.kind === 'switch');
  if (switches.length > 0) {
    probes.push({
      name: 'opened by its control: it reads open and carries nothing',
      variation: { open: true },
      effects: atRest(part, switches),
      faults: [],
      reads: switches.map((spec) => ({ primitive: spec.id, field: 'closed', value: false })),
    });
  }
  for (const setting of part.settings) {
    // The servo motor's angle (`target`) is the program runtime's to use at Level 3 (review R-1.3, Question 1).
    if (setting.binds.param === 'target') continue;
    const spec = part.behaviour.find((each) => each.id === setting.binds.primitive);
    for (const value of otherValues(setting)) {
      const settings = { [setting.id]: value };
      const reads = workingReads(part, records, settings).filter((read) => read.primitive === setting.binds.primitive);
      const still = spec?.kind === 'actuator' && reads.some((read) => read.field === 'rpm' && read.value === 0);
      probes.push({
        name: `${setting.id} at ${String(value)}: ${setting.binds.param} follows it`,
        variation: { settings },
        effects: still && spec ? atRest(part, [spec]) : [],
        faults: [],
        reads,
      });
    }
  }
  return probes;
};

// ---------------------------------------------------------------------------------------------

const { content, issues } = loadContent();
const roster: readonly PartRecord[] = content.parts.filter((part) => part.identity.level <= 2);
const catalogue = content.catalogue;

const readOf = (outputs: readonly PrimitiveOutput[], read: Read): unknown => {
  const output = outputs.find((each) => each.primitive === read.primitive);
  return output ? (output as unknown as Record<string, unknown>)[read.field] : undefined;
};

describe('who shows each effect', () => {
  it('gives every effect in the schema one owner: the behaviour runtime or one named solver', () => {
    for (const effect of EFFECTS) expect([ours(effect), SHOWN_ELSEWHERE[effect] !== undefined], effect).toContain(true);
    expect(EFFECTS.filter((effect) => ours(effect) && SHOWN_ELSEWHERE[effect] !== undefined)).toEqual([]);
  });

  it('loads the Level 1–2 content records without issues, the five parts the task names among them', () => {
    expect(issues.filter((issue) => issue.file.startsWith('parts/'))).toEqual([]);
    expect(roster.map((part) => part.id)).toEqual(expect.arrayContaining(['dc-motor', 'led', 'buzzer', 'switch', 'servo-motor']));
  });
});

describe.each(roster.map((record) => ({ part: record.id, record })))('$part', ({ record }) => {
  const probes = probesOf(record, roster);

  it.each(probes.map((probe) => ({ name: probe.name, probe })))('$name', ({ probe }) => {
    const scene = sceneOf(record, roster, probe.variation);
    if (typeof scene === 'string') throw new Error(`The ${record.identity.name} cannot give this probe from its primitives: ${scene}`);
    for (const tick of behave(record, scene, catalogue)) {
      expect(tick.effects).toEqual(probe.effects);
      expect(tick.faults).toEqual(probe.faults);
      for (const read of probe.reads) {
        const found = readOf(tick.primitives, read);
        if (typeof read.value === 'number') expect(found, `${read.primitive}.${read.field}`).toBeCloseTo(read.value, 9);
        else expect(found, `${read.primitive}.${read.field}`).toBe(read.value);
      }
    }
  });

  const failures = record.failureModes.map((failure) => ({ failure, need: record.needs.find((each) => each.id === failure.need) }));

  it.each(failures.map(({ failure, need }) => ({ mode: failure.id, failure, need })))('$mode: every claim has a solver to show it', ({ failure, need }) => {
    expect(need, `'${failure.need}' is not a need of the part`).toBeDefined();
    if (!need) return;
    if (JUDGED_BY[need.kind] === 'mechanical solver (task 1.4)') {
      for (const effect of failure.shows) expect(SHOWN_ELSEWHERE[effect], `'${effect}' is not the mechanical solver's`).toMatch(/^mechanical solver/);
      return;
    }
    // This runtime shows its claims (the probe above); every other claim is a named solver's.
    for (const effect of failure.shows.filter((each) => !ours(each))) expect(SHOWN_ELSEWHERE[effect], `'${effect}' has no solver to show it`).toBeDefined();
  });
});

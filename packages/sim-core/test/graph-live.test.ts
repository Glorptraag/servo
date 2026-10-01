import { describe, expect, it } from 'vitest';
import { makeCatalogue, validateArenaPreset, validatePartRecord, wiredNeeds } from '@servo/schema';
import type { Blueprint, ControlState, PartRecord, PortRef, ValidationResult, WiredVerdict } from '@servo/schema';
import { exampleArenas, exampleParts, validBlueprints } from '@servo/schema/fixtures';
import { LIVE_TABLE_CONTROLS, buildGraph, liveAt } from '../src/graph/index.ts';
import type { SimGraph } from '../src/graph/index.ts';

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
const catalogue = makeCatalogue({ parts, arenas: exampleArenas.map((arena) => unwrap(validateArenaPreset(arena))) });
const base = validBlueprints.find((entry) => entry.name === 'led-circuit')?.data as Blueprint;

/** A seeded linear congruential generator, so any failure replays exactly. */
const generator = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;

const BATTERIES = ['battery-pack-2-cell', 'battery-pack-1-cell'];
const OTHERS = ['battery-pack-1-cell', 'switch', 'bumper-switch', 'led', 'dc-motor', 'buzzer', 'servo-motor', 'motor-driver', 'microcontroller'];

/**
 * A random workbench circuit: a battery pack and up to four other parts, joined by random power wires.
 * A motor driver or microcontroller is often fed straight from the first pack, so outputs get power often
 * enough to test the rule for them.
 */
const randomCircuit = (next: () => number): Blueprint => {
  const types = [pick(next, BATTERIES), ...Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(next, OTHERS))];
  const placed = types.map((type, index) => ({ id: `p${index + 1}`, part: type, position: { x: index * 80, y: 0 }, rotation: 0, settings: {} }));
  const ports: PortRef[] = placed.flatMap((part) =>
    (catalogue.parts.get(part.part)?.ports ?? []).filter((spec) => spec.type === 'power').map((spec) => ({ part: part.id, port: spec.id })),
  );
  const pairs = new Set<string>();
  const wires: (readonly [PortRef, PortRef])[] = [];
  const wire = (a: PortRef, b: PortRef): void => {
    const key = [`${a.part}.${a.port}`, `${b.part}.${b.port}`].sort().join('|');
    if ((a.part === b.part && a.port === b.port) || pairs.has(key)) return;
    pairs.add(key);
    wires.push([a, b]);
  };
  for (const part of placed) {
    if ((part.part === 'motor-driver' || part.part === 'microcontroller') && next() < 0.6) {
      wire({ part: 'p1', port: 'plus' }, { part: part.id, port: 'plus' });
      wire({ part: 'p1', port: 'minus' }, { part: part.id, port: 'minus' });
    }
  }
  const wanted = wires.length + 1 + Math.floor(next() * 8);
  for (let attempt = 0; attempt < wanted * 4 && wires.length < wanted; attempt += 1) wire(pick(next, ports), pick(next, ports));
  return {
    ...base,
    parts: placed,
    wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from, to })),
    meta: { ...base.meta, level: 2, highWater: { parts: placed.length, wires: wires.length } },
  };
};

/** A random control state, with odd values the schema reads too: a command of NaN or −0, a control left at rest. */
const randomState = (graph: SimGraph, next: () => number): ControlState => {
  const switches: Record<string, boolean> = {};
  const channels: Record<string, number> = {};
  for (const control of graph.controls) {
    const roll = next();
    if (control.kind === 'switch') {
      if (roll < 0.45) switches[control.id] = true;
      else if (roll < 0.9) switches[control.id] = false;
    } else {
      const commands = [1, 0, -1, 0.5, Number.NaN, -0];
      const index = Math.floor(roll * (commands.length + 1));
      if (index < commands.length) channels[control.id] = commands[index] as number;
    }
  }
  return { switches, channels };
};

interface Oracle {
  /** Each net's node: the lowest net it reaches through closed switches. */
  readonly nodes: readonly number[];
  readonly sources: readonly boolean[];
  readonly nets: readonly boolean[];
  /** By `part/primitive` of each use: whether a simple closed path through it runs through a source giving power. */
  readonly powered: ReadonlyMap<string, boolean>;
  /** By part, for each battery: whether a simple closed path runs through it. */
  readonly looped: ReadonlyMap<string, boolean>;
}

/**
 * The live nets worked out by brute force, independently of the graph module: nets joined by closed
 * switches through a plain search; each output giving power exactly when the schema meets its part's
 * power need (and a driver channel is not at stop); and every simple closed path found by walking every
 * simple path. Small circuits only.
 */
const oracleOf = (graph: SimGraph, state: ControlState, verdicts: readonly WiredVerdict[]): Oracle => {
  const count = graph.nets.length;
  const closed = graph.switches.filter((join) => {
    const control = graph.controls[join.control];
    return control !== undefined && (state.switches?.[control.id] ?? control.rest) === true;
  });
  const node = Array.from({ length: count }, (_, start) => {
    const seen = new Set([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const net = queue[head] as number;
      for (const join of closed) {
        for (const [from, to] of [
          [join.a, join.b],
          [join.b, join.a],
        ]) {
          if (from === net && !seen.has(to as number)) {
            seen.add(to as number);
            queue.push(to as number);
          }
        }
      }
    }
    return Math.min(...seen);
  });
  const met = (part: string, need: string): boolean => verdicts.find((verdict) => verdict.partId === part && verdict.need === need)?.unmet === undefined;
  const sources = graph.sources.map((source) => {
    if (!source.feeder) return true;
    const record = graph.parts.get(source.part)?.record;
    const need = record?.needs.find((each) => each.kind === 'power');
    if (!record || need?.kind !== 'power') throw new Error(`No power need on ${source.part}`);
    // The output's feeder is the supply its part's power need judges.
    expect(source.spec.kind === 'driver' || source.spec.kind === 'regulator' ? source.spec.supply : undefined).toEqual(need.supply);
    if (!met(source.part, need.id)) return false;
    const control = source.control === undefined ? undefined : graph.controls[source.control];
    return control === undefined || (state.channels?.[control.id] ?? control.rest) !== 0;
  });
  const edges = [
    ...graph.uses.map((use) => ({ a: node[use.pos] as number, b: node[use.neg] as number, source: false, id: `${use.part}/${use.primitive}`, part: use.part })),
    ...graph.sources.flatMap((source, index) =>
      sources[index] ? [{ a: node[source.pos] as number, b: node[source.neg] as number, source: true, id: `${source.part}/${source.primitive}`, part: source.part }] : [],
    ),
  ];
  /** Every simple path from `from` to `to` that leaves out edge `skip`, as its nodes and whether it passes a source. */
  const paths = (from: number, to: number, skip: number): { nodes: number[]; source: boolean }[] => {
    const found: { nodes: number[]; source: boolean }[] = [];
    const walk = (at: number, nodes: number[], source: boolean): void => {
      if (at === to) {
        found.push({ nodes, source });
        return;
      }
      edges.forEach((edge, index) => {
        if (index === skip || edge.a === edge.b) return;
        const next = edge.a === at ? edge.b : edge.b === at ? edge.a : undefined;
        if (next === undefined || nodes.includes(next)) return;
        walk(next, [...nodes, next], source || edge.source);
      });
    };
    walk(from, [from], false);
    return found;
  };
  const liveNodes = new Set<number>();
  const powered = new Map<string, boolean>();
  const looped = new Map<string, boolean>();
  edges.forEach((edge, index) => {
    const closing = edge.a === edge.b ? [] : paths(edge.b, edge.a, index);
    if (edge.source) {
      if (edge.a === edge.b) liveNodes.add(edge.a);
      for (const path of closing) for (const each of path.nodes) liveNodes.add(each);
      if (graph.parts.get(edge.part)?.primitives.every((bound) => bound.spec.kind === 'source')) looped.set(edge.part, edge.a === edge.b || closing.length > 0);
    } else {
      powered.set(edge.id, closing.some((path) => path.source));
    }
  });
  return { nodes: node, sources, nets: node.map((each) => liveNodes.has(each)), powered, looped };
};

/** Parts with one primitive, which makes a use (an LED, a DC motor, a buzzer, a servo motor), and its power need. */
const singleUses = (graph: SimGraph) =>
  [...graph.parts.values()].flatMap((part) => {
    const [only, ...rest] = part.primitives;
    const need = part.record.needs.find((each) => each.kind === 'power');
    return only?.use !== undefined && rest.length === 0 && need ? [{ part: part.id, at: `${part.id}/${only.spec.id}`, need: need.id }] : [];
  });

describe('live nets agree with the schema and with brute force', () => {
  it('on 400 random circuits, at rest and at random control states', () => {
    const next = generator(20261001);
    // How often the sample reaches each case it is meant to test, in states.
    const seen = { states: 0, live: 0, joined: 0, output: 0, stopped: 0, shorted: 0, bridged: 0 };
    for (let circuit = 0; circuit < 400; circuit += 1) {
      const blueprint = randomCircuit(next);
      const graph = buildGraph(blueprint, catalogue);
      for (const state of [{}, randomState(graph, next), randomState(graph, next)]) {
        const verdicts = wiredNeeds(blueprint, catalogue, state);
        const oracle = oracleOf(graph, state, verdicts);
        const live = liveAt(graph, state);
        const where = `circuit ${circuit}: ${JSON.stringify({ parts: blueprint.parts.map((part) => [part.id, part.part]), wires: blueprint.wires, state })}`;
        expect(live.nodes, where).toEqual(oracle.nodes);
        expect(live.sources, where).toEqual(oracle.sources);
        expect(live.nets, where).toEqual(oracle.nets);
        const met = (part: string, need: string) => verdicts.find((verdict) => verdict.partId === part && verdict.need === need)?.unmet === undefined;
        let bridged = false;
        for (const use of singleUses(graph)) {
          // The schema's power need, judged on the wiring, is a closed path through the use and a source giving power.
          expect(oracle.powered.get(use.at), `${where} ${use.at}`).toBe(met(use.part, use.need));
          const element = graph.uses.find((each) => `${each.part}/${each.primitive}` === use.at);
          const ends = [live.nets[element?.pos ?? -1], live.nets[element?.neg ?? -1]];
          // Powered means both ends are live; both ends live is not enough (a use bridging two live loops).
          if (met(use.part, use.need)) expect(ends, `${where} ${use.at}`).toEqual([true, true]);
          else if (ends[0] && ends[1] && element?.pos !== element?.neg) bridged = true;
        }
        for (const [part, looped] of oracle.looped) {
          const need = graph.parts.get(part)?.record.needs.find((each) => each.kind === 'loop');
          expect(looped, `${where} ${part}`).toBe(met(part, need?.id ?? ''));
        }
        seen.states += 1;
        if (live.nets.some(Boolean)) seen.live += 1;
        if (live.nodes.some((node, net) => node !== net)) seen.joined += 1;
        if (graph.sources.some((source, index) => source.feeder && live.sources[index])) seen.output += 1;
        const stopped = graph.sources.some((source) => {
          const control = source.control === undefined ? undefined : graph.controls[source.control];
          const need = graph.parts.get(source.part)?.record.needs.find((each) => each.kind === 'power');
          return control !== undefined && need !== undefined && met(source.part, need.id) && (state.channels?.[control.id] ?? control.rest) === 0;
        });
        if (stopped) seen.stopped += 1;
        if (graph.sources.some((source, index) => live.sources[index] && live.nodes[source.pos] === live.nodes[source.neg])) seen.shorted += 1;
        if (bridged) seen.bridged += 1;
      }
    }
    expect(seen.states).toBe(1200);
    expect(seen.live).toBeGreaterThan(600);
    expect(seen.joined).toBeGreaterThan(100);
    expect(seen.output).toBeGreaterThan(100);
    expect(seen.stopped).toBeGreaterThan(10);
    expect(seen.shorted).toBeGreaterThan(50);
    expect(seen.bridged).toBeGreaterThan(5);
  });
});

describe('the live table', () => {
  const tabled = validBlueprints.map((entry) => [entry.name, buildGraph(entry.data as Blueprint, catalogue)] as const);

  it.each(tabled)('%s: looks each state up under the key it would work out', (_, graph) => {
    expect(graph.liveTable).toHaveLength(2 ** graph.controls.length);
    const worked = { ...graph, liveTable: undefined };
    const odd = graph.controls.flatMap((control): ControlState[] =>
      control.kind === 'switch'
        ? [{ switches: { [control.id]: 1 as unknown as boolean } }, { switches: { [control.id]: false } }]
        : [{ channels: { [control.id]: Number.NaN } }, { channels: { [control.id]: -0 } }, { channels: { [control.id]: 0.25 } }],
    );
    const every = Array.from({ length: 2 ** graph.controls.length }, (_, key): ControlState => {
      const switches: Record<string, boolean> = {};
      const channels: Record<string, number> = {};
      graph.controls.forEach((control, index) => {
        const on = (key & (1 << index)) !== 0;
        if (control.kind === 'switch') switches[control.id] = on;
        else channels[control.id] = on ? -1 : 0;
      });
      return { switches, channels };
    });
    for (const state of [{}, { switches: { 'no-such/control': false } }, ...odd, ...every]) expect(liveAt(graph, state)).toEqual(liveAt(worked, state));
  });

  it('hands out frozen answers, so no reader can change one for every later tick', () => {
    const graph = buildGraph(validBlueprints.find((entry) => entry.name === 'rolling-start')?.data as Blueprint, catalogue);
    for (const answers of [graph, { ...graph, liveTable: undefined }]) {
      const live = liveAt(answers);
      expect(Object.isFrozen(live) && Object.isFrozen(live.nodes) && Object.isFrozen(live.sources) && Object.isFrozen(live.nets)).toBe(true);
      expect(() => {
        (live.nets as boolean[])[0] = false;
      }).toThrow(TypeError);
      expect(liveAt(answers).nets).toEqual([true, true, true]);
    }
    expect(Object.isFrozen(graph.liveTable)).toBe(true);
  });

  it('is left out above LIVE_TABLE_CONTROLS controls, and liveAt works the state out instead', () => {
    const count = LIVE_TABLE_CONTROLS + 1;
    const switches = Array.from({ length: count }, (_, index) => `s${index + 1}`);
    const chain = ['battery.plus', ...switches.flatMap((id) => [`${id}.a`, `${id}.b`]), 'led.plus'];
    const wires = [...Array.from({ length: chain.length / 2 }, (_, index) => [chain[2 * index], chain[2 * index + 1]] as const), ['led.minus', 'battery.minus'] as const];
    const ref = (end: string | undefined): PortRef => {
      const [part = '', port = ''] = (end ?? '').split('.');
      return { part, port };
    };
    const series: Blueprint = {
      ...base,
      parts: [
        { id: 'battery', part: 'battery-pack-2-cell', position: { x: 0, y: 0 }, rotation: 0, settings: {} },
        { id: 'led', part: 'led', position: { x: 80, y: 0 }, rotation: 0, settings: {} },
        ...switches.map((id, index) => ({ id, part: 'switch', position: { x: 160 + index * 80, y: 0 }, rotation: 0, settings: {} })),
      ],
      wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
      meta: { ...base.meta, highWater: { parts: 0, wires: wires.length } },
    };
    const graph = buildGraph(series, catalogue);
    expect(graph.controls).toHaveLength(count);
    expect(graph.liveTable).toBeUndefined();
    expect(liveAt(graph).nets.every(Boolean)).toBe(true);
    const opened = { switches: { 's4/contacts': false } };
    expect(liveAt(graph, opened).nets.some(Boolean)).toBe(false);
    for (const state of [{}, opened]) {
      expect(liveAt(graph, state)).toEqual(oracleLive(graph, state, series));
    }
  });
});

const oracleLive = (graph: SimGraph, state: ControlState, blueprint: Blueprint) => {
  const oracle = oracleOf(graph, state, wiredNeeds(blueprint, catalogue, state));
  return { nodes: oracle.nodes, sources: oracle.sources, nets: oracle.nets };
};

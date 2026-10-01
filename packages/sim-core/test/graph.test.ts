import { describe, expect, it } from 'vitest';
import { makeCatalogue, validateArenaPreset, validatePartRecord } from '@servo/schema';
import type { Blueprint, ControlState, PartRecord, Placement, PortRef, Primitive, ValidationResult } from '@servo/schema';
import { exampleArenas, exampleParts, invalidBlueprints, v0Blueprints, validBlueprints } from '@servo/schema/fixtures';
import { GraphInputError, buildGraph, liveAt } from '../src/graph/index.ts';
import type { SimGraph } from '../src/graph/index.ts';
import * as entry from '../src/index.ts';
import type { LiveState } from '../src/index.ts';
import bumperRobot from '../fixtures/graph/bumper-robot.json' with { type: 'json' };
import ledCircuit from '../fixtures/graph/led-circuit.json' with { type: 'json' };
import lightAndMotor from '../fixtures/graph/light-and-motor.json' with { type: 'json' };
import motorOffPin from '../fixtures/graph/motor-off-pin.json' with { type: 'json' };
import reversedMotor from '../fixtures/graph/reversed-motor.json' with { type: 'json' };
import rollingStart from '../fixtures/graph/rolling-start.json' with { type: 'json' };
import shortCircuit from '../fixtures/graph/short-circuit.json' with { type: 'json' };
import switchAcrossPack from '../fixtures/graph/switch-across-pack.json' with { type: 'json' };

const unwrap = <T>(result: ValidationResult<T>): T => {
  if (!result.ok) throw new Error(`Expected valid data:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const parts: readonly PartRecord[] = exampleParts.map((part) => unwrap(validatePartRecord(part)));
const arenas = exampleArenas.map((arena) => unwrap(validateArenaPreset(arena)));
const catalogue = makeCatalogue({ parts, arenas });

interface BuildRef {
  readonly list: string;
  readonly name: string;
  readonly form?: string;
}

/** The schema fixture an expectation file names. */
const blueprintOf = (ref: BuildRef): Blueprint => {
  const valid = ref.list === 'validBlueprints' ? validBlueprints.find((entry) => entry.name === ref.name)?.data : undefined;
  const migrated = ref.list === 'v0Blueprints' && ref.form === 'migrated' ? v0Blueprints.find((entry) => entry.name === ref.name)?.migrated : undefined;
  const found = valid ?? migrated;
  if (!found) throw new Error(`No schema fixture ${JSON.stringify(ref)}`);
  return found as Blueprint;
};

/** The eight hand-made expectations, one per fixture build. */
const expectations = [rollingStart, ledCircuit, reversedMotor, shortCircuit, switchAcrossPack, bumperRobot, motorOffPin, lightAndMotor];

const text = (ref: PortRef): string => `${ref.part}.${ref.port}`;
const frame = ({ x, y, z, yaw, mirrored }: Placement) => ({ x, y, z, yaw, mirrored });

/** A control state with each control on or off: a switch closed or open, a channel forward or at stop. */
const stateOf = (graph: SimGraph, on: readonly boolean[]): ControlState => {
  const switches: Record<string, boolean> = {};
  const channels: Record<string, number> = {};
  graph.controls.forEach((control, index) => {
    if (control.kind === 'switch') switches[control.id] = on[index] === true;
    else channels[control.id] = on[index] === true ? 1 : 0;
  });
  return { switches, channels };
};

/** The graph in the expectation files' words: nets named by their first port, elements as `part/primitive`. */
const project = (graph: SimGraph) => {
  const net = (index: number): string => text(graph.nets[index]?.ports[0] as PortRef);
  const at = (element: { readonly part: string; readonly primitive: string }): string => `${element.part}/${element.primitive}`;
  const control = (index: number): string | undefined => graph.controls[index]?.id;
  return {
    nets: graph.nets.map((each) => ({ ports: each.ports.map(text), wires: each.wires })),
    sources: graph.sources.map((source) => ({
      at: at(source),
      pos: net(source.pos),
      neg: net(source.neg),
      ...(source.feeder ? { feeder: { pos: net(source.feeder.pos), neg: net(source.feeder.neg) } } : {}),
      ...(source.control === undefined ? {} : { control: control(source.control) }),
    })),
    switches: graph.switches.map((join) => ({ at: at(join), a: net(join.a), b: net(join.b), control: control(join.control) })),
    uses: graph.uses.map((use) => ({ at: at(use), pos: net(use.pos), neg: net(use.neg) })),
    controls: graph.controls.map(({ id, kind, rest }) => ({ id, kind, rest })),
    live: Array.from({ length: 2 ** graph.controls.length }, (_, key) => {
      const on = graph.controls.map((_, index) => (key & (1 << index)) !== 0);
      const live = liveAt(graph, stateOf(graph, on));
      const nodes = new Map<number, string[]>();
      live.nodes.forEach((node, index) => nodes.set(node, [...(nodes.get(node) ?? []), net(index)]));
      return {
        on: graph.controls.filter((_, index) => on[index]).map((each) => each.id),
        joined: [...nodes.values()].filter((group) => group.length > 1),
        nets: graph.nets.flatMap((_, index) => (live.nets[index] ? [net(index)] : [])),
        sources: graph.sources.flatMap((source, index) => (live.sources[index] ? [at(source)] : [])),
      };
    }),
    signals: graph.signals.map((link) => ({ wire: link.wire, from: text(link.from), to: text(link.to) })),
    drives: graph.drives.map((link) => ({ wire: link.wire, from: text(link.from), to: text(link.to), carried: link.carried ? frame(link.carried) : null })),
    mounts: graph.mounts.map((link) => ({ wire: link.wire, part: link.part, mount: link.mount, on: `${link.host}.${link.point}`, local: frame(link.local) })),
    placements: Object.fromEntries(
      [...graph.parts.values()].map(({ id, placement }) => [
        id,
        { by: placement.by, root: placement.root, ...(placement.parent === undefined ? {} : { parent: placement.parent }), ...frame(placement.placement) },
      ]),
    ),
    root: graph.root ?? null,
    pushes: graph.pushes.map(({ wheel, actuator, root, push }) => ({ wheel, actuator, root, push })),
  };
};

type Placed = readonly [id: string, type: string];

/** A small build on the workbench: parts as [id, type], power wires as ['part.port', 'part.port']. */
const workbench = (placed: readonly Placed[], wires: readonly (readonly [string, string])[]): Blueprint => {
  const base = blueprintOf({ list: 'validBlueprints', name: 'led-circuit' });
  const ref = (end: string): PortRef => {
    const [part = '', port = ''] = end.split('.');
    return { part, port };
  };
  return {
    ...base,
    parts: placed.map(([id, type], index) => ({ id, part: type, position: { x: index * 80, y: 0 }, rotation: 0, settings: {} })),
    wires: wires.map(([from, to], index) => ({ id: `w${index + 1}`, from: ref(from), to: ref(to) })),
    meta: { ...base.meta, level: 2, highWater: { parts: 0, wires: wires.length } },
  };
};

/** The error buildGraph throws, or a failure when it does not throw one. */
const refusal = (build: () => unknown): GraphInputError => {
  try {
    build();
  } catch (error) {
    if (error instanceof GraphInputError) return error;
    throw error;
  }
  throw new Error('Expected a GraphInputError.');
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
};

describe('the package entry', () => {
  it('leaves the graph out: it is internal to sim-core', () => {
    for (const name of ['buildGraph', 'liveAt', 'GraphInputError', 'LIVE_TABLE_CONTROLS']) expect(name in entry).toBe(false);
    // Compiles only while LiveState from the entry is the interface's: one part's live values, with its faults.
    const partState: LiveState = { values: {}, sounds: [], faults: ['no-circuit'] };
    expect(partState.faults).toEqual(['no-circuit']);
  });
});

describe('the eight fixture builds', () => {
  it('has one hand-made expectation for every valid blueprint, and one for the migrated light-and-motor', () => {
    expect(expectations.map((expected) => expected.build.name).sort()).toEqual([...validBlueprints.map((entry) => entry.name), 'light-and-motor'].sort());
  });

  it.each(expectations.map((expected) => [expected.build.name, expected] as const))(
    '%s: nets, live nets, links, mounts and placements match the expectation',
    (_, expected) => {
      const { build, ...rest } = expected;
      expect(project(buildGraph(blueprintOf(build), catalogue))).toEqual(rest);
    },
  );

  it.each(['reversed-motor', 'short-circuit', 'switch-across-pack', 'bumper-robot', 'motor-off-pin'])('%s is legal but wrong, and builds without error', (name) => {
    expect(() => buildGraph(blueprintOf({ list: 'validBlueprints', name }), catalogue)).not.toThrow();
  });
});

describe('each part bound to the graph', () => {
  const graphs = expectations.map((expected) => [expected.build.name, buildGraph(blueprintOf(expected.build), catalogue)] as const);

  it.each(graphs)('%s: every power port sits in exactly one net, and its port names that net', (_, graph) => {
    const seen = new Map<string, number>();
    graph.nets.forEach((net, index) => {
      for (const ref of net.ports) {
        expect(seen.has(text(ref))).toBe(false);
        seen.set(text(ref), index);
        expect(graph.parts.get(ref.part)?.ports.get(ref.port)?.net).toBe(index);
      }
    });
    for (const part of graph.parts.values()) {
      for (const [port, bound] of part.ports) {
        expect(bound.spec.id).toBe(port);
        if (bound.spec.type === 'power') expect(seen.get(`${part.id}.${port}`)).toBe(bound.net);
        else expect(bound.net).toBeUndefined();
      }
    }
  });

  it.each(graphs)('%s: every power line keeps its ends as stored, inside its net', (_, graph) => {
    const power = (ref: PortRef): boolean => graph.parts.get(ref.part)?.ports.get(ref.port)?.spec.type === 'power';
    const stored = graph.blueprint.wires
      .filter((wire) => power(wire.from) && power(wire.to))
      .map((wire) => ({ wire: wire.id, from: text(wire.from), to: text(wire.to) }))
      .sort((p, q) => (p.wire < q.wire ? -1 : p.wire > q.wire ? 1 : 0));
    expect(graph.powerLines.map((line) => ({ wire: line.wire, from: text(line.from), to: text(line.to) }))).toEqual(stored);
    for (const line of graph.powerLines) {
      expect(graph.nets[line.net]?.ports.map(text)).toEqual(expect.arrayContaining([text(line.from), text(line.to)]));
      expect(graph.nets[line.net]?.wires).toContain(line.wire);
    }
    expect(graph.nets.flatMap((net) => net.wires).sort()).toEqual(graph.powerLines.map((line) => line.wire).sort());
  });

  it.each(graphs)('%s: every signal line, drive linkage and mount shows on the ports at both ends', (_, graph) => {
    const joined = (ref: PortRef): string[] => (graph.parts.get(ref.part)?.ports.get(ref.port)?.joined ?? []).map(text);
    let links = 0;
    for (const link of [...graph.signals, ...graph.drives]) {
      expect(joined(link.from)).toContain(text(link.to));
      expect(joined(link.to)).toContain(text(link.from));
      links += 2;
    }
    for (const link of graph.mounts) {
      expect(joined({ part: link.part, port: link.mount })).toContain(`${link.host}.${link.point}`);
      expect(joined({ part: link.host, port: link.point })).toContain(`${link.part}.${link.mount}`);
      links += 2;
    }
    const ends = [...graph.parts.values()].flatMap((part) => [...part.ports.values()].flatMap((bound) => bound.joined));
    expect(ends).toHaveLength(links);
  });

  it.each(graphs)('%s: every power element belongs to the primitive that made it', (_, graph) => {
    const primitiveOf = (element: { readonly part: string; readonly primitive: string }) =>
      graph.parts.get(element.part)?.primitives.find((bound) => bound.spec.id === element.primitive);
    graph.sources.forEach((source, index) => expect(primitiveOf(source)?.source).toBe(index));
    graph.switches.forEach((join, index) => expect(primitiveOf(join)?.switch).toBe(index));
    graph.uses.forEach((use, index) => expect(primitiveOf(use)?.use).toBe(index));
    for (const part of graph.parts.values()) {
      expect(part.primitives.map((bound) => bound.spec)).toEqual(part.record.behaviour);
      for (const bound of part.primitives) {
        if (bound.source !== undefined) expect(graph.sources[bound.source]?.spec).toBe(bound.spec);
        if (bound.use !== undefined) expect(graph.uses[bound.use]?.spec).toBe(bound.spec);
        if (bound.switch !== undefined) expect(graph.switches[bound.switch]?.spec).toBe(bound.spec);
      }
    }
  });

  it.each(graphs)('%s: a held part hangs from its parent by its mount or drive linkage', (_, graph) => {
    for (const part of graph.parts.values()) {
      const { by, parent, local } = part.placement;
      if (by === 'mount') {
        const link = graph.mounts.find((mount) => mount.part === part.id && mount.host === parent);
        expect(link?.local).toEqual(local);
      } else if (by === 'carried') {
        const link = graph.drives.find((drive) => drive.to.part === part.id && drive.from.part === parent);
        expect(link?.carried).toEqual(local);
      } else {
        expect(parent).toBeUndefined();
      }
    }
  });

  it.each(graphs)('%s: every port a primitive names resolves through its part’s ports', (_, graph) => {
    const named = (spec: Primitive): string[] => {
      switch (spec.kind) {
        case 'source':
          return [spec.output.pos, spec.output.neg];
        case 'switch':
          return [...spec.terminals];
        case 'load':
          return [spec.supply.pos, spec.supply.neg];
        case 'actuator':
          return [spec.supply.pos, spec.supply.neg, spec.drive, ...(spec.mode === 'position' ? [spec.command] : [])];
        case 'driver':
          return [spec.supply.pos, spec.supply.neg, spec.output.pos, spec.output.neg, ...(spec.signal === undefined ? [] : [spec.signal])];
        case 'regulator':
          return [spec.supply.pos, spec.supply.neg, spec.output.pos, spec.output.neg];
        case 'program':
          return [spec.supply.pos, spec.supply.neg, ...spec.inputs, ...spec.outputs];
        case 'ratio':
          return [spec.input, spec.output, spec.mount];
        case 'wheel':
          return [spec.hub];
        case 'support':
          return [spec.mount];
      }
    };
    for (const part of graph.parts.values()) {
      for (const bound of part.primitives) for (const port of named(bound.spec)) expect(part.ports.get(port)?.spec.id).toBe(port);
    }
  });

  it('resolves what turns each wheel and what drives each servo motor', () => {
    const graphOf = (name: string): SimGraph => buildGraph(blueprintOf({ list: 'validBlueprints', name }), catalogue);
    const joined = (graph: SimGraph, part: string, port: string): string[] => (graph.parts.get(part)?.ports.get(port)?.joined ?? []).map(text);
    expect(joined(graphOf('rolling-start'), 'wheel-left', 'hub')).toEqual(['motor-left.shaft']);
    const robot = graphOf('bumper-robot');
    expect(joined(robot, 'wheel-right', 'hub')).toEqual(['gear-right.output']);
    expect(joined(robot, 'gear-right', 'input')).toEqual(['motor-right.shaft']);
    expect(joined(robot, 'gear-right', 'mount')).toEqual(['chassis.gear-right']);
    expect(joined(robot, 'chassis', 'gear-right')).toEqual(['gear-right.mount']);
    // The servo motor with power and no signal: its command port is joined to nothing.
    expect(joined(robot, 'servo', 'signal')).toEqual([]);
    expect(joined(graphOf('motor-off-pin'), 'servo', 'signal')).toEqual(['brain.out-1']);
    expect(joined(graphOf('motor-off-pin'), 'brain', 'out-1')).toEqual(['servo.signal']);
  });

  it('keeps the blueprint entry, its settings included, and the record on each part', () => {
    const blueprint = blueprintOf({ list: 'v0Blueprints', name: 'light-and-motor', form: 'migrated' });
    const graph = buildGraph(blueprint, catalogue);
    expect(graph.parts.get('p5')?.placed.settings).toEqual({ direction: 'backward' });
    expect(graph.parts.get('p4')?.placed).toBe(blueprint.parts.find((placed) => placed.id === 'p4'));
    expect(graph.parts.get('p4')?.record).toBe(catalogue.parts.get('led'));
    expect([...graph.parts.keys()]).toEqual(['p1', 'p2', 'p4', 'p5']);
  });

  it('gives an unwired power port a net of its own, which is never live', () => {
    const graph = buildGraph(
      workbench(
        [
          ['battery', 'battery-pack-2-cell'],
          ['motor', 'dc-motor'],
        ],
        [],
      ),
      catalogue,
    );
    expect(graph.nets.map((net) => net.ports.map(text))).toEqual([['battery.minus'], ['battery.plus'], ['motor.minus'], ['motor.plus']]);
    expect(graph.nets.every((net) => net.wires.length === 0)).toBe(true);
    expect(liveAt(graph).nets).toEqual([false, false, false, false]);
  });
});

describe('schema-invalid input', () => {
  it.each(invalidBlueprints.map((fixture) => [fixture.name, fixture] as const))('refuses %s with its named reason', (_, fixture) => {
    const error = refusal(() => buildGraph(fixture.data as Blueprint, catalogue));
    expect(error.subject).toBe('The blueprint');
    expect(error.issues.map((issue) => `${issue.code} at ${issue.path}`)).toEqual([`${fixture.expect.code} at ${fixture.expect.path}`]);
    expect(error.message).toContain(`${fixture.expect.code} at ${fixture.expect.path}`);
    expect(error.name).toBe('GraphInputError');
  });

  it('refuses something that is not a blueprint at all', () => {
    expect(refusal(() => buildGraph(undefined as unknown as Blueprint, catalogue)).issues.map((issue) => issue.code)).toEqual(['value.wrong_type']);
    expect(refusal(() => buildGraph({} as Blueprint, catalogue)).issues.map((issue) => issue.code)).toContain('value.missing');
  });

  it('refuses a broken part record in the catalogue by name, before judging the blueprint', () => {
    const led = copy(catalogue.parts.get('led')) as unknown as { behaviour: { supply: { pos: string } }[] };
    const light = led.behaviour[0];
    if (light) light.supply.pos = 'long-leg';
    const broken = makeCatalogue({ parts: [led as unknown as PartRecord, ...parts], arenas });
    const error = refusal(() => buildGraph(blueprintOf({ list: 'validBlueprints', name: 'led-circuit' }), broken));
    expect(error.subject).toBe("The part record 'led'");
    expect(error.issues.map((issue) => `${issue.code} at ${issue.path}`)).toContain('ref.unknown_port at $.behaviour[0].supply.pos');
  });
});

describe('determinism (ground rule 2)', () => {
  const withoutBlueprint = (graph: SimGraph) => {
    const { blueprint, ...rest } = graph;
    expect(blueprint).toBeDefined();
    return rest;
  };

  it.each(expectations.map((expected) => [expected.build.name, expected.build] as const))('%s: builds the same graph whatever the order of parts and wires', (_, build) => {
    const blueprint = blueprintOf(build);
    const reversed: Blueprint = { ...blueprint, parts: [...blueprint.parts].reverse(), wires: [...blueprint.wires].reverse() };
    expect(withoutBlueprint(buildGraph(reversed, catalogue))).toEqual(withoutBlueprint(buildGraph(blueprint, catalogue)));
    expect(buildGraph(blueprint, catalogue)).toEqual(buildGraph(blueprint, catalogue));
  });

  it('builds from frozen input without changing it', () => {
    const blueprint = deepFreeze(copy(blueprintOf({ list: 'validBlueprints', name: 'bumper-robot' })));
    const frozen = makeCatalogue({ parts: parts.map((record) => deepFreeze(copy(record))), arenas });
    const before = JSON.stringify(blueprint);
    expect(project(buildGraph(blueprint, frozen))).toEqual(project(buildGraph(blueprintOf({ list: 'validBlueprints', name: 'bumper-robot' }), catalogue)));
    expect(JSON.stringify(blueprint)).toBe(before);
  });
});

import type {
  ActuatorPrimitive,
  ControlState,
  DriverPrimitive,
  LoadPrimitive,
  PlacedPartId,
  ProgramPrimitive,
  RegulatorPrimitive,
  SourcePrimitive,
  WiredVerdict,
  WireId,
} from '@servo/schema';
import type { LiveNets, SimGraph } from '../graph/index.ts';
import type { Wiring } from '../graph/live.ts';
import { speedActuatorModel, speedSettings } from './primitives.ts';
import type { SpeedActuatorModel } from './primitives.ts';
import type { ElectricalModel } from './types.ts';

/** Code-unit order, as the schema sorts ids. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const at = (list: ArrayLike<number>, index: number): number => list[index] as number;

/** A battery, or a driver channel's or regulator's output, with its ports as power-port numbers. */
export interface SourceInfo {
  readonly part: PlacedPartId;
  readonly kind: 'battery' | 'channel' | 'regulator';
  readonly spec: SourcePrimitive | DriverPrimitive | RegulatorPrimitive;
  readonly pos: number;
  readonly neg: number;
  /** An output's supply, or −1 for a battery. */
  readonly feederPos: number;
  readonly feederNeg: number;
  /** A driver channel's control, or −1. */
  readonly control: number;
  /** The use on an output's supply, or −1. */
  readonly use: number;
}

/** A use with its supply ports as power-port numbers. */
export interface UseInfo {
  readonly part: PlacedPartId;
  readonly spec: LoadPrimitive | ActuatorPrimitive | ProgramPrimitive | DriverPrimitive | RegulatorPrimitive;
  readonly pos: number;
  readonly neg: number;
  /** A speed actuator's model, with its throttle and reverse flag from the part's settings. */
  readonly motor?: SpeedActuatorModel & { readonly throttle: number; readonly reverse: boolean };
  /** The output a driver's or regulator's supply feeds, or −1. */
  readonly source: number;
}

export interface SwitchInfo {
  readonly part: PlacedPartId;
  readonly a: number;
  readonly b: number;
  readonly control: number;
}

export interface WireInfo {
  readonly id: WireId;
  readonly from: number;
  readonly to: number;
}

/**
 * The circuit at one setting of the controls: which nets closed switches join (`live.nodes`, a node is named
 * by its lowest net), which sources give power by the wiring, and how the solver numbers its unknowns. The
 * wiring is the graph's own, or a healed copy with a short circuit's wires taken away.
 */
export interface Situation {
  readonly key: string;
  readonly state: ControlState;
  /** Per control: a switch 1 closed or 0 open; a channel's command. */
  readonly command: readonly number[];
  /** Per control, as the wiring reads it: a switch closed, a channel not at stop. */
  readonly on: readonly boolean[];
  readonly wiring: Wiring;
  /** Power port → net of `wiring`. */
  readonly netOfPort: Int32Array;
  readonly live: LiveNets;
  /** Per net: its unknown's number, or −1 for a circuit's reference node or a net joined to a lower one. */
  readonly unknownOf: Int32Array;
  readonly unknowns: number;
  /** Nets as a part with closed switches of its own sees them (the schema's `nets(part)`), made when asked. */
  readonly views: Map<PlacedPartId, readonly number[]>;
  /** The solver's matrix, reused: only ever read after it is cleared. */
  scratch: Float64Array | undefined;
}

export interface Model extends ElectricalModel {
  readonly portCount: number;
  readonly portIndex: ReadonlyMap<string, number>;
  /** Power port → graph net. */
  readonly portNet: Int32Array;
  readonly sources: readonly SourceInfo[];
  readonly uses: readonly UseInfo[];
  readonly switches: readonly SwitchInfo[];
  /** Power lines, in wire id order. */
  readonly wires: readonly WireInfo[];
  /** Pure caches, keyed by the control key. */
  readonly situations: Map<string, Situation>;
  readonly wired: Map<string, readonly WiredVerdict[]>;
  readonly healed: Map<string, Situation | null>;
}

const keyOf = (part: string, port: string): string => `${part} ${port}`;

/**
 * Builds the solver's model of a graph: every power port numbered (part id order, then the record's port
 * order), each source, use and switch with its ports, and the power lines with their ends. Pure: the same
 * graph gives the same model.
 */
export const buildModel = (graph: SimGraph): Model => {
  const portIndex = new Map<string, number>();
  const nets: number[] = [];
  for (const part of graph.parts.values()) {
    for (const spec of part.record.ports) {
      const bound = part.ports.get(spec.id);
      if (spec.type !== 'power' || bound?.net === undefined) continue;
      portIndex.set(keyOf(part.id, spec.id), nets.length);
      nets.push(bound.net);
    }
  }
  const port = (part: PlacedPartId, id: string): number => {
    const found = portIndex.get(keyOf(part, id));
    // The graph binds every power port a primitive names, so this cannot happen for a valid blueprint.
    if (found === undefined) throw new Error(`No power port ${part}.${id}.`);
    return found;
  };

  const sources: SourceInfo[] = [];
  const uses: UseInfo[] = [];
  const switches: SwitchInfo[] = [];
  for (const part of graph.parts.values()) {
    for (const bound of part.primitives) {
      const spec = bound.spec;
      if (bound.use !== undefined && (spec.kind === 'load' || spec.kind === 'actuator' || spec.kind === 'program' || spec.kind === 'driver' || spec.kind === 'regulator')) {
        const motor = spec.kind === 'actuator' && spec.mode === 'speed' ? { ...speedActuatorModel(spec), ...speedSettings(part, spec) } : undefined;
        uses[bound.use] = {
          part: part.id,
          spec,
          pos: port(part.id, spec.supply.pos),
          neg: port(part.id, spec.supply.neg),
          ...(motor ? { motor } : {}),
          source: bound.source ?? -1,
        };
      }
      if (bound.source !== undefined && (spec.kind === 'source' || spec.kind === 'driver' || spec.kind === 'regulator')) {
        const source = graph.sources[bound.source];
        const feeder = spec.kind === 'source' ? undefined : spec.supply;
        sources[bound.source] = {
          part: part.id,
          kind: spec.kind === 'source' ? 'battery' : spec.kind === 'driver' ? 'channel' : 'regulator',
          spec,
          pos: port(part.id, spec.output.pos),
          neg: port(part.id, spec.output.neg),
          feederPos: feeder ? port(part.id, feeder.pos) : -1,
          feederNeg: feeder ? port(part.id, feeder.neg) : -1,
          control: source?.control ?? -1,
          use: bound.use ?? -1,
        };
      }
      if (bound.switch !== undefined && spec.kind === 'switch') {
        const join = graph.switches[bound.switch];
        switches[bound.switch] = { part: part.id, a: port(part.id, spec.terminals[0]), b: port(part.id, spec.terminals[1]), control: join?.control ?? -1 };
      }
    }
  }

  const wires: WireInfo[] = graph.powerLines.map((line) => ({ id: line.wire, from: port(line.from.part, line.from.port), to: port(line.to.part, line.to.port) }));

  return {
    graph,
    portCount: nets.length,
    portIndex,
    portNet: Int32Array.from(nets),
    sources,
    uses,
    switches,
    wires,
    situations: new Map(),
    wired: new Map(),
    healed: new Map(),
  };
};

export const portOf = (model: Model, part: PlacedPartId, id: string): number => {
  const found = model.portIndex.get(keyOf(part, id));
  if (found === undefined) throw new Error(`No power port ${part}.${id}.`);
  return found;
};

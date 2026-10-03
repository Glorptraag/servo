import type { ArenaPreset, ControlId, EventSubject, FailureModeId, PlacedPartId, WireId } from '@servo/schema';
import { behaviourModel } from '../behaviour/index.ts';
import type { BehaviourModel } from '../behaviour/index.ts';
import { electricalModel } from '../electrical/index.ts';
import type { ElectricalModel } from '../electrical/index.ts';
import type { SimGraph } from '../graph/index.ts';
import type { ProgramRuntime } from '../interface.ts';
import { mechanicalModel } from '../mechanical/index.ts';
import type { MechanicalModel } from '../mechanical/index.ts';
import { programModel } from '../program/index.ts';
import type { ProgramModel } from '../program/index.ts';

/** Who events are about: a placed part, or a prop (`arena:<propId>`). */
export interface Subject {
  readonly id: EventSubject;
  /** A placed part's failure modes, in its record's order: the order of its fault events and `LiveState.faults`. Empty for a prop. */
  readonly failures: readonly FailureModeId[];
}

/** A wire that carries something: a power line, a signal line or a drive linkage. Mounts carry nothing. */
export interface FlowWire {
  readonly wire: WireId;
  readonly kind: 'power' | 'signal' | 'drive';
}

/** Everything a Run reads that never changes during it: each solver's model, and the orders its frames keep. */
export interface Models {
  readonly graph: SimGraph;
  readonly electrical: ElectricalModel;
  readonly behaviour: BehaviourModel;
  readonly program: ProgramModel;
  readonly mechanical: MechanicalModel;
  /** Every placed part in id order, then every prop in id order: the order of `frame.live` and of the events within a tick. */
  readonly subjects: readonly Subject[];
  /** Each placed part's manual switches as control ids, in its record's order. Parts with none are left out. */
  readonly manual: ReadonlyMap<PlacedPartId, readonly ControlId[]>;
  /** Where each manual switch starts: closed when its record says `initially: closed`. */
  readonly manualRest: Readonly<Record<ControlId, boolean>>;
  /** Power lines, signal lines and drive linkages, in wire id order: the order of `frame.flows`. */
  readonly wires: readonly FlowWire[];
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every solver's model of one Run, built once as it starts from the graph of the canonical blueprint and the arena
 * preset. Pure: the physics engine is needed only when the mechanical state is made.
 */
export const buildModels = (graph: SimGraph, arena: ArenaPreset, program: ProgramRuntime | undefined): Models => {
  const behaviour = behaviourModel(graph);
  const mechanical = mechanicalModel(behaviour, arena);
  const subjects: Subject[] = [...graph.parts.values()].map((part) => ({ id: part.id, failures: part.record.failureModes.map((mode) => mode.id) }));
  for (const prop of mechanical.arena.props) subjects.push({ id: prop.subject, failures: [] });

  const manual = new Map<PlacedPartId, ControlId[]>();
  const manualRest: Record<ControlId, boolean> = {};
  for (const control of graph.controls) {
    const spec = graph.parts.get(control.part)?.record.behaviour.find((primitive) => primitive.id === control.primitive);
    if (control.kind !== 'switch' || spec?.kind !== 'switch' || spec.actuation.kind !== 'manual') continue;
    manual.set(control.part, [...(manual.get(control.part) ?? []), control.id]);
    manualRest[control.id] = control.rest === true;
  }

  const wires: FlowWire[] = [
    ...graph.powerLines.map((line): FlowWire => ({ wire: line.wire, kind: 'power' })),
    ...graph.signals.map((link): FlowWire => ({ wire: link.wire, kind: 'signal' })),
    ...graph.drives.map((link): FlowWire => ({ wire: link.wire, kind: 'drive' })),
  ].sort((p, q) => compareText(p.wire, q.wire));

  return {
    graph,
    electrical: electricalModel(graph),
    behaviour,
    program: programModel(graph, program),
    mechanical,
    subjects,
    manual,
    manualRest,
    wires,
  };
};

// The Level 3 slot's one rule (task 6.6), worked out from the build and the part records alone (ground rule 1): no
// part is named here. Each brain (a placed part with a `program` primitive) drives each of its outputs wired to a
// position actuator's command (a servo motor's signal in) at the level that turns the actuator to its target setting
// (the servo motor's angle). sim-core turns a position actuator commanded at level l to minDeg + l × (maxDeg − minDeg)
// (packages/sim-core/docs/behaviour.md), so the level is the inverse of that. Pure, so it runs in Node tests.
import { mapSettingValue } from '@servo/schema';
import type {
  Blueprint,
  Catalogue,
  NumberSetting,
  PartRecord,
  PlacedPart,
  PlacedPartId,
  PortId,
  PositionActuator,
  PrimitiveId,
  Wire,
} from '@servo/schema';
import { settingValue } from '../spec-card/model.ts';

/** "Always set `output` to `level`": the setting on the part the output reaches gives the level. */
export interface AngleRule {
  /** The brain's output. */
  readonly output: PortId;
  /** 0–1, the level the output carries every tick the brain is on. */
  readonly level: number;
  /** The part the output's signal line reaches, and its signal in. */
  readonly part: PlacedPartId;
  readonly port: PortId;
  /** The setting the level comes from, and its value on that part (the setting's own unit). */
  readonly setting: NumberSetting;
  readonly value: number;
}

/** One brain's program: its rules in the primitive's output order. */
export interface BrainProgram {
  readonly partId: PlacedPartId;
  readonly primitive: PrimitiveId;
  readonly rules: readonly AngleRule[];
}

const byId = <T extends { readonly id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The other end of a signal line from a brain's output, whichever way the wire is written. */
const reachedBy = (wire: Wire, partId: PlacedPartId, output: PortId): Wire['to'] | undefined => {
  if (wire.from.part === partId && wire.from.port === output) return wire.to;
  if (wire.to.part === partId && wire.to.port === output) return wire.from;
  return undefined;
};

const clamp = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);

/** The rule for an output reaching `port` on `placed`, when that port commands a position actuator with a target setting. */
const ruleFor = (output: PortId, placed: PlacedPart, record: PartRecord, port: PortId): AngleRule | undefined => {
  for (const primitive of record.behaviour) {
    if (primitive.kind !== 'actuator' || primitive.mode !== 'position' || primitive.command !== port) continue;
    const actuator: PositionActuator = primitive;
    const setting = record.settings.find(
      (each): each is NumberSetting => each.kind === 'number' && each.binds.primitive === actuator.id && each.binds.param === 'target',
    );
    if (!setting) continue;
    const value = settingValue(setting, placed);
    if (typeof value !== 'number') continue;
    const span = actuator.maxDeg - actuator.minDeg;
    const target = clamp(mapSettingValue(setting, value), actuator.minDeg, actuator.maxDeg);
    const level = span > 0 ? clamp((target - actuator.minDeg) / span, 0, 1) : 0;
    return { output, level, part: placed.id, port, setting, value };
  }
  return undefined;
};

/**
 * Every brain in the build, in part id order then the record's primitive order, with its rules. An output carries
 * one level, so when it reaches several parts the first signal line in wire id order that gives a rule decides it.
 */
export const programsOf = (blueprint: Blueprint, catalogue: Catalogue): readonly BrainProgram[] => {
  const placedById = new Map(blueprint.parts.map((placed) => [placed.id, placed]));
  const wires = [...blueprint.wires].sort(byId);
  const programs: BrainProgram[] = [];
  for (const placed of [...blueprint.parts].sort(byId)) {
    const record = catalogue.parts.get(placed.part);
    if (!record) continue;
    for (const primitive of record.behaviour) {
      if (primitive.kind !== 'program') continue;
      const rules: AngleRule[] = [];
      for (const output of primitive.outputs) {
        for (const wire of wires) {
          const end = reachedBy(wire, placed.id, output);
          const other = end && placedById.get(end.part);
          const otherRecord = other && catalogue.parts.get(other.part);
          const rule = end && other && otherRecord ? ruleFor(output, other, otherRecord, end.port) : undefined;
          if (rule) {
            rules.push(rule);
            break;
          }
        }
      }
      programs.push({ partId: placed.id, primitive: primitive.id, rules });
    }
  }
  return programs;
};

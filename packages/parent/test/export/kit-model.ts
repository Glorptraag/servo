// Two models of which way each motor turns, for the parts-list tests (task 5.3, D27):
// - `appTurning` reads the blueprint as the app runs it: a mirrored mount turns a motor round and flips its turning
//   sense, so the two cancel (D23), and settings apply.
// - `realTurning` walks the printed connection lines in order, as an adult would, on a real kit: no part is a mirror
//   image, so a motor on a mirrored mount turns the other way for the same wiring, and nothing has a setting.
// Both close every switch, so the motors run. +1 is forward, −1 backward, 0 still or not wired.
import type { Blueprint, Catalogue, ChoiceSetting, PartRecord, PlacedPart, PortId } from '@servo/schema';
import type { PartsList } from '../../src/index.ts';
import { LIST_TEXT } from '../../src/index.ts';

interface Source {
  readonly pos: string;
  readonly neg: string;
  readonly sign: number;
}

/** Potentials of each joined set of ports: a source's + side at `sign`, its − side at `-sign`. */
const potentials = (joins: readonly (readonly [string, string])[], sources: readonly Source[]) => {
  const parent = new Map<string, string>();
  const root = (node: string): string => {
    let top = node;
    while (parent.has(top)) top = parent.get(top) as string;
    return top;
  };
  for (const [a, b] of joins) {
    const [x, y] = [root(a), root(b)];
    if (x !== y) parent.set(x, y);
  }
  const level = new Map<string, number>();
  for (const { pos, neg, sign } of sources) {
    level.set(root(pos), sign);
    level.set(root(neg), -sign);
  }
  return (node: string): number | undefined => level.get(root(node));
};

const polarity = (at: (node: string) => number | undefined, pos: string, neg: string): number => {
  const [p, n] = [at(pos), at(neg)];
  return p === undefined || n === undefined ? 0 : Math.sign(p - n);
};

const choice = (placed: PlacedPart, record: PartRecord, primitive: string, param: string) => {
  const setting = record.settings.find((s): s is ChoiceSetting => s.kind === 'choice' && s.binds.primitive === primitive && s.binds.param === param);
  if (!setting) return undefined;
  const chosen = placed.settings[setting.id] ?? setting.default;
  return setting.options.find((option) => option.id === chosen)?.value;
};

/** How the list names a placed part, by the README's rule: mount point if unique among its type, else a number in id order. */
const printedNames = (blueprint: Blueprint, catalogue: Catalogue): Map<string, string> => {
  const mountedAt = new Map<string, string>();
  for (const wire of blueprint.wires) {
    const [from, to] = [wire.from, wire.to];
    const frame = blueprint.parts.find((placed) => placed.id === to.part);
    const point = frame && catalogue.parts.get(frame.part)?.ports.find((port) => port.id === to.port);
    if (point?.type === 'mechanical' && point.role === 'mount-point') mountedAt.set(from.part, point.label);
  }
  const names = new Map<string, string>();
  const ordered = [...blueprint.parts].sort((x, y) => (x.id < y.id ? -1 : 1));
  for (const type of new Set(ordered.map((placed) => placed.part))) {
    const instances = ordered.filter((placed) => placed.part === type);
    const name = catalogue.parts.get(type)?.identity.name ?? type;
    let number = 0;
    for (const placed of instances) {
      const label = mountedAt.get(placed.id);
      const unique = label !== undefined && instances.filter((other) => mountedAt.get(other.id) === label).length === 1;
      names.set(placed.id, instances.length === 1 ? name : unique ? `${name} (${label})` : `${name} ${(number += 1)}`);
    }
  }
  return names;
};

/** Which way each DC-motor-like part turns in the app, keyed by the name the list gives it. */
export const appTurning = (blueprint: Blueprint, catalogue: Catalogue): Map<string, number> => {
  const record = (placed: PlacedPart): PartRecord => catalogue.parts.get(placed.part) as PartRecord;
  const node = (part: string, port: PortId) => `${part}/${port}`;
  const typeOf = (part: string, port: PortId) => {
    const placed = blueprint.parts.find((candidate) => candidate.id === part);
    return placed ? record(placed).ports.find((candidate) => candidate.id === port)?.type : undefined;
  };
  const signalled = new Set(
    blueprint.wires.filter((wire) => typeOf(wire.from.part, wire.from.port) === 'signal').flatMap((wire) => [node(wire.from.part, wire.from.port), node(wire.to.part, wire.to.port)]),
  );
  const joins: [string, string][] = blueprint.wires
    .filter((wire) => typeOf(wire.from.part, wire.from.port) === 'power')
    .map((wire) => [node(wire.from.part, wire.from.port), node(wire.to.part, wire.to.port)]);
  const sources: Source[] = [];
  for (const placed of blueprint.parts) {
    for (const primitive of record(placed).behaviour) {
      if (primitive.kind === 'switch') joins.push([node(placed.id, primitive.terminals[0]), node(placed.id, primitive.terminals[1])]);
      if (primitive.kind === 'source') sources.push({ pos: node(placed.id, primitive.output.pos), neg: node(placed.id, primitive.output.neg), sign: 1 });
      if (primitive.kind === 'driver') {
        const bySignal = primitive.signal !== undefined && signalled.has(node(placed.id, primitive.signal));
        const value = choice(placed, record(placed), primitive.id, 'command');
        const command = bySignal ? 1 : typeof value === 'number' ? value : primitive.command;
        sources.push({ pos: node(placed.id, primitive.output.pos), neg: node(placed.id, primitive.output.neg), sign: command });
      }
    }
  }
  const at = potentials(joins, sources);
  const names = printedNames(blueprint, catalogue);
  const turning = new Map<string, number>();
  for (const placed of blueprint.parts) {
    for (const primitive of record(placed).behaviour) {
      if (primitive.kind !== 'actuator' || primitive.mode !== 'speed' || primitive.whenReversed !== 'reverses') continue;
      const backward = choice(placed, record(placed), primitive.id, 'reverse') === true;
      const sense = polarity(at, node(placed.id, primitive.supply.pos), node(placed.id, primitive.supply.neg)) * (backward ? -1 : 1);
      turning.set(names.get(placed.id) ?? placed.id, sense === 0 ? 0 : sense);
    }
  }
  return turning;
};

/** A printed part name back to its record: the real name, then nothing, `(mount point)` or a number. */
const recordNamed = (catalogue: Catalogue, printed: string): PartRecord => {
  const found = [...catalogue.parts.values()].find((record) => {
    const name = record.identity.name;
    return printed === name || (printed.startsWith(`${name} `) && /^( \(.+\)| \d+)$/u.test(printed.slice(name.length)));
  });
  if (!found) throw new Error(`No part is called '${printed}'.`);
  return found;
};

/** "DC motor (left motor mount), plus (+)" as the part's printed name and port id. */
const endOf = (catalogue: Catalogue, text: string): { part: string; record: PartRecord; port: PortId } => {
  const comma = text.indexOf(', ');
  const part = text.slice(0, comma);
  const label = text.slice(comma + 2);
  const record = recordNamed(catalogue, part);
  const port = record.ports.find((candidate) => candidate.label === label);
  if (!port) throw new Error(`The ${part} has no port '${label}'.`);
  return { part, record, port: port.id };
};

/**
 * Walks the printed connection lines in order on a real kit and says which way each motor turns. The real-kit notes
 * are not steps: a note that asked for something to be done would make this walk wrong, and the tests check there is none.
 */
export const realTurning = (list: PartsList, catalogue: Catalogue): Map<string, number> => {
  const joins: [string, string][] = [];
  const mirrored = new Map<string, boolean>();
  const parts = new Map<string, PartRecord>();
  for (const printed of list.wiring) {
    const line = printed.endsWith(LIST_TEXT.marked('')) ? printed.slice(0, -LIST_TEXT.marked('').length) : printed;
    const [, kind = '', rest = ''] = /^(.+?) \(\w+\): (.+)$/u.exec(line) ?? [];
    const [left = '', right = ''] = rest.split(' to ');
    if (kind === 'Mount') {
      const frame = endOf(catalogue, right);
      const point = frame.record.ports.find((port) => port.id === frame.port);
      parts.set(left, recordNamed(catalogue, left));
      mirrored.set(left, point?.type === 'mechanical' && point.role === 'mount-point' && point.mirrored);
      continue;
    }
    const [a, b] = [endOf(catalogue, left), endOf(catalogue, right)];
    parts.set(a.part, a.record);
    parts.set(b.part, b.record);
    if (kind === 'Power line') joins.push([`${a.part}/${a.port}`, `${b.part}/${b.port}`]);
  }
  const sources: Source[] = [];
  for (const [part, record] of parts) {
    for (const primitive of record.behaviour) {
      if (primitive.kind === 'switch') joins.push([`${part}/${primitive.terminals[0]}`, `${part}/${primitive.terminals[1]}`]);
      // A real battery pack, and a real motor driver run forward: neither has a setting.
      if (primitive.kind === 'source' || primitive.kind === 'driver') sources.push({ pos: `${part}/${primitive.output.pos}`, neg: `${part}/${primitive.output.neg}`, sign: 1 });
    }
  }
  const at = potentials(joins, sources);
  const turning = new Map<string, number>();
  for (const [part, record] of parts) {
    for (const primitive of record.behaviour) {
      if (primitive.kind !== 'actuator' || primitive.mode !== 'speed' || primitive.whenReversed !== 'reverses') continue;
      // A real motor cannot be a mirror image: on a mirrored mount it is turned round, so it turns the other way.
      const sense = polarity(at, `${part}/${primitive.supply.pos}`, `${part}/${primitive.supply.neg}`) * (mirrored.get(part) ? -1 : 1);
      turning.set(part, sense === 0 ? 0 : sense);
    }
  }
  return turning;
};

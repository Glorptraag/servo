// The wiring commands of the one command layer (ground rule 8): `connect` and `disconnect`, as pure reducers over a
// valid blueprint, beside task 3.2's placement reducers. `applyEdit` (placement/apply.ts) runs them, then checks and
// canonicalises what they give. A wire goes through the schema's `planWire` (by `joinPorts`), so an impossible drop
// comes back with its `wire.*` code and legal-but-wrong wiring is always accepted. See docs/wiring.md.
import { checkPortPair, indexPlacedParts, resolvePort } from '@servo/schema';
import type { Blueprint, Catalogue, PortRef, WireKind } from '@servo/schema';
import { joinPorts, refuse } from '../placement/commands.ts';
import type { Reducer, Reducers } from '../placement/commands.ts';
import { settle } from '../placement/holding.ts';

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;
const isPortRef = (value: unknown): value is PortRef => isObject(value) && typeof value.part === 'string' && typeof value.port === 'string';

/**
 * What a wire between two ports of the build is, by the schema's socket rule: a power line, a signal line, a drive
 * linkage or a mount. Undefined when either port is not on the board or the pair is impossible.
 */
export const wireKindOf = (blueprint: Blueprint, catalogue: Catalogue, a: PortRef, b: PortRef): WireKind | undefined => {
  const parts = indexPlacedParts(blueprint.parts);
  const first = resolvePort(parts, catalogue, a);
  const second = resolvePort(parts, catalogue, b);
  if (!first.found || !second.found) return undefined;
  const pair = checkPortPair(first.spec, second.spec);
  return pair.legal ? pair.kind : undefined;
};

/**
 * Joins two ports, in either order, with the next `w<n>` wire in the orientation `planWire` gives. A drive linkage
 * also moves the part on its drive-in end (a wheel) onto the shaft, where `placeParts` carries it, unless that part
 * is mounted (`settle`). Mounts are made with `mount`, never here.
 */
const connect: Reducer<'connect'> = (blueprint, command, catalogue) => {
  const { from, to } = command;
  if (!isPortRef(from) || !isPortRef(to)) return refuse('value.wrong_type', 'A wire joins two ports, each named by its part and its port.');
  if (wireKindOf(blueprint, catalogue, from, to) === 'mount') {
    return refuse('edit.wrong_command', 'A part is fixed to a mount point with mount, not connect.');
  }
  const joined = joinPorts(blueprint, catalogue, from, to);
  return joined.ok ? { ok: true, blueprint: settle(joined.blueprint, catalogue) } : joined;
};

/** Removes a power line, a signal line or a drive linkage. A part the linkage carried stays where it is, loose. */
const disconnect: Reducer<'disconnect'> = (blueprint, command, catalogue) => {
  const wire = typeof command.wireId === 'string' ? blueprint.wires.find((candidate) => candidate.id === command.wireId) : undefined;
  if (!wire) return refuse('edit.unknown_wire', `No wire has the id '${String(command.wireId)}'.`);
  if (wireKindOf(blueprint, catalogue, wire.from, wire.to) === 'mount') {
    return refuse('edit.wrong_command', 'A mount comes off with unmount, not disconnect.');
  }
  return { ok: true, blueprint: settle({ ...blueprint, wires: blueprint.wires.filter((other) => other !== wire) }, catalogue) };
};

/** The commands task 3.3 builds. */
export const WIRING_REDUCERS: Reducers = { connect, disconnect };

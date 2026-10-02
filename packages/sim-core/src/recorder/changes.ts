import type { Blueprint, BuildChange, FaultSeen, FixedFault, PlacedPart, PlacedPartId, PortRef, RunRecord, Wire } from '@servo/schema';

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const portKey = (ref: PortRef): string => `${ref.part} ${ref.port}`;

/** A wire as the two ports it joins, either way round: two ports take one wire between them (`wire.duplicate`). */
const wireKey = (wire: Wire): string => [portKey(wire.from), portKey(wire.to)].sort(compareText).join('|');

/**
 * The build changes from one blueprint to another, in BuildChange's order: parts added, parts removed, wires added, wires
 * removed, then settings changed. Within each, parts and settings go in id order and wires by their ports. A part is the
 * same part while its id is (ids are never reused); one whose type differs is removed and added. A setting is compared
 * as stored, with a missing one at its default, and one that went back to its default has no `value`. Moving a part
 * changes none of these; mounting it is a mount wire. The arena is left out: no change to it touches a part (D31).
 */
export const buildChanges = (before: Blueprint, after: Blueprint): BuildChange[] => {
  const was = new Map(before.parts.map((part) => [part.id, part]));
  const now = new Map(after.parts.map((part) => [part.id, part]));
  const ids = [...new Set([...was.keys(), ...now.keys()])].sort(compareText);
  const added: BuildChange[] = [];
  const removed: BuildChange[] = [];
  const settings: BuildChange[] = [];
  for (const id of ids) {
    const old: PlacedPart | undefined = was.get(id);
    const part: PlacedPart | undefined = now.get(id);
    if (old && (!part || part.part !== old.part)) removed.push({ kind: 'remove-part', partId: id, part: old.part });
    if (part && (!old || part.part !== old.part)) added.push({ kind: 'add-part', partId: id, part: part.part });
    if (!old || !part || part.part !== old.part) continue;
    for (const setting of [...new Set([...Object.keys(old.settings), ...Object.keys(part.settings)])].sort(compareText)) {
      const value = Object.hasOwn(part.settings, setting) ? part.settings[setting] : undefined;
      const prior = Object.hasOwn(old.settings, setting) ? old.settings[setting] : undefined;
      if (value === prior) continue;
      settings.push({ kind: 'change-setting', partId: id, setting, ...(value === undefined ? {} : { value }) });
    }
  }
  const wiresBefore = new Map(before.wires.map((wire) => [wireKey(wire), wire]));
  const wiresAfter = new Map(after.wires.map((wire) => [wireKey(wire), wire]));
  const byKey = ([p]: readonly [string, Wire], [q]: readonly [string, Wire]): number => compareText(p, q);
  const wiresAdded = [...wiresAfter].filter(([key]) => !wiresBefore.has(key)).sort(byKey);
  const wiresRemoved = [...wiresBefore].filter(([key]) => !wiresAfter.has(key)).sort(byKey);
  const ends = (wire: Wire): { readonly from: PortRef; readonly to: PortRef } => ({
    from: { part: wire.from.part, port: wire.from.port },
    to: { part: wire.to.part, port: wire.to.port },
  });
  return [
    ...added,
    ...removed,
    ...wiresAdded.map(([, wire]): BuildChange => ({ kind: 'add-wire', ...ends(wire) })),
    ...wiresRemoved.map(([, wire]): BuildChange => ({ kind: 'remove-wire', ...ends(wire) })),
    ...settings,
  ];
};

/** Whether a change touches a part: the part itself, one of its settings, or a wire on one of its ports. */
const touches = (change: BuildChange, part: PlacedPartId): boolean => {
  switch (change.kind) {
    case 'add-wire':
    case 'remove-wire':
      return change.from.part === part || change.to.part === part;
    case 'change-arena':
      return false;
    default:
      return change.partId === part;
  }
};

/**
 * `fixed` (D31): each fault of the previous Run that this Run did not show, in the previous record's order, with the
 * build changes between the two blueprints that touch the faulted part, its ports or its wires. A fault that went with no
 * such change (a short the child did not close this time) has no changes.
 */
export const fixedFaults = (previous: RunRecord | undefined, faults: readonly FaultSeen[], blueprint: Blueprint): FixedFault[] => {
  if (!previous) return [];
  const shown = new Set(faults.map((fault) => `${fault.partId} ${fault.failure}`));
  const gone = previous.faults.filter((fault) => !shown.has(`${fault.partId} ${fault.failure}`));
  if (gone.length === 0) return [];
  const changes = buildChanges(previous.blueprint, blueprint);
  return gone.map((fault) => ({ partId: fault.partId, failure: fault.failure, changes: changes.filter((change) => touches(change, fault.partId)) }));
};

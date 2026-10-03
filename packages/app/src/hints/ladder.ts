// The hint ladder's rules (brief Sections 5, 10 and 12; task 4.6), pure: which of a challenge's ladders applies to the
// build on the canvas and the last Run, which part it is about, each step narrowed to that part, and the last step,
// do-it, as one `batch` of the canvas's own EditCommands. Ladders and their lines are content; nothing here names a
// part, a port or a fault (ground rule 1). No DOM, React or clock.
import { applyEdit } from '@servo/canvas';
import type { EditBatch, SingleEdit } from '@servo/canvas';
import type {
  Blueprint,
  Catalogue,
  Challenge,
  FailureModeId,
  HintChange,
  HintLadder,
  HintStep,
  HintTrigger,
  PartTarget,
  PlacedPart,
  PlacedPartId,
  PortRef,
  PortTarget,
} from '@servo/schema';

/** A fault the last Run showed on a part. */
export interface RunFault {
  readonly partId: PlacedPartId;
  readonly failure: FailureModeId;
}

/** The ladder that applies now, and the part its trigger is about, when it names one. */
export interface LadderChoice {
  /** The ladder's place in `challenge.hints`. */
  readonly index: number;
  readonly ladder: HintLadder;
  /** The placed part the trigger found: the one with the fault or the unwired port. A type target narrows to it. */
  readonly part: PlacedPartId | undefined;
  /** Equal for the same ladder about the same part, so the app knows when to start a ladder again. */
  readonly key: string;
}

export const partsMatching = (blueprint: Blueprint, target: PartTarget): readonly PlacedPart[] =>
  blueprint.parts.filter((part) => ('placed' in target ? part.id === target.placed : part.part === target.part));

const samePort = (a: PortRef, b: PortRef): boolean => a.part === b.part && a.port === b.port;

const isWired = (blueprint: Blueprint, ref: PortRef): boolean => blueprint.wires.some((wire) => samePort(wire.from, ref) || samePort(wire.to, ref));

/**
 * The parts a trigger holds for, in the build's order: empty when it holds about no part in particular (a missing
 * part, or no trigger), undefined when it does not hold. A fault holds only on a part still on the canvas.
 */
export const triggerParts = (trigger: HintTrigger | undefined, blueprint: Blueprint, faults: readonly RunFault[]): readonly PlacedPartId[] | undefined => {
  if (!trigger) return [];
  switch (trigger.kind) {
    case 'fault': {
      const parts = partsMatching(blueprint, trigger.target)
        .filter((part) => faults.some((fault) => fault.partId === part.id && fault.failure === trigger.failure))
        .map((part) => part.id);
      return parts.length > 0 ? parts : undefined;
    }
    case 'missing':
      return blueprint.parts.some((part) => part.part === trigger.part) ? undefined : [];
    case 'unwired': {
      const parts = partsMatching(blueprint, trigger)
        .filter((part) => !isWired(blueprint, { part: part.id, port: trigger.port }))
        .map((part) => part.id);
      return parts.length > 0 ? parts : undefined;
    }
  }
};

/** The first ladder whose trigger holds (a ladder without one always does), or none. */
export const chooseLadder = (challenge: Challenge, blueprint: Blueprint, faults: readonly RunFault[]): LadderChoice | undefined => {
  for (const [index, ladder] of challenge.hints.entries()) {
    const parts = triggerParts(ladder.when, blueprint, faults);
    if (!parts) continue;
    const part = parts[0];
    return { index, ladder, part, key: `${index} ${part ?? ''}` };
  }
  return undefined;
};

const narrowPart = (target: PartTarget, blueprint: Blueprint, part: PlacedPartId | undefined): PartTarget => {
  if ('placed' in target || part === undefined) return target;
  return blueprint.parts.find((placed) => placed.id === part)?.part === target.part ? { placed: part } : target;
};

const narrowPort = (target: PortTarget, blueprint: Blueprint, part: PlacedPartId | undefined): PortTarget => {
  const narrowed = narrowPart(target, blueprint, part);
  return 'placed' in narrowed ? { placed: narrowed.placed, port: target.port } : { part: narrowed.part, port: target.port };
};

const narrowChange = (change: HintChange, blueprint: Blueprint, part: PlacedPartId | undefined): HintChange => {
  switch (change.kind) {
    case 'add-wire':
    case 'remove-wire':
      return { ...change, from: narrowPort(change.from, blueprint, part), to: narrowPort(change.to, blueprint, part) };
    case 'add-part':
      return change.mountOn ? { ...change, mountOn: narrowPort(change.mountOn, blueprint, part) } : change;
    case 'remove-part':
    case 'set-setting':
      return { ...change, target: narrowPart(change.target, blueprint, part) };
  }
};

/**
 * A step with every target given by type narrowed to `part` when `part` is of that type (canvas interface: "the app
 * narrows it to `{ placed }` when it knows which part"). Targets of other types stay as they are.
 */
export const narrowStep = (step: HintStep, blueprint: Blueprint, part: PlacedPartId | undefined): HintStep => {
  switch (step.step) {
    case 'pulse-part':
      return { ...step, target: narrowPart(step.target, blueprint, part) };
    case 'pulse-port':
      return { ...step, target: narrowPort(step.target, blueprint, part) };
    case 'ghost-wire':
      return { ...step, from: narrowPort(step.from, blueprint, part), to: narrowPort(step.to, blueprint, part) };
    case 'do-it':
      return { ...step, changes: step.changes.map((change) => narrowChange(change, blueprint, part)) };
  }
};

/** The part a step is about, for the run record's hint use: the ladder's part, else the part the step points at. */
export const partOfStep = (step: HintStep, part: PlacedPartId | undefined): PlacedPartId | undefined => {
  if (part !== undefined) return part;
  switch (step.step) {
    case 'pulse-part':
    case 'pulse-port':
      return 'placed' in step.target ? step.target.placed : undefined;
    case 'ghost-wire':
      return 'placed' in step.to ? step.to.placed : 'placed' in step.from ? step.from.placed : undefined;
    case 'do-it':
      return undefined;
  }
};

const portRefs = (blueprint: Blueprint, target: PortTarget): readonly PortRef[] =>
  partsMatching(blueprint, target).map((part) => ({ part: part.id, port: target.port }));

/** The commands that could make one change, best first. The first the build accepts is the one used. */
const candidates = (change: HintChange, blueprint: Blueprint, catalogue: Catalogue): readonly SingleEdit[] => {
  switch (change.kind) {
    case 'add-wire': {
      const tos = portRefs(blueprint, change.to);
      return portRefs(blueprint, change.from).flatMap((from) =>
        tos.filter((to) => to.part !== from.part).map((to): SingleEdit => ({ kind: 'connect', from, to })),
      );
    }
    case 'remove-wire': {
      const froms = portRefs(blueprint, change.from);
      const tos = portRefs(blueprint, change.to);
      const joins = (a: PortRef, b: PortRef): boolean => froms.some((from) => samePort(from, a)) && tos.some((to) => samePort(to, b));
      return blueprint.wires
        .filter((wire) => joins(wire.from, wire.to) || joins(wire.to, wire.from))
        .flatMap((wire): SingleEdit[] => [
          { kind: 'disconnect', wireId: wire.id },
          // A mount is taken off with `unmount`, from the side of it that is the part's own mount port.
          { kind: 'unmount', partId: wire.from.part, port: wire.from.port },
          { kind: 'unmount', partId: wire.to.part, port: wire.to.port },
        ]);
    }
    case 'add-part': {
      if (!change.mountOn) return [{ kind: 'place-part', part: change.part }];
      const mounts = (catalogue.parts.get(change.part)?.ports ?? []).filter((port) => port.type === 'mechanical' && port.role === 'mount');
      const ontos = portRefs(blueprint, change.mountOn);
      return mounts.flatMap((mount) => ontos.map((onto): SingleEdit => ({ kind: 'place-part', part: change.part, attach: { port: mount.id, onto } })));
    }
    case 'remove-part':
      return partsMatching(blueprint, change.target).map((part): SingleEdit => ({ kind: 'remove-part', partId: part.id }));
    case 'set-setting':
      return partsMatching(blueprint, change.target).map((part): SingleEdit => ({ kind: 'set-setting', partId: part.id, setting: change.setting, value: change.value }));
  }
};

export type DoIt =
  | { readonly ok: true; readonly command: EditBatch; readonly blueprint: Blueprint }
  | { readonly ok: false; readonly change: number; readonly reason: string };

/**
 * Do-it's changes as one `batch` the canvas applies as one Undo step (rule 8), made by the canvas's own pure
 * `applyEdit`, so every wire goes through the schema's wiring rules (rule 3). Each change resolves against the build
 * as the changes before it leave it, so a part do-it places can be wired by its type. A change with no command the
 * build accepts (the wire is already there, the part is gone) makes the whole step unusable: nothing half done.
 */
export const doItCommand = (changes: readonly HintChange[], blueprint: Blueprint, catalogue: Catalogue): DoIt => {
  const commands: SingleEdit[] = [];
  let build = blueprint;
  for (const [index, change] of changes.entries()) {
    let applied = false;
    let reason = 'Nothing on the canvas matches this change.';
    for (const command of candidates(change, build, catalogue)) {
      const result = applyEdit(build, command, catalogue);
      if (!result.ok) {
        reason = result.refusal.message;
        continue;
      }
      commands.push(command);
      build = result.blueprint;
      applied = true;
      break;
    }
    if (!applied) return { ok: false, change: index, reason };
  }
  if (commands.length === 0) return { ok: false, change: 0, reason: 'Do-it has no changes.' };
  return { ok: true, command: { kind: 'batch', commands }, blueprint: build };
};

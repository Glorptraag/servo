// `applyEdit`: the one pure function every EditCommand goes through, from touch, pointer, the list view and the app
// (ground rule 8). It runs the command's reducer, then checks the result as `validateBlueprint` does and puts it in
// canonical form, so the same commands give the same bytes on every path. A batch is all or nothing. It never reads
// the clock and never changes its input. See docs/commands.md and docs/placement.md.
import { canonicalizeBlueprint, validateBlueprint } from '@servo/schema';
import type { Blueprint, Catalogue } from '@servo/schema';
import type { ApplyEdit, EditBatch, EditResult, SingleEdit } from '../interface.ts';
import { PLACEMENT_REDUCERS } from './commands.ts';
import type { Draft, Reducer, Reducers } from './commands.ts';

/** Every command's reducer, by kind. Task 3.3 adds its wiring reducers, `connect` and `disconnect`, here. */
const REDUCERS: Reducers = { ...PLACEMENT_REDUCERS };

/** Commands another task builds: until it lands, they throw an error that names it, as the handle's stubs do. */
const LATER: Readonly<Record<string, string>> = { connect: '3.3', disconnect: '3.3' };

const refusal = (code: 'value.wrong_type' | 'value.not_allowed', message: string): EditResult => ({ ok: false, refusal: { code, message } });

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/** Checks a draft as `validateBlueprint` does and puts it in canonical form; the first issue is the refusal. */
const finish = (draft: Blueprint, catalogue: Catalogue): EditResult => {
  const checked = validateBlueprint(draft, catalogue);
  if (checked.ok) return { ok: true, blueprint: canonicalizeBlueprint(checked.value, catalogue) };
  const [issue] = checked.issues;
  return { ok: false, refusal: { code: issue?.code ?? 'value.unreadable', message: issue?.message ?? 'The changed build could not be read.' } };
};

const applySingle = (blueprint: Blueprint, command: SingleEdit, catalogue: Catalogue): EditResult => {
  if (!isObject(command)) return refusal('value.wrong_type', 'An edit command is an object with a kind.');
  const kind = command.kind;
  const reducer = typeof kind === 'string' && Object.hasOwn(REDUCERS, kind) ? (REDUCERS as Readonly<Record<string, unknown>>)[kind] : undefined;
  if (!reducer) {
    const task = typeof kind === 'string' && Object.hasOwn(LATER, kind) ? LATER[kind] : undefined;
    if (task) throw new Error(`applyEdit: '${kind}' is not implemented yet (task ${task}).`);
    return refusal('value.not_allowed', `No edit command is called '${String(kind)}'.`);
  }
  const result: Draft = (reducer as Reducer<SingleEdit['kind']>)(blueprint, command, catalogue);
  return result.ok ? finish(result.blueprint, catalogue) : result;
};

const applyBatch = (blueprint: Blueprint, batch: EditBatch, catalogue: Catalogue): EditResult => {
  const commands: unknown = batch.commands;
  if (!Array.isArray(commands)) return refusal('value.wrong_type', 'A batch holds a list of commands.');
  if (commands.length === 0) return finish(blueprint, catalogue);
  let current = blueprint;
  for (const [index, command] of commands.entries()) {
    const result =
      isObject(command) && command.kind === 'batch'
        ? refusal('value.not_allowed', 'A batch holds single commands, not another batch.')
        : applySingle(current, command as SingleEdit, catalogue);
    if (!result.ok) return { ok: false, refusal: { ...result.refusal, index } };
    current = result.blueprint;
  }
  return { ok: true, blueprint: current };
};

/**
 * Applies one command, or a batch all or nothing. For a blueprint `validateBlueprint` accepts, a success is one it
 * accepts too, in canonical form, with every new id claimed through the schema (`claimPartId`, `claimWireId`).
 */
export const applyEdit: ApplyEdit = (blueprint, command, catalogue) => {
  const kind: unknown = isObject(command) ? command.kind : undefined;
  return kind === 'batch' ? applyBatch(blueprint, command as EditBatch, catalogue) : applySingle(blueprint, command as SingleEdit, catalogue);
};

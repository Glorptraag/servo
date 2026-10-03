// A list view on a stand-in canvas for Node tests: the host applies commands with the one pure `applyEdit`, as the
// canvas's own `apply` does (refusing them in Run mode and when read-only), and records what the list view emitted.
import { canonicalJson, serializeBlueprint } from '@servo/schema';
import type { Blueprint, Catalogue, Level } from '@servo/schema';
import type { ControlInput, LiveState } from '@servo/sim-core/interface';
import { applyEdit } from '../../src/index.ts';
import type { CanvasMode, EditCommand, EditResult, ListAction, ListSubject, Selection, UnlockSettings } from '../../src/interface.ts';
import { ListViewModel } from '../../src/list-view/model.ts';
import { catalogue as exampleCatalogue } from '../helpers/catalogue.ts';

export interface Bench {
  readonly model: ListViewModel;
  readonly edits: EditCommand[];
  readonly controls: ControlInput[];
  readonly selections: Selection[];
  readonly live: Map<string, LiveState>;
  blueprint: Blueprint | undefined;
  mode: CanvasMode;
  level: Level;
  /** The action with this id among a subject's actions, performed; throws when it is not offered or changes nothing. */
  act(subject: ListSubject, id: string): void;
}

export const benchOf = (
  start: Blueprint | undefined,
  options: { readonly catalogue?: Catalogue; readonly readOnly?: boolean; readonly level?: Level; readonly unlockSettings?: UnlockSettings } = {},
): Bench => {
  const catalogue = options.catalogue ?? exampleCatalogue;
  const readOnly = options.readOnly === true;
  const bench: Bench = {
    edits: [],
    controls: [],
    selections: [],
    live: new Map(),
    blueprint: start,
    mode: 'build',
    level: options.level ?? 2,
    model: undefined as unknown as ListViewModel,
    act: (subject, id) => {
      const action = bench.model.actionsFor(subject).find((candidate) => candidate.id === id);
      if (!action) throw new Error(`no action ${id} on ${JSON.stringify(subject)}: ${bench.model.actionsFor(subject).map((a) => a.id).join(', ')}`);
      if (!bench.model.perform(action)) throw new Error(`${id} changed nothing`);
    },
  };
  const model = new ListViewModel({
    catalogue,
    readOnly,
    blueprint: () => bench.blueprint,
    mode: () => bench.mode,
    level: () => bench.level,
    ...(options.unlockSettings ? { unlockSettings: options.unlockSettings } : {}),
    apply: (command): EditResult => {
      if (readOnly || bench.mode === 'run') return { ok: false, refusal: { code: 'edit.locked', message: 'locked' } };
      const current = bench.blueprint;
      if (!current) return { ok: false, refusal: { code: 'edit.no_build', message: 'nothing loaded' } };
      const result = applyEdit(current, command, catalogue);
      if (result.ok && serializeBlueprint(result.blueprint) !== serializeBlueprint(current)) {
        bench.blueprint = result.blueprint;
        bench.edits.push(command);
        bench.model.changed();
      }
      return result;
    },
    control: (input) => bench.controls.push(input),
    select: (selection) => bench.selections.push(selection),
    live: (subject) => bench.live.get(subject),
  });
  (bench as { model: ListViewModel }).model = model;
  return bench;
};

/** The action among `actions` that does exactly `command`. */
export const actionDoing = (actions: readonly ListAction[], command: EditCommand): ListAction | undefined =>
  actions.find((action) => action.does.kind === 'edit' && canonicalJson(action.does.command) === canonicalJson(command));

// `tidy-wires` in the one command layer (ground rule 8): touch, pointer and the list view tidy through `applyEdit` like
// every other action. Routes are view state, so its reducer gives the build back as it was; the canvas handle routes
// the wires when the command succeeds (src/routing/controller.ts). See docs/routing.md.
import type { ListAction } from '../interface.ts';
import type { Reducer, Reducers } from '../placement/commands.ts';

const tidyWires: Reducer<'tidy-wires'> = (blueprint) => ({ ok: true, blueprint });

/** The command task 3.7 adds. */
export const ROUTING_REDUCERS: Reducers = { 'tidy-wires': tidyWires };

/** The list view's twin of the tidy wires button (task 3.6 offers it in Build mode beside the build's other actions). */
export const TIDY_WIRES_ACTION: ListAction = {
  id: 'tidy-wires',
  label: 'Tidy wires: route them round the parts',
  does: { kind: 'edit', command: { kind: 'tidy-wires' } },
};

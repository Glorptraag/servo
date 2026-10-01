// @servo/canvas: the build surface. `mountCanvas` is task 3.1's renderer; `applyEdit` is a stub that throws until
// tasks 3.2 and 3.3 replace it. See README.md.
import type { ApplyEdit } from './interface.ts';

export type * from './interface.ts';

export { mountCanvas } from './renderer/mount.ts';

export const applyEdit: ApplyEdit = () => {
  throw new Error('applyEdit is not implemented yet (tasks 3.2 and 3.3).');
};

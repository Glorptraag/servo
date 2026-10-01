// @servo/canvas: the build surface. Stubs until tasks 3.1–3.3 replace them; each throws. See README.md.
import type { ApplyEdit, MountCanvas } from './interface.ts';

export type * from './interface.ts';

export const mountCanvas: MountCanvas = () => {
  throw new Error('mountCanvas is not implemented yet (task 3.1).');
};

export const applyEdit: ApplyEdit = () => {
  throw new Error('applyEdit is not implemented yet (tasks 3.2 and 3.3).');
};

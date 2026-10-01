// @servo/canvas: the build surface. `mountCanvas` is task 3.1's renderer; `applyEdit` is the one command layer (task
// 3.2, with `connect` and `disconnect` to come from task 3.3). See README.md.
export type * from './interface.ts';

export { mountCanvas } from './renderer/mount.ts';
export { applyEdit } from './placement/apply.ts';

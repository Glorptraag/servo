// The conflict fixture (task 5.5): one build, synced to two devices, then changed on both while they are offline.
// The tablet takes its last wire off; later, the laptop takes its first wire off and renames the build. Whichever
// reconnects first, the laptop's later version keeps the build's id on every device, and the tablet's is kept as its
// own blueprint with `keptFrom` naming the build. Neither is merged into the other and neither is dropped. The Node
// tests (test/sync/) and the browser page (test/browser/sync-page.ts) both run it.
import { loadFixtures } from '@servo/content/fixtures';
import type { Blueprint, Timestamp } from '@servo/schema';

const rollingStart = loadFixtures().fixtures.find((fixture) => fixture.name === 'kit-rolling-start')?.blueprint as Blueprint | undefined;
if (!rollingStart) throw new Error('The content fixtures have no kit-rolling-start blueprint.');

export interface OfflineEdit {
  readonly device: 'tablet' | 'laptop';
  /** When the device saves its edit, offline. */
  readonly at: Timestamp;
  readonly edit: (build: Blueprint) => Blueprint;
}

export interface ConflictFixture {
  /** The build both devices start from. Kept on the tablet at `synced`, then synced to the laptop. */
  readonly start: Blueprint;
  readonly synced: Timestamp;
  readonly edits: readonly [OfflineEdit, OfflineEdit];
  /** The device whose version keeps the id: the later one. */
  readonly latest: OfflineEdit['device'];
}

export const conflictFixture: ConflictFixture = {
  start: rollingStart,
  synced: '2026-10-01T09:00:00.000Z',
  edits: [
    {
      device: 'tablet',
      at: '2026-10-02T16:10:00.000Z',
      edit: (build) => ({ ...build, wires: build.wires.slice(0, -1) }),
    },
    {
      device: 'laptop',
      at: '2026-10-02T18:45:00.000Z',
      edit: (build) => ({ ...build, wires: build.wires.slice(1), meta: { ...build.meta, name: 'Rolling robot, rewired' } }),
    },
  ],
  latest: 'laptop',
};

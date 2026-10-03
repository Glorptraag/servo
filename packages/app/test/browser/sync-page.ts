// Two devices in one page, on Chromium's real IndexedDB, syncing through one in-memory remote (task 5.5). The tablet
// listens to the browser's own network, which sync.test.ts takes offline with the page's browser context; the laptop
// is always online. Each runs the conflict fixture's edit (test/sync/fixtures/conflict.ts). The page puts its steps on
// `window.syncPage` for the test to call; the databases are named in the address (?store=<prefix>).
import { loadContent } from '@servo/content';
import type { Blueprint, BlueprintId, Timestamp } from '@servo/schema';
import type { ServoStore, SyncState } from '../../src/store/index.ts';
import { openStoreWith } from '../../src/store/open.ts';
import { manualNetwork, memoryRemote } from '../../src/sync/index.ts';
import { conflictFixture } from '../sync/fixtures/conflict.ts';

const prefix = new URLSearchParams(location.search).get('store');
if (!prefix) throw new Error('The sync page needs ?store=<database prefix>.');

interface Device {
  readonly store: ServoStore;
  time: Timestamp;
}

interface Listed {
  readonly id: BlueprintId;
  readonly name: string;
  readonly updatedAt: Timestamp;
  readonly keptFrom: BlueprintId | null;
  readonly wires: number;
}

const content = loadContent();
const remote = memoryRemote();
const devices: Partial<Record<'tablet' | 'laptop', Device>> = {};
let build: Blueprint | undefined;

const open = async (device: 'tablet' | 'laptop'): Promise<Device> => {
  const clock: { time: Timestamp } = { time: conflictFixture.synced };
  const store = await openStoreWith(
    content,
    { name: `${prefix}-${device}`, remote, now: () => clock.time },
    // The tablet uses the browser's network; the laptop is always online.
    device === 'laptop' ? { network: manualNetwork(true), syncOnOpen: false } : { syncOnOpen: false },
  );
  return Object.assign(clock, { store });
};

const deviceOf = (name: 'tablet' | 'laptop'): Device => {
  const device = devices[name];
  if (!device) throw new Error('Call setUp first.');
  return device;
};

const childOf = (name: 'tablet' | 'laptop') => {
  const device = deviceOf(name);
  return device.store.forProfile(build?.meta.author as string);
};

const syncPage = {
  /** The fixture's build kept on the tablet, synced to the laptop. Returns its id. */
  setUp: async (): Promise<BlueprintId> => {
    devices.tablet = await open('tablet');
    devices.laptop = await open('laptop');
    const profile = await devices.tablet.store.profiles.create('Robin');
    const kept = await devices.tablet.store.forProfile(profile.id).blueprints.copy(conflictFixture.start);
    if (!kept.ok) throw new Error('not kept');
    build = kept.blueprint;
    await devices.tablet.store.sync.now();
    await devices.laptop.store.sync.now();
    return build.meta.id;
  },
  /** Each device saves its edit: the tablet while the page is offline, the laptop, online, then syncs it. */
  edit: async (): Promise<void> => {
    if (!build) throw new Error('Call setUp first.');
    for (const { device, at, edit } of conflictFixture.edits) {
      deviceOf(device).time = at;
      const child = childOf(device);
      const loaded = await child.blueprints.load(build.meta.id);
      if (!loaded.ok) throw new Error('not loaded');
      await child.blueprints.save(edit(loaded.blueprint));
    }
    await deviceOf('laptop').store.sync.now();
  },
  state: (device: 'tablet' | 'laptop'): SyncState => deviceOf(device).store.sync.state,
  syncNow: (device: 'tablet' | 'laptop'): Promise<void> => deviceOf(device).store.sync.now(),
  /** How many changes the remote holds. */
  remoteSize: (): number => remote.log().length,
  /** A device's builds, newest first, each with its number of wires. */
  list: async (device: 'tablet' | 'laptop'): Promise<Listed[]> => {
    const child = childOf(device);
    const listed: Listed[] = [];
    for (const summary of await child.blueprints.list()) {
      const loaded = await child.blueprints.load(summary.id);
      const wires = loaded.ok ? loaded.blueprint.wires.length : -1;
      listed.push({ id: summary.id, name: summary.name, updatedAt: summary.updatedAt, keptFrom: summary.keptFrom ?? null, wires });
    }
    return listed;
  },
};

(window as unknown as { syncPage: typeof syncPage }).syncPage = syncPage;
document.body.dataset.ready = 'true';

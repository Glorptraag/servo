// Airplane mode (task 5.5): the app as it ships, its real production build with its service worker, served, opened
// once online, then opened again with no network at all: its browser context offline and the server stopped. The
// shell, the canvas, every file of the build (the content baked into it, the art, every lazily loaded chunk) and the
// store all work, a build is saved and kept across a reload, Run makes the robot move (so the physics engine's lazily
// loaded chunk, D11, came from the worker's cache), and no request fails. The page runs in a browser context of its own
// (side-page.ts), so going offline never touches the test runner.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { loadFixtures } from '@servo/content/fixtures';
import { serializeBlueprint } from '@servo/schema';

/** Generous, for a build and a busy machine. */
const SOON = { timeout: 60_000, interval: 100 };

afterAll(async () => {
  await commands.closeSidePage();
  await commands.stopBuiltApp();
});

const shell = `(async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  const header = document.querySelector('[data-region="header"]');
  const save = header && [...header.querySelectorAll('button')].find((button) => button.textContent === 'Save');
  const canvas = document.querySelector('canvas');
  return {
    header: header !== null,
    canvas: canvas !== null && canvas.width > 0 && canvas.height > 0,
    save: save ? !save.disabled : null,
    line: header?.querySelector('[role="status"]')?.textContent ?? null,
    name: header?.querySelector('button.shell-blueprint-name')?.textContent ?? null,
    online: navigator.onLine,
    controlled: navigator.serviceWorker.controller !== null,
    worker: registration ? (registration.active?.state ?? registration.waiting?.state ?? registration.installing?.state ?? 'none') : 'unregistered',
  };
})()`;

interface Shell {
  readonly header: boolean;
  readonly canvas: boolean;
  readonly save: boolean | null;
  readonly line: string | null;
  readonly name: string | null;
  readonly online: boolean;
  readonly controlled: boolean;
  /** The worker's state, for a failure's message. */
  readonly worker: string;
}

/** Every request the worker's cache holds, as paths. */
const cachedPaths = `caches.keys().then(async (names) => {
  const paths = [];
  for (const name of names) for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
  return paths.sort();
})`;

/** The device's profiles and builds, straight from IndexedDB, as the app stored them. */
const stored = `new Promise((resolve, reject) => {
  const opening = indexedDB.open('servo');
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const db = opening.result;
    const read = db.transaction(['profiles', 'blueprints']);
    const profiles = read.objectStore('profiles').getAll();
    const blueprints = read.objectStore('blueprints').getAll();
    read.oncomplete = () => {
      db.close();
      resolve({
        profiles: profiles.result.map((row) => row.name),
        builds: blueprints.result.map((row) => JSON.parse(row.document).meta).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
      });
    };
  };
})`;

interface Stored {
  readonly profiles: readonly string[];
  readonly builds: readonly { readonly id: string; readonly name: string; readonly updatedAt: string }[];
}

const shellNow = (): Promise<Shell> => commands.evaluateInSidePage<Shell>(shell);

/** The Run bar's state, and whether the list view reads out a wheel or motor turning. */
const runNow = `(() => {
  const bar = document.querySelector('[data-region="runBar"] .run-bar');
  const toggle = bar?.querySelector('.run-bar-toggle');
  const list = document.querySelector('.servo-list-view')?.textContent ?? '';
  return {
    phase: bar?.getAttribute('data-phase') ?? null,
    disabled: toggle ? toggle.disabled || toggle.getAttribute('aria-disabled') === 'true' : null,
    label: toggle?.textContent ?? null,
    turning: /(^|[^0-9-])-?[1-9][0-9]* turns a minute/.test(list),
  };
})()`;

interface Run {
  readonly phase: string | null;
  readonly disabled: boolean | null;
  readonly label: string | null;
  readonly turning: boolean;
}

/** The content's rolling robot as a new build, newer than any other on the device, so the app opens it. */
const roller = (otherThan: string | undefined): string => {
  const fixture = loadFixtures().fixtures.find((candidate) => candidate.name === 'level-1-roller')?.blueprint;
  if (!fixture) throw new Error('no level-1-roller fixture');
  const id = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
  if (id === otherThan) throw new Error('the build ids collide');
  return serializeBlueprint({ ...fixture, meta: { ...fixture.meta, id, updatedAt: '2099-01-01T00:00:00.000Z' } });
};

/** Puts a build in the device's store for its one profile, as the store keeps it. */
const putBuild = (document: string): string => `new Promise((resolve, reject) => {
  const opening = indexedDB.open('servo');
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const db = opening.result;
    const write = db.transaction(['profiles', 'blueprints'], 'readwrite');
    const profiles = write.objectStore('profiles').getAll();
    profiles.onsuccess = () => {
      const document = ${JSON.stringify(document)};
      write.objectStore('blueprints').put({ id: JSON.parse(document).meta.id, profile: profiles.result[0].id, document });
    };
    write.oncomplete = () => {
      db.close();
      resolve(true);
    };
    write.onerror = () => reject(write.error);
  };
})`;

/** Waits for the shell to match; a failure says which requests failed and what the page shows. */
const shellReady = async (match: Partial<Shell>): Promise<void> => {
  try {
    await vi.waitFor(async () => expect(await shellNow()).toMatchObject(match), SOON);
  } catch (error) {
    const failed = await commands.failedSideRequests();
    const page = await commands.evaluateInSidePage<string>(`(document.body?.innerText ?? '').slice(0, 300)`);
    throw new Error(`${(error as Error).message}\nFailed requests: ${failed.join(', ') || 'none'}\nThe page shows: ${page}`, { cause: error });
  }
};

describe('airplane mode', () => {
  it('opens the full sandbox with no network once the app has been opened online, and keeps what the child saves', async () => {
    const { url, files } = await commands.startBuiltApp();
    expect(files).toContain('/sw.js');
    const precached = files.filter((file) => file !== '/sw.js' && !file.endsWith('.map'));

    // Online, the first time: the app makes its first profile and build, and the worker downloads every file of the
    // build, then takes the page.
    await commands.openSidePage(url);
    await shellReady({ header: true, canvas: true, save: true, controlled: true });
    expect(await commands.evaluateInSidePage(cachedPaths)).toEqual(precached);
    const first = await commands.evaluateInSidePage<Stored>(stored);
    expect(first.profiles).toEqual(['Builder 1']);
    expect(first.builds.map((build) => build.name)).toEqual(['Build 1']);
    await commands.failedSideRequests();

    // Airplane mode: the browser context is offline and the site is gone.
    await commands.setSideNetwork(false);
    await commands.stopBuiltApp();
    await commands.reloadSidePage();
    await shellReady({ header: true, canvas: true, save: true, online: false });
    expect((await shellNow()).name).toBe('Build 1');

    // Every file of the build loads from the device, the lazily loaded chunks too (Rapier's, once the Run loop has one).
    const loads = await commands.evaluateInSidePage<boolean[]>(
      `Promise.all(${JSON.stringify(precached)}.map((path) => fetch(path).then((response) => response.ok, () => false)))`,
    );
    expect(loads).toEqual(precached.map(() => true));

    // The child saves with no network, and the build is kept across another reload, still offline.
    await commands.clickInSidePage('[data-region="header"] button:text-is("Save")');
    await vi.waitFor(async () => expect((await shellNow()).line).toBe('Saved'), SOON);
    const saved = await commands.evaluateInSidePage<Stored>(stored);
    expect(saved.builds).toHaveLength(1);
    expect(saved.builds[0]?.id).toBe(first.builds[0]?.id);
    expect((saved.builds[0]?.updatedAt ?? '') > (first.builds[0]?.updatedAt ?? '')).toBe(true);
    await commands.reloadSidePage();
    await shellReady({ header: true, canvas: true, save: true, name: 'Build 1' });
    expect(await commands.evaluateInSidePage<Stored>(stored)).toEqual(saved);
    // Run, offline (R-5.5 note 4): a robot the child built is opened, Run pressed, and it moves. Sim-core loads the
    // physics engine's WebAssembly lazily at the first Run (D11), so this is the worker serving that chunk too.
    await commands.evaluateInSidePage(putBuild(roller(saved.builds[0]?.id)));
    await commands.reloadSidePage();
    await shellReady({ header: true, canvas: true, name: 'Rolling robot', online: false });
    expect(await commands.evaluateInSidePage(runNow)).toMatchObject({ phase: 'build', disabled: false, label: 'Run' });
    await commands.clickInSidePage('[data-region="runBar"] .run-bar-toggle');
    await vi.waitFor(async () => expect(await commands.evaluateInSidePage(runNow)).toMatchObject({ phase: 'running', label: 'Stop' }), SOON);
    // The wheels turn: the list view's live readouts, which the canvas updates every simulated second in Run mode.
    await vi.waitFor(async () => expect((await commands.evaluateInSidePage<Run>(runNow)).turning).toBe(true), SOON);
    await commands.clickInSidePage('[data-region="runBar"] .run-bar-toggle');
    await vi.waitFor(async () => expect(await commands.evaluateInSidePage(runNow)).toMatchObject({ phase: 'build', label: 'Run' }), SOON);

    // Nothing the app loads failed. (The browser's own favicon.ico request is not the app's, and the build has none.)
    const failed = (await commands.failedSideRequests()).map((address) => new URL(address).pathname);
    expect(failed.filter((path) => path !== '/favicon.ico')).toEqual([]);
  }, 600_000);
});

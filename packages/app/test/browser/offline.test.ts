// Airplane mode (task 5.5): the app as it ships, its real production build with its service worker, served, opened
// once online, then opened again with no network at all: its browser context offline and the server stopped. The
// shell, the canvas, every file of the build (the content baked into it, the art, every lazily loaded chunk) and the
// store all work, a build is saved and kept across a reload, and no request fails. The page runs in a browser context
// of its own (side-page.ts), so going offline never touches the test runner.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';

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
    // Nothing the app loads failed. (The browser's own favicon.ico request is not the app's, and the build has none.)
    const failed = (await commands.failedSideRequests()).map((address) => new URL(address).pathname);
    expect(failed.filter((path) => path !== '/favicon.ico')).toEqual([]);
  }, 600_000);
});

// Sync on reconnect in a real browser (task 5.5): the conflict fixture on two devices in one page (sync-page.ts), on
// Chromium's own IndexedDB. The page's browser context goes offline, so the tablet sees the browser's offline event and
// navigator.onLine false; it keeps saving, and syncs by itself when the context comes back online. Both devices end
// with both versions: the later at the build's id, the other as its own blueprint with `keptFrom` naming it.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { conflictFixture } from '../sync/fixtures/conflict.ts';

const SOON = { timeout: 30_000, interval: 50 };

afterAll(() => commands.closeSidePage());

const call = <T,>(step: string, ...args: readonly unknown[]): Promise<T> =>
  commands.evaluateInSidePage<T>(`window.syncPage.${step}(...${JSON.stringify(args)})`);

interface Listed {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly keptFrom: string | null;
  readonly wires: number;
}

describe('sync on reconnect', () => {
  it('keeps both versions of a build changed on two devices, one of them offline, once it is back online', async () => {
    const prefix = `servo-sync-${Math.random().toString(36).slice(2)}`;
    await commands.openSidePage(`${location.origin}/test/browser/sync-page.html?store=${prefix}`);
    await vi.waitFor(async () => expect(await commands.evaluateInSidePage('document.body.dataset.ready')).toBe('true'), SOON);
    const id = await call<string>('setUp');
    expect(await call('state', 'tablet')).toBe('idle');
    const wires = conflictFixture.start.wires.length;

    await commands.setSideNetwork(false);
    await vi.waitFor(async () => expect(await call('state', 'tablet')).toBe('offline'), SOON);
    const before = await call<number>('remoteSize');
    await call('edit');
    // The laptop's edit reached the remote; the tablet's waits on the tablet.
    expect(await call<number>('remoteSize')).toBe(before + 1);
    await call('syncNow', 'tablet');
    expect(await call('state', 'tablet')).toBe('offline');
    expect(await call<number>('remoteSize')).toBe(before + 1);

    await commands.setSideNetwork(true);
    await vi.waitFor(async () => expect(await call<Listed[]>('list', 'tablet')).toHaveLength(2), SOON);
    await vi.waitFor(async () => expect(await call('state', 'tablet')).toBe('idle'), SOON);
    await call('syncNow', 'laptop');

    const [tabletEdit, laptopEdit] = conflictFixture.edits;
    for (const device of ['tablet', 'laptop'] as const) {
      const listed = await call<Listed[]>('list', device);
      expect(listed.map(({ name, updatedAt, keptFrom, wires: count }) => ({ name, updatedAt, keptFrom, wires: count }))).toEqual([
        { name: 'Rolling robot, rewired', updatedAt: laptopEdit.at, keptFrom: null, wires: wires - 1 },
        { name: conflictFixture.start.meta.name, updatedAt: tabletEdit.at, keptFrom: id, wires: wires - 1 },
      ]);
      expect(listed[0]?.id).toBe(id);
    }
    expect((await call<Listed[]>('list', 'tablet'))[1]?.id).toBe((await call<Listed[]>('list', 'laptop'))[1]?.id);
  }, 120_000);
});

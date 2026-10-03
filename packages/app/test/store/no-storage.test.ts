// Without IndexedDB (plain Node, as here, with no fake-indexeddb) the device's storage cannot be opened, the one case
// in which openStore rejects.
import { expect, it } from 'vitest';
import { openStore } from '../../src/store/index.ts';

it('rejects only when the device’s storage cannot be opened', async () => {
  expect((globalThis as { readonly indexedDB?: unknown }).indexedDB).toBeUndefined();
  await expect(openStore({ name: 'servo-no-storage' })).rejects.toThrow();
});

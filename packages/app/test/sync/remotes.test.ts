// The remotes (task 5.5): the in-memory one the tests and the sync page use, and the HTTP one that waits for a host
// (D13), tried here against a stand-in fetch. Nothing in the app makes an HTTP remote yet.
import { describe, expect, it, vi } from 'vitest';
import type { SyncChange } from '../../src/store/index.ts';
import { RemoteUnreachable, httpRemote, memoryRemote } from '../../src/sync/index.ts';

const change = (id: string): SyncChange => ({ collection: 'profiles', id, updatedAt: '2026-10-01T09:00:00.000Z', document: { id, name: 'Robin', createdAt: '2026-10-01T09:00:00.000Z' } });

describe('the in-memory remote', () => {
  it('keeps every push as a log, and a pull gives what came after the cursor', async () => {
    const remote = memoryRemote();
    expect(await remote.pull(undefined)).toEqual({ changes: [], cursor: '0' });
    await remote.push([change('a'), change('b')]);
    await remote.push([change('a')]);
    expect(await remote.pull(undefined)).toEqual({ changes: [change('a'), change('b'), change('a')], cursor: '3' });
    expect(await remote.pull('2')).toEqual({ changes: [change('a')], cursor: '3' });
    expect(await remote.pull('3')).toEqual({ changes: [], cursor: '3' });
    expect(remote.log()).toHaveLength(3);
  });

  it('shares no object with a device', async () => {
    const remote = memoryRemote();
    const pushed = change('a');
    await remote.push([pushed]);
    const [pulled] = (await remote.pull(undefined)).changes;
    expect(pulled).toEqual(pushed);
    expect(pulled).not.toBe(pushed);
  });

  it('rejects every call with RemoteUnreachable while it cannot be reached', async () => {
    const remote = memoryRemote();
    remote.reachable = false;
    await expect(remote.pull(undefined)).rejects.toBeInstanceOf(RemoteUnreachable);
    await expect(remote.push([change('a')])).rejects.toBeInstanceOf(RemoteUnreachable);
    expect(remote.log()).toEqual([]);
  });
});

describe('the HTTP remote', () => {
  const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('pulls with GET <url>/changes and the cursor, and pushes with POST, carrying the headers it is given', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => (init?.method === 'GET' ? answer({ changes: [change('a')], cursor: 'c2' }) : answer({})));
    const remote = httpRemote({ url: 'https://sync.invalid/v1', fetch: fetch as typeof globalThis.fetch, headers: () => ({ authorization: 'Bearer t' }) });
    expect(await remote.pull('c 1')).toEqual({ changes: [change('a')], cursor: 'c2' });
    expect(fetch).toHaveBeenLastCalledWith('https://sync.invalid/v1/changes?cursor=c%201', {
      method: 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    });
    await remote.pull(undefined);
    expect(fetch.mock.lastCall?.[0]).toBe('https://sync.invalid/v1/changes');
    await remote.push([change('b')]);
    expect(fetch).toHaveBeenLastCalledWith('https://sync.invalid/v1/changes', {
      method: 'POST',
      body: JSON.stringify({ changes: [change('b')] }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    });
  });

  it('says a host it cannot reach is unreachable, and refuses an error or an answer that is not a pull', async () => {
    const down = httpRemote({ url: 'https://sync.invalid', fetch: (async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch });
    await expect(down.pull(undefined)).rejects.toBeInstanceOf(RemoteUnreachable);
    await expect(down.push([])).rejects.toBeInstanceOf(RemoteUnreachable);
    const failing = httpRemote({ url: 'https://sync.invalid', fetch: (async () => answer({}, 503)) as typeof fetch });
    await expect(failing.pull(undefined)).rejects.toThrow(/503/);
    await expect(failing.pull(undefined)).rejects.not.toBeInstanceOf(RemoteUnreachable);
    const odd = httpRemote({ url: 'https://sync.invalid', fetch: (async () => answer({ changes: 'none' })) as typeof fetch });
    await expect(odd.pull(undefined)).rejects.toThrow(/not a pull/);
  });
});

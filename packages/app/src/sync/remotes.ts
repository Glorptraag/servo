// The remotes sync can go through (task 5.5, D10, D13): an in-memory one for tests and a second device in one page,
// and an HTTP one that stays off until a host is configured. A remote keeps every change pushed to it as a log, in
// the order pushed, and a pull gives every change after the cursor in that order, so a device that missed several
// versions of one blueprint can take each in turn. A remote that kept only the latest change of each record would
// still lose nothing, but the devices would keep a copy of a version they had simply not seen.
import type { SyncChange, SyncPull, SyncRemote } from '../store/index.ts';

/** The remote could not be reached: the device is offline, or the host is down. Sync waits and tries again. */
export class RemoteUnreachable extends Error {
  override readonly name = 'RemoteUnreachable';
}

export interface MemoryRemote extends SyncRemote {
  /** Every change pushed so far, oldest first. */
  log(): readonly SyncChange[];
  /** While false, every call rejects with RemoteUnreachable, as a remote the device cannot reach does. */
  reachable: boolean;
}

/** A remote held in memory. Changes are copied in and out, so no device shares an object with another. */
export const memoryRemote = (): MemoryRemote => {
  const changes: SyncChange[] = [];
  const remote: MemoryRemote = {
    reachable: true,
    log: () => structuredClone(changes),
    pull: async (cursor) => {
      if (!remote.reachable) throw new RemoteUnreachable('The remote cannot be reached.');
      const from = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
      const start = Number.isSafeInteger(from) && from >= 0 ? Math.min(from, changes.length) : 0;
      return { changes: structuredClone(changes.slice(start)), cursor: String(changes.length) };
    },
    push: async (pushed) => {
      if (!remote.reachable) throw new RemoteUnreachable('The remote cannot be reached.');
      changes.push(...structuredClone(pushed));
    },
  };
  return remote;
};

export interface HttpRemoteConfig {
  /** The sync endpoint's base address, without a trailing slash. */
  readonly url: string;
  /** Headers each request carries, such as the adult account's credentials once there is one (task 5.1). */
  readonly headers?: () => Readonly<Record<string, string>>;
  /** The fetch to use. Tests pass their own. */
  readonly fetch?: typeof fetch;
}

const isPull = (value: unknown): value is SyncPull =>
  typeof value === 'object' && value !== null && Array.isArray((value as SyncPull).changes) && typeof (value as SyncPull).cursor === 'string';

/**
 * A remote over HTTP, for when D13 names a host: `GET <url>/changes?cursor=<cursor>` answers a SyncPull as JSON, and
 * `POST <url>/changes` takes `{ "changes": [...] }`. A request that cannot reach the host rejects with
 * RemoteUnreachable; an answer that is not 2xx, or not a SyncPull, rejects with an Error. Nothing in the app makes one
 * yet: the store stays local-only until a host is chosen and the adult account can sign its requests.
 */
export const httpRemote = (config: HttpRemoteConfig): SyncRemote => {
  const send = async (path: string, init: RequestInit): Promise<Response> => {
    const go = config.fetch ?? fetch;
    let response: Response;
    try {
      response = await go(`${config.url}${path}`, { ...init, headers: { 'content-type': 'application/json', ...config.headers?.() } });
    } catch (error) {
      throw new RemoteUnreachable('The sync host cannot be reached.', { cause: error });
    }
    if (!response.ok) throw new Error(`The sync host answered ${response.status}.`);
    return response;
  };
  return {
    pull: async (cursor) => {
      const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      const body: unknown = await (await send(`/changes${query}`, { method: 'GET' })).json();
      if (!isPull(body)) throw new Error('The sync host answered something that is not a pull.');
      return body;
    },
    push: async (changes) => {
      await send('/changes', { method: 'POST', body: JSON.stringify({ changes }) });
    },
  };
};

// The offline worker's pages (task 5.2, D91): the web build has two, the child's app (index.html) and the parent page
// (parent.html). A navigation to the parent page opens its own cached page; every other one opens index.html, as
// before. The real worker runs here in a stand-in worker scope with a stand-in cache.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;

const ORIGIN = 'https://servo.example';
const FILES = ['/index.html', '/assets/index-abc.js', '/assets/parent-def.js', '/parent.html'];
const listeners = new Map<string, Listener>();
const fetched: string[] = [];

beforeAll(async () => {
  vi.stubGlobal('self', {
    __SERVO_OFFLINE__: { version: 'test', files: FILES },
    location: new URL(`${ORIGIN}/sw.js`),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  });
  vi.stubGlobal('caches', {
    open: () =>
      Promise.resolve({
        match: (request: Request | string) => {
          const key = typeof request === 'string' ? request : new URL(request.url).pathname;
          return Promise.resolve(FILES.includes(key) ? new Response(`cached ${key}`) : undefined);
        },
      }),
  });
  vi.stubGlobal('fetch', (request: Request) => {
    fetched.push(request.url);
    return Promise.resolve(new Response('from the network'));
  });
  await import('../../src/offline/service-worker.ts');
});

afterAll(() => vi.unstubAllGlobals());

const answer = async (url: string, navigate: boolean): Promise<string | undefined> => {
  let response: Promise<Response> | undefined;
  const request = new Request(url);
  if (navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
  listeners.get('fetch')?.({ request, respondWith: (given: Promise<Response>) => (response = given) });
  return (await response)?.text();
};

describe('the pages the offline worker opens', () => {
  it('opens the parent page on its own cached page, and every other page on index.html', async () => {
    expect(await answer(`${ORIGIN}/parent.html`, true)).toBe('cached /parent.html');
    expect(await answer(`${ORIGIN}/parent.html?from=home`, true)).toBe('cached /parent.html');
    expect(await answer(`${ORIGIN}/`, true)).toBe('cached /index.html');
    expect(await answer(`${ORIGIN}/settings`, true)).toBe('cached /index.html');
    expect(await answer(`${ORIGIN}/other.html`, true)).toBe('cached /index.html');
    expect(await answer(`${ORIGIN}/assets/parent-def.js`, false)).toBe('cached /assets/parent-def.js');
    expect(fetched).toEqual([]);
  });
});

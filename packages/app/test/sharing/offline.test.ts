// Shared links and the offline service worker (tasks 5.5 and 5.6): a link's build lives in the fragment, which never
// reaches the worker or a server, so opening one, online or offline, is the cached index.html like any page of the
// app. The real worker runs here in a stand-in worker scope with a stand-in cache.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { shareLinkOf } from '../../src/sharing/link.ts';

type Listener = (event: unknown) => void;

const ORIGIN = 'https://servo.example';
const FILES = ['/index.html', '/assets/index-abc.js'];
const listeners = new Map<string, Listener>();
const matched: string[] = [];
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
          const key = typeof request === 'string' ? request : request.url;
          matched.push(key);
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

/** Hands the worker a fetch event, as the browser does for a page load, and gives back its answer. */
const navigate = async (url: string): Promise<Response | undefined> => {
  let answer: Promise<Response> | undefined;
  const request = new Request(url);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  listeners.get('fetch')?.({ request, respondWith: (response: Promise<Response>) => (answer = response) });
  return answer;
};

describe('a shared link with the offline worker', () => {
  it('opens on the cached index.html, and the fragment goes no further than the page', async () => {
    const fixture = loadFixtures().fixtures.find((found) => found.name === 'level-1-roller');
    if (!fixture) throw new Error('no fixture');
    const link = await shareLinkOf(fixture.blueprint, loadContent().content.catalogue, { base: `${ORIGIN}/` });
    if (!link.ok) throw new Error('no link');
    // What the browser asks the worker for: the address without its fragment.
    const asked = new URL(link.url);
    asked.hash = '';
    const response = await navigate(asked.href);
    expect(await response?.text()).toBe('cached /index.html');
    expect(matched.at(-1)).toBe('/index.html');
    expect(fetched).toEqual([]);
    // A browser that hands the worker the whole address, fragment and all, is served the same page.
    const whole = await navigate(link.url);
    expect(await whole?.text()).toBe('cached /index.html');
    expect(fetched).toEqual([]);
    expect([...matched, ...fetched].some((key) => key.includes('share='))).toBe(false);
  });
});

// The release's app half (task 6.3) in Chromium: the tester invite gate, Settings, and the routing main.tsx does
// through startPage, with a stand-in for the child's app that counts how often it opens. The build's hashes are known
// answers (shasum -a 256), the ones the app's and the release's unit tests hold the hash to. One test reloads a real
// page in a frame (release-page.html), and one opens the real entry, index.html, which has no invite hashes here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildInfo } from '../../src/release/build-info.ts';
import { INVITE_KEY } from '../../src/release/invite.ts';
import { EMPTY, NOT_SECURE, NO_MATCH } from '../../src/release/invite-gate.tsx';
import { NOT_A_RELEASE } from '../../src/release/settings.tsx';
import { startPage } from '../../src/release/start.ts';

/** printf '%s' ABCD2345 | shasum -a 256 */
const ABCD2345 = 'a00d76646eba91b057841554d5c8334f498dc592ed744bce404f21fe271cd36e';
/** printf '%s' 23RYK629 | shasum -a 256: a second code, so the build takes more than one. */
const SECOND = 'b6753643b54721594b9f84348dfcdec21090d790296625acb37bcf6f725246d9';

const TESTER: BuildInfo = { appVersion: '0.1.0', contentVersion: '0.1.0+9c5fd87f', inviteHashes: [SECOND, ABCD2345] };
const NOT_TESTER: BuildInfo = { ...TESTER, inviteHashes: [] };

const hosts: HTMLElement[] = [];
const frames: HTMLIFrameElement[] = [];
const title = document.title;

beforeEach(() => localStorage.removeItem(INVITE_KEY));
afterEach(() => {
  vi.unstubAllGlobals();
  for (const element of [...hosts.splice(0), ...frames.splice(0)]) element.remove();
  localStorage.removeItem(INVITE_KEY);
  document.title = title;
});

interface Started {
  readonly host: HTMLElement;
  /** How many times the stand-in app has opened. */
  opened(): number;
}

/** Starts a page as main.tsx does, in a host that fills the screen, with a stand-in for the child's app. */
const start = async (info: BuildInfo, pathname = '/'): Promise<Started> => {
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0';
  document.body.append(host);
  hosts.push(host);
  let opened = 0;
  const openApp = (page: HTMLElement): void => {
    opened += 1;
    const marker = document.createElement('p');
    marker.dataset.app = 'open';
    marker.textContent = 'The app';
    page.append(marker);
  };
  await startPage(host, { info, pathname, openApp });
  return { host, opened: () => opened };
};

const one = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
};

/** The gate's form, once React has drawn it. */
const gateIn = async (root: ParentNode) => {
  await vi.waitFor(() => one(root, 'form'), { timeout: 10_000 });
  const input = one<HTMLInputElement>(root, 'input');
  return {
    form: one<HTMLFormElement>(root, 'form'),
    input,
    button: one<HTMLButtonElement>(root, 'button[type="submit"]'),
    problem: () => one(root, `#${CSS.escape(input.getAttribute('aria-describedby') ?? '')}`).textContent,
  };
};

/** Types into a field as the browser does for React: the value through its own setter, then an input event. */
const typeInto = (input: HTMLInputElement, text: string): void => {
  const view = input.ownerDocument.defaultView;
  if (!view) throw new Error('the field has no window');
  Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set?.call(input, text);
  input.dispatchEvent(new view.Event('input', { bubbles: true }));
};

/** Lets React and the hash's promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('a tester build', () => {
  it('opens on the invite form, before the app: a heading, one labelled field and one button, no dialog and no links', async () => {
    const page = await start(TESTER);
    const gate = await gateIn(page.host);
    expect(one(page.host, 'h1').textContent).toBe('Servo tester build');
    expect(gate.input.labels?.[0]?.textContent).toBe('Invite code');
    expect(gate.button.textContent).toBe('Open Servo');
    expect(page.host.querySelectorAll('a, dialog, [role="dialog"], [aria-modal]')).toHaveLength(0);
    expect(page.host.textContent).not.toContain('!');
    expect(page.opened()).toBe(0);
  });

  it('says so under the field when no code is entered or a code does not match, and stays shut', async () => {
    const page = await start(TESTER);
    const gate = await gateIn(page.host);
    gate.button.click();
    await vi.waitFor(() => expect(gate.problem()).toBe(EMPTY));
    expect(gate.input.getAttribute('aria-invalid')).toBe('true');
    typeInto(gate.input, 'WXYZ-2345');
    gate.button.click();
    await vi.waitFor(() => expect(gate.problem()).toBe(NO_MATCH));
    expect(gate.input.getAttribute('aria-invalid')).toBe('true');
    await settle();
    expect(page.opened()).toBe(0);
    expect(localStorage.getItem(INVITE_KEY)).toBeNull();
  });

  it('opens the app once a code matches, however it is typed, and remembers the code on the device', async () => {
    const page = await start(TESTER);
    const gate = await gateIn(page.host);
    typeInto(gate.input, ' abcd 2345 ');
    gate.button.click();
    await vi.waitFor(() => expect(page.opened()).toBe(1));
    expect(page.host.querySelector('form')).toBeNull();
    expect(one(page.host, '[data-app]').textContent).toBe('The app');
    expect(localStorage.getItem(INVITE_KEY)).toBe('ABCD2345');
  });

  it('opens the app once when the code is sent twice before the first check ends', async () => {
    const page = await start(TESTER);
    const gate = await gateIn(page.host);
    typeInto(gate.input, 'ABCD-2345');
    gate.button.click();
    gate.button.click();
    gate.form.requestSubmit();
    await vi.waitFor(() => expect(page.opened()).toBe(1));
    await settle();
    expect(page.opened()).toBe(1);
    expect(page.host.querySelectorAll('[data-app]')).toHaveLength(1);
  });

  it('opens at once on a device that remembers a code, and asks again for a code the build no longer takes', async () => {
    localStorage.setItem(INVITE_KEY, 'ABCD2345');
    const remembered = await start(TESTER);
    expect(remembered.opened()).toBe(1);
    expect(remembered.host.querySelector('form')).toBeNull();

    localStorage.setItem(INVITE_KEY, 'WXYZ2345');
    const stale = await start(TESTER);
    await gateIn(stale.host);
    expect(stale.opened()).toBe(0);
  });

  it('shows Settings at /settings only after the gate, and never opens the app there', async () => {
    const page = await start(TESTER, '/settings');
    const gate = await gateIn(page.host);
    expect(page.host.textContent).not.toContain('Content version');
    typeInto(gate.input, 'abcd2345');
    gate.button.click();
    await vi.waitFor(() => expect(one(page.host, 'h1').textContent).toBe('Settings'));
    expect(page.host.textContent).toContain('0.1.0+9c5fd87f');
    expect(page.opened()).toBe(0);
  });

  it('stays shut where the page cannot hash, and says a secure address is needed', async () => {
    const page = await start(TESTER);
    const gate = await gateIn(page.host);
    typeInto(gate.input, 'ABCD2345');
    vi.stubGlobal('crypto', { subtle: undefined });
    gate.button.click();
    await vi.waitFor(() => expect(gate.problem()).toBe(NOT_SECURE));
    vi.unstubAllGlobals();
    expect(gate.input.getAttribute('aria-invalid')).toBe('false');
    expect(page.opened()).toBe(0);
    expect(localStorage.getItem(INVITE_KEY)).toBeNull();
  });

  it('remembers a code across a real reload of the page', async () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position: fixed; inset: 0; width: 800px; height: 600px; border: 0';
    frames.push(frame);
    const loaded = () => new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    const page = () => {
      const doc = frame.contentDocument;
      if (!doc) throw new Error('the frame has no document');
      return doc;
    };
    const firstLoad = loaded();
    frame.src = `/test/browser/release-page.html?hash=${SECOND}&hash=${ABCD2345}`;
    document.body.append(frame);
    await firstLoad;
    const gate = await gateIn(page());
    expect(page().querySelectorAll('[data-app]')).toHaveLength(0);
    typeInto(gate.input, 'abcd-2345');
    gate.button.click();
    await vi.waitFor(() => expect(page().querySelectorAll('[data-app]')).toHaveLength(1), { timeout: 10_000 });

    const reload = loaded();
    frame.contentWindow?.location.reload();
    await reload;
    await vi.waitFor(() => expect(page().querySelectorAll('[data-app]')).toHaveLength(1), { timeout: 10_000 });
    expect(page().querySelector('form')).toBeNull();
  });
});

describe('a build with no invite hashes', () => {
  it('opens the app at once, with no gate', async () => {
    const page = await start(NOT_TESTER);
    expect(page.opened()).toBe(1);
    await settle();
    expect(page.host.querySelector('form, input')).toBeNull();
  });

  it('shows Settings at once at /settings/', async () => {
    const page = await start(NOT_TESTER, '/settings/');
    await vi.waitFor(() => expect(one(page.host, 'h1').textContent).toBe('Settings'));
    expect(page.host.querySelector('form')).toBeNull();
    expect(page.opened()).toBe(0);
  });

  it('is what the real page is here: index.html opens the shell, with no gate', async () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position: fixed; inset: 0; width: 1180px; height: 820px; border: 0';
    frame.src = '/index.html';
    frames.push(frame);
    document.body.append(frame);
    await vi.waitFor(() => one(frame.contentDocument ?? document.createDocumentFragment(), '.servo-shell'), { timeout: 60_000, interval: 50 });
    expect(frame.contentDocument?.querySelector('.release-page, form')).toBeNull();
  });
});

describe('Settings', () => {
  it('shows the app version and the content version, and nothing to change but the access options', async () => {
    const page = await start(NOT_TESTER, '/settings');
    await vi.waitFor(() => one(page.host, 'dl'));
    const rows = [...page.host.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]);
    expect(rows).toEqual([
      ['App version', '0.1.0'],
      ['Content version', '0.1.0+9c5fd87f'],
    ]);
    // The access options' four switches (task 5.7) are the only controls: no links out, nothing else to change.
    const controls = [...page.host.querySelectorAll('a, input, button, select, textarea')];
    expect(controls.map((control) => control.getAttribute('role'))).toEqual(['switch', 'switch', 'switch', 'switch']);
    expect(controls.every((control) => control.closest('[data-region="access"]'))).toBe(true);
    expect(document.title).toBe('Servo settings');
  });

  it('says "Not a release build" for a version only a release build has', async () => {
    const page = await start({ appVersion: undefined, contentVersion: undefined, inviteHashes: [] }, '/settings');
    await vi.waitFor(() => one(page.host, 'dl'));
    expect([...page.host.querySelectorAll('dd')].map((value) => value.textContent)).toEqual([NOT_A_RELEASE, NOT_A_RELEASE]);
  });
});

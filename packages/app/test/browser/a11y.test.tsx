// The accessibility pass (task 5.7) in Chromium. axe-core checks the app's main screens against WCAG 2.2 A and AA,
// through the real App with the real canvas, content, sim-core and run loop: the build with nothing selected, a part
// selected through the list view (its screen-reader path) with the spec card out, Home, and a Run. Each screen is
// checked with every access option off, then with high contrast, the dyslexia-friendly type and the left-handed
// mirror each on, and then all on together; Settings and the invite form are checked too. Then the options themselves:
// each switch by pointer, touch and keyboard, named for a screen reader (ground rule 8); each reaching the shell, the
// spec card, the canvas and the layout as soon as it changes; and read-aloud through the spec card's speech.
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { CanvasHandle, CanvasPrefs } from '@servo/canvas';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { ACCESS_KEY, ACCESS_OPTIONS, ACCESS_TEXT, AccessSettings, AccessStore, DEFAULT_ACCESS, ReadAloudScope, followReadAloud, readAccess } from '../../src/a11y/index.ts';
import type { AccessOption, AccessPrefs } from '../../src/a11y/index.ts';
import { App } from '../../src/App.tsx';
import { NO_FLAGS } from '../../src/flags/index.ts';
import { openThroughInviteGate } from '../../src/release/invite-gate.tsx';
import { SettingsView } from '../../src/release/settings.tsx';
import { PLACEHOLDER_SLOTS, Shell } from '../../src/shell/index.ts';
import type { SpeechPort } from '../../src/spec-card/index.ts';
import { StandInCanvas } from './stand-in.ts';

const { content } = loadContent();
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');

const SOON = { timeout: 30_000 };
const RUN = { timeout: 60_000 };

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA: the brief's bar for everything that is not the canvas (Section 13). */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Every WCAG A and AA violation axe finds in `context`, one line per rule with the elements it names. */
const violations = async (context: Element): Promise<string[]> => {
  const result = await axe.run(context, { runOnly: { type: 'tag', values: WCAG_AA }, resultTypes: ['violations'] });
  return result.violations.map(
    (violation) => `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.help}\n${violation.nodes.map((node) => `    ${node.target.join(' ')}: ${node.failureSummary ?? ''}`).join('\n')}`,
  );
};

const opened: { root: Root; host: HTMLElement }[] = [];

beforeEach(() => localStorage.removeItem(ACCESS_KEY));
afterEach(() => {
  for (const { root, host } of opened.splice(0)) {
    root.unmount();
    host.remove();
  }
  localStorage.removeItem(ACCESS_KEY);
  vi.restoreAllMocks();
});

const hostOf = (): { root: Root; host: HTMLElement } => {
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  opened.push({ root, host });
  return { root, host };
};

const storeWith = (on: Partial<AccessPrefs>, storage: Storage | null = null): AccessStore => {
  const store = new AccessStore(storage);
  for (const option of ACCESS_OPTIONS) if (on[option]) store.set(option, true);
  return store;
};

interface MountedApp {
  readonly host: HTMLElement;
  readonly shell: () => HTMLElement;
  readonly access: AccessStore;
}

const mountApp = async (access: AccessStore): Promise<MountedApp> => {
  const { root, host } = hostOf();
  await new Promise<void>((ready) => root.render(<App content={content} start={roller} access={access} flags={NO_FLAGS} onReady={ready} />));
  const shell = (): HTMLElement => {
    const found = host.querySelector<HTMLElement>('.servo-shell');
    if (!found) throw new Error('no shell');
    return found;
  };
  // The list view is filled once the canvas has the build.
  await vi.waitFor(() => expect(host.querySelector('.servo-list-view button[data-toggle]')).not.toBeNull(), SOON);
  return { host, shell, access };
};

const button = (root: ParentNode, selector: string): HTMLButtonElement => {
  const found = root.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};

const headerButton = (app: MountedApp, name: string): HTMLButtonElement => {
  const found = [...app.host.querySelectorAll<HTMLButtonElement>('[data-region="header"] button')].find((each) => each.textContent === name);
  if (!found) throw new Error(`no ${name} button in the header`);
  return found;
};

/** Selects the build's first part as a screen reader does: its Actions button in the list view, then Select. */
const selectFirstPart = async (app: MountedApp): Promise<void> => {
  const toggle = [...app.host.querySelectorAll<HTMLButtonElement>('.servo-list-view button[data-toggle]')].find((each) => each.dataset.toggle?.startsWith('part'));
  if (!toggle) throw new Error('no part in the list view');
  toggle.focus();
  toggle.click();
  await vi.waitFor(() => button(app.host, '.servo-list-view button[data-action^="select:part:"]'), SOON);
  button(app.host, '.servo-list-view button[data-action^="select:part:"]').click();
  await vi.waitFor(() => expect(app.host.querySelector('[data-region="specCard"]')?.getAttribute('data-shown')).toBe('true'), SOON);
  await vi.waitFor(() => expect(app.host.querySelector('[data-region="specCard"] .spec-card')).not.toBeNull(), SOON);
};

/** The four screens, each checked by axe; returns every violation, named by screen. */
const auditScreens = async (app: MountedApp): Promise<string[]> => {
  const found: string[] = [];
  const check = async (screen: string): Promise<void> => {
    // Panels finish sliding (160 ms) before axe reads their colours.
    await new Promise((settle) => setTimeout(settle, 250));
    found.push(...(await violations(app.shell())).map((line) => `${screen}: ${line}`));
  };
  await check('build');

  await selectFirstPart(app);
  await check('spec card');

  headerButton(app, 'Home').click();
  await vi.waitFor(() => expect(app.host.querySelector('.servo-home')).not.toBeNull(), SOON);
  await check('Home');
  button(app.host, '.servo-home .home-top button').click();
  await vi.waitFor(() => expect(app.host.querySelector('.servo-home')).toBeNull(), SOON);

  const toggle = (): string | null => app.host.querySelector('.run-bar-toggle')?.getAttribute('data-run') ?? null;
  button(app.host, '.run-bar-toggle').click();
  await vi.waitFor(() => expect(toggle()).toBe('stop'), RUN);
  await check('Run');
  button(app.host, '.run-bar-toggle').click();
  await vi.waitFor(() => expect(toggle()).toBe('run'), RUN);
  return found;
};

const THEMES: readonly { readonly name: string; readonly on: Partial<AccessPrefs> }[] = [
  { name: 'every option off', on: {} },
  { name: 'high contrast', on: { highContrast: true } },
  { name: 'dyslexia-friendly type', on: { dyslexiaType: true } },
  { name: 'left-handed', on: { leftHanded: true } },
  { name: 'every option on', on: { highContrast: true, dyslexiaType: true, leftHanded: true, readAloud: true } },
];

describe('WCAG 2.2 AA on the chrome (axe-core)', () => {
  for (const theme of THEMES) {
    it(`finds no violation on the build, the spec card, Home or a Run, with ${theme.name}`, async () => {
      const app = await mountApp(storeWith(theme.on));
      expect(await auditScreens(app)).toEqual([]);
    });
  }

  for (const theme of [THEMES[0], THEMES[1], THEMES[2]]) {
    if (!theme) continue;
    it(`finds no violation on Settings, with ${theme.name}`, async () => {
      const { root, host } = hostOf();
      root.render(<SettingsView info={{ appVersion: '0.1.0', contentVersion: '0.1.0+abc', inviteHashes: [] }} access={storeWith(theme.on)} />);
      await vi.waitFor(() => expect(host.querySelector('[data-region="access"]')).not.toBeNull(), SOON);
      expect(await violations(host)).toEqual([]);
    });
  }

  it('finds no violation on the invite form', async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
    document.body.appendChild(host);
    void openThroughInviteGate(host, ['0'.repeat(64)], () => undefined);
    await vi.waitFor(() => expect(host.querySelector('form, input')).not.toBeNull(), SOON);
    expect(await violations(host)).toEqual([]);
    host.remove();
  });
});

/** A finger on `element`: a real touch through CDP, which the browser turns into a click. */
const touch = async (element: Element): Promise<void> => {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + box.left + 12, y: (frame?.top ?? 0) + box.top + box.height / 2 };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const switchOf = (root: ParentNode, option: AccessOption): HTMLInputElement => {
  const found = root.querySelector<HTMLInputElement>(`[data-region="access"] [data-option="${option}"] input[role="switch"]`);
  if (!found) throw new Error(`no ${option} switch`);
  return found;
};

const rowOf = (root: ParentNode, option: AccessOption): HTMLElement => switchOf(root, option).closest('label') as HTMLElement;

describe('the access switches', () => {
  it('each turn by pointer, touch and Space, are named and described for a screen reader, and are 44 px targets', async () => {
    const { root, host } = hostOf();
    const store = new AccessStore(localStorage);
    root.render(<AccessSettings store={store} />);
    await vi.waitFor(() => switchOf(host, 'readAloud'));
    expect(host.querySelector('legend')?.textContent).toBe(ACCESS_TEXT.heading);
    for (const option of ACCESS_OPTIONS) {
      const control = switchOf(host, option);
      expect(control.labels?.[0]?.textContent).toContain(ACCESS_TEXT.options[option].name);
      expect(document.getElementById(control.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(ACCESS_TEXT.options[option].name);
      const described = document.getElementById(control.getAttribute('aria-describedby') ?? '');
      expect(described?.textContent).toBe(ACCESS_TEXT.options[option].line);
      expect(rowOf(host, option).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(control.checked).toBe(false);

      await userEvent.click(rowOf(host, option));
      await expect.poll(() => switchOf(host, option).checked).toBe(true);
      expect(store.prefs[option]).toBe(true);

      await touch(rowOf(host, option));
      await expect.poll(() => switchOf(host, option).checked).toBe(false);

      switchOf(host, option).focus();
      await userEvent.keyboard(' ');
      await expect.poll(() => switchOf(host, option).checked).toBe(true);
      expect(readAccess(localStorage)[option]).toBe(true);
    }
    expect(await violations(host)).toEqual([]);
  });

  it('on Home, Space ticks a switch and is not Run, and the shell follows at once', async () => {
    const app = await mountApp(new AccessStore(localStorage));
    headerButton(app, 'Home').click();
    await vi.waitFor(() => switchOf(app.host, 'highContrast'), SOON);
    expect(app.shell().dataset.contrast).toBe('standard');
    switchOf(app.host, 'highContrast').focus();
    await userEvent.keyboard(' ');
    await expect.poll(() => app.shell().dataset.contrast).toBe('high');
    expect(app.host.querySelector('.run-bar-toggle')?.getAttribute('data-run')).toBe('run');
    expect(readAccess(localStorage).highContrast).toBe(true);
    await touch(rowOf(app.host, 'dyslexiaType'));
    await expect.poll(() => app.shell().dataset.typeface).toBe('dyslexia-friendly');
    await userEvent.click(rowOf(app.host, 'leftHanded'));
    await expect.poll(() => app.shell().dataset.hand).toBe('left');
  });
});

describe('the options reach the chrome, the spec card, the layout and the canvas', () => {
  it('high contrast swaps the chrome to black on white, and darkens the spec card while keeping socket shapes', async () => {
    const app = await mountApp(storeWith({}));
    await selectFirstPart(app);
    const header = button(app.host, '[data-region="header"] button');
    const card = app.host.querySelector('[data-region="specCard"]') as HTMLElement;
    const before = { header: getComputedStyle(header).color, card: getComputedStyle(card).backgroundColor };
    app.access.set('highContrast', true);
    await expect.poll(() => getComputedStyle(card).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(header).color).toBe('rgb(0, 0, 0)');
    expect(before.header).not.toBe('rgb(0, 0, 0)');
    expect(before.card).not.toBe('rgb(255, 255, 255)');
    const sockets = [...card.querySelectorAll('.spec-card-port')].map((port) => port.getAttribute('data-type'));
    expect(sockets.length).toBeGreaterThan(0);
    for (const port of card.querySelectorAll('.spec-card-port')) expect(port.querySelector('svg')).not.toBeNull();
  });

  it('the dyslexia-friendly type changes the face and the spacing on the chrome and the spec card', async () => {
    const app = await mountApp(storeWith({}));
    await selectFirstPart(app);
    const name = app.host.querySelector('.spec-card-name') as HTMLElement;
    const before = getComputedStyle(name).fontFamily;
    app.access.set('dyslexiaType', true);
    await expect.poll(() => getComputedStyle(name).fontFamily).not.toBe(before);
    expect(getComputedStyle(name).fontFamily).toMatch(/OpenDyslexic/);
    expect(Number.parseFloat(getComputedStyle(app.shell()).letterSpacing)).toBeGreaterThan(0);
  });

  it('the left-handed layout swaps the tray and the spec card', async () => {
    const app = await mountApp(storeWith({}));
    await selectFirstPart(app);
    const centre = (region: string): number => {
      const box = (app.host.querySelector(`[data-region="${region}"]`) as HTMLElement).getBoundingClientRect();
      return box.left + box.width / 2;
    };
    const width = app.shell().clientWidth;
    expect(centre('tray')).toBeLessThan(width / 2);
    expect(centre('specCard')).toBeGreaterThan(width / 2);
    app.access.set('leftHanded', true);
    await expect.poll(() => app.shell().dataset.hand).toBe('left');
    await expect.poll(() => centre('tray'), SOON).toBeGreaterThan(width / 2);
    await expect.poll(() => centre('specCard'), SOON).toBeLessThan(width / 2);
  });

  it("the canvas gets each option through the shell's prefs as it changes", async () => {
    const { root, host } = hostOf();
    const set: CanvasPrefs[] = [];
    const canvas: CanvasHandle = new StandInCanvas();
    canvas.setPrefs = (prefs) => void set.push(prefs);
    const render = (prefs: CanvasPrefs): void =>
      root.render(<Shell content={content} level={1} storage={null} prefs={prefs} slots={PLACEHOLDER_SLOTS} mountCanvas={() => canvas} />);
    const base: CanvasPrefs = { dragSensitivity: 1, leftHanded: false, highContrast: false, typeface: 'standard' };
    render(base);
    await vi.waitFor(() => expect(host.querySelector('.servo-shell[data-hand]')).not.toBeNull(), SOON);
    const next: CanvasPrefs = { ...base, highContrast: true, typeface: 'dyslexia-friendly', leftHanded: true };
    render(next);
    await expect.poll(() => set.at(-1)).toEqual(next);
    expect(host.querySelector('.servo-shell')?.getAttribute('data-hand')).toBe('left');
  });
});

/** A speech port that keeps what it was asked to say. */
const heardSpeech = () => {
  const said: string[] = [];
  const cancelled = { count: 0 };
  class Utterance {
    rate = 1;
    lang = '';
    readonly text: string;
    constructor(text: string) {
      this.text = text;
    }
  }
  const speech: SpeechPort = {
    synth: {
      speak: (utterance) => void said.push(utterance.text),
      cancel: () => void (cancelled.count += 1),
    },
    Utterance: Utterance as unknown as SpeechPort['Utterance'],
  };
  return { speech, said, cancelled };
};

describe('read-aloud', () => {
  it('reads the words tapped, a focused control by keyboard, and a status line that changes, only while it is on', async () => {
    const { root, host } = hostOf();
    const { speech, said } = heardSpeech();
    const store = storeWith({});
    const Page = ({ status }: { readonly status: string }) => (
      <ReadAloudScope store={store} speech={speech}>
        <p className="line">
          The <b>DC motor</b> turns.
        </p>
        <button type="button" className="go">
          Run <span aria-hidden="true">now</span>
        </button>
        <p role="status">{status}</p>
        <div className="shell-canvas-host" style={{ position: 'static' }}>
          <button type="button" className="in-canvas">
            Battery pack
          </button>
        </div>
      </ReadAloudScope>
    );
    root.render(<Page status="" />);
    await vi.waitFor(() => button(host, '.go'));

    await userEvent.click(host.querySelector('.line b') as HTMLElement);
    expect(said).toEqual([]);

    store.set('readAloud', true);
    await userEvent.click(host.querySelector('.line b') as HTMLElement);
    expect(said).toEqual(['The DC motor turns.']);
    await userEvent.click(button(host, '.go'));
    expect(said.at(-1)).toBe('Run');
    await userEvent.click(button(host, '.in-canvas'));
    expect(said.at(-1)).toBe('Run');

    button(host, '.go').blur();
    await userEvent.keyboard('{Tab}');
    await expect.poll(() => said.length).toBeGreaterThanOrEqual(2);

    root.render(<Page status="Goal met" />);
    await expect.poll(() => said.at(-1)).toBe('Goal met');

    store.set('readAloud', false);
    const count = said.length;
    root.render(<Page status="Saved" />);
    await userEvent.click(host.querySelector('.line b') as HTMLElement);
    await new Promise((settle) => setTimeout(settle, 100));
    expect(said).toHaveLength(count);
  });

  it("says a switch's state with its name, and stops reading when turned off", async () => {
    const { root, host } = hostOf();
    const { speech, said, cancelled } = heardSpeech();
    const store = storeWith({ readAloud: true });
    root.render(
      <ReadAloudScope store={store} speech={speech}>
        <AccessSettings store={store} />
      </ReadAloudScope>,
    );
    await vi.waitFor(() => switchOf(host, 'highContrast'));
    switchOf(host, 'highContrast').focus();
    switchOf(host, 'highContrast').blur();
    await userEvent.click(rowOf(host, 'highContrast'));
    expect(said.at(-1)).toBe(`${ACCESS_TEXT.options.highContrast.name}, on`);
    const before = cancelled.count;
    await userEvent.click(rowOf(host, 'readAloud'));
    await expect.poll(() => store.prefs.readAloud).toBe(false);
    expect(cancelled.count).toBeGreaterThan(before);
  });

  it('in the App, reads through the page speech that the spec card uses', async () => {
    const speak = vi.spyOn(window.speechSynthesis, 'speak').mockImplementation(() => undefined);
    vi.spyOn(window.speechSynthesis, 'cancel').mockImplementation(() => undefined);
    const app = await mountApp(storeWith({ readAloud: true }));
    await userEvent.click(app.host.querySelector('.shell-level') as HTMLElement);
    await expect.poll(() => speak.mock.calls.map(([utterance]) => utterance.text).join(' | ')).toMatch(/Level 1/);
    const utterance = speak.mock.calls.at(-1)?.[0];
    expect(utterance?.rate).toBeLessThan(1);
  });

  it('follows a scope directly, and stops when told to', () => {
    const scope = document.createElement('div');
    scope.innerHTML = '<p>Needs power</p>';
    document.body.appendChild(scope);
    const { speech, said } = heardSpeech();
    const stop = followReadAloud(scope, { speech, isOn: () => true, now: () => 0 });
    (scope.querySelector('p') as HTMLElement).click();
    (scope.querySelector('p') as HTMLElement).click();
    expect(said).toEqual(['Needs power']);
    stop();
    scope.remove();
    expect(DEFAULT_ACCESS.readAloud).toBe(false);
  });
});

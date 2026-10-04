// The accessibility pass past the parental gate (task 7.5, R-6.4 PAR-3, R-5.7 Q6): axe-core checks the parent page
// (parent.html, the parent view from packages/parent on this device's store) against WCAG 2.2 A and AA, on the accounts
// with a child's build, progress and the data note, an open parts list, and a card of the card game with its name
// hidden and then shown, with every access option off and then all on; and the shared-build page a link opens. With
// the options on, the parent page shows that it follows them: its body and view carry the high-contrast theme, the
// dyslexia-friendly type and the left-handed layout.
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { loadContent } from '@servo/content';
import { loadFixtures } from '@servo/content/fixtures';
import { ACCESS_KEY } from '../../src/a11y/index.ts';
import { mountSharedPage, shareLinkOf } from '../../src/sharing/index.ts';
import type { SharedPageHandle } from '../../src/sharing/index.ts';
import { openStore } from '../../src/store/index.ts';
import type { ServoStore } from '../../src/store/index.ts';

const { content } = loadContent();
const roller = loadFixtures().fixtures.find((fixture) => fixture.name === 'level-1-roller')?.blueprint;
if (!roller) throw new Error('no level-1-roller fixture');

const SOON = { timeout: 30_000 };

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA: the brief's bar for everything that is not the canvas (Section 13). */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const lines = (result: axe.AxeResults): string[] =>
  result.violations.map(
    (violation) => `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.help}\n${violation.nodes.map((node) => `    ${node.target.join(' ')}: ${node.failureSummary ?? ''}`).join('\n')}`,
  );

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  localStorage.removeItem(ACCESS_KEY);
});

/**
 * A child on this device's own store, the one parent.html opens: Robin, in use, with the Level 1 roller as a build.
 * Removed again afterwards, with everything kept for them.
 */
const seedRobin = async (): Promise<void> => {
  const store: ServoStore = await openStore();
  const robin = await store.profiles.create('Robin');
  await store.profiles.use(robin.id);
  const kept = await store.forProfile(robin.id).blueprints.copy(roller, 'Robin roller');
  if (!kept.ok) throw new Error('the roller was not kept');
  cleanups.push(async () => {
    await store.profiles.remove(robin.id);
    store.close();
  });
};

interface ParentFrame {
  readonly doc: Document;
  one<T extends HTMLElement = HTMLElement>(selector: string): T;
  button(name: string): HTMLButtonElement;
  audit(): Promise<string[]>;
}

const openParentPage = async (): Promise<ParentFrame> => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px; border: 0;';
  frame.src = '/parent.html';
  document.body.appendChild(frame);
  cleanups.push(() => frame.remove());
  await vi.waitFor(() => expect(frame.contentDocument?.querySelector('main[aria-labelledby="servo-parent-gate"] input')).not.toBeNull(), SOON);
  const doc = frame.contentDocument as Document;
  const view = frame.contentWindow as Window & { axe?: typeof axe };
  // axe checks the document it runs in, so its source goes into the parent page.
  const script = doc.createElement('script');
  script.textContent = axe.source;
  doc.head.appendChild(script);
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = doc.querySelector<T>(selector);
    if (!found) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  const button = (name: string): HTMLButtonElement => {
    const found = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((each) => (each.getAttribute('aria-label') ?? each.textContent) === name);
    if (!found) throw new Error(`no button named ${name}`);
    return found;
  };
  const audit = async (): Promise<string[]> =>
    lines(await (view.axe as typeof axe).run(doc, { runOnly: { type: 'tag', values: WCAG_AA }, resultTypes: ['violations'] }));
  return { doc, one, button, audit };
};

/** The gate's sum answered by keyboard, then the view with every section loaded. */
const passGate = async (page: ParentFrame): Promise<void> => {
  const [, a, b] = /What is (\d+) × (\d+)\?/u.exec(page.one('main[aria-labelledby="servo-parent-gate"] label').textContent ?? '') ?? [];
  if (!a || !b) throw new Error('no question');
  page.one('main[aria-labelledby="servo-parent-gate"] input').focus();
  await userEvent.keyboard(`${Number(a) * Number(b)}{Enter}`);
  await vi.waitFor(() => {
    expect(page.doc.querySelector('#parent h1')?.textContent).toBe('Parent view');
    expect(page.doc.querySelector('.servo-progress h3')).not.toBeNull();
    expect(page.doc.querySelector('#servo-parent-data-note')).not.toBeNull();
    page.button('Parts list for Robin roller');
  }, SOON);
};

const THEMES = [
  { name: 'every option off', on: {} },
  { name: 'every option on', on: { highContrast: true, dyslexiaType: true, leftHanded: true, readAloud: true } },
] as const;

describe('WCAG 2.2 AA past the parental gate (axe-core)', () => {
  for (const theme of THEMES) {
    it(`finds no violation on the accounts, progress, the data note, a parts list and a card, with ${theme.name}`, async () => {
      localStorage.setItem(ACCESS_KEY, JSON.stringify(theme.on));
      await seedRobin();
      const page = await openParentPage();
      const found: string[] = [];
      const check = async (screen: string): Promise<void> => {
        found.push(...(await page.audit()).map((line) => `${screen}: ${line}`));
      };
      await check('gate');
      await passGate(page);
      await check('accounts, progress and the data note');

      page.button('Parts list for Robin roller').click();
      await vi.waitFor(() => page.one('section.servo-parts-list table tbody tr'), SOON);
      await check('parts list');

      page.button('Start a round').click();
      await vi.waitFor(() => page.one('section.servo-card-game [role="group"] h3'), SOON);
      await check('a card, its name hidden');
      page.button('Show the name').click();
      await vi.waitFor(() => expect(page.one('section.servo-card-game [role="group"] p[id]').hidden).toBe(false), SOON);
      await check('a card, its name shown');

      expect(found).toEqual([]);

      const on = 'highContrast' in theme.on;
      for (const element of [page.doc.body, page.one('#parent .servo-parent')]) {
        expect(element.dataset).toMatchObject(
          on ? { contrast: 'high', typeface: 'dyslexia-friendly', hand: 'left' } : { contrast: 'standard', typeface: 'standard', hand: 'right' },
        );
      }
      if (on) {
        const view = page.doc.defaultView as Window;
        expect(view.getComputedStyle(page.doc.body).backgroundColor).toBe('rgb(255, 255, 255)');
        expect(view.getComputedStyle(page.one('#parent h1')).fontFamily).toContain('OpenDyslexic');
      }
    });
  }
});

describe('WCAG 2.2 AA on the shared-build page (axe-core)', () => {
  it('finds no violation on a shared build, ready to run and running', async () => {
    const link = await shareLinkOf(roller, content.catalogue, { base: `${location.origin}/` });
    if (!link.ok) throw new Error('no link');
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; inset: 0';
    document.body.append(host);
    const handle: SharedPageHandle = await mountSharedPage(host, link.fragment, { reducedMotion: () => true });
    cleanups.push(() => {
      handle.destroy();
      host.remove();
    });
    await vi.waitFor(() => expect(host.querySelector('.share-bar [role="status"]')?.textContent).toBe('Ready to run.'), SOON);
    const audit = async () => lines(await axe.run(host, { runOnly: { type: 'tag', values: WCAG_AA }, resultTypes: ['violations'] }));
    const found = (await audit()).map((line) => `ready: ${line}`);
    const run = [...host.querySelectorAll<HTMLButtonElement>('.share-bar button')].find((each) => each.textContent === 'Run');
    if (!run) throw new Error('no Run');
    run.click();
    await vi.waitFor(() => expect(host.querySelector('.share-bar [role="status"]')?.textContent).not.toBe('Ready to run.'), SOON);
    found.push(...(await audit()).map((line) => `running: ${line}`));
    expect(found).toEqual([]);
  });
});

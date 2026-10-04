// Every interactive control in the parent view has a touch, a pointer and a keyboard test (ground rule 8, review R-6.4
// PAR-2), as task 7.4 does for the app. The walk opens each screen of the view (the gate, the accounts with their
// builds, the rename form, the removal confirm, an open parts list, the link field shown when the device will not copy,
// a card with its name hidden and then shown, the closing line, and a refused save) and lists everything a finger, a
// mouse or Tab can reach. Each must be one kind in controls.ts, every kind must turn up, real Tab presses must reach
// every control a keyboard can land on, and every kind must have its `threePaths` tests in a controls-*.test.tsx file.
// A new control fails here until it has all three.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { ServoStore } from '@servo/app/store';
import { CARD_GAME_TEXT } from '../../src/card-game/index.ts';
import { CONTROL_IDS, INTERACTIVE, controlsOf } from './controls.ts';
import type { ControlId } from './controls.ts';
import { SOON, finishRound, markAll, openGate, openParent, openPartsList, openRemove, openRename, showLinkField, startRound, unmountParents } from './harness.tsx';
import { keysOn, pointer, startOf, tabbable } from './input.ts';

afterEach(() => {
  unmountParents();
  vi.restoreAllMocks();
});

/** The `threePaths` calls in the controls-*.test.tsx files, by id. */
const sources = import.meta.glob<string>('./controls-*.test.tsx', { query: '?raw', import: 'default', eager: true });
const registered = (): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/threePaths(?:<[^>]*>)?\(\s*'([a-z0-9-]+)'/gu)) {
      const id = match[1] ?? '';
      found.set(id, [...(found.get(id) ?? []), file]);
    }
  }
  return found;
};

interface Seen {
  readonly ids: Set<ControlId>;
  readonly problems: string[];
}

/**
 * Everything interactive in `root` on one screen: each must be exactly one kind. Then real Tab presses from the
 * screen's first control: every control Tab can land on must be reached.
 */
const walk = async (screen: string, root: HTMLElement, seen: Seen): Promise<void> => {
  const elements = [...root.querySelectorAll(INTERACTIVE)];
  expect(elements.length, `${screen} shows no control`).toBeGreaterThan(0);
  for (const element of elements) {
    const ids = controlsOf(element);
    const what = `${screen}: ${element.outerHTML.slice(0, 160)}`;
    if (ids.length === 0) seen.problems.push(`no kind in controls.ts claims ${what}`);
    else if (ids.length > 1) seen.problems.push(`${ids.join(' and ')} both claim ${what}`);
    else if (ids[0] && tabbable(element)) seen.ids.add(ids[0]);
  }
  // Real Tab presses from the screen's first control. The walk stops once every control Tab can land on is reached:
  // a Tab past the last one leaves the test's frame, and the keys that follow would go elsewhere.
  // The walk starts where a hand would: a click on the view's title sets where Tab goes on from, then Tab. (Chrome
  // does not always Tab on from a control focused by script once Tab has been pressed elsewhere.)
  const order = elements.filter(tabbable);
  const start = startOf(root);
  const title = root.querySelector('h1');
  if (!title) throw new Error(`${screen} has no title`);
  await pointer(title, 0.05);
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement, `${screen}: Tab from the title onto its first control`).toBe(start);
  const reached = new Set<Element>([start]);
  for (let step = 0; step < 200 && order.some((element) => !reached.has(element)); step += 1) {
    await userEvent.keyboard('{Tab}');
    const active = document.activeElement;
    if (!active || !root.contains(active) || reached.has(active)) break;
    reached.add(active);
  }
  for (const element of elements) {
    if (tabbable(element) && !reached.has(element)) seen.problems.push(`Tab never reaches ${screen}: ${element.outerHTML.slice(0, 160)}`);
  }
};

const refusing = (store: ServoStore): void => {
  const scope = store.forProfile.bind(store);
  vi.spyOn(store, 'forProfile').mockImplementation((profile) => {
    const child = scope(profile);
    return { ...child, cardGames: { ...child.cardGames, add: () => Promise.reject(new Error('refused')) } };
  });
};

describe('every control in the parent view', () => {
  it('has a touch, a pointer and a keyboard test, on every screen', async () => {
    const seen: Seen = { ids: new Set(), problems: [] };

    const gate = await openGate();
    await walk('gate', gate.host, seen);
    unmountParents();

    // The accounts, the rename form, the removal confirm, the parts list and the link field.
    const page = await openParent();
    await walk('accounts', page.host, seen);
    const field = await openRename(page);
    await walk('rename', page.host, seen);
    await keysOn(field, '{Escape}');
    await vi.waitFor(() => expect(page.host.querySelector('input[id^="servo-parent-name-"]')).toBeNull(), SOON);
    await openRemove(page);
    await walk('removal confirm', page.host, seen);
    await keysOn(page.button('Keep profile'), '{Escape}');
    await vi.waitFor(() => expect(page.host.querySelector('[role="group"][aria-label^="Remove "]')).toBeNull(), SOON);
    await openPartsList(page);
    await walk('parts list', page.host, seen);
    await showLinkField(page);
    await walk('link field', page.host, seen);

    // The card game: a card with its name hidden, then shown, then the closing line.
    await startRound(page);
    await walk('card', page.host, seen);
    await keysOn(page.button(CARD_GAME_TEXT.showName));
    await vi.waitFor(() => page.button(CARD_GAME_TEXT.hideName), SOON);
    await walk('card with its name shown', page.host, seen);
    await keysOn(page.button(CARD_GAME_TEXT.stop));
    await finishRound(page);
    await walk('closing line', page.host, seen);
    unmountParents();

    // A round the store refuses.
    const refused = await openParent(refusing);
    await startRound(refused);
    await markAll(refused);
    await vi.waitFor(() => refused.button(CARD_GAME_TEXT.saveAgain), SOON);
    await walk('refused save', refused.host, seen);

    expect(seen.problems).toEqual([]);
    expect(CONTROL_IDS.filter((id) => !seen.ids.has(id)), 'kinds in controls.ts that no screen showed').toEqual([]);
    const tests = registered();
    expect(CONTROL_IDS.filter((id) => !tests.has(id)), 'controls with no threePaths test').toEqual([]);
    expect([...tests].filter(([, files]) => files.length > 1).map(([id]) => id), 'controls tested twice').toEqual([]);
    expect([...tests.keys()].filter((id) => !(CONTROL_IDS as string[]).includes(id)), 'threePaths ids that are not in controls.ts').toEqual([]);
  }, 600_000);
});

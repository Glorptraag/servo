// Every interactive control in the app has a touch, a pointer and a keyboard test (ground rule 8, review R-6.4
// APP-1 to APP-4). The walk opens each screen of the real app (Build with nothing selected, a part's spec card, the
// rename field, the places list, the Parts Library, Run, Home, a challenge with its hint button and a Level 2 card's
// setting, Settings, the parental gate and the invite form) and lists everything a finger, a mouse or Tab can reach.
// Each must be one kind in controls.ts, every kind must turn up, and every kind must have its `threePaths` tests in
// a controls-*.test.tsx file. A new control fails here until it has all three.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import { AccessStore } from '../../src/a11y/index.ts';
import { openThroughInviteGate } from '../../src/release/invite-gate.tsx';
import { SettingsView } from '../../src/release/settings.tsx';
import { SOON, mountApp, openChallenge, openHome, selectPart, startRun, stopRun, unmountApps } from './app-harness.tsx';
import { CONTROL_IDS, INTERACTIVE, NOT_THE_APPS, controlsOf } from './controls.ts';
import type { ControlId } from './controls.ts';
import { keysOn, startOf, tabOrder, tabbable } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));
afterAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [] }));
afterEach(unmountApps);

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
  /** Each screen's Tab order, as the kinds Tab lands on, one entry for a run of the same kind. */
  readonly orders: Record<string, string[]>;
}

const kindOf = (element: Element): string => (element.closest(NOT_THE_APPS) ? 'canvas list view' : (controlsOf(element)[0] ?? 'unknown'));

/**
 * Everything interactive under `root` on one screen: each must be exactly one kind. Then real Tab presses from the
 * screen's first control: every control Tab can land on must be reached, and the order is kept for the check below.
 */
const walk = async (screen: string, root: ParentNode, seen: Seen, tab = true): Promise<void> => {
  const elements = [...root.querySelectorAll(INTERACTIVE)].filter((element) => !element.closest(NOT_THE_APPS));
  expect(elements.length, `${screen} shows no control`).toBeGreaterThan(0);
  for (const element of elements) {
    const ids = controlsOf(element);
    const what = `${screen}: ${element.outerHTML.slice(0, 160)}`;
    if (ids.length === 0) seen.problems.push(`no kind in controls.ts claims ${what}`);
    else if (ids.length > 1) seen.problems.push(`${ids.join(' and ')} both claim ${what}`);
    else if (ids[0]) seen.ids.add(ids[0]);
  }
  if (!tab) return;
  const order = await tabOrder(startOf(root));
  const inside = order.slice(0, Math.max(1, order.findIndex((element) => !root.contains(element)) + 1 || order.length));
  const reached = new Set<Element>(inside);
  for (const element of root.querySelectorAll(INTERACTIVE)) {
    if (!element.closest(NOT_THE_APPS) && tabbable(element) && !reached.has(element)) seen.problems.push(`Tab never reaches ${screen}: ${element.outerHTML.slice(0, 160)}`);
  }
  seen.orders[screen] = inside.map(kindOf).filter((kind, index, kinds) => kind !== kinds[index - 1]);
};

const frameOf = async (src: string, ready: (doc: Document) => boolean): Promise<HTMLIFrameElement> => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px; border: 0;';
  frame.src = src;
  document.body.appendChild(frame);
  await vi.waitFor(() => expect(frame.contentDocument && ready(frame.contentDocument)).toBe(true), SOON);
  return frame;
};

const HEADER = ['home', 'blueprint-name', 'sound', 'save', 'edge-tab'];
const TRAY = ['library', 'tray-tile', 'edge-tab'];
const STAGE = ['canvas list view', 'arena-preset', 'arena-prop', 'edge-tab'];
const CHROME = ['run-toggle', 'slower', 'zoom-in', 'fit', 'tidy-wires', 'zoom-out'];

/**
 * Each screen's Tab order (R-7.4 F2), as the kinds Tab lands on, one entry for a run of the same kind: the header,
 * the tray, the canvas's list view and the arena strip, the Run bar, the zoom control, then the spec card. Disabled
 * controls (Undo, Reset arena, Faster at full speed) take no Tab. In Run mode the tray and the arena strip rest and
 * the build's name cannot be renamed.
 */
const TAB_ORDERS: Record<string, string[]> = {
  Build: [...HEADER, ...TRAY, ...STAGE, ...CHROME],
  'spec card': [...HEADER, ...TRAY, ...STAGE, ...CHROME, 'edge-tab', 'read-aloud'],
  'places list': ['places-choice', 'places-close'],
  'Parts Library': ['library-close', 'library-filter'],
  Run: ['home', 'sound', 'save', 'edge-tab', 'canvas list view', 'edge-tab', ...CHROME, 'edge-tab', 'read-aloud'],
  Home: ['home-back', 'home-new-build', 'home-saved-build', 'home-challenge', 'access-switch', 'for-adults'],
  challenge: ['home', 'hint-button', ...HEADER.slice(1), ...TRAY, ...STAGE, ...CHROME, 'edge-tab', 'read-aloud', 'card-choice'],
  Settings: ['access-switch'],
  'parental gate': ['parent-back', 'gate-answer', 'gate-continue'],
  'invite form': ['invite-code', 'invite-submit'],
};

describe('every control in the app', () => {
  it('has a touch, a pointer and a keyboard test, on every screen', async () => {
    const seen: Seen = { ids: new Set(), problems: [], orders: {} };

    // Build, then a part's spec card, the rename field, the places list and the Parts Library.
    const app = await mountApp();
    await walk('Build', app.host, seen);
    await selectPart(app);
    await walk('spec card', app.host, seen);
    await keysOn(app.one('button.shell-blueprint-name'));
    const field = await vi.waitFor(() => app.one<HTMLInputElement>('input.shell-blueprint-name-input'), SOON);
    await walk('rename', app.host, seen, false);
    field.focus();
    await userEvent.keyboard('{Escape}');
    await keysOn(app.one('[data-region="tray"] button.tray-tile'));
    const places = await vi.waitFor(() => app.one('dialog.tray-places'), SOON);
    await walk('places list', places, seen);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(app.host.querySelector('dialog.tray-places')).toBeNull(), SOON);
    await keysOn(app.one('button.tray-library'));
    const library = await vi.waitFor(() => app.one('dialog.library'), SOON);
    await walk('Parts Library', library, seen);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(app.host.querySelector('dialog.library')).toBeNull(), SOON);

    // Run.
    await startRun(app);
    await walk('Run', app.host, seen);
    await stopRun(app);

    // Home, then a Level 2 challenge: its hint button, and a card with a setting.
    await walk('Home', await openHome(app), seen);
    await openChallenge(app, 'Meet the motor driver');
    await vi.waitFor(() => app.one('button.hint-button'), SOON);
    await selectPart(app);
    expect(app.host.querySelector('.spec-card-setting input'), 'a Level 2 card with a setting').not.toBeNull();
    await walk('challenge', app.host, seen);
    unmountApps();

    // Settings.
    const settings = document.createElement('div');
    document.body.appendChild(settings);
    const root = createRoot(settings);
    root.render(<SettingsView info={{ appVersion: '0.1.0', contentVersion: '0.1.0+abc', inviteHashes: [] }} access={new AccessStore(null)} />);
    await vi.waitFor(() => expect(settings.querySelector('[data-region="access"]')).not.toBeNull(), SOON);
    await walk('Settings', settings, seen);
    root.unmount();
    settings.remove();

    // The parental gate, on the parent page.
    const parent = await frameOf('/parent.html', (doc) => doc.querySelector('main[aria-labelledby="servo-parent-gate"] input') !== null);
    await walk('parental gate', parent.contentDocument as Document, seen);
    parent.remove();

    // The invite form.
    const invite = document.createElement('div');
    document.body.appendChild(invite);
    void openThroughInviteGate(invite, ['0'.repeat(64)], () => undefined);
    await vi.waitFor(() => expect(invite.querySelector('form input')).not.toBeNull(), SOON);
    await walk('invite form', invite, seen);
    invite.remove();

    expect(seen.problems).toEqual([]);
    expect(seen.orders).toEqual(TAB_ORDERS);
    expect(CONTROL_IDS.filter((id) => !seen.ids.has(id)), 'kinds in controls.ts that no screen showed').toEqual([]);
    const tests = registered();
    expect(CONTROL_IDS.filter((id) => !tests.has(id)), 'controls with no threePaths test').toEqual([]);
    expect([...tests].filter(([, files]) => files.length > 1).map(([id]) => id), 'controls tested twice').toEqual([]);
    expect([...tests.keys()].filter((id) => !(CONTROL_IDS as string[]).includes(id)), 'threePaths ids that are not in controls.ts').toEqual([]);
  });
});

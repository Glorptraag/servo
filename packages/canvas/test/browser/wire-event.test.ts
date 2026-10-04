// The handle's `wire` event (task 7.8, R-6.4 APP-7): a wire on its way is reported on all three paths, by drag, by
// tap-then-tap and from the list view, with where it starts and every socket it can go to, and cleared when it lands
// or is let go. The app's spec card steps aside on it. Real input through CDP, in the iPad profile.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import type { Blueprint, PortRef } from '@servo/schema';
import type { WireEvent, WirePath } from '../../src/interface.ts';
import { blueprintOf } from '../helpers/catalogue.ts';
import { listen, reset, unmountAll } from './helpers.ts';
import { clientOf, mountWorkbench } from './placing.ts';
import type { Hand, Workbench } from './placing.ts';
import { handsOf, homeOf } from './wiring-hands.ts';

const CANVAS = { width: 600, height: 420 };
// Five minutes: at load 200–350 with many agents running, mounting has run past two (review: list-view hook timeout).
const MOUNT_MS = 300_000;
const LONG_MS = 360_000;
/** Empty workbench below both parts. */
const EMPTY = { x: 0, y: 70 };
const FROM: PortRef = { part: 'battery', port: 'plus' };
const TO: PortRef = { part: 'motor', port: 'plus' };
const OTHER: PortRef = { part: 'battery', port: 'minus' };
const CONNECT = { kind: 'connect', from: FROM, to: TO } as const;

let bench: Workbench;

beforeAll(async () => {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  bench = await mountWorkbench(CANVAS);
}, MOUNT_MS);

beforeEach(() => {
  reset(bench.surface);
  const build: Blueprint = blueprintOf({
    parts: [
      { id: 'battery', part: 'battery-pack-2-cell', position: { x: -80, y: 0 }, rotation: 0, settings: {} },
      { id: 'motor', part: 'dc-motor', position: { x: 80, y: 0 }, rotation: 0, settings: {} },
    ],
    wires: [],
  });
  const loaded = bench.surface.load(build);
  if (!loaded.ok) throw new Error(loaded.issues.map((issue) => issue.code).join());
  Object.assign(bench.surface.camera, { centreX: 0, centreY: 0, zoom: 0.75 });
  bench.surface.requestFrame();
});

afterAll(async () => {
  bench.unmount();
  unmountAll();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const socket = (ref: PortRef) => clientOf(bench.surface, homeOf(bench.surface, `${ref.part}.${ref.port}`));
const paths = (events: readonly WireEvent[]): (WirePath | null)[] => events.map((event) => event.wire?.path ?? null);
const started = (events: readonly WireEvent[], path: WirePath): void => {
  const wire = events.at(-1)?.wire;
  expect(wire?.path).toBe(path);
  expect(wire?.from).toEqual(FROM);
  expect(wire?.towards).toContainEqual(TO);
  expect(wire?.towards).not.toContainEqual(FROM);
};
const list = (): HTMLElement => bench.surface.listDom.element;
/** Focus on a list-view button, then Enter, as a keyboard does. */
const enter = async (key: string): Promise<void> => {
  const button = list().querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!button) throw new Error(`no ${key} in the list view`);
  button.focus();
  await userEvent.keyboard('{Enter}');
};

describe('the wire event', () => {
  it.each<Hand>(['touch', 'mouse'])('follows a wire drawn by %s drag, and clears as it lands or springs back', async (hand) => {
    const hands = handsOf();
    const wires = listen(bench.surface, 'wire');
    const edits = listen(bench.surface, 'edit');
    await hands.press(hand, socket(FROM), [socket(TO)]);
    started(wires, 'drag');
    await hands.lift(hand, socket(TO));
    await vi.waitFor(() => expect(edits.map((edit) => edit.command)).toEqual([CONNECT]));
    expect(paths(wires)).toEqual(['drag', null]);

    // Let go on the empty workbench, the wire springs back and is gone.
    wires.splice(0);
    await hands.press(hand, socket(OTHER), [clientOf(bench.surface, EMPTY)]);
    expect(wires.at(-1)?.wire?.from).toEqual(OTHER);
    await hands.lift(hand, clientOf(bench.surface, EMPTY));
    expect(paths(wires)).toEqual(['drag', null]);
  }, LONG_MS);

  it.each<Hand>(['touch', 'mouse'])('follows a wire made by %s tap-then-tap, and clears as it lands or is let go', async (hand) => {
    const hands = handsOf();
    const wires = listen(bench.surface, 'wire');
    const edits = listen(bench.surface, 'edit');
    await hands.tap(hand, socket(FROM));
    await vi.waitFor(() => started(wires, 'tap'));
    await hands.tap(hand, socket(TO));
    await vi.waitFor(() => expect(edits.map((edit) => edit.command)).toEqual([CONNECT]));
    expect(paths(wires)).toEqual(['tap', null]);

    // A tap on the empty workbench lets the waiting wire go.
    wires.splice(0);
    await hands.tap(hand, socket(OTHER));
    await vi.waitFor(() => expect(wires.at(-1)?.wire?.from).toEqual(OTHER));
    await hands.tap(hand, clientOf(bench.surface, EMPTY));
    await vi.waitFor(() => expect(paths(wires)).toEqual(['tap', null]));
  }, LONG_MS);

  it('follows a wire begun from a port’s actions in the list view, and clears as it lands, closes or hides', async () => {
    const wires = listen(bench.surface, 'wire');
    const edits = listen(bench.surface, 'edit');
    const port = `port:${FROM.part}.${FROM.port}`;
    await enter(`toggle:${port}`);
    await vi.waitFor(() => started(wires, 'list'));
    await enter(`action:connect:${FROM.part}.${FROM.port}:${TO.part}.${TO.port}`);
    await vi.waitFor(() => expect(edits.map((edit) => edit.command)).toEqual([CONNECT]));
    expect(paths(wires)).toEqual(['list', null]);

    // Done with by the action: the port's actions stay open and begin nothing more until opened again.
    wires.splice(0);
    await enter(`toggle:${port}`);
    expect(wires).toEqual([]);
    // Opened and closed again by its own button, then opened and hidden by Escape.
    await enter(`toggle:${port}`);
    await vi.waitFor(() => expect(paths(wires)).toEqual(['list']));
    await enter(`toggle:${port}`);
    expect(paths(wires)).toEqual(['list', null]);
    await enter(`toggle:${port}`);
    await vi.waitFor(() => expect(paths(wires)).toEqual(['list', null, 'list']));
    await userEvent.keyboard('{Escape}');
    expect(paths(wires)).toEqual(['list', null, 'list', null]);

    // A part's actions begin no wire.
    wires.splice(0);
    await enter('toggle:part:battery');
    expect(wires).toEqual([]);
    await userEvent.keyboard('{Escape}');
  }, LONG_MS);

  it('clears when Run begins', async () => {
    const hands = handsOf();
    const wires = listen(bench.surface, 'wire');
    await hands.tap('touch', socket(FROM));
    await vi.waitFor(() => started(wires, 'tap'));
    bench.surface.setMode('run');
    expect(paths(wires)).toEqual(['tap', null]);
    bench.surface.setMode('build');
  }, LONG_MS);
});

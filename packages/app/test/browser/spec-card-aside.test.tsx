// Task 7.8 (R-6.4 APP-7, rule 8): the spec card steps aside for a wire on every path. On the real shell and the real
// canvas at 1180 × 820, a wire is made to a socket lying under the open spec card by drag (touch and mouse), by
// tap-then-tap (touch and mouse) and from the list view by keyboard. Each time the card steps aside while the wire is
// on its way, the wire lands on the socket the card covered, and the card comes back afterwards.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle, WireEvent } from '@servo/canvas';
import { probeCanvas } from '@servo/canvas/testing';
import type { CanvasProbe } from '@servo/canvas/testing';
import type { Blueprint, PortRef } from '@servo/schema';
import { Shell, useShell } from '../../src/shell/index.ts';
import type { CanvasSetup } from '../../src/shell/index.ts';
import { SpecCard } from '../../src/spec-card/index.ts';
import { SOON, content, fixture } from './app-harness.tsx';
import { pageOf, tick } from './input.ts';
import type { Point } from './input.ts';

beforeAll(() => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }));

const roots: { root: Root; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    root.unmount();
    host.remove();
  }
});

/** Shows whether the shell holds the card aside, for the test to read. */
const AsideMark = () => {
  const { specCardAside } = useShell();
  return <span className="aside-mark" data-aside={String(specCardAside)} hidden />;
};

interface Bench {
  readonly host: HTMLElement;
  readonly canvas: CanvasHandle;
  readonly probe: CanvasProbe;
  /** The wire to make: `from` clear of the card, `to` under it. */
  readonly from: PortRef;
  readonly to: PortRef;
  readonly wires: WireEvent[];
}

const card = (bench: { readonly host: HTMLElement }): HTMLElement => bench.host.querySelector<HTMLElement>('[data-region="specCard"]') as HTMLElement;
const aside = (bench: Bench): string | undefined => bench.host.querySelector<HTMLElement>('.aside-mark')?.dataset.aside;
const keyOf = (ref: PortRef): string => `${ref.part}.${ref.port}`;
const inside = (box: DOMRect, at: Point): boolean => at.x > box.left && at.x < box.right && at.y > box.top && at.y < box.bottom;

/**
 * The Level 1 roller with one of its lines taken out, a part selected so its card is open, and the view set so that
 * one end of the missing line lies under the card and the other well clear of it.
 */
const mountBench = async (): Promise<Bench> => {
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  let handle: CanvasHandle | undefined;
  const draw = (into: HTMLElement, setup: CanvasSetup): CanvasHandle => {
    handle = mountCanvas(into, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level: setup.level, prefs: setup.prefs });
    return handle;
  };
  const start: Blueprint = fixture('level-1-roller');
  const slots = {
    specCard: (
      <>
        <SpecCard speech={null} />
        <AsideMark />
      </>
    ),
  };
  await new Promise<void>((ready) => root.render(<Shell content={content} level={1} storage={null} start={start} slots={slots} mountCanvas={draw} onReady={ready} />));
  const canvas = await vi.waitFor(() => {
    if (!handle?.blueprint) throw new Error('the canvas has no build yet');
    return handle;
  }, SOON);
  const probe = probeCanvas(canvas);
  await probe.ready;
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('.shell-zoom button')?.disabled).toBe(false), SOON);

  // The power or signal line whose ends lie furthest apart across the canvas, taken out.
  const build = canvas.blueprint as Blueprint;
  const lines = build.wires.filter((wire) => {
    const kind = content.catalogue.parts.get(build.parts.find((part) => part.id === wire.from.part)?.part ?? '')?.ports.find((port) => port.id === wire.from.port)?.type;
    return kind === 'power' || kind === 'signal';
  });
  const spread = (wire: (typeof lines)[number]): number => Math.abs((probe.socket(wire.from)?.at.world.x ?? 0) - (probe.socket(wire.to)?.at.world.x ?? 0));
  const line = [...lines].sort((a, b) => spread(b) - spread(a))[0];
  if (!line) throw new Error('the roller has no line');
  expect(canvas.apply({ kind: 'disconnect', wireId: line.id }).ok).toBe(true);
  const [from, to] = (probe.socket(line.from)?.at.world.x ?? 0) < (probe.socket(line.to)?.at.world.x ?? 0) ? [line.from, line.to] : [line.to, line.from];

  // A part selected: the card slides in.
  flushSync(() => canvas.select({ kind: 'part', partId: build.parts[0]?.id ?? '' }));
  await vi.waitFor(() => expect(card({ host }).dataset.shown).toBe('true'), SOON);
  await vi.waitFor(() => expect(card({ host }).querySelector('.spec-card')).not.toBeNull(), SOON);
  await tick(400);

  // The view: the ends 200 px apart, `to` under the card and `from` on the canvas where nothing covers it.
  const toWorld = (probe.socket(to) as NonNullable<ReturnType<CanvasProbe['socket']>>).at.world;
  const fromWorld = (probe.socket(from) as NonNullable<ReturnType<CanvasProbe['socket']>>).at.world;
  probe.setView(toWorld, 1);
  const apart = Math.hypot(probe.pageOf(toWorld).x - probe.pageOf(fromWorld).x, probe.pageOf(toWorld).y - probe.pageOf(fromWorld).y);
  const zoom = 200 / apart;
  probe.setView(toWorld, zoom);
  const box = card({ host }).getBoundingClientRect();
  const uncovered = (at: Point): boolean => document.elementFromPoint(at.x, at.y) === probe.canvas;
  let placed = false;
  for (let fy = 0.2; fy <= 0.8 && !placed; fy += 0.1) {
    for (let fx = 0.1; fx <= 0.5 && !placed; fx += 0.1) {
      const aim = { x: box.left + box.width * fx, y: box.top + box.height * fy };
      const there = probe.worldOf(aim);
      const centre = { x: probe.view.centre.x + toWorld.x - there.x, y: probe.view.centre.y + toWorld.y - there.y };
      probe.setView(centre, zoom);
      placed = inside(box, probe.pageOf(toWorld)) && uncovered(probe.pageOf(fromWorld));
    }
  }
  probe.requestFrame();
  await tick(100);
  expect(inside(box, probe.pageOf(toWorld)), `${keyOf(to)} under the card`).toBe(true);
  expect(uncovered(probe.pageOf(fromWorld)), `${keyOf(from)} on the canvas, uncovered`).toBe(true);

  const wires: WireEvent[] = [];
  canvas.on('wire', (event) => wires.push(event));
  return { host, canvas, probe, from, to, wires };
};

/** Where a socket takes a press now, on the browser's page. */
const socketPoint = (bench: Bench, ref: PortRef): Point => {
  const place = bench.probe.socket(ref);
  if (!place) throw new Error(`no socket ${keyOf(ref)}`);
  return pageOf(window, place.press.page);
};

type Hand = 'touch' | 'mouse';

const send = async (hand: Hand, phase: 'down' | 'move' | 'up', at: Point): Promise<void> => {
  if (hand === 'mouse') {
    const type = phase === 'down' ? 'mousePressed' : phase === 'up' ? 'mouseReleased' : 'mouseMoved';
    await cdp().send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', buttons: phase === 'up' ? 0 : 1, clickCount: phase === 'move' ? 0 : 1 });
    return;
  }
  const type = phase === 'down' ? 'touchStart' : phase === 'up' ? 'touchEnd' : 'touchMove';
  await cdp().send('Input.dispatchTouchEvent', { type, touchPoints: phase === 'up' ? [] : [{ x: at.x, y: at.y, id: 1 }] });
};

const lerp = (a: Point, b: Point, k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

const connected = (bench: Bench): boolean =>
  bench.canvas.blueprint?.wires.some((wire) => [keyOf(wire.from), keyOf(wire.to)].sort().join() === [keyOf(bench.from), keyOf(bench.to)].sort().join()) ?? false;

/** The card is out of the way: held aside, and its panel not shown. */
const steppedAside = async (bench: Bench): Promise<void> => {
  await vi.waitFor(() => expect(aside(bench)).toBe('true'), SOON);
  await vi.waitFor(() => expect(card(bench).dataset.shown).toBe('false'), SOON);
};

/** The card is back: no longer held aside, and shown again with a part selected. */
const back = async (bench: Bench): Promise<void> => {
  await vi.waitFor(() => expect(aside(bench)).toBe('false'), SOON);
  // Pressing a socket on the canvas clears the part selection (task 3.4); a part selected again shows the card.
  if (bench.canvas.selection?.kind !== 'part') flushSync(() => bench.canvas.select({ kind: 'part', partId: bench.canvas.blueprint?.parts[0]?.id ?? '' }));
  await vi.waitFor(() => expect(card(bench).dataset.shown).toBe('true'), SOON);
};

describe('the spec card steps aside on every wiring path', () => {
  it.each<Hand>(['touch', 'mouse'])('by %s drag', async (hand) => {
    const bench = await mountBench();
    const start = socketPoint(bench, bench.from);
    const end = socketPoint(bench, bench.to);
    await send(hand, 'down', start);
    for (const k of [0.25, 0.5, 0.75, 1]) await send(hand, 'move', lerp(start, end, k));
    await steppedAside(bench);
    expect(bench.wires.at(-1)?.wire?.path).toBe('drag');
    expect(bench.wires.at(-1)?.wire?.towards.map(keyOf)).toContain(keyOf(bench.to));
    // The card is out of the way, so the wire's end reaches the socket it covered.
    await send(hand, 'move', socketPoint(bench, bench.to));
    await send(hand, 'up', socketPoint(bench, bench.to));
    await vi.waitFor(() => expect(connected(bench)).toBe(true), SOON);
    expect(bench.wires.at(-1)?.wire).toBeNull();
    await back(bench);
  });

  it.each<Hand>(['touch', 'mouse'])('by %s tap-then-tap', async (hand) => {
    const bench = await mountBench();
    const start = socketPoint(bench, bench.from);
    await send(hand, 'down', start);
    await send(hand, 'up', start);
    await steppedAside(bench);
    expect(bench.wires.at(-1)?.wire).toMatchObject({ path: 'tap', from: bench.from });
    // The second tap, where the card was: it reaches the socket.
    await tick(100);
    const local = bench.probe.socket(bench.to)?.press.page ?? { x: -1, y: -1 };
    expect(document.elementFromPoint(local.x, local.y)).toBe(bench.probe.canvas);
    const end = socketPoint(bench, bench.to);
    await send(hand, 'down', end);
    await send(hand, 'up', end);
    await vi.waitFor(() => expect(connected(bench)).toBe(true), SOON);
    expect(bench.wires.at(-1)?.wire).toBeNull();
    await back(bench);
  });

  it('from the list view, by keyboard', async () => {
    const bench = await mountBench();
    const list = bench.host.querySelector<HTMLElement>('.servo-list-view') as HTMLElement;
    const button = (key: string): HTMLButtonElement => {
      const found = list.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(key)}"]`);
      if (!found) throw new Error(`no ${key} in the list view`);
      return found;
    };
    const press = async (key: string): Promise<void> => {
      await vi.waitFor(() => {
        button(key).focus();
        expect(document.activeElement).toBe(button(key));
      }, SOON);
      await userEvent.keyboard('{Enter}');
    };
    const from = keyOf(bench.from);
    await press(`toggle:port:${from}`);
    await steppedAside(bench);
    expect(bench.wires.at(-1)?.wire).toMatchObject({ path: 'list', from: bench.from });
    expect(bench.wires.at(-1)?.wire?.towards.map(keyOf)).toContain(keyOf(bench.to));
    await press(`action:connect:${from}:${keyOf(bench.to)}`);
    await vi.waitFor(() => expect(connected(bench)).toBe(true), SOON);
    expect(bench.wires.at(-1)?.wire).toBeNull();
    // The list view keeps the selection: the card comes back by itself.
    expect(bench.canvas.selection?.kind).toBe('part');
    await back(bench);
  });
});

// The hint ladder (task 4.6) in Chromium: the shell with the real canvas, content, sim-core, run loop and a store in
// IndexedDB, the goal line and the hint button beside it. Each tap draws the next rung on the canvas (pulse the part,
// pulse the port, ghost wire), by pointer, touch and keyboard alike, with every socket's middle looking as it did
// before the rung (a rung never covers a port), the list view reading the rung and the button's status saying its
// line; do-it lands a real wire through the canvas's command layer, one Undo step, a valid build. Two Runs that miss
// the goal offer the first rung and pulse the button. No dialog anywhere (ground rule 9). Reduced motion throughout,
// so a rung holds still for the screenshots.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { mountCanvas } from '@servo/canvas';
import type { CanvasHandle } from '@servo/canvas';
import { probeCanvas } from '@servo/canvas/testing';
import { loadContent } from '@servo/content';
import { validateBlueprint } from '@servo/schema';
import type { Blueprint, Challenge } from '@servo/schema';
import { GoalLine } from '../../src/challenges/index.ts';
import { HINT_TEXT, HintButton, HintLog } from '../../src/hints/index.ts';
import { RunBar, SPIN_UP_MS } from '../../src/run-bar/index.ts';
import type { RunClock, RunLoop } from '../../src/run-bar/index.ts';
import { PLACEHOLDER_SLOTS, Shell, useShell } from '../../src/shell/index.ts';
import type { CanvasSetup, ShellApi } from '../../src/shell/index.ts';
import { openStore } from '../../src/store/index.ts';
import type { ProfileStore, ServoStore } from '../../src/store/index.ts';
import { example } from '../hints/support.ts';

const { content } = loadContent();
const MEET = example('meet-the-switch');

class TestClock implements RunClock {
  time = 0;
  private waiting: (() => void) | undefined;
  now(): number {
    return this.time;
  }
  frame(callback: () => void): () => void {
    this.waiting = callback;
    return () => {
      if (this.waiting === callback) this.waiting = undefined;
    };
  }
  advance(ms: number): void {
    this.time += ms;
    const callback = this.waiting;
    this.waiting = undefined;
    flushSync(() => callback?.());
  }
}

const reduceMotion = async (on: boolean): Promise<void> => {
  await cdp().send('Emulation.setEmulatedMedia', { features: on ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] });
};

beforeAll(() => reduceMotion(true));
afterAll(() => reduceMotion(false));

const opened: { root: Root; host: HTMLElement; store: ServoStore }[] = [];

afterEach(() => {
  for (const { root, host, store } of opened.splice(0)) {
    root.unmount();
    host.remove();
    store.close();
  }
  vi.restoreAllMocks();
});

interface Mounted {
  readonly host: HTMLElement;
  readonly shell: () => ShellApi;
  readonly canvas: () => CanvasHandle;
  readonly loop: () => RunLoop;
  readonly clock: TestClock;
  readonly child: ProfileStore;
  readonly log: HintLog;
}

const mount = async (challenge: Challenge): Promise<Mounted> => {
  const store = await openStore({ name: `servo-hints-${crypto.randomUUID()}` });
  const profile = await store.profiles.create('Builder 1');
  const child = store.forProfile(profile.id);
  const copied = await child.blueprints.copy(challenge.start as Blueprint, 'Build 1');
  if (!copied.ok) throw new Error('the start did not copy');
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1180px; height: 820px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  opened.push({ root, host, store });
  const clock = new TestClock();
  const log = new HintLog();
  let shell: ShellApi | null = null;
  let loop: RunLoop | null = null;
  const Goal = ({ loopNow }: { readonly loopNow: RunLoop | null }) => {
    shell = useShell();
    return <GoalLine challenge={challenge} loop={loopNow} />;
  };
  const draw = (into: HTMLElement, setup: CanvasSetup): CanvasHandle =>
    mountCanvas(into, { catalogue: content.catalogue, resolveArt: (key) => content.art.get(key), level: setup.level, prefs: setup.prefs });
  const App = () => {
    // The loop as React state, so the goal line and the hint button hear it once the Run bar hands it out.
    const [made, setMade] = useState<RunLoop | null>(null);
    return (
      <Shell
        content={content}
        level={challenge.level}
        storage={null}
        child={child}
        start={copied.blueprint}
        mountCanvas={draw}
        onReady={readyOnce}
        slots={{
          ...PLACEHOLDER_SLOTS,
          goal: <Goal loopNow={made} />,
          hints: <HintButton challenge={challenge} loop={made} log={log} />,
          runBar: (
            <RunBar
              clock={clock}
              seed={() => 7}
              challenge={challenge}
              hints={log}
              onLoop={(next) => {
                loop = next ?? loop;
                setMade(next);
              }}
            />
          ),
        }}
      />
    );
  };
  let readyOnce: () => void = () => undefined;
  await new Promise<void>((ready) => {
    readyOnce = ready;
    root.render(<App />);
  });
  await vi.waitFor(() => expect(loop).not.toBeNull(), { timeout: 30_000 });
  const need = <T,>(value: T | null, what: string): T => {
    if (value === null) throw new Error(`no ${what}`);
    return value;
  };
  return {
    host,
    shell: () => need(shell, 'shell'),
    canvas: () => need(need(shell, 'shell').canvas, 'canvas'),
    loop: () => need(loop, 'loop'),
    clock,
    child,
    log,
  };
};

const hintButton = (app: Mounted): HTMLButtonElement => {
  const found = app.host.querySelector<HTMLButtonElement>('[data-region="header"] .hint-button');
  if (!found) throw new Error('no hint button');
  return found;
};
const spoken = (app: Mounted): string => app.host.querySelector('[data-region="header"] .hint-spoken')?.textContent ?? '';

type Rgb = readonly [number, number, number];
interface Shot {
  at(point: { readonly x: number; readonly y: number }): Rgb;
}
const distance = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** A real screenshot of the test page from the compositor, once the canvas has drawn its final picture. */
const shoot = async (app: Mounted): Promise<Shot> => {
  const probe = probeCanvas(app.canvas());
  await probe.ready;
  probe.requestFrame();
  await vi.waitFor(() => expect(probe.settled).toBe(true), { timeout: 10_000 });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const outer = window.frameElement?.getBoundingClientRect();
  const clip = { x: outer?.left ?? 0, y: outer?.top ?? 0, width: innerWidth, height: innerHeight, scale: 1 };
  const png = (await cdp().send('Page.captureScreenshot', { format: 'png', clip })) as { readonly data: string };
  const blob = await (await fetch(`data:image/png;base64,${png.data}`)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D context');
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const ratio = bitmap.width / innerWidth;
  return {
    at: ({ x, y }) => {
      const px = Math.min(bitmap.width - 1, Math.max(0, Math.floor(x * ratio)));
      const py = Math.min(bitmap.height - 1, Math.max(0, Math.floor(y * ratio)));
      const index = (py * bitmap.width + px) * 4;
      return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
    },
  };
};

/** Where every socket on the canvas is drawn, on the page. */
const sockets = (app: Mounted): { readonly key: string; readonly at: { x: number; y: number } }[] => {
  const probe = probeCanvas(app.canvas());
  const build = app.canvas().blueprint as Blueprint;
  return build.parts.flatMap((part) =>
    (content.catalogue.parts.get(part.part)?.ports ?? []).flatMap((port) => {
      const place = probe.socket({ part: part.id, port: port.id });
      return place ? [{ key: `${part.id}.${port.id}`, at: place.at.page }] : [];
    }),
  );
};

/** Every socket's middle looks as it did, and the rung drew something on the canvas. */
const clearOfPorts = (app: Mounted, before: Shot, after: Shot): void => {
  const all = sockets(app);
  expect(all.length).toBeGreaterThan(4);
  for (const { key, at } of all) expect(distance(before.at(at), after.at(at)), `the ${key} socket`).toBeLessThanOrEqual(24);
  const box = probeCanvas(app.canvas()).canvas.getBoundingClientRect();
  let changed = 0;
  for (let x = box.left + 4; x < box.right; x += 6) for (let y = box.top + 4; y < box.bottom; y += 6) if (distance(before.at({ x, y }), after.at({ x, y })) > 20) changed += 1;
  expect(changed, 'the rung drawn somewhere on the canvas').toBeGreaterThan(0);
};

const touch = async (element: HTMLElement): Promise<void> => {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const point = { x: (frame?.left ?? 0) + box.left + box.width / 2, y: (frame?.top ?? 0) + box.top + box.height / 2 };
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const runFor = async (app: Mounted, ticks: number): Promise<void> => {
  void app.loop().run();
  await expect.poll(() => app.loop().phase, { timeout: 30_000 }).toBe('spin-up');
  app.clock.advance(SPIN_UP_MS);
  for (let tick = 1; tick < ticks; tick += 1) app.clock.advance(1000 / 30);
  flushSync(() => app.loop().stop());
};

const SOON = { timeout: 10_000 };

describe('the hint ladder', () => {
  it('draws each rung clear of every port by pointer, touch and keyboard, then does it with one valid wire', async () => {
    const alerts = [vi.spyOn(window, 'alert'), vi.spyOn(window, 'confirm'), vi.spyOn(window, 'prompt')];
    const app = await mount(MEET);
    const button = hintButton(app);
    expect(button.textContent).toBe(HINT_TEXT.button);
    await vi.waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'), SOON);
    const start = app.canvas().blueprint as Blueprint;
    let before = await shoot(app);

    // Pointer: pulse the part.
    await userEvent.click(button);
    await vi.waitFor(() => expect(app.canvas().listView.hint?.step).toBe('pulse-part'), SOON);
    expect(spoken(app)).toBe('The switch goes in the power line');
    let after = await shoot(app);
    clearOfPorts(app, before, after);

    // Touch: pulse the port.
    await touch(button);
    await vi.waitFor(() => expect(app.canvas().listView.hint?.step).toBe('pulse-port'), SOON);
    expect(app.canvas().listView.hint?.line).toBe('Side A of the switch takes power from the battery pack');
    after = await shoot(app);
    clearOfPorts(app, before, after);

    // Keyboard: the ghost wire. Enter on the focused button (Space stays Run and Stop).
    button.focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(app.canvas().listView.hint?.step).toBe('ghost-wire'), SOON);
    expect(app.loop().phase).toBe('build');
    after = await shoot(app);
    clearOfPorts(app, before, after);
    expect(app.canvas().blueprint).toEqual(start);

    // Do it for me: one wire through the canvas's command layer, a valid build, said beside the button.
    await userEvent.click(button);
    await vi.waitFor(() => expect(app.canvas().blueprint?.wires.length).toBe(start.wires.length + 1), SOON);
    const done = app.canvas().blueprint as Blueprint;
    expect(validateBlueprint(done, content.catalogue).ok).toBe(true);
    expect(done.wires.some((wire) => [wire.from, wire.to].some((end) => end.part === 'switch' && end.port === 'a') && [wire.from, wire.to].some((end) => end.part === 'battery' && end.port === 'plus'))).toBe(true);
    expect(app.canvas().listView.hint).toBeUndefined();
    expect(app.shell().blueprint).toEqual(done);
    await vi.waitFor(() => expect(app.host.querySelector('.hint-said')?.textContent).toBe("Wired the battery pack's plus to side A"), SOON);
    expect(spoken(app)).toBe("Wired the battery pack's plus to side A");
    // The new wire is drawn, and its sockets are where the probe finds them.
    expect(probeCanvas(app.canvas()).socket({ part: 'switch', port: 'a' })).toBeDefined();

    // The next ladder: side B's port, clear of every port too.
    before = await shoot(app);
    await userEvent.click(button);
    await vi.waitFor(() => expect(app.canvas().listView.hint?.step).toBe('pulse-port'), SOON);
    after = await shoot(app);
    clearOfPorts(app, before, after);
    for (const alert of alerts) expect(alert).not.toHaveBeenCalled();
  });

  it('offers the first rung and pulses the button after two Runs that miss the goal, and the next Run keeps the hints used', async () => {
    const app = await mount(MEET);
    const button = hintButton(app);
    await runFor(app, 12);
    expect(app.canvas().listView.hint).toBeUndefined();
    expect(button.dataset.offered).toBe('false');
    await runFor(app, 12);
    await vi.waitFor(() => expect(app.canvas().listView.hint?.step).toBe('pulse-part'), SOON);
    await vi.waitFor(() => expect(hintButton(app).dataset.offered).toBe('true'), SOON);
    expect(app.canvas().blueprint?.wires.length).toBe((MEET.start as Blueprint).wires.length);
    // A tap goes on from the offer and stops the pulse.
    await userEvent.click(hintButton(app));
    await vi.waitFor(() => expect(app.canvas().listView.hint?.step).toBe('pulse-port'), SOON);
    expect(hintButton(app).dataset.offered).toBe('false');
    await runFor(app, 12);
    await vi.waitFor(async () => expect(await app.child.runs.list({ challenge: MEET.id })).toHaveLength(3), SOON);
    const runs = await app.child.runs.list({ challenge: MEET.id });
    expect(runs.map((run) => run.hints.map((use) => [use.step, use.trigger, use.partId]))).toEqual([
      [],
      [],
      [
        ['pulse-part', 'offered', 'switch'],
        ['pulse-port', 'asked', 'switch'],
      ],
    ]);
    expect(runs.every((run) => run.goal?.met === false)).toBe(true);
  });
});

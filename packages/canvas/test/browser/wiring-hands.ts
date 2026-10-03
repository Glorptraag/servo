// Shared by the wiring browser tests: a hand on the canvas, as a child's or a mouse's, with real input through the
// Chrome DevTools Protocol (trusted touch and mouse events), and drawing a wire by hand: touch a socket and drag to the
// other, or tap one and then the other. Where a socket sits in a crowd whose targets overlap, the hand first taps the
// crowd, which fans out, and then uses the socket where it went.
//
// Two guards keep these tests honest on a loaded machine. Every input waits until the page has handled it, so what the
// canvas shows is read after it changed. And a hand belongs to the test that took it (`handsOf()` at the start of the
// test): once that test has ended, by a timeout say, the hand sends nothing more, so it cannot press into the next
// test. Task 3.8 generalises this into the harness.
import { beforeEach, expect, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import type { PortRef, Vec2 } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { distance } from '../../src/scene/geometry.ts';
import { PORT_MM } from '../../src/scene/units.ts';
import { clientOf } from './placing.ts';
import type { Hand } from './placing.ts';

export const keyOf = (ref: PortRef): string => `${ref.part}.${ref.port}`;

/** Where the scene draws a socket, mm. */
export const homeOf = (surface: CanvasSurface, key: string): Vec2 => {
  const port = surface.scene.portByKey.get(key);
  if (!port) throw new Error(`no socket ${key} on the canvas`);
  return port.at;
};

/** Where a socket takes presses now: fanned out, or where the scene draws it, mm. */
export const placeOf = (surface: CanvasSurface, key: string): Vec2 => surface.wiring.fanned?.get(key) ?? homeOf(surface, key);

/** Whether a press on the socket's centre lands on more than one socket's target: its crowd fans out instead. */
export const crowdedAt = (surface: CanvasSurface, key: string): boolean => {
  const at = placeOf(surface, key);
  const members = new Set<string>();
  for (const part of surface.scene.parts) {
    for (const port of part.ports) {
      if (port.layer !== 'ports' || distance(port.at, at) > PORT_MM / 2) continue;
      members.add(surface.wiring.crowded.memberOf(port.key)?.key ?? port.key);
    }
  }
  return surface.wiring.fanned?.has(key) !== true && members.size > 1;
};

/** The test now running, counted from the start of the file. */
let running = 0;
beforeEach(() => {
  running += 1;
});

/** The last pointer event the page handled, by type and page position. */
let last: { readonly type: string; readonly x: number; readonly y: number } | undefined;
const track = (event: PointerEvent): void => {
  last = { type: event.type, x: event.clientX, y: event.clientY };
};
for (const type of ['pointerdown', 'pointermove', 'pointerup']) window.addEventListener(type, track as EventListener, true);

/**
 * Input sent through CDP can reach the page after the call returns, touch especially on a loaded machine. Before the
 * hand reads what the canvas shows, it waits until the page has handled the input it sent last.
 */
const handled = async (type: 'pointermove' | 'pointerup', at: Vec2): Promise<void> => {
  await vi.waitFor(
    () => {
      if (!last || last.type !== type || Math.abs(last.x - at.x) > 1 || Math.abs(last.y - at.y) > 1) throw new Error(`the page has not handled ${type} at ${at.x}, ${at.y}`);
    },
    { timeout: 30_000, interval: 10 },
  );
};

export interface Hands {
  /** A tap or a click at a page point. */
  tap(hand: Hand, at: Vec2): Promise<void>;
  /** Down at `from` and on through `through`, still pressed. */
  press(hand: Hand, from: Vec2, through: readonly Vec2[]): Promise<void>;
  /** A pressed finger or mouse moved on. */
  move(hand: Hand, at: Vec2): Promise<void>;
  /** Lifted at `at`, where it last moved to. */
  lift(hand: Hand, at: Vec2): Promise<void>;
  /** Down, `steps` moves and up. */
  drag(hand: Hand, from: Vec2, to: Vec2, steps?: number): Promise<void>;
  /**
   * Draws a wire from one socket to another: a drag (touch, drag, lift) or tap-then-tap. Where either socket sits in
   * a crowd, the crowd fans out first: by a tap on it for the source, and on the way, by the wire, for the other.
   * Returns once the wire has landed or been refused.
   */
  wire(surface: CanvasSurface, hand: Hand, how: 'drag' | 'tap', from: PortRef, to: PortRef): Promise<void>;
}

/** The hands of the test that calls this, at its start. Every input resolves once the page has handled it. */
export const handsOf = (): Hands => {
  const owner = running;
  const send = async (hand: Hand, phase: 'down' | 'move' | 'up', at: Vec2): Promise<void> => {
    if (owner !== running) throw new Error('the test these hands belong to has ended');
    const frame = window.frameElement?.getBoundingClientRect();
    const point = { x: (frame?.left ?? 0) + at.x, y: (frame?.top ?? 0) + at.y };
    if (hand === 'mouse') {
      const type = phase === 'down' ? 'mousePressed' : phase === 'up' ? 'mouseReleased' : 'mouseMoved';
      await cdp().send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: phase === 'up' ? 0 : 1, clickCount: phase === 'move' ? 0 : 1 });
      return;
    }
    const type = phase === 'down' ? 'touchStart' : phase === 'up' ? 'touchEnd' : 'touchMove';
    await cdp().send('Input.dispatchTouchEvent', { type, touchPoints: phase === 'up' ? [] : [{ ...point, id: 0 }] });
  };
  const hands: Hands = {
    tap: async (hand, at) => {
      await send(hand, 'down', at);
      await send(hand, 'up', at);
      await handled('pointerup', at);
    },
    press: async (hand, from, through) => {
      await send(hand, 'down', from);
      for (const at of through) await send(hand, 'move', at);
      const end = through.at(-1);
      if (end) await handled('pointermove', end);
    },
    move: async (hand, at) => {
      await send(hand, 'move', at);
      await handled('pointermove', at);
    },
    lift: async (hand, at) => {
      await send(hand, 'up', at);
      await handled('pointerup', at);
    },
    drag: async (hand, from, to, steps = 2) => {
      await send(hand, 'down', from);
      for (let i = 1; i <= steps; i++) await send(hand, 'move', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      await send(hand, 'up', to);
      await handled('pointerup', to);
    },
    wire: async (surface, hand, how, from, to) => {
      const source = keyOf(from);
      const target = keyOf(to);
      if (crowdedAt(surface, source)) {
        // A tap on a crowded socket fans its crowd out; then the socket has a target of its own.
        await hands.tap(hand, clientOf(surface, homeOf(surface, source)));
        expect(surface.wiring.fanned?.has(source), `${source} fanned out`).toBe(true);
      }
      const start = clientOf(surface, placeOf(surface, source));
      if (how === 'tap') {
        await hands.tap(hand, start);
        expect(surface.wiring.waitingFrom, `${source} waits for the tap`).toEqual(from);
        const before = surface.blueprint;
        await hands.tap(hand, clientOf(surface, placeOf(surface, target)));
        // A crowd it could not see into fanned out instead: the wire still waits, for the tap on the socket itself.
        if (surface.blueprint === before && surface.wiring.waitingFrom && surface.wiring.fanned?.has(target)) {
          await hands.tap(hand, clientOf(surface, placeOf(surface, target)));
        }
        return;
      }
      const end = clientOf(surface, placeOf(surface, target));
      await hands.press(hand, start, [end]);
      const fanned = surface.wiring.fanned?.get(target);
      // The crowd fanned out round the wire's end: the hand goes on to the socket where it went.
      const there = fanned ? clientOf(surface, fanned) : end;
      if (distance(there, end) > 0.5) await hands.move(hand, there);
      await hands.lift(hand, there);
    },
  };
  return hands;
};

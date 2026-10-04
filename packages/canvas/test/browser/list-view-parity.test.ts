// Review R-6.4 (docs/reviews/canvas.md), task 7.3: every canvas edit reachable and announced on the list-view path and
// the tap-then-tap path. One test or more per finding, CAN-1 to CAN-10 but CAN-9 (the parity harness, task 7.6):
// CAN-1 and CAN-4 are model tests (test/list-view/model.test.ts) and have their DOM side here. Real input through CDP
// in the iPad profile, reduced motion throughout.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, Prop, Vec2 } from '@servo/schema';
import type { HandleKind } from '../../src/placement/overlays.ts';
import { blueprintOf, fixture } from '../helpers/catalogue.ts';
import { listen, unmountAll } from './helpers.ts';
import { clientOf, drag, mountWorkbench, tap } from './placing.ts';
import type { Hand, Workbench } from './placing.ts';
import { homeOf } from './wiring-hands.ts';

let bench: Workbench;

beforeAll(async () => {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  bench = await mountWorkbench();
}, 300_000);

afterAll(async () => {
  bench.unmount();
  unmountAll();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const load = (build: Blueprint, centre: Vec2 = { x: 0, y: 0 }, zoom = 1): void => {
  // Focus off the list view, so its panel hides and leaves the canvas to the hands.
  bench.surface.canvas.focus();
  bench.surface.setMode('build');
  bench.surface.select(null);
  expect(bench.surface.load(build).ok).toBe(true);
  Object.assign(bench.surface.camera, { centreX: centre.x, centreY: centre.y, zoom });
  bench.surface.requestFrame();
};

beforeEach(() => load(fixture('rolling-start')));

const client = (world: Vec2): Vec2 => clientOf(bench.surface, world);
const list = (): HTMLElement => bench.surface.listDom.element;
const status = (): string => list().querySelector('[role="status"]')?.textContent ?? '';
const byKey = (key: string): HTMLButtonElement => {
  const found = list().querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!found) throw new Error(`no ${key} in the list view`);
  return found;
};
const enter = async (key: string): Promise<void> => {
  byKey(key).focus();
  await userEvent.keyboard('{Enter}');
};
const open = async (subject: string): Promise<void> => {
  const toggle = `toggle:${subject}`;
  if (byKey(toggle).getAttribute('aria-expanded') === 'true') return;
  await enter(toggle);
  await vi.waitFor(() => expect(byKey(toggle).getAttribute('aria-expanded')).toBe('true'));
};
const partHandle = (kind: HandleKind): Vec2 => {
  const place = bench.surface.placement.handlePlaces.places.get(kind);
  if (!place) throw new Error(`no ${kind} handle`);
  return place;
};
const propHandle = (kind: HandleKind): Vec2 => {
  const place = bench.surface.selecting.propHandlePlaces.get(kind);
  if (!place) throw new Error(`no ${kind} handle on the prop`);
  return place;
};

describe('CAN-1: the list view turns only a free part', () => {
  it('lists no turn for the mounted DC motor in the DOM, and one for the chassis', async () => {
    await open('part:motor-left');
    expect(list().querySelector('[data-action^="turn:motor-left"]')).toBeNull();
    await open('part:chassis');
    expect(byKey('action:turn:chassis:clockwise').textContent).toBe('Turn chassis a quarter turn clockwise');
  });
});

describe('CAN-2: the canvas’s lines and edits reach the live region', () => {
  it('says a removal by the bin, in the canvas’s own words, as the list’s own removal says it', async () => {
    await tap('mouse', client({ x: 30, y: -53 }));
    expect(bench.surface.placement.selectedPart).toBe('motor-left');
    await tap('touch', client(partHandle('bin')));
    await vi.waitFor(() => expect(bench.surface.blueprint?.parts.some((part) => part.id === 'motor-left')).toBe(false));
    expect(bench.surface.placement.notice).toBe('Removed with it: 2 wires. Loose now: large wheel');
    expect(status()).toBe('Removed DC motor 1. Removed with it: 2 wires. Loose now: large wheel');
    const byCanvas = status();

    load(fixture('rolling-start'));
    await open('part:motor-left');
    await enter('action:remove:motor-left');
    await vi.waitFor(() => expect(bench.surface.blueprint?.parts.some((part) => part.id === 'motor-left')).toBe(false));
    expect(status()).toBe(byCanvas);
  });

  it('says the held line a tap on a held part shows, and a turn by the rotate handle', async () => {
    await tap('mouse', client({ x: -45, y: 0 }));
    expect(bench.surface.placement.notice).toBe('Held by its mount: move it off to turn it');
    await vi.waitFor(() => expect(status()).toBe('Held by its mount: move it off to turn it'));
    await tap('touch', client({ x: 40, y: -79 }));
    await vi.waitFor(() => expect(status()).toBe('Held on a shaft: move it off to turn it'));
    await tap('touch', client({ x: -45, y: 40 }));
    expect(bench.surface.placement.selectedPart).toBe('chassis');
    await tap('mouse', client(partHandle('rotate')));
    await vi.waitFor(() => expect(status()).toBe('Turned chassis'));
  });
});

describe('CAN-3: tap-then-tap moves one of the child’s props, as a drag does', () => {
  // The Rolling Start robot sits on the open floor's start pose (300, 600): canvas (x, y) is arena (300 + x, 600 − y).
  const box = (id: string, x: number, y: number): Prop => ({ id, shape: 'box', size: { x: 100, y: 100, z: 60 }, grams: 80, at: { x, y, heading: 0 }, fixed: false });
  const rolling = fixture('rolling-start');
  const withProps: Blueprint = blueprintOf({ parts: rolling.parts, wires: rolling.wires, arena: { preset: 'open-floor', props: [box('prop-1', 490, 670), box('prop-2', 490, 530)] } }, 'Props');

  // Clear of the prop where it stands: a tap on the prop itself leaves it be, as a tap on a moving part does.
  const TO: Vec2 = { x: 290, y: -40 };

  const byDrag = async (): Promise<string> => {
    load(withProps, { x: 150, y: 0 });
    // Grabbed at its middle, as the Move handle's tap-then-tap puts its middle where the second tap lands.
    const edits = listen(bench.surface, 'edit');
    await drag('mouse', client({ x: 190, y: -70 }), client(TO));
    expect(edits.map((edit) => edit.command.kind)).toEqual(['move-prop']);
    return serializeBlueprint(bench.surface.blueprint as Blueprint);
  };

  const byTaps = async (hand: Hand): Promise<string> => {
    load(withProps, { x: 150, y: 0 });
    const edits = listen(bench.surface, 'edit');
    await tap(hand, client({ x: 190, y: -70 }));
    expect(bench.surface.selection).toEqual({ kind: 'prop', propId: 'prop-1' });
    expect([...bench.surface.selecting.propHandlePlaces.keys()]).toEqual(['move', 'bin']);
    await tap(hand, client(propHandle('move')));
    expect(bench.surface.selecting.movingProp).toBe('prop-1');
    expect(edits).toEqual([]);
    await tap(hand, client(TO));
    expect(edits.map((edit) => edit.command)).toEqual([{ kind: 'move-prop', propId: 'prop-1', at: { x: 590, y: 640, heading: 0 } }]);
    expect(bench.surface.selecting.movingProp).toBeUndefined();
    expect(bench.surface.selection).toEqual({ kind: 'prop', propId: 'prop-1' });
    return serializeBlueprint(bench.surface.blueprint as Blueprint);
  };

  it('by touch and by mouse, with the same bytes as a drag', async () => {
    const dragged = await byDrag();
    expect(await byTaps('touch')).toBe(dragged);
    expect(await byTaps('mouse')).toBe(dragged);
  });

  it('lets the prop be when the Move handle or the prop itself is tapped again', async () => {
    load(withProps, { x: 150, y: 0 });
    const edits = listen(bench.surface, 'edit');
    await tap('touch', client({ x: 190, y: -70 }));
    await tap('touch', client(propHandle('move')));
    await tap('touch', client(propHandle('move')));
    expect(bench.surface.selecting.movingProp).toBeUndefined();
    await tap('mouse', client(propHandle('move')));
    await tap('mouse', client({ x: 190, y: -70 }));
    expect(bench.surface.selecting.movingProp).toBeUndefined();
    expect(edits).toEqual([]);
    expect(bench.surface.selection).toEqual({ kind: 'prop', propId: 'prop-1' });
  });
});

describe('CAN-4: twin props read apart in the DOM', () => {
  it('gives two boxes their own lines and buttons', async () => {
    const [place] = bench.surface.listView.propPlacementsFor({ shape: 'box', size: { x: 80, y: 80, z: 80 }, grams: 200, fixed: false });
    expect(bench.surface.listView.perform(place as never)).toBe(true);
    const [again] = bench.surface.listView.propPlacementsFor({ shape: 'box', size: { x: 80, y: 80, z: 80 }, grams: 200, fixed: false });
    expect(bench.surface.listView.perform(again as never)).toBe(true);
    const names = [...list().querySelectorAll<HTMLButtonElement>('button[data-toggle^="prop:"]')].map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Actions for box 1', 'Actions for box 2']);
  });
});

describe('CAN-5: the view by keyboard', () => {
  it('brings a part selected from the list view into view at zoom 4', async () => {
    load(fixture('rolling-start'), { x: -400, y: 300 }, 4);
    const visible = (): boolean => {
      const part = bench.surface.scene.partById.get('wheel-left');
      const view = bench.surface.camera.visible();
      return part !== undefined && part.pose.x > view.minX && part.pose.x < view.maxX && part.pose.y > view.minY && part.pose.y < view.maxY;
    };
    expect(visible()).toBe(false);
    await open('part:wheel-left');
    await enter('action:select:part:wheel-left');
    expect(bench.surface.selection).toEqual({ kind: 'part', partId: 'wheel-left' });
    expect(bench.surface.zoom).toBe(4);
    expect(visible()).toBe(true);
  });

  it('pans with the arrow keys when the canvas has focus', () => {
    load(fixture('rolling-start'), { x: 0, y: 0 }, 4);
    bench.surface.canvas.focus();
    const centre = (): Vec2 => ({ x: bench.surface.camera.centreX, y: bench.surface.camera.centreY });
    const press = (key: string): void => {
      bench.surface.canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    const start = centre();
    press('ArrowRight');
    expect(centre().x).toBeGreaterThan(start.x);
    expect(centre().y).toBe(start.y);
    press('ArrowDown');
    expect(centre().y).toBeGreaterThan(start.y);
    press('ArrowLeft');
    press('ArrowUp');
    expect(centre().x).toBeCloseTo(start.x, 6);
    expect(centre().y).toBeCloseTo(start.y, 6);
  });
});

describe('CAN-6: Clear selection from the list view', () => {
  it('marks what is selected and clears it', async () => {
    await tap('mouse', client({ x: -45, y: 40 }));
    expect(bench.surface.selection).toEqual({ kind: 'part', partId: 'chassis' });
    await vi.waitFor(() => expect(list().querySelector('li[data-subject="part:chassis"] > span')?.textContent).toMatch(/, selected$/));
    await open('part:chassis');
    await enter('action:clear-selection');
    expect(bench.surface.selection).toBeNull();
    expect(list().querySelector('li[data-subject="part:chassis"] > span')?.textContent).not.toMatch(/selected/);
    expect(bench.surface.placement.handlePlaces.places.size).toBe(0);
  });
});

describe('CAN-7: an action that changed nothing says so', () => {
  it('says Nothing changed for a stale action and for a tidy that changed no route', async () => {
    const wire = bench.surface.listView.wires.find((each) => each.kind === 'power');
    const subject = `wire:${wire?.wireId}`;
    await open(subject);
    await enter(`action:tidy-wires:${wire?.wireId}`);
    await vi.waitFor(() => expect(status()).toBe('Tidied the wires round the parts'));
    await enter(`action:tidy-wires:${wire?.wireId}`);
    await vi.waitFor(() => expect(status()).toBe('Nothing changed'));
    // A button whose action has gone (the build changed under a screen reader's virtual cursor).
    list().querySelector('[role="status"]')?.replaceChildren();
    const button = byKey(`action:tidy-wires:${wire?.wireId}`);
    button.dataset.action = 'remove:no-such-part';
    button.click();
    expect(status()).toBe('Nothing changed');
  });
});

describe('CAN-8: the Move handle and the held line', () => {
  it('hides the held line when Move starts, so a tap where it was is where the part goes', async () => {
    const edits = listen(bench.surface, 'edit');
    await tap('mouse', client({ x: -45, y: 0 }));
    const line = bench.surface.placement.noticeBox;
    expect(line, 'the held line').toBeDefined();
    await tap('mouse', client(partHandle('move')));
    expect(bench.surface.placement.moving).toBe('battery');
    expect(bench.surface.placement.notice).toBeUndefined();
    await tap('mouse', client(line?.at as Vec2));
    expect(edits.map((edit) => edit.command.kind)).toEqual(['move-part']);
  });
});

describe('CAN-10: starting a placement lets a waiting wire go', () => {
  it('takes the waiting wire, its glows and the wire’s bin away before the tray part waits for its tap', async () => {
    await tap('touch', client(homeOf(bench.surface, 'switch.a')));
    expect(bench.surface.wiring.waitingFrom).toEqual({ part: 'switch', port: 'a' });
    expect(bench.surface.wiring.glowing.length).toBeGreaterThan(0);
    bench.surface.beginPlacement('led');
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
    expect(bench.surface.wiring.glowing).toEqual([]);
    bench.surface.cancelPlacement();

    const wire = bench.surface.listView.wires.find((each) => each.kind === 'power');
    bench.surface.select({ kind: 'wire', wireId: wire?.wireId as string });
    expect(bench.surface.wiring.binPlace).toBeDefined();
    bench.surface.beginPropPlacement({ shape: 'box', size: { x: 80, y: 80, z: 80 }, grams: 200, fixed: false });
    expect(bench.surface.wiring.binPlace).toBeUndefined();
    expect(bench.surface.selection).toBeNull();
    bench.surface.cancelPlacement();
  });

  it('closes an open fan of crowded sockets', async () => {
    load(fixture('bumper-robot'), { x: 25, y: 0 });
    const crowd = bench.surface.wiring.crowded.list[0];
    expect(crowd, 'a crowd on the bumper robot').toBeDefined();
    const keys = crowd?.members.map((member) => member.key) ?? [];
    const pairs = keys.flatMap((a) => keys.filter((b) => b !== a).map((b) => [client(homeOf(bench.surface, a)), client(homeOf(bench.surface, b))] as const));
    const [a, b] = pairs.sort(([p, q], [r, s]) => Math.hypot(p.x - q.x, p.y - q.y) - Math.hypot(r.x - s.x, r.y - s.y))[0] ?? [];
    await tap('touch', { x: ((a?.x ?? 0) + (b?.x ?? 0)) / 2, y: ((a?.y ?? 0) + (b?.y ?? 0)) / 2 });
    expect(bench.surface.wiring.fanned).toBeDefined();
    bench.surface.beginPlacement('led');
    expect(bench.surface.wiring.fanned).toBeUndefined();
    bench.surface.cancelPlacement();
  });
});

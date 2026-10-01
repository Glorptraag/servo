// Wiring by touch and pointer (brief Sections 10 and 13, task 3.3): drag and tap-then-tap, the 32 px reach and its
// glow, drag sensitivity, the push-away from a wrong socket with the right colour glowing, every impossible drop
// refused with that cue (by state and by pixels), the spring back, legal-but-wrong wiring, drive linkages, 44 px
// socket targets, removing wires (the tray, the bin, the Delete key) by their 24 px hit areas, wires following their
// ports, the elastic settle, the locks, and crowded sockets fanning out on the two Level 2 builds whose sockets
// overlap (review R-3.1, finding 2). Real input through CDP, in the iPad profile.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { planWire } from '@servo/schema';
import type { Blueprint, Catalogue, IssueCode, PortRef, Vec2 } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { distance } from '../../src/scene/geometry.ts';
import { PORT_MM, PX_PER_MM, WIRE_HIT_MM } from '../../src/scene/units.ts';
import { drawnSockets } from '../../src/wiring/crowds.ts';
import { SETTLE_MS, SPRING_BACK_MS } from '../../src/wiring/motion.ts';
import { WIRE_REACH_PX, judgeSockets } from '../../src/wiring/rules.ts';
import { BIN_MM } from '../../src/wiring/views.ts';
import { blueprintOf, catalogue, fixture } from '../helpers/catalogue.ts';
import { crewCatalogue, crewRobot } from '../helpers/circuit-crew.ts';
import { PREFS, colourDistance, describeRgb, listen, mount, reset, settle, shoot, unmountAll } from './helpers.ts';
import type { Rgb } from './helpers.ts';
import { clientOf, middleOf, mountWorkbench } from './placing.ts';
import type { Hand, Workbench } from './placing.ts';
import { handsOf, homeOf, placeOf } from './wiring-hands.ts';

const CANVAS = { width: 600, height: 420 };
/** A software GPU on a busy machine can take a minute to mount a canvas, and minutes for a test of many gestures. */
const MOUNT_MS = 120_000;
const LONG_MS = 360_000;
/** Empty workbench in every view these tests use. */
const EMPTY = { x: -40, y: 40 };

let bench: Workbench;

beforeAll(async () => {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  bench = await mountWorkbench(CANVAS);
}, MOUNT_MS);

beforeEach(() => {
  reset(bench.surface);
  bench.surface.setRemoveTargets([bench.tray]);
});

afterAll(async () => {
  bench.unmount();
  unmountAll();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const part = (id: string, type: string, x: number, y: number): Blueprint['parts'][number] => ({ id, part: type, position: { x, y }, rotation: 0, settings: {} });
const ref = (key: string): PortRef => {
  const [partId, port] = key.split('.') as [string, string];
  return { part: partId, port };
};

/**
 * A workbench with a socket of every kind and room round each: a battery pack, a microcontroller, a servo motor, a DC
 * motor, a gearbox and a large wheel, all loose. The pack's plus already feeds the microcontroller, and its first
 * output already drives the servo motor's signal.
 */
const sockets = (): Blueprint =>
  blueprintOf({
    parts: [
      part('battery', 'battery-pack-2-cell', -95, -45),
      part('brain', 'microcontroller', 0, -10),
      part('servo', 'servo-motor', 95, -45),
      part('motor', 'dc-motor', -95, 50),
      part('gearbox', 'gearbox', 10, 75),
      part('wheel', 'wheel-large', 100, 60),
    ],
    wires: [
      { id: 'w1', from: { part: 'battery', port: 'plus' }, to: { part: 'brain', port: 'plus' } },
      { id: 'w2', from: { part: 'brain', port: 'out-1' }, to: { part: 'servo', port: 'signal' } },
    ],
  });

const load = (surface: CanvasSurface, build: Blueprint, centre: Vec2 = { x: 0, y: 14 }, zoom = 0.75): void => {
  const result = surface.load(build);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join());
  Object.assign(surface.camera, { centreX: centre.x, centreY: centre.y, zoom });
  surface.requestFrame();
};

const client = (world: Vec2, surface: CanvasSurface = bench.surface): Vec2 => clientOf(surface, world);
const socketAt = (key: string, surface: CanvasSurface = bench.surface): Vec2 => client(homeOf(surface, key), surface);
/** A page point `px` screen pixels from a socket's centre, along `direction`. */
const besideSocket = (key: string, px: number, direction: Vec2 = { x: -1, y: 0 }): Vec2 => {
  const at = socketAt(key);
  const length = Math.hypot(direction.x, direction.y);
  return { x: at.x + (direction.x / length) * px, y: at.y + (direction.y / length) * px };
};
/** Screen pixels between two canvas points at the current zoom. */
const px = (a: Vec2, b: Vec2, surface: CanvasSurface = bench.surface): number => distance(a, b) * PX_PER_MM * surface.camera.zoom;

/** The sockets a wire from `source` lands on, by planWire, in key order. */
const takers = (surface: CanvasSurface, against: Catalogue, source: string): string[] => {
  const verdicts = judgeSockets(surface.blueprint as Blueprint, against, surface.scene, ref(source));
  return drawnSockets(surface.scene)
    .filter((port) => port.key !== source && verdicts.get(port.key)?.legal === true)
    .map((port) => port.key)
    .sort();
};

/** A point of the canvas element, from a page point. */
const local = (page: Vec2): Vec2 => {
  const box = bench.surface.canvas.getBoundingClientRect();
  return { x: page.x - box.left, y: page.y - box.top };
};

const reddish = (rgb: Rgb): number => rgb[0] - (rgb[1] + rgb[2]) / 2;

const middleOfWire = (id: string): { readonly middle: Vec2; readonly normal: Vec2 } => {
  const wire = bench.surface.scene.wires.find((each) => each.id === id);
  if (!wire) throw new Error(`no ${id}`);
  const { at: a } = wire.from;
  const { at: b } = wire.to;
  const length = distance(a, b);
  return { middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal: { x: -(b.y - a.y) / length, y: (b.x - a.x) / length } };
};

describe('drawing a wire by hand', () => {
  it('draws a wire by touch drag, mouse drag, touch tap-then-tap and click-click, and its sockets fill as it lands', async () => {
    const hands = handsOf();
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    const wires: readonly [Hand, 'drag' | 'tap', string, string][] = [
      ['touch', 'drag', 'battery.minus', 'brain.minus'],
      ['mouse', 'drag', 'servo.minus', 'motor.minus'],
      ['touch', 'tap', 'brain.pin-3v', 'motor.plus'],
      ['mouse', 'tap', 'servo.plus', 'battery.plus'],
    ];
    for (const [hand, how, from, to] of wires) {
      const was = (key: string): boolean | undefined => bench.surface.scene.portByKey.get(key)?.connected;
      expect([was(from), was(to)], `${from} and ${to} before`).toEqual([false, to === 'battery.plus']);
      await hands.wire(bench.surface, hand, how, ref(from), ref(to));
      expect([was(from), was(to)], `${from} and ${to} after`).toEqual([true, true]);
    }
    expect(edits.map((edit) => edit.command)).toEqual(wires.map(([, , from, to]) => ({ kind: 'connect', from: ref(from), to: ref(to) })));
  }, LONG_MS);

  it('lands within 32 px of a socket that takes it, which glows as the wire comes near, and not beyond; a lower drag sensitivity reaches further (D44)', async () => {

    const hands = handsOf();
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    const up = { x: 0, y: -1 };
    await hands.press('mouse', socketAt('battery.minus'), [besideSocket('brain.minus', 60, up), besideSocket('brain.minus', 30, up)]);
    expect(bench.surface.wiring.target).toEqual(ref('brain.minus'));
    expect(bench.surface.wiring.glowing).toEqual(['brain.minus']);
    expect(bench.surface.wiring.wireEnd).toEqual(homeOf(bench.surface, 'brain.minus'));
    await hands.move('mouse', besideSocket('brain.minus', 34, up));
    expect(bench.surface.wiring.target).toBeUndefined();
    expect(bench.surface.wiring.glowing).toEqual([]);
    await hands.lift('mouse', besideSocket('brain.minus', 34, up));
    expect(edits).toEqual([]);
    bench.surface.setPrefs({ ...PREFS, dragSensitivity: 0.5 });
    await hands.press('touch', socketAt('battery.minus'), [besideSocket('brain.minus', 90, up), besideSocket('brain.minus', 60, up)]);
    expect(bench.surface.wiring.target).toEqual(ref('brain.minus'));
    await hands.lift('touch', besideSocket('brain.minus', 60, up));
    expect(edits.map((edit) => edit.command)).toEqual([{ kind: 'connect', from: ref('battery.minus'), to: ref('brain.minus') }]);
  });

  it('springs a wire let go in empty space back to its source, and lets a waiting wire go on a tap on empty canvas or on its source', async () => {

    const hands = handsOf();
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    await hands.drag('touch', socketAt('battery.minus'), client(EMPTY));
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
    await hands.tap('mouse', socketAt('battery.minus'));
    expect(bench.surface.wiring.waitingFrom).toEqual(ref('battery.minus'));
    expect(bench.surface.wiring.glowing).toEqual(takers(bench.surface, catalogue, 'battery.minus'));
    await hands.tap('mouse', client(EMPTY));
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
    expect(bench.surface.wiring.glowing).toEqual([]);
    await hands.tap('touch', socketAt('servo.plus'));
    expect(bench.surface.wiring.waitingFrom).toEqual(ref('servo.plus'));
    await hands.tap('touch', socketAt('servo.plus'));
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
    expect(edits).toEqual([]);
  });

  it('accepts legal-but-wrong wiring by hand: a short across the pack, and a DC motor on the microcontroller’s 3V pin', async () => {

    const hands = handsOf();
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    await hands.wire(bench.surface, 'touch', 'drag', ref('battery.plus'), ref('battery.minus'));
    await hands.wire(bench.surface, 'mouse', 'tap', ref('motor.plus'), ref('brain.pin-3v'));
    expect(edits.map((edit) => edit.command.kind)).toEqual(['connect', 'connect']);
    expect(bench.surface.blueprint?.wires.find((wire) => wire.id === 'w3')).toEqual({ id: 'w3', from: ref('battery.minus'), to: ref('battery.plus') });
    expect(bench.surface.blueprint?.wires.find((wire) => wire.id === 'w4')).toEqual({ id: 'w4', from: ref('brain.pin-3v'), to: ref('motor.plus') });
  });

  it('joins a loose wheel’s hub to a free motor shaft by hand, and the wheel goes onto the shaft', async () => {

    const hands = handsOf();
    load(bench.surface, sockets());
    await hands.wire(bench.surface, 'touch', 'drag', ref('wheel.hub'), ref('motor.shaft'));
    expect(bench.surface.blueprint?.parts.find((placed) => placed.id === 'wheel')?.position).toEqual({ x: -85, y: 37 - 13 });
    expect(bench.surface.blueprint?.wires.find((wire) => wire.id === 'w3')).toEqual({ id: 'w3', from: ref('motor.shaft'), to: ref('wheel.hub') });
  });
});

/** Every kind of impossible drop the canvas can meet (mounts are placed, not wired, so a mount never meets a wire). */
const IMPOSSIBLE: readonly { readonly from: string; readonly to: string; readonly code: IssueCode }[] = [
  { from: 'battery.minus', to: 'servo.signal', code: 'wire.type_mismatch' },
  { from: 'brain.out-2', to: 'battery.minus', code: 'wire.type_mismatch' },
  { from: 'motor.shaft', to: 'servo.minus', code: 'wire.type_mismatch' },
  { from: 'brain.out-2', to: 'gearbox.input', code: 'wire.type_mismatch' },
  { from: 'brain.out-1', to: 'brain.out-2', code: 'wire.signal_direction' },
  { from: 'brain.in-1', to: 'brain.in-2', code: 'wire.signal_direction' },
  { from: 'motor.shaft', to: 'servo.arm', code: 'wire.mechanical_direction' },
  { from: 'wheel.hub', to: 'gearbox.input', code: 'wire.mechanical_direction' },
  { from: 'gearbox.output', to: 'gearbox.input', code: 'wire.mechanical_same_part' },
  { from: 'brain.out-2', to: 'servo.signal', code: 'wire.port_full' },
  { from: 'brain.plus', to: 'battery.plus', code: 'wire.duplicate' },
];

const PATHS: readonly { readonly hand: Hand; readonly how: 'drag' | 'tap' }[] = [
  { hand: 'touch', how: 'drag' },
  { hand: 'touch', how: 'tap' },
  { hand: 'mouse', how: 'drag' },
  { hand: 'mouse', how: 'tap' },
];

describe('impossible drops: refused at the socket with a colour cue, no text (brief Section 10)', () => {
  it.each(IMPOSSIBLE)('refuses $code, $from to $to, by every hand and gesture, the right colour glowing', async ({ from, to, code }) => {
    const hands = handsOf();
    load(bench.surface, sockets());
    const build = bench.surface.blueprint as Blueprint;
    const plan = planWire(build, catalogue, ref(from), ref(to));
    expect(!plan.legal && plan.code).toBe(code);
    const edits = listen(bench.surface, 'edit');
    for (const path of PATHS) {
      await hands.wire(bench.surface, path.hand, path.how, ref(from), ref(to));
      const label = `${path.hand} ${path.how}`;
      expect(bench.surface.wiring.cue, label).toEqual({ refused: ref(to), code, glowing: takers(bench.surface, catalogue, from).map(ref) });
      expect(bench.surface.wiring.glowing, label).toEqual(takers(bench.surface, catalogue, from));
      // The cue stays until the next touch; a tap on empty canvas also lets a waiting wire go.
      await hands.tap(path.hand, client(EMPTY));
      expect(bench.surface.wiring.cue, label).toBeUndefined();
      expect(bench.surface.wiring.waitingFrom, label).toBeUndefined();
    }
    expect(edits).toEqual([]);
    expect(bench.surface.blueprint).toBe(build);
  }, LONG_MS);

  it('pushes a wire away from a wrong-colour socket as it is dragged, and the sockets that take it glow', async () => {

    const hands = handsOf();
    load(bench.surface, sockets());
    const signal = homeOf(bench.surface, 'servo.signal');
    await hands.press('touch', socketAt('battery.minus'), [besideSocket('servo.signal', 40), besideSocket('servo.signal', 6)]);
    expect(px(bench.surface.wiring.wireEnd as Vec2, signal)).toBeCloseTo(WIRE_REACH_PX, 6);
    expect(bench.surface.wiring.target).toBeUndefined();
    expect(bench.surface.wiring.glowing).toEqual(takers(bench.surface, catalogue, 'battery.minus'));
    await hands.lift('touch', besideSocket('servo.signal', 6));
    expect(bench.surface.wiring.cue?.code).toBe('wire.type_mismatch');
  });

  it('shows the cue in colour on the screen: the sockets that take the wire glow red until the next touch', async () => {

    const hands = handsOf();
    load(bench.surface, sockets());
    await settle(bench.surface);
    // Above the microcontroller's minus, over the bare workbench: inside its glow, outside the socket itself.
    const probe = local(besideSocket('brain.minus', (PORT_MM / 2 + 1.8) * PX_PER_MM * 0.75, { x: 0, y: -1 }));
    const before = (await shoot(bench.surface.canvas)).at(probe);
    await hands.wire(bench.surface, 'mouse', 'drag', ref('battery.minus'), ref('servo.signal'));
    await settle(bench.surface);
    const glowing = (await shoot(bench.surface.canvas)).at(probe);
    expect(colourDistance(before, glowing), `${describeRgb(before)} to ${describeRgb(glowing)}`).toBeGreaterThan(25);
    expect(reddish(glowing)).toBeGreaterThan(reddish(before) + 25);
    await hands.tap('mouse', client(EMPTY));
    await settle(bench.surface);
    const after = (await shoot(bench.surface.canvas)).at(probe);
    expect(colourDistance(before, after), `${describeRgb(before)} back to ${describeRgb(after)}`).toBeLessThan(6);
  });
});

describe('targets at the default zoom (brief Section 9)', () => {
  it('takes a press within 22 px of a socket’s centre as the socket (a 44 px target), and not beyond', async () => {
    const hands = handsOf();
    load(bench.surface, sockets(), { x: -80, y: -20 }, 1);
    await hands.tap('touch', besideSocket('battery.minus', 20));
    expect(bench.surface.wiring.waitingFrom).toEqual(ref('battery.minus'));
    await hands.tap('touch', client(EMPTY));
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
    await hands.tap('mouse', besideSocket('battery.minus', 24));
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
  });

  it('grabs a 6 px wire within 12 px of its line (its 24 px hit area) and not beyond: a tap shows its bin', async () => {

    const hands = handsOf();
    load(bench.surface, sockets(), { x: -55, y: -40 }, 1);
    const { middle, normal } = middleOfWire('w1');
    const off = (screen: number): Vec2 => {
      const mm = screen / PX_PER_MM;
      return client({ x: middle.x + normal.x * mm, y: middle.y + normal.y * mm });
    };
    await hands.tap('mouse', off(11));
    expect(bench.surface.wiring.selectedWire).toBe('w1');
    await hands.tap('mouse', client({ x: -80, y: 20 }));
    expect(bench.surface.wiring.selectedWire).toBeUndefined();
    await hands.tap('touch', off(-13));
    expect(bench.surface.wiring.selectedWire).toBeUndefined();
  });
});

describe('removing a wire', () => {
  it('removes a wire dragged onto the tray, and puts it back when let go anywhere else', async () => {
    const hands = handsOf();
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    const wire = bench.surface.scene.wires.find((each) => each.id === 'w2');
    if (!wire) throw new Error('no w2');
    const grab = client({ x: (wire.from.at.x * 3 + wire.to.at.x) / 4, y: (wire.from.at.y * 3 + wire.to.at.y) / 4 });
    await hands.drag('mouse', grab, client(EMPTY), 3);
    expect(edits).toEqual([]);
    expect(bench.surface.wireView('w2')?.graphics.alpha).toBe(1);
    await hands.drag('touch', grab, middleOf(bench.tray), 3);
    expect(edits.map((edit) => edit.command)).toEqual([{ kind: 'disconnect', wireId: 'w2' }]);
  });

  it('shows a bin beside a tapped wire, on its other side for left-handed use, which removes it, as the Delete key does', async () => {

    const hands = handsOf();
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    await hands.tap('touch', client(middleOfWire('w1').middle));
    const right = bench.surface.wiring.binPlace as Vec2;
    expect(right.x).toBeGreaterThan(middleOfWire('w1').middle.x);
    // Clear of the wire's 24 px hit area.
    expect(distance(right, middleOfWire('w1').middle)).toBeGreaterThanOrEqual(WIRE_HIT_MM / 2 + BIN_MM / 2);
    bench.surface.setPrefs({ ...PREFS, leftHanded: true });
    expect((bench.surface.wiring.binPlace as Vec2).x).toBeLessThan(middleOfWire('w1').middle.x);
    await hands.tap('touch', client(bench.surface.wiring.binPlace as Vec2));
    await hands.tap('mouse', client(middleOfWire('w2').middle));
    expect(bench.surface.wiring.selectedWire).toBe('w2');
    expect(document.activeElement).toBe(bench.surface.canvas);
    await userEvent.keyboard('{Delete}');
    expect(edits.map((edit) => edit.command)).toEqual([
      { kind: 'disconnect', wireId: 'w1' },
      { kind: 'disconnect', wireId: 'w2' },
    ]);
    expect(bench.surface.blueprint?.wires).toEqual([]);
  });
});

describe('wires follow their ports', () => {
  it('re-routes a wire drawn by hand while its part is dragged, and after it lands', async () => {
    const hands = handsOf();
    load(bench.surface, sockets());
    await hands.wire(bench.surface, 'touch', 'tap', ref('motor.plus'), ref('brain.pin-3v'));
    const id = bench.surface.blueprint?.wires.find((wire) => wire.from.port === 'pin-3v')?.id ?? '';
    const line = (): { readonly minX: number; readonly maxY: number } => {
      const bounds = bench.surface.wireView(id)?.graphics.getLocalBounds();
      return { minX: bounds?.minX ?? NaN, maxY: bounds?.maxY ?? NaN };
    };
    const before = line();
    // The DC motor, dragged by its middle 20 mm left and 30 mm down: its plus socket, and the wire's end, go with it.
    await hands.press('mouse', client({ x: -95, y: 50 }), [client({ x: -105, y: 65 }), client({ x: -115, y: 80 })]);
    expect(line().minX).toBeLessThan(before.minX - 15);
    expect(line().maxY).toBeGreaterThan(before.maxY + 25);
    await hands.lift('mouse', client({ x: -115, y: 80 }));
    const plus = homeOf(bench.surface, 'motor.plus');
    const wire = bench.surface.scene.wires.find((each) => each.id === id);
    expect([wire?.from.at, wire?.to.at]).toContainEqual(plus);
    expect(line().minX).toBeLessThan(plus.x);
    expect(line().maxY).toBeGreaterThan(plus.y);
  });
});

describe('motion (brief Sections 10 and 11)', () => {
  beforeAll(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] });
  });

  afterAll(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  });

  /** Holds the page's animation frames while `act` runs, so a motion can be seen at its start. */
  const holdingFrames = async (act: () => Promise<void>, check: () => void): Promise<void> => {
    const original = window.requestAnimationFrame;
    const held: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => {
      held.push(callback);
      return 0;
    };
    try {
      await act();
      check();
    } finally {
      window.requestAnimationFrame = original;
      for (const callback of held) original.call(window, callback);
    }
  };

  it('draws a tapped wire out to its socket with a short elastic settle (120–200 ms)', async () => {

    const hands = handsOf();
    expect(SETTLE_MS).toBeGreaterThanOrEqual(120);
    expect(SETTLE_MS).toBeLessThanOrEqual(200);
    load(bench.surface, sockets());
    const source = homeOf(bench.surface, 'battery.minus');
    const minus = homeOf(bench.surface, 'brain.minus');
    let id = '';
    /** How far across the canvas the new wire is drawn, mm: nothing while it has not left its source. */
    const span = (): number => {
      const bounds = bench.surface.wireView(id)?.graphics.getLocalBounds();
      return bounds && bounds.width > 0 ? bounds.maxX - bounds.minX : 0;
    };
    await holdingFrames(
      () => hands.wire(bench.surface, 'mouse', 'tap', ref('battery.minus'), ref('brain.minus')),
      () => {
        id = bench.surface.blueprint?.wires.find((wire) => wire.to.part === 'brain' && wire.to.port === 'minus')?.id ?? '';
        expect(id).not.toBe('');
        // At the start of its settle it is still at its source: it draws out from there to the socket.
        expect(span()).toBeLessThan((minus.x - source.x) / 2);
      },
    );
    await expect.poll(() => span(), { timeout: 30_000 }).toBeGreaterThan(minus.x - source.x);
  });

  it('springs a wire let go away from every socket softly back to its source (120–200 ms)', async () => {

    const hands = handsOf();
    expect(SPRING_BACK_MS).toBeGreaterThanOrEqual(120);
    expect(SPRING_BACK_MS).toBeLessThanOrEqual(200);
    load(bench.surface, sockets());
    const lines = (): number => bench.surface.overlays.children.filter((child) => child.label === 'wire:live').length;
    await holdingFrames(
      async () => {
        await hands.press('mouse', socketAt('battery.minus'), [client({ x: -60, y: 20 }), client(EMPTY)]);
        expect(lines()).toBe(1);
        await hands.lift('mouse', client(EMPTY));
      },
      // Let go, the wire is still on its way back.
      () => expect(lines()).toBe(1),
    );
    await expect.poll(() => lines(), { timeout: 30_000 }).toBe(0);
    expect(bench.surface.blueprint?.wires).toHaveLength(2);
  });
});

describe('locks', () => {
  it('draws no wire in Run mode, nor on a read-only canvas', async () => {
    const hands = handsOf();
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    bench.surface.setMode('run');
    await hands.tap('touch', socketAt('battery.minus'));
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
    await hands.drag('mouse', socketAt('battery.minus'), socketAt('brain.minus'));
    bench.surface.setMode('build');
    expect(edits).toEqual([]);
    const readOnly = await mount({ readOnly: true }, { width: 300, height: 240 });
    readOnly.surface.load(fixture('led-circuit'));
    readOnly.surface.fit();
    const seen = listen(readOnly.surface, 'edit');
    await hands.tap('mouse', clientOf(readOnly.surface, homeOf(readOnly.surface, 'battery.minus')));
    expect(readOnly.surface.wiring.waitingFrom).toBeUndefined();
    expect(seen).toEqual([]);
    readOnly.unmount();
  }, LONG_MS);

  it('gives a socket press to a pinch when a second finger lands: two fingers always move the view', async () => {
    load(bench.surface, sockets());
    const edits = listen(bench.surface, 'edit');
    const a = socketAt('battery.minus');
    const b = client(EMPTY);
    const frame = window.frameElement?.getBoundingClientRect();
    const page = (point: Vec2): Vec2 => ({ x: (frame?.left ?? 0) + point.x, y: (frame?.top ?? 0) + point.y });
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...page(a), id: 0 }, { ...page(b), id: 1 }] });
    await cdp().send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { ...page({ x: a.x - 40, y: a.y }), id: 0 },
        { ...page({ x: b.x + 40, y: b.y }), id: 1 },
      ],
    });
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => bench.surface.input.busy, { timeout: 30_000 }).toBe(false);
    expect(bench.surface.zoom).toBeGreaterThan(0.75);
    expect(bench.surface.wiring.waitingFrom).toBeUndefined();
    expect(edits).toEqual([]);
  });
});

/**
 * Crowded sockets at the default zoom on a robot (review R-3.1, finding 2): a tap among a crowd fans it out so each
 * socket has a 44 px target of its own; a wire lifted where a crowd overlaps never lands, and waits while the crowd
 * fans out; every wire planWire accepts can be drawn to and from each crowded socket by every hand.
 */
const crowdedSuite = (name: string, build: () => Blueprint, against: () => Catalogue, options: Parameters<typeof mountWorkbench>[1] | undefined): void => {
  describe(`crowded sockets on ${name}, at the default zoom (review R-3.1, finding 2)`, () => {
    let own: Workbench | undefined;
    const workbench = (): Workbench => own ?? bench;

    beforeAll(async () => {
      if (options) own = await mountWorkbench(CANVAS, options);
    }, MOUNT_MS);

    afterAll(() => {
      own?.unmount();
    });

    const robot = (): CanvasSurface => {
      const { surface, tray } = workbench();
      reset(surface);
      surface.setRemoveTargets([tray]);
      load(surface, build(), { x: 25, y: 0 }, 1);
      return surface;
    };

    /** The middle of two of a crowd's sockets that overlap: a press there cannot tell them apart. */
    const overlapOf = (surface: CanvasSurface, keys: readonly string[]): Vec2 => {
      for (const a of keys) {
        for (const b of keys) {
          const pa = homeOf(surface, a);
          const pb = homeOf(surface, b);
          if (a !== b && distance(pa, pb) < PORT_MM) return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        }
      }
      throw new Error(`no overlap in ${keys.join()}`);
    };

    const away = (surface: CanvasSurface): Vec2 => client({ x: -80, y: 75 }, surface);

    it('fans a crowd out on a tap among it, so each socket has its own 44 px target, which a tap then picks', async () => {

      const hands = handsOf();
      const surface = robot();
      const crowds = surface.wiring.crowded.list;
      expect(crowds.length).toBeGreaterThan(0);
      for (const crowd of crowds) {
        const keys = crowd.members.map((member) => member.key);
        const overlap = client(overlapOf(surface, keys), surface);
        await hands.tap('touch', overlap);
        const fanned = surface.wiring.fanned as ReadonlyMap<string, Vec2>;
        expect(fanned && [...fanned.keys()].sort(), crowd.id).toEqual(crowd.members.flatMap((member) => member.ports.map((port) => port.key)).sort());
        for (const key of keys) {
          const at = fanned.get(key) as Vec2;
          for (const other of keys) if (other !== key) expect(px(at, fanned.get(other) as Vec2, surface), `${key} and ${other}`).toBeGreaterThanOrEqual(44);
          const screen = surface.camera.worldToScreen(at);
          expect(screen.x > 22 && screen.y > 22 && screen.x < CANVAS.width - 22 && screen.y < CANVAS.height - 22, `${key} on screen`).toBe(true);
        }
        // A tap on each fanned socket makes it, and nothing else, the source of a wire; a tap away lets it go.
        for (const key of keys) {
          if (!surface.wiring.fanned) await hands.tap('touch', overlap);
          await hands.tap('mouse', client(placeOf(surface, key), surface));
          expect(surface.wiring.waitingFrom, key).toEqual(ref(key));
          await hands.tap('mouse', away(surface));
          expect(surface.wiring.waitingFrom, key).toBeUndefined();
        }
      }
    }, LONG_MS);

    it('never lands a wire on the wrong part’s socket: lifted where a crowd overlaps, the wire waits while the crowd fans out', async () => {

      const hands = handsOf();
      const source = 'battery.minus';
      let checked = 0;
      for (const crowd of robot().wiring.crowded.list) {
        for (const member of crowd.members) {
          const surface = robot();
          const edits = listen(surface, 'edit');
          const keys = crowd.members.map((each) => each.key);
          const before = surface.blueprint as Blueprint;
          const plan = planWire(before, against(), ref(source), ref(member.key));
          const anyTakes = keys.some((key) => planWire(before, against(), ref(source), ref(key)).legal);
          const label = `${source} to ${member.key}`;
          const overlap = client(overlapOf(surface, keys), surface);
          await hands.press('touch', socketAt(source, surface), [overlap]);
          await hands.lift('touch', overlap);
          expect(edits, label).toEqual([]);
          if (!anyTakes) {
            // No socket of the crowd takes it: refused there, and nothing to fan out for.
            expect(keys, label).toContain(surface.wiring.cue?.refused && `${surface.wiring.cue.refused.part}.${surface.wiring.cue.refused.port}`);
            continue;
          }
          expect(surface.wiring.fanned?.has(member.key), label).toBe(true);
          expect(surface.wiring.waitingFrom, label).toEqual(ref(source));
          // The tap on the socket where it went decides, by planWire: it takes the wire, or refuses it.
          await hands.tap('mouse', client(placeOf(surface, member.key), surface));
          if (plan.legal) {
            expect(edits.map((edit) => edit.command), label).toEqual([{ kind: 'connect', from: ref(source), to: ref(member.key) }]);
          } else {
            expect(edits, label).toEqual([]);
            expect(surface.wiring.cue, label).toEqual(expect.objectContaining({ refused: ref(member.key), code: plan.code }));
          }
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }, LONG_MS);

    it('draws a wire to and from each crowded socket by every hand, through the fan, wherever planWire takes one', async () => {

      const hands = handsOf();
      let count = 0;
      const first = robot();
      const crowded = new Set(first.wiring.crowded.list.flatMap((crowd) => crowd.members.flatMap((member) => member.ports.map((port) => port.key))));
      const roomy = drawnSockets(first.scene).map((port) => port.key).filter((key) => !crowded.has(key)).sort();
      for (const key of [...crowded].sort()) {
        const partner = roomy.find((other) => planWire(first.blueprint as Blueprint, against(), ref(key), ref(other)).legal);
        if (!partner) continue;
        for (const [from, to] of [
          [key, partner],
          [partner, key],
        ] as const) {
          const surface = robot();
          const edits = listen(surface, 'edit');
          const path = PATHS[count % PATHS.length] as (typeof PATHS)[number];
          await hands.wire(surface, path.hand, path.how, ref(from), ref(to));
          expect(edits.map((edit) => edit.command), `${from} to ${to} by ${path.hand} ${path.how}`).toEqual([{ kind: 'connect', from: ref(from), to: ref(to) }]);
          count += 1;
        }
      }
      expect(count).toBeGreaterThan(4);
    }, LONG_MS);
  });
};

crowdedSuite('the bumper robot', () => fixture('bumper-robot'), () => catalogue, undefined);
crowdedSuite('the Circuit Crew kit robot', () => crewRobot, () => crewCatalogue, { catalogue: crewCatalogue });

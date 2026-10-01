// Placing, moving, turning and removing parts by touch and pointer (brief Section 10, task 3.2): the forgiveness
// radius and drag sensitivity, the free spot, remove targets, D34 (moving takes a part off; it re-snaps near a free
// mount point), what a removal says (D35), the move, rotate and bin handles (D44) and their place above every socket,
// the Delete key, props (D36) and `apply`. Real input through CDP, in the iPad profile.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { serializeBlueprint } from '@servo/schema';
import type { Blueprint, Vec2 } from '@servo/schema';
import { validBlueprints } from '@servo/schema/fixtures';
import type { EditEvent, PropTemplate } from '../../src/interface.ts';
import { FREE_GAP_MM, separation } from '../../src/placement/free-spot.ts';
import type { HandleKind } from '../../src/placement/overlays.ts';
import { tileOutline } from '../../src/placement/rules.ts';
import { PORT_MM } from '../../src/scene/units.ts';
import { blueprintOf, fixture, record, twentyFiveParts } from '../helpers/catalogue.ts';
import { PREFS, listen, mount, pointer, reset, unmountAll } from './helpers.ts';
import { clientOf, drag, lift, middleOf, mountWorkbench, press, tap } from './placing.ts';
import type { Workbench } from './placing.ts';

let bench: Workbench;

/** A canvas a little smaller than the profile, so a software GPU draws each input's frame quickly. */
beforeAll(async () => {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  bench = await mountWorkbench({ width: 600, height: 420 });
});

beforeEach(() => {
  reset(bench.surface);
  bench.surface.setRemoveTargets([bench.tray]);
});

afterAll(async () => {
  bench.unmount();
  unmountAll();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const chassisOnly = (): Blueprint =>
  blueprintOf({ parts: [{ id: 'p1', part: 'chassis', position: { x: 0, y: 0 }, rotation: 0, settings: {} }], wires: [] });

const load = (build: Blueprint): void => {
  const result = bench.surface.load(build);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join());
};

const at = (id: string): Vec2 & { rotation: number } => {
  const part = bench.surface.blueprint?.parts.find((candidate) => candidate.id === id);
  if (!part) throw new Error(`no part ${id}`);
  return { ...part.position, rotation: part.rotation };
};

const client = (world: Vec2): Vec2 => clientOf(bench.surface, world);

const shift = (point: Vec2, dx: number, dy: number): Vec2 => ({ x: point.x + dx, y: point.y + dy });

const mountOf = (id: string): string | undefined => {
  const wire = bench.surface.blueprint?.wires.find((candidate) => candidate.from.part === id && candidate.from.port === 'mount');
  return wire && `${wire.to.part}.${wire.to.port}`;
};

/** Whether a part's tile keeps the free-spot clearance from every other tile but those that move with it. */
const clearOfOthers = (id: string, group: readonly string[] = []): boolean => {
  const build = bench.surface.blueprint as Blueprint;
  const pose = (placed: Blueprint['parts'][number]) => ({ ...placed.position, rotation: placed.rotation, mirrored: false });
  const self = build.parts.find((part) => part.id === id) as Blueprint['parts'][number];
  const tile = tileOutline(record(self.part), pose(self));
  return build.parts.every(
    (other) => other.id === id || group.includes(other.id) || separation(tile, tileOutline(record(other.part), pose(other))) >= FREE_GAP_MM - 1e-9,
  );
};

/** An empty spot of workbench inside the 600 × 420 canvas at the default view (±120 × ±84 mm). */
const EMPTY = { x: 105, y: 75 };

/** The handles beside the selected part, where they are drawn now. */
const handles = (): ReadonlyMap<HandleKind, Vec2> => bench.surface.placement.handlePlaces.places;

const handle = (kind: HandleKind): Vec2 => {
  const place = handles().get(kind);
  if (!place) throw new Error(`no ${kind} handle`);
  return place;
};

describe('placing from the tray', () => {
  it('snaps a dragged part onto a free mount point within 48 px, and not beyond', async () => {
    load(chassisOnly());
    bench.tile('battery-pack-2-cell', 'drag');
    // 40 px from the deck's middle mount point: it snaps there.
    await drag('mouse', middleOf(bench.tray), shift(client({ x: 0, y: 0 }), 40, 0));
    expect(mountOf('p2')).toBe('p1.deck-middle');
    expect(at('p2')).toEqual({ x: 0, y: 0, rotation: 0 });
    // 60 px from every free mount point: no snap. On top of the chassis, it slides to the nearest free spot.
    load(chassisOnly());
    await drag('touch', middleOf(bench.tray), shift(client({ x: 0, y: 0 }), 0, -60));
    expect(mountOf('p2')).toBeUndefined();
    expect(clearOfOthers('p2')).toBe(true);
  });

  it('forgives more at a lower drag sensitivity (D44)', async () => {
    load(chassisOnly());
    bench.surface.setPrefs({ ...PREFS, dragSensitivity: 0.5 });
    bench.tile('battery-pack-2-cell', 'drag');
    await drag('mouse', middleOf(bench.tray), shift(client({ x: 0, y: 0 }), 0, -60));
    expect(mountOf('p2')).toBe('p1.deck-middle');
  });

  it('lands a part dropped free exactly there, and slides one dropped on another to the nearest free spot', async () => {
    load(fixture('led-circuit'));
    bench.tile('led', 'drag');
    await drag('mouse', middleOf(bench.tray), client({ x: 60, y: 70 }));
    expect(at('p1')).toEqual({ x: 60, y: 70, rotation: 0 });
    await drag('touch', middleOf(bench.tray), client({ x: -80, y: 0 }));
    const slid = at('p2');
    expect(slid.x !== -80 || slid.y !== 0).toBe(true);
    expect(clearOfOthers('p2')).toBe(true);
    expect(Math.hypot(slid.x + 80, slid.y)).toBeLessThan(70);
  });

  it('places nothing when the drag ends back over the tray', async () => {
    load(fixture('led-circuit'));
    const edits = listen(bench.surface, 'edit');
    const placements = listen(bench.surface, 'placement');
    bench.tile('switch', 'drag');
    await press('mouse', middleOf(bench.tray), [client({ x: 0, y: 40 })]);
    expect(bench.surface.placement.placing).toBe(true);
    await lift('mouse', shift(middleOf(bench.tray), 0, 20));
    expect(edits).toEqual([]);
    expect(placements).toEqual([{ kind: 'part', part: 'switch', placed: false }]);
    expect(bench.surface.placement.placing).toBe(false);
  });

  it('lands a part let go off the canvas, but not over the tray, on the canvas at its edge', async () => {
    load(fixture('led-circuit'));
    bench.tile('led', 'drag');
    const box = bench.surface.canvas.getBoundingClientRect();
    await drag('mouse', middleOf(bench.tray), { x: box.left + 300, y: box.bottom + 150 });
    const placed = at('p1');
    expect(bench.surface.camera.worldToScreen(placed).y).toBeLessThanOrEqual(box.height + 1);
    expect(placed.y).toBeGreaterThan(0);
  });

  it('waits for the tap after a tap on a tile, and cancelPlacement ends the wait', async () => {
    load(fixture('led-circuit'));
    const edits = listen(bench.surface, 'edit');
    const placements = listen(bench.surface, 'placement');
    bench.surface.beginPlacement('switch');
    expect(bench.surface.placement.placing).toBe(true);
    bench.surface.cancelPlacement();
    expect(placements).toEqual([{ kind: 'part', part: 'switch', placed: false }]);
    await tap('touch', client({ x: 60, y: 70 }));
    expect(edits).toEqual([]);
  });

  it('ends a placement it cannot take at once, not placed, and apply refuses: Run mode, read-only, nothing loaded', async () => {
    load(fixture('led-circuit'));
    const placements = listen(bench.surface, 'placement');
    bench.surface.setMode('run');
    bench.surface.beginPlacement('led');
    bench.surface.setMode('build');
    bench.surface.beginPlacement('led');
    bench.surface.beginPlacement('switch');
    bench.surface.beginPlacement('flux-capacitor');
    expect(placements).toEqual([
      { kind: 'part', part: 'led', placed: false },
      { kind: 'part', part: 'led', placed: false },
      { kind: 'part', part: 'switch', placed: false },
      { kind: 'part', part: 'flux-capacitor', placed: false },
    ]);
    const readOnly = await mount({ readOnly: true }, { width: 200, height: 200 });
    const elsewhere = await mount({}, { width: 200, height: 200 });
    const seen: unknown[] = [];
    readOnly.surface.on('placement', (event) => seen.push(event));
    elsewhere.surface.on('placement', (event) => seen.push(event));
    readOnly.surface.load(fixture('led-circuit'));
    readOnly.surface.beginPlacement('led');
    elsewhere.surface.beginPlacement('led');
    expect(seen).toEqual([
      { kind: 'part', part: 'led', placed: false },
      { kind: 'part', part: 'led', placed: false },
    ]);
    // `apply` refuses there too: locked on a read-only canvas, and nothing to build on before a load.
    expect(readOnly.surface.apply({ kind: 'rename', name: 'Mine' })).toEqual({ ok: false, refusal: expect.objectContaining({ code: 'edit.locked' }) });
    expect(elsewhere.surface.apply({ kind: 'rename', name: 'Mine' })).toEqual({ ok: false, refusal: expect.objectContaining({ code: 'edit.no_build' }) });
    readOnly.unmount();
    elsewhere.unmount();
  });
});

describe('snap or slide (brief Section 10)', () => {
  beforeAll(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] });
  });

  afterAll(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  });

  const drawnAt = (id: string): Vec2 => {
    const node = bench.surface.partView(id)?.node;
    return { x: node?.position.x ?? NaN, y: node?.position.y ?? NaN };
  };

  it('snaps a part let go within reach of a free spot there at once, and slides one let go in the void', async () => {
    load(fixture('led-circuit'));
    bench.tile('led', 'drag');
    // Just over the battery pack's edge: the free spot is 10 mm (25 px) away.
    await drag('mouse', middleOf(bench.tray), client({ x: -80, y: 35 }));
    expect(at('p1')).toEqual({ x: -80, y: 45, rotation: 0 });
    expect(drawnAt('p1')).toEqual({ x: -80, y: 45 });
    // On the middle of the battery pack: the free spot is out of reach, so the part slides there from the drop. The
    // page's frames are held while it lands, so the slide can be seen at its start.
    await press('mouse', middleOf(bench.tray), [client({ x: -80, y: -5 })]);
    const original = window.requestAnimationFrame;
    const held: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => {
      held.push(callback);
      return 0;
    };
    try {
      await lift('mouse', client({ x: -80, y: -5 }));
      const landed = at('p2');
      expect(Math.hypot(landed.x + 80, landed.y + 5) * 2.5).toBeGreaterThan(48);
      expect(drawnAt('p2')).toEqual({ x: -80, y: -5 });
    } finally {
      window.requestAnimationFrame = original;
      for (const callback of held) original.call(window, callback);
    }
    const landed = at('p2');
    await expect.poll(() => drawnAt('p2'), { timeout: 2000 }).toEqual({ x: landed.x, y: landed.y });
  });
});

describe('moving a part (D34)', () => {
  it('moves a loose part with a mouse drag, and its wires follow it on the way', async () => {
    load(fixture('led-circuit'));
    const edits = listen(bench.surface, 'edit');
    await press('mouse', client({ x: 80, y: 0 }), [client({ x: 80, y: 20 }), client({ x: 80, y: 60 })]);
    const node = bench.surface.partView('led')?.node;
    expect([node?.position.x, node?.position.y]).toEqual([80, 60]);
    const minus = bench.surface.scene.portByKey.get('led.minus');
    const line = bench.surface.wireView('w3')?.graphics.getLocalBounds();
    expect(line && minus && line.maxY).toBeGreaterThan((minus?.at.y ?? 0) + 50);
    await lift('mouse', client({ x: 80, y: 60 }));
    expect(edits.map((edit) => edit.command)).toEqual([{ kind: 'move-part', partId: 'led', position: { x: 80, y: 60 } }]);
    expect(at('led')).toEqual({ x: 80, y: 60, rotation: 0 });
  });

  it('moves the whole robot when the chassis is dragged by a finger', async () => {
    const robot = fixture('rolling-start');
    load(robot);
    await drag('touch', client({ x: -45, y: 40 }), client({ x: -5, y: 60 }));
    for (const part of robot.parts) expect(at(part.id), part.id).toEqual({ x: part.position.x + 40, y: part.position.y + 20, rotation: 0 });
  });

  it('re-snaps a part dropped near another free mount point, as one mount', async () => {
    load(fixture('rolling-start'));
    const edits = listen(bench.surface, 'edit');
    await drag('mouse', client({ x: -45, y: 0 }), client({ x: 0, y: 0 }));
    expect(edits.map((edit) => edit.command)).toEqual([{ kind: 'mount', partId: 'battery', port: 'mount', onto: { part: 'chassis', port: 'deck-middle' } }]);
    expect(mountOf('battery')).toBe('chassis.deck-middle');
    expect(at('battery')).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it('takes a part dropped away from every mount point off its mount, with what it carries', async () => {
    load(fixture('rolling-start'));
    await drag('touch', client({ x: 30, y: -53 }), client({ x: 30, y: -75 }));
    expect(mountOf('motor-left')).toBeUndefined();
    const motor = at('motor-left');
    expect(at('wheel-left')).toEqual({ x: motor.x + 10, y: motor.y - 26, rotation: 0 });
    expect(clearOfOthers('motor-left', ['wheel-left'])).toBe(true);
  });

  it('changes nothing when a part is dropped back on its own mount point or its own shaft', async () => {
    const robot = fixture('rolling-start');
    load(robot);
    const edits = listen(bench.surface, 'edit');
    await press('mouse', client({ x: -45, y: 0 }), [client({ x: -30, y: 0 })]);
    await lift('mouse', client({ x: -44, y: 1 }));
    await press('touch', client({ x: 40, y: -79 }), [client({ x: 40, y: -60 })]);
    await lift('touch', client({ x: 41, y: -78 }));
    expect(edits).toEqual([]);
    expect(bench.surface.blueprint).toEqual(robot);
    expect(bench.surface.partView('battery')?.node.position.x).toBe(-45);
  });

  it('pinches instead when two fingers land on a part: two fingers always move the view', async () => {
    load(fixture('rolling-start'));
    const edits = listen(bench.surface, 'edit');
    const a = client({ x: -45, y: 40 });
    const b = client({ x: 20, y: 40 });
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 0 }, { ...b, id: 1 }] });
    await cdp().send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { ...shift(a, -40, 0), id: 0 },
        { ...shift(b, 40, 0), id: 1 },
      ],
    });
    await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(bench.surface.zoom).toBeGreaterThan(1);
    expect(edits).toEqual([]);
  });
});

describe('the handles (D44)', () => {
  it('shows move, rotate and bin beside a tapped free part, on its left for left-handed use', async () => {
    load(fixture('led-circuit'));
    expect(bench.surface.placement.selectedPart).toBeUndefined();
    await tap('mouse', client({ x: 80, y: 0 }));
    expect(bench.surface.placement.selectedPart).toBe('led');
    expect([...handles().keys()]).toEqual(['move', 'rotate', 'bin']);
    expect(handle('rotate').x).toBeGreaterThan(at('led').x);
    await tap('touch', client(handle('rotate')));
    expect(at('led').rotation).toBe(90);
    bench.surface.setPrefs({ ...PREFS, leftHanded: true });
    expect(handle('rotate').x).toBeLessThan(at('led').x);
    await tap('mouse', client(handle('rotate')));
    expect(at('led').rotation).toBe(180);
    await tap('touch', client({ x: -20, y: 60 }));
    expect(bench.surface.placement.selectedPart).toBeUndefined();
    expect(handles().size).toBe(0);
  });

  it('gives a part held by a mount or a shaft no rotate handle, and says why in one line', async () => {
    load(fixture('rolling-start'));
    await tap('mouse', client({ x: -45, y: 0 }));
    expect(bench.surface.placement.selectedPart).toBe('battery');
    expect([...handles().keys()]).toEqual(['move', 'bin']);
    expect(bench.surface.placement.notice).toBe('Held by its mount: move it off to turn it');
    await tap('touch', client({ x: 40, y: -79 }));
    expect(bench.surface.placement.selectedPart).toBe('wheel-left');
    expect([...handles().keys()]).toEqual(['move', 'bin']);
    expect(bench.surface.placement.notice).toBe('Held on a shaft: move it off to turn it');
    await tap('touch', client(EMPTY));
    expect(bench.surface.placement.notice).toBeUndefined();
  });

  it('keeps the handles 44 px across at every zoom, inside the view', () => {
    load(fixture('led-circuit'));
    bench.surface.placement.selectPart('led');
    for (const zoom of [0.5, 1, 2]) {
      bench.surface.setZoom(zoom);
      bench.surface.camera.centreX = 80;
      bench.surface.camera.centreY = 0;
      bench.surface.placement.selectPart(undefined);
      bench.surface.placement.selectPart('led');
      const { radius, places } = bench.surface.placement.handlePlaces;
      expect(2 * radius * bench.surface.camera.scale, `zoom ${zoom}`).toBeCloseTo(44, 9);
      const view = bench.surface.camera.visible();
      for (const [kind, place] of places) {
        expect(place.x - radius >= view.minX && place.x + radius <= view.maxX, `${kind} at zoom ${zoom}`).toBe(true);
        expect(place.y - radius >= view.minY && place.y + radius <= view.maxY, `${kind} at zoom ${zoom}`).toBe(true);
      }
    }
  });

  it('turns a free part in quarter turns as the rotate handle is dragged round it, as a tap and the list view do', async () => {
    load(fixture('led-circuit'));
    await tap('mouse', client({ x: 80, y: 0 }));
    const rotate = handle('rotate');
    const centre = { x: 80, y: 0 };
    const radius = Math.hypot(rotate.x - centre.x, rotate.y - centre.y);
    const round = (degrees: number): Vec2 => {
      const angle = Math.atan2(rotate.y - centre.y, rotate.x - centre.x) + (degrees * Math.PI) / 180;
      return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
    };
    // Through 30°: not yet half a quarter turn, so nothing changes.
    await drag('touch', client(rotate), client(round(30)), 4);
    expect(at('led').rotation).toBe(0);
    await drag('mouse', client(handle('rotate')), client(round(100)), 4);
    expect(at('led').rotation).toBe(90);
  });

  it('removes a part with the bin, with the Delete key, and by dragging it onto the tray', async () => {
    load(fixture('led-circuit'));
    const edits = listen(bench.surface, 'edit');
    await tap('touch', client({ x: 80, y: 0 }));
    await tap('touch', client(handle('bin')));
    await tap('mouse', client({ x: 0, y: -60 }));
    expect(document.activeElement).toBe(bench.surface.canvas);
    await userEvent.keyboard('{Delete}');
    await drag('mouse', client({ x: -80, y: 0 }), middleOf(bench.tray), 3);
    expect(edits.map((edit: EditEvent) => edit.command)).toEqual([
      { kind: 'remove-part', partId: 'led' },
      { kind: 'remove-part', partId: 'switch' },
      { kind: 'remove-part', partId: 'battery' },
    ]);
    expect(bench.surface.blueprint?.parts).toEqual([]);
  });
});

describe('what a removal says (brief Section 10: "removes its wires and says so"; D35)', () => {
  it('names the wires that went and the parts it left loose, in one plain line, by any path, until the next change', async () => {
    load(fixture('led-circuit'));
    await tap('mouse', client({ x: 80, y: 0 }));
    await tap('mouse', client(handle('bin')));
    expect(bench.surface.placement.notice).toBe('Removed with it: 2 wires');
    const robot = fixture('rolling-start');
    load(robot);
    expect(bench.surface.placement.notice).toBeUndefined();
    await tap('mouse', client({ x: -45, y: 40 }));
    expect(bench.surface.placement.selectedPart).toBe('chassis');
    await tap('touch', client(handle('bin')));
    // Real names, each once: the two DC motors are one entry. The chassis had no wires, only what it held.
    expect(bench.surface.placement.notice).toBe('Loose now: 2-cell battery pack, caster, DC motor and switch');
    for (const id of ['battery', 'switch', 'motor-left']) expect(at(id)).toEqual({ ...robot.parts.find((part) => part.id === id)?.position, rotation: 0 });
    await tap('touch', client(EMPTY));
    expect(bench.surface.placement.notice).toBeUndefined();
    load(robot);
    bench.surface.apply({ kind: 'remove-part', partId: 'motor-left' });
    expect(bench.surface.placement.notice).toBe('Removed with it: 2 wires. Loose now: large wheel');
    bench.surface.apply({ kind: 'rename', name: 'Two wheels' });
    expect(bench.surface.placement.notice).toBeUndefined();
  });

  it('is undone whole: loading the build from before the removal brings back the part, its wires and what it held', async () => {
    const robot = fixture('rolling-start');
    load(robot);
    const history: Blueprint[] = [bench.surface.blueprint as Blueprint];
    const off = bench.surface.on('edit', ({ blueprint }) => history.push(blueprint));
    try {
      await tap('mouse', client({ x: 30, y: -53 }));
      await tap('mouse', client(handle('bin')));
      expect(history).toHaveLength(2);
      expect(bench.surface.blueprint?.wires.some((wire) => wire.from.part === 'motor-left' || wire.to.part === 'motor-left')).toBe(false);
      // The app's Undo: load the build the edit before this one left.
      expect(bench.surface.load(history[0] as Blueprint).ok).toBe(true);
      expect(serializeBlueprint(bench.surface.blueprint as Blueprint)).toBe(serializeBlueprint(robot));
      expect(bench.surface.placement.notice).toBeUndefined();
      expect(history).toHaveLength(2);
    } finally {
      off();
    }
  });
});

describe('handles never sit under a socket (brief Section 9: ports and handles above wires, above parts)', () => {
  const builds: readonly [string, Blueprint][] = [...validBlueprints.map((entry): [string, Blueprint] => [entry.name, fixture(entry.name)]), ['twenty-five-parts', twentyFiveParts]];
  const reach = (PORT_MM / 2) * (2 / Math.sqrt(3));

  it('draws the rings and handles above every socket after each redraw', () => {
    load(fixture('rolling-start'));
    bench.surface.placement.selectPart('battery');
    bench.surface.apply({ kind: 'rename', name: 'Redrawn' });
    const layered = bench.surface.layers?.ports.renderLayerChildren.map((child) => child.label) ?? [];
    expect(layered.slice(-2)).toEqual(['snap targets', 'handles']);
  });

  it('lays them out clear of every socket on every fixture, with either hand, at every zoom', () => {
    for (const [name, build] of builds) {
      load(build);
      for (const leftHanded of [false, true]) {
        bench.surface.setPrefs({ ...PREFS, leftHanded });
        for (const zoom of [0.5, 1, 2]) {
          Object.assign(bench.surface.camera, { centreX: 0, centreY: 0, zoom });
          for (const part of bench.surface.scene.parts) {
            bench.surface.placement.selectPart(undefined);
            bench.surface.placement.selectPart(part.id);
            const { places, radius } = bench.surface.placement.handlePlaces;
            for (const [kind, place] of places) {
              for (const socket of bench.surface.scene.parts.flatMap((other) => other.ports.filter((port) => port.layer === 'ports'))) {
                const gap = Math.hypot(place.x - socket.at.x, place.y - socket.at.y);
                expect(gap, `${name}: ${part.id}'s ${kind} on ${socket.key}, zoom ${zoom}, left-handed ${leftHanded}`).toBeGreaterThanOrEqual(radius + reach - 1e-9);
              }
            }
          }
        }
      }
    }
  });

  it('never acts on a handle when any socket of any fixture is tapped, whichever part is selected', () => {
    for (const [name, build] of builds) {
      load(build);
      const edits = listen(bench.surface, 'edit');
      for (const leftHanded of [false, true]) {
        bench.surface.setPrefs({ ...PREFS, leftHanded });
        Object.assign(bench.surface.camera, { centreX: 0, centreY: 0, zoom: 1 });
        const sockets = bench.surface.scene.parts.flatMap((part) => part.ports.filter((port) => port.layer === 'ports'));
        for (const part of bench.surface.scene.parts) {
          for (const socket of sockets) {
            bench.surface.placement.selectPart(part.id);
            const at = bench.surface.camera.worldToScreen(socket.at);
            pointer(bench.surface.canvas, 'pointerdown', at);
            pointer(bench.surface.canvas, 'pointerup', at);
            expect(bench.surface.placement.moving, `${name}: ${socket.key} with ${part.id} selected`).toBeUndefined();
          }
        }
      }
      expect(edits, name).toEqual([]);
    }
  });

  it('removes nothing when the servo motor’s signal socket is tapped beside the selected motor driver (R-3.2)', async () => {
    load(fixture('bumper-robot'));
    const edits = listen(bench.surface, 'edit');
    bench.surface.placement.selectPart('driver');
    const signal = bench.surface.scene.portByKey.get('servo.signal');
    if (!signal) throw new Error('no servo signal socket');
    await tap('touch', client(signal.at));
    await tap('mouse', client(signal.at));
    expect(edits).toEqual([]);
    expect(bench.surface.blueprint?.parts.some((part) => part.id === 'driver')).toBe(true);
  });
});

describe('props from the arena strip (D36)', () => {
  const box: PropTemplate = { shape: 'box', size: { x: 100, y: 100, z: 60 }, grams: 80, fixed: false };

  it('places a prop by drag and by tap-then-tap, moves it, and removes it onto the strip', async () => {
    // The Rolling Start robot sits on the open floor's start pose (300, 600): canvas (x, y) is arena (300 + x, 600 − y).
    load(fixture('rolling-start'));
    Object.assign(bench.surface.camera, { centreX: 150, centreY: 0 });
    const edits = listen(bench.surface, 'edit');
    bench.tile(box, 'drag');
    await drag('mouse', middleOf(bench.tray), client({ x: 190, y: -70 }));
    bench.tile(box, 'tap');
    await tap('touch', middleOf(bench.tray));
    await tap('touch', client({ x: 190, y: 70 }));
    await drag('touch', client({ x: 190, y: -70 }), client({ x: 230, y: -70 }));
    await drag('mouse', client({ x: 190, y: 70 }), middleOf(bench.tray), 3);
    expect(edits.map((edit) => edit.command)).toEqual([
      { kind: 'place-prop', prop: box, at: { x: 490, y: 670, heading: 0 } },
      { kind: 'place-prop', prop: box, at: { x: 490, y: 530, heading: 0 } },
      { kind: 'move-prop', propId: 'prop-1', at: { x: 530, y: 670, heading: 0 } },
      { kind: 'remove-prop', propId: 'prop-2' },
    ]);
    expect(bench.surface.blueprint?.arena.props.map((prop) => [prop.id, prop.at])).toEqual([['prop-1', { x: 530, y: 670, heading: 0 }]]);
  });
});

describe('apply', () => {
  it('fires edit only when the build changes, and refuses in Run mode (read-only and unloaded canvases: above)', () => {
    load(fixture('led-circuit'));
    const edits = listen(bench.surface, 'edit');
    expect(bench.surface.apply({ kind: 'rename', name: 'Lamp' }).ok).toBe(true);
    expect(bench.surface.apply({ kind: 'rename', name: 'Lamp' }).ok).toBe(true);
    expect(bench.surface.apply({ kind: 'rename', name: '' })).toEqual({ ok: false, refusal: expect.objectContaining({ code: 'value.bad_format' }) });
    expect(edits.map((edit) => edit.blueprint.meta.name)).toEqual(['Lamp']);
    bench.surface.setMode('run');
    expect(bench.surface.apply({ kind: 'rename', name: 'Run' })).toEqual({ ok: false, refusal: expect.objectContaining({ code: 'edit.locked' }) });
    bench.surface.setMode('build');
    expect(bench.surface.apply({ kind: 'rename', name: 'Built' }).ok).toBe(true);
  });
});

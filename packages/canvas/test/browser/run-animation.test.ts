// Run mode in the browser (task 3.5), with frames built by hand (test/helpers/run-frames.ts): the robot moving as one,
// the build locked, switch flips, a stalled motor's shudder, a tipped robot's fall and shadow, the spin-up's flowing
// dots, the tween between slow ticks, and Stop putting everything back. Real fixtures run through sim-core in
// packages/tools/test/e2e/run-animation.e2e.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serializeBlueprint } from '@servo/schema';
import type { Vec2 } from '@servo/schema';
import { SHUDDER_MM } from '../../src/run-animation/look.ts';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { fixture } from '../helpers/catalogue.ts';
import { rollingStartFrame } from '../helpers/run-frames.ts';
import { colourDistance, frames, listen, mount, pointer, reset, settle, shoot } from './helpers.ts';
import type { Mounted } from './helpers.ts';

const rolling = fixture('rolling-start');

let mounted: Mounted;
let surface: CanvasSurface;

beforeAll(async () => {
  mounted = await mount();
  surface = mounted.surface;
});

afterAll(() => mounted.unmount());

beforeEach(async () => {
  reset(surface);
  surface.load(rolling);
  await settle(surface);
});

/** Run mode with these frames applied one after another, as fast as the app could. */
const run = async (...ticks: Parameters<typeof rollingStartFrame>[]): Promise<void> => {
  surface.setMode('run');
  for (const args of ticks) surface.applyRunFrame(rollingStartFrame(...args));
  await settle(surface);
};

const nodePosition = (id: string): Vec2 => {
  const node = surface.partView(id)?.node;
  return { x: node?.position.x ?? Number.NaN, y: node?.position.y ?? Number.NaN };
};

describe('Run mode draws the frames it is given', () => {
  it('draws the build as it stands in Run mode until the first frame', async () => {
    surface.setMode('run');
    await settle(surface);
    expect(surface.scene.parts.every((part) => surface.partView(part.id)?.run.visible === false)).toBe(true);
    surface.applyRunFrame(rollingStartFrame(0));
    surface.applyRunFrame(rollingStartFrame(1));
    await settle(surface);
    expect(surface.partView('wheel-left')?.run.visible).toBe(true);
  });

  it('ignores frames in Build mode', async () => {
    surface.applyRunFrame(rollingStartFrame(0, { x: 400 }));
    await settle(surface);
    expect(surface.run.state).toBeUndefined();
    expect(nodePosition('chassis')).toEqual({ x: 0, y: 0 });
  });

  it('moves the whole robot with its root’s pose, and keeps the build untouched', async () => {
    const built = serializeBlueprint(rolling);
    const edits = listen(surface, 'edit');
    await run([0], [1, { x: 400 }]);
    expect(nodePosition('chassis').x).toBeCloseTo(100, 6);
    expect(nodePosition('wheel-left').x).toBeCloseTo(140, 6);
    expect(surface.run.endsOf('w8')?.[0].x).toBeCloseTo((surface.scene.portByKey.get('battery.plus')?.at.x ?? 0) + 100, 6);
    expect(surface.apply({ kind: 'rename', name: 'Changed' })).toMatchObject({ ok: false, refusal: { code: 'edit.locked' } });
    expect(edits).toHaveLength(0);
    expect(serializeBlueprint(surface.blueprint ?? rolling)).toBe(built);
  });

  it('hit-tests parts where the Run draws them, and wires take no new ends', async () => {
    const edits = listen(surface, 'edit');
    await run([0], [1, { x: 400 }]);
    const moved = surface.camera.worldToScreen({ x: 100, y: 0 });
    expect(surface.hitAt(moved)).toMatchObject({ kind: 'part', part: { id: 'chassis' } });
    // A drag from where a socket was, in Run mode, makes no wire.
    const socket = surface.camera.worldToScreen(surface.scene.portByKey.get('battery.plus')?.at ?? { x: 0, y: 0 });
    pointer(surface.canvas, 'pointerdown', socket);
    pointer(surface.canvas, 'pointermove', { x: socket.x + 120, y: socket.y + 40 });
    pointer(surface.canvas, 'pointerup', { x: socket.x + 120, y: socket.y + 40 });
    await settle(surface);
    expect(edits).toHaveLength(0);
  });
});

describe('switch flips', () => {
  it('a tap on a manual switch asks to flip it the other way, through `control`', async () => {
    const controls = listen(surface, 'control');
    await run([0], [1, { x: 340 }]);
    const at = surface.camera.worldToScreen(surface.run.partPoint('switch', { x: 0, y: 0 }));
    pointer(surface.canvas, 'pointerdown', at);
    pointer(surface.canvas, 'pointerup', at);
    expect(controls).toEqual([{ input: { partId: 'switch', kind: 'switch', closed: false } }]);
    // A tap elsewhere flips nothing.
    const away = surface.camera.worldToScreen(surface.run.partPoint('battery', { x: 0, y: 0 }));
    pointer(surface.canvas, 'pointerdown', away);
    pointer(surface.canvas, 'pointerup', away);
    expect(controls).toHaveLength(1);
    expect(surface.flip('battery')).toBe(false);
  });

  it('fires nothing on a read-only canvas', async () => {
    const other = await mount({ readOnly: true });
    try {
      other.surface.load(rolling);
      other.surface.setMode('run');
      other.surface.applyRunFrame(rollingStartFrame(0));
      other.surface.applyRunFrame(rollingStartFrame(1));
      await settle(other.surface);
      const controls = listen(other.surface, 'control');
      const at = other.surface.camera.worldToScreen(other.surface.run.partPoint('switch', { x: 0, y: 0 }));
      pointer(other.surface.canvas, 'pointerdown', at);
      pointer(other.surface.canvas, 'pointerup', at);
      expect(other.surface.flip('switch')).toBe(false);
      expect(controls).toHaveLength(0);
    } finally {
      other.unmount();
    }
  });
});

describe('fault visuals follow debounced faults', () => {
  it('a stalled motor shudders once a tick, and nothing else does', async () => {
    const stall = { rpm: 0, milliamps: 2400, faults: { 'motor-left': ['overload'] } };
    await run([0, stall], [4, stall]);
    const even = nodePosition('motor-left');
    const evenOther = nodePosition('motor-right');
    const evenShot = await shoot(surface.canvas);
    surface.applyRunFrame(rollingStartFrame(5, stall));
    await settle(surface);
    const odd = nodePosition('motor-left');
    const oddShot = await shoot(surface.canvas);
    expect(Math.hypot(odd.x - even.x, odd.y - even.y)).toBeCloseTo(2 * SHUDDER_MM, 6);
    expect(nodePosition('motor-right'), 'the motor that is not stalled stays put').toEqual(evenOther);
    // The motor's edge moves on screen between the two ticks: some pixel along its outline changes.
    const scene = surface.scene.partById.get('motor-left');
    const edge = (scene?.corners ?? []).map((corner) => surface.camera.worldToScreen(corner));
    const changed = edge.some((corner) =>
      [-3, -1, 1, 3].some((d) => colourDistance(evenShot.at({ x: corner.x + d, y: corner.y }), oddShot.at({ x: corner.x + d, y: corner.y })) > 20),
    );
    expect(changed, 'the shudder shows').toBe(true);
  });

  it('a body that falls is drawn foreshortened, with its wheels still turning and a shadow on its low side', async () => {
    await run([0], [10, { pitch: 0 }], [11, { roll: -85 }]);
    const node = surface.partView('chassis')?.node;
    const height = Math.abs(node?.scale.y ?? 1);
    expect(height).toBeLessThan(0.25);
    expect(surface.run.state?.rims.get('wheel-left')).toBeGreaterThan(0);
    const before = surface.run.shown?.treads.get('wheel-left') ?? 0;
    surface.applyRunFrame(rollingStartFrame(12, { roll: -85 }));
    await settle(surface);
    expect(surface.run.shown?.treads.get('wheel-left') ?? 0).toBeGreaterThan(before);
  });
});

describe('timing belongs to the app', () => {
  it('during the spin-up the wires light and their dots flow, and nothing else moves', async () => {
    surface.setMode('run');
    surface.applyRunFrame(rollingStartFrame(0));
    await frames(3);
    const first = surface.run.dots.dotsOn('w8').map((dot) => ({ ...dot }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await frames(2);
    const later = surface.run.dots.dotsOn('w8');
    expect(first.length).toBeGreaterThan(0);
    expect(later[0]?.x).not.toBe(first[0]?.x);
    expect(surface.run.shown?.treads.get('wheel-left')).toBe(0);
    expect(nodePosition('chassis')).toEqual({ x: 0, y: 0 });
    expect(surface.run.moving).toBe(true);
    // The first tick: the dots carry on to a whole spacing, so tick 1 on looks the same however long the spin-up held.
    surface.applyRunFrame(rollingStartFrame(1));
    await settle(surface);
    const after = surface.run.dots.dotsOn('w8');
    surface.setMode('build');
    await run([0], [1]);
    expect(surface.run.dots.dotsOn('w8')).toEqual(after);
  });

  it('tweens between ticks that arrive slowly, landing on each frame exactly', async () => {
    surface.setMode('run');
    surface.applyRunFrame(rollingStartFrame(0));
    const first = performance.now();
    surface.applyRunFrame(rollingStartFrame(1, { x: 300 }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Frames this far apart: the canvas glides from one to the next over that long. Drawn by hand at a chosen moment.
    const arrived = performance.now();
    surface.applyRunFrame(rollingStartFrame(2, { x: 340 }));
    const spacing = Math.min(1000, arrived - first);
    surface.run.step(arrived + spacing / 2);
    const between = surface.run.shown?.ticks ?? 0;
    expect(between).toBeGreaterThan(1.4);
    expect(between).toBeLessThan(1.6);
    expect(nodePosition('chassis').x).toBeGreaterThan(15);
    expect(nodePosition('chassis').x).toBeLessThan(25);
    await settle(surface);
    expect(surface.run.shown?.ticks).toBe(2);
    expect(nodePosition('chassis').x).toBeCloseTo(40, 6);
  });
});

describe('Stop', () => {
  it('puts every node and line back where the build has them', async () => {
    surface.setMode('build');
    await settle(surface);
    const before = await shoot(surface.canvas);
    await run([0], [1, { x: 380, heading: 30, pitch: 20 }]);
    surface.setMode('build');
    await settle(surface);
    expect(nodePosition('chassis')).toEqual({ x: 0, y: 0 });
    expect(surface.partView('chassis')?.node.skew.x).toBe(0);
    expect(surface.run.dots.dotsOn('w8')).toHaveLength(0);
    const after = await shoot(surface.canvas);
    const probes: Vec2[] = [];
    for (let y = 20; y < 800; y += 37) for (let x = 20; x < 1160; x += 41) probes.push({ x, y });
    expect(probes.filter((at) => colourDistance(before.at(at), after.at(at)) > 6)).toEqual([]);
  });
});

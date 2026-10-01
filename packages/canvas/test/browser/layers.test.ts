// The brief's layer order (Section 9), checked on real screenshots: arena floor and props → grid → chassis →
// mechanical linkages → parts → wires → ports and handles → hints. Pixel probes read the colour at points where
// two layers overlap; a few whole-image snapshots back them up. Art, mirror images and sockets are checked here too.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { Graphics } from 'pixi.js';
import type { Blueprint, PlacedPart, Vec2 } from '@servo/schema';
import type { CanvasSurface } from '../../src/renderer/surface.ts';
import { HIGH_CONTRAST_PALETTE, STANDARD_PALETTE } from '../../src/renderer/style.ts';
import { PORT_PX, PX_PER_MM } from '../../src/scene/units.ts';
import { blueprintOf, fixture } from '../helpers/catalogue.ts';
import { PREFS, artFrom, colourDistance, describeRgb, frames, mount, pointer, rgbOf, settle, shoot, svgArt, unmountAll } from './helpers.ts';
import type { Rgb, Shot } from './helpers.ts';

// Solid pictures in colours no layer of the canvas uses, so a probe says which layer it hit.
const ART = {
  chassis: '#2f8f9d',
  battery: '#2050c0',
  smallBattery: '#b8a020',
  switch: '#20a050',
  led: '#8040c0',
  motorTop: '#c06020',
  motorBottom: '#505050',
  wheel: '#303030',
  caster: '#a0a0a0',
} as const;

const resolveArt = artFrom({
  'part/chassis': svgArt(ART.chassis),
  'part/battery-pack-2-cell': svgArt(ART.battery),
  'part/battery-pack-1-cell': svgArt(ART.smallBattery),
  'part/switch': svgArt(ART.switch),
  'part/led': svgArt(ART.led),
  'part/dc-motor': svgArt(ART.motorTop, ART.motorBottom),
  'part/wheel-large': svgArt(ART.wheel),
  'part/caster': svgArt(ART.caster),
});

const hex = (colour: string): Rgb => rgbOf(Number.parseInt(colour.slice(1), 16));
const RED = rgbOf(STANDARD_PALETTE.types.power.colour);
const GREY = rgbOf(STANDARD_PALETTE.types.mechanical.colour);
const YELLOW = rgbOf(STANDARD_PALETTE.types.signal.colour);
const HOLLOW = rgbOf(STANDARD_PALETTE.socketInner);
const WORKBENCH = rgbOf(STANDARD_PALETTE.workbench);
const FLOOR = rgbOf(STANDARD_PALETTE.floor);
const MAGENTA: Rgb = [255, 0, 255];

const placed = (id: string, part: string, x: number, y: number): PlacedPart => ({ id, part, position: { x, y }, rotation: 0, settings: {} });

/**
 * A row of loose parts with a power line along y = −110.4 that crosses the battery pack and passes under the
 * switch's empty socket; and below, a DC motor whose shaft drives a wheel stored apart from it, so the grey
 * linkage runs under a 1-cell battery pack placed across it.
 */
const probeScene: Blueprint = blueprintOf(
  {
    parts: [
      placed('p1', 'battery-pack-2-cell', -80, -100),
      placed('p2', 'switch', 0, -100),
      placed('p3', 'led', 80, -100),
      placed('p4', 'dc-motor', 0, -20),
      placed('p5', 'wheel-large', 0, 120),
      placed('p6', 'battery-pack-1-cell', 5, 50),
    ],
    wires: [
      { id: 'w1', from: { part: 'p1', port: 'plus' }, to: { part: 'p3', port: 'plus' } },
      { id: 'w2', from: { part: 'p4', port: 'shaft' }, to: { part: 'p5', port: 'hub' } },
    ],
  },
  'Layer probes',
);

/** A signal line between a microcontroller and a servo motor, and a power line, to see the line styles. */
const styleScene: Blueprint = blueprintOf(
  {
    parts: [placed('p1', 'microcontroller', -100, 0), placed('p2', 'servo-motor', 100, 0), placed('p3', 'battery-pack-2-cell', -100, 120)],
    wires: [
      { id: 'w1', from: { part: 'p1', port: 'out-1' }, to: { part: 'p2', port: 'signal' } },
      { id: 'w2', from: { part: 'p3', port: 'plus' }, to: { part: 'p2', port: 'plus' } },
    ],
  },
  'Line styles',
);

let surface: CanvasSurface;
let host: HTMLElement;

beforeAll(async () => {
  ({ surface, host } = await mount({ resolveArt }));
});

afterAll(unmountAll);

/** Loads a build at the default view (canvas origin in the middle, zoom 1) and waits for the final picture. */
const show = async (blueprint: Blueprint, mode: 'build' | 'run' = 'build'): Promise<Shot> => {
  surface.setMode('build');
  surface.setPrefs(PREFS);
  surface.setEmphasis(null);
  expect(surface.load(blueprint).ok).toBe(true);
  surface.setMode(mode);
  Object.assign(surface.camera, { centreX: 0, centreY: 0, zoom: 1 });
  surface.requestFrame();
  await settle(surface);
  return shoot(surface.canvas);
};

/** Screen point of a canvas point at the default view. */
const screen = (point: Vec2): Vec2 => surface.camera.worldToScreen(point);
const port = (key: string): Vec2 => {
  const found = surface.scene.portByKey.get(key);
  if (!found) throw new Error(`no port ${key}`);
  return found.at;
};

const expectColour = (shot: Shot, at: Vec2, expected: Rgb, what: string, tolerance = 12): void => {
  const actual = shot.at(screen(at));
  expect(colourDistance(actual, expected), `${what}: ${describeRgb(actual)} where ${describeRgb(expected)} was expected`).toBeLessThanOrEqual(
    tolerance,
  );
};

describe('layer order, by pixel probes', () => {
  it('draws wires above parts, so a connection is always readable', async () => {
    const shot = await show(probeScene);
    expectColour(shot, { x: -80, y: -100 }, hex(ART.battery), 'the battery pack itself');
    expectColour(shot, { x: -80, y: -110.4 }, RED, 'the power line over the battery pack');
    expectColour(shot, { x: 5, y: -110.4 }, RED, 'the power line over the switch');
  });

  it('draws ports above wires: an empty socket on a wire’s path stays empty', async () => {
    const shot = await show(probeScene);
    expect(port('p2.a')).toEqual({ x: -19.2, y: -110.4 });
    expectColour(shot, port('p2.a'), HOLLOW, 'the switch’s empty socket on the line');
    expectColour(shot, port('p1.plus'), RED, 'the battery pack’s connected socket');
  });

  it('draws mechanical linkages below parts, and above the workbench', async () => {
    const shot = await show(probeScene);
    expectColour(shot, { x: 5, y: 50 }, hex(ART.smallBattery), 'the linkage under the 1-cell battery pack');
    const t = (90 + 33) / 166;
    expectColour(shot, { x: 10 - 10 * t, y: 90 }, GREY, 'the linkage over the workbench');
  });

  it('draws parts above the chassis, and the chassis’s free mount points above the chassis but under its parts', async () => {
    const shot = await show(fixture('rolling-start'));
    expectColour(shot, { x: -45, y: 0 }, hex(ART.battery), 'the battery pack on the chassis');
    expectColour(shot, { x: 40, y: -56 }, hex(ART.motorTop), 'the left gearbox mount under the left DC motor', 16);
    expectColour(shot, { x: 0, y: 0 }, HOLLOW, 'the free middle deck mount point');
    expectColour(shot, { x: -20, y: -35 }, hex(ART.chassis), 'the bare chassis');
  });

  it('draws hints above everything, ports included', async () => {
    await show(probeScene);
    const layers = surface.layers;
    if (!layers) throw new Error('no layers');
    const at = port('p3.minus');
    const hint = new Graphics().circle(at.x, at.y, 4).fill(0xff00ff);
    surface.overlays.addChild(hint);
    layers.hints.attach(hint);
    surface.requestFrame();
    await frames(3);
    try {
      const shot = await shoot(surface.canvas);
      expectColour(shot, at, MAGENTA, 'the hint over the LED’s empty socket');
    } finally {
      hint.destroy();
      surface.requestFrame();
    }
  });

  it('draws the grid over the arena floor and under the chassis', async () => {
    await show(fixture('rolling-start'), 'run');
    const restful = await shoot(surface.canvas);
    // Hold a finger down so the grid stays up while the screenshot is taken.
    const empty = screen({ x: -170, y: -150 });
    expect(surface.hitAt(empty)).toBeNull();
    pointer(surface.canvas, 'pointerdown', empty, { id: 7, kind: 'touch' });
    surface.wakeGrid();
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await frames(2);
      expect(surface.gridOpacity).toBe(1);
      const gridded = await shoot(surface.canvas);
      // A strip across the bare floor crosses grid lines; a strip across the bare chassis crosses none.
      const differing = (from: Vec2, to: Vec2): number => {
        let count = 0;
        const a = screen(from);
        const b = screen(to);
        for (let x = a.x; x <= b.x; x += 0.5) {
          if (colourDistance(restful.at({ x, y: a.y }), gridded.at({ x, y: a.y })) > 2) count++;
        }
        return count;
      };
      expectColour(restful, { x: -150, y: -130 }, FLOOR, 'the arena floor, in Run mode');
      expect(differing({ x: -170, y: -130 }, { x: -100, y: -130 })).toBeGreaterThan(0);
      expect(differing({ x: -35, y: 40 }, { x: 0, y: 40 })).toBe(0);
    } finally {
      pointer(surface.canvas, 'pointerup', empty, { id: 7, kind: 'touch' });
    }
  });

  it('keeps the layers in the brief’s order in the scene graph', async () => {
    await show(probeScene);
    const layers = surface.layers;
    if (!layers) throw new Error('no layers');
    const world = layers.chassis.parent;
    const order = [layers.chassis, layers.linkages, layers.parts, layers.wires, layers.ports, layers.hints].map((layer) =>
      world?.children.indexOf(layer),
    );
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
    const stage = world?.parent;
    const arena = stage?.children[0];
    expect(arena?.label).toBe('arena');
    expect(stage?.children.indexOf(world as never)).toBe(1);
    expect(arena?.children.map((child) => child.label)).toEqual(['arena floor', 'arena features', 'arena props', 'grid']);
  });
});

describe('the arena', () => {
  it('lays the matte floor down in Run mode and lifts it in Build mode', async () => {
    const build = await show(fixture('rolling-start'));
    expectColour(build, { x: -150, y: -130 }, WORKBENCH, 'the workbench in Build mode');
    const run = await show(fixture('rolling-start'), 'run');
    expectColour(run, { x: -150, y: -130 }, FLOOR, 'the arena floor in Run mode');
  });
});

describe('art', () => {
  it('draws each part’s picture from resolveArt, and a part on a mirrored mount point as its mirror image', async () => {
    const shot = await show(fixture('rolling-start'));
    // The left DC motor is drawn as it is: the picture's top half on top.
    expectColour(shot, { x: 30, y: -57 }, hex(ART.motorTop), 'the left DC motor, top half');
    expectColour(shot, { x: 30, y: -49 }, hex(ART.motorBottom), 'the left DC motor, bottom half');
    // The right one sits on a mirrored mount point: flipped across its own x axis.
    expectColour(shot, { x: 30, y: 49 }, hex(ART.motorBottom), 'the right DC motor, mirrored, top half');
    expectColour(shot, { x: 30, y: 57 }, hex(ART.motorTop), 'the right DC motor, mirrored, bottom half');
    expect(surface.partView('motor-right')?.node.scale.y).toBe(-1);
  });

  it('draws a neutral tile with the part’s real name when there is no picture, or it fails to load', async () => {
    const { surface: plain, unmount } = await mount({
      resolveArt: (key) => (key === 'part/led' ? { src: '/no/such/picture.svg', isPlaceholder: true } : undefined),
    });
    plain.load(fixture('led-circuit'));
    await settle(plain);
    expect(plain.partView('switch')?.shows).toEqual({ picture: false, name: 'switch' });
    expect(plain.partView('battery')?.shows).toEqual({ picture: false, name: '2-cell battery pack' });
    expect(plain.partView('led')?.shows).toEqual({ picture: false, name: 'LED' });
    unmount();
  });
});

describe('sockets', () => {
  it('are hollow when empty and filled when connected, in the wire colours', async () => {
    const shot = await show(probeScene);
    expectColour(shot, port('p1.plus'), RED, 'a connected power socket');
    expectColour(shot, port('p1.minus'), HOLLOW, 'an empty power socket');
    expectColour(shot, port('p4.shaft'), GREY, 'a connected shaft');
  });

  it('are 44 px across at the default zoom', async () => {
    const shot = await show(probeScene);
    const centre = screen(port('p1.plus'));
    const inside = PORT_PX / 2 - 3;
    const outside = PORT_PX / 2 + 3;
    for (const [dx, dy] of [[0, -1], [-1, 0]] as const) {
      expect(colourDistance(shot.at({ x: centre.x + dx * inside, y: centre.y + dy * inside }), RED)).toBeLessThanOrEqual(40);
      expect(colourDistance(shot.at({ x: centre.x + dx * outside, y: centre.y + dy * outside }), RED)).toBeGreaterThan(60);
    }
  });

  it('carry the shape twins: power round, signal square, mechanical hexagon (D20)', async () => {
    const shot = await show(styleScene);
    const size = PORT_PX / PX_PER_MM;
    // Near a square's corner: inside a square, outside a circle and a flat-topped hexagon.
    const corner = (at: Vec2): Vec2 => ({ x: at.x + 0.42 * size, y: at.y + 0.42 * size });
    // Near a hexagon's side vertex: inside the hexagon, outside a circle and a square.
    const vertex = (at: Vec2): Vec2 => ({ x: at.x + 0.52 * size, y: at.y });
    const signal = port('p1.out-1');
    const power = port('p2.plus');
    expectColour(shot, corner(signal), YELLOW, 'a connected signal socket fills its corners');
    expect(colourDistance(shot.at(screen(corner(power))), RED)).toBeGreaterThan(60);
    expect(colourDistance(shot.at(screen(vertex(power))), RED)).toBeGreaterThan(60);
    await show(probeScene);
    const shaft = port('p4.shaft');
    const hexShot = await shoot(surface.canvas);
    expectColour(hexShot, vertex(shaft), GREY, 'a connected shaft reaches its hexagon’s vertex', 24);
    expect(colourDistance(hexShot.at(screen(corner(shaft))), GREY)).toBeGreaterThan(40);
  });
});

describe('line styles (brief Section 13)', () => {
  it('draws power solid and signal dashed, so colour is never the only cue', async () => {
    const shot = await show(styleScene);
    const along = (from: Vec2, to: Vec2, colour: Rgb): number[] => {
      const samples: number[] = [];
      for (let t = 0.25; t <= 0.75; t += 0.005) {
        samples.push(colourDistance(shot.at(screen({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })), colour));
      }
      return samples;
    };
    const signal = along(port('p1.out-1'), port('p2.signal'), YELLOW);
    expect(signal.filter((d) => d <= 12).length, 'dashes').toBeGreaterThan(10);
    expect(signal.filter((d) => d > 60).length, 'gaps').toBeGreaterThan(10);
    const power = along(port('p3.plus'), port('p2.plus'), RED);
    expect(power.every((d) => d <= 12), 'a solid power line').toBe(true);
  });
});

describe('focus states (the hooks task 3.4 drives)', () => {
  it('dims a part, its sockets and a wire by one step, and highlights a socket', async () => {
    const before = await show(probeScene);
    surface.setEmphasis({
      parts: new Map([['p1', 'dimmed']]),
      wires: new Map([['w1', 'dimmed']]),
      ports: new Set(['p3.minus']),
    });
    await frames(3);
    const after = await shoot(surface.canvas);
    const battery = { x: -80, y: -95 };
    expect(colourDistance(after.at(screen(battery)), before.at(screen(battery))), 'the dimmed battery pack').toBeGreaterThan(60);
    // The empty minus socket's red ring, on the side away from any wire.
    const ring = { x: port('p1.minus').x - (PORT_PX / 2 - 2) / PX_PER_MM, y: port('p1.minus').y };
    expect(colourDistance(before.at(screen(ring)), RED), 'the socket’s ring').toBeLessThanOrEqual(12);
    expect(colourDistance(after.at(screen(ring)), RED), 'its dimmed socket').toBeGreaterThan(60);
    expect(colourDistance(after.at(screen({ x: 30, y: -110.4 })), RED), 'the dimmed power line').toBeGreaterThan(40);
    expect(surface.partView('p2')?.currentEmphasis).toBe('normal');
    const halo = port('p3.minus');
    expect(
      colourDistance(after.at(screen({ x: halo.x, y: halo.y + PORT_PX / PX_PER_MM / 2 + 1.2 })), before.at(screen({ x: halo.x, y: halo.y + PORT_PX / PX_PER_MM / 2 + 1.2 }))),
      'a halo round the highlighted socket',
    ).toBeGreaterThan(10);
    surface.setEmphasis(null);
  });
});

describe('prefs', () => {
  it('swaps to the high-contrast palette and keeps the shapes and line styles', async () => {
    await show(fixture('rolling-start'));
    surface.setPrefs({ ...PREFS, highContrast: true });
    surface.requestFrame();
    await settle(surface);
    const shot = await shoot(surface.canvas);
    expectColour(shot, { x: 0, y: 200 }, rgbOf(HIGH_CONTRAST_PALETTE.workbench), 'the white workbench');
    expectColour(shot, port('battery.plus'), rgbOf(HIGH_CONTRAST_PALETTE.types.power.colour), 'a high-contrast power socket');
    surface.setPrefs(PREFS);
  });
});

describe('whole-image snapshots', () => {
  it('Rolling Start in Build mode', async () => {
    await show(fixture('rolling-start'));
    await expect.element(page.elementLocator(host)).toMatchScreenshot('rolling-start-build');
  });

  it('the probe scene in Run mode, with the arena', async () => {
    await show(probeScene, 'run');
    await expect.element(page.elementLocator(host)).toMatchScreenshot('probe-scene-run');
  });

  it('Rolling Start in high contrast', async () => {
    await show(fixture('rolling-start'));
    surface.setPrefs({ ...PREFS, highContrast: true });
    surface.requestFrame();
    await settle(surface);
    await expect.element(page.elementLocator(host)).toMatchScreenshot('rolling-start-high-contrast');
    surface.setPrefs(PREFS);
  });
});

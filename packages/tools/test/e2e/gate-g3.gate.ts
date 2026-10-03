// Gate G3's page, end to end: served by its own Vite config, opened in Chromium in the iPad profile, and used as Drew
// will use it, by mouse. The Rolling Start kit robot (kit-rolling-start) is built from an empty canvas: every part
// dragged from the tray onto its mount point or shaft, a power line dropped on a shaft and refused, every power line
// drawn socket to socket. Then Run, the robot moves with no fault, and Stop gives back the build exactly.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canvasPoseOf, checkPortPair, socketOf } from '@servo/schema';
import type { Blueprint, PartTypeId, PortRef, PortSpec, Vec2 } from '@servo/schema';
import { IPAD, SOFTWARE_GPU_FLAGS } from '../../src/e2e/profile.ts';

const CONFIG = fileURLToPath(new URL('../../src/gate/vite.config.ts', import.meta.url));
const ROBOT = 'kit-rolling-start';

let server: ViteDevServer;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = await createServer({ configFile: CONFIG, logLevel: 'warn', server: { host: '127.0.0.1', port: 5191 } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('The gate page has no address.');
  browser = await chromium.launch({ channel: 'chromium', args: [...SOFTWARE_GPU_FLAGS] });
  page = await browser.newPage({ viewport: { width: IPAD.width, height: IPAD.height }, deviceScaleFactor: IPAD.deviceScaleFactor, hasTouch: true });
  page.on('pageerror', (error) => console.error('page error:', error));
  await page.goto(url);
  await page.waitForFunction(() => window.servoGate !== undefined, undefined, { timeout: 240_000 });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const settled = (): Promise<unknown> => page.waitForFunction(() => window.servoGate?.probe.settled === true, undefined, { timeout: 60_000 });

const build = (): Promise<Blueprint | undefined> => page.evaluate(() => window.servoGate?.handle.blueprint);

/** Puts `centre` (mm) in the middle of the canvas at the default zoom, as a hand pans, and waits for the frame. */
const look = async (centre: Vec2): Promise<void> => {
  await page.evaluate((at) => window.servoGate?.probe.setView(at, 1), centre);
  await settled();
};

const pageOf = async (world: Vec2): Promise<Vec2> => {
  const at = await page.evaluate((point) => window.servoGate?.probe.pageOf(point), world);
  if (!at) throw new Error('No page point.');
  return at;
};

interface SocketNow {
  readonly world: Vec2;
  readonly press: Vec2;
  readonly fanned: boolean;
}

const socket = async (key: string): Promise<SocketNow> => {
  const found = await page.evaluate((name) => {
    const place = window.servoGate?.probe.socket(name);
    return place && { world: place.at.world, press: place.press.page, fanned: place.fanned };
  }, key);
  if (!found) throw new Error(`The canvas shows no socket ${key}.`);
  return found;
};

const middleOf = async (selector: string): Promise<Vec2> => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Nothing on the page matches ${selector}.`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A mouse drag, in steps a hand would make. */
const drag = async (from: Vec2, to: Vec2): Promise<void> => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
};

const partsNow = async (): Promise<number> => (await build())?.parts.length ?? 0;
const wiresNow = async (): Promise<number> => (await build())?.wires.length ?? 0;

const waitFor = async (what: string, ready: () => Promise<boolean>, timeout = 30_000): Promise<void> => {
  const start = Date.now();
  while (!(await ready())) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}.`);
    await page.waitForTimeout(50);
  }
};

const key = (ref: PortRef): string => `${ref.part}.${ref.port}`;
const pairKey = (a: PortRef, b: PortRef): string => [key(a), key(b)].sort().join(' ~ ');

describe('gate G3 page', () => {
  it('builds the Rolling Start kit robot by pointer from the tray, runs it and stops it', async () => {
    await page.evaluate((name) => window.servoGate?.choose(name, 'empty'), ROBOT);
    await settled();
    expect(await partsNow()).toBe(0);
    expect(await page.locator('#run').isDisabled()).toBe(true);

    const { target, ports } = await page.evaluate(() => {
      const gate = window.servoGate;
      if (!gate) throw new Error('No gate.');
      const blueprint = gate.robot.fixture.blueprint;
      const specs: Record<string, PortSpec[]> = {};
      for (const placed of blueprint.parts) specs[placed.part] = [...(gate.content.catalogue.parts.get(placed.part)?.ports ?? [])];
      return { target: blueprint, ports: specs };
    });
    const typeOf = (id: string): PartTypeId => {
      const placed = target.parts.find((part) => part.id === id);
      if (!placed) throw new Error(`No part ${id} in the fixture.`);
      return placed.part;
    };
    const specOf = (ref: PortRef): PortSpec => {
      const spec = ports[typeOf(ref.part)]?.find((port) => port.id === ref.port);
      if (!spec) throw new Error(`No port ${key(ref)}.`);
      return spec;
    };

    // What holds each part (a mount point, a shaft), and the power lines, as the schema judges each pair.
    const holds = new Map<string, { held: PortRef; holder: PortRef }>();
    const lines: { from: PortRef; to: PortRef }[] = [];
    let shaft: PortRef | undefined;
    for (const wire of target.wires) {
      const verdict = checkPortPair(specOf(wire.from), specOf(wire.to));
      if (!verdict.legal) throw new Error(`The fixture's ${wire.id} is not legal.`);
      if (verdict.kind === 'mount' || verdict.kind === 'drive') {
        const heldSocket = verdict.kind === 'mount' ? 'mount' : 'drive-in';
        const fromHeld = socketOf(specOf(wire.from)) === heldSocket;
        const held = fromHeld ? wire.from : wire.to;
        const holder = fromHeld ? wire.to : wire.from;
        holds.set(held.part, { held, holder });
        if (verdict.kind === 'drive') shaft = holder;
      } else lines.push({ from: wire.from, to: wire.to });
    }

    // Place every part from the tray, each once what holds it is on the canvas: the chassis first, at the canvas's middle.
    const ids = new Map<string, string>();
    const mapped = (ref: PortRef): PortRef => ({ part: ids.get(ref.part) ?? ref.part, port: ref.port });
    while (ids.size < target.parts.length) {
      const next = target.parts.find((part) => !ids.has(part.id) && (!holds.has(part.id) || ids.has(holds.get(part.id)?.holder.part ?? '')));
      if (!next) throw new Error('No part can be placed next.');
      const hold = holds.get(next.id);
      let release: Vec2;
      if (hold) {
        const onto = await socket(key(mapped(hold.holder)));
        const spec = specOf(hold.held);
        if (spec.type !== 'mechanical') throw new Error(`${key(hold.held)} is not a mechanical port.`);
        // The part rides under the pointer by its frame origin: let go where its mount or hub sits on the target.
        const offset = canvasPoseOf({ x: 0, y: 0, rotation: 0 }, { x: spec.at.x, y: spec.at.y, z: spec.at.z, yaw: 0, mirrored: false });
        await look(onto.world);
        release = await pageOf({ x: onto.world.x - offset.x, y: onto.world.y - offset.y });
      } else {
        release = await middleOf('#canvas');
      }
      const before = await build();
      const count = before?.parts.length ?? 0;
      await drag(await middleOf(`#tiles button[data-part="${next.part}"]`), release);
      await waitFor(`the ${next.part} to land`, async () => (await partsNow()) > count);
      const after = await build();
      const added = after?.parts.find((part) => !before?.parts.some((old) => old.id === part.id));
      expect(added?.part).toBe(next.part);
      ids.set(next.id, added?.id ?? '');
      await settled();
    }

    // A wrong-type drop: a power line from a power socket let go on a shaft is refused, and nothing changes.
    const power = lines[0];
    if (!power || !shaft) throw new Error('The fixture has no power line or no shaft.');
    {
      const from = await socket(key(mapped(power.from)));
      const onto = await socket(key(mapped(shaft)));
      await look({ x: (from.world.x + onto.world.x) / 2, y: (from.world.y + onto.world.y) / 2 });
      const before = JSON.stringify(await build());
      await drag((await socket(key(mapped(power.from)))).press, (await socket(key(mapped(shaft)))).press);
      await settled();
      expect(JSON.stringify(await build())).toBe(before);
    }

    // Every power line, socket to socket. A crowd that fans out under the press is pressed again where it went.
    for (const line of lines) {
      const from = key(mapped(line.from));
      const to = key(mapped(line.to));
      const a = await socket(from);
      const b = await socket(to);
      await look({ x: (a.world.x + b.world.x) / 2, y: (a.world.y + b.world.y) / 2 });
      const count = await wiresNow();
      let start = (await socket(from)).press;
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const source = await socket(from);
      if (source.fanned) {
        await page.mouse.up();
        start = source.press;
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
      }
      let end = (await socket(to)).press;
      await page.mouse.move(end.x, end.y, { steps: 12 });
      const there = (await socket(to)).press;
      if (there.x !== end.x || there.y !== end.y) {
        end = there;
        await page.mouse.move(end.x, end.y, { steps: 4 });
      }
      await page.mouse.up();
      await waitFor(`a wire from ${from} to ${to}`, async () => (await wiresNow()) > count);
      await settled();
    }

    // The build has the fixture's every connection, by the ids its placements claimed.
    const built = await build();
    expect(built?.parts.length).toBe(target.parts.length);
    const want = target.wires.map((wire) => pairKey(mapped(wire.from), mapped(wire.to))).sort();
    expect(built?.wires.map((wire) => pairKey(wire.from, wire.to)).sort()).toEqual(want);
    expect(await page.locator('#status').textContent()).toContain(`${target.parts.length} of ${target.parts.length} parts placed`);

    // Run: after the spin-up the robot moves across the floor, and no part shows a fault.
    const root = ids.get(target.parts.find((part) => !holds.has(part.id))?.id ?? '') ?? '';
    const where = (): Promise<Vec2 | undefined> => page.evaluate((id) => window.servoGate?.probe.part(id)?.centre.world, root);
    const bytes = JSON.stringify(built);
    await page.click('#run');
    await waitFor('the Run to reach 1.5 s', () => page.evaluate(() => (window.servoGate?.run.frame?.tick ?? 0) >= 45), 120_000);
    const first = await where();
    await waitFor('the Run to reach 2.5 s', () => page.evaluate(() => (window.servoGate?.run.frame?.tick ?? 0) >= 75), 120_000);
    const later = await where();
    if (!first || !later) throw new Error('The robot is not on the canvas.');
    expect(Math.hypot(later.x - first.x, later.y - first.y), 'the robot moves').toBeGreaterThan(10);
    expect(await page.evaluate(() => window.servoGate?.handle.mode)).toBe('run');
    expect(await page.locator('#status').textContent()).toContain('No part shows a fault.');

    // Stop: Build mode, the build exactly as it was.
    await page.click('#run');
    expect(await page.evaluate(() => window.servoGate?.handle.mode)).toBe('build');
    expect(JSON.stringify(await build())).toBe(bytes);
    expect(await page.locator('#status').textContent()).toContain('Stopped: the build is exactly as it was before Run.');
  });
});

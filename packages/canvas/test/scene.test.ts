import { describe, expect, it } from 'vitest';
import type { PartRecord } from '@servo/schema';
import { distance } from '../src/scene/geometry.ts';
import { layoutPart } from '../src/scene/layout.ts';
import { buildScene, portKey } from '../src/scene/scene.ts';
import { MIN_TILE_MM, PORT_GAP_MM, PORT_MM, PORT_PX, PX_PER_MM } from '../src/scene/units.ts';
import { catalogue, fixture, parts, record, twentyFiveParts } from './helpers/catalogue.ts';

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

describe('sizes at default zoom (brief Section 9)', () => {
  it('makes a port 44 px', () => {
    expect(PORT_MM * PX_PER_MM).toBe(PORT_PX);
    expect(PORT_PX).toBe(44);
  });

  it('puts the example parts in or near the 96–160 px tile band', () => {
    for (const part of parts) {
      const { tile, frame } = layoutPart(part);
      const longer = Math.max(tile.w, tile.h) * PX_PER_MM;
      expect(longer, part.id).toBeGreaterThanOrEqual(96 - 1e-9);
      // Frames hold the robot and are as big as they really are; a part grows only to fit its sockets.
      if (!frame) expect(longer, part.id).toBeLessThanOrEqual(165);
    }
  });
});

describe('a part tile and its sockets', () => {
  it('is at least the footprint and at least the smallest tile', () => {
    for (const part of parts) {
      const { tile } = layoutPart(part);
      expect(tile.w, part.id).toBeGreaterThanOrEqual(part.body.size.x - 1e-9);
      expect(tile.h, part.id).toBeGreaterThanOrEqual(part.body.size.y - 1e-9);
      expect(Math.max(tile.w, tile.h), part.id).toBeGreaterThanOrEqual(MIN_TILE_MM - 1e-9);
      expect(close(tile.w / tile.h, part.body.size.x / part.body.size.y), `${part.id} keeps its proportions`).toBe(true);
    }
  });

  it('never lets a socket on the outline overlap another socket, or a shaft or hub', () => {
    for (const part of parts) {
      const drawn = layoutPart(part).ports.filter((port) => port.layer === 'ports');
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          const a = drawn[i];
          const b = drawn[j];
          if (!a || !b || (!a.outward && !b.outward)) continue;
          expect(distance(a.at, b.at), `${part.id}: ${a.spec.id} and ${b.spec.id}`).toBeGreaterThanOrEqual(PORT_MM - 1e-9);
        }
      }
    }
  });

  it('spaces neighbouring sockets a socket and a gap apart, unless a short back edge holds only two', () => {
    for (const part of parts) {
      const { tile, ports } = layoutPart(part);
      const outline = ports.filter((port) => port.outward);
      for (let i = 1; i < outline.length; i++) {
        const gap = distance((outline[i - 1] as (typeof outline)[number]).at, (outline[i] as (typeof outline)[number]).at);
        const pairOnShortEdge = outline.length === 2 && tile.h < PORT_MM + PORT_GAP_MM;
        if (pairOnShortEdge) expect(gap, part.id).toBeCloseTo(tile.h, 9);
        else expect(gap, `${part.id} socket ${i}`).toBeGreaterThanOrEqual(PORT_MM + PORT_GAP_MM - 1e-6);
      }
    }
  });

  it('puts power and signal sockets on the outline, and mechanical ports where the record puts them', () => {
    for (const part of parts) {
      const { tile, ports } = layoutPart(part);
      for (const port of ports) {
        if (port.spec.type === 'mechanical') {
          expect(port.at).toEqual({ x: port.spec.at.x, y: port.spec.at.y });
          expect(port.outward).toBeUndefined();
        } else {
          const onX = close(Math.abs(port.at.x), tile.w / 2) && Math.abs(port.at.y) <= tile.h / 2 + 1e-9;
          const onY = close(Math.abs(port.at.y), tile.h / 2) && Math.abs(port.at.x) <= tile.w / 2 + 1e-9;
          expect(onX || onY, `${part.id}.${port.spec.id} on the outline`).toBe(true);
          expect(port.outward).toBeDefined();
        }
      }
    }
  });

  it('puts a two-port part’s sockets side by side on its back edge, the first on its left', () => {
    for (const id of ['battery-pack-2-cell', 'battery-pack-1-cell', 'switch', 'bumper-switch', 'dc-motor', 'led', 'buzzer']) {
      const { tile, ports } = layoutPart(record(id));
      const [first, second, ...rest] = ports.filter((port) => port.outward);
      expect(rest, id).toEqual([]);
      const half = Math.min((PORT_MM + PORT_GAP_MM) / 2, tile.h / 2);
      expect(first?.at.x, id).toBeCloseTo(-tile.w / 2, 6);
      expect(second?.at.x, id).toBeCloseTo(-tile.w / 2, 6);
      expect(first?.at.y, id).toBeCloseTo(half, 6);
      expect(second?.at.y, id).toBeCloseTo(-half, 6);
      expect([first?.outward, second?.outward], id).toEqual([
        { x: -1, y: 0 },
        { x: -1, y: 0 },
      ]);
    }
  });

  it('centres an odd count on the back edge and carries more round the corners', () => {
    const servo = layoutPart(record('servo-motor'));
    const [plus, minus, signal] = servo.ports.filter((port) => port.outward);
    expect(minus?.at.x).toBeCloseTo(-servo.tile.w / 2, 6);
    expect(minus?.at.y).toBe(0);
    expect(plus?.at.y).toBeGreaterThan(0);
    expect(signal?.at.y).toBeLessThan(0);
    const microcontroller = layoutPart(record('microcontroller'));
    const sides = microcontroller.ports.filter((port) => port.outward && port.outward.x === 0);
    expect(sides.length).toBeGreaterThan(0);
  });

  it('spreads a many-port part’s sockets evenly, the same on both sides of its x axis', () => {
    for (const id of ['microcontroller', 'motor-driver', 'servo-motor']) {
      const outline = layoutPart(record(id)).ports.filter((port) => port.outward);
      const ys = outline.map((port) => port.at.y).sort((a, b) => a - b);
      const mirrored = outline.map((port) => -port.at.y).sort((a, b) => a - b);
      for (let i = 0; i < ys.length; i++) expect(ys[i], id).toBeCloseTo(mirrored[i] as number, 9);
    }
  });

  it('draws shafts and hubs with the ports, mount points on their frame, and a part’s own mount not at all', () => {
    const roles = new Map<string, string>();
    for (const part of parts) {
      for (const port of layoutPart(part).ports) {
        const role = port.spec.type === 'mechanical' ? port.spec.role : port.spec.type;
        roles.set(role, port.layer);
      }
    }
    expect(Object.fromEntries(roles)).toEqual({
      power: 'ports',
      signal: 'ports',
      'drive-in': 'ports',
      'drive-out': 'ports',
      mount: 'none',
      'mount-point': 'frame',
    });
  });

  it('reads nothing of a part’s identity, only its size and ports (ground rule 1)', () => {
    for (const part of parts) {
      const renamed: PartRecord = {
        ...part,
        id: 'renamed-part',
        identity: { ...part.identity, name: 'other', family: 'power', art: 'part/other', level: 5 },
        card: { ...part.card, does: 'Something else.' },
      };
      const a = layoutPart(part);
      const b = layoutPart(renamed);
      expect(b.tile, part.id).toEqual(a.tile);
      expect(b.ports.map((port) => [port.at, port.layer])).toEqual(a.ports.map((port) => [port.at, port.layer]));
      expect(b.frame).toBe(a.frame);
    }
  });

  it('calls a part with mount points a frame', () => {
    expect(parts.filter((part) => layoutPart(part).frame).map((part) => part.id)).toEqual(['chassis']);
  });
});

describe('the scene for a blueprint', () => {
  const rolling = buildScene(fixture('rolling-start'), catalogue);

  it('draws a part on a mirrored mount point, directly or through its host, as its mirror image', () => {
    const mirrored = Object.fromEntries(rolling.parts.map((part) => [part.id, part.pose.mirrored]));
    expect(mirrored).toEqual({
      chassis: false,
      battery: false,
      caster: false,
      switch: false,
      'motor-left': false,
      'motor-right': true,
      'wheel-left': false,
      'wheel-right': true,
    });
  });

  it('draws frames first, then parts from low to high on the robot, then by depth and id', () => {
    // The caster hangs under the chassis and the wheels ride low on the shafts; the rest sit on top.
    expect(rolling.parts.map((part) => [part.id, part.z, part.depth])).toEqual([
      ['chassis', 0, 0],
      ['caster', -16.5, 1],
      ['wheel-left', -16.5, 2],
      ['wheel-right', -16.5, 2],
      ['battery', 6, 1],
      ['motor-left', 6, 1],
      ['motor-right', 6, 1],
      ['switch', 6, 1],
    ]);
  });

  it('puts every mount on its mount point and every hub on its shaft', () => {
    for (const linkage of rolling.linkages) {
      expect(distance(linkage.from.at, linkage.to.at), linkage.id).toBeLessThan(1e-9);
    }
    expect(rolling.linkages.map((linkage) => linkage.kind)).toEqual(['mount', 'mount', 'mount', 'mount', 'mount', 'drive', 'drive']);
  });

  it('keeps power and signal lines apart from linkages, and fills the sockets that have a wire', () => {
    expect(rolling.wires.map((wire) => wire.id)).toEqual(['w10', 'w11', 'w12', 'w8', 'w9']);
    const blueprint = fixture('rolling-start');
    const wired = new Set(blueprint.wires.flatMap((wire) => [portKey(wire.from), portKey(wire.to)]));
    for (const part of rolling.parts) {
      for (const port of part.ports) expect(port.connected, port.key).toBe(wired.has(port.key));
    }
  });

  it('bounds every tile corner and socket', () => {
    const bounds = rolling.bounds;
    expect(bounds).toBeDefined();
    if (!bounds) return;
    for (const part of rolling.parts) {
      for (const point of [...part.corners, ...part.ports.filter((port) => port.layer !== 'none').map((port) => port.at)]) {
        expect(point.x).toBeGreaterThanOrEqual(bounds.minX);
        expect(point.x).toBeLessThanOrEqual(bounds.maxX);
        expect(point.y).toBeGreaterThanOrEqual(bounds.minY);
        expect(point.y).toBeLessThanOrEqual(bounds.maxY);
      }
    }
  });

  it('names the robot’s root', () => {
    expect(rolling.root).toBe('chassis');
    expect(buildScene(fixture('led-circuit'), catalogue).root).toBeUndefined();
    expect(buildScene(twentyFiveParts, catalogue).root).toBe('br-chassis');
  });

  it('is empty without a blueprint', () => {
    const empty = buildScene(undefined, catalogue);
    expect(empty.parts).toEqual([]);
    expect(empty.bounds).toBeUndefined();
  });

  it('is the same for the same blueprint, whatever order its parts and wires come in', () => {
    const blueprint = fixture('bumper-robot');
    const shuffled = { ...blueprint, parts: [...blueprint.parts].reverse(), wires: [...blueprint.wires].reverse() };
    const a = buildScene(blueprint, catalogue);
    const b = buildScene(shuffled, catalogue);
    expect(b.parts.map((part) => [part.id, part.pose, part.ports.map((port) => port.at)])).toEqual(
      a.parts.map((part) => [part.id, part.pose, part.ports.map((port) => port.at)]),
    );
    expect(b.wires.map((wire) => wire.id)).toEqual(a.wires.map((wire) => wire.id));
  });
});

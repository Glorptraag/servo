// What the canvas says and where its own controls go (task 3.2): the removal line (brief Section 10, D35), the held
// part's line, and the layout of the handles and the line clear of every socket.
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '@servo/schema';
import { applyEdit } from '../../src/index.ts';
import type { EditCommand } from '../../src/interface.ts';
import { heldLine, looseLine, removalLine, removedWires } from '../../src/placement/notices.ts';
import { layOutCallout, layOutHandles } from '../../src/placement/overlays.ts';
import type { Circle } from '../../src/placement/overlays.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';

const after = (build: Blueprint, command: EditCommand): Blueprint => {
  const result = applyEdit(build, command, catalogue);
  if (!result.ok) throw new Error(result.refusal.code);
  return result.blueprint;
};

describe('what a removal says', () => {
  it('counts the power and signal lines that went with the part', () => {
    const circuit = fixture('led-circuit');
    expect(removedWires(circuit, after(circuit, { kind: 'remove-part', partId: 'led' }), catalogue)).toBe(2);
    const robot = fixture('rolling-start');
    // A DC motor's two power lines; its mount and its shaft's linkage are how parts are held, not wires.
    expect(removedWires(robot, after(robot, { kind: 'remove-part', partId: 'motor-left' }), catalogue)).toBe(2);
    expect(removedWires(robot, after(robot, { kind: 'remove-part', partId: 'chassis' }), catalogue)).toBe(0);
  });

  it('says the wires that went, then the parts left loose, in one line with no full stop at its end', () => {
    const circuit = fixture('led-circuit');
    expect(removalLine(circuit, after(circuit, { kind: 'remove-part', partId: 'led' }), catalogue)).toBe('Removed with it: 2 wires');
    const robot = fixture('rolling-start');
    expect(removalLine(robot, after(robot, { kind: 'remove-part', partId: 'motor-left' }), catalogue)).toBe(
      'Removed with it: 2 wires. Loose now: large wheel',
    );
    expect(removalLine(robot, after(robot, { kind: 'remove-part', partId: 'chassis' }), catalogue)).toBe(
      'Loose now: 2-cell battery pack, caster, DC motor and switch',
    );
    expect(removalLine(robot, after(robot, { kind: 'remove-part', partId: 'caster' }), catalogue)).toBeUndefined();
    expect(removalLine(robot, after(robot, { kind: 'rename', name: 'Renamed' }), catalogue)).toBeUndefined();
    const pin = fixture('motor-off-pin');
    expect(removalLine(pin, after(pin, { kind: 'remove-part', partId: 'servo' }), catalogue)).toBe('Removed with it: 3 wires');
    const pack = fixture('short-circuit');
    expect(removalLine(pack, after(pack, { kind: 'remove-part', partId: 'battery' }), catalogue)).toBe('Removed with it: 1 wire');
  });

  it('keeps to the voice: real names, no exclamation marks, no full stop at the end', () => {
    for (const line of [looseLine(['switch']), heldLine('mount'), heldLine('carried'), 'Removed with it: 2 wires. Loose now: large wheel']) {
      expect(line).not.toMatch(/[!.]$/);
      expect(line).not.toContain('!');
    }
    expect(heldLine('mount')).toBe('Held by its mount: move it off to turn it');
    expect(heldLine('carried')).toBe('Held on a shaft: move it off to turn it');
  });
});

describe('where the handles go', () => {
  const part = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  const base = { kinds: ['move', 'rotate', 'bin'] as const, part, radius: 8, gap: 3, leftHanded: false };

  it('stacks them in a column beside the part, on its right, or its left for left-handed use (D44)', () => {
    const right = layOutHandles({ ...base, sockets: [] });
    expect([...right.keys()]).toEqual(['move', 'rotate', 'bin']);
    expect(new Set([...right.values()].map((at) => at.x))).toEqual(new Set([31]));
    expect([...right.values()].map((at) => at.y)).toEqual([-19, 0, 19]);
    const left = layOutHandles({ ...base, sockets: [], leftHanded: true });
    expect(new Set([...left.values()].map((at) => at.x))).toEqual(new Set([-31]));
  });

  it('moves them clear of every socket: further along, to the other side, or further out', () => {
    const sockets: Circle[] = [{ x: 31, y: 0, r: 10 }];
    const places = layOutHandles({ ...base, sockets });
    for (const at of places.values()) expect(Math.hypot(at.x - 31, at.y)).toBeGreaterThanOrEqual(18);
    expect(places.size).toBe(3);
    // A wall of sockets down the right: they go to the left.
    const wall: Circle[] = Array.from({ length: 30 }, (_, i) => ({ x: 31, y: -150 + 10 * i, r: 10 }));
    expect(new Set([...layOutHandles({ ...base, sockets: wall }).values()].map((at) => at.x))).toEqual(new Set([-31]));
  });

  it('keeps them inside the view where they fit, and clear of sockets above all', () => {
    const view = { minX: -60, minY: -30, maxX: 40, maxY: 30 };
    const places = layOutHandles({ ...base, sockets: [], view });
    for (const at of places.values()) {
      expect(at.x - 8).toBeGreaterThanOrEqual(view.minX);
      expect(at.x + 8).toBeLessThanOrEqual(view.maxX);
      expect(at.y - 8).toBeGreaterThanOrEqual(view.minY);
      expect(at.y + 8).toBeLessThanOrEqual(view.maxY);
    }
  });
});

describe('where the line goes', () => {
  const over = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  const view = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  const size = { w: 60, h: 10 };

  it('sits above the area it speaks about, or below it, clear of every socket and handle', () => {
    expect(layOutCallout(size, over, [], view, 4)).toEqual({ x: 0, y: -29 });
    const above: Circle[] = [{ x: 0, y: -29, r: 5 }];
    expect(layOutCallout(size, over, above, view, 4)).toEqual({ x: 0, y: 29 });
    const both: Circle[] = [...above, { x: 0, y: 29, r: 5 }];
    expect(layOutCallout(size, over, both, view, 4)).toEqual({ x: 0, y: -39 });
  });

  it('stays inside the view', () => {
    const tight = { minX: -50, minY: -32, maxX: 25, maxY: 200 };
    const at = layOutCallout(size, over, [], tight, 4);
    expect(at.y).toBe(29);
    expect(at.x + size.w / 2).toBeLessThanOrEqual(tight.maxX);
  });
});

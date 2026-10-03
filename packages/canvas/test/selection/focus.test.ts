import { describe, expect, it } from 'vitest';
import { buildScene } from '../../src/scene/scene.ts';
import { FLOW_WORDS, allWires, flowLine, focusFor, neighboursOf } from '../../src/selection/focus.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';

const rolling = buildScene(fixture('rolling-start'), catalogue);

describe('neighbours: one wire away, by any line', () => {
  it('finds the battery pack’s switch, both motors and the chassis it is mounted on', () => {
    expect([...neighboursOf(rolling, 'battery')].sort()).toEqual(['chassis', 'motor-left', 'motor-right', 'switch']);
  });

  it('counts a drive linkage and a mount: a motor’s wheel and its chassis', () => {
    expect([...neighboursOf(rolling, 'motor-left')].sort()).toEqual(['battery', 'chassis', 'switch', 'wheel-left']);
  });

  it('stops at one step: a wheel’s neighbour is its motor alone', () => {
    expect([...neighboursOf(rolling, 'wheel-left')]).toEqual(['motor-left']);
  });
});

describe('selecting a part dims everything not connected to it by one step', () => {
  it('rings the part, keeps its wires and neighbours, and dims the rest', () => {
    const focus = focusFor(rolling, { kind: 'part', partId: 'battery' });
    expect(focus?.parts?.get('battery')).toBe('highlighted');
    for (const near of ['chassis', 'motor-left', 'motor-right', 'switch']) expect(focus?.parts?.has(near), near).toBe(false);
    for (const far of ['caster', 'wheel-left', 'wheel-right']) expect(focus?.parts?.get(far), far).toBe('dimmed');
    // Its wires: the power line to the switch, both minus lines, and its mount.
    const kept = allWires(rolling).filter((wire) => !focus?.wires?.has(wire.id)).map((wire) => wire.id);
    expect(kept.sort()).toEqual(['w11', 'w12', 'w3', 'w8']);
    for (const id of ['w1', 'w2', 'w4', 'w5', 'w6', 'w7', 'w9', 'w10']) expect(focus?.wires?.get(id), id).toBe('dimmed');
    expect(focus?.ports).toBeUndefined();
  });

  it('keeps a chassis’s mounted parts and dims the lines between them', () => {
    const focus = focusFor(rolling, { kind: 'part', partId: 'chassis' });
    expect([...(focus?.parts?.entries() ?? [])].sort()).toEqual([
      ['chassis', 'highlighted'],
      ['wheel-left', 'dimmed'],
      ['wheel-right', 'dimmed'],
    ]);
    expect([...(focus?.wires?.keys() ?? [])].sort()).toEqual(['w10', 'w11', 'w12', 'w6', 'w7', 'w8', 'w9']);
  });

  it('dims no part when every part is a neighbour, only the line that does not touch it', () => {
    const circuit = buildScene(fixture('led-circuit'), catalogue);
    const focus = focusFor(circuit, { kind: 'part', partId: 'battery' });
    expect([...(focus?.parts?.entries() ?? [])]).toEqual([['battery', 'highlighted']]);
    expect([...(focus?.wires?.entries() ?? [])]).toEqual([['w2', 'dimmed']]);
  });
});

describe('selecting a wire highlights both ports and nothing else changes', () => {
  it('glows the line and haloes its two sockets, dimming nothing', () => {
    expect(focusFor(rolling, { kind: 'wire', wireId: 'w8' })).toEqual({
      wires: new Map([['w8', 'highlighted']]),
      ports: new Set(['battery.plus', 'switch.a']),
    });
  });

  it('works for a drive linkage too', () => {
    expect(focusFor(rolling, { kind: 'wire', wireId: 'w6' })?.ports).toEqual(new Set(['motor-left.shaft', 'wheel-left.hub']));
  });
});

describe('nothing to focus', () => {
  it('draws everything normally with no selection, a prop, or an id the scene lacks', () => {
    expect(focusFor(rolling, null)).toBeNull();
    expect(focusFor(rolling, { kind: 'prop', propId: 'prop-1' })).toBeNull();
    expect(focusFor(rolling, { kind: 'part', partId: 'p99' })).toBeNull();
    expect(focusFor(rolling, { kind: 'wire', wireId: 'w99' })).toBeNull();
  });
});

describe('what flows on a wire', () => {
  it('says it in one plain word, with no full stop and no exclamation mark', () => {
    expect(flowLine('power')).toBe('power');
    expect(flowLine('signal')).toBe('signal');
    expect(flowLine('drive')).toBe('turning');
    for (const word of Object.values(FLOW_WORDS)) expect(word).toMatch(/^[a-z]+$/);
  });
});

import { describe, expect, it } from 'vitest';
import { buildScene } from '../../src/scene/scene.ts';
import { drawsAnything, hintTargets } from '../../src/selection/hints.ts';
import { PULSE_LOW, pulseAt, PULSE_MS } from '../../src/selection/views.ts';
import { catalogue, fixture } from '../helpers/catalogue.ts';

const rolling = buildScene(fixture('rolling-start'), catalogue);
const ids = (parts: readonly { readonly id: string }[]): string[] => parts.map((part) => part.id).sort();

describe('which parts and sockets a rung draws', () => {
  it('pulses one placed part, or every part of a type', () => {
    expect(ids(hintTargets(rolling, { step: 'pulse-part', target: { placed: 'switch' }, line: 'The switch' }).parts)).toEqual(['switch']);
    expect(ids(hintTargets(rolling, { step: 'pulse-part', target: { part: 'dc-motor' }, line: 'The DC motor' }).parts)).toEqual([
      'motor-left',
      'motor-right',
    ]);
  });

  it('pulses a socket on every matching part', () => {
    const targets = hintTargets(rolling, { step: 'pulse-port', target: { part: 'dc-motor', port: 'minus' }, line: 'Its minus' });
    expect(targets.ports.map((port) => port.key).sort()).toEqual(['motor-left.minus', 'motor-right.minus']);
    expect(targets.parts).toEqual([]);
  });

  it('draws no socket for a port the canvas does not show (a mount)', () => {
    const targets = hintTargets(rolling, { step: 'pulse-port', target: { placed: 'battery', port: 'mount' }, line: 'Its mount' });
    expect(drawsAnything(targets)).toBe(false);
  });

  it('joins every pair a wire could join with a ghost wire', () => {
    const targets = hintTargets(rolling, {
      step: 'ghost-wire',
      from: { placed: 'battery', port: 'plus' },
      to: { part: 'dc-motor', port: 'plus' },
      line: 'A power line to each DC motor',
    });
    expect(targets.wires.map(([from, to]) => `${from.key}-${to.key}`)).toEqual(['battery.plus-motor-left.plus', 'battery.plus-motor-right.plus']);
  });

  it('draws no ghost wire a socket would refuse', () => {
    const targets = hintTargets(rolling, {
      step: 'ghost-wire',
      from: { placed: 'battery', port: 'plus' },
      to: { placed: 'motor-left', port: 'shaft' },
      line: 'No',
    });
    expect(drawsAnything(targets)).toBe(false);
  });

  it('matches nothing for a part the build lacks', () => {
    expect(drawsAnything(hintTargets(rolling, { step: 'pulse-part', target: { part: 'servo-motor' }, line: 'The servo motor' }))).toBe(false);
  });
});

describe('the pulse', () => {
  it('starts at full strength, eases to its low and comes back once a period', () => {
    expect(pulseAt(0)).toBeCloseTo(1);
    expect(pulseAt(PULSE_MS / 2)).toBeCloseTo(PULSE_LOW);
    expect(pulseAt(PULSE_MS)).toBeCloseTo(1);
  });
});

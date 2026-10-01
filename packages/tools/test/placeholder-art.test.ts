import { validatePartRecord } from '@servo/schema';
import type { PartRecord, PortSpec } from '@servo/schema';
import { exampleParts } from '@servo/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { FORMS, TILE_PX, VIEW, formOf, placeholderSvg, tileFrame } from '../src/index.ts';
import type { Form } from '../src/index.ts';

const valid = (data: unknown): PartRecord => {
  const result = validatePartRecord(data);
  if (!result.ok) throw new Error(`Expected a valid part record:\n${JSON.stringify(result.issues, null, 2)}`);
  return result.value;
};

const parts: readonly PartRecord[] = exampleParts.map(valid);

const part = (id: string): PartRecord => {
  const found = parts.find((record) => record.id === id);
  if (!found) throw new Error(`No example part '${id}'.`);
  return found;
};

/** The record with its box (and centre of mass) stretched by these factors. */
const resized = (record: PartRecord, fx: number, fy: number, fz: number): PartRecord => {
  const { size, centreOfMass } = record.body;
  return valid({
    ...record,
    body: {
      ...record.body,
      size: { x: size.x * fx, y: size.y * fy, z: size.z * fz },
      centreOfMass: { x: centreOfMass.x * fx, y: centreOfMass.y * fy, z: centreOfMass.z * fz },
    },
  });
};

const recoloured = (record: PartRecord, main: string, accent: string): PartRecord =>
  valid({ ...record, identity: { ...record.identity, colours: { main, accent } } });

/** A part with no behaviour that is not flat, which no rule claims. */
const plainBlock = valid({ ...part('switch'), id: 'plain-block', behaviour: [], needs: [], settings: [], failureModes: [] });

// A small reader for the SVG subset the generator writes: elements, attributes and path data.
interface Element {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
}

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  svg: ['xmlns', 'viewBox', 'width', 'height'],
  g: ['stroke-width', 'stroke-linejoin'],
  path: ['d', 'fill', 'stroke'],
};

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const PAIR = `${NUMBER} ${NUMBER}`;
const PATH_DATA = new RegExp(`^M${PAIR}(?: ${PAIR})*(?:L${PAIR}(?: ${PAIR})*|C${PAIR} ${PAIR} ${PAIR})*Z$`);
const COLOUR = /^#[0-9a-f]{6}$/;

/** Reads the document, returning its elements in order and everything that is not well-formed SVG. */
const readSvg = (svg: string): { readonly elements: readonly Element[]; readonly problems: readonly string[] } => {
  const problems: string[] = [];
  const elements: Element[] = [];
  const open: string[] = [];
  for (const piece of svg.split(/(<[^>]*>)/)) {
    if (!piece.startsWith('<')) {
      if (piece.trim() !== '') problems.push(`text outside the elements: '${piece}'`);
      continue;
    }
    const tag = /^<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"<>&]*")*)\s*(\/?)>$/.exec(piece);
    if (!tag) {
      problems.push(`malformed tag ${piece}`);
      continue;
    }
    const [, closing = '', name = '', attributeText = '', selfClosing = ''] = tag;
    if (closing) {
      if (open.pop() !== name) problems.push(`</${name}> closes nothing`);
      continue;
    }
    if (elements.length === 0 && name !== 'svg') problems.push(`the root is <${name}>, not <svg>`);
    if (elements.length > 0 && open.length === 0) problems.push(`a second root <${name}>`);
    const attributes = new Map<string, string>();
    for (const [, key = '', value = ''] of attributeText.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
      if (attributes.has(key)) problems.push(`<${name}> repeats ${key}`);
      attributes.set(key, value);
    }
    const allowed = ALLOWED[name];
    if (!allowed) problems.push(`unexpected element <${name}>`);
    else for (const key of attributes.keys()) if (!allowed.includes(key)) problems.push(`<${name}> has ${key}`);
    elements.push({ name, attributes });
    if (!selfClosing) open.push(name);
  }
  if (open.length > 0) problems.push(`unclosed ${open.join(', ')}`);
  return { elements, problems };
};

const attribute = (element: Element | undefined, key: string): string => element?.attributes.get(key) ?? '';
const numbersIn = (text: string): number[] => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

type XY = readonly [number, number];

/** Points on the outline a path draws: its corners, and each curve at its ends and quarters. */
const drawnPoints = (d: string): XY[] => {
  const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: XY[] = [];
  let command = '';
  let current: XY = [0, 0];
  let index = 0;
  const take = (): XY => {
    const point: XY = [Number(tokens[index]), Number(tokens[index + 1])];
    index += 2;
    return point;
  };
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (/^[MLCZ]$/.test(token)) {
      command = token;
      index += 1;
      continue;
    }
    if (command === 'C') {
      const [c1, c2, end] = [take(), take(), take()];
      for (const t of [0.25, 0.5, 0.75]) {
        const u = 1 - t;
        const at = (axis: 0 | 1): number => u ** 3 * current[axis] + 3 * u * u * t * c1[axis] + 3 * u * t * t * c2[axis] + t ** 3 * end[axis];
        points.push([at(0), at(1)]);
      }
      current = end;
    } else {
      current = take();
    }
    points.push(current);
  }
  return points;
};
const pathsOf = (svg: string): Element[] => readSvg(svg).elements.filter((element) => element.name === 'path');
const coloursOf = (svg: string): string[] =>
  pathsOf(svg).flatMap((path) => [attribute(path, 'fill'), attribute(path, 'stroke')].filter((colour) => colour !== ''));

const rgb = (hex: string): readonly [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('placeholder art: one tile per part', () => {
  it.each(parts.map((record) => [record.id, record] as const))('%s matches its snapshot', async (id, record) => {
    await expect(placeholderSvg(record)).toMatchFileSnapshot(`./placeholder-art.snapshots/${id}.svg`);
  });

  it('draws the fallback block form, which no example part uses', async () => {
    expect(formOf(plainBlock)).toBe('block');
    await expect(placeholderSvg(plainBlock)).toMatchFileSnapshot('./placeholder-art.snapshots/form-block.svg');
  });

  it('is pure: the same record gives the same bytes', () => {
    for (const record of parts) {
      const first = placeholderSvg(record);
      expect(placeholderSvg(JSON.parse(JSON.stringify(record)) as PartRecord)).toBe(first);
      expect(placeholderSvg(record)).toBe(first);
    }
  });
});

describe('placeholder art: valid, small SVG', () => {
  it.each([...parts, plainBlock].map((record) => [record.id, placeholderSvg(record)] as const))('%s is well formed', (_id, svg) => {
    const { elements, problems } = readSvg(svg);
    expect(problems).toEqual([]);
    const [root, group, ...paths] = elements;
    expect(attribute(root, 'xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(numbersIn(attribute(root, 'viewBox'))).toHaveLength(4);
    expect(group?.name).toBe('g');
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.name).toBe('path');
      expect(attribute(path, 'd')).toMatch(PATH_DATA);
      expect(attribute(path, 'fill')).toMatch(COLOUR);
      if (path.attributes.has('stroke')) expect(attribute(path, 'stroke')).toMatch(COLOUR);
    }
    expect(new TextEncoder().encode(svg).length).toBeLessThan(6000);
  });

  it('is vector only: no text, images, links, scripts or styles', () => {
    for (const record of parts) {
      expect(placeholderSvg(record)).not.toMatch(/<(text|image|use|a|script|style|foreignObject|title)\b|href=|data:/);
    }
  });
});

describe('placeholder art: true proportions in one three-quarter view', () => {
  // The camera of VIEW, worked out here independently: screen right and screen up in the part's frame.
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const azimuth = radians(VIEW.azimuthDegrees);
  const elevation = radians(VIEW.elevationDegrees);
  const right = [-Math.sin(azimuth), Math.cos(azimuth), 0] as const;
  const up = [-Math.sin(elevation) * Math.cos(azimuth), -Math.sin(elevation) * Math.sin(azimuth), Math.cos(elevation)] as const;

  it('uses one camera for every tile: from the front right, 30° up', () => {
    expect(VIEW).toEqual({ azimuthDegrees: -60, elevationDegrees: 30 });
  });

  it.each(parts.map((record) => [record.id, record] as const))('%s: the tile frames its body box as the camera sees it', (_id, record) => {
    const { x, y, z } = record.body.size;
    const corners = [-x / 2, x / 2].flatMap((cx) => [-y / 2, y / 2].flatMap((cy) => [0, z].map((cz) => [cx, cy, cz] as const)));
    const across = corners.map(([cx, cy, cz]) => cx * right[0] + cy * right[1] + cz * right[2]);
    const down = corners.map(([cx, cy, cz]) => -(cx * up[0] + cy * up[1] + cz * up[2]));
    const frame = tileFrame(record);
    const margin = frame.stroke;
    expect(frame.minX).toBeCloseTo(Math.min(...across) - margin, 9);
    expect(frame.minY).toBeCloseTo(Math.min(...down) - margin, 9);
    expect(frame.width).toBeCloseTo(Math.max(...across) - Math.min(...across) + 2 * margin, 9);
    expect(frame.height).toBeCloseTo(Math.max(...down) - Math.min(...down) + 2 * margin, 9);

    const root = readSvg(placeholderSvg(record)).elements[0];
    const viewBox = numbersIn(attribute(root, 'viewBox'));
    [frame.minX, frame.minY, frame.width, frame.height].forEach((value, index) => expect(viewBox[index]).toBeCloseTo(value, 2));
    const [width = 0, height = 0] = [Number(attribute(root, 'width')), Number(attribute(root, 'height'))];
    expect(Math.max(width, height)).toBe(TILE_PX);
    expect(width / height).toBeCloseTo(frame.width / frame.height, 2);
  });

  it.each(parts.map((record) => [record.id, record] as const))('%s: twice the size draws the same tile at twice the scale', (_id, record) => {
    const once = placeholderSvg(record);
    const twice = placeholderSvg(resized(record, 2, 2, 2));
    const numbers = (svg: string): number[] =>
      readSvg(svg).elements.flatMap((element) =>
        ['viewBox', 'd', 'stroke-width'].flatMap((key) => numbersIn(attribute(element, key))),
      );
    const small = numbers(once);
    const large = numbers(twice);
    expect(large).toHaveLength(small.length);
    large.forEach((value, index) => expect(Math.abs(value - 2 * (small[index] ?? 0))).toBeLessThanOrEqual(0.0201));
    expect(coloursOf(twice)).toEqual(coloursOf(once));
  });

  it('a longer body draws a longer part', () => {
    const motor = part('dc-motor');
    expect(tileFrame(resized(motor, 2, 1, 1)).width).toBeGreaterThan(tileFrame(motor).width + 0.8 * motor.body.size.x);
    expect(tileFrame(resized(motor, 1, 1, 2)).height).toBeGreaterThan(tileFrame(motor).height + 0.8 * motor.body.size.z);
  });

  it.each(FORMS)('every %s stays inside its tile, however its box is stretched', (form: Form) => {
    const examples = [...parts, plainBlock].filter((record) => formOf(record) === form);
    expect(examples.length).toBeGreaterThan(0);
    for (const record of examples) {
      for (const [fx, fy, fz] of [[1, 1, 1], [4, 1, 1], [1, 4, 1], [1, 1, 4], [0.25, 1, 1], [1, 0.25, 1], [1, 1, 0.25]] as const) {
        const svg = placeholderSvg(resized(record, fx, fy, fz));
        const [minX = 0, minY = 0, width = 0, height = 0] = numbersIn(attribute(readSvg(svg).elements[0], 'viewBox'));
        for (const path of pathsOf(svg)) {
          for (const [px, py] of drawnPoints(attribute(path, 'd'))) {
            expect(px).toBeGreaterThanOrEqual(minX - 0.02);
            expect(px).toBeLessThanOrEqual(minX + width + 0.02);
            expect(py).toBeGreaterThanOrEqual(minY - 0.02);
            expect(py).toBeLessThanOrEqual(minY + height + 0.02);
          }
        }
      }
    }
  });

  it('lights from the top left: the top is lightest and the right-hand end darkest', () => {
    // The gearbox's first three marks are its housing's top, front end (+x, on the right) and right side.
    const [top, end, side] = pathsOf(placeholderSvg(part('gearbox')));
    const { main } = part('gearbox').identity.colours;
    expect(attribute(side, 'fill')).toBe(main);
    expect(luminance(attribute(top, 'fill'))).toBeGreaterThan(luminance(main));
    expect(luminance(attribute(end, 'fill'))).toBeLessThan(luminance(main));
    const middle = (element: Element | undefined): number => {
      const xs = numbersIn(attribute(element, 'd')).filter((_, index) => index % 2 === 0);
      return xs.reduce((sum, value) => sum + value, 0) / xs.length;
    };
    expect(middle(end)).toBeGreaterThan(middle(side));
  });
});

describe('placeholder art: drawn from the schema colours', () => {
  it.each(parts.map((record) => [record.id, record] as const))('%s shows its main colour unchanged on the side facing the viewer', (_id, record) => {
    expect(coloursOf(placeholderSvg(record))).toContain(record.identity.colours.main);
  });

  it.each(parts.map((record) => [record.id, record] as const))('%s uses only shades of its main and accent colours', (_id, record) => {
    // With pure red and pure blue, every shade of one keeps green equal to blue, and of the other red equal to green.
    const colours = coloursOf(placeholderSvg(recoloured(record, '#ff0000', '#0000ff'))).map(rgb);
    const reds = colours.filter(([r, g, b]) => g === b && r > g);
    const blues = colours.filter(([r, g, b]) => r === g && b > r);
    const darks = colours.filter(([r, g, b]) => r === 0 && g === 0 && b === 0);
    expect(reds.length + blues.length + darks.length).toBe(colours.length);
    expect(reds.length).toBeGreaterThan(0);
    expect(blues.length).toBeGreaterThan(0);
  });

  it('changing the colours changes no shape', () => {
    for (const record of parts) {
      const shapes = (svg: string): string => svg.replace(/#[0-9a-f]{6}/g, '#');
      expect(shapes(placeholderSvg(recoloured(record, '#123456', '#abcdef')))).toBe(shapes(placeholderSvg(record)));
    }
  });
});

describe('placeholder art: parts are data (ground rules 1 and 7)', () => {
  it('reads only body size, colours and behaviour: not the id, name, family, level, art key, ports or text', () => {
    for (const record of parts) {
      const ports: PortSpec[] = record.ports.map((port) =>
        port.type === 'mechanical' ? { ...port, label: `${port.label} moved`, at: { x: port.at.x + 1, y: port.at.y - 1, z: port.at.z + 1 } } : { ...port, label: `${port.label} renamed` },
      );
      const disguised = valid({
        ...record,
        id: 'another-part',
        identity: {
          ...record.identity,
          name: 'another part',
          family: 'comms',
          domains: ['programs-and-computing'],
          level: record.identity.level === 1 ? 2 : 1,
          art: 'part/another-part',
        },
        ports,
        card: { ...record.card, does: 'Does something else.', popularMechanics: 'Something else has one.' },
      });
      expect(placeholderSvg(disguised)).toBe(placeholderSvg(record));
    }
  });

  it('takes its form from the behaviour primitives', () => {
    const forms = Object.fromEntries(parts.map((record) => [record.id, formOf(record)]));
    expect(forms).toEqual({
      'battery-pack-2-cell': 'battery-cells',
      'battery-pack-1-cell': 'battery-cells',
      switch: 'slide-switch',
      'bumper-switch': 'bumper',
      'dc-motor': 'motor-can',
      'wheel-large': 'wheel',
      caster: 'ball-caster',
      chassis: 'plate',
      led: 'led',
      buzzer: 'buzzer',
      'servo-motor': 'servo-case',
      'motor-driver': 'circuit-board',
      gearbox: 'gear-housing',
      microcontroller: 'circuit-board',
    });
  });

  it('draws a part no rule claims as a block, and a flat one with no behaviour as a plate', () => {
    expect(formOf(plainBlock)).toBe('block');
    const flatPlain = valid({ ...plainBlock, body: { ...plainBlock.body, size: { x: 100, y: 80, z: 4 }, centreOfMass: { x: 0, y: 0, z: 2 } } });
    expect(formOf(flatPlain)).toBe('plate');
    // JSON drops the undefined field, leaving a load that gives no light or sound.
    const silentLoad = valid(
      JSON.parse(
        JSON.stringify({
          ...part('buzzer'),
          behaviour: part('buzzer').behaviour.map((primitive) => (primitive.kind === 'load' ? { ...primitive, emits: undefined } : primitive)),
        }),
      ),
    );
    expect(formOf(silentLoad)).toBe('block');
  });
});

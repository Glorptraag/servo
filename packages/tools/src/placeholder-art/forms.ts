import type { PartRecord, Primitive } from '@servo/schema';
import { ball, box, cylinder, disc, dome, flat, gear } from './draw.ts';
import type { Cylinder, Mark } from './draw.ts';
import { TOWARDS_VIEWER, add, mix, scale } from './view.ts';
import type { Vec3 } from './view.ts';

/**
 * What a part is drawn as. The form comes from the closed vocabulary of behaviour primitives, never from
 * a part's id, name or family (ground rule 1), so a new part record gets a picture with no code change.
 */
export const FORMS = [
  'wheel',
  'ball-caster',
  'motor-can',
  'servo-case',
  'circuit-board',
  'battery-cells',
  'bumper',
  'slide-switch',
  'led',
  'buzzer',
  'gear-housing',
  'plate',
  'block',
] as const;

export type Form = (typeof FORMS)[number];

interface Size {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Colours {
  readonly main: string;
  readonly accent: string;
}

/** The first rule a record's primitives meet decides its form. */
const RULES: readonly (readonly [Form, (primitive: Primitive) => boolean])[] = [
  ['wheel', (p) => p.kind === 'wheel'],
  ['ball-caster', (p) => p.kind === 'support'],
  ['motor-can', (p) => p.kind === 'actuator' && p.mode === 'speed'],
  ['servo-case', (p) => p.kind === 'actuator' && p.mode === 'position'],
  ['circuit-board', (p) => p.kind === 'program' || p.kind === 'driver' || p.kind === 'regulator'],
  ['battery-cells', (p) => p.kind === 'source'],
  ['bumper', (p) => p.kind === 'switch' && p.actuation.kind === 'contact'],
  ['slide-switch', (p) => p.kind === 'switch'],
  ['led', (p) => p.kind === 'load' && p.emits?.kind === 'light'],
  ['buzzer', (p) => p.kind === 'load' && p.emits?.kind === 'sound'],
  ['gear-housing', (p) => p.kind === 'ratio'],
];

/** A part with no primitive at all and a body this flat is a plate, like a chassis. */
const PLATE_FLATNESS = 0.1;

export const formOf = (record: PartRecord): Form => {
  for (const [form, matches] of RULES) if (record.behaviour.some(matches)) return form;
  const { x, y, z } = record.body.size;
  return record.behaviour.length === 0 && z <= PLATE_FLATNESS * Math.min(x, y) ? 'plate' : 'block';
};

type Axis = 0 | 1 | 2;

const sizeOn = (size: Size, axis: Axis): number => (axis === 0 ? size.x : axis === 1 ? size.y : size.z);
const along = (axis: Axis, length: number): Vec3 => (axis === 0 ? [length, 0, 0] : axis === 1 ? [0, length, 0] : [0, 0, length]);
const othersOf = (axis: Axis): readonly [Axis, Axis] => (axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]);

/** +1 when the camera sees the + end of an axis, −1 when it sees the − end. */
const seenEnd = (axis: Axis): 1 | -1 => (TOWARDS_VIEWER[axis] >= 0 ? 1 : -1);

/** The cylinder that fills the part's box along `axis`, between fractions `from` and `to` of its length. */
const filling = (size: Size, axis: Axis, from = 0, to = 1): Cylinder => {
  const middle: Vec3 = [0, 0, size.z / 2];
  const length = sizeOn(size, axis);
  const [first, second] = othersOf(axis);
  return {
    from: add(middle, along(axis, (from - 0.5) * length)),
    to: add(middle, along(axis, (to - 0.5) * length)),
    a: along(first, sizeOn(size, first) / 2),
    b: along(second, sizeOn(size, second) / 2),
  };
};

/** The longest side of the box; ties go to x, then y. */
const longestAxis = (size: Size): Axis => (size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2);

/** A wheel's axle: the side of the box that differs from the other two, which span the wheel's face. Ties go to y. */
const axleOf = ({ x, y, z }: Size): Axis => {
  const acrossY = Math.abs(x - z);
  const acrossZ = Math.abs(x - y);
  const acrossX = Math.abs(y - z);
  return acrossY <= acrossZ && acrossY <= acrossX ? 1 : acrossZ <= acrossX ? 2 : 0;
};

const shadow = (hex: string): string => mix(hex, '#000000', 0.65);

/** A rectangle lying level at height z. */
const levelRectangle = (x0: number, y0: number, x1: number, y1: number, z: number): readonly Vec3[] => [
  [x0, y0, z],
  [x1, y0, z],
  [x1, y1, z],
  [x0, y1, z],
];

type Draw = (size: Size, colours: Colours) => Mark[];

const DRAW: Readonly<Record<Form, Draw>> = {
  /** A tyre in the main colour round a hub in the accent colour, on the face the camera sees. */
  wheel: (size, { main, accent }) => {
    const tyre = filling(size, axleOf(size));
    const face = seenEnd(axleOf(size)) > 0 ? tyre.to : tyre.from;
    return [
      ...cylinder(tyre, main),
      disc(face, scale(tyre.a, 0.62), scale(tyre.b, 0.62), accent),
      disc(face, scale(tyre.a, 0.16), scale(tyre.b, 0.16), shadow(accent)),
    ];
  },

  /** A ball under a round housing in the accent colour and a mounting plate. */
  'ball-caster': ({ x, y, z }, { main, accent }) => {
    const footprint = Math.min(x, y);
    const radius = Math.min(footprint * 0.34, z * 0.4);
    const housing = footprint * 0.4;
    const plate = z * 0.88;
    return [
      ...ball([0, 0, radius], radius, main),
      ...cylinder({ from: [0, 0, radius * 1.15], to: [0, 0, plate], a: [housing, 0, 0], b: [0, housing, 0] }, accent),
      ...box([-x / 2, -y / 2, plate], [x / 2, y / 2, z], main),
    ];
  },

  /**
   * A motor can along the box's longest side: an end cap in the accent colour at the far end, and a
   * bearing ring on the end the camera sees.
   */
  'motor-can': (size, { main, accent }) => {
    const axis = longestAxis(size);
    // Fractions of the length, counted from the far end; `to` is the end nearer the camera.
    const span = (from: number, to: number): Cylinder => {
      if (seenEnd(axis) > 0) return filling(size, axis, from, to);
      const flipped = filling(size, axis, 1 - to, 1 - from);
      return { ...flipped, from: flipped.to, to: flipped.from };
    };
    const ring = span(0.97, 1);
    return [
      ...cylinder(span(0, 0.2), accent),
      ...cylinder(span(0.2, 0.97), main),
      ...cylinder({ ...ring, a: scale(ring.a, 0.45), b: scale(ring.b, 0.45) }, main),
      disc(ring.to, scale(ring.a, 0.14), scale(ring.b, 0.14), shadow(main)),
    ];
  },

  /** A tall case with mounting ears, a round boss on top, and a horn in the accent colour. */
  'servo-case': ({ x, y, z }, { main, accent }) => {
    const top = z * 0.76;
    const body = x * 0.36;
    const hub = x * 0.16;
    const radius = Math.min(y * 0.32, x * 0.2);
    const earLow = z * 0.56;
    const earHigh = z * 0.63;
    return [
      ...box([-x / 2, -y * 0.4, earLow], [-body, y * 0.4, earHigh], main),
      ...box([-body, -y / 2, 0], [body, y / 2, top], main),
      ...box([body, -y * 0.4, earLow], [x / 2, y * 0.4, earHigh], main),
      ...cylinder({ from: [hub, 0, top], to: [hub, 0, z * 0.84], a: [radius * 1.3, 0, 0], b: [0, radius * 1.3, 0] }, main),
      ...box([hub - x * 0.42, -y * 0.15, z * 0.92], [hub + x * 0.3, y * 0.15, z], accent),
      ...cylinder({ from: [hub, 0, z * 0.84], to: [hub, 0, z], a: [radius, 0, 0], b: [0, radius, 0] }, accent),
    ];
  },

  /** A board in the main colour with two header strips in the accent colour and a dark chip between them. */
  'circuit-board': ({ x, y, z }, { main, accent }) => {
    const board = z * 0.16;
    const lengthwise = x >= y;
    const across = lengthwise ? y : x;
    const width = across * 0.14;
    const inset = across * 0.06;
    const strip = (side: 1 | -1): readonly [Vec3, Vec3] => {
      const outer = (side * across) / 2 - side * inset;
      const inner = outer - side * width;
      const [low, high] = side > 0 ? [inner, outer] : [outer, inner];
      return lengthwise
        ? [[-x * 0.4, low, board], [x * 0.4, high, z]]
        : [[low, -y * 0.4, board], [high, y * 0.4, z]];
    };
    const chip = Math.min(x, y) * 0.18;
    // The strip further from the camera goes first: +y when the strips run along x, −x when they run along y.
    const [far, near] = lengthwise ? [strip(1), strip(-1)] : [strip(-1), strip(1)];
    return [
      ...box([-x / 2, -y / 2, 0], [x / 2, y / 2, board], main),
      ...box(...far, accent),
      ...box([-chip, -chip, board], [chip, chip, board + z * 0.2], shadow(main)),
      ...box(...near, accent),
    ];
  },

  /**
   * Round cells in the main colour lying in a holder in the accent colour, each cell with a band in the
   * accent colour at the end the camera sees. Each cell is as wide as the pack is tall.
   */
  'battery-cells': ({ x, y, z }, { main, accent }) => {
    const count = Math.max(1, Math.round(y / z));
    const pitch = y / count;
    const radius = Math.min(z, pitch) * 0.45;
    const wall = z * 0.5;
    // The cells run along x; `end` is the end the camera sees, where each cell's band sits.
    const end = x * 0.43 * seenEnd(0);
    const bandStart = end * 0.78;
    const cells: Mark[] = [];
    // From the back of the holder to the front.
    for (let cell = 0; cell < count; cell += 1) {
      const middleY = seenEnd(1) < 0 ? y / 2 - pitch * (cell + 0.5) : -y / 2 + pitch * (cell + 0.5);
      const middleZ = z - radius;
      const a: Vec3 = [0, radius, 0];
      const b: Vec3 = [0, 0, radius];
      cells.push(
        ...cylinder({ from: [-end, middleY, middleZ], to: [bandStart, middleY, middleZ], a, b }, main),
        ...cylinder({ from: [bandStart, middleY, middleZ], to: [end, middleY, middleZ], a, b }, accent),
      );
    }
    const lo: Vec3 = [-x / 2, -y / 2, 0];
    const hi: Vec3 = [x / 2, y / 2, wall];
    return [...box(lo, hi, accent), ...cells, ...box(lo, hi, accent, { top: false })];
  },

  /** A switch body with a bar in the accent colour across its front, on a short arm. */
  bumper: ({ x, y, z }, { main, accent }) => [
    ...box([-x / 2, -y * 0.3, 0], [x * 0.05, y * 0.3, z * 0.8], main),
    ...box([x * 0.05, -y * 0.06, z * 0.35], [x * 0.3, y * 0.06, z * 0.55], main),
    ...box([x * 0.3, -y / 2, z * 0.15], [x / 2, y / 2, z * 0.75], accent),
  ],

  /** A switch body with a dark slot on top and a knob in the accent colour. */
  'slide-switch': ({ x, y, z }, { main, accent }) => {
    const top = z * 0.62;
    return [
      ...box([-x / 2, -y / 2, 0], [x / 2, y / 2, top], main),
      flat(levelRectangle(-x * 0.34, -y * 0.17, x * 0.34, y * 0.17, top), shadow(main), { outlined: false }),
      ...box([-x * 0.32, -y * 0.13, top], [-x * 0.04, y * 0.13, z], accent),
    ];
  },

  /** A domed lens in the main colour on a rim in the accent colour. */
  led: ({ x, y, z }, { main, accent }) => {
    const rim = Math.min(x, y) / 2;
    const rimTop = z * 0.14;
    const lens = Math.min(rim * 0.84, z - rimTop);
    const domeBase = z - lens;
    return [
      ...cylinder({ from: [0, 0, 0], to: [0, 0, rimTop], a: [rim, 0, 0], b: [0, rim, 0] }, accent),
      ...cylinder({ from: [0, 0, rimTop], to: [0, 0, domeBase], a: [lens, 0, 0], b: [0, lens, 0] }, main),
      ...dome([0, 0, domeBase], lens, main),
    ];
  },

  /** A round case in the main colour, a seal in the accent colour on top, and the sound hole. */
  buzzer: ({ x, y, z }, { main, accent }) => {
    const a: Vec3 = [x / 2, 0, 0];
    const b: Vec3 = [0, y / 2, 0];
    const top: Vec3 = [0, 0, z];
    return [
      ...cylinder({ from: [0, 0, 0], to: top, a, b }, main),
      disc(top, scale(a, 0.6), scale(b, 0.6), accent),
      disc(top, scale(a, 0.14), scale(b, 0.14), shadow(main)),
    ];
  },

  /** A housing in the main colour with a gear in the accent colour on the side the camera sees. */
  'gear-housing': ({ x, y, z }, { main, accent }) => {
    const radius = Math.min(x, z) * 0.32;
    const face: Vec3 = [0, (seenEnd(1) * y) / 2, z / 2];
    return [
      ...box([-x / 2, -y / 2, 0], [x / 2, y / 2, z], main),
      gear(face, [1, 0, 0], [0, 0, 1], radius, 8, accent),
      disc(face, [radius * 0.28, 0, 0], [0, 0, radius * 0.28], shadow(main)),
    ];
  },

  /** A plate in the main colour with slots cut through it, showing the accent colour. */
  plate: ({ x, y, z }, { main, accent }) => {
    const lengthwise = x >= y;
    const slots: Mark[] = [];
    for (const row of [-0.28, 0, 0.28]) {
      for (const column of [-0.22, 0.22]) {
        const [cx, cy] = lengthwise ? [column * x, row * y] : [row * x, column * y];
        const [halfX, halfY] = lengthwise ? [x * 0.16, y * 0.035] : [x * 0.035, y * 0.16];
        slots.push(flat(levelRectangle(cx - halfX, cy - halfY, cx + halfX, cy + halfY, z), accent, { lit: false }));
      }
    }
    return [...box([-x / 2, -y / 2, 0], [x / 2, y / 2, z], main), ...slots];
  },

  /** A block in the main colour under a lid in the accent colour. */
  block: ({ x, y, z }, { main, accent }) => [
    ...box([-x / 2, -y / 2, 0], [x / 2, y / 2, z * 0.8], main),
    ...box([-x / 2, -y / 2, z * 0.8], [x / 2, y / 2, z], accent),
  ],
};

/** The marks that draw a part, back to front, from its body size, colours and form. */
export const drawPart = (record: PartRecord): Mark[] => DRAW[formOf(record)](record.body.size, record.identity.colours);

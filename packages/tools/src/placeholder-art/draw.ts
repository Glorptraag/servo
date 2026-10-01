import { cosSin } from '@servo/schema';
import {
  ACROSS,
  AWAY,
  LIGHT_ACROSS_TILE,
  TOWARDS_VIEWER,
  add,
  dot,
  edge,
  lightOn,
  num,
  project,
  scale,
  tone,
} from './view.ts';
import type { Point, Vec3 } from './view.ts';

/** One filled shape in the tile, outlined when it has a stroke. Painted in order, last on top. */
export interface Mark {
  readonly d: string;
  readonly fill: string;
  readonly stroke?: string;
}

const xy = (p: Point): string => `${num(p[0])} ${num(p[1])}`;
const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The normal of a surface that faces the viewer. */
const facingViewer = (normal: Vec3): Vec3 => (dot(normal, TOWARDS_VIEWER) < 0 ? scale(normal, -1) : normal);

const polygonPath = (points: readonly Point[]): string => `M${points.map(xy).join(' ')}Z`;

/** Control-point distance of a quarter circle drawn as one cubic Bézier curve. */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/** cos and sin of quarter turn `q`, exactly. */
const quarter = (q: number): readonly [number, number] => {
  const turn = ((q % 4) + 4) % 4;
  return turn === 0 ? [1, 0] : turn === 1 ? [0, 1] : turn === 2 ? [-1, 0] : [0, -1];
};

/**
 * `count` quarter arcs of the ellipse centre + cos u·a + sin u·b, starting at u = 90°·first, as Bézier
 * commands. Projection is linear, so a circle's Bézier quarters map exactly onto its ellipse: a and b
 * are any pair of conjugate semi-diameters, such as a circle's two radii seen from the camera.
 */
const quarterArcs = (centre: Point, a: Point, b: Point, first: number, count: number): string => {
  const at = (q: number): Point => {
    const [c, s] = quarter(q);
    return plus(times(a, c), times(b, s));
  };
  let path = '';
  for (let q = first; q < first + count; q += 1) {
    const from = at(q);
    const to = at(q + 1);
    const control1 = plus(plus(centre, from), times(to, KAPPA));
    const control2 = plus(plus(centre, to), times(from, KAPPA));
    path += `C${xy(control1)} ${xy(control2)} ${xy(plus(centre, to))}`;
  }
  return path;
};

const ellipsePath = (centre: Point, a: Point, b: Point): string =>
  `M${xy(plus(centre, a))}${quarterArcs(centre, a, b, 0, 4)}Z`;

const BOX_FACES: readonly { readonly normal: Vec3; readonly corners: (lo: Vec3, hi: Vec3) => readonly Vec3[] }[] = [
  { normal: [0, 0, 1], corners: ([x0, y0], [x1, y1, z1]) => [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
  { normal: [0, 0, -1], corners: ([x0, y0, z0], [x1, y1]) => [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]] },
  { normal: [1, 0, 0], corners: ([, y0, z0], [x1, y1, z1]) => [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
  { normal: [-1, 0, 0], corners: ([x0, y0, z0], [, y1, z1]) => [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
  { normal: [0, 1, 0], corners: ([x0, , z0], [x1, y1, z1]) => [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]] },
  { normal: [0, -1, 0], corners: ([x0, y0, z0], [x1, , z1]) => [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
];

/**
 * A block from corner `lo` to corner `hi`: the faces the camera sees, each shaded by how it faces the
 * light. `top: false` leaves the top off, to draw the walls of a tray in front of what sits in it.
 */
export const box = (lo: Vec3, hi: Vec3, colour: string, options: { readonly top?: boolean } = {}): Mark[] =>
  BOX_FACES.filter(({ normal }) => dot(normal, TOWARDS_VIEWER) > 0 && (options.top !== false || normal[2] !== 1)).map(
    ({ normal, corners }) => ({
      d: polygonPath(corners(lo, hi).map(project)),
      fill: tone(colour, lightOn(normal)),
      stroke: edge(colour),
    }),
  );

/** A cylinder: the centres of its two ends, and the semi-axes of its cross-section (at right angles to the axis and each other). */
export interface Cylinder {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly a: Vec3;
  readonly b: Vec3;
}

/** Light on a curved surface comes in steps, so it reads as shading rather than noise. */
const STEP = 0.25;
const stepped = (light: number): number => Math.round(light / STEP) * STEP;

/**
 * A cylinder: its outline (the two ends joined by the lines where the side turns away), the side in
 * bands of stepped light, and the end that faces the viewer, in `capColour`.
 */
export const cylinder = ({ from, to, a, b }: Cylinder, colour: string, capColour: string = colour): Mark[] => {
  const axis = minus(to, from);
  const [near, far] = dot(axis, TOWARDS_VIEWER) >= 0 ? [to, from] : [from, to];
  const nearCentre = project(near);
  const farCentre = project(far);
  const cap: Mark = {
    d: ellipsePath(nearCentre, project(a), project(b)),
    fill: tone(capColour, lightOn(facingViewer(axis))),
    stroke: edge(capColour),
  };
  // The side turns away from the viewer where its normal, cos t·a/|a|² + sin t·b/|b|², is at right angles to the view.
  const p = dot(a, TOWARDS_VIEWER) / dot(a, a);
  const q = dot(b, TOWARDS_VIEWER) / dot(b, b);
  const length = Math.sqrt(p * p + q * q);
  if (length === 0) return [cap];
  const cos0 = q / length;
  const sin0 = -p / length;
  // The same ellipse from the turning point t0: u = t − t0. The visible half of the side is u in [0°, 180°].
  const a0 = add(scale(a, cos0), scale(b, sin0));
  const b0 = add(scale(a, -sin0), scale(b, cos0));
  const tileA = project(a0);
  const tileB = project(b0);
  const lightAt = (u: number): number => {
    const [cu, su] = cosSin(u);
    const cosT = cos0 * cu - sin0 * su;
    const sinT = sin0 * cu + cos0 * su;
    return stepped(lightOn(add(scale(a, cosT / dot(a, a)), scale(b, sinT / dot(b, b)))));
  };
  const rim = (centre: Point, u: number): Point => {
    const [cu, su] = cosSin(u);
    return plus(centre, plus(times(tileA, cu), times(tileB, su)));
  };
  const sideLight = lightAt(90);
  const side: Mark = {
    d: `M${xy(plus(farCentre, tileA))}${quarterArcs(farCentre, tileA, tileB, 0, 2)}L${xy(plus(nearCentre, times(tileA, -1)))}${quarterArcs(nearCentre, tileA, tileB, 2, 2)}Z`,
    fill: tone(colour, sideLight),
    stroke: edge(colour),
  };
  // Bands of equal light across the visible half, sampled every 10°.
  const bands: Mark[] = [];
  let start = 0;
  for (let u = 10; u <= 180; u += 10) {
    const light = lightAt(start + 5);
    if (u < 180 && lightAt(u + 5) === light) continue;
    if (light !== sideLight) {
      const steps: number[] = [];
      for (let v = start; v <= u; v += 10) steps.push(v);
      const points = [...steps.map((v) => rim(farCentre, v)), ...[...steps].reverse().map((v) => rim(nearCentre, v))];
      bands.push({ d: polygonPath(points), fill: tone(colour, light) });
    }
    start = u;
  }
  return [side, ...bands, cap];
};

/** A flat ellipse lying on a surface: centre, and its two semi-axes along the surface. */
export const disc = (centre: Vec3, a: Vec3, b: Vec3, colour: string, outlined = true): Mark => ({
  d: ellipsePath(project(centre), project(a), project(b)),
  fill: tone(colour, lightOn(facingViewer(cross(a, b)))),
  ...(outlined ? { stroke: edge(colour) } : {}),
});

/**
 * A flat shape lying on a surface, through points on it, lit like the surface. A hole through the
 * surface is not lit: `lit: false` shows its colour as it is.
 */
export const flat = (points: readonly Vec3[], colour: string, options: { readonly outlined?: boolean; readonly lit?: boolean } = {}): Mark => {
  const [first, second, third] = points;
  const normal = first && second && third ? cross(minus(second, first), minus(third, first)) : TOWARDS_VIEWER;
  return {
    d: polygonPath(points.map(project)),
    fill: options.lit === false ? colour : tone(colour, lightOn(facingViewer(normal))),
    ...(options.outlined === false ? {} : { stroke: edge(colour) }),
  };
};

const glint = (centre: Point, radius: number, colour: string): Mark => {
  const middle = plus(centre, times(LIGHT_ACROSS_TILE, radius * 0.4));
  const r = radius * 0.4;
  return { d: ellipsePath(middle, [r, 0], [0, r]), fill: tone(colour, 0.75) };
};

/** A ball, seen as a circle, with a glint towards the light. */
export const ball = (centre: Vec3, radius: number, colour: string): Mark[] => {
  const middle = project(centre);
  return [
    { d: ellipsePath(middle, [radius, 0], [0, radius]), fill: tone(colour, 0), stroke: edge(colour) },
    glint(middle, radius, colour),
  ];
};

/**
 * A dome: the top half of a ball standing on a level circle at `centre`. Its outline is the ball's
 * outline above the circle's ends and the near half of the circle below.
 */
export const dome = (centre: Vec3, radius: number, colour: string): Mark[] => {
  const middle = project(centre);
  const right = project(scale(ACROSS, radius));
  const up: Point = [0, -radius];
  const towards = project(scale(AWAY, -radius));
  return [
    {
      d: `M${xy(plus(middle, times(right, -1)))}${quarterArcs(middle, times(right, -1), up, 0, 2)}${quarterArcs(middle, right, towards, 0, 2)}Z`,
      fill: tone(colour, 0),
      stroke: edge(colour),
    },
    glint(plus(middle, [0, -radius * 0.25]), radius * 0.8, colour),
  ];
};

/** A flat polygon of `teeth` teeth around `centre`, in the surface spanned by unit directions u and v. */
export const gear = (centre: Vec3, u: Vec3, v: Vec3, radius: number, teeth: number, colour: string): Mark => {
  const points: Vec3[] = [];
  const pitch = 360 / teeth;
  const at = (degrees: number, r: number): Vec3 => {
    const [c, s] = cosSin(degrees);
    return add(centre, add(scale(u, r * c), scale(v, r * s)));
  };
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const middle = tooth * pitch;
    points.push(at(middle - pitch * 0.32, radius * 0.78), at(middle - pitch * 0.18, radius), at(middle + pitch * 0.18, radius), at(middle + pitch * 0.32, radius * 0.78));
  }
  return flat(points, colour);
};

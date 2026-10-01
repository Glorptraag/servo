import { cosSin } from '@servo/schema';

/** A point or direction in the part's frame: +x forward, +y left, +z up, millimetres. */
export type Vec3 = readonly [number, number, number];

/** A point in the tile: x to the right, y down, millimetres seen from the camera. */
export type Point = readonly [number, number];

/**
 * The one camera every tile uses (brief Section 11: a consistent three-quarter view). It is an
 * orthographic view from in front of the part's right side and above: turned 60° from +x towards −y,
 * and raised 30°. The right side (−y) faces the viewer, the front (+x) shows at the right of the tile,
 * the top above. A part at rotation 0 on the canvas also faces right (packages/schema/docs/geometry.md).
 */
export const VIEW = { azimuthDegrees: -60, elevationDegrees: 30 } as const;

// cosSin is exact to the last bit on every engine, so a record gives the same bytes everywhere.
const [cosAzimuth, sinAzimuth] = cosSin(VIEW.azimuthDegrees);
const [cosElevation, sinElevation] = cosSin(VIEW.elevationDegrees);

// The tile's right, up and towards-the-viewer directions in the part's frame. They are orthonormal.
const RIGHT: Vec3 = [-sinAzimuth, cosAzimuth, 0];
const UP: Vec3 = [-sinElevation * cosAzimuth, -sinElevation * sinAzimuth, cosElevation];
export const TOWARDS_VIEWER: Vec3 = [cosElevation * cosAzimuth, cosElevation * sinAzimuth, sinElevation];

/** Level directions in the part's frame: across the tile to the right, and away from the viewer. */
export const ACROSS: Vec3 = RIGHT;
export const AWAY: Vec3 = [-cosAzimuth, -sinAzimuth, 0];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.sqrt(dot(a, a)));

/** Where a point of the part lands in the tile. The projection is linear, so it also maps directions. */
export const project = (p: Vec3): Point => [dot(p, RIGHT), -dot(p, UP)];

/**
 * Light from the top left of the tile: from above and from the part's back (−x), which the view puts on
 * the left. It has no sideways part, so the side facing the viewer shows the schema colour exactly.
 */
const LIGHT = normalize([-1, 0, 1]);

/** How much light a surface facing `normal` gets: 1 facing the light, 0 side-on, −1 facing away. */
export const lightOn = (normal: Vec3): number => {
  const length = Math.sqrt(dot(normal, normal));
  return length === 0 ? 0 : dot(normal, LIGHT) / length;
};

/** The light's direction across the tile, as a unit vector. */
export const LIGHT_ACROSS_TILE: Point = (() => {
  const [x, y] = project(LIGHT);
  const length = Math.sqrt(x * x + y * y);
  return [x / length, y / length];
})();

const channels = (hex: string): readonly [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const hexOf = (rgb: readonly number[]): string =>
  `#${rgb.map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;

/** `hex` moved `amount` (0–1) of the way to `target`. Both are `#rrggbb`. */
export const mix = (hex: string, target: string, amount: number): string => {
  const from = channels(hex);
  const to = channels(target);
  return hexOf(from.map((value, index) => value + ((to[index] ?? value) - value) * amount));
};

/** How far the brightest and darkest faces move towards white and black. */
const SHADING = 0.35;

/** A schema colour as a surface getting `light` (−1 to 1) shows it. A side-on surface shows it unchanged. */
export const tone = (hex: string, light: number): string =>
  light >= 0 ? mix(hex, '#ffffff', SHADING * light) : mix(hex, '#000000', -SHADING * light);

/** The outline drawn around a surface of this colour. */
export const edge = (hex: string): string => mix(hex, '#000000', 0.5);

/** A coordinate as written in the SVG: two decimals, no trailing zeros, never `-0`. */
export const num = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
};

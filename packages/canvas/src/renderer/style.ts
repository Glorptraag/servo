// The canvas's look (brief Section 11): a warm light-grey workbench with a faint grid, a matte darker arena floor
// with a clear boundary, neutral tiles, and saturated colour only for wires, ports and status. The high-contrast
// palette (brief Section 13) keeps every line style and socket shape, so colour is never the only cue.
import { PORT_TYPE_STYLE } from '@servo/schema';
import type { PortType } from '@servo/schema';
import type { CanvasPrefs } from '../interface.ts';

export interface TypeColours {
  /** The wire and socket colour: red, yellow or grey (PORT_TYPE_STYLE). */
  readonly colour: number;
  /** A darker edge, so a yellow line still reads on a light floor. */
  readonly casing: number;
}

export interface Palette {
  readonly workbench: number;
  readonly gridMinor: number;
  readonly gridMajor: number;
  readonly gridMinorAlpha: number;
  readonly gridMajorAlpha: number;
  readonly floor: number;
  readonly floorEdge: number;
  readonly wall: number;
  readonly zone: number;
  readonly floorLine: number;
  readonly ramp: number;
  readonly prop: number;
  readonly propFixed: number;
  readonly propEdge: number;
  readonly tile: number;
  readonly tileEdge: number;
  readonly label: number;
  /** The inside of a hollow socket. */
  readonly socketInner: number;
  readonly types: Readonly<Record<PortType, TypeColours>>;
}

/** The colour names in PORT_TYPE_STYLE, as drawn. */
const STANDARD_TYPES: Readonly<Record<(typeof PORT_TYPE_STYLE)[PortType]['colour'], TypeColours>> = {
  red: { colour: 0xd63a3a, casing: 0x8c2020 },
  yellow: { colour: 0xf2b31a, casing: 0x8f6a00 },
  grey: { colour: 0x8f8a82, casing: 0x57534c },
};

const HIGH_CONTRAST_TYPES: Readonly<Record<(typeof PORT_TYPE_STYLE)[PortType]['colour'], TypeColours>> = {
  red: { colour: 0xc40000, casing: 0x000000 },
  yellow: { colour: 0xffd000, casing: 0x000000 },
  grey: { colour: 0x404040, casing: 0x000000 },
};

const typesFrom = (table: typeof STANDARD_TYPES): Readonly<Record<PortType, TypeColours>> => ({
  power: table[PORT_TYPE_STYLE.power.colour],
  signal: table[PORT_TYPE_STYLE.signal.colour],
  mechanical: table[PORT_TYPE_STYLE.mechanical.colour],
});

export const STANDARD_PALETTE: Palette = {
  workbench: 0xebe8e3,
  gridMinor: 0xb7afa3,
  gridMajor: 0x9c9385,
  gridMinorAlpha: 0.4,
  gridMajorAlpha: 0.6,
  floor: 0xc9c2b7,
  floorEdge: 0x857d71,
  wall: 0x6b655c,
  zone: 0xb3aa9c,
  floorLine: 0x2b2926,
  ramp: 0xd6cfc4,
  prop: 0xb0a698,
  propFixed: 0x8c8376,
  propEdge: 0x5e584f,
  tile: 0xf8f6f2,
  tileEdge: 0xb5ada1,
  label: 0x2b2926,
  socketInner: 0xfbfaf7,
  types: typesFrom(STANDARD_TYPES),
};

export const HIGH_CONTRAST_PALETTE: Palette = {
  workbench: 0xffffff,
  gridMinor: 0x000000,
  gridMajor: 0x000000,
  gridMinorAlpha: 0.35,
  gridMajorAlpha: 0.6,
  floor: 0xd4d4d4,
  floorEdge: 0x000000,
  wall: 0x000000,
  zone: 0x9a9a9a,
  floorLine: 0x000000,
  ramp: 0xe6e6e6,
  prop: 0x8a8a8a,
  propFixed: 0x4d4d4d,
  propEdge: 0x000000,
  tile: 0xffffff,
  tileEdge: 0x000000,
  label: 0x000000,
  socketInner: 0xffffff,
  types: typesFrom(HIGH_CONTRAST_TYPES),
};

export const paletteFor = (prefs: CanvasPrefs): Palette => (prefs.highContrast ? HIGH_CONTRAST_PALETTE : STANDARD_PALETTE);

/**
 * One rounded sans-serif (brief Section 11), or a dyslexia-friendly face (Section 13). The canvas loads no fonts:
 * each stack falls back to what the device has. Which faces ship is the app's choice (docs/renderer.md).
 */
export const FONT_STACKS: Readonly<Record<CanvasPrefs['typeface'], readonly string[]>> = {
  standard: ['Nunito', 'Varela Round', 'Arial Rounded MT Bold', 'ui-rounded', 'system-ui', 'sans-serif'],
  'dyslexia-friendly': ['OpenDyslexic', 'Lexend', 'Atkinson Hyperlegible', 'Verdana', 'sans-serif'],
};

/** Selecting a part dims everything not connected to it by one step (brief Section 9). */
export const DIM_ALPHA = 0.35;
/** In Build mode the arena's walls, zones, lines and props show faintly on the workbench; Run brings them up in full. */
export const ARENA_BUILD_ALPHA = 0.3;

// Where every region of the shell sits (brief Section 9), as plain maths so it runs in unit tests. The shell renders
// these boxes and CSS animates between them. The canvas keeps at least 70% of the screen in every state: the spec
// card's width is the one size that gives way, and it is set for the state with everything open, so tucking an
// edge only ever gives the canvas more room. See docs/shell.md.
import type { CanvasMode } from '@servo/canvas';
import type { Edge, Tucked } from './edges.ts';

/** The header's height: 44 px targets and 4 px above and below (brief Section 9: "top edge, thin"). */
export const HEADER_PX = 52;
/** The tray's width in landscape and height in portrait: one column or row of 96 px tiles and 8 px round them. */
export const TRAY_PX = 112;
/** The spec card's width where the screen has room for it. */
export const SPEC_CARD_PX = 280;
/** Brief Section 9: the canvas takes at least 70% of the screen in every state. */
export const MIN_CANVAS_SHARE = 0.7;

export type Orientation = 'landscape' | 'portrait';

/**
 * Which hand the layout suits. Left-handed mirrors the tray and the spec card (brief Section 13), and with them the
 * controls that float on the canvas; the header reads left to right either way. Task 5.7 sets it.
 */
export type Hand = 'right' | 'left';

/** A box in CSS pixels from the shell's top left. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutInput {
  /** The shell's size: its host's. */
  readonly width: number;
  readonly height: number;
  readonly tucked: Tucked;
  readonly mode: CanvasMode;
  readonly hand: Hand;
}

export interface ShellLayout {
  readonly width: number;
  readonly height: number;
  readonly orientation: Orientation;
  readonly hand: Hand;
  /** Whether each edge shows. The tray also hides in Run mode (brief Section 9), whatever its tuck state. */
  readonly shown: Readonly<Record<Edge, boolean>>;
  /** Each region's box while it shows. A hidden region keeps its size and lies just past the edge it tucks into. */
  readonly header: Rect;
  readonly tray: Rect;
  /** The canvas's host: everything the header and the tray leave. */
  readonly stage: Rect;
  /** It slides over the stage's side without resizing the canvas, so the build does not move (brief Section 10). */
  readonly specCard: Rect;
  /** The canvas a child sees: the stage less the spec card. The arena strip, the Run bar, the zoom control and the tabs float on it. */
  readonly canvas: Rect;
  /** The seen canvas's share of the screen. */
  readonly canvasShare: number;
}

export const area = (rect: Rect): number => Math.max(0, rect.width) * Math.max(0, rect.height);

/** Landscape when the shell is at least as wide as it is tall. */
export const orientationOf = (width: number, height: number): Orientation => (width >= height ? 'landscape' : 'portrait');

/**
 * The spec card's width on a screen of this size: SPEC_CARD_PX, or less where the canvas would otherwise drop under
 * MIN_CANVAS_SHARE with the header, the tray and the card all showing. Zero on a screen too small for the shell.
 */
export const specCardWidth = (width: number, height: number): number => {
  const landscape = orientationOf(width, height) === 'landscape';
  const stageWidth = landscape ? width - TRAY_PX : width;
  const stageHeight = landscape ? height - HEADER_PX : height - HEADER_PX - TRAY_PX;
  if (stageWidth <= 0 || stageHeight <= 0) return 0;
  const room = stageWidth - (MIN_CANVAS_SHARE * width * height) / stageHeight;
  return Math.max(0, Math.min(SPEC_CARD_PX, Math.floor(room)));
};

export const solveLayout = ({ width, height, tucked, mode, hand }: LayoutInput): ShellLayout => {
  const orientation = orientationOf(width, height);
  const shown: Record<Edge, boolean> = {
    header: !tucked.header,
    tray: !tucked.tray && mode === 'build',
    specCard: !tucked.specCard,
    arenaStrip: !tucked.arenaStrip,
    runBar: !tucked.runBar,
  };
  const top = shown.header ? HEADER_PX : 0;
  const trayRoom = shown.tray ? TRAY_PX : 0;
  const header: Rect = { x: 0, y: top - HEADER_PX, width, height: HEADER_PX };

  let tray: Rect;
  let stage: Rect;
  if (orientation === 'landscape') {
    const trayX = hand === 'right' ? trayRoom - TRAY_PX : width - trayRoom;
    tray = { x: trayX, y: top, width: TRAY_PX, height: height - top };
    stage = { x: hand === 'right' ? trayRoom : 0, y: top, width: width - trayRoom, height: height - top };
  } else {
    tray = { x: 0, y: height - trayRoom, width, height: TRAY_PX };
    stage = { x: 0, y: top, width, height: height - top - trayRoom };
  }

  const cardWidth = specCardWidth(width, height);
  const cover = shown.specCard ? cardWidth : 0;
  const specCard: Rect = {
    x: hand === 'right' ? stage.x + stage.width - cover : stage.x + cover - cardWidth,
    y: stage.y,
    width: cardWidth,
    height: stage.height,
  };
  const canvas: Rect = {
    x: hand === 'right' ? stage.x : stage.x + cover,
    y: stage.y,
    width: stage.width - cover,
    height: stage.height,
  };
  return { width, height, orientation, hand, shown, header, tray, stage, specCard, canvas, canvasShare: area(canvas) / (width * height) };
};

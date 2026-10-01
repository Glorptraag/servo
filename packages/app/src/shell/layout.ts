// Where every region of the shell sits (brief Section 9), as plain maths so it runs in unit tests. The canvas fills
// the screen behind the edges. The header, the part tray, the spec card and the Run bar lie over it, and together
// they never cover more than 30% of it, so the canvas keeps at least 70% of the screen in every state. The spec
// card's height is the one size that gives way. It is set for the state with everything open, so tucking an edge
// only ever uncovers more canvas. The shell renders these boxes and CSS animates between them. See docs/shell.md.
import type { CanvasMode } from '@servo/canvas';
import type { Edge, Tucked } from './edges.ts';

/** The header's height: 44 px targets and 4 px above and below (brief Section 9: "top edge, thin"). */
export const HEADER_PX = 52;
/** The tray's width in landscape and height in portrait: one column or row of 96 px tiles and 8 px round them. */
export const TRAY_PX = 112;
/** The spec card's width: a readable 300–340 px wherever the screen allows. */
export const SPEC_CARD_PX = 320;
/**
 * The most room the Run bar takes, at the bottom centre of the canvas: room for Run and Stop, the clock, Undo and
 * Reset arena (task 4.4). The layout keeps all of it covered in its sums, whatever the bar holds.
 */
export const RUN_BAR_PX = { width: 440, height: 64 } as const;
/** Tabs and the zoom control's buttons: 44 px targets. */
export const TAB_PX = 44;
/** The zoom control: three 44 px buttons, 4 px apart. */
export const ZOOM_PX = { width: 44, height: 140 } as const;
/** Brief Section 9: the canvas takes at least 70% of the screen in every state. */
export const MIN_CANVAS_SHARE = 0.7;

/** Between a control on the canvas and the edge of the canvas beside it. */
const INSET = { side: 8, bottom: 12, tab: 12 } as const;
/** The arena strip: along the top of the canvas, between the header's tab and its own. */
const STRIP = { top: 6, height: 52, gap: 8 } as const;

export type Orientation = 'landscape' | 'portrait';

/**
 * Which hand the layout suits. Left-handed mirrors the tray and the spec card (brief Section 13), and with them the
 * controls on the canvas; the header reads left to right either way. Task 5.7 sets it.
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
  /** The spec card steps aside, as it does while the child drags on the canvas, so it never covers a port being wired. */
  readonly specCardAside: boolean;
}

export interface ShellLayout {
  readonly width: number;
  readonly height: number;
  readonly orientation: Orientation;
  readonly hand: Hand;
  /** Whether each edge shows. The tray also hides in Run mode (brief Section 9), and the spec card while it steps aside. */
  readonly shown: Readonly<Record<Edge, boolean>>;
  /** The canvas's host: the whole shell. The canvas never resizes when an edge tucks. */
  readonly stage: Rect;
  /** The canvas that the header and the tray leave: the arena strip, the Run bar, the zoom control and the tabs sit on it. */
  readonly work: Rect;
  /** Each region's box while it shows. A hidden region keeps its size and lies just past the edge it tucks into. */
  readonly header: Rect;
  readonly tray: Rect;
  readonly specCard: Rect;
  readonly arenaStrip: Rect;
  /** All the room the Run bar may take. It always shows. */
  readonly runBar: Rect;
  readonly zoom: Rect;
  /** Each edge's tab, on the canvas side of its edge, so it stays on screen when the edge is tucked. */
  readonly tabs: Readonly<Record<Edge, Rect>>;
  /** The area of the canvas that the header, the tray, the spec card and the Run bar cover now. */
  readonly covered: number;
  /** The canvas a child sees: the share of the screen nothing covers. */
  readonly canvasShare: number;
}

export const area = (rect: Rect): number => Math.max(0, rect.width) * Math.max(0, rect.height);

/** Where two boxes overlap, or null. */
export const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

/** The area a few boxes cover together, each overlap counted once (inclusion–exclusion). */
export const unionArea = (rects: readonly Rect[]): number => {
  let total = 0;
  for (let subset = 1; subset < 1 << rects.length; subset += 1) {
    let common: Rect | null = null;
    let count = 0;
    for (const [index, rect] of rects.entries()) {
      if ((subset & (1 << index)) === 0) continue;
      common = count === 0 ? rect : common && intersect(common, rect);
      count += 1;
    }
    if (common) total += (count % 2 === 1 ? 1 : -1) * area(common);
  }
  return total;
};

/** Landscape when the shell is at least as wide as it is tall. */
export const orientationOf = (width: number, height: number): Orientation => (width >= height ? 'landscape' : 'portrait');

/**
 * The spec card's size on a screen of this size: SPEC_CARD_PX wide (at most half the canvas beside the tray), and as
 * tall as keeps the canvas at MIN_CANVAS_SHARE with the header, the tray, the card and the Run bar all showing. It
 * leaves the zoom control room below it. Zero on a screen too small for it.
 */
export const specCardSize = (width: number, height: number): { readonly width: number; readonly height: number } => {
  const landscape = orientationOf(width, height) === 'landscape';
  const workWidth = landscape ? width - TRAY_PX : width;
  const workHeight = landscape ? height - HEADER_PX : height - HEADER_PX - TRAY_PX;
  const cardWidth = Math.max(0, Math.min(SPEC_CARD_PX, Math.floor(workWidth / 2)));
  const edges = HEADER_PX * width + TRAY_PX * (landscape ? workHeight : width) + RUN_BAR_PX.width * RUN_BAR_PX.height;
  // One square pixel spare, so rounding never tips the canvas under its share.
  const room = (1 - MIN_CANVAS_SHARE) * width * height - edges - 1;
  const clear = workHeight - (INSET.bottom + ZOOM_PX.height + INSET.bottom);
  const cardHeight = cardWidth > 0 ? Math.max(0, Math.min(clear, Math.floor(room / cardWidth))) : 0;
  return cardHeight > 0 ? { width: cardWidth, height: cardHeight } : { width: 0, height: 0 };
};

export const solveLayout = ({ width, height, tucked, mode, hand, specCardAside }: LayoutInput): ShellLayout => {
  const orientation = orientationOf(width, height);
  const landscape = orientation === 'landscape';
  const shown: Record<Edge, boolean> = {
    header: !tucked.header,
    tray: !tucked.tray && mode === 'build',
    specCard: !tucked.specCard && !specCardAside,
    arenaStrip: !tucked.arenaStrip,
  };
  const top = shown.header ? HEADER_PX : 0;
  const trayRoom = shown.tray ? TRAY_PX : 0;

  // Laid out for the right hand; the left hand's layout is its mirror image.
  const header: Rect = { x: 0, y: top - HEADER_PX, width, height: HEADER_PX };
  const tray: Rect = landscape
    ? { x: trayRoom - TRAY_PX, y: top, width: TRAY_PX, height: height - top }
    : { x: 0, y: height - trayRoom, width, height: TRAY_PX };
  const work: Rect = landscape
    ? { x: trayRoom, y: top, width: width - trayRoom, height: height - top }
    : { x: 0, y: top, width, height: height - top - trayRoom };
  const card = specCardSize(width, height);
  const cardX = shown.specCard ? width - card.width : width;
  const specCard: Rect = { x: cardX, y: work.y, width: card.width, height: card.height };
  const bottom = work.y + work.height - INSET.bottom;
  const runBar: Rect = { x: work.x + (work.width - RUN_BAR_PX.width) / 2, y: bottom - RUN_BAR_PX.height, ...RUN_BAR_PX };
  const zoom: Rect = { x: width - INSET.side - ZOOM_PX.width, y: bottom - ZOOM_PX.height, ...ZOOM_PX };
  const tab = (x: number, y: number): Rect => ({ x, y, width: TAB_PX, height: TAB_PX });
  const headerTab = tab(work.x + INSET.tab, work.y);
  const tabs: Record<Edge, Rect> = {
    header: headerTab,
    tray: landscape ? tab(work.x, work.y + (work.height - TAB_PX) / 2) : tab(work.x + INSET.tab, work.y + work.height - TAB_PX),
    specCard: tab(cardX - TAB_PX, specCard.y + (card.height - TAB_PX) / 2),
    arenaStrip: tab(cardX - INSET.tab - TAB_PX, work.y + STRIP.top + (STRIP.height - TAB_PX) / 2),
  };
  const stripLeft = headerTab.x + TAB_PX + STRIP.gap;
  const arenaStrip: Rect = {
    x: stripLeft,
    y: shown.arenaStrip ? work.y + STRIP.top : work.y - STRIP.height,
    width: Math.max(0, tabs.arenaStrip.x - STRIP.gap - stripLeft),
    height: STRIP.height,
  };

  const mirror = (rect: Rect): Rect => (hand === 'right' ? rect : { ...rect, x: width - rect.x - rect.width });
  const screen: Rect = { x: 0, y: 0, width, height };
  const covering = [shown.header && header, shown.tray && tray, shown.specCard && specCard, runBar]
    .filter((rect): rect is Rect => rect !== false)
    .map((rect) => intersect(rect, screen))
    .filter((rect): rect is Rect => rect !== null);
  const covered = unionArea(covering);
  return {
    width,
    height,
    orientation,
    hand,
    shown,
    stage: screen,
    work: mirror(work),
    header,
    tray: mirror(tray),
    specCard: mirror(specCard),
    arenaStrip: mirror(arenaStrip),
    runBar: mirror(runBar),
    zoom: mirror(zoom),
    tabs: {
      header: mirror(tabs.header),
      tray: mirror(tabs.tray),
      specCard: mirror(tabs.specCard),
      arenaStrip: mirror(tabs.arenaStrip),
    },
    covered,
    canvasShare: width * height > 0 ? 1 - covered / (width * height) : 1,
  };
};

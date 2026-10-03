// Where every region of the shell sits (brief Section 9), as plain maths so it runs in unit tests. The canvas fills
// the screen behind the edges. The header, the part tray, the spec card, the Run bar, the zoom control and the tabs
// lie over it, and together they never cover more than 30% of it, so the canvas keeps at least 70% of the screen in
// every state. The arena strip is a layer of the canvas and is not counted. The spec card's height is the one size
// that gives way, set for the state with everything open and the card showing, so any other state uncovers more.
// The Run bar and the zoom control stay where that state puts them, whatever tucks or slides, so the Run/Stop button
// is always under the finger that pressed it. The shell renders these boxes and CSS animates between them. See
// docs/shell.md.
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
 * Reset arena (task 4.4). The layout counts all of it as covered, whatever the bar holds.
 */
export const RUN_BAR_PX = { width: 440, height: 64 } as const;
/** Tabs and the zoom control's buttons: 44 px targets. */
export const TAB_PX = 44;
/** The zoom control: four 44 px buttons (zoom in, Fit, Tidy wires, zoom out), 4 px apart. */
export const ZOOM_PX = { width: 44, height: 188 } as const;
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

/**
 * How far in from each side of the screen the canvas a child can see begins: past the header, the tray and the spec
 * card where they show, the Run bar's room at the bottom, and the zoom control's column on the card's side when the
 * card is away. For the canvas's load and Fit to centre the build in (task 3.7); see ShellProps.onSafeArea.
 */
export interface SafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface LayoutInput {
  /** The shell's size: its host's. */
  readonly width: number;
  readonly height: number;
  readonly tucked: Tucked;
  readonly mode: CanvasMode;
  readonly hand: Hand;
  /** A part is selected, so the spec card has something to show: it slides in on a tap (brief Section 9). */
  readonly specCardWanted: boolean;
  /** The spec card steps aside, as it does while the child drags on the canvas, so it never covers a port being wired. */
  readonly specCardAside: boolean;
}

export interface ShellLayout {
  readonly width: number;
  readonly height: number;
  readonly orientation: Orientation;
  readonly hand: Hand;
  /**
   * Whether each edge shows. The tray also hides in Run mode (brief Section 9); the spec card shows only while a part
   * is selected, and not while it steps aside.
   */
  readonly shown: Readonly<Record<Edge, boolean>>;
  /** Whether each tab shows: the tray's goes in Run mode, and the spec card's while there is no card to show. */
  readonly tabShown: Readonly<Record<Edge, boolean>>;
  /** The canvas's host: the whole shell. The canvas never resizes when an edge tucks. */
  readonly stage: Rect;
  /** The canvas that the header and the tray leave now. */
  readonly work: Rect;
  /** Each region's box while it shows. A hidden region keeps its size and lies just past the edge it tucks into. */
  readonly header: Rect;
  readonly tray: Rect;
  readonly specCard: Rect;
  readonly arenaStrip: Rect;
  /** All the room the Run bar may take. It always shows, and never moves for a mode, a tuck or a slide. */
  readonly runBar: Rect;
  /** Never moves for a mode, a tuck or a slide either. */
  readonly zoom: Rect;
  /** Each edge's tab, on the canvas side of its edge, so it stays on screen when the edge is tucked. */
  readonly tabs: Readonly<Record<Edge, Rect>>;
  readonly safeArea: SafeArea;
  /** The area of the canvas covered now: by the header, tray and spec card where they show, the Run bar's room, the zoom control and the tabs that show. */
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

/** The area some boxes cover together, each overlap counted once: a sweep across their x edges. */
export const unionArea = (rects: readonly Rect[]): number => {
  const solid = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  const xs = [...new Set(solid.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let total = 0;
  for (const [index, left] of xs.slice(0, -1).entries()) {
    const right = xs[index + 1] ?? left;
    const spans = solid
      .filter((rect) => rect.x <= left && rect.x + rect.width >= right)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let reach = -Infinity;
    for (const [top, bottom] of spans) {
      if (bottom <= reach) continue;
      covered += bottom - Math.max(top, reach);
      reach = bottom;
    }
    total += covered * (right - left);
  }
  return total;
};

/** Landscape when the shell is at least as wide as it is tall. */
export const orientationOf = (width: number, height: number): Orientation => (width >= height ? 'landscape' : 'portrait');

/** The canvas the header and the tray leave with everything open in Build mode: where the Run bar and the zoom control are placed. */
const homeWork = (width: number, height: number): Rect =>
  orientationOf(width, height) === 'landscape'
    ? { x: TRAY_PX, y: HEADER_PX, width: width - TRAY_PX, height: height - HEADER_PX }
    : { x: 0, y: HEADER_PX, width, height: height - HEADER_PX - TRAY_PX };

/**
 * The spec card's size on a screen of this size: SPEC_CARD_PX wide (at most half the canvas beside the tray), and as
 * tall as keeps the canvas at MIN_CANVAS_SHARE with the header, the tray, the card, the Run bar, the zoom control and
 * every tab showing. It leaves the zoom control room below it. Zero on a screen too small for it.
 */
export const specCardSize = (width: number, height: number): { readonly width: number; readonly height: number } => {
  const work = homeWork(width, height);
  const cardWidth = Math.max(0, Math.min(SPEC_CARD_PX, Math.floor(work.width / 2)));
  const trayArea = orientationOf(width, height) === 'landscape' ? TRAY_PX * work.height : TRAY_PX * width;
  const others =
    HEADER_PX * width +
    trayArea +
    RUN_BAR_PX.width * RUN_BAR_PX.height +
    ZOOM_PX.width * ZOOM_PX.height +
    4 * TAB_PX * TAB_PX;
  // One square pixel spare, so rounding never tips the canvas under its share.
  const room = (1 - MIN_CANVAS_SHARE) * width * height - others - 1;
  const clear = work.height - (INSET.bottom + ZOOM_PX.height + INSET.bottom);
  const cardHeight = cardWidth > 0 ? Math.max(0, Math.min(clear, Math.floor(room / cardWidth))) : 0;
  return cardHeight > 0 ? { width: cardWidth, height: cardHeight } : { width: 0, height: 0 };
};

export const solveLayout = ({ width, height, tucked, mode, hand, specCardWanted, specCardAside }: LayoutInput): ShellLayout => {
  const orientation = orientationOf(width, height);
  const landscape = orientation === 'landscape';
  const shown: Record<Edge, boolean> = {
    header: !tucked.header,
    tray: !tucked.tray && mode === 'build',
    specCard: specCardWanted && !tucked.specCard && !specCardAside,
    arenaStrip: !tucked.arenaStrip,
  };
  const tabShown: Record<Edge, boolean> = { header: true, tray: mode === 'build', specCard: specCardWanted, arenaStrip: true };
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
  const cardHome = width - card.width;
  const cardX = shown.specCard ? cardHome : width;
  const specCard: Rect = { x: cardX, y: work.y, width: card.width, height: card.height };

  // The Run bar and the zoom control: where everything open in Build mode puts them, in every state.
  const home = homeWork(width, height);
  const homeBottom = home.y + home.height - INSET.bottom;
  const runBar: Rect = { x: home.x + (home.width - RUN_BAR_PX.width) / 2, y: homeBottom - RUN_BAR_PX.height, ...RUN_BAR_PX };
  const zoom: Rect = { x: width - INSET.side - ZOOM_PX.width, y: homeBottom - ZOOM_PX.height, ...ZOOM_PX };

  const tab = (x: number, y: number): Rect => ({ x, y, width: TAB_PX, height: TAB_PX });
  const tabs: Record<Edge, Rect> = {
    header: tab(work.x + INSET.tab, work.y),
    tray: landscape ? tab(work.x, work.y + (work.height - TAB_PX) / 2) : tab(work.x + INSET.tab, work.y + work.height - TAB_PX),
    specCard: tab(cardX - TAB_PX, specCard.y + (card.height - TAB_PX) / 2),
    // Beside where the card sits when it shows, so the strip and its tab stay put as the card comes and goes.
    arenaStrip: tab(cardHome - INSET.tab - TAB_PX, work.y + STRIP.top + (STRIP.height - TAB_PX) / 2),
  };
  const stripLeft = home.x + INSET.tab + TAB_PX + STRIP.gap;
  const arenaStrip: Rect = {
    x: stripLeft,
    y: shown.arenaStrip ? work.y + STRIP.top : work.y - STRIP.height,
    width: Math.max(0, tabs.arenaStrip.x - STRIP.gap - stripLeft),
    height: STRIP.height,
  };

  const bottomRoom = height - runBar.y;
  const safeArea: SafeArea = {
    top,
    left: landscape ? trayRoom : 0,
    bottom: landscape ? bottomRoom : Math.max(bottomRoom, trayRoom),
    right: shown.specCard ? card.width : width - zoom.x,
  };

  const mirror = (rect: Rect): Rect => (hand === 'right' ? rect : { ...rect, x: width - rect.x - rect.width });
  const screen: Rect = { x: 0, y: 0, width, height };
  const covering = [
    shown.header && header,
    shown.tray && tray,
    shown.specCard && specCard,
    runBar,
    zoom,
    ...(Object.keys(tabs) as Edge[]).map((edge) => tabShown[edge] && tabs[edge]),
  ]
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
    tabShown,
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
    safeArea: hand === 'right' ? safeArea : { ...safeArea, left: safeArea.right, right: safeArea.left },
    covered,
    canvasShare: width * height > 0 ? 1 - covered / (width * height) : 1,
  };
};

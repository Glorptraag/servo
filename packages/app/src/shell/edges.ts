// The shell's edges (brief Section 9): the regions round the canvas that a child can tuck away, and where the tuck
// states persist. They are UI state on this device, so they live in localStorage, not in the store: the store
// (task 4.9) holds builds. See docs/shell.md.

/**
 * Every region a child can tuck away, in the order the tabs are read. The Run bar is not one of them: it is the one
 * control a child must always reach (brief Section 9, "always visible").
 */
export const EDGES = ['header', 'tray', 'specCard', 'arenaStrip'] as const;

export type Edge = (typeof EDGES)[number];

/** The brief's name for each region: its landmark's accessible name and its tab's. */
export const EDGE_NAMES: Readonly<Record<Edge, string>> = {
  header: 'Header',
  tray: 'Part tray',
  specCard: 'Spec card',
  arenaStrip: 'Arena strip',
};

/** The Run bar's landmark name. */
export const RUN_BAR_NAME = 'Run bar';

/** Which edges are tucked away. Every edge starts open, as in the brief's layout. */
export type Tucked = Readonly<Record<Edge, boolean>>;

export const ALL_OPEN: Tucked = { header: false, tray: false, specCard: false, arenaStrip: false };

/** The localStorage key: a JSON list of the tucked edges' names. */
export const TUCKED_KEY = 'servo.shell.tucked';

const isEdge = (value: unknown): value is Edge => typeof value === 'string' && (EDGES as readonly string[]).includes(value);

/**
 * The storage the tuck states persist in, or null where the page has none. Reading `localStorage` itself throws in
 * some browsers when site data is blocked, so even the lookup is guarded.
 */
export const pageStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The tuck states saved in `storage`. Anything missing, unreadable or unknown counts as open. */
export const readTucked = (storage: Storage | null): Tucked => {
  let saved: unknown;
  try {
    saved = JSON.parse(storage?.getItem(TUCKED_KEY) ?? '[]');
  } catch {
    return ALL_OPEN;
  }
  if (!Array.isArray(saved)) return ALL_OPEN;
  const tucked = new Set(saved.filter(isEdge));
  return Object.fromEntries(EDGES.map((edge) => [edge, tucked.has(edge)])) as Record<Edge, boolean>;
};

/** Saves the tuck states. A storage that refuses (full, blocked, private browsing) leaves them for this visit only. */
export const writeTucked = (storage: Storage | null, tucked: Tucked): void => {
  try {
    storage?.setItem(TUCKED_KEY, JSON.stringify(EDGES.filter((edge) => tucked[edge])));
  } catch {
    // Nothing to do: the layout still follows the child's taps until the page closes.
  }
};

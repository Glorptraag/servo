// The app shell (task 4.1): layout, tucking, the header and the zoom control. See docs/shell.md.
export { useShell } from './context.ts';
export type { ShellApi } from './context.ts';
export { ALL_OPEN, EDGES, EDGE_NAMES, TUCKED_KEY, readTucked, writeTucked } from './edges.ts';
export type { Edge, Tucked } from './edges.ts';
export type { HeaderSlots } from './header.tsx';
export { HEADER_PX, MIN_CANVAS_SHARE, SPEC_CARD_PX, TRAY_PX, area, orientationOf, solveLayout, specCardWidth } from './layout.ts';
export type { Hand, LayoutInput, Orientation, Rect, ShellLayout } from './layout.ts';
export { PLACEHOLDER_SLOTS } from './placeholders.tsx';
export { DEFAULT_PREFS, Shell } from './shell.tsx';
export type { CanvasSetup, ShellProps, ShellSlots } from './shell.tsx';
export { zoomInFrom, zoomOutFrom } from './zoom.ts';

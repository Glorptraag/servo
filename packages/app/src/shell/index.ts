// The app shell (task 4.1): layout, tucking, the header and the zoom control, with Save and the blueprint's name
// (task 4.9). See docs/shell.md.
export { useShell } from './context.ts';
export type { ShellApi } from './context.ts';
export { ALL_OPEN, EDGES, EDGE_NAMES, RUN_BAR_NAME, TUCKED_KEY, readTucked, writeTucked } from './edges.ts';
export type { Edge, Tucked } from './edges.ts';
export type { HeaderSlots } from './header.tsx';
export {
  HEADER_PX,
  MIN_CANVAS_SHARE,
  RUN_BAR_PX,
  SPEC_CARD_PX,
  TAB_PX,
  TRAY_PX,
  ZOOM_PX,
  area,
  intersect,
  orientationOf,
  solveLayout,
  specCardSize,
  unionArea,
} from './layout.ts';
export type { Hand, LayoutInput, Orientation, Rect, SafeArea, ShellLayout } from './layout.ts';
export { tidyName } from './name.tsx';
export { PLACEHOLDER_SLOTS } from './placeholders.tsx';
export { SAVE_LINES, SaveControl } from './save.tsx';
export { DEFAULT_PREFS, DRAG_PX, Shell } from './shell.tsx';
export type { CanvasSetup, ShellProps, ShellSlots } from './shell.tsx';
export { zoomInFrom, zoomOutFrom } from './zoom.ts';

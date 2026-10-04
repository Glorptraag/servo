// The mark the performance measurement reads (task 6.1, docs/perf.md): the web build's entry and the perf page set
// `servo:interactive` once the app's canvas is mounted and takes input, and packages/tools/src/perf/ reads it from the
// page's performance timeline beside the browser's own first-contentful-paint.

/** The mark's name: when the shell, the tray and the canvas are up and a child can build. */
export const INTERACTIVE_MARK = 'servo:interactive';

/** Marks the app as interactive, once per page. */
export const markInteractive = (): void => {
  if (performance.getEntriesByName(INTERACTIVE_MARK).length === 0) performance.mark(INTERACTIVE_MARK);
};

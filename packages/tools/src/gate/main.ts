/// <reference lib="dom" />
// The gate page's entry, loaded by index.html. A failure to start shows as a line on the page, never a dialog.
import { startGate } from './page.ts';

const root = document.getElementById('gate');
if (root) {
  startGate(root).catch((error: unknown) => {
    console.error(error);
    const line = document.getElementById('status');
    if (line) line.textContent = `The gate page could not start: ${error instanceof Error ? error.message : String(error)}`;
  });
}

// The harness runs in the browser (Vitest browser mode, Playwright's Chromium), so it adds the DOM library to tools'
// Node-only types, and the Playwright provider's types for `vitest/browser` (CDP sessions, screenshots).
/// <reference lib="dom" />
/// <reference types="@vitest/browser-playwright" />

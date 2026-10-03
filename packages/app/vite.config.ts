import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { offlinePlugin } from './src/offline/plugin.ts';

// The app's web build: `pnpm dev`, `pnpm build` and `pnpm preview` (docs/shell.md, "Running it"). Both dev and build
// run `pnpm art` first, so content's art registry exists; without it every part draws as a neutral tile. The build
// also writes the service worker that keeps the app on the device for offline use (src/offline/, task 5.5). The build has
// two pages: index.html, the child's app, and parent.html, the parent view from packages/parent behind its parental gate
// (D28, D91), which the app may not import and so reaches only by a link from Home.
export default defineConfig({
  plugins: [react(), offlinePlugin()],
  build: {
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        parent: fileURLToPath(new URL('parent.html', import.meta.url)),
      },
    },
    // D14's default browser baseline: iPadOS/Safari 17+, Chrome and Edge 120+, Firefox 120+, ES2023.
    target: ['es2023', 'safari17', 'chrome120', 'edge120', 'firefox120'],
  },
});

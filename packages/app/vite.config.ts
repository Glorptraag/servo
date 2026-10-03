import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { offlinePlugin } from './src/offline/plugin.ts';

// The app's web build: `pnpm dev`, `pnpm build` and `pnpm preview` (docs/shell.md, "Running it"). Both dev and build
// run `pnpm art` first, so content's art registry exists; without it every part draws as a neutral tile. The build
// also writes the service worker that keeps the app on the device for offline use (src/offline/, task 5.5).
export default defineConfig({
  plugins: [react(), offlinePlugin()],
  build: {
    // D14's default browser baseline: iPadOS/Safari 17+, Chrome and Edge 120+, Firefox 120+, ES2023.
    target: ['es2023', 'safari17', 'chrome120', 'edge120', 'firefox120'],
  },
});

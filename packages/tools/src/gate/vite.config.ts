// Gate G3's page: `pnpm gate:g3` at the repo root runs `pnpm art`, then this Vite dev server. It listens on every
// interface, so an iPad on the same Wi-Fi can open it, and prints the address to open there.
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/** The port the page asks for; Vite takes the next free one when it is busy, and the printed address says which. */
export const GATE_PORT = 5190;

/** This machine's IPv4 addresses on its local networks. */
const lanAddresses = (): string[] =>
  Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);

const printLanUrl = (): Plugin => ({
  name: 'servo-gate-lan-url',
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      const address = server.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : GATE_PORT;
      const urls = lanAddresses().map((ip) => `http://${ip}:${port}/`);
      const { logger } = server.config;
      logger.info('');
      logger.info(`  Gate G3 on this laptop: http://localhost:${port}/`);
      if (urls.length === 0) logger.info('  No Wi-Fi or network address found: join the iPad and this laptop to the same Wi-Fi, then start again.');
      for (const url of urls) logger.info(`  Gate G3 on the iPad (same Wi-Fi): ${url}`);
      logger.info('');
    });
  },
});

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [printLanUrl()],
  server: { host: '0.0.0.0', port: GATE_PORT },
  preview: { host: '0.0.0.0', port: GATE_PORT },
  build: {
    // D14's browser baseline, as the app's build: iPadOS/Safari 17+.
    target: ['es2023', 'safari17', 'chrome120', 'edge120', 'firefox120'],
  },
});

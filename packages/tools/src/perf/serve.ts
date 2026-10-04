// A static server for a built app folder, gzipping text as any web host does, so a shaped network carries the bytes a
// device would download. `vite preview` sends files uncompressed. Node only.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const COMPRESSED = new Set(['.html', '.js', '.css', '.svg', '.json', '.wasm', '.webmanifest']);

export interface StaticServer {
  readonly url: string;
  close(): Promise<void>;
}

export const serveFolder = async (folder: string): Promise<StaticServer> => {
  const gzipped = new Map<string, Buffer>();
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = path.join(folder, path.normalize(relative));
    if (!file.startsWith(`${folder}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const ext = path.extname(file);
    const headers: Record<string, string> = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' };
    const raw: Buffer = fs.readFileSync(file);
    let body = raw;
    if (COMPRESSED.has(ext) && /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
      body = gzipped.get(file) ?? zlib.gzipSync(raw, { level: 9 });
      gzipped.set(file, body);
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = String(body.length);
    response.writeHead(200, headers).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

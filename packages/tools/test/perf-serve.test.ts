// The app performance measurement's static server (src/perf/serve.ts, task 6.1): it gzips text as a web host does, so
// a shaped network carries a device's bytes, sends other files as they are, and serves nothing outside its folder.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveFolder } from '../src/perf/serve.ts';
import type { StaticServer } from '../src/perf/serve.ts';

let folder: string;
let server: StaticServer;
const script = 'export const answer = 42;\n'.repeat(200);

beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'servo-perf-serve-'));
  fs.mkdirSync(path.join(folder, 'assets'));
  fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><title>Servo</title>');
  fs.writeFileSync(path.join(folder, 'assets', 'app.js'), script);
  fs.writeFileSync(path.join(folder, 'assets', 'tile.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(os.tmpdir(), 'servo-perf-outside.txt'), 'outside');
  server = await serveFolder(folder);
});

afterAll(async () => {
  await server.close();
  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), 'servo-perf-outside.txt'), { force: true });
});

/** A raw GET, so the body arrives as the server sent it, compressed or not. */
const get = (pathname: string, gzip: boolean): Promise<{ status: number; encoding: string | undefined; type: string | undefined; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const request = http.get(`${server.url}${pathname}`, { headers: { 'accept-encoding': gzip ? 'gzip' : 'identity' } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          encoding: response.headers['content-encoding'],
          type: response.headers['content-type'],
          body: Buffer.concat(chunks),
        }),
      );
    });
    request.on('error', reject);
  });

describe('the perf static server', () => {
  it('gzips a script for a browser that takes gzip, and sends it plain otherwise', async () => {
    const zipped = await get('/assets/app.js', true);
    expect(zipped.status).toBe(200);
    expect(zipped.type).toMatch(/^text\/javascript/);
    expect(zipped.encoding).toBe('gzip');
    expect(zipped.body.length).toBeLessThan(script.length / 10);
    expect(zlib.gunzipSync(zipped.body).toString()).toBe(script);
    const plain = await get('/assets/app.js', false);
    expect(plain.encoding).toBeUndefined();
    expect(plain.body.toString()).toBe(script);
  });

  it('serves index.html for the folder and an image as it is', async () => {
    expect((await get('/', false)).body.toString()).toContain('<title>Servo</title>');
    const image = await get('/assets/tile.png', true);
    expect(image.encoding).toBeUndefined();
    expect(image.type).toBe('image/png');
  });

  it('serves nothing outside its folder', async () => {
    expect((await get('/missing.js', false)).status).toBe(404);
    expect((await get('/../servo-perf-outside.txt', false)).status).toBe(404);
    expect((await get('/%2e%2e/servo-perf-outside.txt', false)).status).toBe(404);
  });
});

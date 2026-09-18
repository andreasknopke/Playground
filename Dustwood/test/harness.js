// Playwright test harness. See Plan.txt §10.1. Serves the repo root on a free
// port, launches SwiftShader Chromium, and exposes api.game(method, ...args),
// api.state(), api.step(n, dt), api.waitReady(timeout), api.shot(name).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.wasm': 'application/wasm',
};

function startServer() {
  return new Promise((res) => {
    const server = createServer(async (req, r) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        let p = decodeURIComponent(url.pathname);
        if (p === '/' || p === '') p = '/index.html';
        const safe = normalize(p).replace(/^(\.\.[/\\])+/, '');
        let fp = join(ROOT, safe);
        if (!fp.startsWith(ROOT)) { r.writeHead(403).end(); return; }
        let body;
        try { body = await readFile(fp); } catch { r.writeHead(404).end('nf'); return; }
        r.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
        r.end(body);
      } catch { r.writeHead(500).end(); }
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

export async function withGame(fn, opts = {}) {
  const { url = '/index.html', query = '', viewport = { width: 1280, height: 720 } } = opts;
  const { server, port } = await startServer();
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage({ viewport });
  const logs = [];
  const pageErrors = [];
  page.on('console', (m) => { logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const api = {
    page,
    logs,
    pageErrors,
    async game(method, ...args) {
      return page.evaluate(({ m, a }) => {
        const g = window.__game;
        if (!g) throw new Error('__game not installed');
        const parts = m.split('.');
        let fn = g; let ctx = g;
        for (const part of parts) { ctx = fn; fn = fn[part]; }
        if (typeof fn !== 'function') throw new Error('no method ' + m);
        return fn.apply(ctx, a);
      }, { m: method, a: args });
    },
    async state() { return api.game('getState'); },
    async step(n = 60, dt = 1 / 60) { return api.game('step', dt, n); },
    async waitReady(timeout = 60000) {
      await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout });
    },
    async shot(name) {
      const path = join(ROOT, 'test', 'shots', name.endsWith('.png') ? name : name + '.png');
      await page.screenshot({ path });
      return path;
    },
  };

  const fullUrl = `http://127.0.0.1:${port}${url}${query ? (url.includes('?') ? '&' : '?') + query : ''}`;
  try {
    await page.goto(fullUrl, { waitUntil: 'load', timeout: 60000 });
    await fn(page, api);
  } finally {
    await browser.close();
    server.close();
  }
}

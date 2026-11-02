// lib/panel/server.mjs — 本地开发/宿主挂载用的 HTTP 包装。不自动启动。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { handlePanelRequest } from './api.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function sendStatic(res, panelDir, pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '' || rel === '/workmem/panel' || rel === '/workmem/panel/') rel = '/index.html';
  else if (rel.startsWith('/workmem/panel/')) rel = rel.slice('/workmem/panel'.length);
  const file = resolve(panelDir, '.' + rel);
  if (!file.startsWith(resolve(panelDir) + sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

export function createPanelServer(dataRoot, { panelDir = resolve('panel'), host = '127.0.0.1' } = {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
      const path = url.pathname;
      const isApi = /^\/workmem\/panel\/(stats|sessions|list|search|detail|timeline|weights|snapshots|health|diagnostics|mode|consolidation|consolidate|write|archive|revoke|restore|snapshot|rollback)$/.test(path);
      if (isApi) {
        let body = '';
        for await (const chunk of req) body += chunk;
        const out = await handlePanelRequest(dataRoot, { method: req.method, url: req.url, body });
        sendJson(res, out.status, out.body);
        return;
      }
      sendStatic(res, panelDir, path);
    } catch (e) {
      sendJson(res, 500, { ok: false, data: null, error: 'exception', message: String(e?.message || e) });
    }
  });
}

export function startPanelServer(dataRoot, { port = 0, host = '127.0.0.1', panelDir = resolve('panel') } = {}) {
  const server = createPanelServer(dataRoot, { panelDir, host });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolvePromise({ server, host, port: address.port, url: 'http://' + host + ':' + address.port + '/workmem/panel/' });
    });
  });
}

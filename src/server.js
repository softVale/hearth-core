import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Ledger } from './ledger.js';
import { HearthCore } from './core.js';

const ledger = new Ledger(config.dataDir);
const core = new HearthCore({ ledger, config });
const sweepTimer = setInterval(() => core.sweep().catch((error) => console.error('sweep failed:', error.message)), config.sweepIntervalMs);
sweepTimer.unref();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const authorized = (req) => config.adminToken && req.headers.authorization === `Bearer ${config.adminToken}`;
const body = async (req) => {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) throw new Error('请求过大'); }
  return raw ? JSON.parse(raw) : {};
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, version: '0.2.0' });
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(publicDir, 'index.html')));
    }
    if (!authorized(req)) return json(res, 401, { ok: false, error: '请提供 Bearer ADMIN_TOKEN' });
    if (req.method === 'GET' && url.pathname === '/api/events') return json(res, 200, { ok: true, events: ledger.list(Number(url.searchParams.get('limit')) || 100) });
    if (req.method === 'POST' && url.pathname === '/api/triggers') return json(res, 202, { ok: true, trigger: core.trigger(await body(req)) });
    if (req.method === 'POST' && url.pathname === '/api/sweep') {
      const input = await body(req);
      return json(res, 200, await core.sweep({ force: input.force === true }));
    }
    if (req.method === 'POST' && url.pathname === '/api/wake') return json(res, 200, await core.wake(await body(req)));
    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(config.port, '0.0.0.0', () => console.log(`Hearth Core: http://localhost:${config.port}`));

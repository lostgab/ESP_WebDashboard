#!/usr/bin/env node
/*
 * LimProjects Dashboard — Render web service
 * -------------------------------------------
 * A zero-dependency Node.js server that:
 *   1. Serves the multi-board dashboard from ./public/  (the page Render hosts)
 *   2. Acts as a HEARTBEAT RELAY for the MoonCutter ESP32 boards
 *
 * Why a relay? A browser on another network can never reach the ESP32
 * directly (home NAT), and an HTTPS page is additionally blocked from
 * loading plain-HTTP iframes/fetches (mixed content). So the ESP *pushes*
 * its status here every ~10 s (POST /api/heartbeat), and the dashboard
 * polls the same-origin GET /api/boards to show each board's online dot.
 *
 * The single-board board app (web/) is NOT served here — it lives in the
 * MoonCutter ESP repo and is served by the ESP32 itself (or its local mock).
 *
 * Run:
 *   node server.js            # port 8777 (local default)
 *   node server.js 9000       # custom port
 *
 * Then open http://localhost:8080/  (the dashboard).
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Port priority: CLI arg (node server.js 9000) > $PORT (Render sets this) > 8777 (local default)
const PORT = parseInt(process.argv[2] || process.env.PORT || '8777', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- heartbeat relay (remote status) ----
// Real ESP32s push their status here (POST /api/heartbeat) every ~10 s.
// The dashboard (served from Render, reachable from anywhere) polls
// GET /api/boards and shows a board as online when its last heartbeat
// is fresh. Keyed by board name (firmware MDNS_HOSTNAME, e.g. "laser").
const heartbeats = new Map();   // name -> { ...status, ip, ts }
const HEARTBEAT_STALE_MS = 30000;   // no beat for 30 s => offline

function pruneHeartbeats() {
  const now = Date.now();
  for (const [name, hb] of heartbeats) {
    if (now - hb.ts > HEARTBEAT_STALE_MS * 4) heartbeats.delete(name);
  }
}

// ---- HTTP helpers ----
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req, cb) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => cb(Buffer.concat(chunks)));
  req.on('error', () => cb(Buffer.alloc(0)));
}

function readJsonBody(req, cb) {
  readBody(req, (buf) => {
    try { cb(JSON.parse(buf.toString('utf8') || '{}')); }
    catch (_) { cb({}); }
  });
}

// ---- static file serving (the dashboard) ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/dashboard' || urlPath === '/dashboard/') {
    urlPath = '/index.html';
  } else {
    urlPath = urlPath.replace(/^\/dashboard/, '') || '/index.html';
  }
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Never cache: after a deploy the browser must fetch the new JS/CSS
      // immediately, or it keeps running the old client.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
}

// ---- API routing ----
function handleApi(req, res) {
  const url = req.url.split('?')[0];
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Boards POST their status here.
  //   Laser (ESP32 firmware): { board, state, fan, progress, line,
  //     totalLines, psram, chip, uptimeSec, ip }
  //   CNC (cnc-bridge.js):    { board, state, x, y, z, spindle, feed,
  //     message, uptimeSec, ip }
  // Unknown fields are passed through untouched, so new boards can add
  // fields without a relay change.
  if (url === '/api/heartbeat' && method === 'POST') {
    readJsonBody(req, (body) => {
      const name = String(body.board || 'board');
      const hb = { ...body, board: name, ts: Date.now() };
      heartbeats.set(name, hb);
      console.log(`[dashboard] heartbeat from "${name}": ${hb.state} ip=${hb.ip || ''}`);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  // Dashboard polls this (same origin as the page — works from any network).
  // Returns every board's latest heartbeat + whether it is fresh.
  if (url === '/api/boards' && method === 'GET') {
    pruneHeartbeats();
    const now = Date.now();
    const boards = [];
    for (const hb of heartbeats.values()) {
      const ageMs = now - hb.ts;
      // Pass the whole payload through (laser + CNC fields differ) and
      // add the freshness flag.
      boards.push({ ...hb, online: ageMs <= HEARTBEAT_STALE_MS, ageMs });
    }
    boards.sort((a, b) => a.board.localeCompare(b.board));
    sendJson(res, 200, { boards, staleMs: HEARTBEAT_STALE_MS });
    return;
  }

  sendJson(res, 404, { error: 'Unknown API endpoint: ' + url });
}

// ---- server ----
//   /            -> dashboard (multi-board shell)  [ROOT]
//   /dashboard   -> dashboard (alias)
//   /api/heartbeat -> POST: ESP32 pushes its status here
//   /api/boards    -> GET:  dashboard polls board status (same-origin)
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

// Simulate a demo board's heartbeat so the dashboard UI can be tested
// LOCALLY without the real ESP32. On Render (RENDER_SERVICE_ID is set)
// the real ESP32 sends its own heartbeats — the demo would overwrite the
// real board's status, so it is disabled there.
function simulateHeartbeat() {
  heartbeats.set('laser', {
    board: 'laser',
    state: 'idle',
    fan: false,
    progress: 0,
    line: 0,
    totalLines: 0,
    psram: true,
    chip: 'ESP32 (demo)',
    uptimeSec: 0,
    ip: '192.168.1.100',
    ts: Date.now(),
  });
}
if (!process.env.RENDER_SERVICE_ID) {
  simulateHeartbeat();
  setInterval(simulateHeartbeat, 10000);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  LimProjects Dashboard — Render web service');
  console.log('  ==========================================');
  console.log(`  Dashboard: http://localhost:${PORT}/`);
  const ip = lanIp();
  if (ip) console.log(`  LAN:       http://${ip}:${PORT}/`);
  console.log('');
  console.log('  The ESP32 pushes status to POST /api/heartbeat; the');
  console.log('  dashboard polls GET /api/boards (same-origin) for the dots.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

function lanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

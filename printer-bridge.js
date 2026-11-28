#!/usr/bin/env node
/*
 * printer-bridge.js — LAN bridge: OctoPrint → Render relay
 * -------------------------------------------------------
 * Runs on a PC connected to the home LAN (same network as the 3D printer).
 * Polls the OctoPrint API (or just checks the WebUI is reachable) and
 * POSTs a heartbeat to the Render relay every few seconds so the
 * dashboard can show printer status from anywhere.
 *
 * Usage:
 *   node printer-bridge.js                              # defaults
 *   node printer-bridge.js --board 192.168.1.139        # IP
 *   node printer-bridge.js --key YOUR_OCTOPRINT_API_KEY # unlocks temps/job
 *   node printer-bridge.js --relay https://limprojects.onrender.com
 *
 * Without an API key the bridge still reports online/offline + state
 * (OctoPrint's API returns 403 without a key, so it falls back to a
 * plain reachability check).
 *
 * Find your API key in OctoPrint: Settings → Server → API.
 */

'use strict';

// ---- config (CLI overrides) ----
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const BOARD = getArg('board', '192.168.1.139');
const RELAY = getArg('relay', 'https://limprojects.onrender.com');
const API_KEY = getArg('key', process.env.OCTOPRINT_API_KEY || '');
const PUSH_INTERVAL_MS = 5000;   // poll + push every 5 s
const BASE = `http://${BOARD}`;
const RELAY_URL = `${RELAY.replace(/\/+$/, '')}/api/heartbeat`;

console.log('');
console.log('  3D Printer Bridge — OctoPrint → Render relay');
console.log('  =============================================');
console.log(`  Board:  ${BASE}`);
console.log(`  Relay:  ${RELAY_URL}`);
console.log(`  API key: ${API_KEY ? 'yes (temps + job status)' : 'no (online/offline only)'}`);
console.log(`  Push:   every ${PUSH_INTERVAL_MS / 1000} s`);
console.log('');

// ---- poll the printer ----
async function pollPrinter() {
  // 1) Try the OctoPrint API (needs a key)
  if (API_KEY) {
    try {
      const r = await fetch(`${BASE}/api/printer`, {
        headers: { 'X-Api-Key': API_KEY },
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const j = await r.json();
        const st = j.state || {};
        const t = j.temperatures || {};
        const job = j.job || {};
        const state = st.error ? 'error' : st.operating ? 'operating' : 'ready';
        const body = {
          board: 'printer',
          state,
          ip: BOARD,
          ts: Date.now(),
        };
        if (t.tool0 != null) body.temp = Math.round(t.tool0.current * 10) / 10;
        if (t.bed != null) body.bedTemp = Math.round(t.bed.current * 10) / 10;
        if (job.progress != null) body.progress = Math.round(job.progress * 100);
        if (st.message) body.message = st.message;
        return body;
      }
      console.log(`[bridge] API returned ${r.status} — falling back to reachability check`);
    } catch (e) {
      // fall through to reachability check
    }
  }
  // 2) Fallback: is the WebUI reachable at all?
  try {
    const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(4000) });
    if (r.ok || r.status === 401 || r.status === 403) {
      return { board: 'printer', state: 'online', ip: BOARD, ts: Date.now() };
    }
  } catch (_) { /* unreachable */ }
  return null;
}

// ---- push to relay ----
async function pushToRelay() {
  const body = await pollPrinter();
  if (!body) {
    console.log('[bridge] printer unreachable');
    return;
  }
  try {
    const r = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.log(`[bridge] relay returned ${r.status}`);
    else console.log(`[bridge] pushed: ${body.state}` +
      (body.temp != null ? `  nozzle ${body.temp}°C` : '') +
      (body.bedTemp != null ? `  bed ${body.bedTemp}°C` : '') +
      (body.progress != null ? `  job ${body.progress}%` : ''));
  } catch (e) {
    console.log(`[bridge] relay push failed: ${e.message}`);
  }
}

pushToRelay();
setInterval(pushToRelay, PUSH_INTERVAL_MS);

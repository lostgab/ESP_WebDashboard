#!/usr/bin/env node
/*
 * cnc-bridge.js — LAN bridge: FluidNC WebSocket → Render relay
 * -----------------------------------------------------------
 * Runs on a PC connected to the home LAN (same network as the CNC ESP32).
 * Connects to FluidNC's WebSocket, parses the <?...> status reports,
 * and POSTs them to the Render relay every few seconds so the dashboard
 * can show CNC status from anywhere.
 *
 * Usage:
 *   node cnc-bridge.js                          # defaults
 *   node cnc-bridge.js --board cnc.local        # mDNS hostname
 *   node cnc-bridge.js --board 192.168.1.131    # IP
 *   node cnc-bridge.js --relay https://limprojects.onrender.com
 *
 * Requires: npm install ws
 */

'use strict';

const WebSocket = require('ws');

// ---- config (CLI overrides) ----
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const BOARD = getArg('board', '192.168.1.131');
const RELAY = getArg('relay', 'https://limprojects.onrender.com');
const PUSH_INTERVAL_MS = 3000;   // push to relay every 3 s
const WS_URL = `ws://${BOARD}/`;
const RELAY_URL = `${RELAY.replace(/\/+$/, '')}/api/heartbeat`;

console.log('');
console.log('  CNC Bridge — FluidNC → Render relay');
console.log('  ==================================');
console.log(`  Board:  ${WS_URL}`);
console.log(`  Relay:  ${RELAY_URL}`);
console.log(`  Push:   every ${PUSH_INTERVAL_MS / 1000} s`);
console.log('');

// ---- state ----
let lastStatus = null;   // latest parsed <?...>
let lastMessage = null;  // latest non-status WS message (ok, error, etc.)
let ws = null;
let pushTimer = null;

// ---- FluidNC state codes (PROTOCOL.md §7.1) ----
const STATE_NAMES = {
  0: 'idle', 1: 'run', 2: 'hold', 3: 'safe-pos',
  4: 'check', 5: 'alarm', 6: 'door', 7: 'cycle-hold',
  8: 'hold-pos', 9: 'kill0', 10: 'kill1',
};

// ---- parse status reports (both formats) ----
// New (FluidNC v4.1+): <Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:38.000,50.000,30.000>
// Old: <?:<state>,<line>,<buf>,<modal>,<posX>,<posY>,<posZ>,<wposX>,<wposY>,<wposZ>,<feed>,<spindle>
const STATE_MAP = {
  Idle: 'idle', Run: 'run', Hold: 'hold', SafePos: 'safe-pos',
  Check: 'check', Alarm: 'alarm', Door: 'door', CycleHold: 'cycle-hold',
  HoldPos: 'hold-pos', Kill0: 'kill0', Kill1: 'kill1',
};

function parseStatus(raw) {
  // New format: <State|MPos:x,y,z|FS:feed,spindle|WCO:wx,wy,wz>
  const m = raw.match(/^<([A-Za-z0-9]+)\|(.*)>/);
  if (m) {
    const state = STATE_MAP[m[1]] || m[1].toLowerCase();
    const out = { state };
    const mp = m[2].match(/MPos:([-\d.]+),([-\d.]+),([-\d.]+)/);
    if (mp) { out.x = +mp[1]; out.y = +mp[2]; out.z = +mp[3]; }
    const fs = m[2].match(/FS:([-\d.]+),([-\d.]+)/);
    if (fs) { out.feed = +fs[1]; out.spindle = +fs[2]; }
    const wc = m[2].match(/WCO:([-\d.]+),([-\d.]+),([-\d.]+)/);
    if (wc) { out.wx = +wc[1]; out.wy = +wc[2]; out.wz = +wc[3]; }
    return out;
  }
  // Old format: <?:...>
  const o = raw.match(/^<\?:(.*)/);
  if (!o) return null;
  const f = o[1].split(',').map(Number);
  if (f.length < 12) return null;
  return {
    state: STATE_NAMES[f[0]] || `state-${f[0]}`,
    line: f[1],
    buf: f[2],
    modal: f[3],
    x: f[4], y: f[5], z: f[6],
    wx: f[7], wy: f[8], wz: f[9],
    feed: f[10],
    spindle: f[11],
  };
}

// ---- push to relay ----
async function pushToRelay() {
  if (!lastStatus) return;
  const body = {
    board: 'cnc',
    state: lastStatus.state,
    x: lastStatus.x,
    y: lastStatus.y,
    z: lastStatus.z,
    wx: lastStatus.wx,
    wy: lastStatus.wy,
    wz: lastStatus.wz,
    feed: lastStatus.feed,
    spindle: lastStatus.spindle,
    line: lastStatus.line,
    message: lastMessage || undefined,
    ip: BOARD,
    ts: Date.now(),
  };
  try {
    const r = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.log(`[bridge] relay returned ${r.status}`);
  } catch (e) {
    console.log(`[bridge] relay push failed: ${e.message}`);
  }
}

// ---- WebSocket connection ----
function connect() {
  console.log(`[bridge] connecting to ${WS_URL} …`);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('[bridge] connected');
    // Start the push timer
    if (!pushTimer) {
      pushTimer = setInterval(pushToRelay, PUSH_INTERVAL_MS);
    }
  });

  ws.on('message', (data) => {
    const text = data.toString().trim();
    if (!text) return;

    // Status report (new <State|...> or old <?:...)
    if (text.startsWith('<')) {
      const s = parseStatus(text);
      if (s) {
        lastStatus = s;
        return;
      }
    }

    // Keepalive / client id — ignore
    if (text.startsWith('PING') || text.startsWith('currentID') || text.startsWith('CURRENT_ID')) {
      return;
    }

    // Everything else (ok, error, FSM, etc.) — keep as last message
    lastMessage = text;
  });

  ws.on('error', (e) => {
    console.log(`[bridge] WS error: ${e.message}`);
  });

  ws.on('close', (code, reason) => {
    console.log(`[bridge] disconnected (${code} ${reason || ''})`);
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    // Retry after 5 s
    setTimeout(connect, 5000);
  });
}

// ---- graceful shutdown ----
process.on('SIGINT', () => {
  console.log('\n[bridge] shutting down');
  if (pushTimer) clearInterval(pushTimer);
  if (ws) ws.close();
  process.exit(0);
});

connect();

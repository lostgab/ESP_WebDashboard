# LimProjects Dashboard

The **remote status dashboard** for the LimProjects machines: the MoonCutter
laser engraver **and** the FluidNC CNC. It's a GridStack tile dashboard with a
pane per machine, showing live status (state, progress, positions, spindle)
**from anywhere in the world** — even though the boards sit behind your home
router's NAT.

This is the page deployed to [Render](https://render.com) (free tier). It is
a **separate project** from the MoonCutter ESP firmware + board app, which
live in the [`LaserEngraverPhoneWeb`](https://github.com/lostgab/LaserEngraverPhoneWeb)
repo.

```
Laser ESP32 (behind home NAT) ──HTTPS POST──► Render (this service) ◄──poll── browser (anywhere)
   pushes status every 10 s                /api/heartbeat          /api/boards (same-origin)

CNC ESP32 (behind home NAT) ──WebSocket──► cnc-bridge.js (PC on home LAN)
   FluidNC status every 200 ms              │
                                            └──HTTPS POST──► /api/heartbeat (every 3 s)
```

## Why a heartbeat relay?

A browser on another network can **never** reach the ESP32 directly — the
board is behind your home router's NAT, and an HTTPS page is additionally
blocked from loading plain-HTTP iframes/fetches (mixed content). So instead
of the browser pulling from the board, the board **pushes** its status here:

- The ESP32 firmware POSTs its status to `POST /api/heartbeat` every 10 s
  (URL configured by `HEARTBEAT_URL` in the ESP's `config.h`).
- The dashboard polls the **same-origin** `GET /api/boards` and shows a board
  as **online** when its last heartbeat is < 30 s old (green), **engraving**
  (amber), or **offline** (red).
- The 10 s heartbeat also keeps the free-tier Render service awake while the
  ESP is powered on.

**Limitation:** from away you can *watch* status, not *control* the board —
the board's web page (upload / Start / Stop) still requires a direct
browser↔ESP connection. See the ESP repo's README for the planned tunnel
(Tailscale / cloudflared) work.

## Repository layout

```
WebDashboard/
├── server.js        ← zero-dep Node server: serves the dashboard + heartbeat relay
├── cnc-bridge.js    ← LAN bridge: FluidNC WebSocket → relay (run on a home-LAN PC)
├── public/
│   └── index.html   ← the GridStack tile dashboard (self-contained HTML/JS/CSS)
├── package.json     ← lets Render deploy this as a web service
└── render.yaml      ← Render Blueprint: one-click deploy (free tier)
```

## Run locally

```bash
node server.js            # default port 8080
node server.js 9000       # custom port
```

Then open `http://localhost:8080/`.

> **Local demo board:** when run locally (no `RENDER_SERVICE_ID` env var),
> the server feeds a fake "laser" board every 10 s so you can see the
> dashboard UI without the real ESP32. On Render the real ESP32 sends its own
> heartbeats, so the demo is disabled there.

## Push to GitHub

The repo lives at <https://github.com/lostgab/ESP_WebDashboard>.

**First time only** — link the local folder to GitHub:

```bash
git remote add origin https://github.com/lostgab/ESP_WebDashboard.git
```

**Every time you have changes:**

```bash
git add -A                 # stage all changes (or: git add <file>)
git commit -m "what changed"
git push                   # first push only: git push -u origin main
```

> **Auth:** the first push asks for GitHub credentials. On Windows,
> Git for Windows stores them in the Windows Credential Manager after the
> first successful push, so later pushes are silent. If you use a personal
> access token, use it as the password (GitHub no longer accepts account
> passwords for git over HTTPS).

## Deploy to Render

The dashboard service is **`limprojects-dash`** →
`https://limprojects-dash.onrender.com`.

> **Not to be confused with the MoonCutter board app:** the older
> `mooncutter-mock` / `limprojects` Render services host the single-board
> laser web app (from the `LaserEngraverPhoneWeb` repo), **not** this
> dashboard. This repo deploys its own separate service.

1. Push this repo to GitHub (steps above).
2. On [render.com](https://render.com): **New +** → **Blueprint** → pick the
   `lostgab/ESP_WebDashboard` repo, branch `main`. Render reads `render.yaml`
   and creates the free web service `limprojects-dash`.
3. Wait ~1–2 min for the build. The service page shows its URL:
   `https://limprojects-dash.onrender.com`.
4. Point the laser ESP32's `HEARTBEAT_URL` at
   `https://limprojects-dash.onrender.com/api/heartbeat` (in the ESP's
   `config.h`), reflash, and the Laser dot goes green within ~10 s.
5. Run the CNC bridge (below) with
   `--relay https://limprojects-dash.onrender.com` and the CNC pane lights up.

> **Free-tier caveat:** Render free services sleep after ~15 min idle, so the
> first request after a pause takes ~30–60 s to wake. Any code change
> requires a `git push` — Render redeploys on new commits automatically.

## CNC bridge (remote CNC status)

The CNC (FluidNC) has no built-in heartbeat push — its live status only
comes over a **WebSocket** the browser connects to directly, which only works
on the home LAN. To show CNC status from anywhere, a small bridge script runs
on a PC that is on the home LAN (e.g. your desktop, or a Raspberry Pi):

```bash
npm install            # installs ws (only the bridge needs it)
node cnc-bridge.js --board cnc.local --relay https://limprojects-dash.onrender.com
```

- `--board` — the FluidNC board address (`cnc.local` mDNS or an IP).
- `--relay` — the Render service URL (default: the live service).
- The bridge connects to the board's WebSocket, parses the `<?...>` status
  reports (state, X/Y/Z, feed, spindle — see `CncMachine/PROTOCOL.md` §7),
  and POSTs them to `POST /api/heartbeat` every 3 s as `board: "cnc"`.
- It reconnects automatically if the board or network drops.

> **Keep it running:** the bridge is a plain Node process — run it in a
> terminal, or as a scheduled task / service on the LAN PC. When it stops,
> the CNC pane goes offline after ~30 s (stale heartbeat).

## API

| Method | Path             | Purpose                                                        |
|--------|------------------|----------------------------------------------------------------|
| POST   | `/api/heartbeat` | Boards push their status. Laser body: `{ board, state, fan, progress, line, totalLines, psram, chip, uptimeSec, ip }`. CNC body: `{ board, state, x, y, z, feed, spindle, line, message, ip }`. Extra fields pass through untouched. |
| GET    | `/api/boards`    | Dashboard polls this. Returns every board's latest heartbeat + `online` (fresh < 30 s) |

## License

MPL-2.0 (part of the MoonCutter / LimProjects project).

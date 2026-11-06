# LimProjects Dashboard

The **remote status dashboard** for the MoonCutter laser engraver. It's a
multi-board shell that shows each ESP32 board's online/offline dot and live
status (state, progress, fan, uptime, IP) **from anywhere in the world** —
even though the boards sit behind your home router's NAT.

This is the page deployed to [Render](https://render.com) (free tier). It is
a **separate project** from the MoonCutter ESP firmware + board app, which
live in the [`LaserEngraverPhoneWeb`](https://github.com/lostgab/LaserEngraverPhoneWeb)
repo.

```
ESP32 (behind home NAT) ──HTTPS POST──► Render (this service) ◄──poll── browser (anywhere)
   pushes status every 10 s              /api/heartbeat          /api/boards (same-origin)
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
WebASP/
├── server.js        ← zero-dep Node server: serves the dashboard + heartbeat relay
├── public/
│   └── index.html   ← the multi-board dashboard (self-contained HTML/JS/CSS)
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

## Deploy to Render

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New +** → **Blueprint** → pick this
   repo, branch `main`. Render reads `render.yaml` and creates a free web
   service (named `limprojects`).
3. Wait ~1–2 min for the build. The service page shows its URL, e.g.
   `https://limprojects.onrender.com`.
4. Point the ESP32's `HEARTBEAT_URL` at
   `https://<your-service>.onrender.com/api/heartbeat` (in the ESP's
   `config.h`), reflash, and the dot goes green within ~10 s.

> **Existing service:** the live service was originally created as
> `mooncutter-mock`, so it still runs at
> `https://mooncutter-mock.onrender.com/`. Renaming the service in
> `render.yaml` only affects **new** services created from the Blueprint — it
> does not rename the existing one. To use the `limprojects` URL, either
> rename the service in the Render dashboard (Settings) or create a new
> service from the updated Blueprint.

> **Free-tier caveat:** Render free services sleep after ~15 min idle, so the
> first request after a pause takes ~30–60 s to wake. Any code change
> requires a `git push` — Render redeploys on new commits automatically.

## API

| Method | Path             | Purpose                                                        |
|--------|------------------|----------------------------------------------------------------|
| POST   | `/api/heartbeat` | ESP32 pushes its status. Body: `{ board, state, fan, progress, line, totalLines, psram, chip, uptimeSec, ip }` |
| GET    | `/api/boards`    | Dashboard polls this. Returns every board's latest heartbeat + `online` (fresh < 30 s) |

## License

MPL-2.0 (part of the MoonCutter / LimProjects project).

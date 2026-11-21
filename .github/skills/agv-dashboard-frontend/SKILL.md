---
name: agv-dashboard-frontend
description: >
  Frontend blueprint for the AgvReplayApi web dashboard (http://localhost:5037/) — a
  Seagate-branded, vanilla-JS (no framework) industrial monitoring dashboard with a
  left icon sidebar, a green header bar, and a GridStack.js tile grid of 11
  draggable tab-panes (2D map, 3D viewers, tables, live telemetry). Use this skill
  when the user wants to CREATE A NEW WEB DASHBOARD in this style, clone the
  dashboard's layout/design system, add a new pane to the existing dashboard, or
  replicate the pane/sidebar/header/zoom behavior. Trigger on: "create a web
  dashboard", "new dashboard like the AGV one", "clone the dashboard frontend",
  "add a pane", "dashboard design system", "Seagate dashboard", "GridStack pane",
  "sidebar tabs", "dashboard layout".
---

# AgvReplayApi Dashboard — Frontend Blueprint

Reference implementation: `d:\AgvReplayApi_v1` (ASP.NET Core serves it, but the
frontend is 100% portable — plain HTML/CSS/JS, no framework, no build step for the
dashboard itself). This skill captures everything needed to build a new web
dashboard with the same look and behavior.

## 1. Tech stack (deliberately minimal)

- **No framework, no bundler** for the dashboard shell. One Razor page
  (`Views/Home/Index.cshtml`) holds all markup + inline `<script>`; shared JS/CSS
  live in `wwwroot/` (`site.js`, `site.css`, `dashboard.css`).
- **GridStack.js v10** via CDN (in `_Layout.cshtml`) — the ONLY external UI lib.
  Gives: draggable/resizable tiles, 12-column grid, collision handling.
- **Vanilla JS patterns:** global functions on `window` (e.g.
  `window.gridShowPane`), `getElementById`, `fetch` for REST, `setInterval`
  polling for live data. No modules in the shell (the 3D viewer iframe is the
  one ES-module island).
- **CSS:** one `:root` token block + plain classes. No CSS framework.

## 2. Design tokens (Seagate Brand v4.0 — copy verbatim)

```css
:root {
  --primary: #6EBE49;        /* Seagate Green 400 — signature brand color */
  --primary-hover: #55A72F;  /* Green 500 — hover */
  --primary-active: #2F743C; /* Green 700 — pressed */
  --bg: #ffffff;
  --card-bg: #F0F5F9;        /* Sea 50 */
  --text: #11181F;           /* Sea 950 */
  --text-muted: #576272;     /* Carbon 600 */
  --border: #CFDDE8;         /* Sea 200 */
  --card-shadow: 0 2px 8px rgba(17,24,31,0.08);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
       background: var(--bg); color: var(--text); min-height: 100vh; }
```

Visual language: white background, light-blue-grey borders (`--border`),
**green header bar** (`background: var(--primary); color: #000`), rounded cards
(`border-radius: 12px; border: 2px solid var(--border); background: var(--card-bg)`),
muted secondary text everywhere (`--text-muted`), monospace for data/telemetry
(`font-family: monospace`), small dense UI (0.75–0.95rem font sizes).

## 3. Layout skeleton (the exact DOM tree)

```
body.dashboard
└── .dash-shell            ← display:flex; row; height:100vh; overflow:hidden
    │                        ← CSS `zoom` applied HERE for UI scaling (see §6)
    ├── .app-sidebar        ← 240px wide, vertical stack of icon buttons
    │   └── button.app-sidebar-btn[data-tab="..."]  (one per pane)
    └── .dash-right         ← flex:1; column
        ├── .header         ← green bar: brand + title (h1) | mode buttons
        │                     (Replay/Live) | Reset | zoom −/+/Reset controls
        └── .app-main       ← flex:1; overflow-y:auto  (the ONLY scroll area)
            └── .container#pageContainer   (padding: 0 0 24px)
                └── #tabPanesContainer.grid-stack   ← GridStack root
                    └── div.tab-pane (×11)          ← the tiles
```

Key CSS rules:

```css
.dash-shell { display:flex; flex-direction:row; height:100vh; overflow:hidden; }
.app-main   { overflow-y:auto; }            /* vertical scroll lives here */
#pageContainer { padding: 0 0 24px; }
.grid-stack-item.tab-pane { transform: none !important; }  /* neutralizes
   GridStack's translateY(-4px) drag lift so tiles sit flush */
```

**CRITICAL gotcha:** GridStack's CSS only sizes **direct children** of the grid
container (`.grid-stack > .grid-stack-item[gs-w="6"] { width: ... }`). Every
pane element MUST be a direct child of `#tabPanesContainer` — panes declared
elsewhere get x/y (inline) but never w/h (CSS), so they overflow into other
rows. If legacy markup declares a pane outside, move it in at init:

```js
['paneX'].forEach(id => {
  const p = document.getElementById(id);
  if (p && p.parentElement !== gridEl) gridEl.appendChild(p);
});
```

## 4. Pane system (GridStack uniform tiles + reflow)

Config:

```js
gs = GridStack.init({
  column: 12,
  cellHeight: 48,
  margin: 0,
  draggable: { handle: '.pane-drag-header' }   // drag by header only
}, document.getElementById('tabPanesContainer'));
```

Uniform tile layout — every pane the SAME size, 2 per row, packed from the top:

```js
var GRID_TILES_PER_ROW = 2;
var GRID_TILE_W = 6; // 12 cols / 2

function gridTileHeight() {
  var cellH = gs.getCellHeight();
  var headerH = (document.querySelector('.header') || {}).offsetHeight || 120;
  return Math.max(1, Math.floor((window.innerHeight - headerH) / cellH));
}

// Reflow: re-pack all VISIBLE panes in fixed array order. Call after every
// show / hide / maximize-restore so gaps are always filled.
var gridManagedPaneIds = ['paneA', 'paneB', /* ... */];  // order = row order
function gridRetileAll() {
  if (!gs) return;
  var h = gridTileHeight(), i = 0;
  gridManagedPaneIds.forEach(function (id) {
    var pane = document.getElementById(id);
    if (!pane || !pane.gridstackNode || pane.style.display === 'none') return;
    gs.update(pane, {
      x: (i % GRID_TILES_PER_ROW) * GRID_TILE_W,
      y: Math.floor(i / GRID_TILES_PER_ROW) * h,
      w: GRID_TILE_W, h: h
    });
    i++;
  });
}
```

Show / hide:

```js
function gridShowPane(paneId) {
  var pane = document.getElementById(paneId);
  if (!pane || !gs) return;
  pane.style.display = 'block';
  pane.style.position = 'absolute';   // GridStack requires absolute
  // Clear legacy inline sizing that would beat GridStack's CSS:
  ['width','minWidth','maxWidth','height','left','top','flexShrink','margin']
    .forEach(k => pane.style[k] = '');
  if (!pane.gridstackNode)
    gs.makeWidget(pane, { w: GRID_TILE_W, h: gridTileHeight(),
                          minW: 3, minH: 4, autoPosition: true });
  gridRetileAll();                    // reflow after show
}

function gridHidePane(paneId) {
  var pane = document.getElementById(paneId);
  if (pane && pane.gridstackNode) gs.removeWidget(pane, false, true);
  if (pane) pane.style.display = 'none';
  gridRetileAll();                    // reflow after hide
}
```

Maximize (zoom-aware — **do not use CSS calc(100vh - Npx)**; UI zoom breaks it):

```js
// MAXIMIZE: hide siblings (save their nodes), then:
gs.update(pane, { x: 0, y: 0, w: 12, h: totalRows });
pane.classList.add('pane-maximized');
var hdr = document.querySelector('.header');
var hdrH = hdr ? Math.round(hdr.getBoundingClientRect().height) : 0;
pane.style.setProperty('height', (window.innerHeight - hdrH) + 'px', 'important');
// RESTORE: gs.update back to tile size, remove class,
// pane.style.removeProperty('height'), re-add siblings, gridRetileAll();
```

CSS for maximized (NO height in CSS — JS owns it):

```css
.grid-stack-item.tab-pane.pane-maximized {
  left: 0 !important; top: 0 !important; width: 100% !important;
}
```

Recompute maximized height on window resize AND on a `ResizeObserver` over
`.header` (zoom changes don't fire window resize).

### Pane markup template

```html
<div id="paneX" class="tab-pane" style="display:none; position:relative;">
  <div class="pane-drag-header">🏷 Title
    <span class="pane-actions">
      <button class="pane-win-btn" title="Minimize" onclick="minimizePaneToTab('paneX')">…</button>
      <button class="pane-win-btn" title="Maximize" onclick="togglePaneMaximize('paneX')">…</button>
      <button class="pane-win-btn pane-close-btn" title="Close" onclick="closeTabPane('paneX')">…</button>
    </span>
  </div>
  <div style="height:calc(100% - 32px); padding-top:32px; display:flex;
              flex-direction:column; overflow:hidden;">
    <!-- pane content; use flex:1 for the main area -->
  </div>
</div>
```

(32px = drag-header height. The `padding-top:32px` + `calc(100% - 32px)`
pattern keeps content from sliding under the header.)

### Sidebar buttons

```html
<button class="app-sidebar-btn" data-tab="x" onclick="switchLeftTab('x')" title="X">
  <img src="icon/..." /> <span>X</span>
</button>
```

`switchLeftTab(tab)` toggles the pane (open → `gridShowPane`, open-again →
`gridHidePane`) and toggles the button's `.active` class. Buttons that need
custom logic (e.g. start/stop a service) use a real `id` + their own
`onclick` function instead of `data-tab`.

### Heavy-content panes (iframes / WebGL): lazy-load

```html
<iframe id="xIframe" src="" style="width:100%;height:100%;border:none;"></iframe>
<div id="xPlaceholder" style="position:absolute;inset:0;display:flex;...">
  <button onclick="launchX()">▶ Launch</button>
</div>
```

- Launch: `iframe.src = '/path/index.html?v=' + Date.now()` (cache-buster),
  hide placeholder.
- Close: `iframe.src = ''` + show placeholder → **frees the WebGL context**
  (matters on low-VRAM machines).

## 5. Header bar

Green (`var(--primary)`), black text, two rows:
- Row 1: brand icon + `<h1>` title; right side: mode buttons (e.g. Replay/Live
  as a segmented control), Reset button, zoom controls (− / % / + / Reset).
- Row 2 (optional): toolbar (sliders, selects, status badges).

## 6. UI zoom (scale the whole dashboard)

- Apply CSS `zoom` on `.dash-shell` (scales everything including non-rem text).
- Persist in `localStorage` (key e.g. `uiScale`); default e.g. `0.85`.
- **Gotcha:** any `calc(100vh - Npx)` math breaks under zoom ≠ 1. Measure
  elements with `getBoundingClientRect()` / `offsetHeight` at use-time instead
  of hardcoding. (This is why maximize height is JS-computed, §4.)

## 7. Live data pattern

- `setInterval` polling of REST endpoints (e.g. every 5 s), with a
  start/stop toggle button in the header/sidebar.
- Status badges: small monospace pills (`border:1px solid; padding:0.15rem
  0.4rem; border-radius:4px`) showing ● Connected / ● Stopped, message counts,
  etc.
- Tables: dense (`font-size:0.85rem`), `th { background: var(--card-bg);
  color: var(--text-muted); }`, row borders `1px solid var(--border)`.
- Log panels: `flex:1 1 auto; min-height:60px; font-family:monospace;
  font-size:0.78rem; overflow-y:auto; white-space:pre-wrap;` — append lines,
  auto-scroll to bottom.

## 8. Checklist for building a NEW dashboard from this skill

1. Copy the `:root` tokens + base reset (§2).
2. Build the DOM skeleton (§3) — `dash-shell` / `app-sidebar` / `dash-right` /
   `header` / `app-main` / `pageContainer` / `tabPanesContainer.grid-stack`.
3. Include GridStack v10 CSS+JS from CDN; `GridStack.init` with the §4 config.
4. Add panes with the §4 markup template; register each in
   `gridManagedPaneIds` (order = row order) and give it a sidebar button.
5. Implement `gridShowPane` / `gridHidePane` / `gridRetileAll` /
   `togglePaneMaximize` verbatim from §4 (they are complete, tested code).
6. Wire `switchLeftTab` per sidebar button; custom-toggle buttons get their own
   function that calls `gridShowPane`/`gridHidePane`.
7. Heavy content (3D/video) → lazy iframe pattern (§4 last block).
8. Header zoom controls → `zoom` on `.dash-shell` + localStorage (§6).
9. Live data → polling + badges + dense tables (§7).
10. Test: open/close panes in random orders — layout must always re-pack 2 per
    row from the top with no gaps; maximize must fill the viewport exactly
    (no band below) at zoom 85%, 100%, 115%.

## 9. Source files (for reference / copy)

| What | Where |
|---|---|
| Layout shell + sidebar + header | `Views/Shared/_Layout.cshtml` |
| All pane markup + grid JS | `Views/Home/Index.cshtml` (search `gridManagedPaneIds`, `gridRetileAll`, `gridShowPane`) |
| Design tokens + component CSS | `wwwroot/site.css` (top `:root` block) |
| Pane/zoom/zoom-scale JS | `wwwroot/site.js` (search `applyUiScale`, `UI_SCALE_DEFAULT`) |
| 3D viewer (separate Vite app) | `TestThreejs/` → built to `wwwroot/three-view/` |

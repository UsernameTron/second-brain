# Agent Canvas Workspace — Frontend Specification

> **Historical design baseline, not a current inventory.** The implemented UI
> has advanced through P5. Current source and tests define behavior; use
> [ROADMAP.md](ROADMAP.md) for status and this file only for original shell
> constraints that source has not superseded.

Single-page app in `frontend/` (Vite + React, plain JSX, no TypeScript, no router library, no state library — plain hooks + one context). Build output must land in `frontend/dist` (served statically by the Express server in `server/index.js`).

**Source of truth for the API and WebSocket protocol: read `server/routes.js`, `server/ws.js`, `server/index.js`, `server/seed.js`.** Every *application* endpoint the SPA calls is under `/api`, same origin, cookie-authenticated (`credentials: 'same-origin'` is the default for same-origin fetch — do NOT set custom auth headers). WebSocket at `/ws` on the same origin, authenticated by the same cookie.

Three same-origin paths sit deliberately outside `/api` and are **not**
cookie-authenticated — an earlier revision of this line claimed "all endpoints
are under `/api`", which is not true of the served application:

- `GET /healthz` — unauthenticated liveness probe (`server/index.js`),
  registered before the `/api` router and excluded from the SPA catch-all.
- `/ws` — the WebSocket upgrade, cookie-authenticated but not an `/api` route.
- Everything else — static assets from `frontend/dist`, with a catch-all that
  serves `index.html` for client-side routing.

## Views

1. **Sign-in screen** — `GET /api/config` returns `{ googleClientId, devAuth, domain }`.
   - If `googleClientId`: render Google Identity Services button (load `https://accounts.google.com/gsi/client`, `google.accounts.id.initialize({ client_id, callback })`, render button; POST the credential to `/api/auth/google`).
   - If `devAuth`: also render a labeled "Development sign-in" input (email) → POST `/api/auth/dev` — with a visible amber "DEV MODE" badge.
   - On 403, show the server's error message (e.g. not on allowlist).
2. **Workspace shell** — after sign-in (`GET /api/me`): top bar (product name, canvas switcher from `GET /api/canvases`, global **Pause** button, daily budget meter, user avatar/menu with Sign out, and for owners: Admin (allowlist editor), Export (link to `/api/export`), Audit log viewer, Resume button when paused, budget setter `POST /api/control/budget`).
3. **Canvas view** — the heart of the app (below).
4. **Admin modal (owner)** — allowlist table (`GET/POST/DELETE /api/allowlist`), audit log table (`GET /api/audit?action=&limit=`) showing ts/actor/action/detail + the chain verification badge (`chain.ok`).

## Canvas view requirements (each is part of "done")

Load full state via `GET /api/canvases/:id` → `{ canvas, agents, notes, tasks, files, rows, escalations, handoffs, runs, changesets, budget, queue }`. Join the WS channel: send `{type:'join', canvasId}` after opening `/ws`.

- **Pannable/zoomable canvas** (drag background to pan, wheel to zoom, 0.15–2.5×) rendered as an absolutely-positioned div layer + one full-size SVG layer for edges. Nodes are draggable; on drop, `POST /api/canvases/:id/positions {kind, id, x, y}`. Broadcast `node_move` events move other users' nodes live.
- **Agent nodes** — luminous cards color-coded by the agent's `color`: glowing ring + animated pulse while `status==='running'`, dim when idle. Show name, role chip, model tier (fast/strong), live per-agent spend (from `GET /api/canvases/:id/spend`, refresh on `budget`/`run_status` events). Clicking an agent opens a side panel: instruction box ("Send to <name>"), recent runs with per-run steps/cost/status, and run detail (fetch `GET /api/canvases/:id/runs/:runId/events`).
- **Task, note, and file nodes** — smaller cards. Notes: editable in a panel (title, content textarea, **Pin as live context** toggle — pinned notes get a bright "LIVE CONTEXT" treatment and feed agent runs). Note saves send `{content, base_version, base_content}` via `PUT`; handle `merged: true` responses by refreshing. Files: name+size, download link `GET /api/canvases/:id/files/:fileId`.
- **Workbook panel** — the demo `rows` as a table (collapsible right panel or modal): row_index, company, fields, status badge (pending/clean/flagged/corrected/verified/escalated color-coded), notes. A prominent **"Run cleanup"** button → `POST /api/canvases/:id/demo/run`. Changesets shown with each change (field, old→new, reason, verdict) — this is the reviewable change set view.
- **Epistemic shape encoding (memory panel)** — a "Memory" side panel listing entries from `GET /api/canvases/:id/memory`. Each entry rendered with BOTH color and **shape**: `verified` = solid border + filled dot; `inference` = dashed border + half-filled dot; `assumption` = dotted/hollow border + hollow dot. Legend at top. Superseded toggle (`?include_superseded=1`) shows struck-through history. `tainted: true` entries get an amber "⚠ built on corrected info" flag. Each entry shows provenance line (author name, source, time, run link) + epistemic label; a **"Trace lineage"** action opens the lineage view.
- **Lineage view** — panel for `GET /api/memory/:entryId/lineage`: the entry, upstream list (what fed it, with depth), downstream list (what it fed), producing run + the entries that run read. Same epistemic shape encoding; tainted flags visible.
- **Handoff edges** — animated lines (SVG, dashed, flowing via stroke-dashoffset animation) between agent nodes for each handoff (from `handoffs` + live `handoff` events; fade out edges older than ~10 min but keep them hoverable from the activity dock). **Hovering an edge shows a tooltip with the exact memory entries passed** (fetch entry contents from the memory list already loaded; payload ids are in `payload_entry_ids`) plus item_key and message.
- **Needs-you tray** — **pinned at the top of the viewport, always visible**, never inside canvas layout. Badge with open count (from `escalations` + `escalation` events; poll `GET /api/escalations` on reconnect). Each item: agent, kind (question/livelock/budget/timeout/conflict/steps/refusal), question text, context. Actions: **Accept** (textarea for the decision → `POST /api/escalations/:id/resolve {action:'accept', answer}`), **Redirect** (pick another agent → `{action:'redirect', target_agent_id, answer}`), Dismiss. Resolving removes it with a satisfying animation.
- **Correction ripple** — on `memory_ripple` WS event: the corrected entry flashes, and every entry id in `affected` pulses **red → amber** for ~2s in the memory panel (CSS animation); agent nodes of affected entries' authors glow amber briefly. Superseded entry visibly gains a "superseded" strike state.
- **Activity dock** — collapsible bottom dock: filterable timeline (filter by agent, by type: text/tool_call/tool_result/handoff/escalation/memory/run status) fed by `GET /api/canvases/:id/activity` + live `run_event` / `memory_write` / `handoff` / `escalation` events. Newest first, each row: time, agent color dot, type icon, compact payload preview.
- **Minimap** — fixed bottom-right, ~200×140: scaled-down rectangle showing node positions as dots (agents colored by role color, status dot green/amber), viewport rectangle, click-to-jump. **Role-based zoom collapse:** when main zoom < 0.5, canvas agent nodes render as small role-colored cluster chips (grouped by role, live status dots, count) instead of full cards — the canvas must stay usable past ten agents.
- **Voice + text command bar** — bottom center, prominent. Text input + mic button (Web Speech API: `window.SpeechRecognition || window.webkitSpeechRecognition`; if unavailable, mic disabled with tooltip). On submit (either modality): `POST /api/canvases/:id/intent {text}` → show the **parsed intent echo** as a chip ("→ Scout (research): re-check rows 3–5") with **Confirm** and **Cancel** buttons. NOTHING is dispatched until Confirm; Confirm → `POST /api/canvases/:id/agents/:agentId/dispatch {instruction}`. `action:'pause'` intent → pause endpoint; `unknown` → show echo as error.
- **Context receipt (wave 1)** — inside the agent panel's run detail: `GET /api/canvases/:id/runs/:runId/receipt` → `{ run, provided, searches, cited, deliveredCount, feedback }`. Three buckets, honestly labeled: **provided** (attached before start — handoff payload or escalation lineage; computed as run_reads minus retrieval records), **searches** (each `memory_search` the run made: query + ranked results with scores from `memory_retrievals`), **cited** (entries the run wrote, with their cites). Retrieved ≠ used — only cites prove use. Feedback: 👍/👎 + optional note → `POST .../runs/:runId/feedback {verdict:'up'|'down', note}`; one verdict per run (re-rating replaces); rendered on the receipt once given.
- **Presence** — other users' cursors (colored arrow + name label) from `cursor` WS events (throttle your own to ~15/s, send `{type:'cursor', x, y}` in canvas coordinates); selection outlines from `selection` events; presence avatars in top bar from `presence` events.
- **Pause state** — when `pause_state` event `paused:true` (or budget shows paused): a full-width red-amber banner "WORKSPACE PAUSED by <who>" + all agent nodes dim/frozen; Resume visible for owner only.
- **Budget meter** — top bar: today's spend vs daily budget (from `budget` events / `GET /api/control/status`), red when >90%. Per-canvas + per-agent spend in the spend panel.

## WS events reference (all have `type`, most have `canvasId`)

`presence {users}`, `cursor {email,name,color,x,y}`, `selection {email,color,ids}`, `node_move {kind,id,x,y}`, `run_status {runId,agentId,status,summary?,error?}`, `run_event {runId,agentId,eventType,payload}`, `agent_status {agentId,status}`, `memory_write {entry}`, `memory_ripple {entry, supersededId, affected[]}`, `handoff {handoff:{id,fromAgentId,toAgentId,itemKey,message,entryIds,ts}}`, `escalation {escalation}`, `escalation_resolved {escalationId,status}`, `rows_changed {}`, `changeset {changesetId,status}`, `note_update {note,merged}`, `canvas_structure {}` (refetch canvas state), `pause_state {paused,by}` (canvasId null → applies globally), `budget {usage}` (canvasId null).

Reconnect WS with backoff; on reconnect re-`join` and refetch canvas state + escalations.

## Design direction (this must look DESIGNED, not templated)

- CTG light theme (rebranded 2026-08-11 to the Cloud Tech Gurus design system): cool light ground (#f2f5fa), white raised cards with hairline borders and navy-tinted shadows, brand navy #104080 / blue #2080D0 / blue-bright #30A0F0 accents, semantic success #169E6A / warning #D98A14 / danger #C4362A, Montserrat badging + Inter body, pill buttons. Role colors come from agent data (seeded: research blue, coding navy, review green). Subtle navy dot-grid canvas background that moves with pan. Epistemic state stays double-encoded — border *style* (solid/dashed/dotted) carries it independent of color. The mascot CUE renders from `/mascot.png` on the sign-in card and the clear tray when present (see frontend/public/README.md).
- Typography with a point of view. **Superseded by the 2026-08-11 CTG rebrand, and the two bullets contradicted each other until 2026-08-16:** this line specified "Space Grotesk" display + "IBM Plex Mono" and "NEVER Inter", while the bullet above it specified Inter body — the rebrand had changed the answer without this line being updated. The shipped stack is authoritative in `frontend/index.html` and `frontend/src/styles.css`: **Montserrat** (700/800, the `--font-wide` display and badging face), **Inter** (400–700 body), **JetBrains Mono** (ids and data, `--font-mono`). What survives from the original intent is the *posture*, not the faces: no Arial/Roboto system-default look, tight confident spacing, generous radii (10–14px), hairline 1px borders.
- Micro-motion: agent pulse while running, edge flow animation, tray items slide in, ripple keyframes red (#ff4d6d) → amber (#ffd166) → fade. Respect `prefers-reduced-motion`.
- Epistemic encoding must survive B/W: solid vs dashed vs dotted borders, filled vs half vs hollow dots (shape, not just color).
- All text readable: minimum 12px, body 13–14px; contrast ≥ 4.5:1.

## Constraints

- Plain `fetch` with a tiny helper that surfaces `{error}` JSON as thrown messages; every mutation errors to a toast.
- No external UI/component/canvas/graph libraries. React + react-dom + vite + @vitejs/plugin-react only.
- `npm run build` in `frontend/` must succeed; that is your acceptance gate. Also add `"dev": "vite"` for local work.
- Keep the whole app in ~8–14 source files under `frontend/src/`. CSS in one `styles.css` (plain CSS, CSS variables for the palette).
- index.html: `<title>Agent Canvas — Cloud Tech Gurus</title>`, `<meta name="color-scheme" content="light">`, theme-color #104080, favicon inline SVG data URI (node glyph on brand navy).

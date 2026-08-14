'use strict';
// Agent Canvas Workspace server: HTTP API + WebSocket hub + static frontend.
// One Cloud Run service serves everything.

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');

const { seedIfEmpty, DEMO_KICKOFF, seedExecCanvas, recolorLegacyAgents, OWNER_EMAIL } = require('./seed');
const { rateLimit } = require('./ratelimit');
const routes = require('./routes');
const { attachWebSocket } = require('./ws');
const { recoverOrphans, dispatchRun } = require('./orchestrator/queue');
const control = require('./orchestrator/control');
const auth = require('./auth');
const { db, getSetting } = require('./db');

const PORT = Number(process.env.PORT || 8080);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // one proxy hop (Cloud Run LB); req.ip = real client IP
// Downloads carry caller-supplied MIME types; never let a browser second-guess
// them into something executable.
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

// The file-upload route takes raw bytes. Keep the JSON body parser away from
// it entirely: otherwise a caller choosing Content-Type: application/json gets
// their body parsed into an object, express.raw() skips, and the route's
// "body is a Buffer" assumption is caller-controlled. Excluding the path here
// means req.body on that route is always a Buffer, whatever header is sent.
const jsonParser = express.json({ limit: '2mb' });
const RAW_UPLOAD_PATH = /^\/api\/canvases\/[^/]+\/files\/?$/;
app.use((req, res, next) => {
  if (req.method === 'POST' && RAW_UPLOAD_PATH.test(req.path)) return next();
  return jsonParser(req, res, next);
});

app.get('/healthz', (req, res) => res.json({ ok: true, paused: control.isPaused() }));

app.use('/api', routes);

// Demo kickoff: dispatches the seeded enrichment workflow on the demo canvas.
app.post('/api/canvases/:canvasId/demo/run', rateLimit('model', 10, 60_000), auth.requireAuth, (req, res) => {
  const check = auth.canAccessCanvas(req.user, req.params.canvasId);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const research = db.prepare("SELECT * FROM agents WHERE canvas_id = ? AND role = 'research' LIMIT 1").get(req.params.canvasId);
  if (!research) return res.status(400).json({ error: 'no research agent on this canvas' });
  try {
    const run = dispatchRun({
      agentId: research.id, canvasId: req.params.canvasId,
      instruction: DEMO_KICKOFF, triggerKind: 'user', actor: req.user.email,
      stepBudget: Number(process.env.DEMO_STEP_BUDGET || 16),
      wallMs: Number(process.env.DEMO_WALL_MS || 420_000),
    });
    res.json({ run });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Static frontend (built by Vite into frontend/dist).
const distDir = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|ws|healthz).*/, rateLimit('static', 120, 60_000), (req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  app.get('/', (req, res) => res.status(200).send('Agent Canvas API running (frontend not built — run npm run build in frontend/)'));
}

const seedResult = seedIfEmpty();
const execSeed = seedExecCanvas(OWNER_EMAIL);
recolorLegacyAgents();
const roster = require('./roster');
roster.seedRoster();
// Heal first (refreshes pristine pre-roster prompts to the current template),
// then link (stamps provenance on anything matching a template byte-for-byte).
roster.healExecAgents();
roster.linkExecAgents();
roster.supersedeStaleIcpMemory(OWNER_EMAIL);
require('./mcp/seed').seedMcpServers();
require('./mcp/client').reload(); // pick up seeded connectors on first boot
const orphans = recoverOrphans();

const server = http.createServer(app);
attachWebSocket(server);

if (require.main === module) {
  server.listen(PORT, () => {
    process.stdout.write(`agent-canvas listening on :${PORT} (seeded=${seedResult.seeded}, exec=${execSeed.seeded}, orphaned runs recovered=${orphans}, demo canvas=${getSetting('demo_canvas_id')})\n`);
  });
}

module.exports = { app, server };

'use strict';
// Agent Canvas Workspace server: HTTP API + WebSocket hub + static frontend.
// One Cloud Run service serves everything.

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');

const { seedIfEmpty, recolorLegacyAgents, retireLegacyArtifacts, OWNER_EMAIL } = require('./seed');
const { rateLimit } = require('./ratelimit');
const routes = require('./routes');
const { attachWebSocket } = require('./ws');
const { recoverOrphans } = require('./orchestrator/queue');
const control = require('./orchestrator/control');

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

// Two paths, one handler. `/healthz` never reaches this process in production:
// Cloud Run's Google Frontend reserves the path and answers its own 404 before
// the request touches the container — proven live 2026-08-16, where /api/config
// returned 200 anonymously while /healthz returned Google's error page on both
// hostnames, authenticated or not. `/api/healthz` rides the /api prefix the GFE
// forwards untouched; it is registered BEFORE the /api router so it stays
// unauthenticated, which is the point of a liveness probe. /healthz is kept for
// local runs and anything already pointed at it.
const health = (req, res) => res.json({ ok: true, paused: control.isPaused() });
app.get('/healthz', health);
app.get('/api/healthz', health);

app.use('/api', routes);

// Static frontend (built by Vite into frontend/dist).
const distDir = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|ws|healthz).*/, rateLimit('static'), (req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  app.get('/', (req, res) => res.status(200).send('Agent Canvas API running (frontend not built — run npm run build in frontend/)'));
}

const seedResult = seedIfEmpty();
const cleanupResult = retireLegacyArtifacts(OWNER_EMAIL);
recolorLegacyAgents();
const roster = require('./roster');
roster.seedRoster();
roster.seedEnrichmentAgent();
roster.seedSdrAgent();
roster.seedContentAgent();
roster.backfillRosterTemplateKeys();
roster.reseedSdrTools();
roster.reseedGaugeTools();
// Re-seed propagates a changed roster prompt to already-seeded workspaces
// (seedRoster is one-shot); heal refreshes pristine pre-roster exec prompts;
// link stamps provenance on anything matching a template byte-for-byte.
roster.reseedRosterPrompts();
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
    process.stdout.write(`agent-canvas listening on :${PORT} (seeded=${seedResult.seeded}, retired canvases=${cleanupResult.retiredCanvases}, retired notes=${cleanupResult.removedNotes}, retired files=${cleanupResult.removedFiles}, orphaned runs recovered=${orphans})\n`);
  });
}

module.exports = { app, server };

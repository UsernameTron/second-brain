'use strict';
// HTTP API. Roles and per-canvas access are enforced here, server-side —
// the client is never trusted for authorization decisions.

const crypto = require('node:crypto');
const express = require('express');
const { db, nowIso } = require('./db');
const { audit, queryAudit, verifyChain } = require('./audit');
const memory = require('./memory');
const bus = require('./bus');
const auth = require('./auth');
const control = require('./orchestrator/control');
const { dispatchRun, resumePump, queueState } = require('./orchestrator/queue');
const { createEscalation } = require('./orchestrator/tools');
const { callModel, FAST_MODEL, STRONG_MODEL } = require('./orchestrator/anthropic');

const router = express.Router();

function asyncRoute(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
    res.status(err.status || 500).json({ error: err.message || 'internal error' });
  });
}

// ---------- config + auth ----------
router.get('/config', (req, res) => {
  res.json({
    googleClientId: auth.GOOGLE_CLIENT_ID || null,
    devAuth: auth.DEV_AUTH,
    domain: auth.ALLOWED_DOMAIN,
    models: { fast: FAST_MODEL, strong: STRONG_MODEL },
  });
});

router.post('/auth/google', asyncRoute(async (req, res) => {
  const user = await auth.signInWithGoogle(req.body.credential);
  auth.issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/dev', asyncRoute(async (req, res) => {
  const user = auth.signInDev(req.body.email);
  auth.issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, picture: u.picture, role: u.role };
}

// Everything below requires a signed-in allowlisted user.
router.use(auth.requireAuth);

// ---------- allowlist (owner only) ----------
router.get('/allowlist', auth.requireOwner, (req, res) => {
  res.json({ allowlist: db.prepare('SELECT * FROM allowlist ORDER BY added_at').all() });
});

router.post('/allowlist', auth.requireOwner, (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const role = req.body.role === 'owner' ? 'owner' : 'member';
  if (!email.endsWith(`@${auth.ALLOWED_DOMAIN}`)) {
    return res.status(400).json({ error: `only ${auth.ALLOWED_DOMAIN} addresses can be allowlisted` });
  }
  db.prepare('INSERT INTO allowlist (email, role, display_name, added_by, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, display_name = COALESCE(excluded.display_name, display_name)')
    .run(email, role, req.body.display_name || null, req.user.email, nowIso());
  audit('user', req.user.email, 'allowlist.add', { email, role });
  res.json({ ok: true });
});

router.delete('/allowlist/:email', auth.requireOwner, (req, res) => {
  const email = String(req.params.email).toLowerCase();
  if (email === req.user.email.toLowerCase()) return res.status(400).json({ error: 'cannot remove yourself' });
  db.prepare('DELETE FROM allowlist WHERE email = ?').run(email);
  audit('user', req.user.email, 'allowlist.remove', { email });
  res.json({ ok: true });
});

// ---------- canvases ----------
router.get('/canvases', (req, res) => {
  const all = db.prepare('SELECT * FROM canvases ORDER BY created_at').all();
  const visible = all.filter((c) => auth.canAccessCanvas(req.user, c.id).ok);
  res.json({ canvases: visible });
});

router.post('/canvases', (req, res) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO canvases (id, name, description, access_mode, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.body.name || 'Untitled canvas', req.body.description || '', 'workspace', req.user.email, nowIso());
  audit('user', req.user.email, 'canvas.create', { canvasId: id });
  res.json({ canvas: db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) });
});

router.get('/canvases/:canvasId', auth.requireCanvas, (req, res) => {
  const canvasId = req.params.canvasId;
  const agents = db.prepare('SELECT * FROM agents WHERE canvas_id = ?').all(canvasId);
  const notes = db.prepare('SELECT * FROM notes WHERE canvas_id = ?').all(canvasId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE canvas_id = ?').all(canvasId);
  const files = db.prepare('SELECT id, canvas_id, name, mime, size, x, y, uploaded_by, created_at FROM files WHERE canvas_id = ?').all(canvasId);
  const rows = db.prepare('SELECT id, row_index, data, status, notes FROM sheet_rows WHERE canvas_id = ? ORDER BY row_index').all(canvasId)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  const escalations = db.prepare("SELECT * FROM escalations WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 50").all(canvasId)
    .map((e) => ({ ...e, context: JSON.parse(e.context) }));
  const handoffs = db.prepare('SELECT * FROM handoffs WHERE canvas_id = ? ORDER BY ts DESC LIMIT 100').all(canvasId)
    .map((h) => ({ ...h, payload_entry_ids: JSON.parse(h.payload_entry_ids) }));
  const runs = db.prepare('SELECT id, agent_id, status, trigger_kind, instruction, steps_used, step_budget, model, input_tokens, output_tokens, cost_usd, summary, error, started_at, ended_at, created_at FROM runs WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 100').all(canvasId);
  const changesets = db.prepare('SELECT * FROM changesets WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 20').all(canvasId)
    .map((cs) => ({
      ...cs,
      changes: db.prepare('SELECT c.*, r.row_index FROM changes c JOIN sheet_rows r ON r.id = c.row_id WHERE c.changeset_id = ?').all(cs.id)
        .map((c) => ({ ...c, cite_entry_ids: JSON.parse(c.cite_entry_ids) })),
    }));
  res.json({
    canvas: req.canvas, agents, notes, tasks, files, rows, escalations, handoffs, runs, changesets,
    budget: control.getDailyUsage(), queue: queueState(),
  });
});

// ---------- agents ----------
router.post('/canvases/:canvasId/agents', auth.requireCanvas, (req, res) => {
  const id = crypto.randomUUID();
  const { name, role = 'research', color = '#7c6cff', model_tier = 'strong', system_prompt = '', x = 0, y = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare('INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, name, role, color, model_tier === 'fast' ? 'fast' : 'strong', system_prompt, x, y, nowIso());
  audit('user', req.user.email, 'agent.create', { agentId: id, canvasId: req.params.canvasId, role });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(id) });
});

router.patch('/canvases/:canvasId/agents/:agentId', auth.requireCanvas, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND canvas_id = ?').get(req.params.agentId, req.params.canvasId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const { x, y, system_prompt, model_tier, name, color } = req.body;
  db.prepare('UPDATE agents SET x = ?, y = ?, system_prompt = ?, model_tier = ?, name = ?, color = ? WHERE id = ?')
    .run(x ?? agent.x, y ?? agent.y, system_prompt ?? agent.system_prompt,
      ['fast', 'strong'].includes(model_tier) ? model_tier : agent.model_tier, name ?? agent.name, color ?? agent.color, agent.id);
  res.json({ ok: true });
});

// ---------- runs ----------
router.post('/canvases/:canvasId/agents/:agentId/dispatch', auth.requireCanvas, (req, res) => {
  if (control.isPaused()) return res.status(409).json({ error: 'workspace is paused — resume before dispatching' });
  const instruction = String(req.body.instruction || '').trim();
  if (!instruction) return res.status(400).json({ error: 'instruction required' });
  try {
    const run = dispatchRun({
      agentId: req.params.agentId, canvasId: req.params.canvasId, instruction,
      triggerKind: 'user', actor: req.user.email,
      stepBudget: req.body.step_budget, wallMs: req.body.wall_ms,
    });
    res.json({ run });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/canvases/:canvasId/runs/:runId/events', auth.requireCanvas, (req, res) => {
  const events = db.prepare('SELECT * FROM run_events WHERE run_id = ? AND canvas_id = ? ORDER BY id').all(req.params.runId, req.params.canvasId)
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  res.json({ events });
});

router.get('/canvases/:canvasId/activity', auth.requireCanvas, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const events = db.prepare('SELECT * FROM run_events WHERE canvas_id = ? ORDER BY id DESC LIMIT ?').all(req.params.canvasId, limit)
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  res.json({ events });
});

// ---------- memory ----------
router.get('/canvases/:canvasId/memory', auth.requireCanvas, (req, res) => {
  const entries = memory.listEntries({
    canvasId: req.params.canvasId,
    includeSuperseded: req.query.include_superseded === '1',
    epistemic: req.query.epistemic,
    since: req.query.since,
    query: req.query.q,
    limit: req.query.limit,
  });
  res.json({ entries });
});

router.post('/canvases/:canvasId/memory', auth.requireCanvas, (req, res) => {
  const { content, epistemic, source = '', cites = [] } = req.body;
  try {
    const entry = memory.writeEntry({
      canvasId: req.params.canvasId, content, epistemic,
      authorType: 'user', authorId: req.user.email, authorName: req.user.name || req.user.email,
      source, cites,
    });
    bus.emit('event', { type: 'memory_write', canvasId: req.params.canvasId, entry });
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/canvases/:canvasId/memory/:entryId/correct', auth.requireCanvas, (req, res) => {
  const { content, epistemic, reason = '', cites = [] } = req.body;
  try {
    const result = memory.correctEntry({
      entryId: req.params.entryId, content, epistemic, reason,
      authorType: 'user', authorId: req.user.email, authorName: req.user.name || req.user.email, cites,
    });
    if (result.conflict) {
      const escalation = createEscalation({
        canvasId: req.params.canvasId, runId: null, agentId: null, kind: 'conflict',
        question: `Concurrent correction conflict: "${result.original.content.slice(0, 120)}" was corrected twice in parallel. Which correction stands?`,
        context: { existing: result.current ? result.current.id : null, attempted: content },
      });
      return res.status(409).json({ conflict: true, escalationId: escalation.id, current: result.current });
    }
    bus.emit('event', { type: 'memory_ripple', canvasId: req.params.canvasId, entry: result.entry, supersededId: req.params.entryId, affected: result.affected });
    res.json({ entry: result.entry, affected: result.affected });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/memory/:entryId/lineage', (req, res) => {
  const trace = memory.lineage(req.params.entryId);
  if (!trace) return res.status(404).json({ error: 'entry not found' });
  if (trace.entry.canvasId) {
    const check = auth.canAccessCanvas(req.user, trace.entry.canvasId);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  res.json(trace);
});

// ---------- notes ----------
router.post('/canvases/:canvasId/notes', auth.requireCanvas, (req, res) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO notes (id, canvas_id, title, content, pinned, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, req.body.title || 'Note', req.body.content || '', req.body.pinned ? 1 : 0, req.body.x || 0, req.body.y || 0, req.user.email, nowIso());
  audit('user', req.user.email, 'note.create', { noteId: id, canvasId: req.params.canvasId });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ note: db.prepare('SELECT * FROM notes WHERE id = ?').get(id) });
});

// Versioned update with a three-way merge so simultaneous edits never clobber.
router.put('/canvases/:canvasId/notes/:noteId', auth.requireCanvas, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND canvas_id = ?').get(req.params.noteId, req.params.canvasId);
  if (!note) return res.status(404).json({ error: 'note not found' });
  const { content, base_version, base_content, title, pinned } = req.body;
  let finalContent = content ?? note.content;
  let merged = false;
  if (content !== undefined && base_version !== undefined && base_version < note.version) {
    finalContent = threeWayMerge(base_content ?? '', note.content, content);
    merged = true;
  }
  const newPinned = pinned === undefined ? note.pinned : (pinned ? 1 : 0);
  db.prepare('UPDATE notes SET content = ?, title = ?, pinned = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(finalContent, title ?? note.title, newPinned, req.user.email, nowIso(), note.id);
  if (newPinned !== note.pinned) audit('user', req.user.email, newPinned ? 'note.pin' : 'note.unpin', { noteId: note.id });
  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
  bus.emit('event', { type: 'note_update', canvasId: req.params.canvasId, note: updated, by: req.user.email, merged });
  res.json({ note: updated, merged });
});

// Concurrent-edit merge: apply both sides when they touch different regions;
// keep both (marked) when they collide. Never silently drops either edit.
function threeWayMerge(base, current, mine) {
  if (current === base) return mine;
  if (mine === base) return current;
  if (mine === current) return mine;
  const b = base.split('\n'); const c = current.split('\n'); const m = mine.split('\n');
  let prefix = 0;
  while (prefix < Math.min(b.length, c.length, m.length) && b[prefix] === c[prefix] && b[prefix] === m[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(b.length, c.length, m.length) - prefix &&
    b[b.length - 1 - suffix] === c[c.length - 1 - suffix] &&
    b[b.length - 1 - suffix] === m[m.length - 1 - suffix]
  ) suffix++;
  const bMid = b.slice(prefix, b.length - suffix).join('\n');
  const cMid = c.slice(prefix, c.length - suffix).join('\n');
  const mMid = m.slice(prefix, m.length - suffix).join('\n');
  let mid;
  if (cMid === bMid) mid = mMid;
  else if (mMid === bMid) mid = cMid;
  else mid = `${mMid}\n⚠ concurrent edit — both versions kept:\n${cMid}`;
  return [...c.slice(0, prefix), ...(mid ? mid.split('\n') : []), ...c.slice(c.length - suffix)].join('\n');
}

// ---------- tasks ----------
router.post('/canvases/:canvasId/tasks', auth.requireCanvas, (req, res) => {
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare('INSERT INTO tasks (id, canvas_id, title, description, status, assignee_agent_id, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, req.body.title || 'Task', req.body.description || '', 'todo', req.body.assignee_agent_id || null, req.body.x || 0, req.body.y || 0, ts, ts);
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) });
});

router.patch('/canvases/:canvasId/tasks/:taskId', auth.requireCanvas, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND canvas_id = ?').get(req.params.taskId, req.params.canvasId);
  if (!task) return res.status(404).json({ error: 'task not found' });
  db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, x = ?, y = ?, updated_at = ? WHERE id = ?')
    .run(req.body.title ?? task.title, req.body.description ?? task.description, req.body.status ?? task.status,
      req.body.x ?? task.x, req.body.y ?? task.y, nowIso(), task.id);
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ ok: true });
});

// ---------- node positions (notes/files/tasks share the same shape) ----------
router.post('/canvases/:canvasId/positions', auth.requireCanvas, (req, res) => {
  const { kind, id, x, y } = req.body;
  const tables = { agent: 'agents', note: 'notes', task: 'tasks', file: 'files' };
  const table = tables[kind];
  if (!table) return res.status(400).json({ error: 'kind must be agent|note|task|file' });
  db.prepare(`UPDATE ${table} SET x = ?, y = ? WHERE id = ? AND canvas_id = ?`).run(x, y, id, req.params.canvasId);
  bus.emit('event', { type: 'node_move', canvasId: req.params.canvasId, kind, id, x, y, by: req.user.email });
  res.json({ ok: true });
});

// ---------- files ----------
router.post('/canvases/:canvasId/files', auth.requireCanvas, express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const id = crypto.randomUUID();
  const name = String(req.query.name || 'file.bin');
  const mime = req.headers['content-type'] || 'application/octet-stream';
  db.prepare('INSERT INTO files (id, canvas_id, name, mime, size, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.canvasId, name, mime, req.body.length, req.body, req.user.email, nowIso());
  audit('user', req.user.email, 'file.upload', { fileId: id, name, size: req.body.length });
  bus.emit('event', { type: 'canvas_structure', canvasId: req.params.canvasId });
  res.json({ file: { id, name, mime, size: req.body.length } });
});

router.get('/canvases/:canvasId/files/:fileId', auth.requireCanvas, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND canvas_id = ?').get(req.params.fileId, req.params.canvasId);
  if (!file) return res.status(404).json({ error: 'file not found' });
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/"/g, '')}"`);
  res.send(file.content);
});

// ---------- escalations (the needs-you tray) ----------
router.get('/escalations', (req, res) => {
  const all = db.prepare("SELECT * FROM escalations WHERE status = 'open' ORDER BY created_at DESC LIMIT 100").all()
    .map((e) => ({ ...e, context: JSON.parse(e.context) }));
  const visible = all.filter((e) => !e.canvas_id || auth.canAccessCanvas(req.user, e.canvas_id).ok);
  res.json({ escalations: visible });
});

router.post('/escalations/:id/resolve', asyncRoute(async (req, res) => {
  const escalation = db.prepare('SELECT * FROM escalations WHERE id = ?').get(req.params.id);
  if (!escalation) return res.status(404).json({ error: 'escalation not found' });
  if (escalation.status !== 'open') return res.status(409).json({ error: 'already resolved' });
  if (escalation.canvas_id) {
    const check = auth.canAccessCanvas(req.user, escalation.canvas_id);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
  }
  const { action, answer = '', target_agent_id } = req.body; // 'accept' | 'redirect' | 'dismiss'
  if (!['accept', 'redirect', 'dismiss'].includes(action)) return res.status(400).json({ error: 'action must be accept|redirect|dismiss' });

  let agentId = escalation.agent_id;
  if (action === 'redirect') {
    if (!target_agent_id) return res.status(400).json({ error: 'target_agent_id required for redirect' });
    agentId = target_agent_id;
  }
  const status = action === 'dismiss' ? 'dismissed' : action === 'redirect' ? 'redirected' : 'accepted';
  db.prepare('UPDATE escalations SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
    .run(status, answer, req.user.email, nowIso(), escalation.id);
  audit('user', req.user.email, 'escalation.resolve', { escalationId: escalation.id, action });

  let run = null;
  if (action !== 'dismiss' && agentId && answer.trim()) {
    run = dispatchRun({
      agentId, canvasId: escalation.canvas_id,
      instruction: `A human resolved your escalation (escalation_id: ${escalation.id}).\nOriginal question: ${escalation.question}\nHuman decision (${req.user.email}): ${answer}\nApply this decision now: record it in memory as a "verified" entry (source: "human decision ${req.user.email}"), and if it fixes workbook fields, apply them with apply_row_fix using escalation_id ${escalation.id}. Then complete. Your summary must state exactly what you changed — nothing more.`,
      triggerKind: 'escalation_resume', actor: req.user.email,
    });
  }
  bus.emit('event', { type: 'escalation_resolved', canvasId: escalation.canvas_id, escalationId: escalation.id, status, by: req.user.email });
  res.json({ ok: true, run });
}));

// ---------- voice/text intent parsing (fast model; echo before dispatch) ----------
router.post('/canvases/:canvasId/intent', auth.requireCanvas, asyncRoute(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const agents = db.prepare('SELECT id, name, role FROM agents WHERE canvas_id = ?').all(req.params.canvasId);
  const response = await callModel({
    model: FAST_MODEL,
    system: `You parse spoken/typed commands for a multi-agent canvas. Available agents:\n${agents.map((a) => `- ${a.name} (${a.role}, id ${a.id})`).join('\n')}\nReturn ONLY a JSON object, no prose: {"action": "dispatch"|"pause"|"resume"|"unknown", "agent_id": "<id or null>", "agent_name": "<name or null>", "instruction": "<what the agent should do, cleaned up>", "echo": "<short confirmation of what will happen, e.g. 'Ask Scout (research) to re-check rows 3-5'>"}. If the command names no agent but implies a role, pick the matching agent. If genuinely unclear, action "unknown" with echo explaining why.`,
    messages: [{ role: 'user', content: text }],
    maxTokens: 300,
  });
  control.addUsage(response.model || FAST_MODEL, response.usage || {});
  const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    parsed = { action: 'unknown', echo: 'Could not parse that command — try rephrasing.' };
  }
  audit('user', req.user.email, 'intent.parse', { canvasId: req.params.canvasId, text: text.slice(0, 200), action: parsed.action });
  res.json({ intent: parsed });
}));

// ---------- global pause / budget ----------
router.get('/control/status', (req, res) => {
  res.json({ ...control.getDailyUsage(), queue: queueState() });
});

// Anyone signed in can hit the emergency stop; only the owner can resume.
router.post('/control/pause', (req, res) => {
  control.setPaused(true, req.user.email);
  res.json({ ok: true, paused: true });
});

router.post('/control/resume', auth.requireOwner, (req, res) => {
  control.setPaused(false, req.user.email);
  resumePump();
  res.json({ ok: true, paused: false });
});

router.post('/control/budget', auth.requireOwner, (req, res) => {
  const usd = Number(req.body.daily_budget_usd);
  if (!Number.isFinite(usd) || usd < 0) return res.status(400).json({ error: 'daily_budget_usd must be a non-negative number' });
  control.setDailyBudget(usd, req.user.email);
  res.json({ ok: true, daily_budget_usd: usd });
});

// Per-agent and per-canvas spend rollups for the UI.
router.get('/canvases/:canvasId/spend', auth.requireCanvas, (req, res) => {
  const perAgent = db.prepare(`
    SELECT a.id AS agent_id, a.name, a.role, COUNT(r.id) AS runs,
           COALESCE(SUM(r.input_tokens),0) AS input_tokens, COALESCE(SUM(r.output_tokens),0) AS output_tokens,
           COALESCE(SUM(r.cost_usd),0) AS cost_usd
    FROM agents a LEFT JOIN runs r ON r.agent_id = a.id
    WHERE a.canvas_id = ? GROUP BY a.id
  `).all(req.params.canvasId);
  const canvasTotal = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS cost_usd, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens FROM runs WHERE canvas_id = ?').get(req.params.canvasId);
  res.json({ perAgent, canvasTotal, daily: control.getDailyUsage() });
});

// ---------- audit (owner only) ----------
router.get('/audit', auth.requireOwner, (req, res) => {
  res.json({ entries: queryAudit(req.query), chain: verifyChain() });
});

// ---------- export (owner only) ----------
router.get('/export', auth.requireOwner, (req, res) => {
  audit('user', req.user.email, 'workspace.export', {});
  const dump = {
    exported_at: nowIso(),
    exported_by: req.user.email,
    canvases: db.prepare('SELECT * FROM canvases').all(),
    agents: db.prepare('SELECT * FROM agents').all(),
    notes: db.prepare('SELECT * FROM notes').all(),
    tasks: db.prepare('SELECT * FROM tasks').all(),
    files: db.prepare('SELECT id, canvas_id, name, mime, size, uploaded_by, created_at FROM files').all(),
    memory_entries: db.prepare('SELECT * FROM memory_entries').all(),
    citations: db.prepare('SELECT * FROM citations').all(),
    run_reads: db.prepare('SELECT * FROM run_reads').all(),
    runs: db.prepare('SELECT * FROM runs').all(),
    run_events: db.prepare('SELECT * FROM run_events').all().map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
    handoffs: db.prepare('SELECT * FROM handoffs').all(),
    escalations: db.prepare('SELECT * FROM escalations').all(),
    sheet_rows: db.prepare('SELECT * FROM sheet_rows').all().map((r) => ({ ...r, data: JSON.parse(r.data) })),
    changesets: db.prepare('SELECT * FROM changesets').all(),
    changes: db.prepare('SELECT * FROM changes').all(),
    audit_log: db.prepare('SELECT * FROM audit_log ORDER BY seq').all(),
    usage_daily: db.prepare('SELECT * FROM usage_daily').all(),
    allowlist: db.prepare('SELECT * FROM allowlist').all(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="agent-canvas-export-${nowIso().slice(0, 10)}.json"`);
  res.json(dump);
});

module.exports = router;

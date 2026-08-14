'use strict';
// SQLite storage for the Agent Canvas Workspace.
// Memory entries are append-only: content rows are never UPDATEd or DELETEd.
// The single permitted mutation is stamping `superseded_by` on an entry when a
// correction supersedes it — guarded by a transaction so two concurrent
// supersessions of the same entry surface as a conflict, never last-write-wins.

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'agent-canvas.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
// Agents run concurrently; make a contended write wait rather than throw.
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  picture TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS allowlist (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  display_name TEXT,
  added_by TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  access_mode TEXT NOT NULL DEFAULT 'workspace' CHECK (access_mode IN ('workspace','restricted')),
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canvas_members (
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  user_email TEXT NOT NULL COLLATE NOCASE,
  access TEXT NOT NULL DEFAULT 'edit' CHECK (access IN ('edit','view')),
  PRIMARY KEY (canvas_id, user_email)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7c6cff',
  model_tier TEXT NOT NULL DEFAULT 'strong' CHECK (model_tier IN ('fast','strong')),
  system_prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','waiting','error')),
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  content BLOB,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done','escalated')),
  assignee_agent_id TEXT,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== Shared project memory (the product) =====
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  canvas_id TEXT REFERENCES canvases(id),
  content TEXT NOT NULL,
  epistemic TEXT NOT NULL CHECK (epistemic IN ('verified','inference','assumption')),
  author_type TEXT NOT NULL CHECK (author_type IN ('agent','user','system')),
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  run_id TEXT,
  created_at TEXT NOT NULL,
  supersedes TEXT REFERENCES memory_entries(id),
  superseded_by TEXT REFERENCES memory_entries(id),
  supersede_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_canvas ON memory_entries(canvas_id, created_at);

-- entry_id cites cites_entry_id: cites_entry_id fed the creation of entry_id
CREATE TABLE IF NOT EXISTS citations (
  entry_id TEXT NOT NULL REFERENCES memory_entries(id),
  cites_entry_id TEXT NOT NULL REFERENCES memory_entries(id),
  PRIMARY KEY (entry_id, cites_entry_id)
);
CREATE INDEX IF NOT EXISTS idx_citations_cited ON citations(cites_entry_id);

-- every memory entry a run received in context (feeds the lineage trace)
CREATE TABLE IF NOT EXISTS run_reads (
  run_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES memory_entries(id),
  PRIMARY KEY (run_id, entry_id)
);

-- retrieval quality log: what a run's memory_search actually asked and got
-- back, with rank and score. Append-only; run_reads stays the delivery record
-- (its composite PK can't carry per-query rows).
CREATE TABLE IF NOT EXISTS memory_retrievals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES memory_entries(id),
  query TEXT NOT NULL DEFAULT '',
  rank INTEGER NOT NULL,
  score REAL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retrievals_run ON memory_retrievals(run_id, id);

-- human verdict on a completed run: evidence about performance, never truth
CREATE TABLE IF NOT EXISTS run_feedback (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('up','down')),
  note TEXT NOT NULL DEFAULT '',
  by TEXT NOT NULL,
  ts TEXT NOT NULL
);

-- ===== Agent runs =====
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  parent_run_id TEXT,
  trigger_kind TEXT NOT NULL DEFAULT 'user' CHECK (trigger_kind IN ('user','handoff','escalation_resume','system')),
  instruction TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','completed','failed','halted_steps','halted_timeout','halted_paused','halted_budget','refused')),
  steps_used INTEGER NOT NULL DEFAULT 0,
  step_budget INTEGER NOT NULL,
  wall_ms_budget INTEGER NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  summary TEXT,
  error TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_canvas ON runs(canvas_id, created_at);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  canvas_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_events_canvas ON run_events(canvas_id, id);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, id);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  item_key TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  payload_entry_ids TEXT NOT NULL DEFAULT '[]',
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handoffs_item ON handoffs(canvas_id, item_key);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  run_id TEXT,
  agent_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('question','steps','timeout','budget','livelock','conflict','refusal','error')),
  question TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','redirected','resolved','dismissed')),
  resolution TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_escalations_open ON escalations(canvas_id, status);

-- ===== Demo workbook: conference-lead enrichment =====
CREATE TABLE IF NOT EXISTS sheet_rows (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  row_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','clean','flagged','corrected','verified','rejected','escalated')),
  notes TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rows_canvas ON sheet_rows(canvas_id, row_index);

CREATE TABLE IF NOT EXISTS changesets (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  run_id TEXT,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','verified','partially_verified','rejected')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL REFERENCES changesets(id),
  row_id TEXT NOT NULL REFERENCES sheet_rows(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT DEFAULT '',
  cite_entry_ids TEXT NOT NULL DEFAULT '[]',
  verdict TEXT CHECK (verdict IN ('approved','rejected')),
  verdict_reason TEXT,
  ts TEXT NOT NULL
);

-- ===== Immutable, hash-chained audit log =====
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_tokens (
  user_email TEXT PRIMARY KEY,
  refresh_token_enc TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  date TEXT PRIMARY KEY,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0
);
`);

function nowIso() { return new Date().toISOString(); }

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// node:sqlite has no .transaction() helper; use explicit BEGIN/COMMIT.
// Re-entrant: a tx() inside a tx() joins the outer transaction (SQLite has no
// nested BEGIN). node:sqlite is synchronous, so a plain depth counter is safe.
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) { txDepth += 1; try { return fn(); } finally { txDepth -= 1; } }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth = 0;
  }
}

// Additive migrations for databases created before a column existed.
try { db.exec('ALTER TABLE runs ADD COLUMN initiated_by TEXT'); } catch { /* already present */ }
try { db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'light'"); } catch { /* already present */ }
try { db.exec('ALTER TABLE canvases ADD COLUMN archived INTEGER NOT NULL DEFAULT 0'); } catch { /* already present */ }
try { db.exec('ALTER TABLE agents ADD COLUMN roster_id TEXT'); } catch { /* already present */ }

// ===== Agent roster: workspace-level template library (owner-managed) =====
// Canvas agents instantiated from a roster entry carry roster_id for
// provenance and resync; the entry itself never runs.
db.exec(`
CREATE TABLE IF NOT EXISTS roster_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  color TEXT NOT NULL,
  model_tier TEXT NOT NULL CHECK (model_tier IN ('fast','strong')),
  system_prompt TEXT NOT NULL DEFAULT '',
  companion_note_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  default_on INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// ===== MCP connectors: owner-managed external tool servers =====
// The managed source for the MCP client (server/mcp/client.js). Header values
// may be literal or ${ENV:NAME} references resolved at request time — GET
// responses mask them either way. access gates WHO may trigger the tools
// (owner vs any member); roles_json gates WHICH agent roles are offered them
// ([] = all). Per-tool explicit enablement lives in enabled_tools_json.
db.exec(`
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  headers_json TEXT NOT NULL DEFAULT '{}',
  enabled_tools_json TEXT NOT NULL DEFAULT '[]',
  access TEXT NOT NULL DEFAULT 'members' CHECK (access IN ('owner','members')),
  roles_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

module.exports = { db, tx, nowIso, getSetting, setSetting, DB_PATH };

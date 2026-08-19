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
  authority_json TEXT,                  -- authority snapshot this run was dispatched under
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

-- ===== Retired sample-workbook ledger (preserved for historical exports) =====
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
// User-facing removal is recoverable: retired canvases and notes disappear
// from active APIs but stay in the operational ledger and exports.
try { db.exec('ALTER TABLE canvases ADD COLUMN removed_at TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE canvases ADD COLUMN removed_by TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE notes ADD COLUMN deleted_at TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE notes ADD COLUMN deleted_by TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE files ADD COLUMN deleted_at TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE files ADD COLUMN deleted_by TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE agents ADD COLUMN roster_id TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE roster_agents ADD COLUMN template_key TEXT'); } catch { /* already present */ }
// Wave 3: typed/scoped/temporal memory. Enum validation lives in memory.js
// (SQLite can't retro-add CHECK constraints); canvas_id stays the security
// boundary — applies_to_* is retrieval applicability only, never access control.
try { db.exec('ALTER TABLE memory_entries ADD COLUMN kind TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE memory_entries ADD COLUMN subject TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE memory_entries ADD COLUMN applies_to_type TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE memory_entries ADD COLUMN applies_to_id TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE memory_entries ADD COLUMN effective_at TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE memory_entries ADD COLUMN review_at TEXT'); } catch { /* already present */ }

// ===== Agent roster: workspace-level template library (owner-managed) =====
// Canvas agents instantiated from a roster entry carry roster_id for
// provenance and resync; the entry itself never runs.
db.exec(`
CREATE TABLE IF NOT EXISTS roster_agents (
  id TEXT PRIMARY KEY,
  template_key TEXT,
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
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_agents_template_key ON roster_agents(template_key) WHERE template_key IS NOT NULL');

// ===== P1 evidence spine: entry → external artifact provenance =====
// citations stays entry→entry; evidence_refs records the external artifacts a
// run actually touched (web page, Drive file, CRM record, MCP result), and
// evidence_citations links a memory entry to the refs that support it. This
// replaces the free-text-URL-in-source convention with an auditable edge.
db.exec(`
CREATE TABLE IF NOT EXISTS evidence_refs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  display_title TEXT NOT NULL DEFAULT '',
  uri TEXT NOT NULL DEFAULT '',
  directed_by TEXT NOT NULL DEFAULT '',
  retrieved_at TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'canvas',
  meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence_refs(run_id);
CREATE TABLE IF NOT EXISTS evidence_citations (
  entry_id TEXT NOT NULL REFERENCES memory_entries(id),
  evidence_ref_id TEXT NOT NULL REFERENCES evidence_refs(id),
  PRIMARY KEY (entry_id, evidence_ref_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_citations_ref ON evidence_citations(evidence_ref_id);
`);

// ===== P1 inquiries: the Inquiry Home question log =====
// One row per ask; a re-ask is a new row (append-only, like memory). run_id
// is stamped in the same tx as the dispatch. status stores the last derived
// value ('queued' until the run terminates); the live truth is the run row.
db.exec(`
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  question TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  selected_agent_id TEXT,
  selection_auto INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  mode TEXT NOT NULL DEFAULT 'ask',
  status TEXT NOT NULL DEFAULT 'queued',
  saved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiries_canvas ON inquiries(canvas_id, created_at);
`);
// Run modes (P1): act = today's behavior; ask = no world mutation; rehearse =
// ask + hs_preview_change + narrate-only prompt. Enum validated in JS
// (SQLite can't retro-add CHECK constraints).
try { db.exec("ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'act'"); } catch { /* already present */ }
// P5: the authority a run was DISPATCHED under, when the dispatcher held a
// snapshot (a standing authorization). The run's effective surface is this
// snapshot intersected with the agent's live authority — a later widening of
// the agent must never widen a rule the owner already approved, and a later
// narrowing must still bite. NULL = no snapshot, live authority governs alone.
try { db.exec('ALTER TABLE runs ADD COLUMN authority_json TEXT'); } catch { /* already present */ }

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

// ===== P2 people: presentation-only human cards on the canvas =====
// Identity stays in users/allowlist/canvas_members — a person row may only be
// created for an email already allowlisted (validated in routes.js), and holds
// nothing but display/position. Never a second identity store.
db.exec(`
CREATE TABLE IF NOT EXISTS canvas_people (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  email TEXT NOT NULL COLLATE NOCASE,
  display TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (canvas_id, email)
);
`);
// P2 human assignment: tasks/escalations assignable to a person OR an agent.
// Enum/email validation lives in routes.js (SQLite can't retro-add CHECKs).
try { db.exec('ALTER TABLE tasks ADD COLUMN assignee_email TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE escalations ADD COLUMN owner_email TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE escalations ADD COLUMN owner_agent_id TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE escalations ADD COLUMN due_at TEXT'); } catch { /* already present */ }
// P2 attention projection: overdue-review scans hit review_at directly.
db.exec('CREATE INDEX IF NOT EXISTS idx_memory_review ON memory_entries(review_at)');

// ===== P3 Evidence Rooms: metadata over an existing canvas =====
// A Room is a 1:1 metadata record on a canvas — never a second graph. Its
// sections (people/evidence/work/decisions/risks/open questions) are read-time
// projections over existing tables (server/rooms.js). Lifecycle is DERIVED
// from canvases.archived (no second flag to desync). room_refreshes is the
// lossless refresh history: time + actor + the ask-mode run it dispatched.
db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL UNIQUE REFERENCES canvases(id),
  room_type TEXT NOT NULL CHECK (room_type IN ('deal','client','initiative','decision')),
  external_ref TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  refreshed_at TEXT,
  refreshed_by TEXT
);
CREATE TABLE IF NOT EXISTS room_refreshes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  run_id TEXT,
  actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_refreshes_room ON room_refreshes(room_id, created_at);
`);

// ===== P4 agent builder: explicit authority, drafts, versions =====
// tools_json is the agent's Authority Map: a JSON array of EXTERNAL tool
// names this agent may be offered. NULL = legacy behavior (full role-derived
// surface) so every pre-P4 agent is untouched; builder-published agents
// always carry an explicit list. lifecycle 'draft' rows are the shadow agents
// rehearsals run on — invisible everywhere except the builder. step/wall
// budgets become per-agent dispatch defaults (enum/shape validated in JS).
try { db.exec("ALTER TABLE agents ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'"); } catch { /* already present */ }
try { db.exec('ALTER TABLE agents ADD COLUMN retired_at TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE agents ADD COLUMN retired_by TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE agents ADD COLUMN tools_json TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE agents ADD COLUMN step_budget INTEGER'); } catch { /* already present */ }
try { db.exec('ALTER TABLE agents ADD COLUMN wall_ms_budget INTEGER'); } catch { /* already present */ }
// Templates saved from the builder keep the full config, not just the prompt.
try { db.exec('ALTER TABLE roster_agents ADD COLUMN tools_json TEXT'); } catch { /* already present */ }
try { db.exec('ALTER TABLE roster_agents ADD COLUMN step_budget INTEGER'); } catch { /* already present */ }
try { db.exec('ALTER TABLE roster_agents ADD COLUMN wall_ms_budget INTEGER'); } catch { /* already present */ }
db.exec(`
CREATE TABLE IF NOT EXISTS agent_drafts (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  brief TEXT NOT NULL,
  proposal_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','rehearsed','published','abandoned')),
  shadow_agent_id TEXT,
  rehearsal_run_id TEXT,
  published_agent_id TEXT,
  target_agent_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_drafts_canvas ON agent_drafts(canvas_id, created_at);
CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  tools_json TEXT,
  step_budget INTEGER,
  wall_ms_budget INTEGER,
  source TEXT NOT NULL CHECK (source IN ('baseline','publish','patch','rollback','resync')),
  draft_id TEXT,
  restored_from TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON agent_versions(agent_id, created_at);
`);

// ===== P5 standing rules: stored instruction + persisted authorization =====
// A standing rule is plain language + a validated interpretation; a rule run
// IS a normal ask-mode run dispatched by the tick instead of a human click
// (server/standing-rules.js). No cron: cadence enum + slot, occurrence_key
// derived from the due time, UNIQUE(rule_id, occurrence_key) makes duplicate
// scheduler delivery a no-op. Authorization is a snapshot verified server-side
// at every dispatch — never trusted from the rule row.
db.exec(`
CREATE TABLE IF NOT EXISTS standing_rules (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  agent_id TEXT NOT NULL,               -- deliberately no FK (room_refreshes precedent)
  owner_email TEXT NOT NULL,            -- creator; activation grantor lives on the authorization
  instruction TEXT NOT NULL,            -- original plain language
  interpretation_json TEXT NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'watch',          -- task category (watch|report|digest)
  source_scope_json TEXT NOT NULL DEFAULT '{}',    -- what's watched + sources + scope
  output_type TEXT NOT NULL CHECK (output_type IN ('alert','brief')),
  cadence TEXT NOT NULL CHECK (cadence IN ('hourly','daily','weekly')),
  cadence_hour INTEGER NOT NULL DEFAULT 8,
  cadence_day INTEGER,                              -- 0-6, weekly only
  step_budget INTEGER, wall_ms_budget INTEGER,      -- per-run budget (dispatch clamps)
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','rehearsed','active','paused','revoked','expired')),
  version INTEGER NOT NULL DEFAULT 1,               -- bumped on every interpretation edit
  rehearsal_run_id TEXT,
  expires_at TEXT,                                  -- default now+90d at activation
  last_run_at TEXT, next_run_at TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_standing_rules_due ON standing_rules(state, next_run_at);

CREATE TABLE IF NOT EXISTS standing_rule_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES standing_rules(id),
  rule_version INTEGER NOT NULL,
  authorization_id TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  run_id TEXT,                                      -- the dispatched run; no FK (precedent)
  retry_run_ids_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','completed','failed','skipped')),
  skip_reason TEXT,
  lease_until TEXT, attempt INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER,                            -- parsed from run summary; NULL = unknown
  needs_attention INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TEXT, acknowledged_by TEXT,
  result_summary TEXT,                              -- alert text / brief markdown (from runs.summary)
  output_refs_json TEXT NOT NULL DEFAULT '[]',      -- evidence/memory refs from the run
  cost_usd REAL, error TEXT,
  created_at TEXT NOT NULL, ended_at TEXT,
  UNIQUE (rule_id, occurrence_key)
);
CREATE INDEX IF NOT EXISTS idx_rule_runs_attention ON standing_rule_runs(state, needs_attention, acknowledged_at);

-- NEEDS YOU dismissals: the attention projection has no backing table, so a
-- "not now" on a projected card (memory conflict, overdue review, failed run)
-- persists here as an opaque per-canvas key. The source record stays
-- authoritative — a NEW conflict pair, review date, or run gets a new key and
-- surfaces again. Escalations and rule runs keep their source-record acks.
CREATE TABLE IF NOT EXISTS attention_dismissals (
  canvas_id TEXT NOT NULL REFERENCES canvases(id),
  key TEXT NOT NULL,
  dismissed_by TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (canvas_id, key)
);

CREATE TABLE IF NOT EXISTS standing_authorizations (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES standing_rules(id),
  canvas_id TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  workspace_role_at_grant TEXT NOT NULL,
  allowed_tools_json TEXT,                          -- read-only tool subset snapshot
  mode TEXT NOT NULL DEFAULT 'ask' CHECK (mode IN ('ask','rehearse')),
  granted_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  revoked_at TEXT, revoked_by TEXT
);
`);

module.exports = { db, tx, nowIso, getSetting, setSetting, DB_PATH };

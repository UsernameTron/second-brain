'use strict';
// P2 attention projection: ONE read-time union over the authoritative records
// that can demand a human — open escalations, unresolved memory conflicts,
// overdue reviews, failed runs, and proposed changesets. No table backs this
// module; every card resolves through its SOURCE record's own endpoint, so
// nothing here can drift from the truth it projects. Per-canvas by design:
// the route walks the caller's accessible canvases, so access is decided
// before a single row is read, never filtered after.

const { db } = require('./db');
const memory = require('./memory');

// Every card speaks the same contract: what to decide, why it matters, who
// owns it, and where the authoritative record lives.
function card({ type, decision, context = '', consequence = '', recommendation = '', owner = {}, due = null, actions = [], sourceRef, createdAt }) {
  return {
    type,
    decision,
    context,
    consequence,
    recommendation,
    owner: { email: owner.email || null, agentId: owner.agentId || null },
    due,
    actions,
    sourceRef,
    created_at: createdAt,
  };
}

function escalationCards(canvasId) {
  const rows = db.prepare("SELECT * FROM escalations WHERE status = 'open' AND canvas_id = ? ORDER BY created_at DESC LIMIT 100").all(canvasId);
  return rows.map((e) => card({
    type: 'escalation',
    decision: e.question,
    context: `${e.kind} escalation${e.agent_id ? ` from agent ${e.agent_id}` : ''}`,
    consequence: 'The escalating run stays parked until a human answers.',
    recommendation: e.kind === 'conflict' ? 'Decide which version is true; the resolution supersedes the loser.' : 'Answer it — the agent resumes with your decision.',
    owner: { email: e.owner_email, agentId: e.owner_agent_id },
    due: e.due_at,
    actions: ['resolve', 'assign'],
    sourceRef: { kind: 'escalation', id: e.id, canvasId: e.canvas_id },
    createdAt: e.created_at,
  }));
}

function conflictCards(canvasId) {
  return memory.findConflicts(canvasId).map((c) => card({
    type: 'conflict',
    decision: `Two verified memory entries disagree about "${c.subject}".`,
    context: c.entries.map((e) => `"${String(e.content).slice(0, 120)}"`).join(' vs '),
    consequence: 'Agents citing this subject may build on the wrong version.',
    recommendation: 'Correct the entry that is wrong; supersession keeps the loser on record.',
    actions: ['correct'],
    sourceRef: { kind: 'memory_conflict', id: c.entries[0].id, secondId: c.entries[1].id, canvasId },
    createdAt: c.entries[1].createdAt,
  }));
}

function overdueReviewCards(canvasId, nowIsoStr) {
  const rows = db.prepare(`
    SELECT id, canvas_id, content, epistemic, kind, review_at, created_at FROM memory_entries
    WHERE canvas_id = ? AND review_at IS NOT NULL AND review_at <= ? AND superseded_by IS NULL
    ORDER BY review_at ASC LIMIT 100
  `).all(canvasId, nowIsoStr);
  return rows.map((m) => card({
    type: 'overdue_review',
    decision: `Review this ${m.epistemic}${m.kind ? ` ${m.kind}` : ''}: "${String(m.content).slice(0, 140)}"`,
    context: `Review was due ${String(m.review_at).slice(0, 10)}.`,
    consequence: 'Stale entries keep informing answers as if current.',
    recommendation: 'Re-affirm with a new review date, or correct it.',
    due: m.review_at,
    actions: ['review'],
    sourceRef: { kind: 'memory_entry', id: m.id, canvasId: m.canvas_id },
    createdAt: m.created_at,
  }));
}

function failedRunCards(canvasId) {
  // Any escalation referencing the run wins the card: haltAndEscalate already
  // raised most of these, and a RESOLVED escalation means a human handled it —
  // either way a second card would be a duplicate demand on the same problem.
  const rows = db.prepare(`
    SELECT r.id, r.canvas_id, r.agent_id, r.status, r.instruction, r.error, r.created_at
    FROM runs r
    WHERE r.canvas_id = ?
      AND (r.status IN ('failed','refused') OR (r.status LIKE 'halted_%' AND r.status != 'halted_paused'))
      AND NOT EXISTS (SELECT 1 FROM escalations e WHERE e.run_id = r.id)
    ORDER BY r.created_at DESC LIMIT 50
  `).all(canvasId);
  return rows.map((r) => card({
    type: 'failed_run',
    decision: `Run ${r.status}: "${String(r.instruction || '').slice(0, 120)}"`,
    context: r.error ? String(r.error).slice(0, 200) : `status ${r.status}`,
    consequence: 'The work it was asked to do did not happen.',
    recommendation: 'Retry it, or rephrase the instruction if the failure looks structural.',
    owner: { agentId: r.agent_id },
    actions: ['retry'],
    sourceRef: { kind: 'run', id: r.id, canvasId: r.canvas_id },
    createdAt: r.created_at,
  }));
}

function changesetCards(canvasId) {
  const rows = db.prepare("SELECT * FROM changesets WHERE status = 'proposed' AND canvas_id = ? ORDER BY created_at DESC LIMIT 50").all(canvasId);
  return rows.map((cs) => card({
    type: 'pending_changeset',
    decision: 'Proposed workbook changes are waiting for verification.',
    context: `Changeset ${String(cs.id).slice(0, 8)}${cs.agent_id ? ` proposed by agent ${cs.agent_id}` : ''}.`,
    consequence: 'Unverified changes never reach the workbook rows.',
    recommendation: 'Open the workbook and verify or reject the changes.',
    owner: { agentId: cs.agent_id },
    actions: ['open_workbook'],
    sourceRef: { kind: 'changeset', id: cs.id, canvasId: cs.canvas_id },
    createdAt: cs.created_at,
  }));
}

function canvasAttention(canvasId, nowIsoStr) {
  return [
    ...escalationCards(canvasId),
    ...conflictCards(canvasId),
    ...overdueReviewCards(canvasId, nowIsoStr),
    ...failedRunCards(canvasId),
    ...changesetCards(canvasId),
  ];
}

// scope: 'mine' = owned by this email; 'team' = owned by someone/something
// else, or unowned; 'all' = both.
function listAttention({ email, scope = 'all', canvasIds, now = new Date().toISOString() }) {
  let rows = canvasIds.flatMap((id) => canvasAttention(id, now));
  const me = String(email || '').toLowerCase();
  if (scope === 'mine') rows = rows.filter((r) => r.owner.email && r.owner.email.toLowerCase() === me);
  else if (scope === 'team') rows = rows.filter((r) => !r.owner.email || r.owner.email.toLowerCase() !== me);
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

module.exports = { listAttention };

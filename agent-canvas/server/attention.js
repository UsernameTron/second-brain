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

function escalationCards(canvasId, { scope, email } = {}) {
  // Ownership is filtered in SQL, BEFORE the limit — otherwise 100 newer
  // escalations owned by others could push a mine-scoped row off the page
  // (claude-review on #182).
  let ownerClause = '';
  const params = [canvasId];
  if (scope === 'mine') { ownerClause = 'AND LOWER(owner_email) = LOWER(?)'; params.push(email); }
  else if (scope === 'team') { ownerClause = 'AND (owner_email IS NULL OR LOWER(owner_email) != LOWER(?))'; params.push(email); }
  const rows = db.prepare(`SELECT * FROM escalations e WHERE e.status = 'open' AND e.canvas_id = ? ${ownerClause}
    AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.id = e.agent_id AND a.lifecycle = 'draft')
    ORDER BY e.created_at DESC LIMIT 100`).all(...params);
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
  })).map((c, i) => ({
    ...c,
    // The escalating agent's attached context (entry_ids, detail, item_key) is
    // decision-critical; the view renders it since the inline tray is hidden
    // behind the flag (codex P1 on #183).
    contextData: (() => { try { return JSON.parse(rows[i].context || '{}'); } catch { return {}; } })(),
    escalatingAgentId: rows[i].agent_id,
  }));
}

function conflictCards(canvasId) {
  // One card per subject, capped: N live versions of a subject would emit
  // N(N-1)/2 pairs, and the workspace view multiplies that by every canvas
  // (claude-review on #182). The memory endpoint still returns all pairs.
  const bySubject = new Map();
  for (const c of memory.findConflicts(canvasId)) {
    const key = String(c.subject).toLowerCase();
    if (!bySubject.has(key)) bySubject.set(key, c);
  }
  // Rank deterministically (newest conflicting entry first) BEFORE the cap —
  // findConflicts has no ORDER BY, so slicing raw map order could hide new
  // conflicts behind 20 stale ones indefinitely (codex on #183).
  const newest = (c) => [c.entries[0].createdAt, c.entries[1].createdAt].sort().pop();
  return [...bySubject.values()]
    .sort((a, b) => String(newest(b)).localeCompare(String(newest(a))))
    .slice(0, 20)
    .map((c) => card({
    type: 'conflict',
    decision: `Two verified memory entries disagree about "${c.subject}".`,
    context: c.entries.map((e) => `"${String(e.content).slice(0, 120)}"`).join(' vs '),
    consequence: 'Agents citing this subject may build on the wrong version.',
    recommendation: 'Correct the entry that is wrong; supersession keeps the loser on record.',
    actions: ['correct'],
    sourceRef: { kind: 'memory_conflict', id: c.entries[0].id, secondId: c.entries[1].id, canvasId },
    // The pair is id-ordered, not time-ordered: the newer entry is what
    // CREATED the conflict, so the card sorts by it.
    createdAt: [c.entries[0].createdAt, c.entries[1].createdAt].sort().pop(),
  }));
}

function overdueReviewCards(canvasId, nowIsoStr) {
  const rows = db.prepare(`
    SELECT id, canvas_id, content, epistemic, kind, review_at, created_at FROM memory_entries
    WHERE canvas_id = ? AND review_at IS NOT NULL AND datetime(review_at) <= datetime(?) AND superseded_by IS NULL
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
  // Dedupe against escalations that carry the same demand: any OPEN one, or a
  // resolved one that was itself the terminal halt (haltAndEscalate kinds).
  // A resolved mid-run QUESTION must not suppress a later unrelated failure —
  // the escalate tool lets a run continue after asking (claude-review on #182).
  // A run with a CHILD (retry or escalation resume) is handled — otherwise the
  // Retry card would reappear forever after every retry (codex on #183).
  const rows = db.prepare(`
    SELECT r.id, r.canvas_id, r.agent_id, r.status, r.instruction, r.error, r.created_at
    FROM runs r
    WHERE r.canvas_id = ?
      AND (r.status IN ('failed','refused') OR (r.status LIKE 'halted_%' AND r.status != 'halted_paused'))
      -- P4: a draft agent's rehearsal failure belongs to the builder flow,
      -- not the NEEDS YOU tray (its Retry card would 400 on a draft anyway)
      AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.id = r.agent_id AND a.lifecycle = 'draft')
      AND NOT EXISTS (
        SELECT 1 FROM escalations e WHERE e.run_id = r.id
          AND (e.status = 'open' OR e.kind != 'question')
      )
      AND NOT EXISTS (SELECT 1 FROM runs child WHERE child.parent_run_id = r.id)
      -- P5: EVERY run owned by a standing-rule occurrence belongs to the
      -- standing-rule lifecycle, not to this projection. It dispatches its own
      -- retries and raises its own rule_alert card; a generic Retry here would
      -- run the work twice and write memory twice — and the state != 'skipped'
      -- window (terminal run, finalizer not yet ticked) is exactly when a user
      -- sees the card and clicks it. Superseded earlier attempts carry
      -- parent_run_id, so the child clause above already covers them.
      AND NOT EXISTS (
        SELECT 1 FROM standing_rule_runs srr WHERE srr.run_id = r.id
      )
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

// P5 (D4): unacknowledged standing-rule outcomes that demand a human — alert
// matches (matched_count > 0), failures after retries, workspace-disconnected
// skips, and finished briefs (which always surface once, as brief_ready).
// Draft rules never emit cards: a rule edited back to draft takes its pending
// cards with it. Resolution is source-record style: POST .../acknowledge.
function standingRuleCards(canvasId) {
  const rows = db.prepare(`
    SELECT rr.id, rr.rule_id, rr.rule_version, rr.state, rr.skip_reason, rr.matched_count, rr.result_summary, rr.error, rr.created_at,
           r.canvas_id, r.instruction, r.output_type, r.agent_id, r.version
    FROM standing_rule_runs rr JOIN standing_rules r ON r.id = rr.rule_id
    WHERE r.canvas_id = ? AND rr.needs_attention = 1 AND rr.acknowledged_at IS NULL AND r.state != 'draft'
    ORDER BY rr.created_at DESC LIMIT 50
  `).all(canvasId);
  return rows.map((rr) => {
    // The row joins the LIVE rule, but the body came from the occurrence. An
    // unacknowledged card from an earlier version resurfaces the moment the
    // edited rule leaves draft, labelled with the NEW instruction over the OLD
    // result — and a re-parse can reassign agent_id, so it would name an agent
    // that never produced it. rule_version was recorded for exactly this and
    // read by nothing: quote neither the instruction nor the agent when they
    // no longer belong to this result.
    const stale = Number(rr.rule_version) !== Number(rr.version);
    // A completed occurrence carrying an error is one whose every governed
    // read failed (completeFromRun) — it is not a brief anyone should read and
    // not a match count anyone should believe.
    const readsFailed = rr.state === 'completed' && !!rr.error;
    const brief = rr.output_type === 'brief' && rr.state === 'completed' && !readsFailed;
    const quoted = `"${String(rr.instruction).slice(0, 120)}"`;
    const matchedLine = rr.matched_count == null
      // The unparseable-MATCHED path stores NULL deliberately: the count is
      // unknown, not zero. Interpolating it printed a raw JS null to the owner.
      ? 'Standing rule finished with an unreadable match count'
      : `Standing rule matched ${rr.matched_count} item(s)`;
    const decision = readsFailed
      ? `Standing rule could not read its sources: ${stale ? 'an earlier version of this rule' : quoted}`
      : brief
        ? `A new brief is ready: ${stale ? 'from an earlier version of this rule' : quoted}`
        : rr.state === 'completed'
          ? `${matchedLine}: ${stale ? 'an earlier version of this rule' : quoted}`
          : `Standing rule run ${rr.state}: ${stale ? 'an earlier version of this rule' : quoted}`;
    return card({
      type: brief ? 'brief_ready' : 'rule_alert',
      decision: stale ? `${decision} (result from v${rr.rule_version}; the rule has since been edited to v${rr.version})` : decision,
      context: readsFailed
        ? String(rr.error).slice(0, 300)
        : rr.state === 'completed'
          ? String(rr.result_summary || '').slice(0, 300)
          : String(rr.skip_reason || rr.error || rr.state).slice(0, 300),
      consequence: brief ? 'The brief goes unread until someone opens it.' : 'Whatever this rule watches may need action.',
      recommendation: brief ? 'Read the brief, then acknowledge.' : 'Review the result, act on it, then acknowledge.',
      // The current agent_id did not necessarily produce a stale result.
      owner: stale ? {} : { agentId: rr.agent_id },
      actions: ['acknowledge', 'open_rule'],
      sourceRef: { kind: 'standing_rule_run', id: rr.id, ruleId: rr.rule_id, canvasId: rr.canvas_id },
      createdAt: rr.created_at,
    });
  });
}

function canvasAttention(canvasId, nowIsoStr, scopeOpts) {
  return [
    ...escalationCards(canvasId, scopeOpts),
    ...conflictCards(canvasId),
    ...overdueReviewCards(canvasId, nowIsoStr),
    ...failedRunCards(canvasId),
    ...changesetCards(canvasId),
    ...standingRuleCards(canvasId),
  ];
}

// scope: 'mine' = owned by this email; 'team' = owned by someone/something
// else, or unowned; 'all' = both. Escalations scope in SQL (they are the only
// source with a human owner today); the post-filter keeps the contract honest
// for any source that grows one later.
function listAttention({ email, scope = 'all', canvasIds, now = new Date().toISOString() }) {
  let rows = canvasIds.flatMap((id) => canvasAttention(id, now, { scope, email }));
  const me = String(email || '').toLowerCase();
  if (scope === 'mine') rows = rows.filter((r) => r.owner.email && r.owner.email.toLowerCase() === me);
  else if (scope === 'team') rows = rows.filter((r) => !r.owner.email || r.owner.email.toLowerCase() !== me);
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

module.exports = { listAttention };

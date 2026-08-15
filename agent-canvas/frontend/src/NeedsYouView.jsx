import React, { useMemo, useState } from 'react';
import { timeAgo, short } from './api.js';

// P2 unified NEEDS YOU: a full-stage view over the attention projection.
// Workspace owns the fetch (one source of truth for the badge and this view);
// every card resolves through its SOURCE record's endpoint — this view holds
// no state of its own beyond UI mode.

const TYPE_LABELS = {
  escalation: 'escalation',
  conflict: 'memory conflict',
  overdue_review: 'overdue review',
  failed_run: 'failed run',
  pending_changeset: 'pending changes',
};

function AttentionCard({ row, agentsById, people, agents, onResolveEscalation, onAssign, onOpenMemory, onOpenRun, onOpenWorkbook, onRetryRun, onExtendReview }) {
  const [answer, setAnswer] = useState('');
  const [mode, setMode] = useState(null); // escalation: null | 'accept'
  const ownerAgent = row.owner.agentId ? agentsById[row.owner.agentId] : null;
  const ownerLabel = row.owner.email || (ownerAgent ? ownerAgent.name : null);

  return (
    <div className={`ny-card ny-${row.type}`}>
      <div className="ny-card-head">
        <span className={`chip ny-type-chip nyt-${row.type}`}>{TYPE_LABELS[row.type] || row.type}</span>
        {ownerLabel ? <span className="chip owner-chip">→ {ownerLabel}</span> : <span className="chip dim">unowned</span>}
        {row.due ? <span className="mono dim" title="due">due {String(row.due).slice(0, 10)}</span> : null}
        <span className="mono dim">{timeAgo(row.created_at)}</span>
      </div>
      <div className="ny-decision">{row.decision}</div>
      {row.context ? <div className="ny-context">{short(row.context, 220)}</div> : null}
      <div className="ny-meta">
        <span className="ny-consequence">{row.consequence}</span>
        {row.recommendation ? <span className="ny-recommendation">{row.recommendation}</span> : null}
      </div>
      <div className="ny-actions">
        {row.type === 'escalation' ? (
          mode === 'accept' ? (
            <form
              className="tray-form"
              onSubmit={(e) => { e.preventDefault(); onResolveEscalation(row.sourceRef.id, { action: 'accept', answer }); }}
            >
              <textarea rows="2" autoFocus placeholder="Your decision — the agent resumes with this…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <div className="tray-actions">
                <button className="btn ok small" type="submit" disabled={!answer.trim()}>Send decision</button>
                <button className="btn ghost small" type="button" onClick={() => setMode(null)}>Back</button>
              </div>
            </form>
          ) : (
            <>
              <button className="btn ok small" onClick={() => setMode('accept')}>Resolve</button>
              <button className="btn ghost small dim-btn" onClick={() => onResolveEscalation(row.sourceRef.id, { action: 'dismiss' })}>Dismiss</button>
              {onAssign ? (
                <select
                  className="tray-assign"
                  value=""
                  title="Assign — routing only, resolution still happens here"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    if (v.startsWith('p:')) onAssign(row.sourceRef.id, { owner_email: v.slice(2) });
                    else if (v.startsWith('a:')) onAssign(row.sourceRef.id, { owner_agent_id: v.slice(2) });
                    else if (v === 'clear') onAssign(row.sourceRef.id, { owner_email: null, owner_agent_id: null });
                  }}
                >
                  <option value="">assign…</option>
                  {people.map((p) => <option key={p.id} value={`p:${p.email}`}>{p.display || p.email}</option>)}
                  {agents.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name} (agent)</option>)}
                  {ownerLabel ? <option value="clear">clear assignment</option> : null}
                </select>
              ) : null}
            </>
          )
        ) : null}
        {row.type === 'conflict' ? (
          <button className="btn small" onClick={() => onOpenMemory(row.sourceRef)}>Open in Memory</button>
        ) : null}
        {row.type === 'overdue_review' ? (
          <>
            <button className="btn ok small" title="Re-affirm as still true — an append-only correction with a fresh review date" onClick={() => onExtendReview(row.sourceRef)}>Still true — extend review</button>
            <button className="btn ghost small" onClick={() => onOpenMemory(row.sourceRef)}>Open in Memory</button>
          </>
        ) : null}
        {row.type === 'failed_run' ? (
          <>
            <button className="btn ok small" onClick={() => onRetryRun(row.sourceRef)}>Retry</button>
            <button className="btn ghost small" onClick={() => onOpenRun(row.sourceRef)}>Open run</button>
          </>
        ) : null}
        {row.type === 'pending_changeset' ? (
          <button className="btn small" onClick={() => onOpenWorkbook(row.sourceRef)}>Open workbook</button>
        ) : null}
      </div>
    </div>
  );
}

export default function NeedsYouView({ rows, userEmail, agentsById, people, agents, onResolveEscalation, onAssign, onOpenMemory, onOpenRun, onOpenWorkbook, onRetryRun, onExtendReview }) {
  const [scope, setScope] = useState('all');
  const me = String(userEmail || '').toLowerCase();

  // Scope is a client-side filter over the one fetched projection: mine =
  // owned by me; team = owned by someone else, or unowned.
  const visible = useMemo(() => {
    if (!rows) return null;
    if (scope === 'mine') return rows.filter((r) => r.owner.email && r.owner.email.toLowerCase() === me);
    if (scope === 'team') return rows.filter((r) => !r.owner.email || r.owner.email.toLowerCase() !== me);
    return rows;
  }, [rows, scope, me]);

  return (
    <div className="needs-you" role="region" aria-label="Needs you — everything waiting on a human">
      <div className="ny-head">
        <h2>Needs you</h2>
        <div className="ny-filters" role="tablist" aria-label="Attention scope">
          {['mine', 'team', 'all'].map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} className={`btn small ${scope === s ? 'active' : 'ghost'}`} onClick={() => setScope(s)}>
              {s === 'mine' ? 'Mine' : s === 'team' ? 'Team' : 'All'}
            </button>
          ))}
        </div>
      </div>
      {visible === null ? <div className="ny-empty dim">Loading…</div> : null}
      {visible && visible.length === 0 ? (
        <div className="ny-empty">
          <span className="tray-clear-mark">✓</span> Nothing needs {scope === 'mine' ? 'you' : scope === 'team' ? 'the team' : 'anyone'} right now.
        </div>
      ) : null}
      <div className="ny-list">
        {(visible || []).map((row) => (
          <AttentionCard
            key={`${row.type}:${row.sourceRef.id}`}
            row={row}
            agentsById={agentsById}
            people={people}
            agents={agents}
            onResolveEscalation={onResolveEscalation}
            onAssign={onAssign}
            onOpenMemory={onOpenMemory}
            onOpenRun={onOpenRun}
            onOpenWorkbook={onOpenWorkbook}
            onRetryRun={onRetryRun}
            onExtendReview={onExtendReview}
          />
        ))}
      </div>
    </div>
  );
}

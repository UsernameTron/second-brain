import { choiceKeys } from './format.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RequestError } from './RequestState.jsx';
import { useDraft } from './Drafts.jsx';
import { timeAgo, short } from './api.js';
import { formatContractTail, plainPreview, humanizeDetail } from './format.jsx';

// P2 unified NEEDS YOU: a full-stage view over the attention projection.
// Workspace owns the fetch (one source of truth for the badge and this view);
// every card resolves through its SOURCE record's endpoint — this view holds
// no state of its own beyond UI mode.

const TYPE_LABELS = {
  escalation: 'Answer needed',
  conflict: 'Conflicting information',
  overdue_review: 'Review due',
  failed_run: 'Work stopped',
  rule_alert: 'Scheduled alert',
  brief_ready: 'Brief ready',
};

export function AttentionCard({ row, agentsById = {}, people = [], agents = [], loadContext, onRefresh, editable = true, onResolveEscalation, onAssign, onOpenMemory, onOpenRun, onRetryRun, onExtendReview, onAcknowledgeRuleRun, onDismiss, onOpenRule }) {
  const [answer, setAnswer] = useDraft(`attention:${row.sourceRef.canvasId}:${row.type}:${row.sourceRef.id}`, '');
  const [mode, setMode] = useState(null); // escalation: null | 'accept' | 'redirect'
  const [target, setTarget] = useState('');
  const [showCtx, setShowCtx] = useState(true);
  const [otherActions, setOtherActions] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState(null);
  const [contextTick, setContextTick] = useState(0);
  useEffect(() => {
    if (!otherActions || !loadContext) return;
    let current = true;
    setContextError(null);
    loadContext(row.sourceRef.canvasId).then((data) => { if (current) setContext(data); })
      .catch((e) => { if (current) setContextError(e); });
    return () => { current = false; };
  }, [otherActions, loadContext, row.sourceRef.canvasId, contextTick]);
  const action = async (fn, finishes = true) => {
    if (inFlight.current || done || error?.unconfirmed || !editable) return;
    inFlight.current = true; setPending(true); setError(null);
    try { await fn(); if (finishes) { setDone(true); setMode(null); setAnswer(''); } }
    catch (e) { setError(e); if (e.status === 403 || e.status === 409) await onRefresh?.(); }
    finally { inFlight.current = false; setPending(false); }
  };
  const disabled = pending || done || error?.unconfirmed || !editable;
  const availableAgents = context?.agents || (loadContext ? [] : agents);
  const availablePeople = context?.people || (loadContext ? [] : people);
  const ownerAgent = row.owner.agentId ? agentsById[row.owner.agentId] : null;
  const ownerLabel = row.owner.email || (ownerAgent ? ownerAgent.name : null);
  // The escalating agent's attached context — decision-critical, and the
  // inline tray that used to show it is hidden behind the needs_you flag.
  const hasCtx = row.contextData && Object.keys(row.contextData).length > 0;

  return (
    <div className={`ny-card ny-${row.type}`}>
      <div className="ny-card-head">
        {row.canvasName ? <span className="chip">{row.canvasName}</span> : null}
        <span className={`chip ny-type-chip nyt-${row.type}`}>{TYPE_LABELS[row.type] || row.type}</span>
        {ownerLabel ? <span className="chip owner-chip">→ {ownerLabel}</span> : <span className="chip dim">Unassigned</span>}
        {row.due ? <span className="mono dim" title="due">due {String(row.due).slice(0, 10)}</span> : null}
        <span className="mono dim">{timeAgo(row.created_at)}</span>
      </div>
      <div className="ny-decision">{row.decision}</div>
      {/* Strip ONLY where the count is already on the card: a rule_alert's
          decision reads "Standing rule matched N item(s)" (server/attention.js).
          A brief_ready decision carries no count, so stripping there would
          delete the only statement of what matched — humanize instead. */}
      {row.context ? (
        <div className="ny-context">
          {short(plainPreview(formatContractTail(row.context,
            row.type === 'rule_alert' ? 'strip' : 'humanize')), 220)}
        </div>
      ) : null}
      {hasCtx ? (
        <button className="link-btn" onClick={() => setShowCtx((v) => !v)}>
          {showCtx ? 'Hide full details' : 'Full details'}
        </button>
      ) : null}
      {showCtx && hasCtx ? (
        <pre className="tray-context mono">
          {(() => { try { return humanizeDetail(row.contextData); } catch { return String(row.contextData); } })()}
        </pre>
      ) : null}
      <div className="ny-meta">
        <span className="ny-consequence">{row.consequence}</span>
        {row.recommendation ? <span className="ny-recommendation">{row.recommendation}</span> : null}
      </div>
      <RequestError error={error} subject="Saving your response" onRetry={onRefresh} retryLabel="Check status" />
      {error?.unconfirmed ? <button className="btn small" onClick={() => setError(null)}>I checked the queue; keep editing</button> : null}
      {pending ? <p role="status">Submitting…</p> : null}
      {done ? <p role="status">Saved. <button className="btn small" onClick={onRefresh}>Refresh queue</button></p> : null}
      {!editable ? <p>View only. Ask the project owner to respond or grant edit access.</p> : null}
      <div className="ny-actions">
        {row.type === 'escalation' ? (
          mode === 'accept' || mode === 'redirect' ? (
            <form
              className="tray-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (mode === 'accept') action(() => onResolveEscalation(row.sourceRef.id, { action: 'accept', answer }));
                else action(() => onResolveEscalation(row.sourceRef.id, { action: 'redirect', target_agent_id: target, answer }));
              }}
            >
              {mode === 'redirect' ? (
                <select aria-label="Agent to ask" disabled={disabled} value={target} onChange={(e) => setTarget(e.target.value)} required>
                  <option value="" disabled>redirect to…</option>
                  {availableAgents.filter((a) => a.id !== row.escalatingAgentId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                  ))}
                </select>
              ) : null}
              <textarea
                aria-label="Your answer"
                disabled={disabled}
                rows="2"
                autoFocus
                placeholder={mode === 'accept' ? 'Your decision — the agent resumes with this…' : 'Instructions for the redirected agent…'}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <div className="tray-actions">
                <button className="btn ok small" type="submit" disabled={disabled || !answer.trim() || (mode === 'redirect' && !target)}>
                  {mode === 'accept' ? 'Submit answer' : 'Ask another agent'}
                </button>
                <button className="btn ghost small" type="button" disabled={pending} onClick={() => setMode(null)}>Back</button>
              </div>
            </form>
          ) : (
            <>
              <button disabled={disabled} className="btn ok small" onClick={() => setMode('accept')}>Answer</button>
              <details open={otherActions} onToggle={(e) => setOtherActions(e.currentTarget.open)}><summary>Other actions</summary>
              <RequestError error={contextError} subject="Loading the project team" onRetry={() => setContextTick((n) => n + 1)} />
              {loadContext && !context && !contextError && otherActions ? <p>Loading team…</p> : null}
              <button disabled={disabled || (loadContext && !context)} className="btn ghost small" onClick={() => setMode('redirect')}>Ask another agent</button>
              <button className="btn ghost small dim-btn" disabled={disabled} onClick={() => action(() => onResolveEscalation(row.sourceRef.id, { action: 'dismiss' }))}>Dismiss</button>
              {onAssign ? (
                <select
                  aria-label="Assign this item"
                  disabled={disabled || (loadContext && !context)}
                  className="tray-assign"
                  value=""
                  title="Assign — routing only, resolution still happens here"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    if (v.startsWith('p:')) action(() => onAssign(row.sourceRef.id, { owner_email: v.slice(2) }), false);
                    else if (v.startsWith('a:')) action(() => onAssign(row.sourceRef.id, { owner_agent_id: v.slice(2) }), false);
                    else if (v === 'clear') action(() => onAssign(row.sourceRef.id, { owner_email: null, owner_agent_id: null }), false);
                  }}
                >
                  <option value="">assign…</option>
                  {availablePeople.map((p) => <option key={p.id} value={`p:${p.email}`}>{p.display || p.email}</option>)}
                  {availableAgents.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name} (agent)</option>)}
                  {ownerLabel ? <option value="clear">clear assignment</option> : null}
                </select>
              ) : null}
              </details>
            </>
          )
        ) : null}
        {row.type === 'conflict' ? (
          <button className="btn small" onClick={() => onOpenMemory(row.sourceRef)}>Review memory</button>
        ) : null}
        {row.type === 'overdue_review' ? (
          <>
            <button className="btn ok small" title="Re-affirm as still true — an append-only correction with a fresh review date" disabled={disabled} onClick={() => action(() => onExtendReview(row.sourceRef))}>Confirm still true</button>
            <button className="btn ghost small" onClick={() => onOpenMemory(row.sourceRef)}>Review memory</button>
          </>
        ) : null}
        {row.type === 'failed_run' ? (
          <>
            <button className="btn ok small" disabled={disabled} onClick={() => action(() => onRetryRun(row.sourceRef))}>Try again</button>
            <button className="btn ghost small" onClick={() => onOpenRun(row.sourceRef)}>View work</button>
          </>
        ) : null}
        {/* Projected cards (conflict / overdue review / failed run) carry a
            server-issued dismissKey — "not now" without touching the record. */}
        {row.dismissKey && onDismiss ? (
          <details><summary>Other actions</summary><button disabled={disabled} className="btn ghost small dim-btn" title="Hide this card — the underlying record is untouched" onClick={() => action(() => onDismiss(row))}>Dismiss</button></details>
        ) : null}
        {row.type === 'rule_alert' || row.type === 'brief_ready' ? (
          <>
            <button className="btn ok small" disabled={disabled} onClick={() => action(() => onAcknowledgeRuleRun(row.sourceRef))}>Mark reviewed</button>
            {/* The card carries only the first ~300 chars of the result — the full
                brief and its evidence refs live on the rule. Absent when Rules is
                flagged off (no onOpenRule) so the control never dead-ends. */}
            {onOpenRule && row.sourceRef.ruleId ? (
              <button className="btn ghost small" onClick={() => onOpenRule(row.sourceRef)}>
                {row.type === 'brief_ready' ? 'View brief' : 'View scheduled work'}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function NeedsYouView({ rows, userEmail, defaultScope = 'all', scope: requestedScope, onScopeChange, loadStatus, onRefresh, loadContext, agentsById, people, agents, onResolveEscalation, onAssign, onOpenMemory, onOpenRun, onRetryRun, onExtendReview, onAcknowledgeRuleRun, onDismiss, onOpenRule }) {
  // Members land on Mine — unowned technical noise is the owner's to triage.
  // The All tab stays one click away; nothing is hidden, only defaulted.
  const [localScope, setLocalScope] = useState(defaultScope);
  const scope = requestedScope || localScope;
  const setScope = onScopeChange || setLocalScope;
  const me = String(userEmail || '').toLowerCase();

  // Scope is a client-side filter over the one fetched projection: mine =
  // owned by me; team = owned by someone else, or unowned.
  const visible = useMemo(() => {
    if (!rows) return null;
    if (onScopeChange) return rows;
    if (scope === 'mine') return rows.filter((r) => r.owner.email && r.owner.email.toLowerCase() === me);
    if (scope === 'team') return rows.filter((r) => !r.owner.email || r.owner.email.toLowerCase() !== me);
    return rows;
  }, [rows, scope, me, onScopeChange]);

  return (
    <div className="needs-you" role="region" aria-label="Needs you — everything waiting on a human">
      <div className="ny-head">
        <h2>Needs you</h2>
        <div className="ny-filters" role="tablist" aria-label="Attention scope">
          {['mine', 'team', 'all'].map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} className={`btn small ${scope === s ? 'active' : 'ghost'}`} onKeyDown={(e) => choiceKeys(e, ['mine', 'team', 'all'], scope, setScope)} onClick={() => setScope(s)}>
              {s === 'mine' ? 'Mine' : s === 'team' ? 'Team' : 'All'}
            </button>
          ))}
        </div>
      </div>
      <p>Latest review items across your accessible project spaces. Older items may require opening their source.</p>
      <RequestError error={loadStatus?.error} subject="Loading Needs You" onRetry={onRefresh} />
      {loadStatus?.error && rows?.length ? <p>Last known items are shown. Refresh before responding.</p> : null}
      {onRefresh ? <button className="btn small" onClick={onRefresh}>Refresh queue</button> : null}
      {(!visible || loadStatus?.loading) && !loadStatus?.error ? <div className="ny-empty dim">Loading…</div> : null}
      {visible && visible.length === 0 && !loadStatus?.loading && !loadStatus?.error ? (
        <div className="ny-empty">
          <span className="tray-clear-mark">✓</span> Nothing needs {scope === 'mine' ? 'you' : scope === 'team' ? 'the team' : 'anyone'} right now.
        </div>
      ) : null}
      <div className="ny-list">
        {(visible || []).map((row) => (
          <AttentionCard
            key={`${row.sourceRef.canvasId}:${row.type}:${row.sourceRef.id}`}
            row={row}
            editable={row.access !== 'view' && !loadStatus?.error && !loadStatus?.loading}
            loadContext={loadContext}
            onRefresh={onRefresh}
            agentsById={agentsById}
            people={people}
            agents={agents}
            onResolveEscalation={onResolveEscalation}
            onAssign={onAssign}
            onOpenMemory={onOpenMemory}
            onOpenRun={onOpenRun}
            onRetryRun={onRetryRun}
            onExtendReview={onExtendReview}
            onAcknowledgeRuleRun={onAcknowledgeRuleRun}
            onDismiss={onDismiss}
            onOpenRule={onOpenRule}
          />
        ))}
      </div>
    </div>
  );
}

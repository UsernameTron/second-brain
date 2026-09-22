import React, { useRef, useState } from 'react';
import { RequestError } from './RequestState.jsx';
import { useDraft } from './Drafts.jsx';
import { timeAgo } from './api.js';
import { humanizeDetail } from './format.jsx';

const KIND_COLORS = {
  question: 'k-question', livelock: 'k-livelock', budget: 'k-budget', timeout: 'k-timeout',
  conflict: 'k-conflict', steps: 'k-steps', refusal: 'k-refusal', error: 'k-refusal',
};

function TrayItem({ esc, agentsById, agents, people = [], onResolve, onAssign, onRefresh }) {
  const [mode, setMode] = useState(null); // null | 'accept' | 'redirect'
  const [answer, setAnswer] = useDraft(`legacy-review:${esc.id}`, '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const guard = useRef(false);
  const action = async (fn) => {
    if (guard.current || error?.unconfirmed) return;
    guard.current = true; setPending(true); setError(null);
    try { await fn(); } catch (e) { setError(e); }
    finally { guard.current = false; setPending(false); }
  };
  const [target, setTarget] = useState('');
  const [showCtx, setShowCtx] = useState(false);
  const agent = esc.agent_id ? agentsById[esc.agent_id] : null;
  const ownerAgent = esc.owner_agent_id ? agentsById[esc.owner_agent_id] : null;
  const ownerLabel = esc.owner_email || (ownerAgent ? ownerAgent.name : null);

  const contextStr = (() => {
    try { return humanizeDetail(esc.context); } catch { return String(esc.context); }
  })();

  return (
    <div className={`tray-item ${esc.leaving ? 'leaving' : ''}`}>
      <div className="tray-item-head">
        {agent
          ? <span className="tray-agent" style={{ '--c': agent.color }}>{agent.name}</span>
          : <span className="tray-agent system">system</span>}
        <span className={`chip esc-kind ${KIND_COLORS[esc.kind] || ''}`}>{esc.kind}</span>
        <span className="mono dim">{timeAgo(esc.created_at)}</span>
        {ownerLabel ? <span className="chip owner-chip" title={esc.due_at ? `due ${esc.due_at.slice(0, 10)}` : 'assigned'}>→ {ownerLabel}</span> : null}
      </div>
      <div className="tray-question">{esc.question}</div>
      {esc.context && Object.keys(esc.context || {}).length > 0 ? (
        <button className="link-btn" onClick={() => setShowCtx((v) => !v)}>
          {showCtx ? 'hide context' : 'context'}
        </button>
      ) : null}
      {showCtx ? <pre className="tray-context mono">{contextStr}</pre> : null}

      <RequestError error={error} subject="Saving your response" onRetry={onRefresh} retryLabel="Check status" />
      <fieldset disabled={pending || error?.unconfirmed} className="review-controls">
      {mode === null ? (
        <div className="tray-actions">
          <button className="btn ok small" onClick={() => setMode('accept')}>Accept</button>
          <button className="btn ghost small" onClick={() => setMode('redirect')}>Redirect</button>
          <button className="btn ghost small dim-btn" onClick={() => action(() => onResolve(esc.id, { action: 'dismiss' }))}>Dismiss</button>
          {onAssign ? (
            <select
              className="tray-assign"
              value=""
              title="Assign this to a person or an agent — routing only, resolution still happens here"
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v.startsWith('p:')) action(() => onAssign(esc.id, { owner_email: v.slice(2) }));
                else if (v.startsWith('a:')) action(() => onAssign(esc.id, { owner_agent_id: v.slice(2) }));
                else if (v === 'clear') action(() => onAssign(esc.id, { owner_email: null, owner_agent_id: null }));
              }}
            >
              <option value="">assign…</option>
              {people.map((p) => <option key={p.id} value={`p:${p.email}`}>{p.display || p.email}</option>)}
              {agents.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name} (agent)</option>)}
              {ownerLabel ? <option value="clear">clear assignment</option> : null}
            </select>
          ) : null}
        </div>
      ) : (
        <form
          className="tray-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'accept') action(() => onResolve(esc.id, { action: 'accept', answer }));
            else action(() => onResolve(esc.id, { action: 'redirect', target_agent_id: target, answer }));
          }}
        >
          {mode === 'redirect' ? (
            <select value={target} onChange={(e) => setTarget(e.target.value)} required>
              <option value="" disabled>redirect to…</option>
              {agents.filter((a) => a.id !== esc.agent_id).map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
              ))}
            </select>
          ) : null}
          <textarea
            rows="2"
            autoFocus
            placeholder={mode === 'accept' ? 'Your decision — the agent resumes with this…' : 'Instructions for the redirected agent…'}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="tray-actions">
            <button className="btn ok small" type="submit" disabled={!answer.trim() || (mode === 'redirect' && !target)}>
              {mode === 'accept' ? 'Send decision' : 'Redirect'}
            </button>
            <button className="btn ghost small" type="button" onClick={() => setMode(null)}>Back</button>
          </div>
        </form>
      )}
      </fieldset>
    </div>
  );
}

// Pinned to the top of the viewport, always visible, never inside the canvas layout.
// P2: with the needs_you flag on, the tray collapses to its badge (count =
// the full attention projection) and clicking opens the NEEDS YOU view.
export default function Tray({ escalations, agentsById, agents, people = [], onResolve, onAssign, badgeOnly = false, badgeCount = null, onOpen, loadStatus, onRefresh }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mascotOk, setMascotOk] = useState(true);
  const n = badgeOnly && badgeCount !== null ? badgeCount : escalations.length;

  return (
    <div className={`tray ${n > 0 ? 'has-items' : 'clear'}`} role="region" aria-label={`Needs you: ${n} item${n === 1 ? '' : 's'}`}>
      <button
        className="tray-head"
        onClick={() => (badgeOnly && onOpen ? onOpen() : setCollapsed((v) => !v))}
        aria-expanded={badgeOnly ? undefined : !collapsed}
        title={badgeOnly ? 'Open the Needs you view' : (collapsed ? 'Expand' : 'Collapse')}
      >
        {loadStatus?.error || loadStatus?.loading || n === '—' ? <>Needs you · status unavailable</> : n > 0 ? (
          <>
            <span className="tray-badge">{n}</span>
            Needs you
            {badgeOnly ? null : <span className="tray-caret">{collapsed ? '▾' : '▴'}</span>}
          </>
        ) : (
          <>
            {mascotOk ? (
              <img className="tray-mascot" src="/mascot.png" alt="" onError={() => setMascotOk(false)} />
            ) : (
              <span className="tray-clear-mark">✓</span>
            )}{' '}
            Nothing needs you
          </>
        )}
      </button>
      <RequestError error={loadStatus?.error} subject="Loading review items" onRetry={onRefresh} />
      {!badgeOnly && !collapsed && n > 0 ? (
        <div className="tray-list">
          {escalations.map((e) => (
            <TrayItem key={e.id} esc={e} agentsById={agentsById} agents={agents} people={people} onResolve={onResolve} onAssign={onAssign} onRefresh={onRefresh} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

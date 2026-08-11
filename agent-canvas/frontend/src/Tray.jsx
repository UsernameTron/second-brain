import React, { useState } from 'react';
import { timeAgo, short } from './api.js';

const KIND_COLORS = {
  question: 'k-question', livelock: 'k-livelock', budget: 'k-budget', timeout: 'k-timeout',
  conflict: 'k-conflict', steps: 'k-steps', refusal: 'k-refusal', error: 'k-refusal',
};

function TrayItem({ esc, agentsById, agents, onResolve }) {
  const [mode, setMode] = useState(null); // null | 'accept' | 'redirect'
  const [answer, setAnswer] = useState('');
  const [target, setTarget] = useState('');
  const [showCtx, setShowCtx] = useState(false);
  const agent = esc.agent_id ? agentsById[esc.agent_id] : null;

  const contextStr = (() => {
    try { return JSON.stringify(esc.context, null, 1); } catch { return String(esc.context); }
  })();

  return (
    <div className={`tray-item ${esc.leaving ? 'leaving' : ''}`}>
      <div className="tray-item-head">
        {agent
          ? <span className="tray-agent" style={{ '--c': agent.color }}>{agent.name}</span>
          : <span className="tray-agent system">system</span>}
        <span className={`chip esc-kind ${KIND_COLORS[esc.kind] || ''}`}>{esc.kind}</span>
        <span className="mono dim">{timeAgo(esc.created_at)}</span>
      </div>
      <div className="tray-question">{esc.question}</div>
      {esc.context && Object.keys(esc.context || {}).length > 0 ? (
        <button className="link-btn" onClick={() => setShowCtx((v) => !v)}>
          {showCtx ? 'hide context' : 'context'}
        </button>
      ) : null}
      {showCtx ? <pre className="tray-context mono">{short(contextStr, 800)}</pre> : null}

      {mode === null ? (
        <div className="tray-actions">
          <button className="btn ok small" onClick={() => setMode('accept')}>Accept</button>
          <button className="btn ghost small" onClick={() => setMode('redirect')}>Redirect</button>
          <button className="btn ghost small dim-btn" onClick={() => onResolve(esc.id, { action: 'dismiss' })}>Dismiss</button>
        </div>
      ) : (
        <form
          className="tray-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'accept') onResolve(esc.id, { action: 'accept', answer });
            else onResolve(esc.id, { action: 'redirect', target_agent_id: target, answer });
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
    </div>
  );
}

// Pinned to the top of the viewport, always visible, never inside the canvas layout.
export default function Tray({ escalations, agentsById, agents, onResolve }) {
  const [collapsed, setCollapsed] = useState(false);
  const n = escalations.length;

  return (
    <div className={`tray ${n > 0 ? 'has-items' : 'clear'}`}>
      <button className="tray-head" onClick={() => setCollapsed((v) => !v)} title={collapsed ? 'Expand' : 'Collapse'}>
        {n > 0 ? (
          <>
            <span className="tray-badge">{n}</span>
            Needs you
            <span className="tray-caret">{collapsed ? '▾' : '▴'}</span>
          </>
        ) : (
          <><span className="tray-clear-mark">✓</span> Nothing needs you</>
        )}
      </button>
      {!collapsed && n > 0 ? (
        <div className="tray-list">
          {escalations.map((e) => (
            <TrayItem key={e.id} esc={e} agentsById={agentsById} agents={agents} onResolve={onResolve} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

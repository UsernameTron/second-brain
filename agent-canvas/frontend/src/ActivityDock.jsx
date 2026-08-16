import React, { useMemo, useState } from 'react';
import { fmtClock, short } from './api.js';
import { formatRunEventPreview } from './format.jsx';

const BUCKETS = [
  { key: 'text', label: 'text', icon: '¶' },
  { key: 'tool_call', label: 'tool call', icon: '⚙' },
  { key: 'tool_result', label: 'tool result', icon: '↩' },
  { key: 'handoff', label: 'handoff', icon: '⇄' },
  { key: 'escalation', label: 'escalation', icon: '⚑' },
  { key: 'memory', label: 'memory', icon: '◈' },
  { key: 'run', label: 'run status', icon: '▶' },
];
const ICON = Object.fromEntries(BUCKETS.map((b) => [b.key, b.icon]));

// Bucket/icon selection lives here; the preview words come from format.jsx.
function itemFromRunEvent(e) {
  const p = e.payload || {};
  let bucket;
  switch (e.type) {
    case 'text': bucket = 'text'; break;
    case 'tool_call':
      bucket = p.name === 'handoff' ? 'handoff' : /memory/.test(p.name || '') ? 'memory' : 'tool_call';
      break;
    case 'tool_result': bucket = 'tool_result'; break;
    case 'memory': bucket = 'memory'; break;
    case 'escalation': bucket = 'escalation'; break;
    default: bucket = 'run';
  }
  return { id: `e-${e.id}`, ts: e.ts, agent_id: e.agent_id, bucket, text: formatRunEventPreview(e, 'dock') };
}

export default function ActivityDock({ activity, handoffs, agents, agentsById, onHoverHandoff }) {
  const [open, setOpen] = useState(false);
  const [agentFilter, setAgentFilter] = useState('all');
  const [buckets, setBuckets] = useState(() => new Set(BUCKETS.map((b) => b.key)));

  const items = useMemo(() => {
    const list = activity.map(itemFromRunEvent);
    for (const h of handoffs) {
      const from = agentsById[h.from_agent_id];
      const to = agentsById[h.to_agent_id];
      list.push({
        id: `h-${h.id}`,
        ts: h.ts,
        agent_id: h.from_agent_id,
        bucket: 'handoff',
        handoffId: h.id,
        text: `${from?.name || '?'} → ${to?.name || '?'} [${h.item_key || 'handoff'}] ${short(h.message, 90)}`,
      });
    }
    list.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return list.slice(0, 600);
  }, [activity, handoffs, agentsById]);

  const visible = items.filter((it) => {
    if (!buckets.has(it.bucket)) return false;
    if (agentFilter !== 'all' && it.agent_id !== agentFilter) return false;
    return true;
  });

  const toggleBucket = (key) => {
    setBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className={`dock ${open ? 'open' : ''}`}>
      <button className="dock-head" onClick={() => setOpen((v) => !v)}>
        <span className="dock-title">Activity</span>
        <span className="dock-count mono">{items.length}</span>
        {!open && items[0] ? (
          <span className="dock-preview">
            <span className="dock-icon">{ICON[items[0].bucket]}</span> {short(items[0].text, 90)}
          </span>
        ) : null}
        <span className="dock-caret">{open ? '▾' : '▴'}</span>
      </button>
      {open ? (
        <>
          <div className="dock-filters">
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
              <option value="all">all agents</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                className={`chip filter-chip ${buckets.has(b.key) ? 'on' : ''}`}
                onClick={() => toggleBucket(b.key)}
              >
                {b.icon} {b.label}
              </button>
            ))}
          </div>
          <div className="dock-list">
            {visible.length === 0 ? <div className="empty-hint">Nothing here yet — dispatch an agent and watch it think.</div> : null}
            {visible.map((it) => {
              const agent = it.agent_id ? agentsById[it.agent_id] : null;
              return (
                <div
                  key={it.id}
                  className={`dock-row ${it.handoffId ? 'hoverable-edge' : ''}`}
                  onMouseEnter={it.handoffId ? () => onHoverHandoff(it.handoffId) : undefined}
                  onMouseLeave={it.handoffId ? () => onHoverHandoff(null) : undefined}
                  title={it.handoffId ? 'Hover highlights this handoff edge on the canvas' : undefined}
                >
                  <span className="mono dock-ts">{fmtClock(it.ts)}</span>
                  <span className="dock-agent-dot" style={{ background: agent?.color || 'rgba(255,255,255,0.25)' }} title={agent?.name || 'system'} />
                  <span className={`dock-icon b-${it.bucket}`} title={it.bucket}>{ICON[it.bucket]}</span>
                  <span className="dock-text">{it.text}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

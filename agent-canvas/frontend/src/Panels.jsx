import React, { useEffect, useState } from 'react';
import { fmtUSD, timeAgo, fmtClock, short } from './api.js';

export function Panel({ title, wide, onClose, headerExtra, children }) {
  return (
    <aside className={`panel ${wide ? 'panel-wide' : ''}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        <div className="panel-head-extra">{headerExtra}</div>
        <button className="icon-btn" onClick={onClose} title="Close panel">✕</button>
      </header>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

const RUN_STATUS_CLASS = {
  queued: 'run-queued', running: 'run-running', completed: 'run-completed',
  failed: 'run-failed', refused: 'run-failed',
  halted_steps: 'run-halted', halted_timeout: 'run-halted',
  halted_paused: 'run-halted', halted_budget: 'run-halted',
};

export function AgentPanel({ agent, runs, spendRow, initialRunId, paused, onDispatch, fetchRunEvents, onClose }) {
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);
  const [runSel, setRunSel] = useState(initialRunId);
  const [events, setEvents] = useState(null);

  useEffect(() => { setRunSel(initialRunId); }, [initialRunId, agent.id]);

  useEffect(() => {
    if (!runSel) { setEvents(null); return undefined; }
    let alive = true;
    setEvents(null);
    fetchRunEvents(runSel)
      .then((evs) => { if (alive) setEvents(evs); })
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [runSel, fetchRunEvents]);

  const send = async (e) => {
    e.preventDefault();
    if (!instruction.trim() || sending) return;
    setSending(true);
    try {
      await onDispatch(instruction.trim());
      setInstruction('');
    } finally {
      setSending(false);
    }
  };

  const selRun = runSel ? runs.find((r) => r.id === runSel) : null;

  return (
    <Panel
      title={<span><span className="dot-inline" style={{ background: agent.color }} />{agent.name}</span>}
      onClose={onClose}
      headerExtra={
        <>
          <span className="chip role-chip">{agent.role}</span>
          <span className={`chip tier-chip tier-${agent.model_tier}`}>{agent.model_tier}</span>
          <span className={`agent-status as-${agent.status}`}>{agent.status}</span>
        </>
      }
    >
      <div className="agent-panel-spend mono">
        spend {spendRow ? fmtUSD(spendRow.cost_usd) : '$0.00'}
        {spendRow ? ` · in ${spendRow.input_tokens} / out ${spendRow.output_tokens} tok · ${spendRow.runs} runs` : ' · no runs yet'}
      </div>

      <form className="dispatch-box" onSubmit={send}>
        <label>Send to {agent.name}</label>
        <textarea
          rows="3"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={`Instruction for ${agent.name}…`}
        />
        <button className="btn primary" type="submit" disabled={sending || !instruction.trim() || paused}
          title={paused ? 'Workspace is paused' : undefined}>
          {sending ? 'Dispatching…' : `Dispatch to ${agent.name}`}
        </button>
      </form>

      {selRun ? (
        <div className="run-detail">
          <button className="btn ghost small" onClick={() => setRunSel(null)}>← all runs</button>
          <div className="run-detail-head">
            <span className={`chip ${RUN_STATUS_CLASS[selRun.status] || ''}`}>{selRun.status}</span>
            <span className="mono">{selRun.steps_used}/{selRun.step_budget} steps · {fmtUSD(selRun.cost_usd)}</span>
          </div>
          <div className="run-detail-instr">{short(selRun.instruction, 240)}</div>
          {selRun.summary ? <div className="run-summary">{selRun.summary}</div> : null}
          {selRun.error ? <div className="run-error">⚠ {selRun.error}</div> : null}
          <div className="run-events">
            {events === null ? <div className="empty-hint">loading events…</div> : null}
            {events && events.length === 0 ? <div className="empty-hint">no events recorded</div> : null}
            {(events || []).map((ev) => (
              <div key={ev.id} className="run-event">
                <span className="mono re-ts">{fmtClock(ev.ts)}</span>
                <span className={`chip re-type re-${ev.type}`}>{ev.type}</span>
                <span className="re-payload">{runEventPreview(ev)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="runs-list">
          <h3>Recent runs</h3>
          {runs.length === 0 ? <div className="empty-hint">No runs yet — send an instruction above.</div> : null}
          {runs.slice(0, 20).map((r) => (
            <button key={r.id} className="run-row" onClick={() => setRunSel(r.id)}>
              <span className={`chip ${RUN_STATUS_CLASS[r.status] || ''}`}>{r.status}</span>
              <span className="mono">{r.steps_used}/{r.step_budget}</span>
              <span className="mono">{fmtUSD(r.cost_usd)}</span>
              <span className="run-row-time">{timeAgo(r.created_at)}</span>
              <span className="run-row-sum">{short(r.summary || r.instruction, 90)}</span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function runEventPreview(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case 'text': return short(p.text, 220);
    case 'tool_call': return `${p.name}(${short(JSON.stringify(p.input || {}), 160)})`;
    case 'tool_result': return `${p.name} → ${short(p.preview, 180)}${p.isError ? ' ⚠' : ''}`;
    case 'run_started': return short(p.instruction, 180);
    case 'run_finished': return `${p.status}${p.summary ? ` — ${short(p.summary, 150)}` : ''}${p.error ? ` ⚠ ${short(p.error, 120)}` : ''}`;
    default: return short(JSON.stringify(p), 180);
  }
}

export function NotePanel({ note, task, onSave, onClose }) {
  const [draft, setDraft] = useState(() => (note ? { title: note.title, content: note.content, pinned: !!note.pinned } : null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (note) setDraft({ title: note.title, content: note.content, pinned: !!note.pinned });
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (task) {
    return (
      <Panel title={task.title} onClose={onClose} headerExtra={<span className={`chip task-st tk-${task.status}`}>{task.status.replace('_', ' ')}</span>}>
        <p className="task-desc">{task.description || 'No description.'}</p>
        <div className="mono empty-hint">created {timeAgo(task.created_at)} · updated {timeAgo(task.updated_at)}</div>
      </Panel>
    );
  }
  if (!note || !draft) return null;

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const d = await onSave(note, draft);
      if (d && d.note) setDraft({ title: d.note.title, content: d.note.content, pinned: !!d.note.pinned });
    } catch { /* toast raised upstream */ }
    setSaving(false);
  };

  return (
    <Panel
      title="Note"
      onClose={onClose}
      headerExtra={note.pinned ? <span className="chip live-chip">LIVE CONTEXT</span> : null}
    >
      <form className="note-form" onSubmit={save}>
        <input
          className="note-title-input"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          rows="14"
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        />
        <label className="pin-toggle">
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
          />
          <span className="pin-slider" />
          Pin as live context <span className="pin-hint">(pinned notes feed every agent run)</span>
        </label>
        <div className="note-meta mono">v{note.version} · {note.updated_by || '—'} · {timeAgo(note.updated_at)}</div>
        <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save note'}</button>
      </form>
    </Panel>
  );
}

export function SpendPanel({ spend, budget, isOwner, onSetBudget, onClose }) {
  const [budgetInput, setBudgetInput] = useState('');
  const pct = budget && budget.budget_usd > 0 ? Math.min(1, (budget.cost_usd || 0) / budget.budget_usd) : 0;

  return (
    <Panel title="Spend" onClose={onClose}>
      <div className="spend-daily">
        <div className="spend-big mono">{budget ? fmtUSD(budget.cost_usd) : '—'}</div>
        <div className="spend-sub">today, of a {budget ? fmtUSD(budget.budget_usd) : '—'} daily budget</div>
        <div className={`budget-bar wide ${pct > 0.9 ? 'over' : ''}`}>
          <span className="budget-fill" style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="mono spend-tokens">
          {budget ? `in ${budget.input_tokens} tok · out ${budget.output_tokens} tok` : ''}
        </div>
      </div>

      {isOwner ? (
        <form
          className="budget-set"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(budgetInput);
            if (Number.isFinite(v) && v >= 0) { onSetBudget(v); setBudgetInput(''); }
          }}
        >
          <label>Set daily budget (USD)</label>
          <div className="dev-row">
            <input type="number" min="0" step="1" placeholder={budget ? String(budget.budget_usd) : '25'}
              value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} />
            <button className="btn primary" type="submit" disabled={budgetInput === ''}>Set</button>
          </div>
        </form>
      ) : null}

      <h3>This canvas</h3>
      <div className="mono spend-canvas">
        {spend?.canvasTotal
          ? `${fmtUSD(spend.canvasTotal.cost_usd)} · in ${spend.canvasTotal.input_tokens} / out ${spend.canvasTotal.output_tokens} tok`
          : 'no spend recorded'}
      </div>

      <h3>Per agent</h3>
      <table className="spend-table">
        <thead><tr><th>agent</th><th>runs</th><th>tokens</th><th>cost</th></tr></thead>
        <tbody>
          {(spend?.perAgent || []).map((row) => (
            <tr key={row.agent_id}>
              <td>{row.name} <span className="dim">({row.role})</span></td>
              <td className="mono">{row.runs}</td>
              <td className="mono">{row.input_tokens}/{row.output_tokens}</td>
              <td className="mono">{fmtUSD(row.cost_usd)}</td>
            </tr>
          ))}
          {(spend?.perAgent || []).length === 0 ? (
            <tr><td colSpan="4" className="empty-hint">no agents</td></tr>
          ) : null}
        </tbody>
      </table>
    </Panel>
  );
}

import { certaintyLabel, workStatusLabel, agentTierLabel } from './format.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { api, fmtUSD, timeAgo, fmtClock, short } from './api.js';
import { SummaryMarkdown, formatContractTail, plainPreview, formatRunEventPreview } from './format.jsx';
import WorkDetails from './WorkDetails.jsx';
import { RequestError } from './RequestState.jsx';
import { useDraft } from './Drafts.jsx';

export function Panel({ title, wide, onClose, headerExtra, children }) {
  return (
    <aside className={`panel ${wide ? 'panel-wide' : ''}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        <div className="panel-head-extra">{headerExtra}</div>
        <button className="icon-btn" onClick={onClose} title="Close panel" aria-label="Close panel">✕</button>
      </header>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

// P4: the agent's append-only config history. Rollback restores config
// (prompt/tier/authority/budgets), never identity; owner-only server-side —
// a member's click gets the server's 403 message inline.
function AgentVersions({ canvasId, agentId, isOwner }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api(`/api/canvases/${canvasId}/agents/${agentId}/versions`)
    .then((d) => { setVersions(d.versions); setError(null); }).catch(setError);

  const rollback = async (versionId) => {
    if (busy) return;
    setBusy(true); setNote(''); setError(null);
    try {
      const d = await api(`/api/canvases/${canvasId}/agents/${agentId}/rollback/${versionId}`, { method: 'POST', body: {} });
      setNote(`Restored: ${Object.keys(d.diff).join(', ') || 'no fields differed'}`);
      load();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="agent-versions">
      <button className="btn ghost small" aria-expanded={open}
        onClick={() => { setOpen(!open); if (!open && versions === null) load(); }}>
        {open ? 'Hide versions' : 'Versions'}
      </button>
      {open ? (
        <>
          <RequestError error={error} subject="Loading or restoring agent settings" onRetry={load} retryLabel="Check versions" />
          {note ? <p className="dim">{note}</p> : null}
          {versions === null && !error ? <p className="dim">loading…</p> : null}
          {versions && versions.length === 0 ? <p className="dim">No tracked versions yet — the first prompt/tier change or publish creates history.</p> : null}
          <ul className="room-list">
            {(versions || []).map((v) => (
              <li key={v.id}>
                <span className="chip">{v.source}</span>
                <span className={`chip tier-${v.model_tier}`}>{agentTierLabel(v.model_tier)}</span>
                <span className="dim mono">{timeAgo(v.created_at)} · {v.actor}</span>
                <span>{short(v.system_prompt, 60)}</span>
                {isOwner ? <button disabled={busy} className="btn ghost small" onClick={() => rollback(v.id)}>Rollback</button> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

const RUN_STATUS_CLASS = {
  queued: 'run-queued', running: 'run-running', completed: 'run-completed',
  failed: 'run-failed', refused: 'run-failed',
  halted_steps: 'run-halted', halted_timeout: 'run-halted',
  halted_paused: 'run-halted', halted_budget: 'run-halted',
};

export function AgentPanel({ agent, runs, spendRow, initialRunId, paused, canvasId, onDispatch, onRemove, fetchRunEvents, fetchRunReceipt, onFeedback, onSelectEntry, onClose, isOwner = false, editable = true, onCheckStatus }) {
  const [instruction, setInstruction] = useDraft(`agent:${canvasId}:${agent.id}`, '');
  const [sendError, setSendError] = useState(null);
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [runSel, setRunSel] = useState(initialRunId);
  useEffect(() => { setRunSel(initialRunId); setSendError(null); }, [initialRunId, agent.id]);

  const send = async (e) => {
    e.preventDefault();
    if (!instruction.trim() || sending || !editable || sendError?.unconfirmed) return;
    setSending(true); setSendError(null);
    try {
      await onDispatch(instruction.trim());
      setInstruction((current) => current === instruction ? '' : current);
    } catch (error) { setSendError(error); } finally {
      setSending(false);
    }
  };

  const selRun = runSel ? runs.find((r) => r.id === runSel) : null;

  const remove = async () => {
    if (!onRemove || removing) return;
    setRemoving(true);
    try {
      const removed = await onRemove(agent);
      if (removed !== false) onClose();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Panel
      title={<span><span className="dot-inline" style={{ background: agent.color }} />{agent.name}</span>}
      onClose={onClose}
      headerExtra={
        <>
          <span className="chip role-chip">{agent.role}</span>
          <span className={`chip tier-chip tier-${agent.model_tier}`}>{agentTierLabel(agent.model_tier)}</span>
          <span className={`agent-status as-${workStatusLabel(agent.status)}`}>{workStatusLabel(agent.status)}</span>
        </>
      }
    >
      <div className="agent-panel-spend mono">
        spend {spendRow ? fmtUSD(spendRow.cost_usd) : 'unavailable'}
        {spendRow ? ` · in ${spendRow.input_tokens} / out ${spendRow.output_tokens} tok · ${spendRow.runs} runs` : ''}
      </div>

      <RequestError error={sendError} subject="Sending the instruction" onRetry={sendError?.unconfirmed ? onCheckStatus : () => send({ preventDefault() {} })} />
      {sendError?.unconfirmed ? <button className="btn small" onClick={() => setSendError(null)}>I checked recent work; keep editing</button> : null}
      {editable ? <form className="dispatch-box" onSubmit={send}>
        <label htmlFor="agent-instruction">Send to {agent.name}</label>
        <textarea
          id="agent-instruction"
          disabled={sending}
          rows="3"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={`Instruction for ${agent.name}…`}
        />
        <button className="btn primary" type="submit" disabled={sending || !instruction.trim() || paused || sendError?.unconfirmed}
          title={paused ? 'Workspace is paused' : undefined}>
          {sending ? 'Dispatching…' : `Dispatch to ${agent.name}`}
        </button>
      </form> : <p>View only. Ask the owner for edit access to send work.</p>}

      <details><summary>Advanced</summary>
      {canvasId ? <AgentVersions key={agent.id} canvasId={canvasId} agentId={agent.id} isOwner={isOwner} /> : null}
      {onRemove ? (
        <div className="agent-remove">
          <button className="btn ghost danger-link" type="button" disabled={removing} onClick={() => setConfirmRemove(true)}>
            Remove from canvas
          </button>
          {confirmRemove ? (
            <div className="agent-remove-confirm" role="alert">
              <strong>Remove {agent.name} from this canvas?</strong>
              <span>{agent.name} will stop receiving new work. Existing runs, memory, handoffs, versions, and audit history will be retained.</span>
              <div className="note-actions">
                <button className="btn danger" type="button" disabled={removing} onClick={remove}>
                  {removing ? 'Removing…' : `Yes, remove ${agent.name}`}
                </button>
                <button className="btn ghost" type="button" disabled={removing} onClick={() => setConfirmRemove(false)}>Keep agent</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      </details>
      {runSel ? (
        <>
          <button className="btn ghost small" onClick={() => setRunSel(null)}>← all runs</button>
          <WorkDetails embedded canvasId={canvasId} runId={runSel} fallbackRun={selRun} runTick={selRun?.status}
            fetchRunEvents={fetchRunEvents} fetchRunReceipt={fetchRunReceipt} onFeedback={onFeedback}
            onSelectEntry={onSelectEntry} onSelectRun={setRunSel} />
        </>
      ) : (
        <div className="runs-list">
          <h3>Recent runs</h3>
          {runs.length === 0 ? <div className="empty-hint">No runs yet — send an instruction above.</div> : null}
          {runs.slice(0, 20).map((r) => (
            <button key={r.id} className="run-row" onClick={() => setRunSel(r.id)}>
              <span className={`chip ${RUN_STATUS_CLASS[r.status] || ''}`}>{workStatusLabel(r.status)}</span>
              <span className="mono">{r.steps_used}/{r.step_budget}</span>
              <span className="mono">{fmtUSD(r.cost_usd)}</span>
              <span className="run-row-time">{timeAgo(r.created_at)}</span>
              <span className="run-row-sum">{short(plainPreview(formatContractTail(r.summary || r.instruction, 'humanize')), 90)}</span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

// The Context Receipt: what the run knew and how it came to know it.
// "provided" = attached before start (handoff payload, escalation lineage);
// "searches" = what it asked memory and what came back (rank + score);
// "cited" = what it wrote to memory. Retrieved ≠ used — only cites prove use.
export function ContextReceipt({ receipt, onFeedback }) {
  const [note, setNote] = useState('');
  receipt = { provided: [], searches: [], cited: [], evidence: [], ...receipt };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fb = receipt.feedback;
  const rate = async (verdict) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onFeedback(verdict, note); } catch (e) { setError(e); }
    finally { setBusy(false); }
  };
  const entryLine = (e, extra) => (
    <div key={e.id} className={`receipt-entry epi-${e.epistemic}`}>
      <span className="chip">{certaintyLabel(e.epistemic)}</span>
      {extra}
      <span className="receipt-content">{short(e.content, 120)}</span>
      {e.tainted ? <span className="tainted-flag">⚠</span> : null}
    </div>
  );
  return (
    <div className="context-receipt">
      <h3>Context receipt</h3>
      <p>Retrieved information and memory written are different. Check each claim against its source.</p>
      <h4>External sources ({receipt.evidence.length})</h4>
      {receipt.evidence.map((e) => <p key={e.id}>{e.redacted ? 'Private source' : e.uri ? <a href={e.uri} target="_blank" rel="noopener noreferrer">{e.title || e.sourceKind}</a> : e.title || e.sourceKind}</p>)}
      <h4>Provided before start ({receipt.provided.length})</h4>
      {receipt.provided.length === 0 ? <div className="empty-hint">nothing attached — the run started from its instruction alone</div> : null}
      {receipt.provided.map((e) => entryLine(e))}

      <h4>Memory searches ({receipt.searches.length})</h4>
      {receipt.searches.length === 0 ? <div className="empty-hint">No memory search results were recorded</div> : null}
      {receipt.searches.map((s, i) => (
        <div key={i} className="receipt-search">
          <div className="mono receipt-query">“{s.query || '(recent entries)'}”</div>
          {s.results.map((r) => entryLine(r.entry, (
            <span className="mono chip">#{r.rank}{r.score != null ? ` · ${r.score}` : ''}</span>
          )))}
        </div>
      ))}

      <h4>Written to memory ({receipt.cited.length})</h4>
      {receipt.cited.length === 0 ? <div className="empty-hint">the run wrote nothing to memory</div> : null}
      {receipt.cited.map((e) => entryLine(e))}

      {onFeedback ? (
        <div className="run-feedback">
          <RequestError error={error} subject="Saving feedback" />
          {error ? <p>Use Refresh work to check the saved rating before rating again.</p> : null}
          {fb ? (
            <div className="mono">rated {fb.verdict === 'up' ? '👍' : '👎'} by {fb.by}{fb.note ? ` — ${fb.note}` : ''}</div>
          ) : (
            <>
              <input aria-label="Feedback note" placeholder="optional note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn ghost small" disabled={busy || error?.unconfirmed} onClick={() => rate('up')} title="This run did its job">👍</button>
              <button className="btn ghost small" disabled={busy || error?.unconfirmed} onClick={() => rate('down')} title="This run missed">👎</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

const runEventPreview = (ev) => formatRunEventPreview(ev, 'detail');

export function NotePanel({ note, task, people = [], agents = [], pinnedNotes = [], editable = true, onAssignTask, onSave, onRemove, onClose, onCheckStatus }) {
  const [draft, setDraft] = useDraft(`note:${note?.id}`, () => (note ? { title: note.title, content: note.content, pinned: !!note.pinned } : null));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const assign = async (body) => {
    if (assigning) return;
    setAssigning(true); setError(null);
    try { await onAssignTask(task.id, body); } catch (e) { setError(e); }
    finally { setAssigning(false); }
  };

  if (task) {
    return (
      <Panel title={task.title} onClose={onClose} headerExtra={<span className={`chip task-st tk-${task.status}`}>{task.status.replace('_', ' ')}</span>}>
        <RequestError error={error} subject="Saving the assignment" onRetry={onCheckStatus} retryLabel="Check assignment" />
        <p className="task-desc">{task.description || 'No description.'}</p>
        {onAssignTask ? (
          <label className="task-assign">
            Assignee{' '}
            <select
              disabled={assigning || error?.unconfirmed}
              value={task.assignee_email ? `p:${task.assignee_email}` : (task.assignee_agent_id ? `a:${task.assignee_agent_id}` : '')}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith('p:')) assign({ assignee_email: v.slice(2), assignee_agent_id: null });
                else if (v.startsWith('a:')) assign({ assignee_agent_id: v.slice(2), assignee_email: null });
                else assign({ assignee_email: null, assignee_agent_id: null });
              }}
            >
              <option value="">unassigned</option>
              {people.map((p) => <option key={p.id} value={`p:${p.email}`}>{p.display || p.email}</option>)}
              {agents.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name} (agent)</option>)}
            </select>
          </label>
        ) : null}
        <div className="mono empty-hint">created {timeAgo(task.created_at)} · updated {timeAgo(task.updated_at)}</div>
      </Panel>
    );
  }
  if (!note || !draft) return null;

  const save = async (e) => {
    e.preventDefault();
    if (!editable || saving || !onSave) return;
    if (error?.unconfirmed) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const d = await onSave(note, draft);
      if (d && d.note) {
        setDraft((current) => current === draft ? { title: d.note.title, content: d.note.content, pinned: !!d.note.pinned } : current);
        setSaved(true);
      }
    } catch (e) { setError(e); }
    setSaving(false);
  };

  const remove = async () => {
    if (!editable || removing || !onRemove) return;
    setRemoving(true);
    try {
      const removed = await onRemove(note);
      if (removed !== false) onClose();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Panel
      title="Note"
      onClose={onClose}
      headerExtra={note.pinned ? <span className="chip live-chip">LIVE CONTEXT</span> : null}
    >
      <RequestError error={error} subject="Saving your note" onRetry={error?.unconfirmed ? onCheckStatus : () => save({ preventDefault() {} })} retryLabel={error?.unconfirmed ? 'Check status' : 'Retry save'} />
      {error?.unconfirmed ? <button className="btn small" onClick={() => setError(null)}>I checked the saved note; keep editing</button> : null}
      {saved ? <p role="status">Note saved.</p> : null}
      <form className="note-form" onSubmit={save}>
        <input
          className="note-title-input"
          aria-label="Note title"
          value={draft.title}
          readOnly={!editable || saving}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          aria-label="Note content"
          rows="14"
          value={draft.content}
          readOnly={!editable || saving}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        />
        <label className="pin-toggle">
          <input
            type="checkbox"
            checked={draft.pinned}
            disabled={!editable || saving}
            onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
          />
          <span className="pin-slider" />
          Include in every agent run
        </label>
        {draft.pinned ? (
          <div className="pin-context-note">
            {pinnedNotes.length ? (
              <>This note will be added alongside {pinnedNotes.length} other live-context {pinnedNotes.length === 1 ? 'note' : 'notes'}: {pinnedNotes.map((n) => n.title || 'Untitled note').join(', ')}.</>
            ) : 'This note will be included in every future agent run on this canvas.'}
          </div>
        ) : null}
        <div className="note-meta mono">v{note.version} · {note.updated_by || '—'} · {timeAgo(note.updated_at)}</div>
        {editable ? (
          <div className="note-actions">
            <button className="btn primary" type="submit" disabled={saving || removing || error?.unconfirmed}>{saving ? 'Saving…' : 'Save note'}</button>
            {onRemove ? (
              <button className="btn ghost danger-link" type="button" disabled={saving || removing} onClick={() => setConfirmRemove(true)}>
                Remove note
              </button>
            ) : null}
          </div>
        ) : <div className="note-readonly dim">View only — you can read this note, but you cannot change it.</div>}
        {confirmRemove ? (
          <div className="note-remove-confirm" role="alert">
            <strong>{note.pinned ? 'This note is pinned as live context.' : 'Remove this note?'}</strong>
            <span>
              {note.pinned
                ? 'It will disappear from this canvas and stop being included in future agent runs. Audit history is retained.'
                : 'It will disappear from this canvas. Audit history is retained.'}
            </span>
            <div className="note-actions">
              <button className="btn danger" type="button" disabled={removing} onClick={remove}>
                {removing ? 'Removing…' : 'Yes, remove note'}
              </button>
              <button className="btn ghost" type="button" disabled={removing} onClick={() => setConfirmRemove(false)}>Keep note</button>
            </div>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

export function SpendPanel({ spend, analytics, budget, isOwner, onSetBudget, onClose, statuses = {}, onRefresh, hasProject = true }) {
  const [budgetInput, setBudgetInput] = useDraft('daily-budget', '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const pct = budget && budget.budget_usd > 0 ? Math.min(1, (budget.cost_usd || 0) / budget.budget_usd) : 0;

  return (
    <Panel title="Spending" onClose={onClose}>
      <RequestError error={statuses.control?.error} subject="Checking today’s spending" onRetry={onRefresh} />
      {!budget ? <p>Today’s spending and cap are unavailable. Check status before relying on them. {onRefresh ? <button className="btn small" onClick={() => Promise.resolve().then(onRefresh).catch(() => {})}>Check status</button> : null}</p> : null}
      <RequestError error={error} subject="Saving the daily budget" onRetry={onRefresh ? async () => { await onRefresh(); setError(null); } : undefined} retryLabel="Check saved cap" />
      {error ? <p>Close and reopen Spending to check the saved cap before submitting again.</p> : null}
      <div className="spend-daily">
        <div className="spend-big mono">{budget ? fmtUSD(budget.cost_usd) : '—'}</div>
        <div className="spend-sub">today, of a {budget ? fmtUSD(budget.budget_usd) : '—'} daily budget</div>
        <div className={`budget-bar wide ${pct > 0.9 ? 'over' : ''}`}>
          <span className="budget-fill" style={{ width: `${pct * 100}%` }} />
        </div>

      </div>

      {isOwner ? (
        <details><summary>Owner settings</summary><form
          className="budget-set"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Number(budgetInput);
            if (!Number.isFinite(v) || v < 0 || saving || error?.unconfirmed) return;
            setSaving(true); setError(null);
            try { await onSetBudget(v); setBudgetInput(''); } catch (err) { setError(err); }
            finally { setSaving(false); }
          }}
        >
          <label htmlFor="daily-budget">Set daily budget (USD)</label>
          <div className="dev-row">
            <input id="daily-budget" disabled={saving} type="number" min="0" step="1" placeholder={budget ? String(budget.budget_usd) : '25'}
              value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} />
            <button className="btn primary" type="submit" disabled={saving || error?.unconfirmed || budgetInput === ''}>Set</button>
          </div>
        </form></details>
      ) : null}

      <details><summary>Advanced spending details</summary>
      {!hasProject ? <p>Select or create a project space to view spending history and agent statistics.</p> : <>
      <RequestError error={statuses.spending?.error} subject="Loading spending history" onRetry={onRefresh} />
      <RequestError error={statuses.analytics?.error} subject="Loading agent statistics" onRetry={onRefresh} />
      {statuses.spending?.loading || statuses.analytics?.loading ? <p role="status">Loading spending details…</p> : null}
      {statuses.spending?.error || statuses.analytics?.error ? <p>Last known details may be out of date.</p> : null}
        <div className="mono spend-tokens">
          {budget ? `in ${budget.input_tokens} tok · out ${budget.output_tokens} tok` : ''}
        </div>
      {!spend && !statuses.spending?.loading ? <p>Spending history is unavailable. Use Check status to load it.</p> : null}
      {!analytics && !statuses.analytics?.loading ? <p>Agent statistics are unavailable.</p> : null}
      <h3>By month (workspace, all canvases)</h3>
      <table className="spend-table">
        <thead><tr><th>month</th><th>days</th><th>tokens</th><th>cost</th></tr></thead>
        <tbody>
          {(spend?.monthly || []).map((m) => (
            <tr key={m.month}>
              <td className="mono">{m.month}</td>
              <td className="mono">{m.days}</td>
              <td className="mono">{m.input_tokens}/{m.output_tokens}</td>
              <td className="mono">{fmtUSD(m.cost_usd)}</td>
            </tr>
          ))}
          {spend && !statuses.spending?.error && (spend.monthly || []).length === 0 ? (
            <tr><td colSpan="4" className="empty-hint">no spend recorded yet</td></tr>
          ) : null}
        </tbody>
      </table>

      <h3>This canvas</h3>
      <div className="mono spend-canvas">
        {spend?.canvasTotal
          ? `${fmtUSD(spend.canvasTotal.cost_usd)} · in ${spend.canvasTotal.input_tokens} / out ${spend.canvasTotal.output_tokens} tok`
          : spend && !statuses.spending?.error ? 'No spending recorded for this space' : 'Spending unavailable'}
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
          {spend && !statuses.spending?.error && (spend.perAgent || []).length === 0 ? (
            <tr><td colSpan="4" className="empty-hint">no agents</td></tr>
          ) : null}
        </tbody>
      </table>

      <h3>Agent analytics</h3>
      <table className="spend-table">
        <thead><tr><th>agent</th><th>finished/failed/stopped</th><th>average duration</th><th>open/total reviews</th><th>helpful/not helpful</th></tr></thead>
        <tbody>
          {(analytics?.perAgent || []).map((row) => {
            const esc = (analytics.escalations || []).find((e) => e.agent_id === row.agent_id);
            return (
              <tr key={row.agent_id}>
                <td>{row.name}</td>
                <td className="mono">{row.completed}/{row.failed}/{row.halted}</td>
                <td className="mono">{row.avg_duration_ms ? `${Math.round(row.avg_duration_ms / 1000)}s` : '—'}</td>
                <td className="mono">{esc ? `${esc.open}/${esc.total}` : '0/0'}</td>
                <td className="mono">{row.feedback_up || 0}/{row.feedback_down || 0}</td>
              </tr>
            );
          })}
          {analytics && !statuses.analytics?.error && (analytics.perAgent || []).length === 0 ? (
            <tr><td colSpan="5" className="empty-hint">no analytics yet</td></tr>
          ) : null}
        </tbody>
      </table>
      </>}
      </details>
    </Panel>
  );
}

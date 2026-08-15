import React, { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, short } from './api.js';
import { ContextReceipt } from './Panels.jsx';

// P1 Inquiry Home: the signed-in starting point. Ask the company without
// picking an agent; answer first, machinery second. Evidence chips,
// confidence (epistemic mix), conflicts, what-wasn't-found, freshness, and
// the full receipt one click away.

const SUGGESTED = [
  'What do we know about this account, and how fresh is it?',
  'Which deals have gone quiet in the last two weeks?',
  'What did we decide about our ICP scoring, and why?',
  'What renewals are coming up, and what risks do we know about?',
  'What has the team learned about our top competitor?',
];

const MODES = [
  { key: 'ask', label: 'Ask', hint: 'read-only — answer with evidence' },
  { key: 'act', label: 'Act', hint: 'normal run — may draft and hand off' },
  { key: 'rehearse', label: 'Rehearse', hint: 'dry run — narrates, changes nothing' },
];

const STATUS_COPY = {
  pending: 'working…',
  answered: 'answered',
  unanswered: 'no answer',
};

function AnswerCard({ inquiry, canvasId, agentsById, onOpenRun, toast }) {
  const [receipt, setReceipt] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const run = inquiry.run;

  useEffect(() => {
    if (!run || inquiry.status === 'pending') { setReceipt(null); return undefined; }
    let alive = true;
    api(`/api/canvases/${canvasId}/runs/${run.id}/receipt`)
      .then((r) => { if (alive) setReceipt(r); })
      .catch(() => { if (alive) setReceipt(null); });
    return () => { alive = false; };
  }, [canvasId, run && run.id, inquiry.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const agent = inquiry.agent;
  const cited = receipt ? receipt.cited : [];
  const conflicts = cited.filter((e) => e.tainted);
  const missing = receipt ? receipt.searches.filter((s) => s.results.length === 0) : [];
  const evidenceRefs = receipt ? receipt.evidence || [] : [];
  const epiCounts = cited.reduce((m, e) => { m[e.epistemic] = (m[e.epistemic] || 0) + 1; return m; }, {});

  return (
    <article className={`answer-card status-${inquiry.status}`} aria-label={`Inquiry: ${inquiry.question}`}>
      <div className="answer-q">
        <span className="answer-question">{inquiry.question}</span>
        <span className={`chip inq-${inquiry.status}`}>{STATUS_COPY[inquiry.status] || inquiry.status}</span>
        <span className="chip">{inquiry.mode}</span>
      </div>
      <div className="answer-meta mono">
        {agent ? <>{inquiry.selectionAuto ? 'auto-picked ' : ''}<span className="dot-inline" style={{ background: agent.color }} />{agent.name} ({agent.role})</> : null}
        {' · '}{timeAgo(inquiry.createdAt)}
      </div>

      {inquiry.status === 'pending' ? (
        <div className="answer-pending" role="status" aria-live="polite">The agent is working — the answer lands here.</div>
      ) : null}

      {inquiry.status === 'answered' && run ? (
        <div className="answer-body">{run.summary || '(completed without a summary)'}</div>
      ) : null}

      {inquiry.status === 'unanswered' && run ? (
        <div className="answer-body answer-fail">
          {run.status === 'refused' ? 'The model declined this request — rephrase it or handle it manually.'
            : run.status === 'halted_budget' ? 'The daily budget ran out mid-answer — retry after the budget resets or is raised.'
            : run.status === 'halted_timeout' || run.status === 'halted_steps' ? 'The run hit its budget before finishing — narrow the question or retry.'
            : `The run ${run.status}${run.error ? ` — ${short(run.error, 120)}` : ''}.`}
        </div>
      ) : null}

      {receipt ? (
        <>
          <div className="answer-chips">
            {evidenceRefs.map((r) => (
              <button key={r.id} className="chip evidence-chip" title={r.redacted ? 'source visible to the directing user only' : r.uri || r.sourceId}
                onClick={() => { if (r.uri && !r.redacted) window.open(r.uri, '_blank', 'noopener'); else setShowReceipt(true); }}>
                {r.sourceKind}{r.title ? ` · ${short(r.title, 30)}` : ''}
              </button>
            ))}
            {Object.entries(epiCounts).map(([epi, n]) => (
              <span key={epi} className={`chip epi-${epi}`}>{n} {epi}</span>
            ))}
            {conflicts.length ? <span className="chip conflict-chip">⚠ {conflicts.length} built on corrected info</span> : null}
          </div>
          {missing.length ? (
            <div className="answer-missing">
              Not found: {missing.map((s) => `“${short(s.query, 50)}”`).join(', ')} — memory has nothing on these yet.
            </div>
          ) : null}
          {receipt.cited.length === 0 && inquiry.status === 'answered' ? (
            <div className="answer-missing">This answer cites nothing — treat it as the agent's unsupported summary.</div>
          ) : null}
        </>
      ) : null}

      <div className="answer-actions">
        <button className="btn ghost small" aria-expanded={showReceipt} onClick={() => setShowReceipt(!showReceipt)}>
          {showReceipt ? 'Hide receipt' : 'Full receipt'}
        </button>
        {run && onOpenRun ? (
          <button className="btn ghost small" onClick={() => onOpenRun(run.agent_id || (agent && agent.id), run.id)}>Open run</button>
        ) : null}
      </div>
      {showReceipt && receipt ? <ContextReceipt receipt={receipt} onFeedback={null} /> : null}
    </article>
  );
}

export default function Home({ canvasId, agents, agentsById, paused, runTick, onOpenRun, toast }) {
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState('ask');
  const [agentOverride, setAgentOverride] = useState('');
  const [inquiries, setInquiries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);

  const load = useCallback(() => {
    if (!canvasId) return;
    api(`/api/canvases/${canvasId}/inquiries${savedOnly ? '?saved=1' : ''}`)
      .then((d) => setInquiries(d.inquiries || []))
      .catch((e) => toast(e.message));
  }, [canvasId, savedOnly, toast]);

  useEffect(() => { setInquiries(null); load(); }, [load]);
  // Live refresh: run_status events bump runTick in Workspace.
  useEffect(() => { if (runTick) load(); }, [runTick, load]);

  const submit = async (e, text) => {
    if (e) e.preventDefault();
    const q = (text || question).trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const body = { question: q, mode };
      if (agentOverride) body.agent_id = agentOverride;
      const d = await api(`/api/canvases/${canvasId}/inquiries`, { method: 'POST', body });
      setQuestion('');
      setInquiries((cur) => [d.inquiry, ...(cur || [])]);
      if (d.selection.auto && d.selection.echo) toast(d.selection.echo, 'ok');
    } catch (e2) {
      toast(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSaved = async (inq) => {
    try {
      const d = await api(`/api/inquiries/${inq.id}`, { method: 'PATCH', body: { saved: !inq.saved } });
      setInquiries((cur) => (cur || []).map((i) => (i.id === inq.id ? d.inquiry : i)));
    } catch (e) { toast(e.message); }
  };

  return (
    <div className="home-view">
      <div className="home-hero">
        <h1>Ask the company.</h1>
        <p className="home-sub">See the evidence. Assign the work. Approve the action.</p>
        <form className="home-ask" onSubmit={submit}>
          <label htmlFor="home-question" className="sr-only-label">Ask a question about the company</label>
          <textarea
            id="home-question"
            rows="2"
            value={question}
            placeholder="Ask anything — an agent is picked for you…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
          />
          <div className="home-ask-row">
            <div className="mode-switch" role="radiogroup" aria-label="Run mode">
              {MODES.map((m) => (
                <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
                  className={`btn ghost small ${mode === m.key ? 'lens-on' : ''}`} title={m.hint}
                  onClick={() => setMode(m.key)}>{m.label}</button>
              ))}
            </div>
            <select aria-label="Agent (optional override)" value={agentOverride} onChange={(e) => setAgentOverride(e.target.value)}>
              <option value="">auto-pick agent</option>
              {(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
            </select>
            <button className="btn primary" type="submit" disabled={busy || !question.trim() || paused}
              title={paused ? 'Workspace is paused' : undefined}>
              {busy ? 'Asking…' : 'Ask'}
            </button>
          </div>
        </form>
      </div>

      {inquiries !== null && inquiries.length === 0 && !savedOnly ? (
        <div className="home-suggested">
          <h2>Try asking</h2>
          {SUGGESTED.map((q) => (
            <button key={q} className="suggested-q" onClick={() => submit(null, q)} disabled={busy || paused}>{q}</button>
          ))}
        </div>
      ) : null}

      <div className="home-list">
        <div className="home-list-head">
          <h2>{savedOnly ? 'Saved answers' : 'Recent inquiries'}</h2>
          <button className="btn ghost small" aria-pressed={savedOnly} onClick={() => setSavedOnly(!savedOnly)}>
            {savedOnly ? 'Show all' : 'Saved only'}
          </button>
        </div>
        {inquiries === null ? <div className="empty-hint">loading…</div> : null}
        {(inquiries || []).map((inq) => (
          <div key={inq.id} className="home-item">
            <AnswerCard inquiry={inq} canvasId={canvasId} agentsById={agentsById} onOpenRun={onOpenRun} toast={toast} />
            <button className="btn ghost small save-btn" aria-pressed={inq.saved}
              onClick={() => toggleSaved(inq)}>{inq.saved ? '★ saved' : '☆ save'}</button>
          </div>
        ))}
        {inquiries !== null && inquiries.length === 0 && savedOnly ? (
          <div className="empty-hint">nothing saved yet — star an answer to keep it here</div>
        ) : null}
      </div>
    </div>
  );
}

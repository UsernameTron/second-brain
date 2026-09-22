import { choiceKeys } from './format.jsx';
import { sourceLabel, certaintyLabel, workStatusLabel } from './format.jsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, timeAgo, short } from './api.js';
import { useDraft } from './Drafts.jsx';
import { RequestError, useResource } from './RequestState.jsx';
import { ContextReceipt } from './Panels.jsx';
import { SummaryMarkdown, formatContractTail } from './format.jsx';

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
  'Prepare a pre-call brief for our most active account.',
  'Which target-list leads are enriched but not yet in HubSpot?',
  'Draft a LinkedIn post on AI readiness in CTG voice, gate-checked.',
];

const MODES = [
  { key: 'ask', label: 'Ask', hint: 'Research and answer; external records stay unchanged' },
  { key: 'act', label: 'Act', hint: 'Create drafts or stage changes for approval' },
  { key: 'rehearse', label: 'Rehearse', hint: 'dry run — narrates, changes nothing' },
];

const STATUS_COPY = {
  pending: 'working…',
  answered: 'answered',
  unanswered: 'no answer',
};

function AnswerCard({ inquiry, canvasId, agentsById, onOpenRun, onAct, onRevise, toast }) {
  const receiptState = useResource(() => !inquiry.run || inquiry.status === 'pending' ? Promise.resolve(null)
    : api(`/api/canvases/${canvasId}/runs/${inquiry.run.id}/receipt`), `${canvasId}:${inquiry.run?.id}:${inquiry.status}`);
  const receipt = receiptState.data;
  const [showReceipt, setShowReceipt] = useState(false);
  const run = inquiry.run;
  // Keep the exact submitted request available while presenting the follow-up
  // separately from the context envelope created by this composer.
  const contextMarker = '\n\nSelected answer for context (verify its claims before acting):\nQuestion: ';
  const contextAt = inquiry.mode === 'act' && inquiry.question.startsWith('Follow-up request: ') ? inquiry.question.indexOf(contextMarker) : -1;
  const title = contextAt > 0 ? inquiry.question.slice('Follow-up request: '.length, contextAt) : inquiry.question;

  const agent = inquiry.agent;
  const cited = receipt?.cited || [];
  const conflicts = cited.filter((e) => e.tainted);
  const missing = (receipt?.searches || []).filter((s) => s.results.length === 0);
  const evidenceRefs = receipt ? receipt.evidence || [] : [];
  const epiCounts = cited.reduce((m, e) => { m[e.epistemic] = (m[e.epistemic] || 0) + 1; return m; }, {});

  return (
    <article className={`answer-card status-${inquiry.status}`} aria-label={`Inquiry: ${title}`}>
      <div className="answer-q">
        <span className="answer-question">{title}</span>
        <span className={`chip inq-${inquiry.status}`}>{STATUS_COPY[inquiry.status] || inquiry.status}</span>
        <span className="chip">{{ ask: 'Ask', act: 'Act', rehearse: 'Practice (Rehearse)' }[inquiry.mode] || inquiry.mode}</span>
      </div>
      <div className="answer-meta mono">
        {agent ? <>{inquiry.selectionAuto ? 'Selected agent: ' : ''}<span className="dot-inline" style={{ background: agent.color }} />{agent.name} </> : null}
        {' · '}{timeAgo(inquiry.createdAt)}
      </div>

      {contextAt > 0 ? <details className="answer-context"><summary>Request and attached context</summary><div className="submitted-request">{inquiry.question}</div></details> : null}

      {inquiry.status === 'pending' ? (
        <div className="answer-pending" role="status" aria-live="polite">The agent is working — the answer lands here.</div>
      ) : null}

      {inquiry.status === 'answered' && run ? (
        <div className="answer-body">
          {/* Generic surface: contract text is humanized (meaning kept), never
              stripped — an answer that ends "MATCHED: 2" IS the answer. */}
          {run.summary
            ? <SummaryMarkdown text={formatContractTail(run.summary, 'humanize')} />
            : '(completed without a summary)'}
        </div>
      ) : null}

      {inquiry.status === 'unanswered' && run ? (
        <div className="answer-body answer-fail">
          {run.status === 'refused' ? 'The model declined this request — rephrase it or handle it manually.'
            : run.status === 'halted_budget' ? 'The daily budget ran out mid-answer — retry after the budget resets or is raised.'
            : run.status === 'halted_timeout' || run.status === 'halted_steps' ? 'The run hit its budget before finishing — narrow the question or retry.'
            : `The work did not finish: ${workStatusLabel(run.status)}. Open work details or revise your request.`}
        </div>
      ) : null}

      <RequestError error={receiptState.error} subject="Loading this answer's sources" onRetry={receiptState.refresh} />
      {receiptState.loading && inquiry.status !== 'pending' ? <p role="status">Loading sources…</p> : null}
      {receipt ? (
        <>
          <div className="answer-chips">
            {evidenceRefs.map((r) => (
              <button key={r.id} className="chip evidence-chip" title={r.redacted ? 'source visible to the directing user only' : r.uri || r.sourceId}
                onClick={() => { if (r.uri && !r.redacted) window.open(r.uri, '_blank', 'noopener'); else setShowReceipt(true); }}>
                {sourceLabel(r.sourceKind)}{r.title ? ` · ${short(r.title, 30)}` : ''}
              </button>
            ))}
            {Object.entries(epiCounts).map(([epi, n]) => (
              <span key={epi} className={`chip epi-${epi}`}>{n} {certaintyLabel(epi)}</span>
            ))}
            {conflicts.length ? <span className="chip conflict-chip">⚠ {conflicts.length} built on corrected info</span> : null}
          </div>
          {missing.length ? (
            <div className="answer-missing">
              Not found: {missing.map((s) => `“${short(s.query, 50)}”`).join(', ')} — memory has nothing on these yet.
            </div>
          ) : null}
          {cited.length === 0 && evidenceRefs.length === 0 && !(receipt.provided || []).length && !(receipt.searches || []).some((s) => s.results?.length) && inquiry.status === 'answered' ? (
            <div className="answer-missing">No supporting sources were recorded. Treat this answer as an unsupported summary and verify it before acting.</div>
          ) : null}
        </>
      ) : null}

      <div className="answer-actions">
        {onRevise && inquiry.status === 'unanswered' ? <button className="btn small" onClick={() => onRevise(inquiry)}>Revise request</button> : null}
        {onAct && inquiry.status === 'answered' && run?.summary ? <button className="btn primary small" onClick={() => onAct(inquiry)}>Act on this</button> : null}
        <button className="btn ghost small" aria-expanded={showReceipt} onClick={() => setShowReceipt(!showReceipt)}>
          {showReceipt ? 'Hide details' : 'Sources and details'}
        </button>
        {run && onOpenRun ? (
          <button className="btn ghost small" onClick={() => onOpenRun(run.agent_id || (agent && agent.id), run.id)}>View work</button>
        ) : null}
      </div>
      {showReceipt && receipt ? <ContextReceipt receipt={receipt} onFeedback={null} /> : null}
    </article>
  );
}

export default function Home({ canvasId, agents, agentsById, paused, runTick, onOpenRun, toast, editable = true, onUpload, uploadBusy, onAddAgent, submission, onSubmissionChange }) {
  const [question, setQuestion] = useDraft(`inquiry:${canvasId}:question`, '');
  const [mode, setMode] = useDraft(`inquiry:${canvasId}:mode`, 'ask');
  const [agentOverride, setAgentOverride] = useDraft(`inquiry:${canvasId}:agent`, '');
  const [inquiries, setInquiries] = useState(null);
  const [localSubmission, setLocalSubmission] = useState({ busy: false, error: null });
  const submissionState = submission || localSubmission;
  const updateSubmission = onSubmissionChange ? (update) => onSubmissionChange(canvasId, update) : setLocalSubmission;
  const busy = submissionState.busy;
  const sendError = submissionState.error;
  const setBusy = (value) => updateSubmission((current) => current.busy === value ? current : { ...current, busy: value });
  const setSendError = (value) => updateSubmission((current) => {
    const error = typeof value === 'function' ? value(current.error) : value;
    return current.error === error ? current : { ...current, error };
  });
  const [savedOnly, setSavedOnly] = useState(false);
  const [answerContext, setAnswerContext] = useDraft(`inquiry:${canvasId}:context`, null);
  const [moreExamples, setMoreExamples] = useState(false);
  const questionRef = useRef(null);
  const actOn = (inquiry) => { setAnswerContext({ question: inquiry.question, summary: inquiry.run.summary, runId: inquiry.run.id }); setMode('act'); questionRef.current?.focus(); };
  const withContext = (q) => answerContext ? `Follow-up request: ${q}\n\nSelected answer for context (verify its claims before acting):\nQuestion: ${answerContext.question}\nAnswer: ${answerContext.summary}` : q;
  const [loadError, setLoadError] = useState(null);
  const needsAgent = agents?.length === 0 || (sendError?.status === 409 && sendError.message === 'this canvas has no agents to ask');
  // A confirmed team refresh clears this prerequisite error after staffing.
  useEffect(() => {
    if (agents?.length) setSendError((error) => error?.status === 409 && error.message === 'this canvas has no agents to ask' ? null : error);
  }, [agents]);
  const [saveErrors, setSaveErrors] = useState({});
  const [saving, setSaving] = useState({});
  const active = useRef(canvasId);
  active.current = canvasId;
  useEffect(() => { active.current = canvasId; if (!onSubmissionChange) setLocalSubmission({ busy: false, error: null }); setSaving({}); setSaveErrors({}); return () => { active.current = null; loadSeq.current += 1; }; }, [canvasId]);

  // Overlapping loads (canvas switch, Saved Only toggle, runTick bursts) may
  // resolve out of order — only the latest request may write the list.
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    if (!canvasId) return;
    const seq = ++loadSeq.current;
    setLoadError(null);
    return api(`/api/canvases/${canvasId}/inquiries${savedOnly ? '?saved=1' : ''}`)
      .then((d) => { if (seq === loadSeq.current) setInquiries(d.inquiries || []); })
      .catch((e) => { if (seq === loadSeq.current) setLoadError(e); });
  }, [canvasId, savedOnly, toast]);
  const latestLoad = useRef(load);
  latestLoad.current = load;

  useEffect(() => { setInquiries(null); load(); }, [load]);
  // Live refresh: run_status events bump runTick in Workspace.
  useEffect(() => { if (runTick) load(); }, [runTick, load]);

  useEffect(() => {
    if (!inquiries?.some((item) => item.status === 'pending')) return;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, 5000);
    return () => clearInterval(timer);
  }, [inquiries, load]);

  const submit = async (e, text) => {
    if (e) e.preventDefault();
    const q = (text || question).trim();
    if (!q || busy || !editable || paused || needsAgent || sendError?.unconfirmed) return;
    const cid = canvasId;
    setBusy(true); setSendError(null);
    try {
      const body = { question: withContext(q), mode };
      if (agentOverride) body.agent_id = agentOverride;
      const d = await api(`/api/canvases/${canvasId}/inquiries`, { method: 'POST', body });
      if (active.current !== cid && !onSubmissionChange) return;
      setQuestion((current) => current.trim() === q ? '' : current);
      setAnswerContext((current) => current === answerContext ? null : current);
      if (active.current !== cid) return;
      loadSeq.current += 1;
      setInquiries((cur) => [d.inquiry, ...(cur || [])]);
      if (d.selection?.auto && d.selection.echo) toast(`${d.inquiry.agent?.name || 'An agent'} received your request.`, 'ok');
      // A fast run can finish before the POST response arrives. Its pending
      // snapshot must not win over the terminal event that was already read.
      await load();
    } catch (e2) {
      if (active.current === cid || onSubmissionChange) setSendError(e2);
    } finally {
      if (active.current === cid || onSubmissionChange) setBusy(false);
    }
  };

  const toggleSaved = async (inq) => {
    if (!editable || saving[inq.id]) return;
    const cid = canvasId;
    setSaving((s) => ({ ...s, [inq.id]: true }));
    setSaveErrors((s) => ({ ...s, [inq.id]: null }));
    try {
      const d = await api(`/api/inquiries/${inq.id}`, { method: 'PATCH', body: { saved: !inq.saved } });
      if (active.current !== cid) return;
      loadSeq.current += 1;
      setInquiries((cur) => (cur || []).map((i) => (i.id === inq.id ? d.inquiry : i)));
      // Reconcile using the CURRENT filter, including a toggle during this save.
      await latestLoad.current();
    } catch (e) { if (active.current === cid) setSaveErrors((s) => ({ ...s, [inq.id]: e })); }
    finally { if (active.current === cid) setSaving((s) => ({ ...s, [inq.id]: false })); }
  };

  const visibleInquiries = savedOnly && inquiries ? inquiries.filter((item) => item.saved) : inquiries;
  return (
    <div className="home-view">
      <div className="home-hero">
        <h1>Ask the company.</h1>
        <p className="home-sub">See the evidence. Assign the work. Approve the action.</p>
        {needsAgent ? <div className="request-error" role="status">
          <p>This project space needs an agent before it can answer questions or carry out work.</p>
          <p>{editable ? 'Your question stays here while you add an agent. Then choose Ask or Act to send it.' : 'Ask the project owner to add an agent.'}</p>
          {editable && onAddAgent ? <button type="button" className="btn small" onClick={onAddAgent}>Add agent</button> : editable ? <p>Open More → Team → Add agent.</p> : null}
        </div> : null}
        <RequestError error={needsAgent ? null : sendError} subject="Sending your request" onRetry={sendError?.unconfirmed ? async () => { await load(); } : () => submit(null)} retryLabel={sendError?.unconfirmed ? 'Check status' : 'Try again'}>
          {sendError?.unconfirmed ? <button className="btn small" onClick={() => setSendError(null)}>I checked the answers; keep editing</button> : null}
        </RequestError>
        {!editable ? <p>This project space is view only. Ask its owner for edit access to send or save work.</p> : null}
        <form className="home-ask" onSubmit={submit}>
          <label htmlFor="home-question" className="sr-only-label">Ask a question about the company</label>
          <textarea
            ref={questionRef}
            id="home-question"
            rows="2"
            disabled={!editable || busy}
            value={question}
            placeholder="Ask anything — an agent is picked for you…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
          />
          {answerContext ? <div className="answer-context"><strong>Answer attached to your follow-up</strong><button type="button" className="btn ghost small" onClick={() => setAnswerContext(null)}>Clear answer context</button><details open><summary>{answerContext.question}</summary><div>{answerContext.summary}</div></details></div> : null}
          <div className="home-ask-row">
            <div className="mode-switch" role="radiogroup" aria-label="Request purpose">
              {MODES.filter((m) => m.key !== 'rehearse').map((m) => (
                <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
                  className={`btn ghost small ${mode === m.key ? 'lens-on' : ''}`} title={m.hint}
                  onKeyDown={(e) => choiceKeys(e, ['ask', 'act'], mode, setMode)} onClick={() => setMode(m.key)}>{m.label}</button>
              ))}
            </div>
            <details className="composer-advanced"><summary>Advanced options</summary>
            <button type="button" role="radio" aria-checked={mode === 'rehearse'} className="btn ghost small" onClick={() => setMode('rehearse')}>Practice (Rehearse)</button>
            <select aria-label="Agent (optional override)" value={agentOverride} onChange={(e) => setAgentOverride(e.target.value)}>
              <option value="">auto-pick agent</option>
              {(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
            </select>
            </details>
            {editable && onUpload ? <button type="button" aria-label="Upload document" className="btn ghost small" disabled={uploadBusy} onClick={onUpload}>{uploadBusy ? 'Uploading…' : 'Add document'}</button> : null}
            <button className="btn primary" type="submit" disabled={busy || !question.trim() || paused || !editable || needsAgent || sendError?.unconfirmed}
              title={paused ? 'Workspace is paused' : undefined}>
              {busy ? 'Sending…' : mode === 'act' ? 'Act' : mode === 'rehearse' ? 'Practice' : 'Ask'}
            </button>
          </div>
        </form>
      </div>

      {inquiries !== null && inquiries.length === 0 && !savedOnly && !loadError ? (
        <div className="home-suggested">
          <h2>Try asking</h2>
          {SUGGESTED.slice(0, moreExamples ? SUGGESTED.length : 3).map((q) => (
            <button key={q} className="suggested-q" onClick={() => needsAgent ? setQuestion(q) : submit(null, q)} disabled={busy || paused || !editable || sendError?.unconfirmed}>{q}</button>
          ))}
          <button className="btn ghost small" onClick={() => setMoreExamples(!moreExamples)}>{moreExamples ? 'Fewer examples' : 'More examples'}</button>
        </div>
      ) : null}

      <div className="home-list">
        <div className="home-list-head">
          <h2>{savedOnly ? 'Saved answers' : 'Recent questions and actions'}</h2>
          <button className="btn ghost small" aria-pressed={savedOnly} onClick={() => setSavedOnly(!savedOnly)}>
            {savedOnly ? 'Show all' : 'Saved only'}
          </button>
        </div>
        <RequestError error={loadError} subject="Loading answers" onRetry={load} />
        {loadError && inquiries ? <p>Last known answers are shown. Refresh before acting on their status.</p> : null}
        {inquiries === null && !loadError ? <div className="empty-hint">Loading answers…</div> : null}
        {(visibleInquiries || []).map((inq) => (
          <div key={inq.id} className="home-item">
            <AnswerCard inquiry={inq} canvasId={canvasId} agentsById={agentsById} onOpenRun={onOpenRun} onRevise={editable ? (item) => { setQuestion(item.question); setMode(item.mode); questionRef.current?.focus(); } : null} onAct={editable ? actOn : null} toast={toast} />
            <RequestError error={saveErrors[inq.id]} subject="Saving this answer" onRetry={() => load()} retryLabel="Check saved answers" />
            <button disabled={!editable || saving[inq.id]} className="btn ghost small save-btn" aria-pressed={inq.saved}
              onClick={() => toggleSaved(inq)}>{inq.saved ? '★ saved' : '☆ save'}</button>
          </div>
        ))}
        {visibleInquiries !== null && visibleInquiries.length === 0 && savedOnly && !loadError ? (
          <div className="empty-hint">nothing saved yet — star an answer to keep it here</div>
        ) : null}
      </div>
    </div>
  );
}

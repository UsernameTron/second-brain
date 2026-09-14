import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useDraft } from './Drafts.jsx';
import { RequestError } from './RequestState.jsx';
import { SummaryMarkdown, formatContractTail, agentTierLabel } from './format.jsx';

// P4 plain-language agent builder: describe the job → review the proposed
// agent (every permission in plain language) → rehearse it → publish it.
// The server is the authority: the menu is registry-grounded, rehearsal
// gates publish, and publish is owner-only with an exact diff.

const TIER_HINT = { fast: 'routing and light work', strong: 'judgment-heavy work' };
const PUBLISHED_FIELDS = { name: 'Name', role: 'Job role', model_tier: 'Reasoning level', system_prompt: 'Instructions', tools_json: 'Permissions', step_budget: 'Maximum work steps', wall_ms_budget: 'Time limit (milliseconds)' };
const publishedValue = (field, value) => field === 'model_tier' && value != null ? agentTierLabel(value) : String(value);

function AuthorityList({ menu, granted, onToggle, disabled }) {
  return (
    <ul className="authority-list">
      {menu.map((m) => (
        <li key={m.name}>
          <label className="authority-line">
            <input type="checkbox" disabled={disabled} checked={granted.includes(m.name)} onChange={() => onToggle(m.name)} />
            <span className="mono authority-name">{m.name}</span>
            <span className="authority-desc">{m.description}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export default function AgentBuilder({ canvasId, isOwner, onPublished, toast }) {
  const [brief, setBrief] = useDraft(`builder:${canvasId}:brief`, '');
  const [draft, setDraft] = useDraft(`builder:${canvasId}:draft`, null);
  const [menu, setMenu] = useDraft(`builder:${canvasId}:menu`, []);
  const [rehearsal, setRehearsal] = useDraft(`builder:${canvasId}:rehearsal`, null);
  const [dirty, setDirty] = useDraft(`builder:${canvasId}:dirty`, false);
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (value) => { busyRef.current = value; setBusyState(value); };
  const [error, setError] = useState(null);
  const [pollError, setPollError] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const [recoverable, setRecoverable] = useState(null);
  const [publishResult, setPublishResult] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const generation = useRef(0);
  const current = useRef(draft);
  current.current = draft;
  const running = ['queued', 'running'].includes(rehearsal?.status);
  const blocked = busy || running || error?.unconfirmed;
  useEffect(() => {
    generation.current += 1; setBusy(false); setError(null); setPollError(null);
    return () => { generation.current += 1; };
  }, [canvasId]);
  useEffect(() => {
    if (!draft || !running || dirty) return;
    let cancelled = false;
    let timer;
    const id = draft.id;
    const check = async () => {
      try {
        const full = await api(`/api/agent-drafts/${id}`);
        if (cancelled || current.current?.id !== id) return;
        setPollError(null);
        if (full.rehearsalRun && !['queued', 'running'].includes(full.rehearsalRun.status)) {
          setRehearsal(full.rehearsalRun); setDraft(full.draft);
        } else timer = setTimeout(check, 1500);
      } catch (e) { if (!cancelled) setPollError(e); }
    };
    timer = setTimeout(check, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [draft?.id, running, dirty, pollTick]);
  const perform = async (operation, apply) => {
    if (busyRef.current || error?.unconfirmed) return false;
    const token = generation.current;
    setBusy(true); setError(null);
    try {
      const result = await operation();
      if (generation.current !== token) return false;
      apply(result); return true;
    } catch (e) { if (generation.current === token) setError(e); return false; }
    finally { if (generation.current === token) setBusy(false); }
  };
  const propose = () => {
    if (!brief.trim() || running) return;
    return perform(() => api('/api/agent-drafts/propose', { method: 'POST', body: { canvas_id: canvasId, brief: brief.trim(), draft_id: draft ? draft.id : undefined } }), (d) => {
      setDraft(d.draft); setMenu(d.menu); setRehearsal(null); setDirty(false); setPublishResult(null); setWarnings(d.warnings || []);
      if (d.dropped?.length) toast(`Permissions unavailable: ${d.dropped.join(', ')}`, 'warn');
    });
  };
  const saveProposal = (proposal, force = false) => {
    if ((!dirty && !force) || running) return;
    return perform(() => api(`/api/agent-drafts/${draft.id}`, { method: 'PATCH', body: { proposal } }), (d) => {
      setDraft(d.draft); setWarnings(d.warnings || []); setRehearsal(null); setDirty(false);
    });
  };
  const setField = (field, value) => {
    const proposal = { ...draft.proposal, [field]: value };
    setDraft({ ...draft, proposal, state: 'draft' }); setDirty(true); setRehearsal(null);
    return proposal;
  };
  const toggleAuthority = (name) => {
    if (blocked) return;
    const granted = draft.proposal.authority || [];
    saveProposal(setField('authority', granted.includes(name) ? granted.filter((n) => n !== name) : [...granted, name]), true);
  };
  const rehearse = () => {
    if (running) return;
    return perform(async () => {
      // Saving and dispatching share one lock. Any failed save ends the flow.
      const saved = await api(`/api/agent-drafts/${draft.id}`, { method: 'PATCH', body: { proposal: draft.proposal } });
      if (current.current?.id !== draft.id) return null;
      return api(`/api/agent-drafts/${draft.id}/rehearse`, { method: 'POST', body: {} });
    }, (d) => { if (d) { setDraft(d.draft); setDirty(false); setRehearsal(d.run || { status: 'queued' }); } });
  };
  const publish = () => perform(() => api(`/api/agent-drafts/${draft.id}/publish`, { method: 'POST', body: { save_as_template: saveTemplate } }), (d) => {
    setPublishResult(d); setDraft(null); setRehearsal(null); setDirty(false); toast(`${d.agent.name} is published`, 'ok'); onPublished();
  });
  const checkStatus = async () => {
    const token = generation.current;
    try {
      if (draft) {
        const full = await api(`/api/agent-drafts/${draft.id}`);
        if (token !== generation.current) return;
        if (!dirty) { setDraft(full.draft); setRehearsal(full.rehearsalRun); }
        else { setDraft((cur) => ({ ...full.draft, proposal: cur.proposal, state: 'draft' })); setRehearsal(null); }
      } else {
        const full = await api(`/api/canvases/${canvasId}/agent-drafts`);
        if (token !== generation.current) return;
        setRecoverable(full.drafts || []); setMenu(full.menu || []);
      }
      setError(null); setPollError(null); setPollTick((n) => n + 1);
    } catch (e) { if (token === generation.current) setError(e); }
  };
  const recovery = <><RequestError error={error} subject="Saving this agent" onRetry={checkStatus} retryLabel="Check saved status" />
    <RequestError error={pollError} subject="Checking the rehearsal" onRetry={() => { setPollError(null); setPollTick((n) => n + 1); }} retryLabel="Check status" />
    {dirty ? <p>Your edits are not saved yet. Save changes, then rehearse before publishing.</p> : null}</>;
  const startOver = () => { generation.current += 1; current.current = null; setDraft(null); setRehearsal(null); setDirty(false); setError(null); setPollError(null); setBusy(false); };
  if (publishResult) {
    return (
      <div className="builder-flow">
        <h3>Published</h3>
        <p><b>{publishResult.agent.name}</b> is now active. What changed:</p>
        <ul className="room-list">
          {Object.entries(publishResult.diff).map(([field, d]) => (
            <li key={field}><span className="chip">{PUBLISHED_FIELDS[field] || field.replaceAll('_', ' ')}</span> <span className="dim">{d.from == null ? '(new)' : publishedValue(field, d.from).slice(0, 60)} → </span>{publishedValue(field, d.to).slice(0, 80)}</li>
          ))}
        </ul>
        <details><summary>Full change details</summary><pre className="published-change-details">{JSON.stringify(publishResult.diff, null, 2)}</pre></details>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="builder-flow">
        {recovery}
        {recoverable ? <div><p>Saved proposals. Open one to check whether your request was accepted.</p>{recoverable.length === 0 ? <p>No saved proposals found.</p> : recoverable.map((item) => <button className="btn small" key={item.id} onClick={() => { setDraft(item); setRecoverable(null); setRehearsal(null); }}>{item.proposal?.name || item.brief}</button>)}</div> : null}
        <p className="dim">Describe the job in plain language. You will review every permission before anything runs.</p>
        <textarea rows="4" value={brief} placeholder="e.g. Watch inbound deals and flag any that match our ICP, with evidence…"
          onChange={(e) => setBrief(e.target.value)} aria-label="Describe the job" />
        <button className="btn primary" disabled={blocked || !brief.trim()} onClick={propose}>
          {busy ? 'Proposing…' : 'Propose agent'}
        </button>
      </div>
    );
  }

  const p = draft.proposal;
  const rehearsed = !dirty && !error && draft.state === 'rehearsed' && rehearsal?.status === 'completed';
  return (
    <div className="builder-flow">
      {recovery}
      <div className="builder-head">
        <b>{p.name}</b> <span className="chip">{p.role}</span> <span className={`chip tier-${p.model_tier}`}>{agentTierLabel(p.model_tier)} — {TIER_HINT[p.model_tier]}</span>
        <button className="btn ghost small" onClick={startOver}>← start over</button>
      </div>
      {warnings.length ? (
        <div className="builder-warnings" role="alert">
          <b>Review these lines before publishing:</b>
          <ul>{warnings.map((w, i) => <li key={i}><span className="chip">{w.field.replace(/_/g, ' ')}</span> {w.warning}</li>)}</ul>
        </div>
      ) : null}
      <section><h4>Business purpose</h4><p>{p.business_purpose}</p></section>
      <section><h4>Inputs → outputs</h4><p>{p.inputs} → {p.outputs}</p></section>
      <section>
        <h4>Operating instructions</h4>
        <textarea rows="4" disabled={blocked} value={p.operating_instructions} aria-label="Operating instructions"
          onChange={(e) => setField('operating_instructions', e.target.value)}
          onBlur={() => saveProposal(draft.proposal)} />
      </section>
      <section>
        <h4>Escalates to a human when</h4>
        <textarea rows="2" disabled={blocked} value={p.escalation_conditions} aria-label="Escalation conditions"
          onChange={(e) => setField('escalation_conditions', e.target.value)}
          onBlur={() => saveProposal(draft.proposal)} />
      </section>
      <section>
        <h4>Authority — every permission this agent will hold</h4>
        <p className="dim">Checked = granted. Nothing outside this list is ever offered to the agent, and unchecking here removes it everywhere.</p>
        <AuthorityList disabled={blocked} menu={menu} granted={p.authority || []} onToggle={toggleAuthority} />
      </section>
      <section>
        <h4>Budgets</h4>
        <label>steps <input type="number" disabled={blocked} min="1" max="64" value={p.step_budget}
          onChange={(e) => setField('step_budget', Number(e.target.value))} onBlur={() => saveProposal(draft.proposal)} /></label>
        <label> time (minutes) <input type="number" disabled={blocked} min="1" max="30" value={Math.round(p.wall_ms_budget / 60000)}
          onChange={(e) => setField('wall_ms_budget', Number(e.target.value) * 60000)} onBlur={() => saveProposal(draft.proposal)} /></label>
      </section>

      {rehearsal ? (
        <section className="rehearsal-block">
          <h4>Rehearsal {rehearsal.status === 'running' ? '— running…' : `— ${rehearsal.status}`}</h4>
          {rehearsal.summary ? (
            <SummaryMarkdown className="rehearsal-summary" text={formatContractTail(rehearsal.summary, 'humanize')} />
          ) : null}
          {rehearsal.error ? <p className="answer-fail">{rehearsal.error}</p> : null}
        </section>
      ) : null}

      <div className="canvas-new-actions">
        {dirty ? <button className="btn small" disabled={blocked} onClick={() => saveProposal(draft.proposal)}>Save changes</button> : null}
        <button className="btn ghost small" disabled={blocked} onClick={propose} title="Regenerate from the same brief">Re-propose</button>
        <button className="btn primary small" disabled={blocked} onClick={rehearse}>
          {running ? 'Rehearsing…' : 'Rehearse'}
        </button>
        {isOwner ? (
          <>
            <label className="chip staff-chip"><input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} /> save as template</label>
            <button className="btn primary small" disabled={blocked || !rehearsed} onClick={publish}
              title={rehearsed ? 'Make it live' : 'Rehearse first — the rehearsal is the review'}>
              Publish
            </button>
          </>
        ) : <span className="dim">Publishing needs the owner.</span>}
      </div>
    </div>
  );
}

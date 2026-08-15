import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// P4 plain-language agent builder: describe the job → review the proposed
// agent (every permission in plain language) → rehearse it → publish it.
// The server is the authority: the menu is registry-grounded, rehearsal
// gates publish, and publish is owner-only with an exact diff.

const TIER_HINT = { fast: 'routing and light work', strong: 'judgment-heavy work' };

function AuthorityList({ menu, granted, onToggle }) {
  return (
    <ul className="authority-list">
      {menu.map((m) => (
        <li key={m.name}>
          <label className="authority-line">
            <input type="checkbox" checked={granted.includes(m.name)} onChange={() => onToggle(m.name)} />
            <span className="mono authority-name">{m.name}</span>
            <span className="authority-desc">{m.description}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export default function AgentBuilder({ canvasId, isOwner, onPublished, toast }) {
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [menu, setMenu] = useState([]);
  const [rehearsal, setRehearsal] = useState(null); // run row or null
  const [publishResult, setPublishResult] = useState(null);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const propose = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    try {
      const d = await api('/api/agent-drafts/propose', { method: 'POST', body: { canvas_id: canvasId, brief: brief.trim(), draft_id: draft ? draft.id : undefined } });
      setDraft(d.draft);
      setMenu(d.menu);
      setRehearsal(null);
      setPublishResult(null);
      if (d.dropped.length) toast(`Dropped ungrantable authority: ${d.dropped.join(', ')}`, 'warn');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const saveProposal = async (proposal) => {
    try {
      const d = await api(`/api/agent-drafts/${draft.id}`, { method: 'PATCH', body: { proposal } });
      setDraft(d.draft);
      setRehearsal(null); // any edit resets the rehearsal gate
    } catch (e) { toast(e.message); }
  };

  const setField = (field, value) => {
    const p = { ...draft.proposal, [field]: value };
    setDraft({ ...draft, proposal: p, state: 'draft' });
    return p;
  };

  const toggleAuthority = (name) => {
    const cur = draft.proposal.authority || [];
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    saveProposal(setField('authority', next));
  };

  const rehearse = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Persist any local text edits first so what rehearses is what publishes.
      await saveProposal(draft.proposal);
      const d = await api(`/api/agent-drafts/${draft.id}/rehearse`, { method: 'POST', body: {} });
      setDraft(d.draft);
      setRehearsal({ status: 'running' });
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const full = await api(`/api/agent-drafts/${draft.id}`);
          if (full.rehearsalRun && !['queued', 'running'].includes(full.rehearsalRun.status)) {
            clearInterval(pollRef.current);
            setRehearsal(full.rehearsalRun);
            setDraft(full.draft);
          }
        } catch { /* keep polling */ }
      }, 1500);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api(`/api/agent-drafts/${draft.id}/publish`, { method: 'POST', body: { save_as_template: saveTemplate } });
      setPublishResult(d);
      toast(`${d.agent.name} is live with ${JSON.parse(d.agent.tools_json).length} granted permissions`, 'ok');
      onPublished();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  if (publishResult) {
    return (
      <div className="builder-flow">
        <h3>Published</h3>
        <p><b>{publishResult.agent.name}</b> is now active. What changed:</p>
        <ul className="room-list">
          {Object.entries(publishResult.diff).map(([field, d]) => (
            <li key={field}><span className="chip">{field}</span> <span className="dim">{String(d.from ?? '(new)').slice(0, 60)} → </span>{String(d.to).slice(0, 80)}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="builder-flow">
        <p className="dim">Describe the job in plain language. You will review every permission before anything runs.</p>
        <textarea rows="4" value={brief} placeholder="e.g. Watch inbound deals and flag any that match our ICP, with evidence…"
          onChange={(e) => setBrief(e.target.value)} aria-label="Describe the job" />
        <button className="btn primary" disabled={busy || !brief.trim()} onClick={propose}>
          {busy ? 'Proposing…' : 'Propose agent'}
        </button>
      </div>
    );
  }

  const p = draft.proposal;
  const rehearsed = draft.state === 'rehearsed' && rehearsal && rehearsal.status === 'completed';
  return (
    <div className="builder-flow">
      <div className="builder-head">
        <b>{p.name}</b> <span className="chip">{p.role}</span> <span className={`chip tier-${p.model_tier}`}>{p.model_tier} — {TIER_HINT[p.model_tier]}</span>
        <button className="btn ghost small" onClick={() => { setDraft(null); setRehearsal(null); }}>← start over</button>
      </div>
      <section><h4>Business purpose</h4><p>{p.business_purpose}</p></section>
      <section><h4>Inputs → outputs</h4><p>{p.inputs} → {p.outputs}</p></section>
      <section>
        <h4>Operating instructions</h4>
        <textarea rows="4" value={p.operating_instructions} aria-label="Operating instructions"
          onChange={(e) => setField('operating_instructions', e.target.value)}
          onBlur={() => saveProposal(draft.proposal)} />
      </section>
      <section>
        <h4>Escalates to a human when</h4>
        <textarea rows="2" value={p.escalation_conditions} aria-label="Escalation conditions"
          onChange={(e) => setField('escalation_conditions', e.target.value)}
          onBlur={() => saveProposal(draft.proposal)} />
      </section>
      <section>
        <h4>Authority — every permission this agent will hold</h4>
        <p className="dim">Checked = granted. Nothing outside this list is ever offered to the agent, and unchecking here removes it everywhere.</p>
        <AuthorityList menu={menu} granted={p.authority || []} onToggle={toggleAuthority} />
      </section>
      <section>
        <h4>Budgets</h4>
        <label>steps <input type="number" min="1" max="64" value={p.step_budget}
          onChange={(e) => setField('step_budget', Number(e.target.value))} onBlur={() => saveProposal(draft.proposal)} /></label>
        <label> time (minutes) <input type="number" min="1" max="30" value={Math.round(p.wall_ms_budget / 60000)}
          onChange={(e) => setField('wall_ms_budget', Number(e.target.value) * 60000)} onBlur={() => saveProposal(draft.proposal)} /></label>
      </section>

      {rehearsal ? (
        <section className="rehearsal-block">
          <h4>Rehearsal {rehearsal.status === 'running' ? '— running…' : `— ${rehearsal.status}`}</h4>
          {rehearsal.summary ? <p className="rehearsal-summary">{rehearsal.summary}</p> : null}
          {rehearsal.error ? <p className="answer-fail">{rehearsal.error}</p> : null}
        </section>
      ) : null}

      <div className="canvas-new-actions">
        <button className="btn ghost small" disabled={busy} onClick={propose} title="Regenerate from the same brief">Re-propose</button>
        <button className="btn primary small" disabled={busy} onClick={rehearse}>
          {rehearsal && rehearsal.status === 'running' ? 'Rehearsing…' : 'Rehearse'}
        </button>
        {isOwner ? (
          <>
            <label className="chip staff-chip"><input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} /> save as template</label>
            <button className="btn primary small" disabled={busy || !rehearsed} onClick={publish}
              title={rehearsed ? 'Make it live' : 'Rehearse first — the rehearsal is the review'}>
              Publish
            </button>
          </>
        ) : <span className="dim">Publishing needs the owner.</span>}
      </div>
    </div>
  );
}

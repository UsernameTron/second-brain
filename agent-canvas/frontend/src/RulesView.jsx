import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rulesApi, timeAgo, short } from './api.js';

// P5 Rules & Briefs: a standing rule is a stored instruction + a persisted
// authorization. Describe it in plain language → review the interpretation
// (every field, plain words) → rehearse (see what WOULD have matched) →
// owner activates. Runs land here as history; briefs render their markdown.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKLY_BRIEF_TEMPLATE = 'Prepare my weekly operating brief every Monday morning: what moved, what is stuck, what needs attention, and what to expect this week — with sources for every claim and explicit uncertainty where the evidence is thin.';

// Server rows may carry JSON columns as strings or already-parsed objects.
function fromJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
}

function cadenceLabel(rule) {
  if (rule.cadence === 'hourly') return 'every hour';
  const hh = `${String(rule.cadence_hour ?? 8).padStart(2, '0')}:00 UTC`;
  if (rule.cadence === 'weekly') return `weekly on ${DAY_NAMES[rule.cadence_day ?? 1] || 'Monday'} at ${hh}`;
  return `daily at ${hh}`;
}

function fmtWhen(ts) {
  if (!ts) return null;
  return `${String(ts).slice(0, 16).replace('T', ' ')} UTC`;
}

// ponytail: headings, bullets, bold, paragraphs — the subset briefs actually
// use. Everything renders as React text nodes (no HTML injection); add a real
// renderer if briefs ever need tables or links.
function boldSpans(text) {
  const parts = String(text).split(/\*\*([^*]+)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
}

function BriefMarkdown({ text }) {
  const blocks = [];
  let list = null;
  const flush = () => {
    if (list) { blocks.push(<ul key={`l${blocks.length}`} className="room-list">{list}</ul>); list = null; }
  };
  String(text || '').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (/^[-*]\s+/.test(t)) { (list = list || []).push(<li key={i}>{boldSpans(t.replace(/^[-*]\s+/, ''))}</li>); return; }
    flush();
    if (!t) return;
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) blocks.push(React.createElement(`h${Math.min(6, h[1].length + 3)}`, { key: i }, boldSpans(h[2])));
    else blocks.push(<p key={i}>{boldSpans(t)}</p>);
  });
  flush();
  return <div className="brief-markdown">{blocks}</div>;
}

// Evidence refs arrive as server/evidence.js rowToRef objects
// ({ id, sourceKind, title, uri, … }); plain strings are tolerated.
function refLabel(r) {
  if (typeof r === 'string') return r;
  return r.title || r.uri || r.id || r.sourceKind || 'ref';
}

function RefsFooter({ refs: raw }) {
  const refs = fromJson(raw, []);
  if (!Array.isArray(refs) || refs.length === 0) return null;
  return <p className="dim mono">Evidence: {refs.map(refLabel).join(' · ')}</p>;
}

// The 10-field plain-language review card: watched / sources / scope /
// cadence / owner / output / budget / expiry / can-cannot / next-run.
function InterpretationCard({ rule, agentsById }) {
  // ruleView() sends the parsed `interpretation` alongside the raw column.
  const interp = fromJson(rule.interpretation ?? rule.interpretation_json, {});
  const agent = agentsById[interp.agent_id || rule.agent_id];
  const can = interp.can || [];
  const cannot = interp.cannot || [];
  // Activation grants exactly interpretation.expires_days (server default 90) —
  // the card must state the authority that will actually be granted.
  const expiryDays = Number.isInteger(interp.expires_days) ? interp.expires_days : 90;
  return (
    <section className="room-section">
      <h3>What this rule means</h3>
      <ul className="room-list">
        <li><b>Watched</b> — <span>{interp.summary || short(rule.instruction, 120)}</span></li>
        <li><b>Sources</b> — <span>{(interp.sources || []).join(', ') || '—'}</span></li>
        <li><b>Scope</b> — <span>{interp.scope || '—'}</span></li>
        <li><b>Cadence</b> — <span>{cadenceLabel(rule)}</span></li>
        <li><b>Run by</b> — <span>{`${agent ? `${agent.name} (${agent.role})` : (interp.agent_id || rule.agent_id || '—')}, owned by ${rule.owner_email}`}</span></li>
        <li><b>Output</b> — <span>{rule.output_type === 'brief' ? 'a written brief with sources' : 'an alert, only when something matches'}</span></li>
        <li><b>Budget</b> — <span>{`${rule.step_budget != null ? `${rule.step_budget} steps` : 'default steps'} · ${rule.wall_ms_budget != null ? `${Math.round(rule.wall_ms_budget / 60000)} min` : 'default time'} per run`}</span></li>
        <li><b>Expires</b> — <span>{rule.expires_at ? fmtWhen(rule.expires_at) : `${expiryDays} days after activation`}</span></li>
        <li><b>Can</b> — <span>{can.join('; ') || '—'}</span> · <b>Cannot</b> — <span>{cannot.join('; ') || '—'}</span></li>
        <li><b>Next run</b> — <span>{rule.next_run_at ? fmtWhen(rule.next_run_at) : 'computed at activation'}</span></li>
      </ul>
    </section>
  );
}

// standing_rule_runs.state — its own vocabulary (pending/skipped don't exist on
// agent runs), but the run-* chip colors already carry these meanings, so map
// onto them instead of inventing a second palette.
const RUN_STATE_CHIP = {
  pending: 'run-queued', running: 'run-running', completed: 'run-completed',
  failed: 'run-failed', skipped: 'run-halted',
};

function RunHistory({ runs, outputType }) {
  return (
    <section className="room-section">
      <h3>Run history<span className="chip">{runs.length}</span></h3>
      {runs.length === 0 ? <p className="dim">No runs yet — runs appear here after activation.</p> : (
        <ul className="room-list">
          {runs.map((r) => (
            <li key={r.id}>
              <span className={`chip ${RUN_STATE_CHIP[r.state] || ''}`}>{r.state}</span>
              <span className="mono dim"> {r.occurrence_key}</span>
              {r.matched_count != null ? <span className="chip">{r.matched_count} matched</span> : null}
              {r.skip_reason ? <span className="dim"> skipped: {r.skip_reason}</span> : null}
              {r.error ? <span className="answer-fail"> {r.error}</span> : null}
              <span className="dim mono"> · {timeAgo(r.created_at)}</span>
              {r.result_summary ? (
                outputType === 'brief'
                  ? <BriefMarkdown text={r.result_summary} />
                  : <p>{r.result_summary}</p>
              ) : null}
              <RefsFooter refs={r.output_refs ?? r.output_refs_json} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function RulesView({ user, canvasId, agents, toast, focusRuleId = null }) {
  const isOwner = user.role === 'owner';
  const [rulesList, setRulesList] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [parseError, setParseError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null); // { rule, authorization, runs, rehearsalRun }
  const savedInstructionRef = useRef('');

  // Dispatching a rehearsal returns as soon as the run is queued — the run
  // itself is still in flight, and the server has already flipped the rule to
  // `rehearsed`. So "is a rehearsal pending?" is the run's state, never the
  // request's. It gates the poll below AND the Rehearse button, so repeated
  // clicks can't launch concurrent runs (the server's 409 is the backstop).
  const ruleId = detail?.rule?.id || null;
  const rehearsalPending = ['queued', 'running'].includes(detail?.rehearsalRun?.status);
  useEffect(() => {
    if (!ruleId || !rehearsalPending) return undefined;
    const t = setInterval(async () => {
      try {
        const full = await rulesApi.get(ruleId);
        if (!['queued', 'running'].includes(full.rehearsalRun?.status)) {
          savedInstructionRef.current = full.rule.instruction;
          setDetail((cur) => ({ ...cur, ...full }));
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [ruleId, rehearsalPending]);

  const agentsById = useMemo(() => {
    const m = {};
    for (const a of agents || []) m[a.id] = a;
    return m;
  }, [agents]);

  const loadList = useCallback(() => {
    rulesApi.list(canvasId).then((d) => setRulesList(d.rules || [])).catch((e) => toast(e.message));
  }, [canvasId, toast]);
  useEffect(() => { loadList(); }, [loadList]);

  const showDetail = useCallback((d) => {
    savedInstructionRef.current = d.rule.instruction;
    setDetail({ runs: [], authorization: null, rehearsalRun: null, ...d });
  }, []);

  const openRule = useCallback((id) => {
    Promise.all([rulesApi.get(id), rulesApi.runs(id)])
      .then(([d, h]) => showDetail({ ...d, runs: h.runs || d.runs || [] }))
      .catch((e) => toast(e.message));
  }, [showDetail, toast]);

  // Deep link from a NEEDS YOU rule card: land on that rule's detail — where the
  // full brief and its evidence refs are — instead of the list. Workspace
  // unmounts this view on every switch, so mount is the only entry point.
  useEffect(() => { if (focusRuleId) openRule(focusRuleId); }, [focusRuleId, openRule]);

  const interpret = async (e) => {
    e.preventDefault();
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setParseError(null);
    try {
      const d = await rulesApi.parse(canvasId, instruction.trim());
      setInstruction('');
      loadList();
      showDetail({ rule: d.rule });
    } catch (e2) { setParseError(e2.message); } finally { setBusy(false); }
  };

  // Any real edit resets the rehearsal gate server-side; a no-op blur must not.
  const saveInstruction = async () => {
    const r = detail.rule;
    if (r.instruction === savedInstructionRef.current) return;
    try {
      const d = await rulesApi.update(r.id, { instruction: r.instruction });
      savedInstructionRef.current = d.rule.instruction;
      setDetail((cur) => ({ ...cur, rule: d.rule, rehearsalRun: null }));
      loadList();
    } catch (e) { toast(e.message); }
  };

  const rehearse = async () => {
    if (busy || rehearsalPending) return;
    setBusy(true);
    try {
      const id = detail.rule.id;
      const d = await rulesApi.rehearse(id);
      // Marking the run pending is what starts the poll and holds the button;
      // the poll replaces this optimistic marker with the server's real run.
      setDetail((cur) => ({ ...cur, rule: d.rule, rehearsalRun: { status: 'running' } }));
    } catch (e) {
      // 409 = the server's backstop: a rehearsal is already in flight and this
      // client didn't know. Re-read the run so the button reflects reality.
      if (e.status === 409) {
        rulesApi.get(detail.rule.id)
          .then((full) => setDetail((cur) => ({ ...cur, rehearsalRun: full.rehearsalRun })))
          .catch(() => {});
      }
      toast(e.status === 409 ? 'A rehearsal is already running — wait for it to finish' : e.message);
    } finally { setBusy(false); }
  };

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await rulesApi.activate(detail.rule.id);
      setDetail((cur) => ({ ...cur, rule: d.rule, authorization: d.authorization || cur.authorization }));
      loadList();
      toast('Rule is active — it runs on its cadence from here', 'ok');
    } catch (e) {
      toast(e.status === 409 ? 'Rehearse first — activation needs a completed rehearsal' : e.message);
    } finally { setBusy(false); }
  };

  const ceremony = (action, okMsg) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await rulesApi[action](detail.rule.id);
      setDetail((cur) => ({ ...cur, rule: d.rule }));
      loadList();
      toast(okMsg, 'ok');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  if (detail) {
    const rule = detail.rule;
    const rehearsal = detail.rehearsalRun;
    const rehearsed = rule.state === 'rehearsed' && rehearsal && rehearsal.status === 'completed';
    const editable = !['revoked', 'expired'].includes(rule.state);
    return (
      <div className="rooms-view">
        <div className="room-head">
          <button className="btn ghost small" onClick={() => { setDetail(null); loadList(); }}>← Rules</button>
          <h1>{short(rule.instruction, 60)}</h1>
          <span className={`chip rule-${rule.state}`}>{rule.state}</span>
          <span className="chip">{rule.output_type}</span>
          <span className="dim mono">{cadenceLabel(rule)}</span>
        </div>
        {detail.authorization ? (
          <p className="dim">
            Authorized by <span className="mono">{detail.authorization.authorized_by}</span>
            {detail.authorization.expires_at ? ` · expires ${fmtWhen(detail.authorization.expires_at)}` : ''}
            {detail.authorization.revoked_at ? ' · revoked' : ''}
          </p>
        ) : null}
        <div className="builder-flow">
          {editable ? (
            <section>
              <h4>Instruction</h4>
              <textarea rows="3" value={rule.instruction} aria-label="Rule instruction"
                onChange={(e) => setDetail((cur) => ({ ...cur, rule: { ...cur.rule, instruction: e.target.value } }))}
                onBlur={saveInstruction} />
              <p className="dim">Editing resets the rule to draft — rehearse again before it can activate.</p>
            </section>
          ) : null}
          <InterpretationCard rule={rule} agentsById={agentsById} />
          {rehearsal ? (
            <section className="rehearsal-block">
              <h4>Rehearsal {rehearsal.status === 'running' ? '— running…' : `— ${rehearsal.status}`}</h4>
              {rehearsal.status === 'running' ? <p className="dim">Checking recent data for what WOULD have matched — nothing changes.</p> : null}
              {rehearsal.summary ? <p className="rehearsal-summary">{rehearsal.summary}</p> : null}
              {rehearsal.error ? <p className="answer-fail">{rehearsal.error}</p> : null}
            </section>
          ) : null}
          <div className="canvas-new-actions">
            {editable && ['draft', 'rehearsed'].includes(rule.state) ? (
              <button className="btn primary small" disabled={busy || rehearsalPending} onClick={rehearse}
                title={rehearsalPending ? 'A rehearsal is already running' : 'See what WOULD have matched — nothing changes'}>
                {rehearsalPending ? 'Rehearsing…' : 'Rehearse'}
              </button>
            ) : null}
            {isOwner && ['draft', 'rehearsed'].includes(rule.state) ? (
              <button className="btn primary small" disabled={busy || !rehearsed} onClick={activate}
                title={rehearsed ? 'Make it live on its cadence' : 'Rehearse first — the rehearsal is the review'}>
                Activate
              </button>
            ) : null}
            {!isOwner && ['draft', 'rehearsed'].includes(rule.state) ? <span className="dim">Activation needs the owner.</span> : null}
            {isOwner && rule.state === 'active' ? (
              <button className="btn ghost small" disabled={busy} onClick={ceremony('pause', 'Rule paused')}>Pause</button>
            ) : null}
            {isOwner && rule.state === 'paused' ? (
              <button className="btn ok small" disabled={busy} onClick={ceremony('resume', 'Rule resumed')}>Resume</button>
            ) : null}
            {isOwner && editable ? (
              <button className="btn danger small" disabled={busy} onClick={ceremony('revoke', 'Rule revoked — the authorization is gone')}
                title="Revokes the standing authorization — nothing runs again">
                Revoke
              </button>
            ) : null}
          </div>
          <RunHistory runs={detail.runs || []} outputType={rule.output_type} />
        </div>
      </div>
    );
  }

  return (
    <div className="rooms-view">
      <div className="home-hero">
        <h1>Rules &amp; Briefs</h1>
        <p className="home-sub">Standing instructions — watch sources on a cadence, raise alerts, or write the weekly brief. Nothing runs until it is rehearsed and the owner activates it.</p>
      </div>
      <form className="room-create" onSubmit={interpret}>
        <label htmlFor="rule-instruction" className="sr-only-label">Describe the standing rule</label>
        <textarea id="rule-instruction" rows="2" value={instruction}
          placeholder="e.g. Watch inbound HubSpot deals and alert me daily about any over $25k…"
          onChange={(e) => setInstruction(e.target.value)} />
        <button className="btn ghost small" type="button" onClick={() => setInstruction(WEEKLY_BRIEF_TEMPLATE)}
          title="Prefill the weekly operating brief template">
          Weekly brief template
        </button>
        <button className="btn primary" type="submit" disabled={busy || !instruction.trim()}>
          {busy ? 'Interpreting…' : 'Interpret'}
        </button>
      </form>
      {parseError ? <p className="answer-fail" role="alert">Couldn&rsquo;t interpret that instruction — {parseError}</p> : null}
      {rulesList === null ? <div className="empty-hint">loading…</div> : null}
      <div className="room-cards">
        {(rulesList || []).map((r) => (
          <button key={r.id} className="room-card" onClick={() => openRule(r.id)}>
            <b>{short(r.instruction, 80)}</b>
            <span className={`chip rule-${r.state}`}>{r.state}</span>
            <span className="chip">{r.output_type}</span>
            <span className="dim mono">{cadenceLabel(r)}{r.next_run_at ? ` · next ${fmtWhen(r.next_run_at)}` : ''}</span>
          </button>
        ))}
        {rulesList !== null && rulesList.length === 0 ? (
          <p className="dim">No standing rules yet — describe one above, or start from the weekly brief template.</p>
        ) : null}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, rulesApi, timeAgo, short } from './api.js';
import { useDraft } from './Drafts.jsx';
import { RequestError, useResource } from './RequestState.jsx';
import { workStatusLabel, SummaryMarkdown, formatContractTail } from './format.jsx';

// P5 Rules & Briefs: a standing rule is a stored instruction + a persisted
// authorization. Describe it in plain language → review the interpretation
// (every field, plain words) → rehearse (see what WOULD have matched) →
// owner activates. Runs land here as history; briefs render their markdown.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Mirrors server/standing-rules.js SOURCES — the only values validateInterpretation
// keeps (anything else is silently dropped, so offering more would be a lie).
const SOURCES = ['gmail', 'drive', 'sheets', 'calendar', 'hubspot', 'enrichment', 'memory', 'web'];
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

// next_run_at is only a promise while the rule is ACTIVE — pause, revoke and
// expire all leave the column populated, and rendering it regardless promised a
// run that will never come. A due time already in the past is the visible
// symptom of a scheduling lane that is not delivering (TICK_AUDIENCE /
// TICK_INVOKER_SA unset, or no Cloud Scheduler job): say so rather than keep
// showing a future-tense "next".
function nextRunLabel(rule) {
  if (!rule.next_run_at || rule.state !== 'active') return null;
  return Date.parse(rule.next_run_at) <= Date.now()
    ? `due ${fmtWhen(rule.next_run_at)} — overdue, nothing has run it`
    : `scheduled ${fmtWhen(rule.next_run_at)} — delivery requires a working scheduler`;
}

// The consent card's "Next run" field. Same rule as above — the STATE decides
// what may be claimed, never the column's truthiness — but a stopped rule needs
// more than silence here: "computed at activation" on a revoked rule promises a
// future activation that can never happen.
const STOPPED_NEXT_RUN = {
  paused: 'paused — nothing runs until it is resumed',
  revoked: 'never — the authorization is revoked',
  expired: 'never — the authorization expired',
};

function nextRunText(rule) {
  if (STOPPED_NEXT_RUN[rule.state]) return STOPPED_NEXT_RUN[rule.state];
  if (rule.state !== 'active') return 'computed at activation'; // draft / rehearsed
  if (!rule.next_run_at) return 'not scheduled — activation recorded no next run';
  return Date.parse(rule.next_run_at) <= Date.now()
    ? `${fmtWhen(rule.next_run_at)} — overdue, nothing has run it. Check scheduled work delivery (STANDING RULES · TICK) in Connections.`
    : fmtWhen(rule.next_run_at);
}

// The markdown renderer lives in format.jsx now (SummaryMarkdown). Run
// HISTORY is the one place contract stripping is safe: the MATCHED count is
// already rendered as its own chip there, so the tail line is duplication.
// Rehearsals have NO count chip — "NOTHING MATCHED" may be the entire result,
// so they humanize ("Nothing matched.") and never lose the outcome.
function RuleNarrative({ text, mode = 'strip' }) {
  const narrative = formatContractTail(text, mode);
  if (!narrative.trim()) return <p className="dim">No narrative summary was returned.</p>;
  return <SummaryMarkdown text={narrative} />;
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
function InterpretationCard({ rule, agentsById, readsAs }) {
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
        <li><b>Sources</b> — <span>{(interp.sources || []).join(', ') || '—'}</span>
          {(interp.sources || []).includes('enrichment')
            ? <span className="dim"> — reads already-enriched records only; a scheduled rule never spends enrichment credits</span>
            : null}
        </li>
        <li><b>Scope</b> — <span>{interp.scope || '—'}</span></li>
        <li><b>Cadence</b> — <span>{cadenceLabel(rule)}</span></li>
        <li><b>Run by</b> — <span>{`${agent ? `${agent.name} (${agent.role})` : (interp.agent_id || rule.agent_id || '—')}, created by ${rule.owner_email}`}</span></li>
        {/* Whose mail, files and CRM access the run actually spends. The
            creator above is NOT it: every scheduled run acts as the person who
            activated the rule, and the rehearsal acted as whoever ran it. The
            grant means nothing unless the card names that identity. */}
        <li><b>Reads as</b> — <span>{readsAs || 'not yet established — whoever rehearses and activates it'}</span></li>
        <li><b>Output</b> — <span>{rule.output_type === 'brief' ? 'a written brief with sources' : 'an alert, only when something matches'}</span></li>
        <li><b>Budget</b> — <span>{`${rule.step_budget != null ? `${rule.step_budget} steps` : 'default steps'} · ${rule.wall_ms_budget != null ? `${Math.round(rule.wall_ms_budget / 60000)} min` : 'default time'} per run`}</span></li>
        <li><b>Expires</b> — <span>{rule.expires_at ? fmtWhen(rule.expires_at) : `${expiryDays} days after activation`}</span></li>
        <li><b>Can</b> — <span>{can.join('; ') || '—'}</span> · <b>Cannot</b> — <span>{cannot.join('; ') || '—'}</span></li>
        <li><b>Next run</b> — <span>{nextRunText(rule)}</span></li>
      </ul>
    </section>
  );
}

// Structured-field editing. Re-parsing the prose was the ONLY way to change any
// of these, and it re-derives all ten fields from the model every time: a rule
// running daily at 20:00 whose owner reworded a clause got cadence_hour back
// from validateInterpretation's silent default (8), and step_budget/
// wall_ms_budget/expires_days have no plain-language vocabulary to express at
// all — the parse prompt asks the model to pick them and the owner never gets a
// say. So "move the Monday brief to Friday" or "give it more steps" had no
// honest path. PATCH is that path: same validate-and-clamp, same rehearsal-gate
// reset, no model in the loop, so nothing drifts that the owner did not type.
//
// Native inputs and native constraint validation on purpose — min/max on a
// number input is the whole client-side check, and the server clamps anyway.
// Keyed on `${id}#${version}` by the caller so a server response remounts this
// with fresh defaults instead of a useEffect sync dance.
function RuleSettings({ rule, agents, busy, onSave }) {
  // Rendered only while the disclosure is open. `<details>` keeps its children
  // in the DOM when closed, and this form repeats every source name and the
  // scope verbatim — a second copy of half the consent card, findable by
  // screen readers and by text queries, on a panel nobody opened.
  const [open, setOpen] = useState(false);
  const interp = fromJson(rule.interpretation ?? rule.interpretation_json, {});
  const [f, setF] = useDraft(`rule-settings:${rule.id}:${rule.version}`, () => ({
    agent_id: interp.agent_id || rule.agent_id || '',
    cadence: rule.cadence || 'daily',
    cadence_hour: rule.cadence_hour ?? 8,
    cadence_day: rule.cadence_day ?? 1,
    output_type: rule.output_type || 'alert',
    sources: Array.isArray(interp.sources) ? interp.sources : [],
    scope: interp.scope || '',
    step_budget: rule.step_budget ?? 12,
    wall_min: Math.max(1, Math.round((rule.wall_ms_budget ?? 300_000) / 60_000)),
    expires_days: Number.isInteger(interp.expires_days) ? interp.expires_days : 90,
  }));
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const toggleSource = (s) => (e) => setF((c) => ({
    ...c, sources: e.target.checked ? [...new Set([...c.sources, s])] : c.sources.filter((x) => x !== s),
  }));
  const submit = (e) => {
    e.preventDefault();
    // Spread the STORED interpretation first: summary/category/can/cannot are
    // model-written prose this form deliberately does not touch, and blanking
    // them would empty two consent-card fields. cadence_day is null off weekly
    // — validateInterpretation rejects a weekly rule without one and ignores it
    // otherwise.
    onSave({
      ...interp,
      agent_id: f.agent_id,
      cadence: f.cadence,
      cadence_hour: Number(f.cadence_hour),
      cadence_day: f.cadence === 'weekly' ? Number(f.cadence_day) : null,
      output_type: f.output_type,
      sources: f.sources,
      scope: String(f.scope).trim(),
      step_budget: Number(f.step_budget),
      wall_ms_budget: Number(f.wall_min) * 60_000,
      expires_days: Number(f.expires_days),
    });
  };
  return (
    <details className="rule-settings" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Settings — cadence, sources, budget, expiry</summary>
      {!open ? null : (
      <form onSubmit={submit}><fieldset disabled={busy}>
        <label htmlFor="rs-agent">Run by</label>
        <select id="rs-agent" value={f.agent_id} onChange={set('agent_id')}>
          {(agents || []).map((a) => <option key={a.id} value={a.id}>{`${a.name} (${a.role})`}</option>)}
        </select>

        <label htmlFor="rs-cadence">Cadence</label>
        <select id="rs-cadence" value={f.cadence} onChange={set('cadence')}>
          <option value="hourly">every hour</option>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>

        {f.cadence === 'weekly' ? (
          <>
            <label htmlFor="rs-day">Day</label>
            <select id="rs-day" value={f.cadence_day} onChange={set('cadence_day')}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </>
        ) : null}

        {f.cadence === 'hourly' ? null : (
          <>
            <label htmlFor="rs-hour">Hour (UTC)</label>
            <input id="rs-hour" type="number" min="0" max="23" step="1" value={f.cadence_hour} onChange={set('cadence_hour')} />
          </>
        )}

        <label htmlFor="rs-output">Output</label>
        <select id="rs-output" value={f.output_type} onChange={set('output_type')}>
          <option value="alert">alert — only when something matches</option>
          <option value="brief">brief — a written brief every run</option>
        </select>

        <fieldset>
          <legend>Sources</legend>
          {SOURCES.map((s) => (
            <label key={s} htmlFor={`rs-src-${s}`}>
              <input id={`rs-src-${s}`} type="checkbox" checked={f.sources.includes(s)} onChange={toggleSource(s)} />
              {s}
            </label>
          ))}
        </fieldset>

        <label htmlFor="rs-scope">Scope</label>
        <textarea id="rs-scope" rows="2" required value={f.scope} onChange={set('scope')} />

        <details><summary>Advanced settings: work limits</summary>
        <label htmlFor="rs-steps">Step budget</label>
        <input id="rs-steps" type="number" min="1" max="64" step="1" value={f.step_budget} onChange={set('step_budget')} />

        <label htmlFor="rs-wall">Time budget (minutes)</label>
        <input id="rs-wall" type="number" min="1" max="30" step="1" value={f.wall_min} onChange={set('wall_min')} />

        </details>
        <label htmlFor="rs-expiry">Expires (days after activation)</label>
        <input id="rs-expiry" type="number" min="1" max="365" step="1" value={f.expires_days} onChange={set('expires_days')} />

        <p className="dim">
          Saving resets the rule to draft — rehearse again before it can activate. The plain-language
          Can/Cannot lines are carried over unchanged; only editing the instruction rewrites those.
        </p>
        <button className="btn primary small" type="submit" disabled={busy}>Save settings</button></fieldset>
      </form>
      )}
    </details>
  );
}

// standing_rule_runs.state — its own vocabulary (pending/skipped don't exist on
// agent runs), but the run-* chip colors already carry these meanings, so map
// onto them instead of inventing a second palette.
const RUN_STATE_CHIP = {
  pending: 'run-queued', running: 'run-running', completed: 'run-completed',
  failed: 'run-failed', skipped: 'run-halted',
};

function RunHistory({ runs }) {
  return (
    <section className="room-section">
      <h3>Run history<span className="chip">{runs.length}</span></h3>
      {runs.length === 0 ? <p className="dim">No runs yet — runs appear here after activation.</p> : (
        <ul className="room-list">
          {runs.map((r) => (
            <li key={r.id}>
              <span className={`chip ${RUN_STATE_CHIP[r.state] || ''}`}>{workStatusLabel(r.state)}</span>
              <details><summary>Advanced work details</summary><span className="mono dim">Scheduled occurrence: {r.occurrence_key}</span></details>
              {r.matched_count != null ? <span className="chip">{r.matched_count} matched</span> : null}
              {r.skip_reason ? <span className="dim"> skipped: {r.skip_reason}</span> : null}
              {r.error ? <span className="answer-fail"> {r.error}</span> : null}
              <span className="dim mono"> · {timeAgo(r.created_at)}</span>
              {/* Strip only when the count chip above actually rendered;
                  a NULL matched_count means the count is unknown, so the
                  contract line is the only thing that says what matched. */}
              {r.result_summary ? (
                <RuleNarrative text={r.result_summary} mode={r.matched_count != null ? 'strip' : 'humanize'} />
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
  const [instruction, setInstruction] = useDraft(`rule-instruction:${canvasId}`, '');
  const [failedEdits, setFailedEdits] = useDraft(`rule-failed-edits:${canvasId}`, {});
  const [parseError, setParseError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pollError, setPollError] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const [detailError, setDetailError] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (value) => { busyRef.current = value; setBusyState(value); };
  const [detail, setDetail] = useState(null);
  const selected = useRef(null);
  const seq = useRef(0);
  const context = useRef(canvasId);
  context.current = canvasId;
  const list = useResource(() => rulesApi.list(canvasId), canvasId);
  const rulesList = list.data?.rules;
  const loadList = list.refresh;
  const space = useResource(() => api(`/api/canvases/${canvasId}`), `rule-space:${canvasId}`);
  const canEdit = !space.loading && space.data?.access !== 'view' && !space.error;
  useEffect(() => {
    seq.current += 1; selected.current = null; setDetail(null); setDetailError(null); setBusy(false);
    return () => { seq.current += 1; selected.current = null; };
  }, [canvasId]);
  const mergeDetail = useCallback((id, patch) => {
    if (selected.current !== id) return;
    setDetail((cur) => cur?.rule.id === id ? { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } : cur);
  }, []);
  const showDetail = useCallback((d) => {
    setParseError(null);
    setDetail({ runs: [], authorization: null, rehearsalRun: null, ...d, savedInstruction: d.rule.instruction, editError: null });
  }, []);
  const openRule = useCallback(async (id) => {
    selected.current = id;
    const request = ++seq.current;
    setDetailLoading(true); setDetailError(null); setDetail(null); setActionError(null); setPollError(null); setBusy(false);
    try {
      const [d, h] = await Promise.all([rulesApi.get(id), rulesApi.runs(id)]);
      if (request === seq.current) showDetail({ ...d, runs: h.runs || d.runs || [] });
    } catch (e) { if (request === seq.current) setDetailError(e); }
    finally { if (request === seq.current) setDetailLoading(false); }
  }, [showDetail]);
  useEffect(() => { if (focusRuleId) openRule(focusRuleId); }, [focusRuleId, openRule, canvasId]);
  const back = () => { seq.current += 1; selected.current = null; setDetail(null); setDetailError(null); setDetailLoading(false); setParseError(null); setActionError(null); setBusy(false); loadList(); };
  const ruleId = detail?.rule.id;
  const rehearsalPending = ['queued', 'running'].includes(detail?.rehearsalRun?.status);
  useEffect(() => {
    if (!ruleId || !rehearsalPending) return;
    let cancelled = false;
    let timer;
    const check = async () => {
      try {
        const full = await rulesApi.get(ruleId);
        if (cancelled) return;
        setPollError(null);
        mergeDetail(ruleId, (cur) => ({ ...full, rule: { ...full.rule, instruction: cur.rule.instruction }, savedInstruction: full.rule.instruction }));
        if (['queued', 'running'].includes(full.rehearsalRun?.status)) timer = setTimeout(check, 1500);
      } catch (e) { if (!cancelled) setPollError(e); }
    };
    timer = setTimeout(check, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ruleId, rehearsalPending, pollTick, mergeDetail]);
  const agentsById = useMemo(() => Object.fromEntries((space.data?.agents || agents || []).map((a) => [a.id, a])), [agents, space.data]);
  const interpret = async (e) => {
    e.preventDefault();
    if (!instruction.trim() || busyRef.current || parseError?.unconfirmed || !canEdit) return;
    const request = seq.current;
    setBusy(true); setParseError(null);
    try {
      const d = await rulesApi.parse(canvasId, instruction.trim());
      if (request !== seq.current) return;
      setInstruction(''); loadList(); selected.current = d.rule.id; showDetail({ rule: d.rule });
    } catch (e2) { if (request === seq.current) setParseError(e2); }
    finally { if (request === seq.current) setBusy(false); }
  };
  const mutate = async (operation, onSuccess) => {
    if (busyRef.current || actionError?.unconfirmed) return;
    const id = detail.rule.id;
    const request = seq.current;
    setBusy(true); setActionError(null);
    try {
      const result = await operation(id);
      if (request === seq.current && selected.current === id) { onSuccess(result, id); loadList(); }
    } catch (e) { if (request === seq.current) {
      setActionError(e);
      if ([403, 409].includes(e.status)) {
        if (e.status === 403) space.refresh();
        try { const full = await rulesApi.get(id); if (request === seq.current) mergeDetail(id, (cur) => ({ ...full, rule: { ...full.rule, instruction: cur.rule.instruction } })); }
        catch (readError) { if (request === seq.current) setDetailError(readError); }
      }
    } }
    finally { if (request === seq.current) setBusy(false); }
  };
  const saveInstruction = async () => {
    const { id, instruction: edited } = detail.rule;
    if (edited === detail.savedInstruction || busyRef.current || actionError?.unconfirmed) return;
    const request = seq.current;
    setBusy(true); mergeDetail(id, { editError: null });
    try {
      const d = await rulesApi.parse(canvasId, edited, id);
      if (request !== seq.current) return;
      mergeDetail(id, (cur) => ({ rule: d.rule, rehearsalRun: null, savedInstruction: d.rule.instruction, authorization: d.authorization || cur.authorization }));
      setFailedEdits((cur) => ({ ...cur, [id]: null })); loadList();
    } catch (e) {
      if (request !== seq.current) return;
      setFailedEdits((cur) => ({ ...cur, [id]: edited }));
      mergeDetail(id, (cur) => ({ rule: { ...cur.rule, instruction: cur.savedInstruction }, editError: e }));
      if (e.unconfirmed) setActionError(e);
    } finally { if (request === seq.current) setBusy(false); }
  };
  const saveSettings = (interpretation) => mutate((id) => rulesApi.update(id, { interpretation }), (d, id) => {
    mergeDetail(id, (cur) => ({ rule: d.rule, rehearsalRun: null, savedInstruction: d.rule.instruction, editError: null, authorization: d.authorization || cur.authorization }));
    toast('Settings saved — rehearse again before it can activate', 'ok');
  });
  const rehearse = () => { if (!rehearsalPending) mutate((id) => rulesApi.rehearse(id), (d, id) => mergeDetail(id, { rule: d.rule, rehearsalRun: d.run || { status: 'queued' } })); };
  const activate = () => mutate((id) => rulesApi.activate(id), (d, id) => {
    mergeDetail(id, (cur) => ({ rule: d.rule, authorization: d.authorization || cur.authorization }));
    toast('Authorization saved. Check delivery status and the scheduled results.', 'ok');
  });
  const ceremony = (action, okMsg) => () => mutate((id) => rulesApi[action](id), (d, id) => {
    mergeDetail(id, (cur) => ({ rule: d.rule, authorization: d.authorization || cur.authorization })); toast(okMsg, 'ok');
  });
  if (detailLoading || detailError) return <div className="rooms-view"><button className="btn" onClick={back}>← Rules</button>{detailLoading ? <p role="status">Loading scheduled work…</p> : null}<RequestError error={detailError} subject="Loading scheduled work" onRetry={() => openRule(selected.current)} /></div>;
  if (detail) {
    const rule = detail.rule;
    const rehearsal = detail.rehearsalRun;
    const rehearsed = rule.state === 'rehearsed' && rehearsal?.status === 'completed' && (!rehearsal.initiated_by || rehearsal.initiated_by === user.email) && !actionError && rule.instruction === detail.savedInstruction;
    const editable = canEdit && (isOwner || rule.created_by === user.email) && !['revoked', 'expired'].includes(rule.state);
    // A draft or rehearsed rule cannot run: the tick's due query only ever
    // selects `active`. Any authorization on screen for one of those states is
    // the grant the edit retired — rendering it as "Authorized by … · expires
    // …" asserts a live authorization on a rule enforcement has already stopped
    // honouring. The server retires the row on every edit and returns it, but
    // the STATE is what decides what may be claimed here, so a legacy row (or a
    // client that has not caught up) cannot resurrect the live-grant claim
    // either. Revoked and expired rules keep their own terminal language.
    const retiredGrant = ['draft', 'rehearsed'].includes(rule.state) && !!detail.authorization;
    return (
      <div className="rooms-view">
        <div className="room-head">
          <button className="btn ghost small" onClick={back}>← Rules</button>
          <h1>{short(rule.instruction, 60)}</h1>
          <span className={`chip rule-${rule.state}`}>{rule.state}</span>
          <span className="chip">{rule.output_type}</span>
          <span className="dim mono">{cadenceLabel(rule)}</span>
        </div>
        {/* A revoked grant has no expiry left to promise — the revocation is
            the whole state of it. A retired one has no expiry to promise
            either: it is history, and history is all it may claim. */}
        {detail.authorization ? (
          <p className="dim">
            {retiredGrant ? 'Previously authorized by ' : 'Authorized by '}
            <span className="mono">{detail.authorization.authorized_by}</span>
            {retiredGrant
              ? ` — retired${detail.authorization.revoked_at ? ` ${fmtWhen(detail.authorization.revoked_at)}` : ''} when the rule changed. It is not a live authorization: nothing runs under it unless the rule is rehearsed and activated again.`
              : (detail.authorization.revoked_at
                ? ` · revoked ${fmtWhen(detail.authorization.revoked_at)} — nothing runs under it again`
                : (detail.authorization.expires_at ? ` · expires ${fmtWhen(detail.authorization.expires_at)}` : ''))}
          </p>
        ) : null}
        <RequestError error={actionError} subject="Saving scheduled work" onRetry={() => openRule(rule.id)} retryLabel="Check saved status" />
        <RequestError error={pollError} subject="Checking the rehearsal" onRetry={() => { setPollError(null); setPollTick((n) => n + 1); }} retryLabel="Check status" />
        <RequestError error={space.error} subject="Checking project access" onRetry={space.refresh} />
        {rehearsal?.initiated_by && rehearsal.initiated_by !== user.email && isOwner ? <p>Rehearse with your own account before activating. Activation will use your access.</p> : null}
        <p>Scheduled times are recorded in UTC. Delivery depends on the scheduling service; inspect Connections and the work history to confirm execution.</p>
        <div className="builder-flow">
          {editable ? (
            <section>
              <h4>Instruction</h4>
              <textarea rows="3" disabled={busy || rehearsalPending || actionError?.unconfirmed} value={rule.instruction} aria-label="Rule instruction"
                onChange={(e) => { const text = e.target.value; setFailedEdits((cur) => ({ ...cur, [rule.id]: text })); setDetail((cur) => ({ ...cur, rule: { ...cur.rule, instruction: text } })); }}
                onBlur={saveInstruction} />
              <p className="dim">Editing re-interprets the whole rule and resets it to draft — rehearse again before it can activate.</p>
              {/* A re-interpretation that failed changed nothing, and the edit
                  above it has been put back — say both, or the restore is just
                  a second way to mislead. */}
              {detail.editError && !detail.editError.unconfirmed ? <p className="answer-fail" role="alert">Couldn't re-interpret that edit — {detail.editError.message}. The rule is unchanged; the consent card is restored to the saved instruction. Your edited text is retained below.</p> : null}
              {failedEdits[rule.id] && rule.instruction === detail.savedInstruction ? <details><summary>Your unsaved instruction</summary><p>{failedEdits[rule.id]}</p><button className="btn small" disabled={busy || actionError?.unconfirmed} onClick={() => mergeDetail(rule.id, (cur) => ({ rule: { ...cur.rule, instruction: failedEdits[rule.id] }, editError: null }))}>Restore edit to retry</button></details> : null}
            </section>
          ) : null}
          {/* Same gate as the instruction textarea (and the same server check:
              PATCH's ruleAccess admits the creator or the owner). A revoked or
              expired rule has nothing left to edit. */}
          {editable ? (
            <RuleSettings key={`${rule.id}#${rule.version}`} rule={rule} agents={space.data?.agents || agents || []}
              busy={busy || rehearsalPending || actionError?.unconfirmed} onSave={saveSettings} />
          ) : null}
          {/* The live grant wins once it exists; before activation the
              rehearsal's own identity is what the owner is being asked to
              accept as the review. The payload now carries REVOKED grants too
              (it has to, or the block above cannot say it was revoked), and a
              revoked grantor is nobody's access to spend. A RETIRED grant is
              not an answer to this question at all: the rule is back at the
              gate, and what it would read as next is whoever rehearses it now —
              falling back to the old grantor would name an identity the next
              run has no claim on. */}
          <InterpretationCard rule={rule} agentsById={agentsById}
            readsAs={retiredGrant
              ? (rehearsal?.initiated_by || null)
              : (detail.authorization?.revoked_at
                ? `nobody — the grant from ${detail.authorization.authorized_by} was revoked`
                : (detail.authorization?.authorized_by || rehearsal?.initiated_by || null))} />
          {rehearsal ? (
            <section className="rehearsal-block">
              <h4>Rehearsal {rehearsal.status === 'running' ? '— running…' : `— ${rehearsal.status}`}</h4>
              {rehearsal.status === 'running' ? <p className="dim">Checking recent data for what WOULD have matched — nothing changes.</p> : null}
              {rehearsal.summary ? (
                <div className="rehearsal-summary"><RuleNarrative text={rehearsal.summary} mode="humanize" /></div>
              ) : null}
              {rehearsal.error ? <p className="answer-fail">{rehearsal.error}</p> : null}
            </section>
          ) : null}
          <div className="canvas-new-actions">
            {editable && ['draft', 'rehearsed'].includes(rule.state) ? (
              <button className="btn primary small" disabled={busy || rehearsalPending || actionError?.unconfirmed} onClick={rehearse}
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
              <button className="btn ghost small" disabled={busy || actionError?.unconfirmed} onClick={ceremony('pause', 'Rule paused')}>Pause</button>
            ) : null}
            {isOwner && rule.state === 'paused' ? (
              <button className="btn ok small" disabled={busy || actionError?.unconfirmed} onClick={ceremony('resume', 'Rule resumed')}>Resume</button>
            ) : null}
            {isOwner && editable ? (
              <button className="btn danger small" disabled={busy || actionError?.unconfirmed} onClick={ceremony('revoke', 'Rule revoked — the authorization is gone')}
                title="Revokes the standing authorization — nothing runs again">
                Revoke
              </button>
            ) : null}
          </div>
          <RunHistory runs={detail.runs || []} />
        </div>
      </div>
    );
  }

  return (
    <div className="rooms-view">
      <div className="home-hero">
        <h1>Scheduled work</h1>
        <p className="home-sub">Standing instructions — watch sources on a cadence, raise alerts, or write the weekly brief. Nothing runs until it is rehearsed and the owner activates it.</p>
      </div>
      <RequestError error={list.error} subject="Loading scheduled work" onRetry={loadList} />
      {list.error && rulesList ? <p>Last known scheduled work is shown; refresh before relying on its status.</p> : null}
      <RequestError error={space.error} subject="Checking project access" onRetry={space.refresh} />
      {canEdit ? <form className="room-create" onSubmit={interpret}>
        <label htmlFor="rule-instruction" className="sr-only-label">Describe the standing rule</label>
        <textarea id="rule-instruction" rows="2" value={instruction}
          placeholder="e.g. Watch inbound HubSpot deals and alert me daily about any over $25k…"
          onChange={(e) => setInstruction(e.target.value)} />
        <button className="btn ghost small" type="button" onClick={() => setInstruction(WEEKLY_BRIEF_TEMPLATE)}
          title="Prefill the weekly operating brief template">
          Weekly brief template
        </button>
        <button className="btn primary" type="submit" disabled={busy || parseError?.unconfirmed || !instruction.trim()}>
          {busy ? 'Interpreting…' : 'Interpret'}
        </button>
      </form> : <p>This space is view only or access is unavailable. Ask the owner for edit access.</p>}
      <RequestError error={parseError} subject="Interpreting your instruction" onRetry={loadList} retryLabel="Check saved rules" />
      {parseError?.unconfirmed ? <button className="btn small" onClick={() => setParseError(null)}>I checked the rules; keep editing</button> : null}
      {list.loading ? <div className="empty-hint">loading…</div> : null}
      <div className="room-cards">
        {(rulesList || []).map((r) => (
          <button key={r.id} className="room-card" onClick={() => openRule(r.id)}>
            <b>{short(r.instruction, 80)}</b>
            <span className={`chip rule-${r.state}`}>{workStatusLabel(r.state)}</span>
            <span className="chip">{r.output_type}</span>
            <span className="dim mono">{cadenceLabel(r)}{nextRunLabel(r) ? ` · ${nextRunLabel(r)}` : ''}</span>
          </button>
        ))}
        {rulesList && rulesList.length === 0 && !list.error ? (
          <p className="dim">No standing rules yet — describe one above, or start from the weekly brief template.</p>
        ) : null}
      </div>
    </div>
  );
}

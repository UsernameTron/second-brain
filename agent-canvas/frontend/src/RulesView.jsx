import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { rulesApi, timeAgo, short } from './api.js';
import { SummaryMarkdown, formatContractTail } from './format.jsx';

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
    : `next ${fmtWhen(rule.next_run_at)}`;
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
    ? `${fmtWhen(rule.next_run_at)} — overdue, nothing has run it. Check STANDING RULES · TICK on the systems board.`
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
  const [f, setF] = useState(() => ({
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
      <form onSubmit={submit}>
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

        <label htmlFor="rs-steps">Step budget</label>
        <input id="rs-steps" type="number" min="1" max="64" step="1" value={f.step_budget} onChange={set('step_budget')} />

        <label htmlFor="rs-wall">Time budget (minutes)</label>
        <input id="rs-wall" type="number" min="1" max="30" step="1" value={f.wall_min} onChange={set('wall_min')} />

        <label htmlFor="rs-expiry">Expires (days after activation)</label>
        <input id="rs-expiry" type="number" min="1" max="365" step="1" value={f.expires_days} onChange={set('expires_days')} />

        <p className="dim">
          Saving resets the rule to draft — rehearse again before it can activate. The plain-language
          Can/Cannot lines are carried over unchanged; only editing the instruction rewrites those.
        </p>
        <button className="btn primary small" type="submit" disabled={busy}>Save settings</button>
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
              <span className={`chip ${RUN_STATE_CHIP[r.state] || ''}`}>{r.state}</span>
              <span className="mono dim"> {r.occurrence_key}</span>
              {r.matched_count != null ? <span className="chip">{r.matched_count} matched</span> : null}
              {r.skip_reason ? <span className="dim"> skipped: {r.skip_reason}</span> : null}
              {r.error ? <span className="answer-fail"> {r.error}</span> : null}
              <span className="dim mono"> · {timeAgo(r.created_at)}</span>
              {r.result_summary ? <RuleNarrative text={r.result_summary} /> : null}
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
  // { rule, savedInstruction, editError, authorization, runs, rehearsalRun }
  const [detail, setDetail] = useState(null);

  // Every async response writes back through here, and only when the pane is
  // still showing the rule that request was for. `setDetail((cur) => ({ ...cur,
  // … }))` spread a null `cur` when the owner had already clicked "← Rules":
  // the rule reopened itself with its runs and authorization missing. Two
  // things ride inside the same state rather than beside it, so a late response
  // cannot desync them either: `savedInstruction` (the server's copy of the
  // prose — the textarea edits `rule.instruction` live, so that is the only
  // record of what is actually stored) and `editError`.
  const mergeDetail = useCallback((id, patch) => {
    setDetail((cur) => (cur && cur.rule.id === id
      ? { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
      : cur));
  }, []);

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
          mergeDetail(ruleId, { ...full, savedInstruction: full.rule.instruction });
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [ruleId, rehearsalPending, mergeDetail]);

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
    setParseError(null);
    setDetail({
      runs: [], authorization: null, rehearsalRun: null, ...d,
      savedInstruction: d.rule.instruction, editError: null,
    });
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
  // The edit RE-INTERPRETS: PATCH reuses the stored interpretation verbatim, so
  // rewriting "watch HubSpot deals over $25k" into "summarize my Gmail inbox"
  // left nine of the card's ten fields — sources, scope, cadence, can/cannot —
  // describing the old rule, and activation would freeze a grant built from it.
  // Re-parse against this rule id (routes.js `body.rule_id`): same rule, same
  // rehearsal-gate reset, every field re-derived from the new words.
  const saveInstruction = async () => {
    const { id, instruction: edited } = detail.rule;
    if (edited === detail.savedInstruction || busy) return;
    setBusy(true);
    mergeDetail(id, { editError: null });
    try {
      const d = await rulesApi.parse(canvasId, edited, id);
      // The edit retired the grant server-side and the response carries the
      // retired row — merge it, the same way the ceremonies do, or the block
      // above keeps the pre-edit grant with no refetch path to correct it.
      mergeDetail(id, (cur) => ({
        rule: d.rule, rehearsalRun: null, savedInstruction: d.rule.instruction,
        authorization: d.authorization || cur.authorization,
      }));
      loadList();
    } catch (e) {
      // A failed re-interpretation wrote NOTHING: every error path in the parse
      // route returns before upsertDraft. So the server still holds the old
      // instruction — and, on a rehearsed rule, a completed rehearsal of it,
      // which leaves Activate enabled the moment `busy` clears. Leaving the
      // edited words in the textarea and the heading pointed the consent
      // surface at an instruction that was never interpreted and is not what
      // Activate would authorize. Put the saved prose back, so the screen and
      // the ceremony describe the same rule; the alert below is what keeps the
      // restore from being silent. Restoring beats refetching here: the fetch
      // that just failed is the same lane a refetch would use, and a refetch
      // that also fails leaves exactly the ambiguity this is closing.
      mergeDetail(id, (cur) => ({ rule: { ...cur.rule, instruction: cur.savedInstruction }, editError: e.message }));
    } finally { setBusy(false); }
  };

  // Structured edit: PATCH, not re-parse. The prose is untouched, so putting it
  // through the model could only re-derive fields the owner did not ask to
  // change. Same server-side ceremony either way (validate → clamp → draft →
  // version++ → rehearsal cleared), so the button below has to say so.
  const saveSettings = async (interpretation) => {
    if (busy) return;
    const id = detail.rule.id;
    setBusy(true);
    try {
      const d = await rulesApi.update(id, { interpretation });
      mergeDetail(id, (cur) => ({
        rule: d.rule, rehearsalRun: null, savedInstruction: d.rule.instruction, editError: null,
        authorization: d.authorization || cur.authorization,
      }));
      loadList();
      toast('Settings saved — rehearse again before it can activate', 'ok');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const rehearse = async () => {
    if (busy || rehearsalPending) return;
    setBusy(true);
    const id = detail.rule.id;
    try {
      const d = await rulesApi.rehearse(id);
      // Marking the run pending is what starts the poll and holds the button;
      // the poll replaces this optimistic marker with the server's real run.
      mergeDetail(id, { rule: d.rule, rehearsalRun: { status: 'running' } });
    } catch (e) {
      // 409 = the server's backstop: a rehearsal is already in flight and this
      // client didn't know. Re-read the run so the button reflects reality.
      if (e.status === 409) {
        rulesApi.get(id)
          .then((full) => mergeDetail(id, { rehearsalRun: full.rehearsalRun }))
          .catch(() => {});
      }
      toast(e.status === 409 ? 'A rehearsal is already running — wait for it to finish' : e.message);
    } finally { setBusy(false); }
  };

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    const id = detail.rule.id;
    try {
      const d = await rulesApi.activate(id);
      mergeDetail(id, (cur) => ({ rule: d.rule, authorization: d.authorization || cur.authorization }));
      loadList();
      toast('Rule is active — it runs on its cadence from here', 'ok');
    } catch (e) {
      toast(e.status === 409 ? 'Rehearse first — activation needs a completed rehearsal' : e.message);
    } finally { setBusy(false); }
  };

  // A ceremony can change the AUTHORIZATION too, not just the rule: /revoke
  // returns the now-revoked grant. Merging only { rule } left the block above
  // rendering "Authorized by … · expires …" from the pre-revoke fetch, with no
  // refetch path to correct it (the only poll is gated on rehearsalPending).
  // Same merge activate does; `|| cur.authorization` keeps pause/resume, which
  // return no authorization, from blanking it.
  const ceremony = (action, okMsg) => async () => {
    if (busy) return;
    setBusy(true);
    const id = detail.rule.id;
    try {
      const d = await rulesApi[action](id);
      mergeDetail(id, (cur) => ({ rule: d.rule, authorization: d.authorization || cur.authorization }));
      loadList();
      toast(okMsg, 'ok');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  if (detail) {
    const rule = detail.rule;
    const rehearsal = detail.rehearsalRun;
    const rehearsed = rule.state === 'rehearsed' && rehearsal && rehearsal.status === 'completed';
    const editable = !['revoked', 'expired'].includes(rule.state);
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
          <button className="btn ghost small" onClick={() => { setDetail(null); setParseError(null); loadList(); }}>← Rules</button>
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
        <div className="builder-flow">
          {editable ? (
            <section>
              <h4>Instruction</h4>
              <textarea rows="3" value={rule.instruction} aria-label="Rule instruction"
                onChange={(e) => setDetail((cur) => ({ ...cur, rule: { ...cur.rule, instruction: e.target.value } }))}
                onBlur={saveInstruction} />
              <p className="dim">Editing re-interprets the whole rule and resets it to draft — rehearse again before it can activate.</p>
              {/* A re-interpretation that failed changed nothing, and the edit
                  above it has been put back — say both, or the restore is just
                  a second way to mislead. */}
              {detail.editError ? (
                <p className="answer-fail" role="alert">
                  Couldn&rsquo;t re-interpret that edit — {detail.editError}. The rule is unchanged, and your edited
                  text has been restored to the saved instruction — nothing on this screen describes anything other
                  than the rule the server holds.
                </p>
              ) : null}
            </section>
          ) : null}
          {/* Same gate as the instruction textarea (and the same server check:
              PATCH's ruleAccess admits the creator or the owner). A revoked or
              expired rule has nothing left to edit. */}
          {editable ? (
            <RuleSettings key={`${rule.id}#${rule.version}`} rule={rule} agents={agents || []}
              busy={busy} onSave={saveSettings} />
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
          <RunHistory runs={detail.runs || []} />
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
            <span className="dim mono">{cadenceLabel(r)}{nextRunLabel(r) ? ` · ${nextRunLabel(r)}` : ''}</span>
          </button>
        ))}
        {rulesList !== null && rulesList.length === 0 ? (
          <p className="dim">No standing rules yet — describe one above, or start from the weekly brief template.</p>
        ) : null}
      </div>
    </div>
  );
}

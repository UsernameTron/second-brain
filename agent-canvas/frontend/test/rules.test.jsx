// P5 Rules & Briefs UI contracts: instruction → 10-field interpretation card,
// rehearsal gates activation (edit re-disables), activation, run history with
// brief markdown + evidence refs, pause/revoke, empty and parse-error states,
// and NEEDS YOU rule_alert / brief_ready labels + Acknowledge.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', async (importOriginal) => {
  const real = await importOriginal();
  const api = vi.fn();
  return { ...real, api, rulesApi: real.makeRulesApi(api) };
});

import { api } from '../src/api.js';
import RulesView from '../src/RulesView.jsx';
import NeedsYouView from '../src/NeedsYouView.jsx';

const OWNER = { email: 'pete@cloudtechgurus.com', role: 'owner' };
const AGENTS = [{ id: 'a1', name: 'Scout', role: 'research' }];
// Field-for-field what server/standing-rules.js validateInterpretation() emits —
// the seam only holds if these fixtures stay the backend's real shape.
const INTERP = {
  summary: 'inbound deals', sources: ['hubspot'], scope: 'deals over $25k',
  category: 'watch', output_type: 'alert', cadence: 'daily', cadence_hour: 8, cadence_day: null,
  agent_id: 'a1', step_budget: 8, wall_ms_budget: 120000, expires_days: 30,
  can: ['read CRM records'], cannot: ['send email', 'change records'],
};
// ruleView() = the raw row spread + parsed `interpretation` and `source_scope`.
const DRAFT_RULE = {
  id: 'sr1', canvas_id: 'c1', agent_id: 'a1', owner_email: 'pete@cloudtechgurus.com',
  instruction: 'Watch inbound deals and raise anything unusual',
  interpretation_json: JSON.stringify(INTERP),
  interpretation: INTERP,
  source_scope_json: JSON.stringify({ sources: INTERP.sources, scope: INTERP.scope }),
  source_scope: { sources: INTERP.sources, scope: INTERP.scope },
  category: 'watch', version: 1, rehearsal_run_id: null,
  output_type: 'alert', cadence: 'daily', cadence_hour: 8, cadence_day: null,
  step_budget: 8, wall_ms_budget: 120000, state: 'draft', expires_at: null,
  last_run_at: null, next_run_at: null,
  created_by: 'pete@cloudtechgurus.com', created_at: new Date().toISOString(),
};
const REHEARSAL_DONE = { id: 'r1', status: 'completed', summary: 'Would have matched 3 deals in the last 7 days.' };

function renderRules(props = {}) {
  return render(<RulesView user={OWNER} canvasId="c1" agents={AGENTS} toast={vi.fn()} {...props} />);
}

async function parseFlow() {
  await userEvent.type(screen.getByLabelText('Describe the standing rule'), 'watch inbound deals');
  await userEvent.click(screen.getByRole('button', { name: 'Interpret' }));
  await screen.findByText('What this rule means');
}

beforeEach(() => { api.mockReset(); });

describe('Rules & Briefs view', () => {
  it('shows the empty state and the weekly-brief prefill template', async () => {
    api.mockResolvedValue({ rules: [] });
    renderRules();
    expect(await screen.findByText(/No standing rules yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Weekly brief template' }));
    expect(screen.getByLabelText('Describe the standing rule').value).toMatch(/weekly operating brief/);
  });

  it('parse renders the interpretation card with all 10 plain-language fields', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') return Promise.resolve({ rule: DRAFT_RULE });
      return Promise.resolve({});
    });
    renderRules();
    await parseFlow();
    for (const label of ['Watched', 'Sources', 'Scope', 'Cadence', 'Run by', 'Reads as', 'Output', 'Budget', 'Expires', 'Can', 'Cannot', 'Next run']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('inbound deals')).toBeInTheDocument();
    expect(screen.getByText('hubspot')).toBeInTheDocument();
    expect(screen.getByText('deals over $25k')).toBeInTheDocument();
    expect(screen.getAllByText('daily at 08:00 UTC').length).toBeGreaterThan(0);
    // owner_email is the CREATOR (db.js says so verbatim); the identity whose
    // access the rule spends is a separate field.
    expect(screen.getByText('Scout (research), created by pete@cloudtechgurus.com')).toBeInTheDocument();
    expect(screen.getByText(/whoever rehearses and activates it/)).toBeInTheDocument();
    expect(screen.getByText('an alert, only when something matches')).toBeInTheDocument();
    expect(screen.getByText('8 steps · 2 min per run')).toBeInTheDocument();
    // The card states the authority activation will actually grant
    // (interpretation.expires_days), not a hardcoded 90.
    expect(screen.getByText('30 days after activation')).toBeInTheDocument();
    expect(screen.getByText('read CRM records')).toBeInTheDocument();
    expect(screen.getByText('send email; change records')).toBeInTheDocument();
    expect(screen.getByText('computed at activation')).toBeInTheDocument();
  });

  it('shows a parse-error state when the instruction cannot be interpreted', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') {
        return Promise.reject(Object.assign(new Error('could not parse the instruction'), { status: 502 }));
      }
      return Promise.resolve({});
    });
    renderRules();
    await parseFlow().catch(() => {});
    expect(await screen.findByRole('alert')).toHaveTextContent('could not parse the instruction');
    // Still on the list screen — the instruction box is there to retry.
    expect(screen.getByLabelText('Describe the standing rule')).toBeInTheDocument();
  });

  it('activate stays disabled until a completed rehearsal, and an edit re-disables it', async () => {
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') {
        const body = (opts && opts.body) || {};
        return Promise.resolve({ rule: { ...DRAFT_RULE, instruction: body.instruction, state: 'draft' } });
      }
      if (path === '/api/standing-rules/sr1/rehearse') {
        return Promise.resolve({ rule: { ...DRAFT_RULE, state: 'rehearsed' }, run: { id: 'r1', status: 'queued' } });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: { ...DRAFT_RULE, state: 'rehearsed' }, authorization: null, runs: [], rehearsalRun: REHEARSAL_DONE });
      }
      return Promise.resolve({});
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderRules();
    await parseFlow();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Rehearse' }));
    await vi.advanceTimersByTimeAsync(2000);
    await screen.findByText(/Would have matched 3 deals/);
    vi.useRealTimers();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Rule instruction'), ' and flag renewals');
    fireEvent.blur(screen.getByLabelText('Rule instruction'));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/canvases/c1/standing-rules/parse',
        expect.objectContaining({ body: expect.objectContaining({ rule_id: 'sr1' }) }));
    });
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
  });

  // PATCH reuses the stored interpretation verbatim, so an instruction edit used
  // to leave nine of the ten card fields describing the pre-edit rule — and the
  // dispatched instruction contradicting itself ("daily watch … summarize my
  // Gmail inbox. Sources: hubspot"). Activation would then freeze a grant built
  // from the stale scope. An edit has to re-interpret.
  it('re-interprets the whole rule on an instruction edit, not just the free text', async () => {
    const REPARSED = {
      summary: 'Gmail inbox digest', sources: ['gmail'], scope: 'unread mail from the last day',
      category: 'brief', output_type: 'brief', cadence: 'hourly', cadence_hour: null, cadence_day: null,
      agent_id: 'a1', step_budget: 8, wall_ms_budget: 120000, expires_days: 30,
      can: ['read mail'], cannot: ['send email'],
    };
    const active = { ...DRAFT_RULE, state: 'active', next_run_at: '2026-08-16T08:00:00Z' };
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [active] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') {
        return Promise.resolve({
          rule: {
            ...DRAFT_RULE, instruction: opts.body.instruction, state: 'draft', version: 2,
            interpretation: REPARSED, interpretation_json: JSON.stringify(REPARSED),
            source_scope: { sources: REPARSED.sources, scope: REPARSED.scope },
            cadence: 'hourly', output_type: 'brief', next_run_at: null,
          },
        });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: active, authorization: null, runs: [], rehearsalRun: REHEARSAL_DONE });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    expect(await screen.findByText('deals over $25k')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Rule instruction'));
    await userEvent.type(screen.getByLabelText('Rule instruction'), 'Every hour, summarize my Gmail inbox');
    fireEvent.blur(screen.getByLabelText('Rule instruction'));

    // It went through the re-interpret endpoint carrying the rule id — not PATCH.
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/canvases/c1/standing-rules/parse', {
        method: 'POST', body: { instruction: 'Every hour, summarize my Gmail inbox', rule_id: 'sr1' },
      });
    });
    expect(api.mock.calls.some(([, o]) => o && o.method === 'PATCH')).toBe(false);
    // Every field re-derived: no HubSpot scope, no daily cadence, left over.
    expect(await screen.findByText('Gmail inbox digest')).toBeInTheDocument();
    expect(screen.getByText('gmail')).toBeInTheDocument();
    expect(screen.getByText('unread mail from the last day')).toBeInTheDocument();
    expect(screen.getAllByText('every hour').length).toBeGreaterThan(0);
    expect(screen.queryByText('deals over $25k')).toBeNull();
    expect(screen.queryByText('hubspot')).toBeNull();
    expect(screen.getByText('a written brief with sources')).toBeInTheDocument();
  });

  // Re-parsing the prose re-derives all ten fields from the model, and
  // validateInterpretation silently defaults cadence_hour to 8, step_budget to
  // 12 and expires_days to 90 when the model omits them — so "move this brief
  // from Monday to Friday" or "give it more steps" had no honest path, and
  // step/time budget have no plain-language vocabulary at all. The structured
  // form goes through PATCH: no model, nothing drifts that wasn't typed.
  it('edits structured fields through PATCH without re-parsing the instruction', async () => {
    const weekly = {
      ...DRAFT_RULE, state: 'active', cadence: 'weekly', cadence_day: 1, cadence_hour: 8,
      next_run_at: '2026-08-17T08:00:00Z',
      interpretation: { ...INTERP, cadence: 'weekly', cadence_day: 1 },
    };
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [weekly] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1' && opts && opts.method === 'PATCH') {
        const i = opts.body.interpretation;
        return Promise.resolve({
          rule: {
            ...weekly, state: 'draft', version: 2, rehearsal_run_id: null, next_run_at: null,
            cadence: i.cadence, cadence_day: i.cadence_day, cadence_hour: i.cadence_hour,
            step_budget: i.step_budget, wall_ms_budget: i.wall_ms_budget,
            interpretation: i, interpretation_json: JSON.stringify(i),
          },
        });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: weekly, authorization: null, runs: [], rehearsalRun: null });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    expect((await screen.findAllByText('weekly on Monday at 08:00 UTC')).length).toBeGreaterThan(0);

    // Collapsed by default — the plain-language card stays the primary view,
    // and a closed panel renders no controls at all.
    expect(screen.queryByLabelText('Step budget')).toBeNull();
    await userEvent.click(screen.getByText('Settings — cadence, sources, budget, expiry'));

    await userEvent.selectOptions(await screen.findByLabelText('Day'), '5');
    await userEvent.clear(screen.getByLabelText('Step budget'));
    await userEvent.type(screen.getByLabelText('Step budget'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/standing-rules/sr1', expect.objectContaining({
        method: 'PATCH',
        body: {
          interpretation: expect.objectContaining({
            cadence: 'weekly', cadence_day: 5, cadence_hour: 8, step_budget: 20,
            wall_ms_budget: 120000, expires_days: 30, output_type: 'alert',
            agent_id: 'a1', sources: ['hubspot'], scope: 'deals over $25k',
            // Model-written prose the form never touches — blanking it would
            // empty two consent-card fields.
            summary: 'inbound deals', can: ['read CRM records'],
            cannot: ['send email', 'change records'],
          }),
        },
      }));
    });
    // The prose was untouched, so it must NOT have gone through the model.
    expect(api.mock.calls.some(([p]) => p === '/api/canvases/c1/standing-rules/parse')).toBe(false);
    // And the gate reset: back to draft, Activate held until a fresh rehearsal.
    expect((await screen.findAllByText('weekly on Friday at 08:00 UTC')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
  });

  // A re-interpretation that failed changed nothing server-side — the parse
  // route returns before upsertDraft on every error path. But the edited words
  // stayed in the textarea and the heading while the server still held the old
  // rule AND its completed rehearsal, so Activate came back enabled: the owner
  // could authorize an instruction that was never interpreted, reading a screen
  // that described it. The screen has to go back to what the server holds, and
  // has to say that it did.
  it('restores the saved instruction when a re-interpretation fails, so Activate cannot authorize an invisible rule', async () => {
    const rehearsed = { ...DRAFT_RULE, state: 'rehearsed' };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [rehearsed] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') {
        return Promise.reject(Object.assign(new Error('rule interpretation failed to produce valid JSON'), { status: 502 }));
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: rehearsed, authorization: null, runs: [], rehearsalRun: REHEARSAL_DONE });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    await userEvent.type(await screen.findByLabelText('Rule instruction'), ' and flag renewals');
    fireEvent.blur(screen.getByLabelText('Rule instruction'));
    expect(await screen.findByRole('alert')).toHaveTextContent('rule interpretation failed to produce valid JSON');
    expect(screen.getByRole('alert')).toHaveTextContent(/rule is unchanged/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/restored to the saved instruction/i);

    // The edit is gone from every surface that describes what Activate would
    // authorize — textarea and heading both back to the stored prose.
    await waitFor(() => expect(screen.getByLabelText('Rule instruction').value).toBe(DRAFT_RULE.instruction));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(DRAFT_RULE.instruction);
    // Activate is live again (the server's rehearsal survived) — and now it
    // grants exactly the rule on screen.
    expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();
  });

  // Blur fires the re-parse; "← Rules" clears the detail before it lands. The
  // updater then spread a null `cur` and set detail again — reopening the rule
  // with its runs and authorization gone. Every async response in this view now
  // writes through one guard keyed on the rule it was issued for.
  it('a late edit response cannot reopen a rule the owner already left', async () => {
    const rehearsed = { ...DRAFT_RULE, state: 'rehearsed' };
    let landParse;
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [rehearsed] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') {
        return new Promise((res) => {
          landParse = () => res({ rule: { ...rehearsed, instruction: opts.body.instruction, state: 'draft', version: 2 } });
        });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: rehearsed, authorization: null, runs: [], rehearsalRun: REHEARSAL_DONE });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    await userEvent.type(await screen.findByLabelText('Rule instruction'), ' and flag renewals');
    fireEvent.blur(screen.getByLabelText('Rule instruction'));
    await userEvent.click(screen.getByRole('button', { name: '← Rules' }));
    expect(screen.queryByText('What this rule means')).toBeNull();

    await act(async () => { landParse(); });
    expect(screen.queryByText('What this rule means')).toBeNull();
    expect(screen.getByLabelText('Describe the standing rule')).toBeInTheDocument();
  });

  // The server marks the rule `rehearsed` the moment a rehearsal is dispatched,
  // so the state check alone would accept a second dispatch while the first run
  // is still queued/running — concurrent model runs, duplicate budget, and the
  // rule pointing at whichever rehearsal landed last. The run's own state, not
  // the request's, is what has to hold the button.
  it('keeps Rehearse disabled while its run is in flight, and re-enables once it completes', async () => {
    let runStatus = 'queued';
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') return Promise.resolve({ rule: DRAFT_RULE });
      if (path === '/api/standing-rules/sr1/rehearse') {
        return Promise.resolve({ rule: { ...DRAFT_RULE, state: 'rehearsed' }, run: { id: 'r1', status: 'queued' } });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({
          rule: { ...DRAFT_RULE, state: 'rehearsed' }, authorization: null, runs: [],
          rehearsalRun: runStatus === 'completed' ? REHEARSAL_DONE : { id: 'r1', status: runStatus },
        });
      }
      return Promise.resolve({});
    });
    const dispatches = () => api.mock.calls.filter(([p]) => p === '/api/standing-rules/sr1/rehearse').length;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderRules();
    await parseFlow();
    expect(screen.getByRole('button', { name: 'Rehearse' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Rehearse' }));
    // Disabled as soon as the dispatch returns — the POST resolving is not the
    // rehearsal finishing.
    expect(await screen.findByRole('button', { name: 'Rehearsing…' })).toBeDisabled();
    expect(dispatches()).toBe(1);

    // Two poll cycles with the run still nonterminal: still held, and clicks in
    // that window launch nothing.
    runStatus = 'running';
    await vi.advanceTimersByTimeAsync(3200);
    expect(screen.getByRole('button', { name: 'Rehearsing…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Rehearsing…' }));
    expect(dispatches()).toBe(1);

    runStatus = 'completed';
    await vi.advanceTimersByTimeAsync(1600);
    await screen.findByText(/Would have matched 3 deals/);
    vi.useRealTimers();
    expect(screen.getByRole('button', { name: 'Rehearse' })).toBeEnabled();
  });

  it('owner activates a rehearsed rule', async () => {
    const rehearsed = { ...DRAFT_RULE, state: 'rehearsed' };
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [rehearsed] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1/activate' && opts && opts.method === 'POST') {
        return Promise.resolve({
          rule: { ...rehearsed, state: 'active', next_run_at: '2026-08-16T08:00:00Z' },
          authorization: { authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-11-14T08:00:00Z', revoked_at: null },
        });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: rehearsed, authorization: null, runs: [], rehearsalRun: REHEARSAL_DONE });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    const activateBtn = await screen.findByRole('button', { name: 'Activate' });
    expect(activateBtn).toBeEnabled();
    await userEvent.click(activateBtn);
    expect(api).toHaveBeenCalledWith('/api/standing-rules/sr1/activate', { method: 'POST', body: {} });
    expect(await screen.findByText('active')).toBeInTheDocument();
    expect(screen.getByText('2026-08-16 08:00 UTC')).toBeInTheDocument(); // next run now scheduled
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('renders run history with brief markdown and an evidence-refs footer', async () => {
    const briefRule = {
      ...DRAFT_RULE, id: 'sr2', instruction: 'Prepare my weekly operating brief',
      output_type: 'brief', cadence: 'weekly', cadence_day: 1, state: 'active',
      next_run_at: '2026-08-17T08:00:00Z',
    };
    // Rule-run rows arrive as the raw standing_rule_runs row plus parsed
    // output_refs / retry_run_ids; refs are server/evidence.js rowToRef objects.
    const refs = [
      { id: 'ev-1', sourceKind: 'memory', title: 'Acme renewal note', uri: null },
      { id: 'ev-2', sourceKind: 'web', title: null, uri: 'https://acme.example/renewal' },
    ];
    const briefRun = {
      id: 'rr1', rule_id: 'sr2', state: 'completed', occurrence_key: '2026-W33', matched_count: null,
      skip_reason: null, error: null, cost_usd: 0,
      result_summary: '## Weekly brief\n- **Acme** renewal moved to legal\nAll quiet otherwise\nNOTHING MATCHED',
      output_refs_json: JSON.stringify(refs), output_refs: refs,
      retry_run_ids_json: '[]', retry_run_ids: [],
      created_at: new Date().toISOString(),
    };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [briefRule] });
      if (path === '/api/standing-rules/sr2/runs') return Promise.resolve({ runs: [briefRun] });
      if (path === '/api/standing-rules/sr2') {
        return Promise.resolve({
          rule: briefRule, runs: [],
          authorization: { authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-11-14T08:00:00Z', revoked_at: null },
          rehearsalRun: null,
        });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText('Prepare my weekly operating brief'));
    expect(await screen.findByRole('heading', { name: 'Weekly brief' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument(); // **bold** renders as <b>
    expect(screen.getByText('All quiet otherwise')).toBeInTheDocument();
    // The machine contract line stays in the API payload but never renders.
    expect(screen.queryByText(/NOTHING MATCHED/)).toBeNull();
    expect(screen.getByText('Evidence: Acme renewal note · https://acme.example/renewal')).toBeInTheDocument();
    expect(screen.getByText(/Authorized by/)).toBeInTheDocument();
    expect(screen.getByText('2026-W33')).toBeInTheDocument();
  });

  // The NEEDS YOU brief_ready card advertises open_rule and shows only ~300
  // chars; the deep link has to land on the detail, full brief and refs included.
  it('focusRuleId opens that rule detail on mount, with the full brief and refs', async () => {
    const briefRule = { ...DRAFT_RULE, output_type: 'brief', state: 'active' };
    const refs = [{ id: 'ev-1', sourceKind: 'memory', title: 'Acme renewal note', uri: null }];
    const run = {
      id: 'rr1', rule_id: 'sr1', state: 'completed', occurrence_key: '2026-W33',
      result_summary: '## Weekly brief\n- **Acme** renewal moved to legal',
      output_refs: refs, created_at: new Date().toISOString(),
    };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [briefRule] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [run] });
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: briefRule, authorization: null, runs: [], rehearsalRun: null });
      }
      return Promise.resolve({});
    });
    const { container } = renderRules({ focusRuleId: 'sr1' });
    // Detail screen, not the list — no click needed.
    expect(await screen.findByText('What this rule means')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Rules' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Weekly brief' })).toBeInTheDocument();
    expect(screen.getByText('Evidence: Acme renewal note')).toBeInTheDocument();
    // Run-state chips carry a class that actually has CSS behind it.
    expect(container.querySelector('.chip.run-completed')).not.toBeNull();
    expect(container.querySelector('[class*="inq-"]')).toBeNull();
  });

  // The card's only identity field named the creator, while the grant is spent
  // as whoever activates and the rehearsal read as whoever ran it. The owner
  // could read "owned by pete@" over a rehearsal of darren@'s mailbox and grant
  // against his own. The acting identity has to be on the card.
  it('names the identity the rule actually reads as, not the creator', async () => {
    const rehearsed = { ...DRAFT_RULE, state: 'rehearsed' };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [rehearsed] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({
          rule: rehearsed, authorization: null, runs: [],
          rehearsalRun: { ...REHEARSAL_DONE, initiated_by: 'darren@cloudtechgurus.com' },
        });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    expect(await screen.findByText('Reads as')).toBeInTheDocument();
    expect(screen.getByText('darren@cloudtechgurus.com')).toBeInTheDocument();
    expect(screen.getByText('Scout (research), created by pete@cloudtechgurus.com')).toBeInTheDocument();
  });

  // next_run_at survives pause/revoke/expire, and the whole scheduling lane can
  // be absent (TICK_AUDIENCE unset) while a rule reads "active · next 08:00".
  // A promise nothing will keep is the fake green.
  it('never promises a next run for a stopped rule, and flags an overdue one', async () => {
    const past = new Date(Date.now() - 3 * 3600_000).toISOString();
    const paused = { ...DRAFT_RULE, id: 'sr9', instruction: 'paused rule', state: 'paused', next_run_at: '2099-01-01T08:00:00Z' };
    const overdue = { ...DRAFT_RULE, instruction: 'overdue rule', state: 'active', next_run_at: past };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [paused, overdue] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1') return Promise.resolve({ rule: overdue, authorization: null, runs: [], rehearsalRun: null });
      return Promise.resolve({});
    });
    renderRules();
    await screen.findByText('paused rule');
    expect(screen.queryByText(/2099-01-01/)).toBeNull(); // a stopped rule promises nothing
    expect(screen.getByText(/overdue, nothing has run it/)).toBeInTheDocument();

    // And the same honesty on the consent card.
    await userEvent.click(screen.getByText('overdue rule'));
    expect(await screen.findByText(/Check STANDING RULES · TICK/)).toBeInTheDocument();
  });

  // The server now NULLs next_run_at on pause/revoke/expire, but rows written
  // before that still carry a stale future value — so the card has to read the
  // STATE, not the column. "computed at activation" is its own false promise on
  // a revoked rule: there is no activation left to compute one.
  it('the consent card states why a stopped rule has no next run, whatever the column holds', async () => {
    const stale = '2099-01-01T08:00:00Z';
    const paused = { ...DRAFT_RULE, instruction: 'paused rule', state: 'paused', next_run_at: stale };
    const revoked = { ...DRAFT_RULE, id: 'sr9', instruction: 'revoked rule', state: 'revoked', next_run_at: stale };
    let current = paused;
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [paused, revoked] });
      if (path === '/api/standing-rules/sr1/runs' || path === '/api/standing-rules/sr9/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1' || path === '/api/standing-rules/sr9') {
        return Promise.resolve({ rule: current, authorization: null, runs: [], rehearsalRun: null });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText('paused rule'));
    expect(await screen.findByText('paused — nothing runs until it is resumed')).toBeInTheDocument();
    expect(screen.queryByText(/2099-01-01/)).toBeNull();
    expect(screen.queryByText('computed at activation')).toBeNull();

    current = revoked;
    await userEvent.click(screen.getByRole('button', { name: '← Rules' }));
    await userEvent.click(await screen.findByText('revoked rule'));
    expect(await screen.findByText('never — the authorization is revoked')).toBeInTheDocument();
    expect(screen.queryByText(/2099-01-01/)).toBeNull();
    expect(screen.queryByText('computed at activation')).toBeNull();
  });

  // Revoke returned only { rule }, ceremony merged only { rule }, and no refetch
  // path exists — so the block kept rendering the pre-revoke grant, expiry date
  // and all. The `· revoked` marker was dead on every path.
  it('replaces the authorization block on revoke instead of leaving the pre-revoke grant on screen', async () => {
    const active = { ...DRAFT_RULE, state: 'active', next_run_at: '2026-08-16T08:00:00Z' };
    const live = { authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-11-14T08:00:00Z', revoked_at: null };
    const dead = { ...live, revoked_at: '2026-08-15T09:30:00Z', revoked_by: 'pete@cloudtechgurus.com' };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [active] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      // The revoked grant comes back with the ceremony — there is nothing to
      // re-poll, so a response that omits it can only leave a stale block.
      if (path === '/api/standing-rules/sr1/revoke') {
        return Promise.resolve({ rule: { ...active, state: 'revoked' }, authorization: dead });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: active, authorization: live, runs: [], rehearsalRun: null });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    expect(await screen.findByText(/expires 2026-11-14 08:00 UTC/)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText(/revoked 2026-08-15 09:30 UTC/)).toBeInTheDocument();
    // The expiry is not a fact about a revoked grant any more.
    expect(screen.queryByText(/expires 2026-11-14/)).toBeNull();
    expect(screen.getByText(/Authorized by/)).toBeInTheDocument();
    // …and the revoked row must not keep the card claiming whose access the
    // (now impossible) runs would spend.
    expect(screen.getByText('nobody — the grant from pete@cloudtechgurus.com was revoked')).toBeInTheDocument();
    expect(screen.getByText('never — the authorization is revoked')).toBeInTheDocument();
  });

  // pause/resume return no authorization; merging d.authorization must not blank
  // the block they never spoke about.
  it('keeps the authorization block through pause and resume', async () => {
    const active = { ...DRAFT_RULE, state: 'active', next_run_at: '2026-08-16T08:00:00Z' };
    const live = { authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-11-14T08:00:00Z', revoked_at: null };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [active] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1/pause') return Promise.resolve({ rule: { ...active, state: 'paused', next_run_at: null } });
      if (path === '/api/standing-rules/sr1/resume') return Promise.resolve({ rule: active });
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: active, authorization: live, runs: [], rehearsalRun: null });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('paused — nothing runs until it is resumed')).toBeInTheDocument();
    expect(screen.getByText(/expires 2026-11-14 08:00 UTC/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByText('2026-08-16 08:00 UTC')).toBeInTheDocument();
    expect(screen.getByText(/expires 2026-11-14 08:00 UTC/)).toBeInTheDocument();
  });

  // A draft or rehearsed rule cannot run — the tick's due query only selects
  // `active` — but the authorization block kept rendering "Authorized by … ·
  // expires …" from before the edit, asserting a live grant on a rule
  // enforcement had already stopped honouring. The claim has to go the moment
  // the edit lands, with no reload: the edit response carries the retired grant
  // and the rule's STATE decides what may be claimed.
  it('drops the live-grant claim the moment an edit lands, with no reload', async () => {
    const active = { ...DRAFT_RULE, state: 'active', next_run_at: '2026-08-16T08:00:00Z' };
    const live = { authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-11-14T08:00:00Z', revoked_at: null };
    const retired = { ...live, revoked_at: '2026-08-16T09:30:00Z', revoked_by: 'pete@cloudtechgurus.com' };
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [active] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/canvases/c1/standing-rules/parse') {
        return Promise.resolve({
          rule: { ...active, instruction: opts.body.instruction, state: 'draft', version: 2, next_run_at: null },
          authorization: retired,
        });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: active, authorization: live, runs: [], rehearsalRun: null });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    expect(await screen.findByText(/Authorized by/)).toBeInTheDocument();
    expect(screen.getByText(/expires 2026-11-14 08:00 UTC/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Rule instruction'), ' over $75k');
    fireEvent.blur(screen.getByLabelText('Rule instruction'));

    // No live authorization is claimed anywhere on the screen any more — and
    // the block renders the RETIRED row the edit response carried, timestamp
    // included, not the pre-edit one relabelled.
    expect(await screen.findByText(/Previously authorized by/)).toBeInTheDocument();
    expect(screen.getByText(/retired 2026-08-16 09:30 UTC when the rule changed/)).toBeInTheDocument();
    expect(screen.getByText(/not a live authorization/)).toBeInTheDocument();
    expect(screen.queryByText(/expires 2026-11-14/)).toBeNull();
    // "Authorized by" without the "Previously" prefix is the claim being fixed.
    expect(screen.queryByText((_, el) => el?.tagName === 'P' && /^Authorized by/.test(el.textContent))).toBeNull();
    // And the retired grantor is not who the rule would read as next.
    expect(screen.getByText(/not yet established/)).toBeInTheDocument();
  });

  // The rehearsal is the review, and after an edit it is the only identity the
  // owner is being asked to accept. Falling back to the retired grant named an
  // identity the next run has no claim on — the grantor may not even rehearse it.
  it('a rehearsed rule reads as its rehearser, never as the retired grantor', async () => {
    const rehearsed = { ...DRAFT_RULE, state: 'rehearsed', version: 2 };
    const retired = {
      authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-11-14T08:00:00Z',
      revoked_at: '2026-08-16T09:30:00Z', revoked_by: 'pete@cloudtechgurus.com',
    };
    api.mockImplementation((path) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [rehearsed] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({
          rule: rehearsed, authorization: retired, runs: [],
          rehearsalRun: { ...REHEARSAL_DONE, initiated_by: 'darren@cloudtechgurus.com' },
        });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    expect(await screen.findByText('Reads as')).toBeInTheDocument();
    expect(screen.getByText('darren@cloudtechgurus.com')).toBeInTheDocument();
    // The retired grantor is named only as history, never as the acting identity.
    expect(screen.getByText(/Previously authorized by/)).toBeInTheDocument();
    expect(screen.queryByText(/nobody — the grant from/)).toBeNull();
  });

  // Re-activation is what makes a grant live again; the historical line has to
  // give way to the new one rather than sit beside it.
  it('replaces the retired grant with the new live one on re-activation', async () => {
    const rehearsed = { ...DRAFT_RULE, state: 'rehearsed', version: 2 };
    const retired = {
      authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-09-01T08:00:00Z',
      revoked_at: '2026-08-16T09:30:00Z', revoked_by: 'pete@cloudtechgurus.com',
    };
    const fresh = { authorized_by: 'pete@cloudtechgurus.com', expires_at: '2026-12-01T08:00:00Z', revoked_at: null };
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [rehearsed] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1/activate' && opts && opts.method === 'POST') {
        return Promise.resolve({
          rule: { ...rehearsed, state: 'active', next_run_at: '2026-08-17T08:00:00Z' },
          authorization: fresh,
        });
      }
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: rehearsed, authorization: retired, runs: [], rehearsalRun: REHEARSAL_DONE });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    expect(await screen.findByText(/Previously authorized by/)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Activate' }));
    expect(await screen.findByText(/expires 2026-12-01 08:00 UTC/)).toBeInTheDocument();
    expect(screen.queryByText(/Previously authorized by/)).toBeNull();
    expect(screen.queryByText(/when the rule changed/)).toBeNull();
    // …and the live grantor is now who the rule reads as.
    expect(screen.getByText('Reads as').closest('li')).toHaveTextContent('pete@cloudtechgurus.com');
    expect(screen.queryByText(/not yet established/)).toBeNull();
  });

  it('owner can pause, resume, and revoke', async () => {
    const active = { ...DRAFT_RULE, state: 'active', next_run_at: '2026-08-16T08:00:00Z' };
    api.mockImplementation((path, opts) => {
      if (path === '/api/canvases/c1/standing-rules') return Promise.resolve({ rules: [active] });
      if (path === '/api/standing-rules/sr1/runs') return Promise.resolve({ runs: [] });
      if (path === '/api/standing-rules/sr1/pause') return Promise.resolve({ rule: { ...active, state: 'paused' } });
      if (path === '/api/standing-rules/sr1/resume') return Promise.resolve({ rule: active });
      if (path === '/api/standing-rules/sr1/revoke') return Promise.resolve({ rule: { ...active, state: 'revoked' } });
      if (path === '/api/standing-rules/sr1') {
        return Promise.resolve({ rule: active, authorization: null, runs: [], rehearsalRun: null });
      }
      return Promise.resolve({});
    });
    renderRules();
    await userEvent.click(await screen.findByText(DRAFT_RULE.instruction));
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(api).toHaveBeenCalledWith('/api/standing-rules/sr1/pause', { method: 'POST', body: {} });
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(api).toHaveBeenCalledWith('/api/standing-rules/sr1/resume', { method: 'POST', body: {} });
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(api).toHaveBeenCalledWith('/api/standing-rules/sr1/revoke', { method: 'POST', body: {} });
    expect(await screen.findByText('revoked')).toBeInTheDocument();
    // Revoked rules offer no further ceremony.
    expect(screen.queryByRole('button', { name: 'Rehearse' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});

describe('NEEDS YOU standing-rule cards', () => {
  const baseRow = {
    owner: { email: null, agentId: null }, context: '', contextData: null,
    consequence: 'unreviewed output goes stale', recommendation: '',
    created_at: new Date().toISOString(),
  };
  // sourceRef is server/attention.js standingRuleCards() shape — ruleId is what
  // the Open-rule control deep-links on.
  const rows = [
    { ...baseRow, type: 'rule_alert', sourceRef: { kind: 'standing_rule_run', id: 'rr1', ruleId: 'sr1', canvasId: 'c1' }, decision: '3 deals matched the inbound-deal watch' },
    { ...baseRow, type: 'brief_ready', sourceRef: { kind: 'standing_rule_run', id: 'rr2', ruleId: 'sr2', canvasId: 'c1' }, decision: 'Your weekly brief is ready' },
  ];

  function renderNeedsYou(props = {}) {
    return render(
      <NeedsYouView
        rows={rows} userEmail={OWNER.email} agentsById={{}} people={[]} agents={[]}
        onResolveEscalation={vi.fn()} onAssign={vi.fn()} onOpenMemory={vi.fn()} onOpenRun={vi.fn()}
        onOpenWorkbook={vi.fn()} onRetryRun={vi.fn()} onExtendReview={vi.fn()} onAcknowledgeRuleRun={vi.fn()}
        {...props}
      />
    );
  }

  it('labels rule_alert and brief_ready cards and acknowledges through the source run', async () => {
    const ack = vi.fn();
    renderNeedsYou({ onAcknowledgeRuleRun: ack });
    expect(screen.getByText('rule alert')).toBeInTheDocument();
    expect(screen.getByText('brief ready')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Acknowledge' });
    expect(buttons.length).toBe(2);
    await userEvent.click(buttons[0]);
    expect(ack).toHaveBeenCalledWith({ kind: 'standing_rule_run', id: 'rr1', ruleId: 'sr1', canvasId: 'c1' });
  });

  // The card carries only a truncated result — the advertised open_rule action
  // has to be reachable, or acknowledging is the only thing a human can do.
  it('offers Open rule / Open brief and deep-links on the rule id', async () => {
    const openRule = vi.fn();
    renderNeedsYou({ onOpenRule: openRule });
    await userEvent.click(screen.getByRole('button', { name: 'Open rule' }));
    expect(openRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'sr1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open brief' }));
    expect(openRule).toHaveBeenLastCalledWith(expect.objectContaining({ ruleId: 'sr2' }));
  });

  it('hides the control when Rules is flagged off, rather than dead-ending', () => {
    renderNeedsYou({ onOpenRule: null });
    expect(screen.queryByRole('button', { name: 'Open rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open brief' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Acknowledge' }).length).toBe(2);
  });
});

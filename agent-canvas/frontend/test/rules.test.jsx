// P5 Rules & Briefs UI contracts: instruction → 10-field interpretation card,
// rehearsal gates activation (edit re-disables), activation, run history with
// brief markdown + evidence refs, pause/revoke, empty and parse-error states,
// and NEEDS YOU rule_alert / brief_ready labels + Acknowledge.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    for (const label of ['Watched', 'Sources', 'Scope', 'Cadence', 'Run by', 'Output', 'Budget', 'Expires', 'Can', 'Cannot', 'Next run']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('inbound deals')).toBeInTheDocument();
    expect(screen.getByText('hubspot')).toBeInTheDocument();
    expect(screen.getByText('deals over $25k')).toBeInTheDocument();
    expect(screen.getAllByText('daily at 08:00 UTC').length).toBeGreaterThan(0);
    expect(screen.getByText('Scout (research), owned by pete@cloudtechgurus.com')).toBeInTheDocument();
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
      if (path === '/api/canvases/c1/standing-rules/parse') return Promise.resolve({ rule: DRAFT_RULE });
      if (path === '/api/standing-rules/sr1/rehearse') {
        return Promise.resolve({ rule: { ...DRAFT_RULE, state: 'rehearsed' }, run: { id: 'r1', status: 'queued' } });
      }
      if (path === '/api/standing-rules/sr1' && opts && opts.method === 'PATCH') {
        return Promise.resolve({ rule: { ...DRAFT_RULE, instruction: opts.body.instruction, state: 'draft' } });
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
      expect(api).toHaveBeenCalledWith('/api/standing-rules/sr1', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
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
      result_summary: '## Weekly brief\n- **Acme** renewal moved to legal\nAll quiet otherwise',
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

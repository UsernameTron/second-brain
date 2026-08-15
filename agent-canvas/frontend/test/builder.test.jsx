// P4 builder UI contracts: propose renders every permission in plain
// language, unchecking authority persists a PATCH, publish stays disabled
// until a completed rehearsal, and the publish diff renders.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, api: vi.fn() };
});

import { api } from '../src/api.js';
import AgentBuilder from '../src/AgentBuilder.jsx';

const MENU = [
  { name: 'hs_search', description: 'Search HubSpot CRM records' },
  { name: 'ws_gmail_draft', description: 'Create a Gmail draft (never sends)' },
];
const PROPOSAL = {
  name: 'Deal Screener', role: 'commercial', color: '#22c55e',
  business_purpose: 'Screens inbound deals.', inputs: 'Deals', outputs: 'Verdicts',
  operating_instructions: 'Read, compare, record.', authority: ['hs_search'],
  model_tier: 'fast', step_budget: 8, wall_ms_budget: 120000,
  escalation_conditions: 'Deals above $50k.',
};
const DRAFT = { id: 'd1', canvas_id: 'c1', state: 'draft', proposal: PROPOSAL };

function renderBuilder(props = {}) {
  return render(<AgentBuilder canvasId="c1" isOwner onPublished={vi.fn()} toast={vi.fn()} {...props} />);
}

async function proposeFlow() {
  api.mockImplementation((path, opts) => {
    if (path === '/api/agent-drafts/propose') return Promise.resolve({ draft: DRAFT, menu: MENU, dropped: [] });
    if (opts && opts.method === 'PATCH') return Promise.resolve({ draft: { ...DRAFT, proposal: opts.body.proposal }, dropped: [] });
    return Promise.resolve({});
  });
  renderBuilder();
  await userEvent.type(screen.getByLabelText('Describe the job'), 'screen deals');
  await userEvent.click(screen.getByRole('button', { name: 'Propose agent' }));
  await screen.findByText('Deal Screener');
}

beforeEach(() => { api.mockReset(); });

describe('agent builder flow', () => {
  it('renders every permission in plain language with granted state', async () => {
    await proposeFlow();
    expect(screen.getByText('Search HubSpot CRM records')).toBeInTheDocument();
    expect(screen.getByText('Create a Gmail draft (never sends)')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    const granted = boxes.filter((b) => b.checked);
    expect(granted.length).toBe(1); // only hs_search granted
    expect(screen.getByText(/Escalates to a human when/i)).toBeInTheDocument();
  });

  it('toggling authority persists via PATCH and publish stays gated pre-rehearsal', async () => {
    await proposeFlow();
    const gmailLine = screen.getByText('Create a Gmail draft (never sends)').closest('label');
    await userEvent.click(gmailLine.querySelector('input'));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/api/agent-drafts/d1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patch = api.mock.calls.find(([p, o]) => p === '/api/agent-drafts/d1' && o && o.method === 'PATCH');
    expect(patch[1].body.proposal.authority).toEqual(['hs_search', 'ws_gmail_draft']);

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('completed rehearsal enables publish; publish renders the diff', async () => {
    api.mockImplementation((path, opts) => {
      if (path === '/api/agent-drafts/propose') return Promise.resolve({ draft: DRAFT, menu: MENU, dropped: [] });
      if (opts && opts.method === 'PATCH') return Promise.resolve({ draft: DRAFT, dropped: [] });
      if (path === '/api/agent-drafts/d1/rehearse') return Promise.resolve({ draft: { ...DRAFT, state: 'rehearsed' }, run: { id: 'r1', status: 'queued', mode: 'rehearse' } });
      if (path === '/api/agent-drafts/d1') return Promise.resolve({ draft: { ...DRAFT, state: 'rehearsed' }, rehearsalRun: { id: 'r1', status: 'completed', summary: 'I would search HubSpot, then summarize.' } });
      if (path === '/api/agent-drafts/d1/publish') {
        return Promise.resolve({
          agent: { id: 'a1', name: 'Deal Screener', tools_json: JSON.stringify(['hs_search']) },
          diff: { system_prompt: { from: null, to: 'Screens inbound deals.' } }, versionId: 'v1',
        });
      }
      return Promise.resolve({});
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderBuilder();
    await userEvent.type(screen.getByLabelText('Describe the job'), 'screen deals');
    await userEvent.click(screen.getByRole('button', { name: 'Propose agent' }));
    await screen.findByText('Deal Screener');

    await userEvent.click(screen.getByRole('button', { name: /Rehearse/ }));
    await vi.advanceTimersByTimeAsync(2000);
    await screen.findByText(/I would search HubSpot/);
    vi.useRealTimers();

    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeEnabled();
    await userEvent.click(publish);
    await screen.findByText('Published');
    expect(screen.getByText(/Screens inbound deals/)).toBeInTheDocument();
  });
});

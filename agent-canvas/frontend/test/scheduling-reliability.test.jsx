import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => { const real = await original(); const api = vi.fn(); return { ...real, api, rulesApi: real.makeRulesApi(api) }; });
import { api } from '../src/api.js';
import RulesView from '../src/RulesView.jsx';
import AgentBuilder from '../src/AgentBuilder.jsx';
const user = { email: 'owner@example.com', role: 'owner' };
const rule = { id: 'sr1', instruction: 'Review renewals', created_by: user.email, owner_email: user.email, state: 'draft', version: 1, agent_id: 'a1', interpretation: { sources: ['memory'], can: ['read'], cannot: ['send'], scope: 'renewals' } };
const proposal = { name: 'Reviewer', authority: ['search'], operating_instructions: 'Read the brief', escalation_conditions: 'Ask when uncertain', step_budget: 8, wall_ms_budget: 120000, model_tier: 'fast' };
const draft = { id: 'd1', state: 'draft', proposal };
let fail;
let rehearsal;
beforeEach(() => {
  fail = null; rehearsal = null; api.mockReset();
  api.mockImplementation((path, opts) => {
    if (fail?.(path, opts)) return Promise.reject(Object.assign(new Error('network unavailable'), { status: 503 }));
    if (path === '/api/canvases/c1') return Promise.resolve({ access: 'edit', agents: [{ id: 'a1', name: 'Reviewer' }] });
    if (path.endsWith('/standing-rules')) return Promise.resolve({ rules: [rule] });
    if (path.endsWith('/runs')) return Promise.resolve({ runs: [] });
    if (path === '/api/standing-rules/sr1/rehearse') { rehearsal = { id: 'r1', status: 'queued' }; return Promise.resolve({ rule: { ...rule, state: 'rehearsed' }, run: rehearsal }); }
    if (path === '/api/standing-rules/sr1') return Promise.resolve({ rule: { ...rule, state: rehearsal ? 'rehearsed' : 'draft' }, rehearsalRun: rehearsal });
    if (path === '/api/agent-drafts/propose') return Promise.resolve({ draft, menu: [{ name: 'search', description: 'Search records' }], dropped: [] });
    if (path === '/api/agent-drafts/d1/rehearse') { rehearsal = { id: 'r1', status: 'queued' }; return Promise.resolve({ draft: { ...draft, state: 'rehearsed' }, run: rehearsal }); }
    if (path === '/api/agent-drafts/d1') return Promise.resolve({ draft: { ...draft, state: rehearsal ? 'rehearsed' : 'draft', proposal: opts?.body?.proposal || proposal }, rehearsalRun: rehearsal });
    return Promise.resolve({});
  });
});
afterEach(() => vi.useRealTimers());
function rules(props = {}) { return render(<RulesView user={user} canvasId="c1" agents={[]} toast={vi.fn()} {...props} />); }
async function builder() { render(<AgentBuilder canvasId="c1" isOwner toast={vi.fn()} onPublished={vi.fn()} />); await userEvent.type(screen.getByLabelText('Describe the job'), 'Review renewals'); await userEvent.click(screen.getByRole('button', { name: 'Propose agent' })); await screen.findByText('Reviewer'); }
it('reports unavailable scheduled lists without inventing an empty list', async () => {
  fail = (path) => path.endsWith('/standing-rules'); rules();
  await screen.findByText(/Loading scheduled work could not/);
  expect(screen.queryByText(/No standing rules yet/)).not.toBeInTheDocument();
  fail = null; await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Review renewals');
});
it('does not reopen a late parsed rule after the project changes', async () => {
  const impl = api.getMockImplementation(); let finish;
  api.mockImplementation((path, opts) => path.endsWith('/parse') ? new Promise((resolve) => { finish = resolve; }) : impl(path, opts));
  const view = rules(); await screen.findByText('Review renewals');
  await userEvent.type(screen.getByLabelText('Describe the standing rule'), 'A new rule');
  await userEvent.click(screen.getByRole('button', { name: 'Interpret' }));
  view.rerender(<RulesView user={user} canvasId="c2" agents={[]} toast={vi.fn()} />);
  await act(async () => finish({ rule: { ...rule, instruction: 'Obsolete parsed instruction' } }));
  expect(screen.queryByLabelText('Rule instruction')).not.toBeInTheDocument();
  expect(screen.queryByText('Obsolete parsed instruction')).not.toBeInTheDocument();
});
it('retains failed settings and prevents overlapping saves', async () => {
  rules(); await userEvent.click(await screen.findByText('Review renewals'));
  await userEvent.click(await screen.findByText('Settings — cadence, sources, budget, expiry'));
  await userEvent.clear(screen.getByLabelText('Scope')); await userEvent.type(screen.getByLabelText('Scope'), 'My retained scope');
  fail = (_, opts) => opts?.method === 'PATCH';
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText(/Saving scheduled work could not/);
  expect(screen.getByLabelText('Scope')).toHaveValue('My retained scope');
});
it('keeps an unconfirmed instruction edit out of the activation grant', async () => {
  rehearsal = { status: 'completed', initiated_by: user.email };
  const impl = api.getMockImplementation();
  api.mockImplementation((path, opts) => path.endsWith('/parse') ? Promise.reject(Object.assign(new Error('timeout'), { unconfirmed: true })) : impl(path, opts));
  rules(); await userEvent.click(await screen.findByText('Review renewals'));
  await userEvent.type(await screen.findByLabelText('Rule instruction'), ' and risks'); fireEvent.blur(screen.getByLabelText('Rule instruction'));
  await screen.findByText(/Saving scheduled work is not confirmed/);
  expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
  await userEvent.click(screen.getByText('Your unsaved instruction'));
  expect(screen.getByText('Review renewals and risks')).toBeInTheDocument();
  expect(screen.queryByText(/rule is unchanged/)).not.toBeInTheDocument();
});
it('requires the owner to rehearse under the same account before activation', async () => {
  rehearsal = { status: 'completed', initiated_by: 'different@example.com' }; rules();
  await userEvent.click(await screen.findByText('Review renewals'));
  expect(await screen.findByRole('button', { name: 'Activate' })).toBeDisabled();
  expect(screen.getByText(/Rehearse with your own account/)).toBeInTheDocument();
});
it('makes failed rehearsal polling recoverable without dispatching another run', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); rules(); await userEvent.click(await screen.findByText('Review renewals'));
  await userEvent.click(await screen.findByRole('button', { name: 'Rehearse' })); fail = (path) => path === '/api/standing-rules/sr1';
  await act(async () => vi.advanceTimersByTimeAsync(1600));
  await screen.findByText(/Checking the rehearsal could not/);
  expect(screen.getByRole('button', { name: 'Rehearsing…' })).toBeDisabled();
  fail = null; rehearsal = { status: 'completed', initiated_by: user.email };
  await userEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await act(async () => vi.advanceTimersByTimeAsync(1600));
  expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();
});
it('retains failed builder edits and keeps publication unavailable', async () => {
  await builder(); fail = (_, opts) => opts?.method === 'PATCH';
  await userEvent.type(screen.getByLabelText('Operating instructions'), ' carefully'); fireEvent.blur(screen.getByLabelText('Operating instructions'));
  await screen.findByText(/Saving this agent could not/);
  expect(screen.getByLabelText('Operating instructions')).toHaveValue('Read the brief carefully');
  expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});
it('holds queued builder rehearsal and ignores completion after Start over', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); await builder();
  const impl = api.getMockImplementation(); let finish;
  api.mockImplementation((path, opts) => path === '/api/agent-drafts/d1' && !opts ? new Promise((resolve) => { finish = resolve; }) : impl(path, opts));
  await userEvent.click(screen.getByRole('button', { name: 'Rehearse' }));
  expect(screen.getByRole('button', { name: 'Rehearsing…' })).toBeDisabled();
  await act(async () => vi.advanceTimersByTimeAsync(1600));
  await userEvent.click(screen.getByRole('button', { name: /start over/ }));
  await act(async () => finish({ draft: { ...draft, state: 'rehearsed' }, rehearsalRun: { status: 'completed', summary: 'Late result' } }));
  expect(screen.queryByText('Late result')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Describe the job')).toHaveValue('Review renewals');
});

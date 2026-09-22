import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/api.js', async (original) => {
  const actual = await original(), api = vi.fn();
  return { ...actual, api, rulesApi: actual.makeRulesApi(api) };
});
import { api } from '../src/api.js';
import { AppCtx } from '../src/App.jsx';
import Workspace from '../src/Workspace.jsx';

let finish, fail, rows, rejectTeam, teamAgents;
const first = { type: 'escalation', decision: 'Keep the first draft?', canvasName: 'First', owner: { email: 'member@example.com' }, sourceRef: { canvasId: 'c1', id: 'e1' } };
const second = { ...first, decision: 'Keep the other draft?', canvasName: 'Second', sourceRef: { canvasId: 'c2', id: 'e2' } };
beforeEach(() => {
  rows = [first, second];
  rejectTeam = false;
  teamAgents = [{ id: 'a1', name: 'Scout', role: 'research' }];
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  api.mockReset();
  api.mockImplementation((path, options) => {
    if (options?.method === 'POST' || options?.method === 'PATCH') return pending;
    if (path === '/api/canvases') return Promise.resolve({ canvases: [{ id: 'c1', name: 'First', access: 'edit' }, { id: 'c2', name: 'Second', access: 'edit' }] });
    if (rejectTeam && path === '/api/canvases/c1') return Promise.reject(new Error('Team unavailable'));
    if (/^\/api\/canvases\/c[12]$/.test(path)) return Promise.resolve({ canvas: { id: path.split('/').at(-1) }, access: 'edit', agents: teamAgents, notes: [], files: [], people: [{ id: 'p1', email: 'other@example.com' }], runs: [], tasks: [], handoffs: [] });
    if (path.startsWith('/api/attention?')) return Promise.resolve({ attention: path.includes('scope=team') ? [] : rows });
    if (path.endsWith('/inquiries')) return Promise.resolve({ inquiries: [] });
    if (path === '/api/control/status') return Promise.resolve({ paused: false, cost_usd: 0, budget_usd: 25 });
    return Promise.resolve({});
  });
  vi.stubGlobal('WebSocket', class { static OPEN = 1; readyState = 1; send() {} close() {} });
});
const card = (text = first.decision) => within(screen.getByText(text).closest('.ny-card'));
async function open() {
  render(<AppCtx.Provider value={{ user: { role: 'member', email: 'member@example.com' }, config: { inquiryHome: true, needsYou: true }, toast: vi.fn(), setTheme: vi.fn(), setUser: vi.fn(), theme: 'light' }}><Workspace /></AppCtx.Provider>);
  await screen.findByLabelText('Ask a question about the company');
  await returnToQueue();
}
async function returnToQueue() {
  await userEvent.click(screen.getByRole('button', { name: /^Needs you/ }));
  await screen.findByText(first.decision);
}
async function submit() {
  await open();
  await userEvent.click(card().getByRole('button', { name: 'Answer', exact: true }));
  await userEvent.type(card().getByLabelText('Your answer'), 'Keep my submitted answer');
  await userEvent.click(card().getByRole('button', { name: 'Submit answer' }));
}
async function filterAwayAndBack() {
  await userEvent.click(screen.getByRole('tab', { name: 'Team', exact: true }));
  await waitFor(() => expect(screen.queryByText(first.decision)).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('tab', { name: 'Mine', exact: true }));
  await screen.findByText(first.decision);
}
const writes = () => api.mock.calls.filter(([, options]) => ['POST', 'PATCH'].includes(options?.method));

it.each([
  ['escalation', 'Submit answer'], ['conflict', 'Dismiss'], ['overdue_review', 'Confirm still true'],
  ['failed_run', 'Try again'], ['rule_alert', 'Mark reviewed'], ['brief_ready', 'Mark reviewed'],
])('keeps %s submissions guarded across filters and views, including saved state', async (type, button) => {
  rows = [{ ...first, type, dismissKey: type === 'conflict' ? 'conflict-e1' : undefined }, second];
  if (type === 'escalation') await submit();
  else {
    await open();
    if (type === 'conflict') await userEvent.click(card().getByText('Other actions'));
    await userEvent.click(card().getByRole('button', { name: button, exact: true }));
  }
  await filterAwayAndBack();
  expect(card().getByText('Submitting…')).toBeVisible();
  expect(card(second.decision).getByRole('button', { name: 'Answer', exact: true })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  await returnToQueue();
  expect(card().getByText('Submitting…')).toBeVisible();
  if (type === 'conflict') await userEvent.click(card().getByText('Other actions'));
  expect(card().getByRole('button', { name: button, exact: true })).toBeDisabled();
  await act(async () => finish({}));
  await card().findByText('Saved.');
  await filterAwayAndBack();
  expect(card().getByText('Saved.')).toBeVisible();
  expect(writes()).toHaveLength(1);
});

it('retains an unconfirmed answer received offscreen and checks status without resubmitting', async () => {
  await submit();
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  await act(async () => fail(Object.assign(new Error('Lost response'), { unconfirmed: true })));
  await returnToQueue();
  expect(card().getByText(/Saving your response is not confirmed/)).toBeVisible();
  expect(card().getByLabelText('Your answer')).toHaveValue('Keep my submitted answer');
  expect(card().getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  await userEvent.click(card().getByRole('button', { name: 'Check status' }));
  await filterAwayAndBack();
  expect(card().getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  expect(writes()).toHaveLength(1);
});

it.each([503, 403, 409])('retains the answer and a %i recovery message after navigation', async (status) => {
  await submit();
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  await act(async () => fail(Object.assign(new Error('Unavailable'), { status })));
  await returnToQueue();
  expect(card().getByRole('alert')).toBeVisible();
  expect(card().getByLabelText('Your answer')).toHaveValue('Keep my submitted answer');
  expect(card(second.decision).queryByRole('alert')).not.toBeInTheDocument();
  expect(writes()).toHaveLength(1);
});

it('guards assignment across remount and restores editing only after confirmed success', async () => {
  await open();
  await userEvent.click(card().getByText('Other actions'));
  await card().findByRole('option', { name: 'other@example.com' });
  await userEvent.selectOptions(card().getByLabelText('Assign this item'), 'p:other@example.com');
  await filterAwayAndBack();
  expect(card().getByRole('button', { name: 'Answer', exact: true })).toBeDisabled();
  await act(async () => finish({}));
  expect(card().queryByText('Saved.')).not.toBeInTheDocument();
  expect(card().getByRole('button', { name: 'Answer', exact: true })).toBeEnabled();
  expect(writes()).toHaveLength(1);
});

it('retains the redirect target and instructions when its reply arrives after navigation', async () => {
  await open();
  await userEvent.click(card().getByText('Other actions'));
  await card().findByRole('option', { name: 'Scout (agent)' });
  await userEvent.click(card().getByRole('button', { name: 'Ask another agent' }));
  await userEvent.selectOptions(card().getByLabelText('Agent to ask'), 'a1');
  await userEvent.type(card().getByLabelText('Your answer'), 'Check this draft only');
  await userEvent.click(card().getByRole('button', { name: 'Ask another agent' }));
  await filterAwayAndBack();
  expect(card().getByLabelText('Agent to ask')).toHaveValue('a1');
  expect(card().getByLabelText('Your answer')).toHaveValue('Check this draft only');
  expect(card().getByRole('button', { name: 'Ask another agent' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  await act(async () => fail(Object.assign(new Error('Unavailable'), { status: 503 })));
  await returnToQueue();
  expect(card().getByRole('alert')).toBeVisible();
  expect(card().getByLabelText('Agent to ask')).toHaveValue('a1');
  expect(card().getByLabelText('Your answer')).toHaveValue('Check this draft only');
  expect(writes()[0][1].body).toEqual({ action: 'redirect', target_agent_id: 'a1', answer: 'Check this draft only' });
  expect(writes()).toHaveLength(1);
});

it('recovers unavailable redirect choices after returning without discarding the target or draft', async () => {
  await open();
  await userEvent.click(card().getByText('Other actions'));
  await card().findByRole('option', { name: 'Scout (agent)' });
  await userEvent.click(card().getByRole('button', { name: 'Ask another agent' }));
  await userEvent.selectOptions(card().getByLabelText('Agent to ask'), 'a1');
  await userEvent.type(card().getByLabelText('Your answer'), 'Keep these redirect instructions');
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  rejectTeam = true;
  await returnToQueue();
  expect(await card().findByText(/Loading the project team could not be completed/)).toBeVisible();
  expect(card().getByRole('button', { name: 'Ask another agent' })).toBeDisabled();
  expect(card().getByLabelText('Your answer')).toHaveValue('Keep these redirect instructions');
  rejectTeam = false;
  await userEvent.click(card().getByRole('button', { name: 'Try again' }));
  await card().findByRole('option', { name: 'Scout (research)' });
  expect(card().getByLabelText('Agent to ask')).toHaveValue('a1');
  expect(card().getByRole('button', { name: 'Ask another agent' })).toBeEnabled();
  expect(writes()).toHaveLength(0);
});

it('keeps redirect instructions when its selected agent is no longer available', async () => {
  await open();
  await userEvent.click(card().getByText('Other actions'));
  await card().findByRole('option', { name: 'Scout (agent)' });
  await userEvent.click(card().getByRole('button', { name: 'Ask another agent' }));
  await userEvent.selectOptions(card().getByLabelText('Agent to ask'), 'a1');
  await userEvent.type(card().getByLabelText('Your answer'), 'Keep the instructions for another agent');
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  teamAgents = [{ id: 'a2', name: 'Darren', role: 'commercial' }];
  await returnToQueue();
  expect(await card().findByText('The selected agent is no longer available. Choose another agent.')).toBeVisible();
  expect(card().getByRole('button', { name: 'Ask another agent' })).toBeDisabled();
  expect(card().getByLabelText('Your answer')).toHaveValue('Keep the instructions for another agent');
  await userEvent.selectOptions(card().getByLabelText('Agent to ask'), 'a2');
  expect(card().getByRole('button', { name: 'Ask another agent' })).toBeEnabled();
  expect(writes()).toHaveLength(0);
});

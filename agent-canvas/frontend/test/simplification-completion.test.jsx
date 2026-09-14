import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
import { api } from '../src/api.js';
import { AppCtx } from '../src/App.jsx';
import Workspace from '../src/Workspace.jsx';
import AddAgentModal from '../src/AddAgentModal.jsx';
import { AgentPanel } from '../src/Panels.jsx';
import ExplainMap from '../src/ExplainMap.jsx';
import RoomsView from '../src/RoomsView.jsx';

const template = { id: 'template-scout', name: 'Scout', role: 'research', enabled: 1, default_on: 1, model_tier: 'strong', color: '#2080d0' };
const spaces = [{ id: 'c1', name: 'First project' }, { id: 'c2', name: 'Second project' }];
const user = { email: 'pete@cloudtechgurus.com', role: 'owner', name: 'Pete' };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function defaults(path) {
  if (path === '/api/roster') return Promise.resolve({ roster: [template] });
  if (path === '/api/canvases') return Promise.resolve({ canvases: spaces, archived: [] });
  if (/^\/api\/canvases\/c[12]$/.test(path)) return Promise.resolve({ canvas: spaces.find((space) => path.endsWith(space.id)), access: 'edit', agents: [], notes: [], tasks: [], files: [], people: [], runs: [], handoffs: [] });
  if (path === '/api/control/status') return Promise.resolve({ paused: false, cost_usd: 0, budget_usd: 25 });
  if (path === '/api/capabilities') return Promise.resolve({ connected: false, oauthReady: true, surfaces: [] });
  if (path === '/api/health/integrations') return Promise.resolve({ integrations: [] });
  if (path.startsWith('/api/attention')) return Promise.resolve({ attention: [] });
  if (path.endsWith('/inquiries')) return Promise.resolve({ inquiries: [] });
  if (path.endsWith('/memory')) return Promise.resolve({ entries: [] });
  if (path.includes('/activity')) return Promise.resolve({ events: [] });
  if (path === '/api/escalations') return Promise.resolve({ escalations: [] });
  return Promise.resolve({});
}
function workspace(toast = vi.fn()) {
  return render(<AppCtx.Provider value={{ user, config: { inquiryHome: true, needsYou: true }, toast, setTheme: vi.fn(), setUser: vi.fn(), theme: 'light' }}><Workspace /></AppCtx.Provider>);
}
async function openTeam() {
  await userEvent.click(screen.getByText('More', { selector: '.primary-nav summary' }));
  await userEvent.click(screen.getByRole('button', { name: 'Team', exact: true }));
}
beforeEach(() => {
  api.mockReset(); api.mockImplementation(defaults);
  vi.stubGlobal('WebSocket', class { static OPEN = 1; readyState = 1; send() {} close() {} });
});
afterEach(() => { window.history.replaceState({}, '', '/'); });

it.each(['before', 'after'])('retains a template failure %s project selection and recovers inside Add agent', async (order) => {
  const initialSpaces = deferred(), initialTemplates = deferred(), retryTemplates = deferred();
  let templateReads = 0;
  api.mockImplementation((path) => path === '/api/canvases' ? initialSpaces.promise
    : path === '/api/roster' ? (++templateReads === 1 ? initialTemplates.promise : retryTemplates.promise) : defaults(path));
  workspace();
  if (order === 'before') await act(async () => initialTemplates.reject(Object.assign(new Error('offline'), { status: 503 })));
  await act(async () => initialSpaces.resolve({ canvases: spaces, archived: [] }));
  await screen.findByRole('heading', { name: 'Ask the company.' });
  if (order === 'after') await act(async () => initialTemplates.reject(Object.assign(new Error('offline'), { status: 503 })));
  await userEvent.selectOptions(screen.getByLabelText('Switch project space'), 'c2');
  await openTeam();
  await userEvent.click(screen.getByRole('button', { name: 'Add agent', exact: true }));
  const dialog = within(screen.getByRole('dialog', { name: 'Add agent' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('Loading team templates could not be completed');
  expect(dialog.queryByText(/No .*templates.*available|No roster entries/)).not.toBeInTheDocument();
  await userEvent.click(dialog.getByRole('button', { name: 'Retry team list' }));
  expect(await dialog.findByRole('status')).toHaveTextContent('Loading team templates');
  expect(templateReads).toBe(2);
  await act(async () => retryTemplates.resolve({ roster: [template] }));
  expect(await dialog.findByRole('button', { name: /Scout.*Complex work \(strong\)/ })).toBeEnabled();
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it.each(['rejected', 'incomplete'])('keeps project creation and its name recoverable after a %s template response', async (failure) => {
  let recovering = false;
  api.mockImplementation((path) => path === '/api/canvases' ? Promise.resolve({ canvases: [], archived: [] })
    : path === '/api/roster' ? recovering ? Promise.resolve({ roster: [template] }) : failure === 'rejected' ? Promise.reject(new Error('offline')) : Promise.resolve({}) : defaults(path));
  workspace();
  await userEvent.click(await screen.findByRole('button', { name: 'Create a project space', exact: true }));
  const dialog = within(screen.getByRole('dialog', { name: 'New project space' }));
  await userEvent.type(dialog.getByLabelText('Project-space name'), 'Keep this name');
  await dialog.findByRole('alert');
  expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  recovering = true;
  await userEvent.click(dialog.getByRole('button', { name: 'Retry team list' }));
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled());
  expect(dialog.getByLabelText('Project-space name')).toHaveValue('Keep this name');
  expect(dialog.getByLabelText('Starting team')).toBeEnabled();
});

it('distinguishes loading, stale, and confirmed-empty team templates and keeps technical creation reachable', async () => {
  const props = { canvasId: 'c1', roster: [template], onClose: vi.fn(), toast: vi.fn(), onRefreshTemplates: vi.fn() };
  const view = render(<AddAgentModal {...props} templateStatus={{ loading: true }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading team templates');
  expect(screen.getByRole('button', { name: /Scout/ })).toBeDisabled();
  view.rerender(<AddAgentModal {...props} templateStatus={{ error: new Error('offline') }} />);
  expect(screen.getByText(/Last known team templates/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Scout/ })).toBeDisabled();
  view.rerender(<AddAgentModal {...props} roster={[]} templateStatus={{ loading: false, error: null }} />);
  expect(screen.getByText(/No agent templates are available/)).toHaveTextContent('Owner settings → Agent templates');
  await userEvent.click(screen.getByRole('button', { name: 'Advanced', exact: true }));
  for (const name of ['Agent name', 'Agent role', 'Reasoning level', 'Agent color', 'Operating instructions']) expect(screen.getByLabelText(name)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Reasoning level', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Quick work (fast)' })).toHaveValue('fast');
  expect(screen.getByRole('option', { name: 'Complex work (strong)' })).toHaveValue('strong');
});

it('does not create an accidentally unstaffed Room while templates are unavailable', async () => {
  api.mockImplementation((path) => Promise.resolve(path === '/api/rooms' ? { rooms: [] } : { allowlist: [] }));
  render(<RoomsView user={user} roster={[]} templateStatus={{ error: new Error('offline') }} onRefreshTemplates={vi.fn()} toast={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Room name'), 'Keep the room name');
  await screen.findByRole('button', { name: 'Retry team list' });
  expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
  expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it.each([['strong', 'Complex work (strong)'], ['fast', 'Quick work (fast)']])('labels the %s reasoning level in normal agent details', (_, label) => {
  render(<AgentPanel agent={{ ...template, model_tier: _, status: 'idle' }} runs={[]} onClose={vi.fn()} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});

it('keeps Google setup instructions under details while showing plain-language recovery', async () => {
  window.history.replaceState({}, '', '/?ws=blocked');
  const toast = vi.fn(); workspace(toast);
  const dialog = within(await screen.findByRole('dialog', { name: 'Connections' }));
  expect(dialog.getByText(/Google did not allow this account to connect/)).toBeVisible();
  expect(toast.mock.calls.flat().join(' ')).not.toContain('GOOGLE_WORKSPACE_SCOPES');
  const technical = dialog.getByText(/GOOGLE_WORKSPACE_SCOPES=standard/);
  expect(technical.closest('details')).not.toHaveAttribute('open');
  await userEvent.click(dialog.getByText('Technical setup details', { selector: 'summary' }));
  expect(technical).toBeVisible();
});

it.each(['flow', 'evidence', 'impact'])('preserves readable certainty, shapes and source navigation in the %s work map', async (lens) => {
  const values = ['verified', 'inference', 'assumption'];
  const labels = ['Confirmed (verified)', 'Reasoned conclusion (inference)', 'Unconfirmed (assumption)'];
  api.mockResolvedValue({ nodes: values.map((epistemic, row) => ({ id: `n${row}`, type: 'entry', col: 3, row, label: `Unchanged source ${row}`, meta: { entryId: `m${row}`, epistemic } })), edges: [], steps: ['Original recorded step'] });
  const select = vi.fn();
  render(<ExplainMap canvasId="c1" runId="r1" onSelectEntry={select} />);
  if (lens !== 'flow') await userEvent.click(screen.getByRole('tab', { name: lens === 'evidence' ? 'Evidence' : 'Impact' }));
  for (let i = 0; i < values.length; i++) {
    const node = await screen.findByRole('button', { name: `Memory: Unchanged source ${i} · ${labels[i]}` });
    expect(node).toHaveClass(`epi-${values[i]}`);
    expect(within(node).getByText(labels[i])).toBeInTheDocument();
    await userEvent.click(node); expect(select).toHaveBeenLastCalledWith(`m${i}`);
  }
  await userEvent.click(screen.getByRole('button', { name: 'Read as steps' }));
  expect(screen.getByText('Original recorded step')).toBeInTheDocument();
  expect(api).toHaveBeenLastCalledWith(`/api/canvases/c1/runs/r1/explain-map?lens=${lens}`);
});

it('recovers an incomplete map response and distinguishes a confirmed empty map', async () => {
  api.mockResolvedValueOnce({}).mockResolvedValueOnce({ nodes: [], edges: [], steps: [] })
    .mockResolvedValue({ nodes: [{ id: 'q', type: 'question', col: 0, row: 0, label: 'Original question' }], edges: [], steps: [] });
  render(<ExplainMap canvasId="c1" runId="r1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Loading the work map could not be completed');
  expect(screen.queryByText(/No work map details/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(/No work map details were returned/);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh map' }));
  expect(await screen.findByRole('button', { name: 'Question: Original question' })).toBeInTheDocument();
});

it('explains recorded certainty in the steps view without changing the quoted source text', async () => {
  const source = 'Exact source: TRUE; status (assumption); customer wording stays unchanged.';
  api.mockResolvedValue({ nodes: [], edges: [], steps: [`Wrote to memory (assumption): ${source}`, 'An unrelated recorded step'] });
  render(<ExplainMap canvasId="c1" runId="r1" />);
  await userEvent.click(screen.getByRole('button', { name: 'Read as steps' }));
  expect(await screen.findByText(`Recorded memory — Unconfirmed (assumption): ${source}`)).toBeInTheDocument();
  expect(screen.getByText('An unrelated recorded step')).toBeInTheDocument();
});

it('changes map lenses by keyboard while retaining the map and steps controls', async () => {
  api.mockResolvedValue({ nodes: [], edges: [], steps: [] });
  render(<ExplainMap canvasId="c1" runId="r1" />);
  await userEvent.click(screen.getByRole('tab', { name: 'Flow' }));
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveFocus();
  await waitFor(() => expect(api).toHaveBeenLastCalledWith('/api/canvases/c1/runs/r1/explain-map?lens=evidence'));
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('tab', { name: 'Impact' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Impact' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('tab', { name: 'Flow' })).toHaveAttribute('tabindex', '-1');
  screen.getByRole('tab', { name: 'Flow' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Read as steps' })).toBeInTheDocument();
});

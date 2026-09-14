import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
import { api } from '../src/api.js';
import AdminModal from '../src/AdminModal.jsx';
import ActivityDock from '../src/ActivityDock.jsx';
import { SpendPanel } from '../src/Panels.jsx';
const entries = [{ id: 'a', name: 'Scout', role: 'research', color: '#123456', model_tier: 'strong', system_prompt: 'Find sources', enabled: true, sort: 1 }, { id: 'b', name: 'Writer', role: 'research', color: '#123456', model_tier: 'fast', system_prompt: 'Draft', enabled: true, sort: 2 }];
const connector = { id: 's1', name: 'Records', url: 'https://example.com/mcp', roles: [], enabledTools: [], enabled: true, access: 'members' };
let fail;
beforeEach(() => {
  fail = null; api.mockReset(); api.mockImplementation((path, opts) => {
    if (fail?.(path, opts)) return Promise.reject(new Error('unavailable'));
    if (opts?.method) return Promise.resolve({});
    if (path === '/api/allowlist') return Promise.resolve({ allowlist: [] });
    if (path === '/api/roster') return Promise.resolve({ roster: entries });
    if (path === '/api/mcp/servers') return Promise.resolve({ servers: [connector] });
    if (path.startsWith('/api/audit?')) return Promise.resolve({ entries: [], chain: { ok: true, entries: 0 } });
    return Promise.resolve({});
  });
});
const admin = () => render(<AdminModal selfEmail="owner@example.com" onClose={vi.fn()} toast={vi.fn()} />);
it('distinguishes unavailable tables from empty lists in every owner section', async () => {
  fail = () => true; admin();
  for (const name of ['People and access', 'Agent templates', 'Connections', 'Audit history']) {
    await userEvent.click(screen.getByRole('tab', { name }));
    await screen.findByRole('alert');
    expect(screen.queryByText(/allowlist is empty|no connectors configured|no audit entries match|No agent templates/)).not.toBeInTheDocument();
  }
});
it('retains a failed access invitation and prevents duplicate saves', async () => {
  const impl = api.getMockImplementation(); let reject;
  api.mockImplementation((path, opts) => opts?.method === 'POST' ? new Promise((_, no) => { reject = no; }) : impl(path, opts));
  admin(); await screen.findByText('allowlist is empty');
  await userEvent.type(screen.getByLabelText('Email address'), 'teammate@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
  expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await act(async () => reject(new Error('offline')));
  expect(screen.getByLabelText('Email address')).toHaveValue('teammate@example.com');
  expect(api.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(1);
});
it('keeps the template editor open with its fields after a save failure', async () => {
  admin(); await userEvent.click(screen.getByRole('tab', { name: 'Agent templates' }));
  const row = (await screen.findByText('Scout')).closest('tr');
  await userEvent.click(within(row).getByRole('button', { name: 'edit' }));
  await userEvent.type(screen.getByLabelText('Agent name'), ' improved'); fail = (_, opts) => opts?.method === 'PATCH';
  await userEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText(/Saving agent templates could not/);
  expect(screen.getByLabelText('Agent name')).toHaveValue('Scout improved');
  expect(screen.getByLabelText('Operating instructions (system prompt)')).toHaveValue('Find sources');
});
it('reports partial ordering and retries only the unfinished write', async () => {
  admin(); await userEvent.click(screen.getByRole('tab', { name: 'Agent templates' }));
  fail = (path, opts) => path === '/api/roster/b' && opts?.method === 'PATCH';
  await userEvent.click(await screen.findByRole('button', { name: 'Move Scout down' }));
  await screen.findByText(/Ordering is partly saved/);
  expect(screen.getByRole('button', { name: 'Move Scout down' })).toBeDisabled();
  fail = null; await userEvent.click(screen.getByRole('button', { name: 'Finish ordering' }));
  await waitFor(() => expect(screen.queryByText(/Ordering is partly saved/)).not.toBeInTheDocument());
  const writes = api.mock.calls.filter(([, opts]) => opts?.method === 'PATCH');
  expect(writes.map(([path]) => path)).toEqual(['/api/roster/a', '/api/roster/b', '/api/roster/b']);
  expect(writes[2][1].body).toEqual({ sort: 1 });
});
it('serializes connection edits until their saved state is read back', async () => {
  const impl = api.getMockImplementation(); let finish;
  api.mockImplementation((path, opts) => opts?.method === 'PATCH' ? new Promise((resolve) => { finish = resolve; }) : impl(path, opts));
  admin(); await userEvent.click(screen.getByRole('tab', { name: 'Connections' }));
  const access = await screen.findByLabelText('Access to Records');
  await userEvent.selectOptions(access, 'owner');
  expect(access).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Check connection' })).toBeDisabled();
  await act(async () => finish({}));
  await waitFor(() => expect(access).toBeEnabled());
  expect(api.mock.calls.filter(([, opts]) => opts?.method === 'PATCH')).toHaveLength(1);
});
it('clears an old verified audit badge after a failed refresh', async () => {
  admin(); await userEvent.click(screen.getByRole('tab', { name: 'Audit history' }));
  await screen.findByText('✓ chain verified'); fail = (path) => path.startsWith('/api/audit');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(/Audit verification is unavailable/);
  expect(screen.queryByText('✓ chain verified')).not.toBeInTheDocument();
  expect(screen.queryByText('no audit entries match')).not.toBeInTheDocument();
  fail = null; await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('✓ chain verified');
});
it('keeps all seven activity filters and distinguishes unavailable from no matches', async () => {
  const props = { activity: [{ id: 'e1', type: 'text', payload: { text: 'Working' } }], handoffs: [], agents: [], agentsById: {}, onRefresh: vi.fn() };
  const view = render(<ActivityDock {...props} loadStatus={{ error: new Error('offline') }} />);
  await userEvent.click(screen.getByRole('button', { name: /Activity/ }));
  expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(7);
  expect(screen.queryByText(/No activity recorded/)).not.toBeInTheDocument();
  view.rerender(<ActivityDock {...props} />);
  await userEvent.click(screen.getByRole('button', { name: '¶ text' }));
  expect(screen.getByText(/No activity matches these filters/)).toBeInTheDocument();
});
it('never reports zero history when spending or statistics are unavailable', async () => {
  render(<SpendPanel spend={null} analytics={null} budget={null} statuses={{ spending: { error: new Error('offline') }, analytics: { error: new Error('offline') } }} onRefresh={vi.fn()} />);
  await userEvent.click(screen.getByText('Advanced spending details'));
  expect(screen.queryByText(/no spend recorded yet|no agents|no analytics yet/)).not.toBeInTheDocument();
  expect(screen.getByText(/Today’s spending and cap are unavailable/)).toBeInTheDocument();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
});

import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', () => ({ api: vi.fn() }));
import { api } from '../src/api.js';
import CapabilitiesModal from '../src/CapabilitiesModal.jsx';

const baseCaps = { connected: false, oauthReady: true, identityModel: 'Use the directing person’s permissions.', surfaces: [
  { surface: 'Gmail', can: [{ label: 'Prepare a draft', detail: 'A person sends it.' }], cannot: [{ label: 'Send email', detail: 'Agents never send.' }] },
  { surface: 'MCP connectors', can: [{ label: 'Local search', detail: 'Owner-enabled search.' }], cannot: [{ label: 'Unnamed tools', detail: 'Tools must be individually enabled.' }] },
] };
const baseHealth = { integrations: [
  { id: 'model', label: 'MODEL', status: 'attention', probe: true, detail: 'No probe recorded yet.' },
  { id: 'drive', label: 'DRIVE / DOCS', status: 'attention', probe: true, detail: 'No file access checked yet.' },
  { id: 'audit', label: 'AUDIT', status: 'ready', detail: 'Tamper check passed.' },
  { id: 'mcp:local', label: 'MCP LOCAL', status: 'attention', probe: true, detail: 'Named tool details retained.' },
] };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const answer = () => within(document.querySelector('.connection-overview [data-service="model"]'));
let caps, health, mutation;
beforeEach(() => {
  caps = structuredClone(baseCaps); health = structuredClone(baseHealth);
  mutation = vi.fn().mockResolvedValue({ ok: true, ms: 7 });
  api.mockReset().mockImplementation((path, options) => {
    if (options?.method === 'POST') return mutation(path, options);
    if (path === '/api/capabilities') return caps instanceof Error ? Promise.reject(caps) : Promise.resolve(caps);
    if (path === '/api/health/integrations') return health instanceof Error ? Promise.reject(health) : Promise.resolve(health);
    throw new Error(`Unexpected request: ${path}`);
  });
});
async function open() {
  const view = render(<CapabilitiesModal onClose={vi.fn()} diagnostics={<p>Queue and agent diagnostics</p>} />);
  await waitFor(() => expect(screen.queryByText('Checking connections and services…')).not.toBeInTheDocument());
  return view;
}

it('keeps the account and answer check primary while retaining every function, service and diagnostic in disclosures', async () => {
  await open();
  expect(screen.getByRole('button', { name: 'Connect Google Workspace' })).toBeEnabled();
  expect(answer().getByRole('button', { name: 'Check now' })).toBeEnabled();
  expect(screen.getByRole('region', { name: 'Audit integrity' })).not.toBeVisible();
  expect(screen.getByText('Advanced details').closest('details')).not.toHaveAttribute('open');
  await userEvent.click(screen.getByText('Gmail', { exact: true }));
  for (const text of ['Prepare a draft', 'A person sends it.', 'Send email', 'Agents never send.']) expect(screen.getByText(text)).toBeVisible();
  expect(screen.getByText('Prepare a draft').closest('details').querySelector('.lamp-ready')).toBeNull();
  await userEvent.click(screen.getByText('More service checks (1)'));
  expect(document.querySelector('.other-service-checks [data-service="drive"]')).toBeVisible();
  await userEvent.click(screen.getByText('Advanced details'));
  const board = within(document.querySelector('.sys-board'));
  expect(board.getAllByRole('region')).toHaveLength(baseHealth.integrations.length);
  await userEvent.click(board.getByRole('region', { name: 'Additional connection: local' }).querySelector('summary'));
  expect(board.getByText('Named tool details retained.')).toBeVisible();
  expect(board.getByText('mcp:local')).toBeVisible();
  await userEvent.click(screen.getByText('Additional connector tools (MCP)'));
  for (const text of ['Local search', 'Owner-enabled search.', 'Unnamed tools', 'Tools must be individually enabled.']) expect(screen.getByText(text)).toBeVisible();
  expect(screen.getByText('Queue and agent diagnostics')).toBeVisible();
});

it('rejects incomplete reads without inventing disconnected accounts, no services, or a green status; retry recovers', async () => {
  caps = { connected: false, surfaces: [null] }; health = { integrations: [{ id: 'model', status: 'mystery' }] };
  const view = await open();
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByText(/Google connection status is not confirmed/)).toBeVisible();
  expect(screen.queryByText('Google Workspace is not set up here')).toBeNull();
  expect(screen.queryByText(/No service checks were returned/)).toBeNull();
  expect(view.container.querySelector('.lamp-ready')).toBeNull();
  caps = baseCaps; health = baseHealth;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: 'Connect Google Workspace' })).toBeEnabled();
});

it('shows verified empty function and service lists separately from failures', async () => {
  caps = { connected: false, oauthReady: false, surfaces: [] }; health = { integrations: [] };
  const view = await open();
  expect(screen.getByText(/No function details were returned/)).toBeVisible();
  expect(screen.getByText(/No service checks were returned/)).toBeVisible();
  expect(screen.getByText('Google Workspace is not set up here')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled();
  expect(view.container.querySelector('.lamp-ready')).toBeNull();
});

it('masks an old successful check after a rejected probe, retains recovery through read refresh, and recovers only from a new confirmed check', async () => {
  health.integrations[0].status = 'ready'; mutation.mockResolvedValueOnce({ ok: false, error: 'Denied upstream', ms: 5 });
  await open();
  expect(answer().getByText('Checked')).toBeVisible();
  await userEvent.click(answer().getByRole('button', { name: 'Check now' }));
  await answer().findByRole('alert');
  expect(answer().queryByText('Checked')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(answer().getByText('Status unavailable')).toBeVisible());
  await userEvent.click(answer().getByText('Service details'));
  expect(answer().getByText('Latest check result: did not pass · 5 milliseconds.')).toBeVisible();
  await userEvent.click(answer().getByRole('button', { name: 'Check again' }));
  await answer().findByText('Checked');
  expect(answer().queryByRole('alert')).toBeNull();
  expect(answer().getByText('Latest check result: passed · 7 milliseconds.')).toBeVisible();
  expect(answer().getByRole('button', { name: 'Check again' })).toBeEnabled();
  expect(api.mock.calls.filter(([path]) => path === '/api/capabilities')).toHaveLength(4);
});

it('keeps an incomplete probe unconfirmed and checks status without automatically repeating it', async () => {
  mutation.mockResolvedValueOnce({ ms: 4 }); await open();
  await userEvent.click(answer().getByRole('button', { name: 'Check now' }));
  expect(await answer().findByRole('alert')).toHaveTextContent('is not confirmed');
  await userEvent.click(answer().getByText('Service details'));
  expect(answer().getByText('Latest check result: not confirmed · 4 milliseconds.')).toBeVisible();
  await userEvent.click(answer().getByRole('button', { name: 'Check status' }));
  await waitFor(() => expect(answer().getByRole('button', { name: 'Check again' })).toBeEnabled());
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(answer().queryByText('Checked')).toBeNull();
});

it('blocks repeated checks immediately and keeps pending work tied to its service when disclosures close', async () => {
  const held = defer(); mutation.mockReturnValue(held.promise); await open();
  await userEvent.click(screen.getByText('More service checks (1)'));
  const drive = () => within(document.querySelector('.other-service-checks [data-service="drive"]'));
  const button = drive().getByRole('button', { name: 'Check now' });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(drive().getByRole('button', { name: 'Checking…' })).toBeDisabled();
  await userEvent.click(screen.getByText('More service checks (1)'));
  await userEvent.click(screen.getByText('More service checks (1)'));
  expect(drive().getByRole('button', { name: 'Checking…' })).toBeDisabled();
  await act(async () => held.resolve({ ok: true }));
  await waitFor(() => expect(drive().getByRole('button', { name: 'Check again' })).toBeEnabled());
});

it('retains independent errors for concurrent checks and does not clear them when another service recovers', async () => {
  const first = defer(), second = defer();
  mutation.mockImplementation((path, { body }) => body.surface === 'model' ? first.promise : second.promise);
  await open(); await userEvent.click(screen.getByText('More service checks (1)'));
  const drive = () => within(document.querySelector('.other-service-checks [data-service="drive"]'));
  await userEvent.click(answer().getByRole('button', { name: 'Check now' }));
  await userEvent.click(drive().getByRole('button', { name: 'Check now' }));
  await act(async () => { first.reject(new Error('Model refused')); second.reject(new Error('Drive refused')); });
  await answer().findByRole('alert'); await drive().findByRole('alert');
  mutation.mockResolvedValue({ ok: true });
  await userEvent.click(answer().getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(answer().queryByRole('alert')).toBeNull());
  expect(drive().getByRole('alert')).toHaveTextContent('Checking Google Drive and Docs could not');
});

it('does not refresh a closed dialog after a delayed check returns', async () => {
  const held = defer(); mutation.mockReturnValue(held.promise); const view = await open();
  await userEvent.click(answer().getByRole('button', { name: 'Check now' }));
  const reads = api.mock.calls.length; view.unmount();
  await act(async () => held.resolve({ ok: true }));
  expect(api.mock.calls).toHaveLength(reads);
});

it('retains truthful last-known service details after a refresh fails and recovers from a successful read', async () => {
  health.integrations[0].status = 'ready'; const view = await open();
  health = new Error('Offline');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText('Last known details below. Current status is unavailable.');
  expect(view.container.querySelector('.lamp-ready')).toBeNull();
  await userEvent.click(answer().getByText('Service details'));
  expect(answer().getByText('No probe recorded yet.')).toBeVisible();
  expect(answer().getByText(/last-known details/)).toBeVisible();
  health = structuredClone(baseHealth); health.integrations[0].status = 'ready';
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await answer().findByText('Checked');
});

it('rejects a malformed Google sign-in link and keeps status recovery on the same page', async () => {
  mutation.mockResolvedValue({ url: 'https://invalid.example.test/' }); await open();
  await userEvent.click(screen.getByRole('button', { name: 'Connect Google Workspace' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Updating the connection could not');
  expect(screen.getByText('Google connection status is not confirmed')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: 'Connect Google Workspace' })).toBeEnabled();
  expect(mutation).toHaveBeenCalledTimes(1);
});

it('guards disconnect, treats a lost response as unconfirmed, and refreshes account state without repeating the change', async () => {
  caps.connected = true; const held = defer(); mutation.mockReturnValue(held.promise); await open();
  const disconnect = screen.getByRole('button', { name: 'Disconnect' });
  act(() => { fireEvent.click(disconnect); fireEvent.click(disconnect); });
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
  expect(screen.queryByText('Workspace account connected')).toBeNull();
  await act(async () => held.reject(Object.assign(new Error('Lost response'), { unconfirmed: true })));
  expect(await screen.findByRole('alert')).toHaveTextContent('is not confirmed');
  expect(screen.queryByText('Workspace account connected')).toBeNull();
  caps.connected = false;
  await userEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await screen.findByText('Workspace not connected');
  expect(mutation).toHaveBeenCalledTimes(1);
});

it('passes fresh health to the technical console and hides stale diagnostic claims during unresolved checks', async () => {
  const consoleView = vi.fn(({ health: current }) => <p>Console: {current.integrations[0].status}</p>);
  render(<CapabilitiesModal onClose={vi.fn()} diagnostics={consoleView} />);
  await screen.findByText('Console: attention');
  await userEvent.click(screen.getByText('Advanced details'));
  const held = defer(); mutation.mockReturnValueOnce(held.promise);
  const primary = within(document.querySelector('.connection-overview [data-service="model"]'));
  await userEvent.click(primary.getByRole('button', { name: 'Check now' }));
  expect(screen.queryByText('Console: attention')).toBeNull();
  await act(async () => held.reject(new Error('Check lost')));
  await primary.findByRole('alert');
  expect(screen.queryByText('Console: attention')).toBeNull();
  expect(screen.getByText(/System details are unavailable until/)).toBeVisible();
  health.integrations[0].status = 'ready';
  await userEvent.click(primary.getByRole('button', { name: 'Check again' }));
  expect(await screen.findByText('Console: ready')).toBeVisible();
});

import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
vi.mock('../src/Workspace.jsx', () => ({ default: () => <div>Signed-in workspace</div> }));
import { api } from '../src/api.js';
import App from '../src/App.jsx';
import CapabilitiesModal from '../src/CapabilitiesModal.jsx';

beforeEach(() => { api.mockReset(); });

it('keeps sign-in recovery visible after dismissing its short notification', async () => {
  api.mockImplementation((path) => {
    if (path === '/api/config') return Promise.resolve({ devAuth: true });
    if (path === '/api/me') return Promise.resolve({ user: null });
    return Promise.reject(new Error('Temporary sign-in failure'));
  });
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Development sign-in'), 'pete@cloudtechgurus.com');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  await screen.findByRole('region', { name: 'Recent updates' });
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss updates' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Sign-in could not be completed');
  expect(screen.getByRole('button', { name: 'Try sign-in again' })).toBeEnabled();
  expect(screen.getByLabelText('Development sign-in')).toHaveValue('pete@cloudtechgurus.com');
});

it('clears expanded short updates when a successful sign-in starts a session', async () => {
  let accepted = false;
  api.mockImplementation((path) => {
    if (path === '/api/config') return Promise.resolve({ devAuth: true });
    if (path === '/api/me') return Promise.resolve({ user: null });
    return accepted ? Promise.resolve({ user: { email: 'pete@cloudtechgurus.com' } }) : Promise.reject(new Error('Temporary sign-in failure'));
  });
  render(<App />);
  await userEvent.type(await screen.findByLabelText('Development sign-in'), 'pete@cloudtechgurus.com');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  await userEvent.click(await screen.findByRole('button', { name: 'Details', exact: true }));
  expect(screen.getByRole('list', { name: 'Update details' })).toBeInTheDocument();
  accepted = true;
  await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  await screen.findByText('Signed-in workspace');
  expect(screen.queryByRole('region', { name: 'Recent updates' })).not.toBeInTheDocument();
});

it('shows a recoverable startup failure rather than a sign-in or empty workspace', async () => {
  api.mockImplementation((path) => path === '/api/config' ? Promise.resolve({ devAuth: true }) : Promise.reject(new Error('offline')));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Opening the workspace could not be completed');
  expect(screen.queryByText('Development sign-in')).not.toBeInTheDocument();
  api.mockImplementation((path) => Promise.resolve(path === '/api/config' ? {} : { user: { email: 'member@example.com' } }));
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Signed-in workspace')).toBeInTheDocument();
});
it('only treats an authentication response as signed out and permits retrying config', async () => {
  api.mockImplementation((path) => path === '/api/config' ? Promise.reject(new Error('config offline')) : Promise.reject(Object.assign(new Error('signed out'), { status: 401 })));
  render(<App />);
  await screen.findByRole('alert');
  api.mockImplementation((path) => { return path === '/api/config' ? Promise.resolve({ devAuth: true }) : Promise.reject(Object.assign(new Error('signed out'), { status: 401 })); });
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText('Development sign-in')).toBeInTheDocument();
});
it('keeps session expiry explicit without pretending an existing page saved its drafts', async () => {
  api.mockImplementation((path) => Promise.resolve(path === '/api/config' ? {} : { user: { email: 'member@example.com' } }));
  render(<App />);
  await screen.findByText('Signed-in workspace');
  act(() => window.dispatchEvent(new Event('ac-session-expired')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Keep a copy of any unsaved text');
  expect(screen.getByText('Signed-in workspace')).toBeInTheDocument();
});
it('does not label failed capability loads unconfigured or retain a green health claim', async () => {
  let offline = false, probeRecovers = false;
  api.mockImplementation((path) => {
    if (path === '/api/capabilities') return Promise.reject(new Error('offline'));
    if (path === '/api/health/probe') { if (probeRecovers) return Promise.resolve({ ok: true, ms: 3 }); offline = true; return Promise.reject(new Error('failed probe')); }
    if (offline) return Promise.reject(new Error('health unavailable'));
    return Promise.resolve({ integrations: [{ id: 'model', label: 'Answer service', status: 'ready', detail: 'Previously checked', probe: true }] });
  });
  const view = render(<CapabilitiesModal onClose={vi.fn()} toast={vi.fn()} />);
  await screen.findByText('Loading your connections could not be completed. Check your connection and try again.');
  expect(screen.queryByText('○ Not configured')).not.toBeInTheDocument();
  expect(view.container.querySelector('.lamp-ready')).toBeTruthy();
  await userEvent.click(view.container.querySelector('.connection-overview .service-check button'));
  await screen.findByText('Last known details below. Current status is unavailable.');
  expect(view.container.querySelector('.lamp-ready')).toBeNull();
  expect(api).toHaveBeenCalledWith('/api/health/probe', { method: 'POST', body: { surface: 'model' } });
  offline = false;
  await userEvent.click(screen.getAllByRole('button', { name: 'Try again' })[1]);
  await waitFor(() => expect(screen.queryByText('Last known details below. Current status is unavailable.')).not.toBeInTheDocument());
  expect(view.container.querySelector('.lamp-ready')).toBeNull();
  probeRecovers = true;
  await userEvent.click(view.container.querySelector('.connection-overview .service-check button'));
  await waitFor(() => expect(view.container.querySelector('.lamp-ready')).toBeTruthy());
});

it('does not turn configuration-only storage and web research into green checks', async () => {
  api.mockImplementation((path) => Promise.resolve(path === '/api/capabilities' ? { connected: false, oauthReady: false, surfaces: [] } : { integrations: [
    { id: 'db', label: 'DATABASE', status: 'ready', detail: 'Configured storage' },
    { id: 'websearch', label: 'WEB SEARCH', status: 'ready', detail: 'Enabled search' },
  ] }));
  const view = render(<CapabilitiesModal onClose={vi.fn()} toast={vi.fn()} />);
  await screen.findByText('Saved data and backups');
  expect(view.container.querySelector('.lamp-ready')).toBeNull();
  await userEvent.click(screen.getByText('Advanced details', { exact: true }));
  expect(view.container.querySelector('.sys-board').textContent.match(/Configured; delivery not verified/g)).toHaveLength(2);
});

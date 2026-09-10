import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
import { api } from '../src/api.js';
import RoomsView from '../src/RoomsView.jsx';
const room = { id: 'r1', canvasId: 'c1', name: 'Renewal', roomType: 'deal' };
const built = { room, access: 'edit', sections: { people: { members: [], onCanvas: [] }, evidence: [], work: { tasks: [], runs: [] }, decisions: [], risks: [], openQuestions: { escalations: [], inquiries: [] } } };
const preview = { manifestHash: 'hash1', included: { decisions: [], facts: [], evidence: [], tasks: [] }, excluded: { assumptionsAndInferences: [], taintedEntries: [], privateEvidence: [], openEscalations: [] } };
let fail;
beforeEach(() => {
  fail = null;
  api.mockReset();
  api.mockImplementation((path, opts) => {
    if (fail?.(path, opts)) return Promise.reject(Object.assign(new Error('offline'), { status: path.endsWith('/export') ? 409 : 503 }));
    if (path === '/api/rooms') return Promise.resolve({ rooms: [room], archived: [] });
    if (path === '/api/allowlist') return Promise.resolve({ allowlist: [] });
    if (path.endsWith('/preview')) return Promise.resolve(preview);
    if (path.endsWith('/activity')) return Promise.resolve({ events: [] });
    if (path.endsWith('/refresh')) return Promise.resolve({ run: { id: 'run1', status: 'queued' } });
    if (path.endsWith('/receipt')) return Promise.resolve({ run: { id: 'run1', status: 'completed' } });
    return Promise.resolve(built);
  });
});
function start(role = 'owner') { return render(<RoomsView user={{ role, email: 'owner@example.com' }} roster={[]} toast={vi.fn()} onOpenCanvas={vi.fn()} onOpenRun={vi.fn()} />); }
async function open() { await userEvent.click(await screen.findByText('Renewal')); await screen.findByText('People'); }
it('distinguishes failed lists and missing players from an empty room list', async () => {
  fail = (path) => ['/api/rooms', '/api/allowlist'].includes(path);
  start();
  await screen.findByText(/Loading rooms could not/);
  expect(screen.queryByText(/No rooms yet/)).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Room name'), 'New room');
  expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
  fail = null;
  await userEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
  await screen.findByText('Renewal');
});
it('recovers a failed detail read and never relabels an old brief as a new lens', async () => {
  fail = (path) => path.includes('?lens='); start('member');
  await userEvent.click(await screen.findByText('Renewal'));
  await screen.findByText(/Loading this room could not/);
  fail = null; await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('People');
  fail = (path) => path.endsWith('lens=risk');
  await userEvent.click(screen.getByRole('radio', { name: 'Risk' }));
  await screen.findByText(/Loading this room could not/);
  expect(screen.queryByText('People')).not.toBeInTheDocument();
});
it('shows failed activity as unavailable, then recovers an honest empty result', async () => {
  start('member'); await open(); fail = (path) => path.endsWith('/activity');
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }));
  await screen.findByText(/Loading room activity could not/);
  expect(screen.queryByText('No activity yet.')).not.toBeInTheDocument();
  fail = null; await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No activity yet.');
});
it('keeps refresh pending after a failed status read and prevents another dispatch', async () => {
  start('member'); await open(); fail = (path) => path.endsWith('/receipt');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh room' }));
  await screen.findByText(/Checking refresh progress could not/);
  expect(screen.getByRole('button', { name: 'Refresh in progress…' })).toBeDisabled();
  fail = null; await userEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh room' })).toBeEnabled());
  expect(api.mock.calls.filter(([path]) => path.endsWith('/refresh'))).toHaveLength(1);
});
it('invalidates an export preview when the room closes while its request is pending', async () => {
  const implementation = api.getMockImplementation(); let finish;
  api.mockImplementation((path, opts) => path.endsWith('/preview') ? new Promise((resolve) => { finish = resolve; }) : implementation(path, opts));
  start(); await open(); await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
  await userEvent.click(screen.getByRole('button', { name: '← Rooms' }));
  await act(async () => finish(preview));
  await open();
  expect(screen.queryByText(/Disclosure review/)).not.toBeInTheDocument();
});
it('requires a fresh disclosure review after an export conflict', async () => {
  start(); await open(); await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
  await screen.findByText(/Disclosure review/); fail = (path) => path.endsWith('/export');
  await userEvent.click(screen.getByRole('button', { name: 'Download client-safe HTML' }));
  await screen.findByText(/This item changed/);
  expect(screen.queryByRole('button', { name: 'Download client-safe HTML' })).not.toBeInTheDocument();
  fail = null; await userEvent.click(screen.getByRole('button', { name: 'Review a fresh export preview' }));
  await screen.findByRole('button', { name: 'Download client-safe HTML' });
});

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
import { api } from '../src/api.js';
import { AppCtx } from '../src/App.jsx';
import Workspace from '../src/Workspace.jsx';

let resolve, reject;
beforeEach(() => {
  const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
  api.mockReset();
  api.mockImplementation((path, options) => {
    if (path === '/api/roster') return Promise.resolve({ roster: [] });
    if (path === '/api/canvases') return Promise.resolve({ canvases: [{ id: 'c1', name: 'First', access: 'edit' }, { id: 'c2', name: 'Second', access: 'edit' }] });
    if (/^\/api\/canvases\/c[12]$/.test(path)) return Promise.resolve({ canvas: { id: path.split('/').at(-1) }, access: 'edit', agents: [{ id: 'a1', name: 'Scout' }], notes: [], files: [], people: [], runs: [], tasks: [], handoffs: [] });
    if (path.endsWith('/inquiries')) return options?.method === 'POST' ? pending : Promise.resolve({ inquiries: [] });
    if (path === '/api/control/status') return Promise.resolve({ paused: false, cost_usd: 0, budget_usd: 25 });
    return Promise.resolve({});
  });
  vi.stubGlobal('WebSocket', class { static OPEN = 1; readyState = 1; send() {} close() {} });
});
async function submit() {
  render(<AppCtx.Provider value={{ user: { role: 'member', email: 'member@example.com' }, config: { inquiryHome: true }, toast: vi.fn(), setTheme: vi.fn(), setUser: vi.fn(), theme: 'light' }}><Workspace /></AppCtx.Provider>);
  await userEvent.type(await screen.findByLabelText('Ask a question about the company'), 'First question');
  await userEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }));
  await screen.findByRole('button', { name: 'Sending…' });
}
async function help() {
  await userEvent.click(screen.getByText('More', { selector: 'summary' }));
  await userEvent.click(screen.getByRole('button', { name: 'Help' }));
  await screen.findByRole('heading', { name: 'Getting started' });
}
const postCount = () => api.mock.calls.filter(([path, options]) => path.endsWith('/inquiries') && options?.method === 'POST').length;

it('keeps a pending Home submission guarded across views and project spaces', async () => {
  await submit(); await help();
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText('Switch project space'), 'c2');
  await waitFor(() => expect(screen.getByLabelText('Ask a question about the company')).toBeEnabled());
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'Other draft');
  await act(async () => resolve({ inquiry: { id: 'i1', question: 'First question', status: 'pending' } }));
  expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('Other draft');
  await userEvent.selectOptions(screen.getByLabelText('Switch project space'), 'c1');
  await waitFor(() => expect(screen.getByLabelText('Ask a question about the company')).toHaveValue(''));
  expect(postCount()).toBe(1);
});

it('retains an unconfirmed outcome that arrives while Home is closed', async () => {
  await submit(); await help();
  await act(async () => reject(Object.assign(new Error('Connection interrupted'), { status: 0, unconfirmed: true })));
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  await screen.findByText('Sending your request is not confirmed. Check status before trying again.');
  expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('First question');
  expect(screen.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Check status', exact: true }));
  expect(postCount()).toBe(1);
});

it('shows a rejected background submission on return and preserves its editable draft', async () => {
  await submit(); await help();
  await act(async () => reject(Object.assign(new Error('Unavailable'), { status: 503 })));
  await userEvent.click(screen.getByRole('button', { name: 'Home', exact: true }));
  await screen.findByText('Sending your request could not be completed. Check your connection and try again.');
  expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('First question');
  expect(screen.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  expect(postCount()).toBe(1);
});

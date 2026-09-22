import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
import { api } from '../src/api.js';
import { AppCtx } from '../src/App.jsx';
import Workspace from '../src/Workspace.jsx';
import Home from '../src/Home.jsx';
import CommandBar from '../src/CommandBar.jsx';

const agent = { id: 'a1', name: 'Scout', role: 'research', status: 'idle' };
const props = { canvasId: 'c1', agents: [agent], agentsById: { a1: agent }, toast: vi.fn() };
const answered = { id: 'i1', question: 'What should we do?', mode: 'ask', status: 'answered', run: { id: 'r1', summary: 'Review the renewal date.' }, agent };
beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path, opts) => {
    if (path.endsWith('/inquiries') && opts?.method === 'POST') return Promise.resolve({ inquiry: { id: 'next', question: opts.body.question, status: 'pending', mode: opts.body.mode }, selection: {} });
    if (path.endsWith('/inquiries')) return Promise.resolve({ inquiries: [answered] });
    if (path.endsWith('/receipt')) return Promise.resolve({ provided: [], cited: [], searches: [], evidence: [] });
    if (path === '/api/canvases') return Promise.resolve({ canvases: [{ id: 'c1', name: 'Renewals', access: 'edit' }] });
    if (path === '/api/canvases/c1') return Promise.resolve({ canvas: { id: 'c1' }, access: 'edit', agents: [agent], notes: [], tasks: [], files: [], people: [], runs: [], handoffs: [] });
    if (path === '/api/control/status') return Promise.resolve({ paused: false, cost_usd: 0, budget_usd: 25 });
    return Promise.resolve({});
  });
  vi.stubGlobal('WebSocket', class { static OPEN = 1; readyState = 1; send() {} close() {} });
});

it('starts on Home with one composer and keeps secondary controls behind More', async () => {
  render(<AppCtx.Provider value={{ user: { role: 'member', email: 'me@example.com' }, config: { inquiryHome: true, needsYou: true, rooms: true, standingRules: true }, toast: vi.fn(), setTheme: vi.fn(), setUser: vi.fn(), theme: 'light' }}><Workspace /></AppCtx.Provider>);
  await screen.findByRole('heading', { name: 'Ask the company.' });
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('button', { name: 'Rooms' })).not.toBeVisible();
  expect(screen.queryByLabelText('Systems console')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /^Needs you:/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  await userEvent.click(screen.getByText('More', { selector: 'summary' }));
  for (const name of ['Rooms', 'Memory', 'Scheduled work', 'Documents & notes', 'Team', 'Help']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  await userEvent.click(screen.getByText('Advanced', { selector: '.header-menu-content summary' }));
  for (const name of ['Canvas', 'Commands', 'Activity']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
});

it('adds an agent directly from Home and retains the question without submitting it', async () => {
  const base = api.getMockImplementation();
  let staffed = false;
  api.mockImplementation((path, options) => {
    if (path === '/api/roster') return Promise.resolve({ roster: [{ ...agent, id: 'template-scout', enabled: 1, model_tier: 'strong' }] });
    if (path === '/api/canvases/c1/agents' && options?.method === 'POST') { staffed = true; return Promise.resolve({ agent }); }
    if (path === '/api/canvases/c1') return Promise.resolve({ canvas: { id: 'c1' }, access: 'edit', agents: staffed ? [agent] : [], notes: [], tasks: [], files: [], people: [], runs: [], handoffs: [] });
    if (path.endsWith('/inquiries')) return Promise.resolve({ inquiries: [] });
    return base(path, options);
  });
  render(<AppCtx.Provider value={{ user: { role: 'member', email: 'me@example.com' }, config: { inquiryHome: true, agentBuilder: true }, toast: vi.fn(), setTheme: vi.fn(), setUser: vi.fn(), theme: 'light' }}><Workspace /></AppCtx.Provider>);
  await screen.findByText(/This project space needs an agent/);
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'What is our ICP?');
  await userEvent.click(screen.getByRole('button', { name: 'Add agent', exact: true }));
  await userEvent.click(await screen.findByRole('button', { name: /Scout/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled());
  expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('What is our ICP?');
  expect(api).toHaveBeenCalledWith('/api/canvases/c1/agents', { method: 'POST', body: { roster_id: 'template-scout' } });
  expect(api.mock.calls.filter(([path, options]) => path.endsWith('/inquiries') && options?.method === 'POST')).toHaveLength(0);
});

it('Act on this carries visible editable context and does not submit until asked', async () => {
  render(<Home {...props} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Act on this' }));
  expect(screen.getByRole('radio', { name: 'Act' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Answer attached to your follow-up')).toBeInTheDocument();
  expect(api.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(0);
  expect(screen.getByLabelText('Ask a question about the company')).toHaveFocus();
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'Draft a short checklist.');
  await userEvent.click(screen.getByRole('button', { name: 'Act', exact: true }));
  const post = api.mock.calls.find(([, opts]) => opts?.method === 'POST');
  expect(post[0]).toBe('/api/canvases/c1/inquiries');
  expect(post[1].body).toMatchObject({ mode: 'act', question: expect.stringContaining('Draft a short checklist.') });
  expect(post[1].body.question).toContain('Review the renewal date.');
});

it('lets a teammate clear answer context while retaining their follow-up text', async () => {
  render(<Home {...props} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Act on this' }));
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'My own request');
  await userEvent.click(screen.getByRole('button', { name: 'Clear answer context' }));
  expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('My own request');
  expect(screen.queryByText('Answer attached to your follow-up')).not.toBeInTheDocument();
});

it('preserves command parsing, practice, confirmation and cancelled input', async () => {
  const parse = vi.fn().mockResolvedValue({ action: 'dispatch', agent_id: 'a1', echo: 'Scout will review it' });
  const confirm = vi.fn();
  render(<CommandBar canvasId="c1" onParse={parse} onConfirm={confirm} toast={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Advanced command'), 'Review the brief');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Scout will review it');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Advanced command')).toHaveValue('Review the brief');
  await userEvent.click(screen.getByRole('radio', { name: 'Practice (Rehearse)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  expect(parse).toHaveBeenLastCalledWith('Review the brief', 'rehearse');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ mode: 'rehearse', agent_id: 'a1' }));
});

it('supports arrow keys for the default Ask and Act choice', async () => {
  render(<Home {...props} />);
  await screen.findByRole('button', { name: 'Act on this' });
  await userEvent.click(screen.getByRole('radio', { name: 'Ask' }));
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Act' })).toHaveFocus();
  expect(screen.getByRole('radio', { name: 'Act' })).toHaveAttribute('aria-checked', 'true');
});

it('reconciles a terminal answer that finishes before its submission response', async () => {
  let submitted = false;
  api.mockImplementation((path, opts) => {
    if (opts?.method === 'POST') { submitted = true; return Promise.resolve({ inquiry: { ...answered, status: 'pending' }, selection: {} }); }
    if (path.endsWith('/receipt')) return Promise.resolve({ provided: [], cited: [], searches: [], evidence: [] });
    return Promise.resolve({ inquiries: submitted ? [answered] : [] });
  });
  render(<Home {...props} />);
  await screen.findByText('Try asking');
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'A fast question');
  await userEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }));
  await screen.findByText('Review the renewal date.');
  expect(screen.queryByText(/The agent is working/)).not.toBeInTheDocument();
});

it('keeps the complete submitted context reachable without repeating it as the result title', async () => {
  const question = 'Follow-up request: Draft a checklist.\n\nSelected answer for context (verify its claims before acting):\nQuestion: Original question\nAnswer: Original answer';
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/inquiries') ? { inquiries: [{ ...answered, question, mode: 'act' }] } : { provided: [], cited: [], searches: [], evidence: [] }));
  render(<Home {...props} />);
  expect(await screen.findByText('Draft a checklist.')).toHaveClass('answer-question');
  const details = screen.getByText('Request and attached context').closest('details');
  expect(details).not.toHaveAttribute('open');
  await userEvent.click(screen.getByText('Request and attached context'));
  expect(details).toHaveTextContent('Original question');
  expect(details).toHaveTextContent('Original answer');
  expect(details.querySelector('div').textContent).toBe(question);
});

it('leaves user-authored request text intact and labels automatic selection in plain English', async () => {
  api.mockImplementation((path, opts) => {
    if (opts?.method === 'POST') return Promise.resolve({ inquiry: answered, selection: { auto: true, echo: 'Asking Scout (strategic) — picked automatically' } });
    return Promise.resolve(path.endsWith('/inquiries') ? { inquiries: [{ ...answered, question: 'Follow-up request: My own text', mode: 'act' }] } : { provided: [], cited: [], searches: [], evidence: [] });
  });
  const toast = vi.fn();
  render(<Home {...props} toast={toast} />);
  expect(await screen.findByText('Follow-up request: My own text')).toHaveClass('answer-question');
  expect(screen.queryByText('Request and attached context')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'Next question');
  await userEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith('Scout received your request.', 'ok'));
});

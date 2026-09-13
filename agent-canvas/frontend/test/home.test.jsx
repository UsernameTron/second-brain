// P2.1: Inquiry Home interaction contracts — suggested questions on an empty
// canvas, ask-prepends-inquiry, and the stale-response guard: an older list
// request resolving after a newer one must never win.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, api: vi.fn() };
});
vi.mock('../src/Panels.jsx', () => ({ ContextReceipt: () => null }));

import { api } from '../src/api.js';
import Home from '../src/Home.jsx';

const AGENT = { id: 'a1', name: 'Scout', role: 'research', color: '#0af' };

function inquiry(id, question) {
  return { id, question, status: 'pending', mode: 'ask', saved: false, createdAt: new Date().toISOString(), run: null, agent: AGENT, selectionAuto: true };
}

function renderHome(props = {}) {
  return render(
    <Home canvasId="c1" agents={[AGENT]} agentsById={{ a1: AGENT }} paused={false}
      runTick={0} onOpenRun={vi.fn()} toast={vi.fn()} {...props} />,
  );
}

beforeEach(() => { api.mockReset(); });

describe('Inquiry Home', () => {
  it('updates Saved only after a confirmed unsave and keeps the answer in Show all', async () => {
    let item = { ...inquiry('saved-answer', 'Keep this history'), status: 'answered', saved: true };
    let failSave = true;
    api.mockImplementation((path, options) => {
      if (options?.method === 'PATCH') {
        if (failSave) return Promise.reject(Object.assign(new Error('offline'), { status: 503 }));
        item = { ...item, saved: options.body.saved };
        return Promise.resolve({ inquiry: item });
      }
      return Promise.resolve({ inquiries: path.endsWith('?saved=1') && !item.saved ? [] : [item] });
    });
    renderHome();
    await screen.findByText('Keep this history');
    await userEvent.click(screen.getByRole('button', { name: 'Saved only' }));
    await userEvent.click(await screen.findByRole('button', { name: '★ saved' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Keep this history')).toBeVisible();
    failSave = false;
    await userEvent.click(screen.getByRole('button', { name: '★ saved' }));
    await screen.findByText('nothing saved yet — star an answer to keep it here');
    expect(screen.queryByText('Keep this history')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByText('Keep this history')).toBeVisible();
    expect(screen.getByRole('button', { name: '☆ save' })).toBeVisible();
  });

  it('uses the current answer filter when an in-flight save completes', async () => {
    let finish;
    let item = { ...inquiry('saved-answer', 'Saved history'), saved: true, status: 'answered' };
    const other = { ...inquiry('other', 'Other history'), status: 'answered' };
    api.mockImplementation((path, options) => {
      if (options?.method === 'PATCH') return new Promise((resolve) => { finish = () => { item = { ...item, saved: false }; resolve({ inquiry: item }); }; });
      return Promise.resolve({ inquiries: path.endsWith('?saved=1') ? (item.saved ? [item] : []) : [item, other] });
    });
    renderHome();
    await screen.findByText('Saved history');
    await userEvent.click(screen.getByRole('button', { name: 'Saved only' }));
    await userEvent.click(await screen.findByRole('button', { name: '★ saved' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    finish();
    await screen.findByText('Other history');
    expect(screen.getByText('Saved history')).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole('button', { name: '☆ save' })).toHaveLength(2));
    expect(api.mock.calls.at(-1)[0]).toBe('/api/canvases/c1/inquiries');
  });

  it('explains an unstaffed space and keeps typing, examples and setup from submitting work', async () => {
    api.mockResolvedValue({ inquiries: [] });
    const onAddAgent = vi.fn();
    renderHome({ agents: [], onAddAgent });
    await screen.findByText('Try asking');
    expect(screen.getByRole('status')).toHaveTextContent('needs an agent');
    const field = screen.getByLabelText('Ask a question about the company');
    await userEvent.type(field, 'What is our ICP?{Enter}');
    expect(screen.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Act', exact: true }));
    expect(screen.getByRole('button', { name: 'Act', exact: true })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /What did we decide/ }));
    expect(field).toHaveValue('What did we decide about our ICP scoring, and why?');
    await userEvent.click(screen.getByRole('button', { name: 'Add agent' }));
    expect(onAddAgent).toHaveBeenCalledOnce();
    expect(field).toHaveValue('What did we decide about our ICP scoring, and why?');
    expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('recovers a server-reported missing team after confirmed staffing without losing or resending the question', async () => {
    api.mockImplementation((path, options) => options?.method === 'POST'
      ? Promise.reject(Object.assign(new Error('this canvas has no agents to ask'), { status: 409 }))
      : Promise.resolve({ inquiries: [] }));
    const onAddAgent = vi.fn();
    const toast = vi.fn();
    const { rerender } = renderHome({ onAddAgent, toast });
    await screen.findByText('Try asking');
    await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'What is our ICP?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }));
    await screen.findByText(/This project space needs an agent/);
    expect(screen.queryByText(/This item changed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add agent' }));
    expect(onAddAgent).toHaveBeenCalledOnce();
    rerender(<Home canvasId="c1" agents={[{ ...AGENT, id: 'new-agent' }]} agentsById={{}} toast={toast} onAddAgent={onAddAgent} />);
    await waitFor(() => expect(screen.queryByText(/This project space needs an agent/)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('What is our ICP?');
    expect(screen.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled();
    expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });

  it('keeps real conflicts distinct from missing staffing', async () => {
    api.mockImplementation((path, options) => options?.method === 'POST'
      ? Promise.reject(Object.assign(new Error('another conflict'), { status: 409 }))
      : Promise.resolve({ inquiries: [] }));
    renderHome();
    await screen.findByText('Try asking');
    await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'A question');
    await userEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }));
    await screen.findByText(/This item changed/);
    expect(screen.queryByText(/This project space needs an agent/)).not.toBeInTheDocument();
  });

  it('gives view-only teammates the staffing explanation without edit controls', async () => {
    api.mockResolvedValue({ inquiries: [] });
    renderHome({ agents: [], editable: false, onAddAgent: vi.fn() });
    await screen.findByText('Ask the project owner to add an agent.');
    expect(screen.queryByRole('button', { name: 'Add agent' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ask a question about the company')).toBeDisabled();
  });

  it('shows suggested questions when the canvas has no inquiries', async () => {
    api.mockResolvedValueOnce({ inquiries: [] });
    renderHome();
    expect(await screen.findByText('Try asking')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /What do we know|Which deals|What did we decide/ })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'More examples' }));
    expect(screen.getByText(/pre-call brief/i)).toBeInTheDocument();
  });

  it('asking a question posts the inquiry and prepends it to the list', async () => {
    api.mockResolvedValueOnce({ inquiries: [inquiry('old', 'Old question?')] });
    renderHome();
    await screen.findByText('Old question?');

    api.mockResolvedValueOnce({ inquiry: inquiry('new', 'New question?'), selection: { auto: true, echo: 'Scout picked' } })
      .mockResolvedValueOnce({ inquiries: [inquiry('new', 'New question?'), inquiry('old', 'Old question?')] });
    await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'New question?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await screen.findByText('New question?');
    const questions = screen.getAllByText(/question\?/).map((el) => el.textContent);
    expect(questions[0]).toBe('New question?');
    expect(api).toHaveBeenCalledWith('/api/canvases/c1/inquiries', {
      method: 'POST', body: { question: 'New question?', mode: 'ask' },
    });
  });

  it('renders an answered summary as formatted text with contract meaning kept', async () => {
    const answered = {
      ...inquiry('a1', 'Any renewals at risk?'),
      status: 'answered',
      run: { id: 'r1', status: 'completed', summary: '## Renewals\n**Acme** needs a call.\nMATCHED: 2' },
    };
    // The answered card also fetches the run receipt on mount.
    api.mockImplementation((path) => (
      path.includes('/receipt') ? Promise.resolve({ cited: [], searches: [], evidence: [] }) : Promise.resolve({ inquiries: [answered] })
    ));
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Renewals' })).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument(); // **bold** renders as <b>
    // Generic surface: the machine line is humanized, never deleted.
    expect(screen.getByText('2 items matched.')).toBeInTheDocument();
    expect(screen.queryByText(/MATCHED: 2/)).toBeNull();
  });

  it('a stale list response never replaces a newer one', async () => {
    const pending = [];
    api.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const stable = { onOpenRun: vi.fn(), toast: vi.fn() }; // fresh fns would recreate load() and double-fire
    const { rerender } = renderHome(stable);
    // second load: runTick bump (the live-refresh path)
    rerender(
      <Home canvasId="c1" agents={[AGENT]} agentsById={{ a1: AGENT }} paused={false}
        runTick={1} onOpenRun={stable.onOpenRun} toast={stable.toast} />,
    );
    expect(pending.length).toBe(2);

    pending[1]({ inquiries: [inquiry('fresh', 'Fresh answer?')] }); // newer request lands first
    await screen.findByText('Fresh answer?');
    pending[0]({ inquiries: [inquiry('stale', 'Stale answer?')] }); // older request lands late

    await waitFor(() => expect(screen.queryByText('Stale answer?')).toBeNull());
    expect(screen.getByText('Fresh answer?')).toBeInTheDocument();
  });
});

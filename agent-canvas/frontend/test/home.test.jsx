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
  it('shows suggested questions when the canvas has no inquiries', async () => {
    api.mockResolvedValueOnce({ inquiries: [] });
    renderHome();
    expect(await screen.findByText('Try asking')).toBeInTheDocument();
  });

  it('asking a question posts the inquiry and prepends it to the list', async () => {
    api.mockResolvedValueOnce({ inquiries: [inquiry('old', 'Old question?')] });
    renderHome();
    await screen.findByText('Old question?');

    api.mockResolvedValueOnce({ inquiry: inquiry('new', 'New question?'), selection: { auto: true, echo: 'Scout picked' } });
    await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'New question?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await screen.findByText('New question?');
    const questions = screen.getAllByText(/question\?/).map((el) => el.textContent);
    expect(questions[0]).toBe('New question?');
    expect(api).toHaveBeenLastCalledWith('/api/canvases/c1/inquiries', {
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

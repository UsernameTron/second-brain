import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
vi.mock('../src/api.js', async (original) => { const real = await original(); const api = vi.fn(); return { ...real, api, rulesApi: real.makeRulesApi(api) }; });
import { api } from '../src/api.js';
import { AgentPanel, NotePanel } from '../src/Panels.jsx';
import CommandBar from '../src/CommandBar.jsx';
import { DraftsContext } from '../src/Drafts.jsx';
import Home from '../src/Home.jsx';
import RulesView from '../src/RulesView.jsx';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

it('a late note save cannot replace a newer draft after closing and reopening', async () => {
  const drafts = { current: new Map() };
  const note = { id: 'n1', title: 'Notes', content: 'Original', version: 1 };
  const response = deferred();
  const save = vi.fn(() => response.promise);
  const show = (open) => <DraftsContext.Provider value={drafts}>{open ? <NotePanel note={note} onSave={save} onClose={() => {}} /> : null}</DraftsContext.Provider>;
  const view = render(show(true));
  await userEvent.clear(screen.getByLabelText('Note content'));
  await userEvent.type(screen.getByLabelText('Note content'), 'First saved change');
  await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
  view.rerender(show(false)); view.rerender(show(true));
  await userEvent.clear(screen.getByLabelText('Note content'));
  await userEvent.type(screen.getByLabelText('Note content'), 'My next unsaved change');
  await act(async () => response.resolve({ note: { ...note, content: 'First saved change', version: 2 } }));
  view.rerender(show(false)); view.rerender(show(true));
  expect(screen.getByLabelText('Note content')).toHaveValue('My next unsaved change');
  expect(save).toHaveBeenCalledTimes(1);
});

it('a late dispatch cannot clear the next instruction written after reopening the agent', async () => {
  const drafts = { current: new Map() };
  const response = deferred();
  const dispatch = vi.fn(() => response.promise);
  const show = (open) => <DraftsContext.Provider value={drafts}>{open ? <AgentPanel canvasId="c1" agent={{ id: 'a1', name: 'Scout' }} runs={[]} onDispatch={dispatch} /> : null}</DraftsContext.Provider>;
  const view = render(show(true));
  await userEvent.type(screen.getByLabelText('Send to Scout'), 'First instruction');
  await userEvent.click(screen.getByRole('button', { name: 'Dispatch to Scout' }));
  view.rerender(show(false)); view.rerender(show(true));
  await userEvent.clear(screen.getByLabelText('Send to Scout'));
  await userEvent.type(screen.getByLabelText('Send to Scout'), 'Next instruction');
  await act(async () => response.resolve({}));
  view.rerender(show(false)); view.rerender(show(true));
  expect(screen.getByLabelText('Send to Scout')).toHaveValue('Next instruction');
  expect(dispatch).toHaveBeenCalledExactlyOnceWith('First instruction');
});

it('command confirmation preserves text edited while the previous command is saving', async () => {
  const response = deferred();
  const confirm = vi.fn(() => response.promise);
  render(<CommandBar canvasId="c1" onParse={vi.fn().mockResolvedValue({ action: 'dispatch', instruction: 'First instruction' })} onConfirm={confirm} />);
  await userEvent.type(screen.getByLabelText('Advanced command'), 'First command');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await userEvent.clear(screen.getByLabelText('Advanced command'));
  await userEvent.type(screen.getByLabelText('Advanced command'), 'Next command');
  await act(async () => response.resolve({}));
  expect(screen.getByLabelText('Advanced command')).toHaveValue('Next command');
  expect(confirm).toHaveBeenCalledExactlyOnceWith({ action: 'dispatch', instruction: 'First instruction', mode: 'ask' });
});

it('cancelling a late interpretation preserves the newer command text', async () => {
  const response = deferred();
  const confirm = vi.fn();
  render(<CommandBar canvasId="c1" onParse={() => response.promise} onConfirm={confirm} />);
  await userEvent.type(screen.getByLabelText('Advanced command'), 'First command');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  await userEvent.clear(screen.getByLabelText('Advanced command'));
  await userEvent.type(screen.getByLabelText('Advanced command'), 'Newer command');
  await act(async () => response.resolve({ action: 'dispatch', instruction: 'First command' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Advanced command')).toHaveValue('Newer command');
  expect(confirm).not.toHaveBeenCalled();
});

it('Home preserves a different answer attached while the previous request is saving', async () => {
  const response = deferred();
  const agent = { id: 'a1', name: 'Scout' };
  const answers = [1, 2].map((id) => ({ id: `i${id}`, question: `Question ${id}`, status: 'answered', mode: 'ask', agent, run: { id: `r${id}`, summary: `Answer ${id}` } }));
  api.mockImplementation((path, options) => options?.method === 'POST' ? response.promise : Promise.resolve(path.endsWith('/inquiries') ? { inquiries: answers } : { provided: [], searches: [], cited: [], evidence: [] }));
  const view = render(<Home canvasId="c1" agents={[agent]} agentsById={{ a1: agent }} toast={vi.fn()} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'Act on this' }))[0]);
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'First follow-up');
  await userEvent.click(screen.getByRole('button', { name: 'Act', exact: true }));
  await userEvent.click(screen.getAllByRole('button', { name: 'Act on this' })[1]);
  await act(async () => response.resolve({ inquiry: { ...answers[0], id: 'i3' } }));
  expect(view.container.querySelector('.home-ask .answer-context')).toHaveTextContent('Answer 2');
  expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('');
});

it('scheduled interpretation does not erase the next instruction typed while waiting', async () => {
  const response = deferred();
  const rule = { id: 'sr1', instruction: 'First schedule', state: 'draft', version: 1, agent_id: 'a1', interpretation: { sources: ['memory'], can: ['read'], cannot: ['send'], scope: 'renewals' } };
  api.mockImplementation((path) => {
    if (path.endsWith('/parse')) return response.promise;
    if (path.endsWith('/standing-rules')) return Promise.resolve({ rules: [] });
    return Promise.resolve({ access: 'edit', agents: [{ id: 'a1', name: 'Scout' }] });
  });
  render(<RulesView canvasId="c1" user={{ email: 'owner@example.com', role: 'owner' }} agents={[]} toast={vi.fn()} />);
  await userEvent.type(await screen.findByLabelText('Describe the standing rule'), 'First schedule');
  await userEvent.click(screen.getByRole('button', { name: 'Interpret', exact: true }));
  await userEvent.clear(screen.getByLabelText('Describe the standing rule'));
  await userEvent.type(screen.getByLabelText('Describe the standing rule'), 'Next schedule');
  await act(async () => response.resolve({ rule }));
  await userEvent.click(await screen.findByRole('button', { name: '← Rules', exact: true }));
  expect(screen.getByLabelText('Describe the standing rule')).toHaveValue('Next schedule');
});

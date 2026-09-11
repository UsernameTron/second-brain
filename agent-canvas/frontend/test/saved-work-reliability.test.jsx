import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
import { api } from '../src/api.js';
import Home from '../src/Home.jsx';
import { AgentPanel, NotePanel, SpendPanel, ContextReceipt } from '../src/Panels.jsx';
import MemoryPanel from '../src/MemoryPanel.jsx';
import WorkDetails from '../src/WorkDetails.jsx';
import { DraftsContext } from '../src/Drafts.jsx';

const agent = { id: 'a1', name: 'Scout', role: 'research' };
const inquiry = { id: 'i1', question: 'A question', mode: 'ask', status: 'answered', run: { id: 'old-run', summary: 'A useful answer', status: 'completed' }, agent };
const receipt = { run: { id: 'old-run', summary: 'Archived agent answer', status: 'completed' }, provided: [], searches: [], cited: [], evidence: [] };
const homeProps = { canvasId: 'c1', agents: [agent], agentsById: { a1: agent }, toast: vi.fn(), onOpenRun: vi.fn() };
beforeEach(() => { api.mockReset(); });

it.each([
  ['verified', 'filled', 'Confirmed (verified)'],
  ['inference', 'half', 'Reasoned conclusion (inference)'],
  ['assumption', 'hollow', 'Unconfirmed (assumption)'],
])('preserves the %s memory shape and border alongside its plain-English label', (epistemic, shape, label) => {
  const { container } = render(<MemoryPanel entries={[{ id: 'm1', content: 'A claim', epistemic }]} agentsById={{}} />);
  const entry = container.querySelector('.mem-entry');
  expect(entry).toHaveClass(`epi-${epistemic}`);
  expect(entry.querySelector('.epi-dot')).toHaveClass(shape);
  expect(entry.querySelector('.epi-label')).toHaveTextContent(label);
});

it('retains certainty styling in attached, retrieved and written receipt entries', () => {
  const entries = ['verified', 'inference', 'assumption'].map((epistemic) => ({ id: epistemic, epistemic, content: epistemic }));
  const { container } = render(<ContextReceipt receipt={{ provided: [entries[0]], searches: [{ query: 'claims', results: [{ entry: entries[1], rank: 1 }] }], cited: [entries[2]] }} />);
  expect([...container.querySelectorAll('.receipt-entry')].map((node) => node.className)).toEqual(entries.map((entry) => `receipt-entry epi-${entry.epistemic}`));
});

it('retains a failed note and saves it on an explicit retry', async () => {
  const note = { id: 'n1', title: 'Notes', content: 'Original', version: 1 };
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async (_, draft) => ({ note: { ...note, ...draft, version: 2 } }));
  render(<NotePanel note={note} onSave={save} onClose={vi.fn()} />);
  await userEvent.clear(screen.getByLabelText('Note content'));
  await userEvent.type(screen.getByLabelText('Note content'), 'Keep this draft');
  await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Note content')).toHaveValue('Keep this draft');
  await userEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  await screen.findByText('Note saved.');
  expect(save).toHaveBeenCalledTimes(2);
});

it('keeps note drafts across closing and reopening within the workspace', async () => {
  const drafts = { current: new Map() };
  const note = { id: 'n1', title: 'Notes', content: 'Original', version: 1 };
  const show = (open) => <DraftsContext.Provider value={drafts}>{open ? <NotePanel note={note} onSave={vi.fn()} /> : null}</DraftsContext.Provider>;
  const view = render(show(true));
  await userEvent.type(screen.getByLabelText('Note content'), ' with a draft');
  view.rerender(show(false)); view.rerender(show(true));
  expect(screen.getByLabelText('Note content')).toHaveValue('Original with a draft');
});

it('retains failed direct instructions and budget edits', async () => {
  const view = render(<AgentPanel agent={agent} runs={[]} onDispatch={vi.fn().mockRejectedValue(new Error('offline'))} />);
  await userEvent.type(screen.getByLabelText('Send to Scout'), 'Do this later');
  await userEvent.click(screen.getByRole('button', { name: 'Dispatch to Scout' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Send to Scout')).toHaveValue('Do this later');
  view.unmount();
  render(<SpendPanel isOwner budget={{ budget_usd: 25, cost_usd: 0 }} onSetBudget={vi.fn().mockRejectedValue(new Error('offline'))} />);
  await userEvent.click(screen.getByText('Owner settings', { selector: 'summary' }));
  await userEvent.type(screen.getByLabelText('Set daily budget (USD)'), '30');
  await userEvent.click(screen.getByRole('button', { name: 'Set' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Set daily budget (USD)')).toHaveValue(30);
});

it('distinguishes failed answer loads from empty and retains failed questions', async () => {
  api.mockRejectedValue(new Error('offline'));
  render(<Home {...homeProps} />);
  await screen.findByText('Loading answers could not be completed. Check your connection and try again.');
  expect(screen.queryByText('Try asking')).not.toBeInTheDocument();
  api.mockImplementation((_, opts) => opts?.method === 'POST' ? Promise.reject(new Error('offline')) : Promise.resolve({ inquiries: [] }));
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Try asking');
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'Keep my question');
  await userEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Ask a question about the company')).toHaveValue('Keep my question');
});

it('does not confuse external sources with memory written and recovers unavailable receipts', async () => {
  let unavailable = true;
  api.mockImplementation((path) => path.endsWith('/receipt') ? unavailable ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ...receipt, evidence: [{ id: 'e1', sourceKind: 'web', title: 'Source record', uri: 'https://example.com' }] })
    : Promise.resolve({ inquiries: [inquiry] }));
  render(<Home {...homeProps} />);
  await screen.findByText("Loading this answer's sources could not be completed. Check your connection and try again.");
  expect(screen.queryByText(/unsupported summary/)).not.toBeInTheDocument();
  unavailable = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Web sources · Source record');
  expect(screen.queryByText(/unsupported summary/)).not.toBeInTheDocument();
});

it('labels an answer without recorded supporting sources explicitly', async () => {
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/receipt') ? receipt : { inquiries: [inquiry] }));
  render(<Home {...homeProps} />);
  expect(await screen.findByText(/No supporting sources were recorded/)).toBeInTheDocument();
});

it('ignores a late submission after switching to a different project space', async () => {
  let finish;
  api.mockImplementation((path, opts) => opts?.method === 'POST' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ inquiries: [] }));
  const view = render(<Home {...homeProps} />);
  await screen.findByText('Try asking');
  await userEvent.type(screen.getByLabelText('Ask a question about the company'), 'Old request');
  await userEvent.click(screen.getByRole('button', { name: 'Ask', exact: true }));
  view.rerender(<Home {...homeProps} canvasId="c2" />);
  await act(async () => finish({ inquiry, selection: {} }));
  expect(screen.queryByText('A useful answer')).not.toBeInTheDocument();
});

it('opens an old run without a current agent and retries unavailable events', async () => {
  let unavailable = true;
  api.mockImplementation((path) => path.endsWith('/events') ? unavailable ? Promise.reject(new Error('offline')) : Promise.resolve({ events: [] }) : Promise.resolve(receipt));
  render(<WorkDetails canvasId="another-space" runId="old-run" onClose={vi.fn()} />);
  expect(await screen.findByText('Archived agent answer')).toBeInTheDocument();
  await screen.findByText('Loading work events could not be completed. Check your connection and try again.');
  expect(screen.queryByText('No events recorded.')).not.toBeInTheDocument();
  unavailable = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No events recorded.')).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith('/api/canvases/another-space/runs/old-run/receipt');
});

it('keeps a rejected memory correction open and exposes failed lineage recovery', async () => {
  const entry = { id: 'm1', content: 'Existing claim', epistemic: 'assumption' };
  api.mockRejectedValue(new Error('offline'));
  render(<MemoryPanel entries={[entry]} agentsById={{}} onCorrect={vi.fn().mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }))} toast={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Correct…' }));
  await userEvent.type(screen.getByLabelText('Corrected memory'), ' corrected');
  await userEvent.click(screen.getByRole('button', { name: 'Correct', exact: true }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Corrected memory')).toHaveValue('Existing claim corrected');
  await userEvent.click(screen.getByRole('button', { name: 'Check memory history' }));
  await screen.findByText('Loading memory sources could not be completed. Check your connection and try again.');
  expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(2);
});

it('keeps certainty changes reachable and submits the existing correction contract', async () => {
  const correct = vi.fn().mockResolvedValue({});
  render(<MemoryPanel entries={[{ id: 'm1', content: 'Original claim', epistemic: 'assumption' }]} agentsById={{}} onCorrect={correct} toast={vi.fn()} />);
  await userEvent.click(screen.getByText('Change certainty'));
  expect(screen.getByText('This creates a correction and preserves the original entry.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '→ Confirmed (verified)' }));
  expect(correct).toHaveBeenCalledWith('m1', expect.objectContaining({ content: 'Original claim', epistemic: 'verified', reason: expect.any(String) }));
});

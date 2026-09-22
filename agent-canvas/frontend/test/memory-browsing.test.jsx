import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../src/api.js', async (original) => ({ ...await original(), api: vi.fn() }));
import { api } from '../src/api.js';
import MemoryPanel from '../src/MemoryPanel.jsx';

const entry = (id = 'a', extra = {}) => ({ id, content: `Claim ${id}`, epistemic: 'verified', kind: 'fact', author: { name: 'Pete', id: 'pete@cloudtechgurus.com' }, source: 'Original source', createdAt: '2026-08-15T12:00:00Z', ...extra });
const sources = (id = 'a', extra = {}) => ({ entry: entry(id), upstream: [], downstream: [], producingRun: null, runReads: [], ...extra });
const history = (id = 'a') => ({ events: [{ event: 'created', entryId: id, at: '2026-08-15T12:00:00Z', byName: 'Pete' }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const props = { entries: [entry()], agentsById: {}, onClose: vi.fn(), onOpenRun: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources(path.split('/')[3]) : history(path.split('/')[3])));
});

it('keeps certainty, author and source beside each entry while the optional legend is closed; search, all types and earlier versions remain reachable', async () => {
  const toggle = vi.fn();
  const entries = ['fact', 'decision', 'preference', 'constraint', 'outcome', 'feedback'].map((kind, index) => entry(kind, { kind, epistemic: ['verified', 'inference', 'assumption'][index % 3] }));
  const view = render(<MemoryPanel {...props} entries={entries} showSuperseded={false} onToggleSuperseded={toggle} />);
  expect(screen.getByText('What certainty means').closest('details')).not.toHaveAttribute('open');
  for (const node of view.container.querySelectorAll('.mem-entry')) {
    expect(node.querySelector('.epi-label')).toBeVisible(); expect(within(node).getByText('Pete')).toBeVisible(); expect(within(node).getByText('Original source')).toBeVisible();
  }
  expect(screen.getAllByRole('option')).toHaveLength(7);
  await userEvent.selectOptions(screen.getByLabelText('Memory type'), 'constraint');
  expect(view.container.querySelectorAll('.mem-entry')).toHaveLength(1);
  expect(screen.getByText('Claim constraint')).toBeVisible();
  await userEvent.type(screen.getByLabelText('Search memory'), 'no result');
  expect(screen.getByText('Nothing matches that filter.')).toBeVisible();
  await userEvent.click(screen.getByLabelText('Include earlier versions'));
  expect(toggle).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByText('What certainty means'));
  expect(view.container.querySelector('.epi-legend')).toBeVisible();
  expect(api).not.toHaveBeenCalled();
});

it('shows empty recorded history and source links honestly without claiming the entry was written by a person', async () => {
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources() : { events: [] }));
  render(<MemoryPanel {...props} initialEntryId="a" />);
  expect(await screen.findByText('No earlier memory entries are linked as sources.')).toBeVisible();
  expect(screen.getByText('No other memory entries are linked to this information.')).toBeVisible();
  expect(screen.getByText('No agent work record is linked to this entry.')).toBeVisible();
  expect(screen.getByText('No history events were returned.')).toBeVisible();
  expect(screen.queryByText(/written by a human/)).toBeNull();
  api.mockResolvedValue(history());
  await userEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  expect(await screen.findByText('Added', { exact: true })).toBeVisible();
  expect(screen.queryByText('No history events were returned.')).toBeNull();
});

it('separates source and history loading; a source error cannot hide successfully loaded changes', async () => {
  const held = deferred();
  api.mockImplementation((path) => path.endsWith('/lineage') ? held.promise : Promise.resolve(history()));
  render(<MemoryPanel {...props} initialEntryId="a" />);
  expect(screen.getByText('Loading memory sources…')).toBeVisible();
  expect(await screen.findByText('Added', { exact: true })).toBeVisible();
  await act(async () => held.reject(new Error('Offline')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Loading memory sources could not');
  expect(screen.getByText('Added', { exact: true })).toBeVisible();
  expect(screen.queryByText('No agent work record is linked to this entry.')).toBeNull();
});

it('rejects incomplete responses and retries each resource independently without treating either as empty', async () => {
  api.mockResolvedValue({}); render(<MemoryPanel {...props} initialEntryId="a" />);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(screen.queryByText('No history events were returned.')).toBeNull();
  expect(screen.queryByText('No earlier memory entries are linked as sources.')).toBeNull();
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources() : history()));
  const changes = within(screen.getByRole('region', { name: 'Changes over time' }));
  await userEvent.click(changes.getByRole('button', { name: 'Try again' }));
  expect(await changes.findByText('Added', { exact: true })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Loading memory sources could not');
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Claim a')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('rejects source data for a different entry instead of displaying it under the requested record', async () => {
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources('wrong') : history()));
  render(<MemoryPanel {...props} initialEntryId="a" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Loading memory sources could not');
  expect(screen.queryByText('Claim wrong')).toBeNull();
});

it('ignores the first A responses after visiting B and returning to A, including an obsolete failure', async () => {
  const firstSource = deferred(), firstHistory = deferred(); let sourceReads = 0, historyReads = 0;
  api.mockImplementation((path) => {
    if (path === '/api/memory/a/lineage' && ++sourceReads === 1) return firstSource.promise;
    if (path === '/api/memory/a/timeline' && ++historyReads === 1) return firstHistory.promise;
    const id = path.split('/')[3]; return Promise.resolve(path.endsWith('/lineage') ? sources(id, { entry: entry(id, { content: `Current ${id}` }) }) : history(id));
  });
  const view = render(<MemoryPanel {...props} initialEntryId="a" />);
  view.rerender(<MemoryPanel {...props} initialEntryId="b" />);
  await screen.findByText('Current b');
  view.rerender(<MemoryPanel {...props} initialEntryId="a" />);
  await screen.findByText('Current a');
  await act(async () => { firstSource.resolve(sources('a', { entry: entry('a', { content: 'Obsolete a' }) })); firstHistory.reject(new Error('Obsolete error')); });
  expect(screen.getByText('Current a')).toBeVisible();
  expect(screen.queryByText('Obsolete a')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Added', { exact: true })).toBeVisible();
});

it('preserves labelled last-known details after refresh fails and recovers through independent retries', async () => {
  render(<MemoryPanel {...props} initialEntryId="a" />); await screen.findByText('Claim a');
  api.mockRejectedValue(new Error('Offline'));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh details' }));
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(screen.getByText(/Last known sources are shown/)).toBeVisible();
  expect(screen.getByText(/Last known changes are shown/)).toBeVisible();
  expect(screen.getByText('Claim a')).toBeVisible();
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources('a', { entry: entry('a', { content: 'Refreshed claim' }) }) : history()));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh details' }));
  expect(await screen.findByText('Refreshed claim')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('preserves every recorded history classification, truncation warning, reason and version link', async () => {
  const events = ['created', 'corrected', 'reclassified', 'reaffirmed', 'earlier history truncated', 'future event'].map((event, index) => ({ event, entryId: `version-${index}`, byName: 'Pete', reason: `Reason ${index}` }));
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources(path.split('/')[3]) : { events }));
  render(<MemoryPanel {...props} initialEntryId="a" />);
  for (const label of ['Added', 'Corrected', 'Certainty or type changed', 'Confirmed again', 'Earlier changes not shown', 'History event: future event']) expect(await screen.findByText(label, { exact: true })).toBeVisible();
  expect(screen.getByText('Reason 4')).toBeVisible();
  await userEvent.click(screen.getAllByRole('button', { name: 'View this version' })[1]);
  expect(await screen.findByText('Claim version-1')).toBeVisible();
  expect(api).toHaveBeenCalledWith('/api/memory/version-1/timeline');
});

it('retains original certainty and correction warnings, linked source navigation, work references and recorded reads', async () => {
  const old = entry('old', { epistemic: 'assumption', supersededBy: 'a', depth: 1, tainted: true });
  const data = sources('a', { entry: entry('a', { runId: 'run-old', supersedes: 'old', supersedeReason: 'Checked the original' }), upstream: [old], downstream: [entry('later', { depth: 2 })], producingRun: { id: 'run-old', agent_id: 'retired-agent', status: 'halted_budget', instruction: 'Original instruction' }, runReads: [entry('read')] });
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? path.includes('/a/') ? data : sources(path.split('/')[3]) : history()));
  const onOpenRun = vi.fn(); render(<MemoryPanel {...props} initialEntryId="a" onOpenRun={onOpenRun} />);
  await screen.findByText('Claim old');
  const previous = within(screen.getByText('Claim old').closest('.mem-entry'));
  expect(previous.getByText('Unconfirmed (assumption)')).toBeVisible();
  expect(previous.getByText('Earlier version')).toBeVisible();
  expect(previous.getByText('⚠ Uses information that was corrected')).toBeVisible();
  expect(screen.getByText('Stopped at spending limit')).toBeVisible();
  expect(screen.getByText('Claim read')).toBeVisible();
  expect(screen.getByText('Agent name unavailable')).toBeVisible();
  await userEvent.click(screen.getByText('Technical details'));
  expect(screen.getByText('Agent reference: retired-agent')).toBeVisible();
  await userEvent.click(screen.getAllByRole('button', { name: 'View work' })[0]);
  expect(onOpenRun).toHaveBeenCalledWith('run-old');
  await userEvent.click(previous.getByRole('button', { name: 'History and sources' }));
  expect(api).toHaveBeenCalledWith('/api/memory/old/lineage');
});

it('keeps privacy placeholders intact and never fills in restricted content', async () => {
  const redacted = entry('private', { redacted: true, content: '[entry on a canvas you cannot access]', author: { type: 'redacted' }, source: '', depth: 1 });
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources('a', { upstream: [redacted] }) : history()));
  render(<MemoryPanel {...props} initialEntryId="a" />);
  expect(await screen.findByText('[entry on a canvas you cannot access]')).toBeVisible();
  expect(screen.getByText('Author unavailable')).toBeVisible();
});

it('returning to memory prevents delayed source responses from reopening history or changing its filters', async () => {
  const held = deferred(); api.mockReturnValue(held.promise);
  render(<MemoryPanel {...props} />);
  await userEvent.type(screen.getByLabelText('Search memory'), 'Claim');
  await userEvent.click(screen.getByRole('button', { name: 'History and sources' }));
  await userEvent.click(screen.getByRole('button', { name: 'Back to memory' }));
  await act(async () => held.resolve(sources()));
  expect(screen.getByLabelText('Search memory')).toHaveValue('Claim');
  expect(screen.queryByRole('button', { name: 'Back to memory' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('rejects malformed nested source and history fields before they can crash the page', async () => {
  api.mockImplementation((path) => Promise.resolve(path.endsWith('/lineage') ? sources('a', { upstream: [entry('bad', { source: { incomplete: true } })] }) : { events: [{ entryId: 'a', event: 'created', byName: { incomplete: true } }] }));
  render(<MemoryPanel {...props} initialEntryId="a" />);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(screen.getByRole('button', { name: 'Back to memory' })).toBeEnabled();
  expect(screen.queryByText('No history events were returned.')).toBeNull();
});

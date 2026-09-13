import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import NeedsYouView from '../src/NeedsYouView.jsx';

const row = { type: 'escalation', decision: 'Approve these proposed terms?', owner: {}, context: 'question escalation from agent a1',
  escalatingAgentId: 'a1', sourceRef: { id: 'e1', canvasId: 'c2' }, consequence: 'The escalating run stays parked until a human answers.',
  recommendation: 'Answer it — the agent resumes with your decision.' };
const renderCard = (overrides = {}, props = {}) => render(<NeedsYouView rows={[{ ...row, ...overrides }]} agentsById={{ a1: { name: 'Scout' } }} {...props} />);
const business = () => screen.getByRole('region', { name: 'Decision context' });

it('shows the decision and context with one details control and keeps diagnostics reachable', async () => {
  const { container } = renderCard({ contextData: { detail: 'Keep this checklist as a draft.', item_key: 'internal-work-123', entry_ids: [], model: 'internal-model', stepsUsed: 7 } });
  expect(screen.getByText('Keep this checklist as a draft.')).toBeVisible();
  expect(screen.getByText('Your answer goes back to the agent so it can continue.')).toBeVisible();
  expect(screen.queryByText('Answer it — the agent resumes with your decision.')).not.toBeInTheDocument();
  expect(container.querySelectorAll('summary')).toHaveLength(2); // Full details and Other actions.
  const details = screen.getByText('Full details').closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(business()).not.toHaveTextContent('internal-work-123');
  expect(business()).not.toHaveTextContent('internal-model');
  expect(screen.getByRole('button', { name: 'Answer', exact: true })).toBeEnabled();
  await userEvent.click(screen.getByText('Full details'));
  expect(details).toHaveTextContent('internal-work-123');
  expect(details).toHaveTextContent('internal-model');
  expect(details).toHaveTextContent('stepsUsed: 7');
  expect(details).toHaveTextContent('question escalation from agent a1');
});

it('keeps every proposed nested value visible, including zero, false, null and cleared text', () => {
  renderCard({ contextData: { before: { annual_price: 0, approved: false, notes: 'Keep', sponsor: null },
    after: { annual_price: 0, approved: true, notes: '', sponsor: 'Jess', terms: { legal: { reviewer: 'Pete', discount_pct: 12 } } } } });
  expect(within(business()).getByText('Current value')).toBeVisible();
  expect(within(business()).getByText('Proposed value')).toBeVisible();
  expect(business()).toHaveTextContent('annual price: 0');
  expect(business()).toHaveTextContent('approved: no');
  expect(business()).toHaveTextContent('approved: yes');
  expect(business()).toHaveTextContent('sponsor: (not set)');
  expect(business()).toHaveTextContent('notes: (empty text)');
  expect(business()).toHaveTextContent('terms / legal / reviewer: Pete');
  expect(business()).toHaveTextContent('terms / legal / discount pct: 12');
  expect(screen.getByText('Full details').closest('details')).not.toHaveAttribute('open');
});

it('keeps a preview embedded in the agent context readable before the user answers', () => {
  const preview = { preview: true, applied: false, result: { contact: 'Local customer', before: { status: 'Active' }, after: { status: 'Review required', comment: '' } } };
  renderCard({ contextData: { detail: JSON.stringify(preview), entry_ids: [] } });
  expect(business()).toHaveTextContent('preview: yes');
  expect(business()).toHaveTextContent('applied: no');
  expect(business()).toHaveTextContent('result / contact: Local customer');
  expect(business()).toHaveTextContent('result / before / status: Active');
  expect(business()).toHaveTextContent('result / after / status: Review required');
  expect(business()).toHaveTextContent('comment: (empty text)');
});

it('opens related memory in the card project and keeps exact reference IDs in details', async () => {
  const openMemory = vi.fn();
  renderCard({ contextData: { detail: 'Check both versions.', entry_ids: ['memory-a', 'memory-b'] } }, { onOpenMemory: openMemory });
  await userEvent.click(screen.getByRole('button', { name: 'Memory item 2' }));
  expect(openMemory).toHaveBeenCalledWith({ canvasId: 'c2', id: 'memory-b' });
  expect(business()).not.toHaveTextContent('memory-b');
  await userEvent.click(screen.getByText('Full details'));
  expect(screen.getByText('Full details').closest('details')).toHaveTextContent('memory-a, memory-b');
});

it('preserves unknown fields, source-authored wording and coalesced questions', () => {
  const authored = '{Please keep MATCHED: 2 and the term assumption exactly as written.';
  renderCard({ contextData: { detail: authored, customerPolicy: { approval_limit: 1500, legal_review: 'Jess' },
    updates: [{ at: '2026-09-13T00:00:00Z', agentId: 'a1', kind: 'steps', question: 'Could the customer keep the original renewal date?' }] } });
  expect(within(business()).getByText(authored)).toBeVisible();
  expect(business()).toHaveTextContent('Customer Policy');
  expect(business()).toHaveTextContent('approval limit: 1500');
  expect(business()).toHaveTextContent('legal review: Jess');
  expect(business()).toHaveTextContent('Could the customer keep the original renewal date?');
  expect(business()).toHaveTextContent('Scout');
  expect(business()).not.toHaveTextContent('a1');
});

it('accepts plain text context and does not silently omit unusual update fields', () => {
  const view = renderCard({ contextData: 'The original customer instruction.' });
  expect(within(business()).getByText('The original customer instruction.')).toBeVisible();
  view.rerender(<NeedsYouView rows={[{ ...row, contextData: { updates: [{ question: 'Review?', additional_terms: 'Retain every renewal condition.' }] } }]} />);
  expect(business()).toHaveTextContent('Retain every renewal condition.');
});

it('explains unfinished work without claiming that no partial changes happened', async () => {
  const openRun = vi.fn();
  renderCard({ type: 'failed_run', decision: 'Run failed: "Review local records"', context: 'InternalProviderError: timeout on connector-123', contextData: null,
    consequence: 'The work it was asked to do did not happen.', recommendation: 'Retry it, or rephrase the instruction if the failure looks structural.' }, { onOpenRun: openRun });
  expect(screen.getByText('This work did not finish. Check its details before trying again.')).toBeVisible();
  expect(screen.queryByText('The work it was asked to do did not happen.')).not.toBeInTheDocument();
  const details = screen.getByText('Full details').closest('details');
  expect(details).not.toHaveAttribute('open');
  await userEvent.click(screen.getByRole('button', { name: 'View work', exact: true }));
  expect(openRun).toHaveBeenCalledWith(row.sourceRef);
  await userEvent.click(screen.getByText('Full details'));
  expect(details).toHaveTextContent('InternalProviderError: timeout on connector-123');
});

it('keeps complete long received context reachable instead of losing the preview tail', async () => {
  const context = `Customer supplied this instruction: ${'Keep the exact terms. '.repeat(20)}FINAL CONDITION`;
  renderCard({ context, contextData: null });
  await userEvent.click(screen.getByText('Full details'));
  expect(screen.getByText(context)).toBeVisible();
});

it('explains generated memory review recommendations without rewriting custom advice', () => {
  const cases = [
    [{ type: 'conflict', recommendation: 'Correct the entry that is wrong; supersession keeps the loser on record.' }, 'Correct the inaccurate entry. The original stays in memory as an earlier version.'],
    [{ type: 'overdue_review', recommendation: 'Re-affirm with a new review date, or correct it.' }, 'Confirm this is still true to set a new review date, or correct it.'],
    [{ type: 'conflict', recommendation: 'Discuss supersession with the author before deciding.' }, 'Discuss supersession with the author before deciding.'],
  ];
  for (const [value, expected] of cases) {
    const view = renderCard(value);
    expect(screen.getByText(expected, { exact: true })).toBeVisible();
    view.unmount();
  }
});

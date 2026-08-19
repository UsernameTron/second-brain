import React from 'react';
import { render, screen } from '@testing-library/react';
import NeedsYouView from '../src/NeedsYouView.jsx';

// Members land on Mine by default — unowned technical escalations are the
// owner's noise, not the team's. The All tab stays one click away.

const rows = [
  {
    type: 'escalation', decision: 'Quill could not finish the rewrite.', context: '', consequence: '', recommendation: '',
    owner: { email: null, agentId: null }, due: null, actions: ['resolve'], sourceRef: { kind: 'escalation', id: 'e1' }, created_at: '2026-08-19T00:00:00Z',
  },
  {
    type: 'escalation', decision: 'Approve the Q3 pricing change.', context: '', consequence: '', recommendation: '',
    owner: { email: 'fred@cloudtechgurus.com', agentId: null }, due: null, actions: ['resolve'], sourceRef: { kind: 'escalation', id: 'e2' }, created_at: '2026-08-19T00:00:01Z',
  },
];

const noop = () => {};
const baseProps = {
  rows, agentsById: {}, people: [], agents: [],
  onResolveEscalation: noop, onAssign: null, onOpenMemory: noop, onOpenRun: noop,
  onRetryRun: noop, onExtendReview: noop, onAcknowledgeRuleRun: noop, onDismiss: noop, onOpenRule: null,
};

test('a member defaulted to mine sees only cards owned by them', () => {
  render(<NeedsYouView {...baseProps} userEmail="fred@cloudtechgurus.com" defaultScope="mine" />);
  expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Approve the Q3 pricing change.')).toBeInTheDocument();
  expect(screen.queryByText('Quill could not finish the rewrite.')).not.toBeInTheDocument();
});

test('the owner defaulted to all sees everything, including unowned noise', () => {
  render(<NeedsYouView {...baseProps} userEmail="pete@cloudtechgurus.com" defaultScope="all" />);
  expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Quill could not finish the rewrite.')).toBeInTheDocument();
  expect(screen.getByText('Approve the Q3 pricing change.')).toBeInTheDocument();
});

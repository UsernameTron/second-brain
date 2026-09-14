import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import NeedsYouView from '../src/NeedsYouView.jsx';
import Tray from '../src/Tray.jsx';

const escalation = { type: 'escalation', decision: 'Approve the draft?', canvasName: 'Renewals', owner: { email: 'me@example.com' }, sourceRef: { canvasId: 'c2', id: 'e2' }, contextData: { before: 'Existing value', after: 'Proposed value' } };
const base = { rows: [escalation], agentsById: {}, people: [], agents: [], userEmail: 'me@example.com', defaultScope: 'mine' };

it('explains generated review labels without rewriting quoted content or human questions', () => {
  const definitions = [
    ['overdue_review', 'Review this assumption fact: "Keep the term assumption here."', 'Review this unconfirmed (assumption) fact: "Keep the term assumption here."'],
    ['conflict', 'Two verified memory entries disagree about "verified customer".', 'Two confirmed (verified) memory entries disagree about "verified customer".'],
    ['failed_run', 'Run halted_steps: "The run mode is my source text."', 'Stopped at step limit: "The run mode is my source text."'],
    ['rule_alert', 'Standing rule matched 2 item(s): "Standing rule is the quoted title"', 'Scheduled work matched 2 item(s): "Standing rule is the quoted title"'],
    ['escalation', 'Run halted_steps: keep my original question.', 'Run halted_steps: keep my original question.'],
  ];
  render(<NeedsYouView {...base} rows={definitions.map(([type, decision]) => ({ ...escalation, type, decision, sourceRef: { id: type, canvasId: 'c2' } }))} />);
  for (const [, , label] of definitions) expect(screen.getByText(label)).toBeVisible();
});

it('labels generated agent references while retaining exact technical and authored context', async () => {
  const generated = 'question escalation from agent agent-123';
  const view = render(<NeedsYouView {...base} rows={[{ ...escalation, escalatingAgentId: 'agent-123', context: generated }]} agentsById={{ 'agent-123': { name: 'Fred' } }} />);
  expect(screen.getByText('Question from Fred.')).toBeVisible();
  const diagnostic = screen.getByText(`Technical context: ${generated}`);
  expect(diagnostic.closest('details')).not.toHaveAttribute('open');
  await userEvent.click(screen.getByText('Full details'));
  expect(diagnostic).toBeVisible();
  view.rerender(<NeedsYouView {...base} rows={[{ ...escalation, context: 'Customer asked us to keep this exact context.' }]} />);
  expect(screen.getByText('Customer asked us to keep this exact context.')).toBeVisible();
});

it('keeps full decision context visible and blocks duplicate answers while pending', async () => {
  let finish;
  const resolve = vi.fn(() => new Promise((done) => { finish = done; }));
  render(<NeedsYouView {...base} onResolveEscalation={resolve} />);
  expect(screen.getByRole('region', { name: 'Decision context' })).toHaveTextContent('Existing value');
  expect(screen.getByRole('region', { name: 'Decision context' })).toHaveTextContent('Proposed value');
  await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
  await userEvent.type(screen.getByLabelText('Your answer'), 'Approved as shown');
  await userEvent.dblClick(screen.getByRole('button', { name: 'Submit answer' }));
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith('e2', { action: 'accept', answer: 'Approved as shown' });
  expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  await act(async () => finish());
  expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
});

it.each([403, 409])('retains the answer after status %i and refreshes authoritative state', async (status) => {
  const refresh = vi.fn();
  render(<NeedsYouView {...base} onResolveEscalation={vi.fn().mockRejectedValue(Object.assign(new Error('changed'), { status }))} onRefresh={refresh} />);
  await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
  await userEvent.type(screen.getByLabelText('Your answer'), 'Keep my answer');
  await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Your answer')).toHaveValue('Keep my answer');
  expect(refresh).toHaveBeenCalled();
});

it('checks status instead of resending an unconfirmed answer', async () => {
  const resolve = vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { unconfirmed: true }));
  const refresh = vi.fn();
  render(<NeedsYouView {...base} onResolveEscalation={resolve} onRefresh={refresh} />);
  await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
  await userEvent.type(screen.getByLabelText('Your answer'), 'Keep my answer');
  await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Check status' }));
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
});

it('loads assignment choices from the card project rather than the selected project', async () => {
  const load = vi.fn().mockResolvedValue({ agents: [{ id: 'other', name: 'Other project agent' }], people: [{ id: 'p', email: 'reviewer@example.com' }] });
  const assign = vi.fn();
  render(<NeedsYouView {...base} agents={[{ id: 'wrong', name: 'Wrong project agent' }]} loadContext={load} onAssign={assign} />);
  await userEvent.click(screen.getByText('Other actions'));
  await screen.findByRole('option', { name: 'Other project agent (agent)' });
  expect(load).toHaveBeenCalledWith('c2');
  expect(screen.queryByRole('option', { name: 'Wrong project agent (agent)' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Assign this item'), 'p:reviewer@example.com');
  expect(assign).toHaveBeenCalledWith('e2', { owner_email: 'reviewer@example.com' });
});

it('keeps a cross-project agent assignment visible and clearable before its name is known', async () => {
  const assign = vi.fn();
  const load = vi.fn().mockResolvedValue({ agents: [{ id: 'other-agent', name: 'Other project agent' }], people: [] });
  render(<NeedsYouView {...base} defaultScope="all" rows={[{ ...escalation, owner: { agentId: 'other-agent' } }]}
    agentsById={{ 'current-agent': { name: 'Current project agent' } }} loadContext={load} onAssign={assign} />);
  expect(screen.getByText('→ Assigned agent')).toBeVisible();
  expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Other actions'));
  expect(await screen.findByText('→ Other project agent')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Assign this item'), 'clear');
  expect(assign).toHaveBeenCalledWith('e2', { owner_email: null, owner_agent_id: null });
});

it('preserves every projected card action and its original source reference', async () => {
  const types = ['conflict', 'overdue_review', 'failed_run', 'rule_alert', 'brief_ready'];
  const rows = types.map((type) => ({ ...escalation, type, decision: type, contextData: null, sourceRef: { id: type, canvasId: 'c2', ruleId: `rule-${type}`, secondId: 'second' }, dismissKey: ['conflict', 'overdue_review', 'failed_run'].includes(type) ? type : null }));
  const memory = vi.fn(), run = vi.fn(), retry = vi.fn(), extend = vi.fn(), ack = vi.fn(), rule = vi.fn(), dismiss = vi.fn();
  render(<NeedsYouView {...base} rows={rows} onOpenMemory={memory} onOpenRun={run} onRetryRun={retry} onExtendReview={extend} onAcknowledgeRuleRun={ack} onOpenRule={rule} onDismiss={dismiss} />);
  await userEvent.click(screen.getAllByRole('button', { name: 'Review memory' })[0]);
  expect(memory).toHaveBeenCalledWith(rows[0].sourceRef);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm still true' }));
  expect(extend).toHaveBeenCalledWith(rows[1].sourceRef);
  await userEvent.click(screen.getByRole('button', { name: 'View work' }));
  expect(run).toHaveBeenCalledWith(rows[2].sourceRef);
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledWith(rows[2].sourceRef);
  await userEvent.click(screen.getAllByRole('button', { name: 'Mark reviewed' })[0]);
  expect(ack).toHaveBeenCalledWith(rows[3].sourceRef);
  await userEvent.click(screen.getByRole('button', { name: 'View brief' }));
  expect(rule).toHaveBeenCalledWith(rows[4].sourceRef);
  await userEvent.click(screen.getAllByText('Other actions')[0]);
  await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
  expect(dismiss).toHaveBeenCalledWith(rows[0]);
});

it('retains legacy review controls and shows unknown instead of an empty tray', async () => {
  const view = render(<Tray escalations={[]} agentsById={{}} agents={[]} loadStatus={{ error: new Error('offline') }} onRefresh={vi.fn()} />);
  expect(screen.queryByText('Nothing needs you')).not.toBeInTheDocument();
  view.rerender(<Tray escalations={[{ id: 'e1', question: 'Legacy question' }]} agentsById={{}} agents={[]} onResolve={vi.fn().mockRejectedValue(new Error('offline'))} onRefresh={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await userEvent.type(screen.getByRole('textbox'), 'Legacy answer');
  await userEvent.click(screen.getByRole('button', { name: 'Send decision' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox')).toHaveValue('Legacy answer');
});

import React, { useCallback, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Notifications from '../src/Notifications.jsx';

function Harness() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('Keep this draft');
  const clear = useCallback(() => setItems([]), []);
  const notify = (msg, kind) => setItems((values) => [...values, { id: values.length + 1, msg, kind }]);
  return <>
    <label>Your answer<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
    <p role="alert">Saving your answer could not be completed. Check status before trying again.</p>
    <button onClick={() => notify('Assignment saved.', 'ok')}>Assign</button>
    <button onClick={() => notify('The other edit was merged. Read both changes.', 'warn')}>Merge notice</button>
    <button onClick={() => notify('The connection could not be checked. Try checking again.', 'error')}>Connection problem</button>
    <Notifications items={items} onClear={clear} />
  </>;
}
const updates = () => screen.getByRole('region', { name: 'Recent updates' });
const advance = (ms) => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('keeps a burst compact while every update remains readable in Details', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Assign'));
  fireEvent.click(screen.getByText('Merge notice'));
  fireEvent.click(screen.getByText('Assign'));
  expect(within(updates()).queryByRole('list')).not.toBeInTheDocument();
  expect(updates().querySelectorAll('.notification-summary')).toHaveLength(1);
  fireEvent.click(within(updates()).getByRole('button', { name: 'Details (3)' }));
  const messages = within(screen.getByRole('list', { name: 'Update details' })).getAllByRole('listitem');
  expect(messages).toHaveLength(3);
  expect(messages[0]).toHaveTextContent('Assignment saved.');
  expect(messages[1]).toHaveTextContent('Read both changes.');
  expect(messages[2]).toHaveTextContent('Assignment saved.');
});

it('keeps an active problem ahead of a later success without inventing another failure', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Connection problem'));
  fireEvent.click(screen.getByText('Merge notice'));
  fireEvent.click(screen.getByText('Assign'));
  expect(updates().querySelector('.notification-message')).toHaveTextContent('Problem: The connection could not be checked.');
  expect(screen.getByRole('status')).toHaveTextContent('Update: Assignment saved.');
});

it('clears the batch after quiet time, giving the latest message its full reading interval', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Assign'));
  advance(4000);
  fireEvent.click(screen.getByText('Merge notice'));
  advance(4499);
  expect(updates()).toBeInTheDocument();
  advance(1);
  expect(screen.queryByRole('region', { name: 'Recent updates' })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Check status before trying again');
  expect(screen.getByLabelText('Your answer')).toHaveValue('Keep this draft');
});

it('retains all messages while Details is open, including updates that arrive afterward', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Assign'));
  fireEvent.click(within(updates()).getByRole('button', { name: 'Details' }));
  advance(10000);
  fireEvent.click(screen.getByText('Merge notice'));
  advance(10000);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(within(updates()).getByRole('button', { name: 'Hide details' }));
  advance(4500);
  expect(screen.queryByRole('region', { name: 'Recent updates' })).not.toBeInTheDocument();
});

it('pauses expiry while hovered or focused, then resumes after leaving the strip', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Assign'));
  fireEvent.mouseEnter(updates()); advance(9000);
  expect(updates()).toBeInTheDocument();
  act(() => within(updates()).getByRole('button', { name: 'Details' }).focus());
  fireEvent.mouseLeave(updates()); advance(9000);
  expect(updates()).toBeInTheDocument();
  act(() => screen.getByLabelText('Your answer').focus()); advance(4500);
  expect(screen.queryByRole('region', { name: 'Recent updates' })).not.toBeInTheDocument();
});

it('supports keyboard details and dismissal without losing the answer, local recovery or focus', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  render(<Harness />);
  const source = screen.getByRole('button', { name: 'Connection problem' });
  await user.click(source);
  await user.tab();
  expect(within(updates()).getByRole('button', { name: 'Details' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(within(updates()).getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
  await user.tab();
  expect(within(updates()).getByRole('button', { name: 'Dismiss updates' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(source).toHaveFocus();
  expect(screen.queryByRole('region', { name: 'Recent updates' })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Check status');
  expect(screen.getByLabelText('Your answer')).toHaveValue('Keep this draft');
  await user.click(screen.getByText('Assign'));
  expect(within(updates()).getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
});

it('preserves complete long messages and cleans up its timer on unmount', () => {
  const clear = vi.fn();
  const message = `${'Original explanation. '.repeat(200)}Final recovery instruction.`;
  const view = render(<Notifications items={[{ id: 1, msg: message, kind: 'error' }]} onClear={clear} />);
  expect(vi.getTimerCount()).toBe(1);
  fireEvent.click(within(updates()).getByRole('button', { name: 'Details' }));
  expect(screen.getByRole('listitem').textContent).toBe(`Problem: ${message}`);
  fireEvent.click(within(updates()).getByRole('button', { name: 'Hide details' }));
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  advance(5000);
  expect(clear).not.toHaveBeenCalled();
});

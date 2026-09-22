// P2.1: the shared dialog behavior every modal mounts — initial focus,
// Tab trap, Escape close, and focus restoration to the opener.
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDialog } from '../src/useDialog.js';

function Dialog({ onClose }) {
  const ref = useDialog(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label="Test dialog" ref={ref} tabIndex={-1}>
      <button>first</button>
      <button>last</button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open dialog</button>
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

describe('useDialog', () => {
  it('moves focus in, traps Tab, closes on Escape, and restores focus', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'open dialog' });
    await userEvent.click(opener);

    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();

    await userEvent.tab(); // first -> last
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus();
    await userEvent.tab(); // wraps to first
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
    await userEvent.tab({ shift: true }); // wraps back to last
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Escape calls the latest onClose closure', async () => {
    const closes = [];
    function Latest() {
      const [n, setN] = useState(0);
      return (
        <div>
          <button onClick={() => setN(n + 1)}>bump</button>
          <Dialog onClose={() => closes.push(n)} />
        </div>
      );
    }
    render(<Latest />);
    await userEvent.click(screen.getByRole('button', { name: 'bump' }));
    screen.getByRole('button', { name: 'first' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(closes).toEqual([1]);
  });
});

it('traps focus through disclosures without visiting hidden, disabled or inert controls', async () => {
  function DisclosureDialog() {
    const ref = useDialog(vi.fn());
    return <div role="dialog" ref={ref} tabIndex={-1}>
      <button hidden>hidden</button><button disabled>disabled</button>
      <div inert=""><button>inert</button></div>
      <div style={{ display: 'none' }}><button>not displayed</button></div>
      <details><summary>More details</summary><button>inside</button><details><summary>Nested details</summary><button>nested hidden</button></details></details>
    </div>;
  }
  render(<DisclosureDialog />);
  const summary = screen.getByText('More details');
  expect(summary).toHaveFocus();
  await userEvent.tab(); expect(summary).toHaveFocus();
  await userEvent.tab({ shift: true }); expect(summary).toHaveFocus();
  // jsdom does not implement native Enter-to-toggle; the browser suite checks it.
  await userEvent.click(summary);
  await userEvent.tab(); expect(screen.getByRole('button', { name: 'inside' })).toHaveFocus();
  await userEvent.tab(); expect(screen.getByText('Nested details')).toHaveFocus();
  await userEvent.tab(); expect(summary).toHaveFocus();
  await userEvent.tab({ shift: true }); expect(screen.getByText('Nested details')).toHaveFocus();
});

it('keeps Tab in an informational dialog with no interactive controls', async () => {
  const close = vi.fn();
  function Information() { const ref = useDialog(close); return <div role="dialog" ref={ref} tabIndex={-1}>Loading details…</div>; }
  render(<><button>outside</button><Information /></>);
  expect(screen.getByRole('dialog')).toHaveFocus();
  await userEvent.tab(); expect(screen.getByRole('dialog')).toHaveFocus();
  await userEvent.keyboard('{Escape}'); expect(close).toHaveBeenCalledTimes(1);
});

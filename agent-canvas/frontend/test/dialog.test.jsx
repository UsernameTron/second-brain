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

import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Canvas from '../src/Canvas.jsx';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it('leaves canvas control pointers alone so real browsers deliver their clicks', async () => {
  const onArrange = vi.fn();
  const onSelect = vi.fn();
  const { container } = render(<Canvas agents={[]} notes={[]} tasks={[]} files={[]} people={[]}
    canvasId="c1" handoffs={[]} memoryMap={new Map()} agentsById={{}} cursors={{}}
    selections={{}} spendByAgent={{}} amberAgents={new Set()} onOpen={vi.fn()}
    onMoveLive={vi.fn()} onMoveEnd={vi.fn()} onCursor={vi.fn()} onSelect={onSelect}
    onArrange={onArrange} />);
  const background = container.querySelector('.canvas-root');
  background.setPointerCapture = vi.fn();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Tidy up' }));
  await user.click(screen.getByRole('button', { name: 'Fit', exact: true }));
  expect(onArrange).toHaveBeenCalledTimes(1);
  expect(background.setPointerCapture).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();

  // The background still owns its own drag, preserving panning and deselection.
  await user.pointer({ target: background, keys: '[MouseLeft>]' });
  expect(background.setPointerCapture).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(background);
  expect(onSelect).toHaveBeenCalledWith(null);
});

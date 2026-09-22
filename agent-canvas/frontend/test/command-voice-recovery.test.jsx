import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const voice = vi.hoisted(() => {
  const state = { instances: [], failStart: false, failConstructor: false };
  window.SpeechRecognition = class {
    constructor() {
      if (state.failConstructor) throw new Error('Unavailable');
      state.instances.push(this);
    }
    start() { if (state.failStart) throw new Error('Denied'); }
    stop() { this.onend?.(); }
    abort() { this.aborted = true; this.onend?.(); }
  };
  return state;
});
import CommandBar from '../src/CommandBar.jsx';

beforeEach(() => { voice.instances.length = 0; voice.failStart = false; voice.failConstructor = false; });
function setup() {
  const parse = vi.fn().mockResolvedValue({ action: 'dispatch', instruction: 'Review the draft.' });
  const confirm = vi.fn().mockResolvedValue({});
  return { ...render(<CommandBar canvasId="voice-test" onParse={parse} onConfirm={confirm} onCheckStatus={vi.fn()} />), parse, confirm };
}
function result(text, isFinal = true) { return Object.assign([{ transcript: text }], { isFinal }); }

it('assembles cumulative final and interim results once and still requires confirmation', async () => {
  const { parse, confirm } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
  const recognition = voice.instances.at(-1);
  act(() => recognition.onresult({ resultIndex: 0, results: [result('Have Scout ')] }));
  act(() => recognition.onresult({ resultIndex: 1, results: [result('Have Scout '), result('review', false)] }));
  expect(screen.getByLabelText('Advanced command')).toHaveValue('Have Scout review');
  act(() => recognition.onresult({ resultIndex: 1, results: [result('Have Scout '), result('review the draft.')] }));
  act(() => recognition.onend());
  await screen.findByRole('button', { name: 'Confirm' });
  expect(parse).toHaveBeenCalledExactlyOnceWith('Have Scout review the draft.', 'ask');
  expect(confirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Advanced command')).toHaveValue('Have Scout review the draft.');
});

it.each(['constructor', 'start'])('keeps typed input and offers typing when recognition %s fails', async (failure) => {
  setup();
  await userEvent.type(screen.getByLabelText('Advanced command'), 'My draft');
  voice[failure === 'constructor' ? 'failConstructor' : 'failStart'] = true;
  await userEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
  expect(await screen.findByText(/microphone could not start/i)).toBeVisible();
  expect(screen.getByLabelText('Advanced command')).toHaveValue('My draft');
  expect(screen.getByRole('button', { name: 'Speak a command' })).toHaveAttribute('aria-pressed', 'false');
});

it('keeps a partial transcript after a recognition error without interpreting it automatically', async () => {
  const { parse } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
  const recognition = voice.instances.at(-1);
  act(() => recognition.onresult({ results: [result('Have Scout ')] }));
  act(() => { recognition.onerror({ error: 'network' }); recognition.onend?.(); });
  expect(await screen.findByText(/Voice input stopped/)).toBeVisible();
  expect(screen.getByLabelText('Advanced command')).toHaveValue('Have Scout ');
  expect(parse).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Advanced command'), 'review the draft.');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(parse).toHaveBeenCalledExactlyOnceWith('Have Scout review the draft.', 'ask'));
});

it('stops obsolete recognition and ignores late browser callbacks when leaving Commands', async () => {
  const { unmount, parse } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
  const recognition = voice.instances.at(-1);
  const lateResult = recognition.onresult;
  const lateEnd = recognition.onend;
  unmount();
  act(() => { lateResult({ results: [result('Obsolete command')] }); lateEnd(); });
  expect(recognition.aborted).toBe(true);
  expect(parse).not.toHaveBeenCalled();
});

it('waits for listening to stop before parsing and ignores repeated end events', async () => {
  const { parse } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Speak a command' }));
  const recognition = voice.instances.at(-1);
  act(() => recognition.onresult({ results: [result('Review the draft.')] }));
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Advanced command'), '{Enter}');
  expect(parse).not.toHaveBeenCalled();
  const lateEnd = recognition.onend;
  await userEvent.click(screen.getByRole('button', { name: 'Stop listening' }));
  await screen.findByRole('button', { name: 'Confirm' });
  act(() => lateEnd());
  expect(parse).toHaveBeenCalledExactlyOnceWith('Review the draft.', 'ask');
  expect(screen.getByRole('button', { name: 'Speak a command' })).toBeDisabled();
});

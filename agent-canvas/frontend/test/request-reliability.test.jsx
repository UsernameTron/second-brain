import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../src/api.js';
import { useResource } from '../src/RequestState.jsx';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const response = (text, status = 200) => ({ ok: status < 400, status, text: async () => text });

describe('bounded same-origin requests', () => {
  it('rejects malformed and empty successful responses instead of inventing empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('<html>unavailable</html>')).mockResolvedValueOnce(response('')));
    await expect(api('/api/me')).rejects.toThrow('unreadable response');
    await expect(api('/api/config')).rejects.toThrow('empty response');
  });
  it('times out a stalled response body and aborts the read', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => new Promise(() => {}) }));
    const request = expect(api('/api/me')).rejects.toMatchObject({ timeout: true, unconfirmed: false });
    await vi.advanceTimersByTimeAsync(30_000);
    await request;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('never retries an unconfirmed mutation and uses the longer submission deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const request = expect(api('/api/control/pause', { method: 'POST', body: {} })).rejects.toMatchObject({ timeout: true, unconfirmed: true });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('marks interrupted writes unconfirmed and reports session expiry', async () => {
    const expired = vi.fn();
    window.addEventListener('ac-session-expired', expired);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(response('{"error":"expired"}', 401)));
    await expect(api('/api/notes', { method: 'POST' })).rejects.toMatchObject({ unconfirmed: true });
    await expect(api('/api/canvases')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener('ac-session-expired', expired);
  });
});

it('invalidates late resource responses and retains last-known data on refresh failure', async () => {
  let finishOld;
  const load = vi.fn((id) => id === 'old' ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve('current data'));
  function Example({ id }) {
    const resource = useResource(() => load(id), id);
    return <><div>{resource.data}</div><div>{resource.error ? 'Stale' : resource.loading ? 'Loading' : 'Ready'}</div><button onClick={resource.refresh}>Refresh</button></>;
  }
  const view = render(<Example id="old" />);
  view.rerender(<Example id="new" />);
  await screen.findByText('current data');
  await act(async () => finishOld('obsolete data'));
  expect(screen.queryByText('obsolete data')).not.toBeInTheDocument();
  load.mockRejectedValue(new Error('offline'));
  await userEvent.click(screen.getByText('Refresh'));
  await waitFor(() => expect(screen.getByText('Stale')).toBeInTheDocument());
  expect(screen.getByText('current data')).toBeInTheDocument();
});

it('bounds binary downloads and preserves HTTP errors for disclosure conflicts', async () => {
  const blob = new Blob(['export']);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob }).mockResolvedValueOnce(response('{"error":"manifest changed"}', 409)));
  expect(await api('/api/rooms/r1/export', { method: 'POST', responseType: 'blob', body: { manifest_hash: 'h' } })).toBe(blob);
  await expect(api('/api/rooms/r1/export', { method: 'POST', responseType: 'blob' })).rejects.toMatchObject({ status: 409 });
});

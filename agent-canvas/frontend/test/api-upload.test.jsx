import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

describe('raw upload API bodies', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ file: { id: 'f1' } }),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes a file Blob byte-for-byte instead of JSON-serializing it', async () => {
    const body = new Blob(['# Customer brief'], { type: 'text/markdown' });
    await api('/api/canvases/c1/files?name=Customer%20brief.md', {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body,
    });

    expect(fetch).toHaveBeenCalledWith('/api/canvases/c1/files?name=Customer%20brief.md', {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body,
    });
  });

  it('allows ordinary consecutive dots in a filename query value', async () => {
    const body = new Blob(['company,stage\nAcme,open'], { type: 'text/csv' });
    await api('/api/canvases/c1/files?name=customer..final.csv', {
      method: 'POST', headers: { 'Content-Type': 'text/csv' }, body,
    });

    expect(fetch).toHaveBeenCalledWith('/api/canvases/c1/files?name=customer..final.csv', {
      method: 'POST', headers: { 'Content-Type': 'text/csv' }, body,
    });
  });

  it.each([
    '/api/canvases/../files',
    '/api/canvases/%2e%2e/files',
    '/api/canvases/%252E%252E/files',
    '/api/canvases/..%2Fsecret/files',
  ])('still rejects path traversal: %s', async (path) => {
    await expect(api(path)).rejects.toThrow('invalid API path');
    expect(fetch).not.toHaveBeenCalled();
  });
});

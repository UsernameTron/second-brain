import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

describe('raw API bodies', () => {
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
});

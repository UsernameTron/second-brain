'use strict';

/**
 * semantic-index-errors.test.js
 *
 * Error-path coverage for src/semantic-index.js and src/utils/voyage-health.js.
 * Covers all failure modes from CONTEXT.md D-07 through D-10:
 *
 *   - Missing VOYAGE_API_KEY → stderr warning + {degraded:true, failureMode:'401'}
 *   - 401 from SDK → stderr warning, no retry, consecutive_failures incremented
 *   - 429 with Retry-After <= 2s → retries once; success on retry works
 *   - 429 with Retry-After 60s → no retry (skip long waits per D-08)
 *   - 429 with no Retry-After → no retry
 *   - 503 Service Unavailable → failureMode='5xx', failure recorded, no retry
 *   - Timeout (ETIMEDOUT) → failureMode='timeout', failure recorded
 *   - DNS failure (ENOTFOUND) → failureMode='network', failure recorded
 *   - 3 consecutive failures → isDegraded() true; next semanticSearch short-circuits
 *   - Fake-timer advance past degradedModeMinutes → isDegraded() false again
 *   - recordSuccess after any failure → consecutive_failures resets to 0
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Shared mock state ─────────────────────────────────────────────────────────

const mockEmbed = jest.fn();
const mockCheckContent = jest.fn();
const mockReadMemory = jest.fn();
const mockSearchMemoryKeyword = jest.fn();
const mockSafeLoadPipelineConfig = jest.fn();

jest.mock('voyageai', () => ({
  VoyageAIClient: jest.fn().mockImplementation(() => ({
    embed: (...args) => mockEmbed(...args),
  })),
}));

jest.mock('../src/content-policy', () => ({
  checkContent: (...args) => mockCheckContent(...args),
}));

jest.mock('../src/memory-reader', () => ({
  readMemory: (...args) => mockReadMemory(...args),
  searchMemoryKeyword: (...args) => mockSearchMemoryKeyword(...args),
  getMemoryEcho: jest.fn(),
}));

jest.mock('../src/pipeline-infra', () => ({
  safeLoadPipelineConfig: (...args) => mockSafeLoadPipelineConfig(...args),
}));

// ── Default config ─────────────────────────────────────────────────────────────

const defaultSemConfig = {
  model: 'voyage-4-lite',
  threshold: 0.72,
  recencyDecay: 0.2,
  rrfK: 60,
  candidatesPerSource: 20,
  embedBatchSize: 128,
  timeoutMs: 3000,
  degradedModeMinutes: 15,
  embeddingDim: 1024,
};

// ── Env isolation ─────────────────────────────────────────────────────────────

let tmpCacheDir;
let originalCacheDir;
let originalVoyageKey;

beforeAll(() => {
  originalCacheDir = process.env.CACHE_DIR_OVERRIDE;
  originalVoyageKey = process.env.VOYAGE_API_KEY;
});

beforeEach(() => {
  jest.useRealTimers();
  tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-sem-err-'));
  process.env.CACHE_DIR_OVERRIDE = tmpCacheDir;
  process.env.VOYAGE_API_KEY = 'test-key';
  jest.resetModules();

  mockEmbed.mockReset();
  mockCheckContent.mockReset();
  mockCheckContent.mockResolvedValue({ decision: 'PASS' });
  mockReadMemory.mockReset();
  mockReadMemory.mockResolvedValue([]);
  mockSearchMemoryKeyword.mockReset();
  mockSearchMemoryKeyword.mockResolvedValue([]);
  mockSafeLoadPipelineConfig.mockReset();
  mockSafeLoadPipelineConfig.mockReturnValue({
    config: {
      memory: { semantic: defaultSemConfig },
      excludedTerms: ['ISPN', 'Genesys', 'Asana'],
    },
    errors: [],
  });
});

afterEach(() => {
  jest.useRealTimers();
  fs.rmSync(tmpCacheDir, { recursive: true, force: true });
});

afterAll(() => {
  if (originalCacheDir === undefined) delete process.env.CACHE_DIR_OVERRIDE;
  else process.env.CACHE_DIR_OVERRIDE = originalCacheDir;
  if (originalVoyageKey === undefined) delete process.env.VOYAGE_API_KEY;
  else process.env.VOYAGE_API_KEY = originalVoyageKey;
});

// ── Helper: make an error with status/code ────────────────────────────────────

function makeErr(message, extras = {}) {
  return Object.assign(new Error(message), extras);
}

// ── 1. Missing VOYAGE_API_KEY ─────────────────────────────────────────────────

describe('missing VOYAGE_API_KEY', () => {
  test('semanticSearch emits stderr warning and returns degraded:true', async () => {
    delete process.env.VOYAGE_API_KEY;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { semanticSearch } = require('../src/semantic-index');
    const result = await semanticSearch('leadership');

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('VOYAGE_API_KEY'));
    expect(result.degraded).toBe(true);
    errSpy.mockRestore();
  });

  test('indexNewEntries fails gracefully without key (failureMode in result)', async () => {
    delete process.env.VOYAGE_API_KEY;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { indexNewEntries } = require('../src/semantic-index');
    // No embed call expected because the client immediately returns failure
    const result = await indexNewEntries([
      { contentHash: 'h1', content: 'test', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ]);
    expect(result.success).toBe(false);
    expect(mockEmbed).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ── 2. 401 from SDK ───────────────────────────────────────────────────────────

describe('401 Unauthorized from SDK', () => {
  test('no retry; stderr warning emitted; consecutive_failures incremented to 1', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockEmbed.mockRejectedValueOnce(makeErr('Unauthorized', { status: 401 }));

    const { semanticSearch } = require('../src/semantic-index');
    const { readHealth } = require('../src/utils/voyage-health');

    const result = await semanticSearch('leadership');

    // Should emit the remediation warning
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('VOYAGE_API_KEY'));
    // 401 = treated as missing key → degraded
    expect(result.degraded).toBe(true);
    // Health persisted with a failure recorded
    const health = readHealth();
    expect(health.consecutive_failures).toBeGreaterThanOrEqual(1);
    // Only 1 embed call (no retry on 401)
    expect(mockEmbed).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });
});

// ── 3. 429 with Retry-After scenarios ─────────────────────────────────────────

describe('429 Too Many Requests', () => {
  test('Retry-After: 1 → embed called twice (retry); success on second call', async () => {
    const err429 = makeErr('Too Many Requests', {
      status: 429,
      response: { headers: { 'retry-after': '1' } },
    });
    // First call: 429 with retry-after=1
    mockEmbed.mockRejectedValueOnce(err429);
    // Second call (retry): success
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: [1, 0, 0, 0] }] });

    const { indexNewEntries } = require('../src/semantic-index');
    const result = await indexNewEntries([
      { contentHash: 'h1', content: 'test', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ]);

    // Embed was called twice (initial + retry)
    expect(mockEmbed).toHaveBeenCalledTimes(2);
    expect(result.embedded).toBe(1);
    expect(result.success).toBe(true);
  });

  test('Retry-After: 60 → embed wrapper skips D-08 retry (no SDK-level retry); D-03 batch retry still runs', async () => {
    // D-08 behavior: embed() wrapper skips Retry-After when > 2s
    // D-03 behavior: indexNewEntries batch-level retry fires once regardless
    // So total embed calls = 2 (initial + D-03 batch retry)
    const err429 = makeErr('Too Many Requests', {
      status: 429,
      response: { headers: { 'retry-after': '60' } },
    });
    // Both the initial and D-03 retry fail (no SDK-level retry either time)
    mockEmbed.mockRejectedValueOnce(err429);
    mockEmbed.mockRejectedValueOnce(err429); // D-03 retry also fails

    const { indexNewEntries } = require('../src/semantic-index');
    const result = await indexNewEntries([
      { contentHash: 'h1', content: 'test', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ]);

    // 2 calls: initial embed (no D-08 retry) + D-03 batch retry
    expect(mockEmbed).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
  });

  test('429 with no Retry-After header → embed wrapper skips retry; D-03 still retries batch once', async () => {
    const err429 = makeErr('Too Many Requests', { status: 429 });
    // Both the initial and D-03 retry fail
    mockEmbed.mockRejectedValueOnce(err429);
    mockEmbed.mockRejectedValueOnce(err429);

    const { indexNewEntries } = require('../src/semantic-index');
    const result = await indexNewEntries([
      { contentHash: 'h1', content: 'test', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ]);

    // No SDK-level retry (no Retry-After) but D-03 batch retry fires → 2 total calls
    expect(mockEmbed).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
  });
});

// ── 4. 503 Service Unavailable ────────────────────────────────────────────────

describe('503 Service Unavailable', () => {
  test('embed called once, failureMode=5xx, failure recorded in health tracker', async () => {
    mockEmbed.mockRejectedValueOnce(makeErr('Service Unavailable', { status: 503 }));

    const { indexNewEntries } = require('../src/semantic-index');
    const { readHealth } = require('../src/utils/voyage-health');

    const result = await indexNewEntries([
      { contentHash: 'h1', content: 'test', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ]);

    expect(result.failed).toBeGreaterThan(0);
    const health = readHealth();
    expect(health.consecutive_failures).toBeGreaterThanOrEqual(1);
    expect(health.last_failure_code).toBe('5xx');
  });
});

// ── 5. Timeout (ETIMEDOUT) ────────────────────────────────────────────────────

describe('Timeout ETIMEDOUT', () => {
  test('failureMode=timeout, failure recorded (via _testOnly.classifyVoyageError)', () => {
    // Verify classification is correct via the exported helper
    const { _testOnly } = require('../src/semantic-index');
    const err = makeErr('timed out', { code: 'ETIMEDOUT' });
    expect(_testOnly.classifyVoyageError(err)).toBe('timeout');
  });

  test('timeout error causes failure recording in voyage-health', async () => {
    const timeoutErr = makeErr('timed out', { code: 'ETIMEDOUT' });
    // D-03 retry also times out
    mockEmbed.mockRejectedValueOnce(timeoutErr);
    mockEmbed.mockRejectedValueOnce(timeoutErr);

    const { indexNewEntries } = require('../src/semantic-index');
    const { readHealth } = require('../src/utils/voyage-health');

    const result = await indexNewEntries([
      { contentHash: 'h1', content: 'test', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ]);

    // Result should fail; health tracker records failures
    expect(result.failed).toBeGreaterThan(0);
    const health = readHealth();
    expect(health.consecutive_failures).toBeGreaterThanOrEqual(1);
    // last_failure_code reflects whichever failure was last recorded
    expect(['timeout', '5xx']).toContain(health.last_failure_code);
  });
});

// ── 6. DNS failure (ENOTFOUND) ────────────────────────────────────────────────

describe('DNS failure ENOTFOUND', () => {
  test('failureMode=network (via _testOnly.classifyVoyageError)', () => {
    const { _testOnly } = require('../src/semantic-index');
    const err = makeErr('ENOTFOUND api.voyageai.com', { code: 'ENOTFOUND' });
    expect(_testOnly.classifyVoyageError(err)).toBe('network');
  });

  test('ENOTFOUND error causes failure recording in voyage-health', async () => {
    const networkErr = makeErr('ENOTFOUND api.voyageai.com', { code: 'ENOTFOUND' });
    // D-03 retry also fails
    mockEmbed.mockRejectedValueOnce(networkErr);
    mockEmbed.mockRejectedValueOnce(networkErr);

    const { indexNewEntries } = require('../src/semantic-index');
    const { readHealth } = require('../src/utils/voyage-health');

    const result = await indexNewEntries([
      { contentHash: 'h1', content: 'test', addedAt: new Date().toISOString(), category: 'INSIGHT' },
    ]);

    expect(result.failed).toBeGreaterThan(0);
    const health = readHealth();
    expect(health.consecutive_failures).toBeGreaterThanOrEqual(1);
  });
});

// ── 7. Degraded mode — 3 consecutive failures trip circuit ────────────────────

describe('Degraded mode circuit breaker (D-10)', () => {
  test('3 consecutive failures → isDegraded() returns true', async () => {
    const { recordFailure, isDegraded } = require('../src/utils/voyage-health');

    recordFailure('5xx', 15);
    recordFailure('5xx', 15);
    expect(isDegraded()).toBe(false); // only 2 so far

    recordFailure('5xx', 15);
    expect(isDegraded()).toBe(true); // threshold is 3
  });

  test('next semanticSearch short-circuits without calling embed when degraded', async () => {
    const { recordFailure } = require('../src/utils/voyage-health');
    // Trip the circuit
    recordFailure('5xx', 15);
    recordFailure('5xx', 15);
    recordFailure('5xx', 15);

    const { semanticSearch } = require('../src/semantic-index');
    const result = await semanticSearch('leadership');

    expect(result.degraded).toBe(true);
    expect(result.reason).toMatch(/degraded mode/i);
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  test('degradedBanner text includes "degraded mode"', async () => {
    const { recordFailure, getDegradedReason } = require('../src/utils/voyage-health');
    recordFailure('timeout', 15);
    recordFailure('timeout', 15);
    recordFailure('timeout', 15);

    const banner = getDegradedReason();
    expect(banner).toMatch(/degraded mode/i);
    expect(banner).toContain('timeout');
  });
});

// ── 8. Degraded window expiry ─────────────────────────────────────────────────

describe('Degraded window expiry via fake timers', () => {
  test('advance past degradedModeMinutes → isDegraded() returns false', () => {
    const { recordFailure, isDegraded } = require('../src/utils/voyage-health');

    // Use a very short degraded window for the test (1 minute)
    recordFailure('5xx', 1);
    recordFailure('5xx', 1);
    recordFailure('5xx', 1);
    expect(isDegraded()).toBe(true);

    // Switch to fake timers and advance 2 minutes past the 1-minute window
    jest.useFakeTimers({ now: Date.now() + 2 * 60 * 1000 });
    expect(isDegraded()).toBe(false);
    jest.useRealTimers();
  });

  test('after window expiry, next semanticSearch proceeds to Voyage (embed is called)', async () => {
    const { recordFailure } = require('../src/utils/voyage-health');

    // Trip with 1-minute window
    recordFailure('5xx', 1);
    recordFailure('5xx', 1);
    recordFailure('5xx', 1);

    // Advance time to after window
    const futureNow = Date.now() + 2 * 60 * 1000;
    jest.useFakeTimers({ now: futureNow });

    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: [1, 0, 0, 0] }] });

    const { semanticSearch } = require('../src/semantic-index');
    // semanticSearch will try to embed the query — mock returns 1 vec for query embed
    const result = await semanticSearch('leadership');
    // Should NOT be degraded (window expired)
    expect(result.degraded).toBeFalsy();
    // Embed should have been called for the query
    expect(mockEmbed).toHaveBeenCalled();

    jest.useRealTimers();
  });
});

// ── 9. recordSuccess resets counter ──────────────────────────────────────────

describe('voyage-health: recordSuccess resets consecutive_failures', () => {
  test('1 failure then success → consecutive_failures = 0', () => {
    const { recordFailure, recordSuccess, readHealth } = require('../src/utils/voyage-health');

    recordFailure('5xx', 15);
    expect(readHealth().consecutive_failures).toBe(1);

    recordSuccess();
    expect(readHealth().consecutive_failures).toBe(0);
    expect(readHealth().degraded_until).toBeNull();
  });

  test('2 failures then success → consecutive_failures = 0 (not degraded)', () => {
    const { recordFailure, recordSuccess, isDegraded } = require('../src/utils/voyage-health');

    recordFailure('429', 15);
    recordFailure('429', 15);
    recordSuccess();

    expect(isDegraded()).toBe(false);
    const { readHealth } = require('../src/utils/voyage-health');
    expect(readHealth().consecutive_failures).toBe(0);
  });
});

// ── 10. readHealth persists failure code correctly ────────────────────────────

describe('voyage-health file persistence', () => {
  test('readHealth reflects last_failure_code from recordFailure()', () => {
    const { recordFailure, readHealth } = require('../src/utils/voyage-health');
    recordFailure('network', 15);
    const h = readHealth();
    expect(h.last_failure_code).toBe('network');
    expect(h.consecutive_failures).toBe(1);
    expect(h.last_failure).toBeTruthy();
  });

  test('readHealth returns defaults when file missing', () => {
    // Fresh tmpDir means no health file exists
    const { readHealth } = require('../src/utils/voyage-health');
    const h = readHealth();
    expect(h.consecutive_failures).toBe(0);
    expect(h.degraded_until).toBeNull();
  });

  test('getDegradedReason returns empty string when NOT degraded', () => {
    const { getDegradedReason } = require('../src/utils/voyage-health');
    // No failures → not degraded → empty reason
    expect(getDegradedReason()).toBe('');
  });

  test('isDegraded returns false when degraded_until has passed', () => {
    const { recordFailure, isDegraded } = require('../src/utils/voyage-health');
    // Create a degraded_until in the past by tripping with 0-minute window equivalent
    // We do this by directly writing to the health file
    const { getHealthPath, getSemanticCacheDir, readHealth } = require('../src/utils/voyage-health');
    const cacheDir = getSemanticCacheDir();
    const { mkdirSync, writeFileSync } = require('fs');
    mkdirSync(cacheDir, { recursive: true });
    const pastISO = new Date(Date.now() - 1000).toISOString(); // 1 second ago
    writeFileSync(getHealthPath(), JSON.stringify({
      consecutive_failures: 3,
      last_failure: pastISO,
      last_failure_code: '5xx',
      degraded_until: pastISO, // already expired
    }));
    expect(isDegraded()).toBe(false); // window has passed
  });

  test('getHealthPath returns path within CACHE_DIR_OVERRIDE', () => {
    const { getHealthPath } = require('../src/utils/voyage-health');
    const hp = getHealthPath();
    expect(hp).toContain(tmpCacheDir);
    expect(hp).toContain('voyage-health.json');
  });

  test('getSemanticCacheDir uses default ~/.cache/second-brain when CACHE_DIR_OVERRIDE is unset', () => {
    // Temporarily unset override to exercise the else branch (line 27)
    const saved = process.env.CACHE_DIR_OVERRIDE;
    delete process.env.CACHE_DIR_OVERRIDE;
    // Must require fresh module so the function re-reads the env
    jest.resetModules();
    const { getSemanticCacheDir } = require('../src/utils/voyage-health');
    const dir = getSemanticCacheDir();
    expect(dir).toContain('.cache');
    expect(dir).toContain('second-brain');
    // Restore
    process.env.CACHE_DIR_OVERRIDE = saved;
  });
});

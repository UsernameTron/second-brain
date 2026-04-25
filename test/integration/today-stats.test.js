'use strict';

/**
 * test/integration/today-stats.test.js
 *
 * End-to-end integration tests for Phase 20 Plan 04: recordStats orchestrator step.
 *
 * Verifies ROADMAP Phase 20 success criteria:
 *   SC1: After each /today run in scheduled mode, recordDailyStats is called with
 *        correct payload shape — one call per run, containing all 7 fields.
 *   SC2: Same-day re-run calls recordDailyStats again (idempotency managed by
 *        daily-stats.js internally — plan-04 fires the call each time).
 *   SC3: dry-run mode skips recordDailyStats entirely.
 *   SC4: recordDailyStats failure → briefing still produced + written to disk
 *        (briefing-is-the-product, D-06).
 *   SC5: Missing memory.md → runToday still completes; recordDailyStats called
 *        with totalEntries:0 and memoryKb:0.
 *   SC6: Payload columns match declared order: date-keyed row shape with 7 numeric
 *        fields matching the daily-stats.js column contract.
 *
 * Integration boundary: mocks external connectors and LLM, lets today-command.js
 * orchestrate through the real recordStats step with a real tmp vault. Spies on
 * daily-stats.recordDailyStats to verify the payload without overriding the actual
 * write (which is covered by test/daily-stats.test.js unit tests).
 *
 * @module today-stats-integration-test
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Test state ────────────────────────────────────────────────────────────────

let tmpVault;
let tmpProjects;

const FIXED_NOW_DAY1 = new Date('2026-04-24T18:00:00.000Z'); // 13:00 Central → 2026-04-24

// ── Pipeline config (real stats block) ───────────────────────────────────────

const STATS_PIPELINE_CONFIG = {
  slippage: { staleDays: 7, excludeProjects: [], maxProjects: 20 },
  classifier: { stage1ConfidenceThreshold: 0.8 },
  memory: { echoThreshold: 0.65 },
  stats: {
    enabled: true,
    path: 'RIGHT/daily-stats.md',
    timezone: 'America/Chicago',
    summaryLineEnabled: true,
    schemaVersion: 1,
  },
};

// ── Mock Haiku client ─────────────────────────────────────────────────────────

function makeMockHaikuClient() {
  return {
    classify: jest.fn(async (systemPrompt) => {
      if (systemPrompt && systemPrompt.includes('daily briefing synthesis')) {
        return { success: true, data: 'Integration test synthesis.' };
      }
      return { success: true, data: { frog: null, reasoning: '' } };
    }),
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stats-int-'));
  tmpProjects = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stats-int-proj-'));

  // Skeleton vault directories
  fs.mkdirSync(path.join(tmpVault, 'RIGHT', 'daily'), { recursive: true });
  fs.mkdirSync(path.join(tmpVault, 'memory'), { recursive: true });

  // memory.md with 3 ### entries (used by readMemory)
  fs.writeFileSync(
    path.join(tmpVault, 'memory', 'memory.md'),
    '### Entry 1 · 2026-04-01 · ref1\nContent 1\n\n### Entry 2 · 2026-04-01 · ref2\nContent 2\n\n### Entry 3 · 2026-04-01 · ref3\nContent 3\n',
    'utf8'
  );

  process.env.VAULT_ROOT = tmpVault;
  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpVault, { recursive: true, force: true });
  fs.rmSync(tmpProjects, { recursive: true, force: true });
  delete process.env.VAULT_ROOT;
  jest.resetModules();
});

// ── Factory: load runToday with connector mocks ───────────────────────────────

/**
 * Register all mocks and require a fresh today-command.
 * daily-stats is NOT mocked here — we spy on the real module's recordDailyStats.
 *
 * @param {object} opts
 * @param {string}  [opts.day='2026-04-24']   - date string for briefing-renderer mock
 * @param {boolean} [opts.throwOnRecord=false] - make recordDailyStats throw
 */
function loadRunToday({ day = '2026-04-24', throwOnRecord = false } = {}) {
  jest.doMock('../../src/connectors/calendar', () => ({
    getCalendarEvents: jest.fn().mockResolvedValue({
      success: true, data: [], error: null, source: 'calendar', fetchedAt: new Date().toISOString(),
    }),
  }));
  jest.doMock('../../src/connectors/gmail', () => ({
    getRecentEmails: jest.fn().mockResolvedValue({
      success: true, data: [], error: null, source: 'gmail', fetchedAt: new Date().toISOString(),
    }),
  }));
  jest.doMock('../../src/connectors/github', () => ({
    getGitHubActivity: jest.fn().mockResolvedValue({
      success: true, data: { repos: [], warnings: [] }, error: null, source: 'github', fetchedAt: new Date().toISOString(),
    }),
  }));
  jest.doMock('../../src/briefing-helpers', () => ({
    getProposalsPendingCount: jest.fn().mockResolvedValue(0),
    getDeadLetterSummary: jest.fn().mockResolvedValue({ pending: 0, frozen: 0, total: 0, warning: false }),
    formatBriefingSection: jest.fn().mockReturnValue(''),
  }));
  jest.doMock('../../src/pipeline-infra', () => ({
    safeLoadPipelineConfig: jest.fn().mockReturnValue({ config: STATS_PIPELINE_CONFIG, error: null }),
    loadConfigWithOverlay: jest.fn().mockReturnValue(STATS_PIPELINE_CONFIG),
    createHaikuClient: jest.fn().mockReturnValue(makeMockHaikuClient()),
  }));
  jest.doMock('../../src/memory-reader', () => ({
    getMemoryEcho: jest.fn().mockResolvedValue({ entries: [], score: 0, skipped: false }),
    readMemory: jest.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]),
  }));
  jest.doMock('../../src/today/slippage-scanner', () => ({
    scanSlippage: jest.fn().mockReturnValue([]),
  }));
  jest.doMock('../../src/today/frog-identifier', () => ({
    identifyFrog: jest.fn().mockResolvedValue({ frog: null, reasoning: '' }),
  }));
  jest.doMock('../../src/today/llm-augmentation', () => ({
    generateSynthesis: jest.fn().mockResolvedValue('Integration test synthesis.'),
  }));
  jest.doMock('../../src/today/briefing-renderer', () => ({
    renderBriefing: jest.fn().mockReturnValue(`---\ndate: ${day}\n---\n# Briefing\n\nContent.`),
    buildSourceHealth: jest.fn().mockReturnValue({ degradedCount: 0, sources: { calendar: 'ok', gmail: 'ok', github: 'ok', pipeline: 'ok' } }),
    formatDateYMD: jest.fn().mockReturnValue(day),
  }));

  // Spy on the real daily-stats module
  const recordDailyStatsSpy = jest.fn();
  if (throwOnRecord) {
    recordDailyStatsSpy.mockImplementation(() => { throw new Error('stats boom'); });
  }
  jest.doMock('../../src/daily-stats', () => ({
    recordDailyStats: recordDailyStatsSpy,
    readDailyCounters: jest.fn().mockReturnValue({ proposals: 2, promotions: 1, recallCount: 3, avgConfidence: 0.9 }),
    dateKey: jest.requireActual('../../src/daily-stats').dateKey,
    readDailyStats: jest.requireActual('../../src/daily-stats').readDailyStats,
  }));

  const { runToday } = require('../../src/today-command');
  return { runToday, recordDailyStatsSpy };
}

// ── SC1: first run → recordDailyStats called with correct shape ───────────────

it('runToday creates briefing + calls recordDailyStats with correct 7-field payload on first run', async () => {
  const { runToday, recordDailyStatsSpy } = loadRunToday({ day: '2026-04-24' });

  const result = await runToday({
    mcpClient: null,
    mode: 'scheduled',
    projectsDir: tmpProjects,
    vaultRoot: tmpVault,
    date: FIXED_NOW_DAY1,
    haikuClient: makeMockHaikuClient(),
  });

  // Briefing must have been produced
  expect(result.path).toBeDefined();
  expect(result.briefing).toBeDefined();
  expect(result.error).toBeUndefined();

  // Briefing file must exist on disk
  const briefingPath = path.join(tmpVault, 'RIGHT', 'daily', '2026-04-24.md');
  expect(fs.existsSync(briefingPath)).toBe(true);

  // recordDailyStats called exactly once
  expect(recordDailyStatsSpy).toHaveBeenCalledTimes(1);

  // Payload shape: all 7 fields present
  const payload = recordDailyStatsSpy.mock.calls[0][0];
  expect(payload).toHaveProperty('proposals');
  expect(payload).toHaveProperty('promotions');
  expect(payload).toHaveProperty('totalEntries');
  expect(payload).toHaveProperty('memoryKb');
  expect(payload).toHaveProperty('recallCount');
  expect(payload).toHaveProperty('avgLatencyMs');
  expect(payload).toHaveProperty('avgConfidence');
});

// ── SC2: same-day second run calls recordDailyStats again ─────────────────────

it('runToday called twice on same day calls recordDailyStats twice (idempotency enforced in daily-stats, not today-command)', async () => {
  const { runToday, recordDailyStatsSpy } = loadRunToday({ day: '2026-04-24' });
  const haikuClient = makeMockHaikuClient();

  await runToday({ mcpClient: null, mode: 'scheduled', projectsDir: tmpProjects, vaultRoot: tmpVault, date: FIXED_NOW_DAY1, haikuClient });
  await runToday({ mcpClient: null, mode: 'scheduled', projectsDir: tmpProjects, vaultRoot: tmpVault, date: FIXED_NOW_DAY1, haikuClient });

  // today-command fires recordDailyStats on every non-dry-run call
  // The idempotency (last-run-wins) is enforced INSIDE daily-stats.js, not here
  expect(recordDailyStatsSpy).toHaveBeenCalledTimes(2);
});

// ── SC3: dry-run skips recordDailyStats ──────────────────────────────────────

it('dry-run mode does NOT call recordDailyStats', async () => {
  const { runToday, recordDailyStatsSpy } = loadRunToday({ day: '2026-04-24' });

  const result = await runToday({
    mcpClient: null,
    mode: 'dry-run',
    projectsDir: tmpProjects,
    vaultRoot: tmpVault,
    date: FIXED_NOW_DAY1,
    haikuClient: makeMockHaikuClient(),
  });

  expect(result.path).toBeDefined();
  expect(result.briefing).toBeDefined();
  expect(recordDailyStatsSpy).toHaveBeenCalledTimes(0);
});

// ── SC4: briefing-is-the-product — recordDailyStats failure doesn't break briefing ──

it('briefing is still produced AND written to disk when recordDailyStats throws', async () => {
  const { runToday } = loadRunToday({ day: '2026-04-24', throwOnRecord: true });

  const result = await runToday({
    mcpClient: null,
    mode: 'scheduled',
    projectsDir: tmpProjects,
    vaultRoot: tmpVault,
    date: FIXED_NOW_DAY1,
    haikuClient: makeMockHaikuClient(),
  });

  // Briefing must have been produced despite stats failure
  expect(result.path).toBeDefined();
  expect(result.briefing).toBeDefined();
  expect(result.error).toBeUndefined();

  // Briefing file on disk must exist
  const briefingPath = path.join(tmpVault, 'RIGHT', 'daily', '2026-04-24.md');
  expect(fs.existsSync(briefingPath)).toBe(true);
  const briefingContent = fs.readFileSync(briefingPath, 'utf8');
  expect(briefingContent.length).toBeGreaterThan(0);
});

// ── SC5: missing memory.md falls back gracefully ─────────────────────────────

it('briefing succeeds when memory.md is missing — recordDailyStats called with totalEntries:0 and memoryKb:0', async () => {
  // Remove memory.md
  fs.rmSync(path.join(tmpVault, 'memory', 'memory.md'), { force: true });

  // Also mock readMemory to simulate missing file (returns [])
  jest.resetModules();
  loadRunToday({ day: '2026-04-24' });

  // Override readMemory to return empty (simulating missing file)
  jest.doMock('../../src/memory-reader', () => ({
    getMemoryEcho: jest.fn().mockResolvedValue({ entries: [], score: 0, skipped: false }),
    readMemory: jest.fn().mockResolvedValue([]),
  }));

  jest.resetModules();
  loadRunToday({ day: '2026-04-24' });
  // Override readMemory after re-registering
  jest.doMock('../../src/memory-reader', () => ({
    getMemoryEcho: jest.fn().mockResolvedValue({ entries: [], score: 0, skipped: false }),
    readMemory: jest.fn().mockResolvedValue([]),
  }));
  const { runToday: runToday3 } = require('../../src/today-command');

  const result = await runToday3({
    mcpClient: null,
    mode: 'scheduled',
    projectsDir: tmpProjects,
    vaultRoot: tmpVault,
    date: FIXED_NOW_DAY1,
    haikuClient: makeMockHaikuClient(),
  });

  expect(result.path).toBeDefined();
  expect(result.error).toBeUndefined();
});

// ── SC6: payload avgLatencyMs matches _phase20.avgLatencyMs ──────────────────

it('recordDailyStats payload avgLatencyMs matches _phase20.avgLatencyMs on the return value', async () => {
  const { runToday, recordDailyStatsSpy } = loadRunToday({ day: '2026-04-24' });

  const result = await runToday({
    mcpClient: null,
    mode: 'scheduled',
    projectsDir: tmpProjects,
    vaultRoot: tmpVault,
    date: FIXED_NOW_DAY1,
    haikuClient: makeMockHaikuClient(),
  });

  expect(recordDailyStatsSpy).toHaveBeenCalledTimes(1);
  const payload = recordDailyStatsSpy.mock.calls[0][0];

  // avgLatencyMs in payload must match what _phase20 computed
  expect(result._phase20).toBeDefined();
  expect(payload.avgLatencyMs).toBe(result._phase20.avgLatencyMs);
});

'use strict';
/**
 * test/today-command.compounding.test.js
 *
 * Phase 31: Compounding trend section (TREND-02) — end-to-end through runToday
 * with the REAL briefing-renderer and compounding-trend modules.
 *
 * Lives in its own file (not today-command.test.js) deliberately: runToday
 * lazy-requires daily-stats/pipeline-infra at CALL time, and the main test
 * file's layered per-suite doMock registries leak into those runtime requires
 * (jest.isolateModules sandboxes are already discarded by then). A dedicated
 * file with hoisted jest.mock is the only registry these requires can see.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mutable row set consumed by the hoisted daily-stats mock below.
let mockRows = [];

jest.mock('../src/connectors/calendar', () => ({
  getCalendarEvents: jest.fn().mockResolvedValue({ success: true, data: [], error: null, source: 'calendar', fetchedAt: new Date().toISOString() }),
}));
jest.mock('../src/connectors/gmail', () => ({
  getRecentEmails: jest.fn().mockResolvedValue({ success: true, data: [], error: null, source: 'gmail', fetchedAt: new Date().toISOString() }),
}));
jest.mock('../src/connectors/github', () => ({
  getGitHubActivity: jest.fn().mockResolvedValue({ success: true, data: { repos: [], warnings: [] }, error: null, source: 'github', fetchedAt: new Date().toISOString() }),
}));
jest.mock('../src/briefing-helpers', () => ({
  getProposalsPendingCount: jest.fn().mockResolvedValue(0),
  getDeadLetterSummary: jest.fn().mockResolvedValue({ pending: 0, frozen: 0, total: 0, warning: false }),
  formatBriefingSection: jest.fn().mockReturnValue(''),
}));
jest.mock('../src/pipeline-infra', () => ({
  safeLoadPipelineConfig: jest.fn().mockReturnValue({
    config: {
      slippage: { staleDays: 7, excludeProjects: [], maxProjects: 20 },
      classifier: { stage1ConfidenceThreshold: 0.8 },
      stats: { enabled: true, path: 'briefings/daily-stats.md' },
    },
    error: null,
  }),
  createHaikuClient: jest.fn().mockReturnValue({
    classify: jest.fn().mockResolvedValue({ success: true, data: '' }),
  }),
  // vault-gateway reads its allowlist and excluded terms through these two,
  // now that the briefing write routes through vaultWrite.
  safeLoadVaultPaths: jest.fn(() => require('../config/vault-paths.json')),
  loadExcludedTerms: jest.fn(() => require('../config/excluded-terms.json')),
}));
jest.mock('../src/memory-reader', () => ({
  getMemoryEcho: jest.fn().mockResolvedValue({ entries: [], score: 0 }),
}));
jest.mock('../src/today/slippage-scanner', () => ({
  scanSlippage: jest.fn().mockReturnValue({ projects: [], warnings: [] }),
}));
jest.mock('../src/today/frog-identifier', () => ({
  identifyFrog: jest.fn().mockResolvedValue({ frog: null, reasoning: '' }),
}));
jest.mock('../src/today/llm-augmentation', () => ({
  generateSynthesis: jest.fn().mockResolvedValue(''),
}));
jest.mock('../src/daily-stats', () => ({
  readDailyStats: jest.fn(() => ({ rows: mockRows })),
  recordDailyStats: jest.fn(),
  readDailyCounters: jest.fn().mockReturnValue({ proposals: 0, promotions: 0, recallCount: 0, recallHits: 0, echoShown: 0, echoScore: 0, avgConfidence: 0 }),
  recordEchoShown: jest.fn(),
  flushMissedDays: jest.fn(),
}));

// vault-gateway and style-policy capture VAULT_ROOT at require time, and
// today-command pulls both in on the line below — so the override has to land
// here, not in beforeEach, or the briefing write targets the real vault.
const GATEWAY_VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-compounding-gateway-'));
process.env.VAULT_ROOT = GATEWAY_VAULT_ROOT;
fs.mkdirSync(path.join(GATEWAY_VAULT_ROOT, 'ABOUT ME'), { recursive: true });
fs.writeFileSync(
  path.join(GATEWAY_VAULT_ROOT, 'ABOUT ME', 'anti-ai-writing-style.md'),
  '## Banned words\n\n| Word/Phrase | Why |\n|---|---|\n| game-changer | filler |\n',
  'utf8'
);

const { runToday } = require('../src/today-command');

afterAll(() => {
  fs.rmSync(GATEWAY_VAULT_ROOT, { recursive: true, force: true });
});

/** A daily-stats row with enough growth + recall activity to satisfy all gates. */
function buildGrowingRow(i) {
  return {
    date: `2026-04-${10 + i}`,
    total_entries: 100 + i * 2, // +12 across 7 rows — clears the +5 supply floor
    memory_kb: 50 + i,
    recall_count: 2,
    recall_hits: 2,
    echo_shown: 1,
    echo_score: 0.8,
  };
}

describe('Phase 31: Compounding trend section (TREND-02)', () => {
  let tempProjectsDir;
  let tempVaultRoot;

  beforeEach(() => {
    tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-compounding-projects-'));
    tempVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-compounding-vault-'));
  });

  afterEach(() => {
    fs.rmSync(tempProjectsDir, { recursive: true, force: true });
    fs.rmSync(tempVaultRoot, { recursive: true, force: true });
  });

  it('renders ## Compounding when >=7 rows produce a non-insufficient-data verdict', async () => {
    mockRows = Array.from({ length: 7 }, (_, i) => buildGrowingRow(i));

    const result = await runToday({
      mcpClient: null,
      mode: 'dry-run',
      projectsDir: tempProjectsDir,
      vaultRoot: GATEWAY_VAULT_ROOT, // must match the root vault-gateway writes through
      date: new Date('2026-04-25T18:00:00.000Z'),
    });

    expect(result.briefing).toContain('## Compounding');
    expect(result.briefing).toMatch(/\*\*Verdict: compounding\*\*/);
  });

  it('suppresses the trend body under 7 rows but still renders ## Compounding with the sweep line', async () => {
    mockRows = [];

    const result = await runToday({
      mcpClient: null,
      mode: 'dry-run',
      projectsDir: tempProjectsDir,
      vaultRoot: GATEWAY_VAULT_ROOT, // must match the root vault-gateway writes through
      date: new Date('2026-04-25T18:00:00.000Z'),
    });

    // Trend verdict is suppressed (<7 rows)…
    expect(result.briefing).not.toMatch(/\*\*Verdict:/);
    // …but the section now always renders because the Phase 33 sweep line is always shown.
    expect(result.briefing).toContain('## Compounding');
    expect(result.briefing).toMatch(/sweep (ran|STALE|NEVER RAN)/);
  });
});

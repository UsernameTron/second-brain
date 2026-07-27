'use strict';

/**
 * test/today-command.gateway.test.js
 *
 * The /today briefing write goes through vault-gateway's vaultWrite, not raw
 * fs, so the daily note runs the same Guard 2 (content policy) and Guard 3
 * (style lint) checks as every other vault write.
 *
 * That matters because the briefing body is LLM-synthesized from external
 * connector data (Gmail, Calendar, GitHub) and is the highest-frequency write
 * in the system — exactly the content class the ISPN/Genesys/Asana exclusion
 * filter exists for.
 *
 * Pins the failure policy, which trades off against briefing-is-the-product:
 *   - clean body            → written verbatim
 *   - some paragraphs dirty → gateway redacts them, briefing still writes
 *   - most paragraphs dirty → quarantined, stub written in its place
 *   - style violation       → quarantined + stub, never a TODAY_FATAL throw
 *   - the stub itself is gate-clean, so the fallback write can never quarantine
 *
 * Lives in its own file (like today-command.compounding.test.js): vault-gateway
 * and style-policy capture VAULT_ROOT at require time, so the override has to
 * be in place before today-command is required at module load.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Haiku stub for content-policy Stage 2 ────────────────────────────────────

/** @type {jest.Mock} Set per-test to control the Stage 2 classification. */
let mockHaikuCreate;

jest.mock('@anthropic-ai/sdk', () => {
  mockHaikuCreate = jest.fn();
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockHaikuCreate },
  }));
});

// ── Briefing body under test ─────────────────────────────────────────────────

/** @type {string} Mutable body returned by the stubbed renderBriefing. */
let mockBriefingBody = '';

jest.mock('../src/today/briefing-renderer', () => {
  const actual = jest.requireActual('../src/today/briefing-renderer');
  // buildSourceHealth and formatDateYMD stay real — only the body is swapped,
  // so each test can control paragraph count and contamination ratio exactly.
  return { ...actual, renderBriefing: jest.fn(() => mockBriefingBody) };
});

// ── Orchestration stubs (mirrors today-command.compounding.test.js) ──────────

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
      thresholds: { haikuTimeoutMs: 2000 },
    },
    error: null,
  }),
  createHaikuClient: jest.fn().mockReturnValue({
    classify: jest.fn().mockResolvedValue({ success: true, data: '' }),
  }),
  // Real config: proves 'briefings' is genuinely on the RIGHT-side allowlist.
  safeLoadVaultPaths: jest.fn(() => require('../config/vault-paths.json')),
  loadExcludedTerms: jest.fn(() => require('../config/excluded-terms.json')),
}));
jest.mock('../src/memory-reader', () => ({
  getMemoryEcho: jest.fn().mockResolvedValue({ entries: [], score: 0 }),
  readMemory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../src/today/slippage-scanner', () => ({
  scanSlippage: jest.fn().mockReturnValue([]),
}));
jest.mock('../src/today/frog-identifier', () => ({
  identifyFrog: jest.fn().mockResolvedValue({ frog: null, reasoning: '' }),
}));
jest.mock('../src/today/llm-augmentation', () => ({
  generateSynthesis: jest.fn().mockResolvedValue(''),
}));
jest.mock('../src/daily-stats', () => ({
  readDailyStats: jest.fn(() => ({ rows: [] })),
  recordDailyStats: jest.fn(),
  readDailyCounters: jest.fn().mockReturnValue({ proposals: 0, promotions: 0, recallCount: 0, recallHits: 0, echoShown: 0, echoScore: 0, avgConfidence: 0 }),
  recordEchoShown: jest.fn(),
  flushMissedDays: jest.fn(),
}));

// ── Temp vault, installed before today-command pulls in vault-gateway ────────

const VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-today-gateway-vault-'));
process.env.VAULT_ROOT = VAULT;
fs.mkdirSync(path.join(VAULT, 'ABOUT ME'), { recursive: true });
fs.writeFileSync(
  path.join(VAULT, 'ABOUT ME', 'anti-ai-writing-style.md'),
  '## Banned words\n\n| Word/Phrase | Why |\n|---|---|\n| game-changer | filler |\n| synergy | filler |\n',
  'utf8'
);

const { runToday } = require('../src/today-command');
const { checkStyle, getBannedWords } = require('../src/style-policy');
const { normalizeForMatch } = require('../src/content-policy');

const EXCLUDED_TERMS = require('../config/excluded-terms.json');
const DAILY_DIR = path.join(VAULT, 'briefings', 'daily');
const FIXED_DATE = new Date('2026-04-23T12:00:00');
const EXPECTED_FILE = path.join(DAILY_DIR, '2026-04-23.md');

let tempProjectsDir;

beforeEach(() => {
  tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-today-gateway-projects-'));
  fs.rmSync(DAILY_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(VAULT, 'proposals'), { recursive: true, force: true });
  // Default: Stage 2 confirms the block when Stage 1 finds an excluded term.
  mockHaikuCreate.mockResolvedValue({ content: [{ text: 'BLOCK' }] });
});

afterEach(() => {
  fs.rmSync(tempProjectsDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(VAULT, { recursive: true, force: true });
});

/** Run the briefing with the body currently set in mockBriefingBody. */
function run() {
  return runToday({
    mcpClient: null,
    mode: 'scheduled',
    projectsDir: tempProjectsDir,
    vaultRoot: VAULT,
    date: FIXED_DATE,
  });
}

/** @returns {string[]} Quarantine record filenames written under proposals/. */
function quarantineRecords() {
  const dir = path.join(VAULT, 'proposals');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith('quarantine-'));
}

/** Assert no excluded term survives anywhere in the given text. */
function expectNoExcludedTerms(text) {
  const normalized = normalizeForMatch(text);
  const hits = EXCLUDED_TERMS.filter((t) => normalized.includes(normalizeForMatch(t)));
  expect(hits).toEqual([]);
}

describe('/today briefing write routes through vault-gateway', () => {
  it('writes a clean briefing to briefings/daily/ verbatim', async () => {
    mockBriefingBody = '# Daily Briefing\n\nNo meetings today.\n\nPipeline is quiet.';

    const result = await run();

    expect(result.error).toBeUndefined();
    expect(result.quarantined).toBeUndefined();
    expect(result.path).toBe(EXPECTED_FILE);
    expect(fs.readFileSync(EXPECTED_FILE, 'utf8')).toBe(mockBriefingBody);
    // Nothing to classify — Stage 1 short-circuits before any Haiku call.
    expect(mockHaikuCreate).not.toHaveBeenCalled();
    expect(quarantineRecords()).toEqual([]);
  });

  it('does not let an excluded term reach briefings/daily/ unredacted', async () => {
    mockBriefingBody = [
      '# Daily Briefing',
      'No meetings today.',
      'Reviewed the Genesys queue routing configuration for the client migration.',
      'Pipeline is quiet.',
    ].join('\n\n');

    const result = await run();

    // Briefing still renders — one dirty paragraph out of four is under the
    // gateway's quarantine threshold, so it sanitizes rather than blocking.
    expect(result.error).toBeUndefined();
    expect(result.quarantined).toBeUndefined();

    const onDisk = fs.readFileSync(EXPECTED_FILE, 'utf8');
    expect(onDisk).not.toContain('Genesys');
    expectNoExcludedTerms(onDisk);
    expect(onDisk).toContain('[REDACTED]');
    // The clean paragraphs survive — redaction is paragraph-scoped, not total.
    expect(onDisk).toContain('No meetings today.');
    expect(onDisk).toContain('Pipeline is quiet.');
  });

  it('redacts when Haiku is unavailable — the gate fails closed, not open', async () => {
    mockHaikuCreate.mockRejectedValue(new Error('ETIMEDOUT'));
    mockBriefingBody = [
      '# Daily Briefing',
      'No meetings today.',
      'Asana board shows the client rollout slipping a week.',
      'Pipeline is quiet.',
    ].join('\n\n');

    await run();

    const onDisk = fs.readFileSync(EXPECTED_FILE, 'utf8');
    expect(onDisk).not.toContain('Asana');
    expect(onDisk).toContain('[REDACTED]');
  });

  it('writes a stub, not the body, when most paragraphs are excluded content', async () => {
    mockBriefingBody = [
      'ISPN escalation notes for the overnight incident.',
      'Genesys routing changes queued for the same client.',
    ].join('\n\n');

    const result = await run();

    expect(result.error).toBeUndefined();
    expect(result.quarantined).toBe(true);
    expect(result.quarantinePath).toMatch(/^proposals\/quarantine-/);

    // A file still exists for the morning — briefing-is-the-product — but it
    // carries the stub, not the body.
    const onDisk = fs.readFileSync(EXPECTED_FILE, 'utf8');
    expect(onDisk).toContain('status: quarantined');
    expect(onDisk).toContain(result.quarantinePath);
    expect(onDisk).not.toContain('ISPN');
    expectNoExcludedTerms(onDisk);

    // The block is recorded, not swallowed.
    expect(quarantineRecords()).toHaveLength(1);
    // stdout/return and the vault agree on what today's briefing says.
    expect(result.briefing).toBe(onDisk);
  });

  it('quarantines a style violation instead of failing the whole briefing', async () => {
    mockBriefingBody = '# Daily Briefing\n\nThis release is a real game-changer.';

    const result = await run();

    // attemptCount: 1 — a banned word must not surface as TODAY_FATAL.
    expect(result.error).toBeUndefined();
    expect(result.path).toBe(EXPECTED_FILE);
    expect(result.quarantined).toBe(true);

    const onDisk = fs.readFileSync(EXPECTED_FILE, 'utf8');
    expect(onDisk).toContain('status: quarantined');
    expect(onDisk).not.toContain('game-changer');
    expect(quarantineRecords()).toHaveLength(1);
  });

  it('writes the stub through the gateway clean, so the fallback cannot quarantine in turn', async () => {
    mockBriefingBody = 'ISPN incident notes.\n\nGenesys routing notes.';

    const result = await run();
    const stub = fs.readFileSync(EXPECTED_FILE, 'utf8');

    // The fallback write is a second trip through both guards. If the stub ever
    // trips one, the morning ends with no file at all — pin it here.
    expectNoExcludedTerms(stub);
    expect(checkStyle(stub, getBannedWords(), 1)).toEqual({ decision: 'PASS' });
    expect(quarantineRecords()).toHaveLength(1); // the body's record only
    expect(result.briefing).toBe(stub);
  });

  it('routes dry-run writes through the gateway too', async () => {
    mockBriefingBody = 'Genesys queue configuration review.\n\nISPN escalation follow-up.';

    const result = await runToday({
      mcpClient: null,
      mode: 'dry-run',
      projectsDir: tempProjectsDir,
      vaultRoot: VAULT,
      date: FIXED_DATE,
    });

    const dryRunFile = path.join(DAILY_DIR, '_dry-run-2026-04-23.md');
    expect(result.path).toBe(dryRunFile);
    expect(result.quarantined).toBe(true);
    expectNoExcludedTerms(fs.readFileSync(dryRunFile, 'utf8'));
  });
});

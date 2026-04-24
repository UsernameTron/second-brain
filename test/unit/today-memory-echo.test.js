'use strict';

/**
 * test/unit/today-memory-echo.test.js
 *
 * Unit tests for Memory Echo integration in today-command.js (Phase 18, Plan 05).
 *
 * Asserts that:
 *   T1: When getMemoryEcho returns entries, renderBriefing is called with those entries.
 *   T2: When getMemoryEcho throws, runToday completes and renderBriefing receives empty memoryEcho.
 *   T3: When config.memory.echoThreshold is set, getMemoryEcho is called with that threshold.
 *   T4: When config.memory is absent, getMemoryEcho is called with threshold 0.65 (default).
 *
 * Strategy: mock memory-reader and briefing-renderer so we intercept the data flow
 * without exercising real connectors or vault I/O.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const MOCK_ENTRY = {
  category: 'DECISION',
  snippet: 'Adopted JWT with refresh rotation',
  sourceRef: 'file:decisions/auth.md',
  score: 0.82,
};

const MOCK_MEMORY_ECHO_RESULT = {
  entries: [MOCK_ENTRY],
  score: 0.82,
};

const EMPTY_MEMORY_ECHO_RESULT = {
  entries: [],
  score: 0,
};

/** Minimal pipeline config without memory section */
const BASE_CONFIG = {
  slippage: { staleDays: 7, excludeProjects: [], maxProjects: 20 },
  classifier: { stage1ConfidenceThreshold: 0.8 },
};

/** Pipeline config with explicit echoThreshold */
const CONFIG_WITH_THRESHOLD = {
  ...BASE_CONFIG,
  memory: { echoThreshold: 0.4 },
};

// ── Temp directory management ─────────────────────────────────────────────────

let tempVaultRoot;
let tempProjectsDir;

beforeEach(() => {
  tempVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-echo-test-vault-'));
  tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-echo-test-proj-'));
});

afterEach(() => {
  fs.rmSync(tempVaultRoot, { recursive: true, force: true });
  fs.rmSync(tempProjectsDir, { recursive: true, force: true });
  jest.resetModules();
});

// ── Mock setup ────────────────────────────────────────────────────────────────

/**
 * Wire up all required mocks, then require today-command fresh.
 *
 * @param {object} opts
 * @param {Function|null} [opts.getMemoryEchoImpl] - Mock implementation for getMemoryEcho
 * @param {object} [opts.pipelineConfig] - Config returned by safeLoadPipelineConfig
 * @returns {{ runToday: Function, getMemoryEchoMock: jest.Mock, renderBriefingMock: jest.Mock }}
 */
function setup({ getMemoryEchoImpl = null, pipelineConfig = BASE_CONFIG } = {}) {
  const getMemoryEchoMock = jest.fn(
    getMemoryEchoImpl || jest.fn().mockResolvedValue(EMPTY_MEMORY_ECHO_RESULT)
  );

  // Capture the args passed to renderBriefing so we can assert on memoryEcho
  const renderBriefingMock = jest.fn().mockReturnValue('# Mock Briefing\n');

  jest.resetModules();

  // Connectors — minimal success payloads
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

  // Briefing helpers — minimal
  jest.doMock('../../src/briefing-helpers', () => ({
    getProposalsPendingCount: jest.fn().mockResolvedValue(0),
    getDeadLetterSummary: jest.fn().mockResolvedValue({ pending: 0, frozen: 0, total: 0, warning: false }),
    formatBriefingSection: jest.fn().mockReturnValue(''),
  }));

  // Pipeline infra
  jest.doMock('../../src/pipeline-infra', () => ({
    safeLoadPipelineConfig: jest.fn().mockReturnValue({ config: pipelineConfig, error: null }),
    createHaikuClient: jest.fn().mockReturnValue({
      classify: jest.fn().mockResolvedValue({ success: true, data: 'synthesis text' }),
    }),
  }));

  // memory-reader: stub getMemoryEcho
  jest.doMock('../../src/memory-reader', () => ({
    getMemoryEcho: getMemoryEchoMock,
  }));

  // briefing-renderer: stub renderBriefing + re-export helpers used by today-command
  jest.doMock('../../src/today/briefing-renderer', () => ({
    renderBriefing: renderBriefingMock,
    buildSourceHealth: jest.fn().mockReturnValue({ sources: { calendar: 'ok', gmail: 'ok', github: 'ok', pipeline: 'ok' }, degradedCount: 0 }),
    formatDateYMD: jest.fn().mockReturnValue('2026-04-24'),
  }));

  // frog-identifier and llm-augmentation stubs
  jest.doMock('../../src/today/frog-identifier', () => ({
    identifyFrog: jest.fn().mockResolvedValue({ frog: null, reasoning: 'none' }),
  }));
  jest.doMock('../../src/today/llm-augmentation', () => ({
    generateSynthesis: jest.fn().mockResolvedValue('synthesis text'),
  }));
  jest.doMock('../../src/today/slippage-scanner', () => ({
    scanSlippage: jest.fn().mockReturnValue({ projects: [], warnings: [] }),
  }));

  const { runToday } = require('../../src/today-command');
  return { runToday, getMemoryEchoMock, renderBriefingMock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('today-command Memory Echo integration', () => {

  test('T1: getMemoryEcho returns entries → renderBriefing receives memoryEcho with those entries', async () => {
    const { runToday, getMemoryEchoMock, renderBriefingMock } = setup({
      getMemoryEchoImpl: jest.fn().mockResolvedValue(MOCK_MEMORY_ECHO_RESULT),
    });

    await runToday({ vaultRoot: tempVaultRoot, projectsDir: tempProjectsDir, mode: 'dry-run' });

    expect(getMemoryEchoMock).toHaveBeenCalled();
    expect(renderBriefingMock).toHaveBeenCalled();

    const renderArg = renderBriefingMock.mock.calls[0][0];
    expect(renderArg).toHaveProperty('memoryEcho');
    expect(renderArg.memoryEcho.entries).toHaveLength(1);
    expect(renderArg.memoryEcho.entries[0]).toMatchObject(MOCK_ENTRY);
  });

  test('T2: getMemoryEcho throws → runToday completes and renderBriefing receives empty memoryEcho', async () => {
    const { runToday, renderBriefingMock } = setup({
      getMemoryEchoImpl: jest.fn().mockRejectedValue(new Error('MEMORY_READ_ERROR: vault not found')),
    });

    const result = await runToday({ vaultRoot: tempVaultRoot, projectsDir: tempProjectsDir, mode: 'dry-run' });

    // runToday should not throw
    expect(result).not.toHaveProperty('error');

    expect(renderBriefingMock).toHaveBeenCalled();
    const renderArg = renderBriefingMock.mock.calls[0][0];
    expect(renderArg).toHaveProperty('memoryEcho');
    expect(renderArg.memoryEcho.entries).toEqual([]);
    expect(renderArg.memoryEcho.skipped).toBe(true);
  });

  test('T3: config.memory.echoThreshold=0.4 → getMemoryEcho called with { threshold: 0.4 }', async () => {
    const { runToday, getMemoryEchoMock } = setup({
      pipelineConfig: CONFIG_WITH_THRESHOLD,
    });

    await runToday({ vaultRoot: tempVaultRoot, projectsDir: tempProjectsDir, mode: 'dry-run' });

    expect(getMemoryEchoMock).toHaveBeenCalled();
    const [, options] = getMemoryEchoMock.mock.calls[0];
    expect(options).toEqual({ threshold: 0.4 });
  });

  test('T4: config.memory absent → getMemoryEcho called with { threshold: 0.65 } (default)', async () => {
    const { runToday, getMemoryEchoMock } = setup({
      pipelineConfig: BASE_CONFIG, // no memory section
    });

    await runToday({ vaultRoot: tempVaultRoot, projectsDir: tempProjectsDir, mode: 'dry-run' });

    expect(getMemoryEchoMock).toHaveBeenCalled();
    const [, options] = getMemoryEchoMock.mock.calls[0];
    expect(options).toEqual({ threshold: 0.65 });
  });

});

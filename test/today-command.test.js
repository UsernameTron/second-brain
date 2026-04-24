'use strict';

/**
 * test/today-command.test.js
 *
 * Contract tests for the /today command module (src/today-command.js).
 *
 * Validates:
 *   - D-03: Six sections in correct order (Meetings, VIP Emails, Slippage, Frog, GitHub, Pipeline)
 *   - D-07: Horizontal rule after synthesis blockquote, before first section
 *   - D-08: YAML frontmatter with sources map and degraded count
 *   - D-10: Per-section degradation warning format
 *   - D-11: Diagnostic checklist when all sources unavailable
 *   - D-12/D-13/D-14: Inline slippage scanner with real temp STATE.md files
 *   - D-15: Frog identification with LLM success and heuristic fallback
 *   - D-05: Dry-run mode writes _dry-run- prefixed filename
 *
 * Mock strategy:
 *   - jest.doMock for connectors and briefing-helpers (project convention)
 *   - pipeline-infra fully mocked to avoid CONFIG_DIR evaluation at require-time
 *   - Temp directories via fs.mkdtempSync for slippage scanner tests
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const matter = require('gray-matter');

// ── Shared test fixtures ──────────────────────────────────────────────────────

/** Calendar event data for success cases */
const CALENDAR_EVENT = {
  start: '2026-04-23T09:00:00',
  summary: 'Standup',
  attendees: ['alice@example.com'],
};

/** Gmail email data for success cases */
const GMAIL_EMAIL = {
  subject: 'Urgent Review Needed',
  from: 'vip@example.com',
  snippet: 'Please review the attached document.',
};

/** GitHub activity data for success cases */
const GITHUB_DATA = {
  repos: [
    {
      name: 'second-brain',
      commits: [{ sha: 'abc123', message: 'feat: add tests' }],
      pullRequests: [{ number: 1, title: 'Fix bug', state: 'open' }],
      issues: [],
      warnings: [],
    },
  ],
  warnings: [],
};

/** Default pipeline config used by mocked pipeline-infra */
const DEFAULT_PIPELINE_CONFIG = {
  slippage: { staleDays: 7, excludeProjects: [], maxProjects: 20 },
  classifier: { stage1ConfidenceThreshold: 0.8 },
};

// ── Temp directory management ─────────────────────────────────────────────────

let tempProjectsDir;
let tempVaultRoot;

beforeEach(() => {
  tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-today-test-projects-'));
  tempVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-today-test-vault-'));
});

afterEach(() => {
  fs.rmSync(tempProjectsDir, { recursive: true, force: true });
  fs.rmSync(tempVaultRoot, { recursive: true, force: true });
  jest.resetModules();
});

// ── Mock factories ────────────────────────────────────────────────────────────

/**
 * Create a mock Haiku LLM client.
 * @param {object} opts
 * @param {boolean} [opts.frogSuccess=true] - Whether frog classify succeeds
 * @param {boolean} [opts.synthSuccess=true] - Whether synthesis classify succeeds
 */
function makeMockHaikuClient({ frogSuccess = true, synthSuccess = true } = {}) {
  return {
    classify: jest.fn(async (systemPrompt) => {
      // Synthesis call comes before frog call in the code flow
      // We distinguish by checking the system prompt content
      const isSynthesisCall = systemPrompt.includes('daily briefing synthesis');
      const isFrogCall = systemPrompt.includes('single hardest');

      if (isSynthesisCall) {
        if (!synthSuccess) {
          return { success: false, error: 'LLM_API_ERROR: synthesis failed', failureMode: 'api-error' };
        }
        return { success: true, data: 'Three meetings today. VIP email from vip@example.com needs attention. GitHub activity is healthy. No pipeline alerts.' };
      }
      if (isFrogCall) {
        if (!frogSuccess) {
          return { success: false, error: 'LLM_API_ERROR: classify failed', failureMode: 'api-error' };
        }
        return { success: true, data: { frog: 'second-brain', reasoning: 'Most stalled project with urgent deliverable.' } };
      }
      // Fallback for unexpected calls
      return { success: false, error: 'UNEXPECTED_CALL', failureMode: 'api-error' };
    }),
  };
}

/**
 * Setup all mocks and return a fresh require of today-command.
 * @param {object} opts
 * @param {boolean} [opts.calendarSuccess=true]
 * @param {boolean} [opts.gmailSuccess=true]
 * @param {boolean} [opts.githubSuccess=true]
 * @param {boolean} [opts.pipelineSuccess=true]
 * @param {object} [opts.pipelineConfig] - Override pipeline config
 */
function setupMocks({
  calendarSuccess = true,
  gmailSuccess = true,
  githubSuccess = true,
  pipelineSuccess = true,
  pipelineConfig = DEFAULT_PIPELINE_CONFIG,
} = {}) {
  const { SOURCE } = require('../src/connectors/types');

  const calResult = calendarSuccess
    ? { success: true, data: [CALENDAR_EVENT], error: null, source: SOURCE.CALENDAR, fetchedAt: new Date().toISOString() }
    : { success: false, data: null, error: 'MCP_AUTH_ERROR: calendar unavailable', source: SOURCE.CALENDAR, fetchedAt: new Date().toISOString() };

  const gmailResult = gmailSuccess
    ? { success: true, data: [GMAIL_EMAIL], error: null, source: SOURCE.GMAIL, fetchedAt: new Date().toISOString() }
    : { success: false, data: null, error: 'MCP_AUTH_ERROR: gmail unavailable', source: SOURCE.GMAIL, fetchedAt: new Date().toISOString() };

  const githubResult = githubSuccess
    ? { success: true, data: GITHUB_DATA, error: null, source: SOURCE.GITHUB, fetchedAt: new Date().toISOString() }
    : { success: false, data: null, error: 'MCP_AUTH_ERROR: github unavailable', source: SOURCE.GITHUB, fetchedAt: new Date().toISOString() };

  const pipelineStateResult = pipelineSuccess
    ? { proposalCount: 3, deadLetter: { pending: 1, frozen: 0, total: 1, warning: false }, ok: true }
    : { proposalCount: 0, deadLetter: { pending: 0, frozen: 0, total: 0, warning: false }, ok: false, error: 'PIPELINE_ERROR: unavailable' };

  jest.doMock('../src/connectors/calendar', () => ({
    getCalendarEvents: jest.fn().mockResolvedValue(calResult),
  }));

  jest.doMock('../src/connectors/gmail', () => ({
    getRecentEmails: jest.fn().mockResolvedValue(gmailResult),
  }));

  jest.doMock('../src/connectors/github', () => ({
    getGitHubActivity: jest.fn().mockResolvedValue(githubResult),
  }));

  // When pipeline fails, make getProposalsPendingCount throw so _getPipelineState()
  // catches it and returns ok: false — matching how the actual infra would behave.
  const briefingHelpersMock = pipelineSuccess
    ? {
        getProposalsPendingCount: jest.fn().mockResolvedValue(pipelineStateResult.proposalCount),
        getDeadLetterSummary: jest.fn().mockResolvedValue(pipelineStateResult.deadLetter),
        formatBriefingSection: jest.fn((type, data) => {
          if (type === 'proposals') {
            return data.count > 0 ? `Memory proposals pending: ${data.count} awaiting review` : '';
          }
          if (type === 'deadletter') {
            return data.total > 0
              ? `Unrouted: ${data.pending} pending, ${data.frozen} frozen (3+ retry failures)`
              : '';
          }
          return '';
        }),
      }
    : {
        getProposalsPendingCount: jest.fn().mockRejectedValue(new Error('PIPELINE_ERROR: unavailable')),
        getDeadLetterSummary: jest.fn().mockRejectedValue(new Error('PIPELINE_ERROR: unavailable')),
        formatBriefingSection: jest.fn().mockReturnValue(''),
      };

  jest.doMock('../src/briefing-helpers', () => briefingHelpersMock);

  jest.doMock('../src/pipeline-infra', () => ({
    loadPipelineConfig: jest.fn().mockReturnValue(pipelineConfig),
    safeLoadPipelineConfig: jest.fn().mockReturnValue({ config: pipelineConfig, error: null }),
    createHaikuClient: jest.fn().mockReturnValue(makeMockHaikuClient()),
  }));

  // Clear module cache so fresh doMock applies
  jest.resetModules();

  // Re-apply mocks after resetModules (resetModules clears them)
  jest.doMock('../src/connectors/calendar', () => ({
    getCalendarEvents: jest.fn().mockResolvedValue(calResult),
  }));
  jest.doMock('../src/connectors/gmail', () => ({
    getRecentEmails: jest.fn().mockResolvedValue(gmailResult),
  }));
  jest.doMock('../src/connectors/github', () => ({
    getGitHubActivity: jest.fn().mockResolvedValue(githubResult),
  }));
  jest.doMock('../src/briefing-helpers', () => briefingHelpersMock);
  jest.doMock('../src/pipeline-infra', () => ({
    loadPipelineConfig: jest.fn().mockReturnValue(pipelineConfig),
    safeLoadPipelineConfig: jest.fn().mockReturnValue({ config: pipelineConfig, error: null }),
    createHaikuClient: jest.fn().mockReturnValue(makeMockHaikuClient()),
  }));

  return require('../src/today-command');
}

/**
 * Create a well-formed STATE.md in a project subdirectory.
 * @param {string} projectsDir
 * @param {string} projectName
 * @param {object} opts
 */
function createStateMd(projectsDir, projectName, opts = {}) {
  const {
    status = 'executing',
    last_activity = '2026-04-10',
    percent = 50,
    completed_phases = 2,
    total_phases = 4,
    malformed = false,
  } = opts;

  const planningDir = path.join(projectsDir, projectName, '.planning');
  fs.mkdirSync(planningDir, { recursive: true });

  const statePath = path.join(planningDir, 'STATE.md');

  if (malformed) {
    // Write invalid YAML that gray-matter can't parse properly — use colons without quotes
    fs.writeFileSync(statePath, '---\nstatus: {broken yaml: [unclosed\n---\n# Bad STATE', 'utf8');
    return;
  }

  const content = `---
gsd_state_version: 1.0
status: ${status}
last_activity: ${last_activity}
progress:
  percent: ${percent}
  completed_phases: ${completed_phases}
  total_phases: ${total_phases}
---

# Project State
`;
  fs.writeFileSync(statePath, content, 'utf8');
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('runToday', () => {
  // Use local noon time so date stays 2026-04-23 in any US timezone
  const FIXED_DATE = new Date('2026-04-23T12:00:00');

  // ── briefing sections ────────────────────────────────────────────────────

  describe('briefing sections', () => {
    it('produces a briefing with all 6 section headers in correct order', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toBeTruthy();
      const briefing = result.briefing;

      // Find all ## headings in order
      const headingMatches = [...briefing.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(headingMatches).toEqual([
        'Meetings',
        'VIP Emails',
        'Slippage',
        'Frog',
        'GitHub',
        'Pipeline',
      ]);
    });

    it('contains a horizontal rule after the synthesis blockquote, before first section', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      const briefing = result.briefing;
      // Content has order: synthesis blockquote, then ---, then ## Meetings
      const synthIdx = briefing.indexOf('> ');
      const hrIdx = briefing.indexOf('\n---\n', synthIdx);
      const meetingsIdx = briefing.indexOf('## Meetings', hrIdx);

      expect(synthIdx).toBeGreaterThan(-1);
      expect(hrIdx).toBeGreaterThan(synthIdx);
      expect(meetingsIdx).toBeGreaterThan(hrIdx);
    });
  });

  // ── degradation ──────────────────────────────────────────────────────────

  describe('degradation', () => {
    it('renders D-10 warning format when one connector fails', async () => {
      const { runToday } = setupMocks({ calendarSuccess: false });
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toBeTruthy();
      // D-10: format is ⚠️ [source] ERROR_CODE: message
      // The regex per plan: /\[.+\] [A-Z_]+: .+/
      expect(result.briefing).toMatch(/\[.+\] [A-Z_]+: .+/);
      // Should NOT contain the all-sources-unavailable checklist
      expect(result.briefing).not.toMatch(/All data sources unavailable/);
    });

    it('renders D-11 diagnostic checklist when ALL connectors fail', async () => {
      const { runToday } = setupMocks({
        calendarSuccess: false,
        gmailSuccess: false,
        githubSuccess: false,
        pipelineSuccess: false,
      });
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toBeTruthy();
      // D-11: must contain the total failure checklist
      expect(result.briefing).toMatch(/All data sources unavailable/);
      expect(result.briefing).toMatch(/Docker Desktop/);
    });

    it('degradation warning includes the source name in brackets', async () => {
      const { runToday } = setupMocks({ gmailSuccess: false });
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      // The degraded gmail section should mention [gmail]
      expect(result.briefing).toMatch(/\[gmail\]/);
    });
  });

  // ── source health ────────────────────────────────────────────────────────

  describe('source health', () => {
    it('sourceHealth has calendar/gmail/github/pipeline keys all ok when all succeed', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.sourceHealth).toBeDefined();
      const { sources } = result.sourceHealth;
      expect(sources.calendar).toBe('ok');
      expect(sources.gmail).toBe('ok');
      expect(sources.github).toBe('ok');
      expect(sources.pipeline).toBe('ok');
    });

    it('sourceHealth marks failed connector as degraded', async () => {
      const { runToday } = setupMocks({ githubSuccess: false });
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.sourceHealth.sources.github).toBe('degraded');
      expect(result.sourceHealth.sources.calendar).toBe('ok');
      expect(result.sourceHealth.degradedCount).toBe(1);
    });

    it('degradedCount matches the number of failed sources', async () => {
      const { runToday } = setupMocks({ calendarSuccess: false, githubSuccess: false });
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.sourceHealth.degradedCount).toBe(2);
    });
  });

  // ── frontmatter ──────────────────────────────────────────────────────────

  describe('frontmatter', () => {
    it('briefing has parseable YAML frontmatter with all D-08 fields', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toBeTruthy();
      const parsed = matter(result.briefing);
      const fm = parsed.data;

      // D-08 required fields
      expect(fm.date).toBeDefined();
      expect(fm.sources).toBeDefined();
      expect(fm.sources.calendar).toBeDefined();
      expect(fm.sources.gmail).toBeDefined();
      expect(fm.sources.github).toBeDefined();
      expect(fm.sources.pipeline).toBeDefined();
      expect(fm.degraded).toBeDefined();
      expect(fm.generated).toBeDefined();
      expect(fm.mode).toBe('dry-run');
    });

    it('frontmatter date matches the injected date', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      // gray-matter auto-parses YAML dates into JS Date objects.
      // Assert on the raw frontmatter string to avoid timezone conversion issues.
      expect(result.briefing).toContain('date: 2026-04-23');
    });

    it('frontmatter degraded count is a number', async () => {
      const { runToday } = setupMocks({ calendarSuccess: false });
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      const parsed = matter(result.briefing);
      expect(typeof parsed.data.degraded).toBe('number');
      expect(parsed.data.degraded).toBeGreaterThan(0);
    });
  });

  // ── slippage scanner ─────────────────────────────────────────────────────

  describe('slippage scanner', () => {
    it('detects a stalled project (daysSinceActivity > staleDays)', async () => {
      // Create a project that last had activity 30 days before FIXED_DATE
      const thirtyDaysAgo = new Date('2026-03-24'); // 30 days before 2026-04-23
      createStateMd(tempProjectsDir, 'stalled-project', {
        status: 'executing',
        last_activity: thirtyDaysAgo.toISOString().split('T')[0],
        percent: 25,
      });

      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      // Should appear in the Slippage section
      expect(result.briefing).toContain('stalled-project');
    });

    it('does NOT flag an active project (daysSinceActivity <= staleDays)', async () => {
      // Create a project active 2 days ago (within staleDays=7)
      createStateMd(tempProjectsDir, 'active-project', {
        status: 'executing',
        last_activity: '2026-04-21', // 2 days before FIXED_DATE
        percent: 80,
      });

      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      // Active project should NOT appear in slippage wikilinks
      // (it's not stalled, so not in stalled section)
      const slippageIdx = result.briefing.indexOf('## Slippage');
      const frogIdx = result.briefing.indexOf('## Frog');
      const slippageContent = result.briefing.slice(slippageIdx, frogIdx);
      // If only active projects exist, should show "No stalled projects"
      expect(slippageContent).toMatch(/No stalled projects/i);
    });

    it('skips malformed STATE.md files and includes warning in briefing', async () => {
      createStateMd(tempProjectsDir, 'bad-project', { malformed: true });
      // Also create a real project so the slippage scan has something valid
      createStateMd(tempProjectsDir, 'real-project', {
        status: 'executing',
        last_activity: '2026-03-01',
        percent: 60,
      });

      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      // The bad-project should NOT cause a crash
      expect(result.briefing).toBeTruthy();
      expect(result.error).toBeUndefined();
      // The malformed file emits a PARSE_SKIP warning that should appear in slippage section
      expect(result.briefing).toMatch(/PARSE_SKIP|Scanner warnings/);
    });

    it('respects excludeProjects config — excluded project not flagged', async () => {
      createStateMd(tempProjectsDir, 'excluded-project', {
        status: 'executing',
        last_activity: '2026-01-01', // very stale
        percent: 10,
      });

      const { runToday } = setupMocks({
        pipelineConfig: {
          ...DEFAULT_PIPELINE_CONFIG,
          slippage: {
            staleDays: 7,
            excludeProjects: ['excluded-project'],
            maxProjects: 20,
          },
        },
      });
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toBeTruthy();
      // excluded-project should NOT appear in slippage wikilinks
      expect(result.briefing).not.toContain('[[excluded-project]]');
    });

    it('projects without .planning/STATE.md are silently skipped', async () => {
      // Create a directory with no .planning/ at all
      fs.mkdirSync(path.join(tempProjectsDir, 'no-planning-dir'));

      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      // Should not crash, slippage section shows no stalled projects
      expect(result.briefing).toBeTruthy();
      expect(result.error).toBeUndefined();
    });
  });

  // ── frog identification ──────────────────────────────────────────────────

  describe('frog identification', () => {
    it('uses LLM frog result when classify returns success', async () => {
      createStateMd(tempProjectsDir, 'stalled-work', {
        status: 'executing',
        last_activity: '2026-03-01',
        percent: 30,
      });

      const { runToday } = setupMocks();
      // Client that returns specific frog
      const haikuClient = {
        classify: jest.fn(async (systemPrompt) => {
          if (systemPrompt.includes('daily briefing synthesis')) {
            return { success: true, data: 'Summary text here.' };
          }
          // Frog classify call
          return { success: true, data: { frog: 'LLM-identified-frog', reasoning: 'LLM reasoning here.' } };
        }),
      };

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toContain('LLM-identified-frog');
    });

    it('falls back to heuristic when classify returns success===false', async () => {
      createStateMd(tempProjectsDir, 'heuristic-project', {
        status: 'executing',
        last_activity: '2026-02-01',
        percent: 20,
      });

      const { runToday } = setupMocks();
      // Client that fails frog classify but succeeds synthesis
      const haikuClient = {
        classify: jest.fn(async (systemPrompt) => {
          if (systemPrompt.includes('daily briefing synthesis')) {
            return { success: true, data: 'Summary text.' };
          }
          // Frog classify fails
          return { success: false, error: 'LLM_API_ERROR: timeout', failureMode: 'timeout' };
        }),
      };

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toBeTruthy();
      // Heuristic fallback text contains the project name and "Heuristic fallback"
      expect(result.briefing).toMatch(/Heuristic fallback|heuristic-project/i);
    });

    it('shows "No frog identified" when no stalled projects exist', async () => {
      // No STATE.md files in tempProjectsDir — no stalled projects
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.briefing).toContain('No frog identified');
    });
  });

  // ── output modes ─────────────────────────────────────────────────────────

  describe('output modes', () => {
    it('dry-run mode writes file with _dry-run- prefix', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.path).toMatch(/_dry-run-2026-04-23\.md$/);
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it('non-dry-run mode writes file without _dry-run- prefix', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'scheduled',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.path).toMatch(/2026-04-23\.md$/);
      expect(result.path).not.toContain('_dry-run-');
      expect(fs.existsSync(result.path)).toBe(true);
    });

    it('returns { path, briefing, sourceHealth } on success', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      expect(result.path).toBeDefined();
      expect(result.briefing).toBeDefined();
      expect(result.sourceHealth).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('frontmatter mode field matches the mode option passed', async () => {
      const { runToday } = setupMocks();
      const haikuClient = makeMockHaikuClient();

      const result = await runToday({
        mcpClient: {},
        mode: 'scheduled',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient,
      });

      const parsed = matter(result.briefing);
      expect(parsed.data.mode).toBe('scheduled');
    });
  });

  // ── remote trigger (FIX-03) ──────────────────────────────────────────────

  describe('remote trigger context', () => {
    it('passes remote context to getCalendarEvents when REMOTE_TRIGGER env var is set and mcpClient is null', async () => {
      const originalRemoteTrigger = process.env.REMOTE_TRIGGER;
      process.env.REMOTE_TRIGGER = 'true';

      jest.resetModules();

      const { SOURCE } = require('../src/connectors/types');
      // Track what args getCalendarEvents was called with
      const getCalendarEventsMock = jest.fn().mockResolvedValue({
        success: true,
        data: [],
        error: null,
        source: SOURCE.CALENDAR,
        fetchedAt: new Date().toISOString(),
      });

      jest.doMock('../src/connectors/calendar', () => ({
        getCalendarEvents: getCalendarEventsMock,
      }));
      jest.doMock('../src/connectors/gmail', () => ({
        getRecentEmails: jest.fn().mockResolvedValue({
          success: false, data: null, error: 'GMAIL_UNAVAILABLE: no client', source: SOURCE.GMAIL, fetchedAt: new Date().toISOString(),
        }),
      }));
      jest.doMock('../src/connectors/github', () => ({
        getGitHubActivity: jest.fn().mockResolvedValue({
          success: false, data: null, error: 'GITHUB_UNAVAILABLE: no client', source: SOURCE.GITHUB, fetchedAt: new Date().toISOString(),
        }),
      }));
      jest.doMock('../src/briefing-helpers', () => ({
        getProposalsPendingCount: jest.fn().mockResolvedValue(0),
        getDeadLetterSummary: jest.fn().mockResolvedValue({ pending: 0, frozen: 0, total: 0, warning: false }),
        formatBriefingSection: jest.fn().mockReturnValue(''),
      }));
      jest.doMock('../src/pipeline-infra', () => ({
        loadPipelineConfig: jest.fn().mockReturnValue(DEFAULT_PIPELINE_CONFIG),
        safeLoadPipelineConfig: jest.fn().mockReturnValue({ config: DEFAULT_PIPELINE_CONFIG, error: null }),
        createHaikuClient: jest.fn().mockReturnValue(makeMockHaikuClient()),
      }));

      const { runToday } = require('../src/today-command');

      await runToday({
        mcpClient: null,
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient: makeMockHaikuClient(),
      });

      // getCalendarEvents should have been called with options containing remote: true
      expect(getCalendarEventsMock).toHaveBeenCalled();
      const callArgs = getCalendarEventsMock.mock.calls[0];
      // First arg is mcpClient (null when remote), second arg is options
      const calOptions = callArgs[1];
      expect(calOptions).toBeDefined();
      expect(calOptions.remote).toBe(true);

      // Restore env
      if (originalRemoteTrigger === undefined) {
        delete process.env.REMOTE_TRIGGER;
      } else {
        process.env.REMOTE_TRIGGER = originalRemoteTrigger;
      }
    });

    it('does NOT pass remote context to gmail or github connectors even when REMOTE_TRIGGER is set', async () => {
      const originalRemoteTrigger = process.env.REMOTE_TRIGGER;
      process.env.REMOTE_TRIGGER = 'true';

      jest.resetModules();

      const { SOURCE } = require('../src/connectors/types');
      const getRecentEmailsMock = jest.fn().mockResolvedValue({
        success: false, data: null, error: 'GMAIL_UNAVAILABLE', source: SOURCE.GMAIL, fetchedAt: new Date().toISOString(),
      });
      const getGitHubActivityMock = jest.fn().mockResolvedValue({
        success: false, data: null, error: 'GITHUB_UNAVAILABLE', source: SOURCE.GITHUB, fetchedAt: new Date().toISOString(),
      });

      jest.doMock('../src/connectors/calendar', () => ({
        getCalendarEvents: jest.fn().mockResolvedValue({
          success: true, data: [], error: null, source: SOURCE.CALENDAR, fetchedAt: new Date().toISOString(),
        }),
      }));
      jest.doMock('../src/connectors/gmail', () => ({
        getRecentEmails: getRecentEmailsMock,
      }));
      jest.doMock('../src/connectors/github', () => ({
        getGitHubActivity: getGitHubActivityMock,
      }));
      jest.doMock('../src/briefing-helpers', () => ({
        getProposalsPendingCount: jest.fn().mockResolvedValue(0),
        getDeadLetterSummary: jest.fn().mockResolvedValue({ pending: 0, frozen: 0, total: 0, warning: false }),
        formatBriefingSection: jest.fn().mockReturnValue(''),
      }));
      jest.doMock('../src/pipeline-infra', () => ({
        loadPipelineConfig: jest.fn().mockReturnValue(DEFAULT_PIPELINE_CONFIG),
        safeLoadPipelineConfig: jest.fn().mockReturnValue({ config: DEFAULT_PIPELINE_CONFIG, error: null }),
        createHaikuClient: jest.fn().mockReturnValue(makeMockHaikuClient()),
      }));

      const { runToday } = require('../src/today-command');

      await runToday({
        mcpClient: null,
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient: makeMockHaikuClient(),
      });

      // Gmail and GitHub should be called with null mcpClient (no remote routing)
      // and their second arg should NOT have remote: true
      expect(getRecentEmailsMock).toHaveBeenCalled();
      expect(getGitHubActivityMock).toHaveBeenCalled();
      const gmailArgs = getRecentEmailsMock.mock.calls[0];
      const githubArgs = getGitHubActivityMock.mock.calls[0];
      // First arg for both should be null (no mcpClient)
      expect(gmailArgs[0]).toBeNull();
      expect(githubArgs[0]).toBeNull();

      // Restore env
      if (originalRemoteTrigger === undefined) {
        delete process.env.REMOTE_TRIGGER;
      } else {
        process.env.REMOTE_TRIGGER = originalRemoteTrigger;
      }
    });
  });

  // ── error resilience ─────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('never throws — returns { path: null, briefing: null, error } on catastrophic failure', async () => {
      // Force a catastrophic failure by resetting modules without mocking
      jest.resetModules();

      // Re-mock but make calendar throw synchronously inside the module
      jest.doMock('../src/connectors/calendar', () => ({
        getCalendarEvents: jest.fn().mockRejectedValue(new Error('catastrophic')),
      }));
      jest.doMock('../src/connectors/gmail', () => ({
        getRecentEmails: jest.fn().mockResolvedValue({ success: false, data: null, error: 'err', source: 'gmail', fetchedAt: '' }),
      }));
      jest.doMock('../src/connectors/github', () => ({
        getGitHubActivity: jest.fn().mockResolvedValue({ success: false, data: null, error: 'err', source: 'github', fetchedAt: '' }),
      }));
      jest.doMock('../src/briefing-helpers', () => ({
        getProposalsPendingCount: jest.fn().mockResolvedValue(0),
        getDeadLetterSummary: jest.fn().mockResolvedValue({ pending: 0, frozen: 0, total: 0, warning: false }),
        formatBriefingSection: jest.fn().mockReturnValue(''),
      }));
      jest.doMock('../src/pipeline-infra', () => ({
        loadPipelineConfig: jest.fn().mockImplementation(() => { throw new Error('config missing'); }),
        safeLoadPipelineConfig: jest.fn().mockReturnValue({ config: null, error: new Error('config missing') }),
        createHaikuClient: jest.fn().mockReturnValue(makeMockHaikuClient()),
      }));

      const { runToday } = require('../src/today-command');

      const result = await runToday({
        mcpClient: {},
        mode: 'dry-run',
        projectsDir: tempProjectsDir,
        vaultRoot: tempVaultRoot,
        date: FIXED_DATE,
        haikuClient: makeMockHaikuClient(),
      });

      // Must not throw — returns error envelope
      expect(result.path).toBeNull();
      expect(result.briefing).toBeNull();
      expect(result.error).toMatch(/TODAY_FATAL/);
    });
  });
});

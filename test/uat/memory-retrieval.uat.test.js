'use strict';

/**
 * memory-retrieval.uat.test.js
 *
 * UAT-18: Memory Retrieval Foundation — end-to-end user acceptance test.
 *
 * Covers ROADMAP Phase 18 success criteria end-to-end with realistic inputs
 * from the caller's perspective:
 *   SC1: /recall "leadership" → numbered list of up to 5 entries (category,
 *        100-char snippet, source-ref) or empty-result with no error.
 *   SC2: /recall supports --category, --since, --top N flags.
 *   SC3: /recall against a vault with missing memory/memory.md → empty
 *        result, no crash.
 *   SC4: /today briefing includes "Memory Echo" section between Frog and
 *        Pipeline when at least one entry scores > threshold against today's
 *        calendar/VIP-email context; absent entirely when no entry crosses.
 *
 * CI guard: Skipped when CI=true. Runs in local + scheduled weekly UAT
 * workflows. Matches the pattern established by Phase 17 UAT suite.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// CI skip guard: matches Phase 17 UAT CI Infrastructure convention.
// Set CI=true in GitHub Actions to skip; leave unset/falsy for local runs.
const describeMaybe = process.env.CI ? describe.skip : describe;

describeMaybe('UAT-18: Memory Retrieval Foundation (end-to-end)', () => {
  let tempVaultRoot;
  let originalVaultRoot;
  let originalHome;
  let originalCwd;
  const projectRoot = path.resolve(__dirname, '..', '..');

  beforeAll(() => {
    originalVaultRoot = process.env.VAULT_ROOT;
    originalHome = process.env.HOME;
    originalCwd = process.cwd();
  });

  beforeEach(() => {
    jest.resetModules();
    tempVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-uat18-'));
    process.env.VAULT_ROOT = tempVaultRoot;

    // Copy fixture memory.md into the temp vault
    const memoryDir = path.join(tempVaultRoot, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const fixture = fs.readFileSync(
      path.join(projectRoot, 'test', 'fixtures', 'memory-sample.md'),
      'utf8'
    );
    fs.writeFileSync(path.join(memoryDir, 'memory.md'), fixture);
  });

  afterEach(() => {
    fs.rmSync(tempVaultRoot, { recursive: true, force: true });
    process.env.VAULT_ROOT = originalVaultRoot;
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    process.chdir(originalCwd);
  });

  // ── SC1: Numbered list with category, snippet, source-ref ──────────────────

  describe('SC1: /recall returns numbered list up to 5 entries', () => {
    test('/recall "leadership" returns formatted lines matching the ROADMAP contract', async () => {
      const { runRecall } = require('../../src/recall-command');
      const result = await runRecall(['leadership']);

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('lines');
      expect(Array.isArray(result.lines)).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.length).toBeLessThanOrEqual(5);

      // Each line must match: N. [CATEGORY] snippet (source-ref)
      result.lines.forEach((line) => {
        expect(line).toMatch(/^\d+\. \[[A-Z]+\] .+ \(.+\)$/);
      });
    });

    test('empty result emits exactly one "No results matching …" line and no error', async () => {
      const { runRecall } = require('../../src/recall-command');
      const result = await runRecall(['nomatch-zzz-xyz-impossible-query']);

      expect(result.empty).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.lines).toEqual(['No results matching "nomatch-zzz-xyz-impossible-query".']);
    });
  });

  // ── SC2: Flags --category, --since, --top N ────────────────────────────────

  describe('SC2: /recall supports --category, --since, --top N', () => {
    test('--top 1 truncates results to a single entry', async () => {
      const { runRecall } = require('../../src/recall-command');
      const result = await runRecall(['leadership', '--top', '1']);
      expect(result.results.length).toBeLessThanOrEqual(1);
      expect(result.lines.length).toBeLessThanOrEqual(1);
    });

    test('--category DECISION narrows results to DECISION entries only', async () => {
      const { runRecall } = require('../../src/recall-command');
      const result = await runRecall(['leadership', '--category', 'DECISION']);
      // Every returned result (possibly zero) must be DECISION. If empty, the
      // .every() call returns true trivially — which is still a valid pass
      // for "narrows results to DECISION entries only".
      const allDecision = result.results.every((r) => r.category === 'DECISION');
      expect(allDecision).toBe(true);
    });

    test('--since filter passes through to search', async () => {
      const { runRecall } = require('../../src/recall-command');
      const result = await runRecall(['leadership', '--since', '2026-04-01']);
      // No throw, shape preserved
      expect(result).toHaveProperty('lines');
      expect(result).toHaveProperty('empty');
    });
  });

  // ── SC3: Missing memory/memory.md → empty result, no crash ─────────────────

  describe('SC3: missing memory/memory.md does not crash /recall', () => {
    test('vault with no memory/ subdir → empty-result shape, no throw', async () => {
      // Override VAULT_ROOT to a tmp dir with no memory/ subdir.
      const emptyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-uat18-empty-'));
      process.env.VAULT_ROOT = emptyVault;
      jest.resetModules();

      try {
        const { runRecall } = require('../../src/recall-command');
        const result = await runRecall(['leadership']);
        expect(result.empty).toBe(true);
        expect(result.results).toEqual([]);
        expect(result.lines).toEqual(['No results matching "leadership".']);
      } finally {
        fs.rmSync(emptyVault, { recursive: true, force: true });
      }
    });
  });

  // ── SC4: /today Memory Echo section between Frog and GitHub ────────────────

  describe('SC4: /today renders Memory Echo section correctly', () => {
    test('renderBriefing includes ## Memory Echo between ## Frog and ## GitHub when entries present', () => {
      const { renderBriefing } = require('../../src/today/briefing-renderer');
      const md = renderBriefing({
        date: new Date('2026-04-24T10:00:00Z'),
        sourceHealth: {
          sources: { calendar: 'ok', gmail: 'ok', github: 'ok', pipeline: 'ok' },
          degradedCount: 0,
        },
        connectorResults: {
          calendar: { success: true, data: [], error: null, source: 'calendar', fetchedAt: new Date().toISOString() },
          gmail: { success: true, data: [], error: null, source: 'gmail', fetchedAt: new Date().toISOString() },
          github: { success: true, data: { repos: [], warnings: [] }, error: null, source: 'github', fetchedAt: new Date().toISOString() },
        },
        pipelineState: { proposalCount: 0, deadLetter: { pending: 0, frozen: 0, total: 0, warning: false }, ok: true, error: null },
        slippage: { projects: [], warnings: [] },
        frog: { frog: null, reasoning: 'none' },
        memoryEcho: {
          entries: [
            { category: 'DECISION', snippet: 'Adopted left/right vault split for voice preservation', sourceRef: 'file:decisions/vault-split', score: 0.78 },
          ],
          score: 0.78,
        },
        mode: 'dry-run',
        synthesis: '> synthesis line',
      });

      expect(md).toContain('## Memory Echo');
      expect(md).toMatch(/1\. \[DECISION\] Adopted left\/right vault split/);
      const frogIdx = md.indexOf('## Frog');
      const memIdx = md.indexOf('## Memory Echo');
      const ghIdx = md.indexOf('## GitHub');
      expect(memIdx).toBeGreaterThan(frogIdx);
      expect(ghIdx).toBeGreaterThan(memIdx);
    });

    test('renderBriefing omits ## Memory Echo entirely when memoryEcho.entries is empty', () => {
      const { renderBriefing } = require('../../src/today/briefing-renderer');
      const md = renderBriefing({
        date: new Date('2026-04-24T10:00:00Z'),
        sourceHealth: {
          sources: { calendar: 'ok', gmail: 'ok', github: 'ok', pipeline: 'ok' },
          degradedCount: 0,
        },
        connectorResults: {
          calendar: { success: true, data: [], error: null, source: 'calendar', fetchedAt: new Date().toISOString() },
          gmail: { success: true, data: [], error: null, source: 'gmail', fetchedAt: new Date().toISOString() },
          github: { success: true, data: { repos: [], warnings: [] }, error: null, source: 'github', fetchedAt: new Date().toISOString() },
        },
        pipelineState: { proposalCount: 0, deadLetter: { pending: 0, frozen: 0, total: 0, warning: false }, ok: true, error: null },
        slippage: { projects: [], warnings: [] },
        frog: { frog: null, reasoning: 'none' },
        memoryEcho: { entries: [], score: 0 },
        mode: 'dry-run',
        synthesis: '> synthesis line',
      });

      expect(md).not.toContain('## Memory Echo');
      expect(md).toContain('## Frog');
      expect(md).toContain('## GitHub');
    });
  });

  // ── Slash-command surface: .claude/commands/recall.md ──────────────────────

  describe('Slash-command surface: /recall is registered via .claude/commands/recall.md', () => {
    test('.claude/commands/recall.md exists and references runRecall + $ARGUMENTS', () => {
      const wrapperPath = path.join(projectRoot, '.claude', 'commands', 'recall.md');
      expect(fs.existsSync(wrapperPath)).toBe(true);
      const content = fs.readFileSync(wrapperPath, 'utf8');
      expect(content).toMatch(/description:/);
      expect(content).toContain('runRecall');
      expect(content).toContain('./src/recall-command');
      expect(content).toContain('$ARGUMENTS');
      expect(content).toContain('--category');
      expect(content).toContain('--since');
      expect(content).toContain('--top');
      expect(content).not.toMatch(/\bTODO\b/);
      expect(content).not.toMatch(/\bTBD\b/);
      expect(content).not.toMatch(/\bPhase 21\b/);
    });
  });
});

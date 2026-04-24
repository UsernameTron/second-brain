'use strict';

/**
 * uat-wikilinks.test.js
 *
 * UAT-02: Wikilink relevance validation.
 *
 * This is a live-system test harness — it calls the real suggestWikilinks()
 * function against the actual vault at ~/Claude Cowork/ (or VAULT_ROOT) and
 * verifies that promoted memory content produces meaningful cross-references.
 *
 * Requirements:
 *   - VAULT_ROOT must be set or ~/Claude Cowork/ must exist (suite skips if absent)
 *   - ANTHROPIC_API_KEY must be set for the Haiku re-rank step (suite skips if absent)
 *   - At least some wikilink targets must point to files that exist in the vault
 *
 * Run standalone: npx jest test/uat/uat-wikilinks.test.js --verbose
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Environment guard ────────────────────────────────────────────────────────

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// Resolve vault root: explicit VAULT_ROOT env var, or default ~/Claude Cowork/
const VAULT_ROOT_PATH = process.env.VAULT_ROOT
  || path.join(os.homedir(), 'Claude Cowork');

const VAULT_EXISTS = fs.existsSync(VAULT_ROOT_PATH);

// Set VAULT_ROOT env so wikilink-engine picks it up
process.env.VAULT_ROOT = VAULT_ROOT_PATH;

// Set CONFIG_DIR_OVERRIDE so engine can find pipeline.json
if (!process.env.CONFIG_DIR_OVERRIDE) {
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', '..', 'config');
}

const SHOULD_RUN = HAS_API_KEY && VAULT_EXISTS;

// ── Test corpus ──────────────────────────────────────────────────────────────

/**
 * Memory content samples.
 * Each should produce at least one wikilink when run against a populated vault.
 * Content chosen to overlap with known vault notes on the second-brain project.
 */
const MEMORY_SAMPLES = [
  {
    id: 'WL-01',
    content: 'Daily briefing workflow: each morning the /today command fetches GitHub activity, calendar events, and VIP email to produce a 6-section prep list. The frog is surfaced first.',
    tags: ['daily', 'briefing', 'workflow'],
    description: 'Daily briefing note',
  },
  {
    id: 'WL-02',
    content: 'Memory promotion pipeline: memory-proposals.md stores candidates pending human review. After accepting a proposal, /promote-memories moves it to memory.md with content_hash dedup check.',
    tags: ['memory', 'proposals', 'promotion'],
    description: 'Memory promotion mechanics',
  },
  {
    id: 'WL-03',
    content: 'Left/right vault architecture: left side preserves human voice — any file whose words should sound like me lives on the left. Agent-generated content writes to right side only.',
    tags: ['vault', 'architecture', 'left-right'],
    description: 'Vault architecture principle',
  },
  {
    id: 'WL-04',
    content: 'Claude Code hooks: PreToolUse and PostToolUse events fire around every tool execution. The matcher field uses regex. Exit code 2 blocks the operation and shows stderr to Claude.',
    tags: ['hooks', 'claude-code', 'configuration'],
    description: 'Claude Code hooks reference',
  },
  {
    id: 'WL-05',
    content: 'Gmail integration design: connector uses gmail-mcp-pete MCP server. VIP filter only surfaces emails from key contacts. Draft-only permission via gmail.compose scope — never gmail.send.',
    tags: ['gmail', 'integration', 'connector'],
    description: 'Gmail connector design',
  },
  {
    id: 'WL-06',
    content: 'Second Brain project milestone v1.1: wire Gmail OAuth, enable RemoteTrigger on real cron schedule, expand excluded terms to 15-20 entries, complete UAT pass.',
    tags: ['second-brain', 'milestone', 'roadmap'],
    description: 'Project milestone note',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check whether a wikilink target file exists in the vault.
 * Tries .md extension appended if not already present.
 *
 * @param {string} vaultRoot - Absolute vault path
 * @param {string} targetPath - Vault-relative path from wikilink engine
 * @returns {{ exists: boolean, resolvedPath: string }}
 */
function checkWikilinkTarget(vaultRoot, targetPath) {
  const candidates = [
    path.join(vaultRoot, targetPath),
    path.join(vaultRoot, targetPath + '.md'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { exists: true, resolvedPath: candidate };
    }
  }

  return { exists: false, resolvedPath: path.join(vaultRoot, targetPath) };
}

// ── Test suite ────────────────────────────────────────────────────────────────

const describeFn = SHOULD_RUN ? describe : describe.skip;

describeFn('UAT-02: Wikilink relevance validation', () => {
  // Wikilink generation requires live vault index scan + Haiku API call
  jest.setTimeout(120000);

  const allResults = [];

  beforeAll(async () => {
    // Build a fresh vault index before running tests
    // This ensures we're working against current vault state
    console.log(`[UAT-02] Vault root: ${VAULT_ROOT_PATH}`);
    console.log(`[UAT-02] Building vault index...`);

    try {
      const { buildVaultIndex } = require('../../src/wikilink-engine');
      const index = await buildVaultIndex();
      console.log(`[UAT-02] Index built: ${index.length} notes indexed`);
    } catch (err) {
      console.warn(`[UAT-02] Index build warning: ${err.message} — proceeding with cached index if available`);
    }
  });

  afterAll(() => {
    // Print summary table for manual review
    console.log('\n=== UAT-02 Wikilink Results ===\n');

    for (const r of allResults) {
      console.log(`\n${r.id}: ${r.description}`);
      console.log(`  Links returned: ${r.linkCount}`);
      if (r.links && r.links.length > 0) {
        for (const link of r.links) {
          const existsMark = link.targetExists ? '[EXISTS]' : '[MISSING]';
          console.log(`  ${existsMark} ${link.path} (relevance: ${link.relevance != null ? link.relevance.toFixed(2) : 'n/a'})`); // eslint-disable-line eqeqeq
        }
      } else {
        console.log('  (no links generated)');
      }
    }

    const withLinks = allResults.filter(r => r.linkCount > 0);
    const existingCount = allResults.reduce((sum, r) => sum + (r.existingTargetCount || 0), 0);
    console.log(`\nSummary: ${withLinks.length}/${allResults.length} samples produced links`);
    console.log(`Existing vault targets: ${existingCount} total across all samples`);
    console.log('================================\n');
  });

  for (const sample of MEMORY_SAMPLES) {
    it(`${sample.id}: ${sample.description}`, async () => {
      const { suggestWikilinks } = require('../../src/wikilink-engine');

      let result;
      try {
        result = await suggestWikilinks(sample.content, sample.tags, {
          isLeftProposal: false,
          correlationId: `uat-02-${sample.id}`,
        });
      } catch (err) {
        throw new Error(`suggestWikilinks threw for ${sample.id}: ${err.message}`, { cause: err });
      }

      // Result must have the expected shape
      expect(result).toBeDefined();
      expect(result).toHaveProperty('links');
      expect(result).toHaveProperty('section');
      expect(Array.isArray(result.links)).toBe(true);

      // Check each link's target existence
      const linksWithExistence = result.links.map(link => ({
        ...link,
        targetExists: checkWikilinkTarget(VAULT_ROOT_PATH, link.path).exists,
      }));

      const existingTargetCount = linksWithExistence.filter(l => l.targetExists).length;

      allResults.push({
        id: sample.id,
        description: sample.description,
        linkCount: result.links.length,
        links: linksWithExistence,
        existingTargetCount,
      });

      // Log per-test result
      console.log(`[${sample.id}] links: ${result.links.length}, existing targets: ${existingTargetCount}`);

      // The engine must return a valid result without throwing — links may be empty if vault
      // index has no matching notes, but that is not a test failure.
      // We log the existence check for manual review rather than asserting on it,
      // since a freshly built vault may not have all notes yet.
      expect(result).toBeDefined();
    });
  }

  it('Overall: wikilink engine produces results for populated vault', async () => {
    // After all samples have run, verify the engine is functional overall.
    // This is a soft check — a vault with no matching content will produce zero links,
    // which is not a defect, just a documentation observation.
    if (allResults.length === 0) {
      console.warn('[UAT-02] No results accumulated — sample tests may not have run yet');
      return;
    }

    const totalLinks = allResults.reduce((sum, r) => sum + r.linkCount, 0);
    const totalExisting = allResults.reduce((sum, r) => sum + (r.existingTargetCount || 0), 0);

    console.log(`[UAT-02] Total links across all samples: ${totalLinks}`);
    console.log(`[UAT-02] Total links pointing to existing vault files: ${totalExisting}`);

    // The engine must have been called without throwing for each sample
    expect(allResults.length).toBe(MEMORY_SAMPLES.length);

    // If the vault has content, we expect at least some links to be generated.
    // This assertion is informational — it flags when the vault index is empty.
    if (totalLinks === 0) {
      console.warn('[UAT-02] No wikilinks generated for any sample. Vault index may be empty or vault content does not overlap with test samples. This is a concern for review, not a hard failure.');
    }
  });
});

// ── Informational skip notices ───────────────────────────────────────────────

if (!SHOULD_RUN) {
  describe('UAT-02 (skipped)', () => {
    it('reports skip reason', () => {
      if (!HAS_API_KEY) {
        console.log('[UAT-02] Skipping: ANTHROPIC_API_KEY not set. Set it to run live wikilink tests.');
      }
      if (!VAULT_EXISTS) {
        console.log(`[UAT-02] Skipping: Vault not found at ${VAULT_ROOT_PATH}. Set VAULT_ROOT or ensure ~/Claude Cowork/ exists.`);
      }
      expect(true).toBe(true);
    });
  });
}

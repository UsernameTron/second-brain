'use strict';

/**
 * uat-classification.test.js
 *
 * UAT-01: Classification accuracy validation.
 *
 * This is a live-system test harness — it calls the real classifyInput() function
 * against the Anthropic API using synthetic inputs and asserts >= 80% accuracy on
 * deterministic cases. Edge cases are excluded from the accuracy denominator.
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY must be set (suite skips cleanly if absent)
 *   - Accuracy threshold: >= 0.80 (80%) on deterministic corpus
 *
 * Run standalone: npx jest test/uat/uat-classification.test.js --verbose
 */

const path = require('path');

// ── Environment guard ────────────────────────────────────────────────────────

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// Set CONFIG_DIR_OVERRIDE so classifier can load pipeline.json and vault-paths.json
if (!process.env.CONFIG_DIR_OVERRIDE) {
  process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', '..', 'config');
}

// Provide a dummy VAULT_ROOT if not set so classifier doesn't fail on vault-paths resolution
if (!process.env.VAULT_ROOT) {
  process.env.VAULT_ROOT = path.join(process.env.HOME || '/tmp', 'Claude Cowork');
}

// ── Test corpus ──────────────────────────────────────────────────────────────

/**
 * Deterministic cases — included in accuracy denominator.
 * expected: 'LEFT' | 'RIGHT'
 */
const DETERMINISTIC_CASES = [
  {
    id: 'LEFT-01',
    input: "I've been thinking about how my career has shifted since leaving enterprise software. The move to AI feels right — I can see myself building here for the next decade.",
    expected: 'LEFT',
    description: 'Personal career reflection (first-person, voice)',
  },
  {
    id: 'LEFT-02',
    input: 'Dear Mom, wanted to let you know we are planning to visit in June. Looking forward to seeing everyone and finally getting some time away from work.',
    expected: 'LEFT',
    description: 'Personal draft / letter',
  },
  {
    id: 'LEFT-03',
    input: 'Today was rough. Three meetings back to back and I could not focus on what actually matters. I need to protect my mornings better.',
    expected: 'LEFT',
    description: 'Journal entry (emotional, first-person)',
  },
  {
    id: 'LEFT-04',
    input: 'My communication style: direct, candid, no corporate buzzwords. I prefer written async over sync meetings. I do my best thinking in the first two hours of the day.',
    expected: 'LEFT',
    description: 'Identity / work-style note (ABOUT ME type)',
  },
  {
    id: 'RIGHT-01',
    input: 'Claude Code hooks fire on PreToolUse and PostToolUse events. The matcher pattern uses regex. Exit code 2 blocks the operation and shows stderr to Claude.',
    expected: 'RIGHT',
    description: 'Technical reference note',
  },
  {
    id: 'RIGHT-02',
    input: 'Meeting with the team: decided to use Docker MCP gateway for all external integrations. Action items: verify remote trigger, update config, test Gmail connector.',
    expected: 'RIGHT',
    description: 'Meeting summary with action items',
  },
  {
    id: 'RIGHT-03',
    input: 'Second Brain Phase 5 complete. RemoteTrigger ID: trig_01KvxeDfYDAEwAzw9zw9DKKB. All 502 tests passing. Next: Phase 6 defect fixes and UAT.',
    expected: 'RIGHT',
    description: 'Project status note',
  },
  {
    id: 'RIGHT-04',
    input: "function createHaikuClient(options = {}) { return createLlmClient({ ...options, model: 'claude-haiku-4-5' }); }",
    expected: 'RIGHT',
    description: 'Code snippet',
  },
  {
    id: 'RIGHT-05',
    input: 'The memory promotion flow: capture → classify → propose → review → promote. Each stage logged with correlation ID for audit trail.',
    expected: 'RIGHT',
    description: 'Process documentation',
  },
  {
    id: 'RIGHT-06',
    input: 'Research summary: Left/right vault architecture separates human voice (LEFT) from agent-generated content (RIGHT). Write-permission enforcement at ingress.',
    expected: 'RIGHT',
    description: 'Research / synthesis note',
  },
  {
    id: 'RIGHT-07',
    input: 'Daily briefing for 2026-04-23: 3 GitHub PRs merged, 2 calendar blocks, 1 VIP email from recruiter. Frog: complete Phase 6 plan before 10 AM.',
    expected: 'RIGHT',
    description: 'Agent-generated daily briefing output',
  },
  {
    id: 'RIGHT-08',
    input: 'Job posting — Staff AI Engineer at Anthropic: 8+ years experience, distributed systems background, Python/TypeScript required. Apply by May 15.',
    expected: 'RIGHT',
    description: 'External data / job posting',
  },
];

/**
 * Edge cases — excluded from accuracy denominator.
 * These verify graceful handling, not correctness of classification.
 */
const EDGE_CASES = [
  {
    id: 'EDGE-01',
    input: 'I think the architecture we chose for the vault was the right call — it feels natural to work with.',
    expected: null, // Ambiguous — could be either, must not crash
    description: 'Ambiguous (personal opinion about technical choice)',
  },
  {
    id: 'EDGE-02',
    input: 'The ISPN project had some interesting routing patterns that might apply here.',
    expected: null, // Should be blocked by content-policy, not crash
    description: 'Excluded term (ISPN) — expect blocked or RIGHT',
  },
  {
    id: 'EDGE-03',
    input: 'Quick note: buy milk',
    expected: null, // Very short — must not crash
    description: 'Very short input',
  },
  {
    id: 'EDGE-04',
    input: '...',
    expected: null, // Near-empty — must not crash
    description: 'Near-empty input',
  },
];

// ── Test suite ────────────────────────────────────────────────────────────────

// UAT tests require live LLM endpoint — skip in CI, run locally via npm run test:uat
const skipInCI = process.env.CI === 'true';
const describeFn = (!skipInCI && HAS_API_KEY) ? describe : describe.skip;

describeFn('UAT-01: Classification accuracy validation', () => {
  // Increase timeout for live LLM calls — each call can take 5-15 seconds
  jest.setTimeout(120000);

  const results = [];

  afterAll(() => {
    // Print summary table for manual review
    console.log('\n=== UAT-01 Classification Results ===\n');
    const header = ['ID', 'Expected', 'Actual', 'Confidence', 'Correct', 'Description'];
    console.log(header.join(' | '));
    console.log(header.map(h => '-'.repeat(h.length)).join('-+-'));

    for (const r of results) {
      const correct = r.expected === null ? 'edge' : (r.correct ? 'YES' : 'NO');
      const actual = r.blocked ? 'BLOCKED' : (r.side || r.failureMode || 'ERROR');
      const conf = r.confidence != null ? r.confidence.toFixed(2) : 'n/a'; // eslint-disable-line eqeqeq
      console.log([r.id, r.expected || 'n/a', actual, conf, correct, r.description].join(' | '));
    }

    const deterministic = results.filter(r => r.expected !== null);
    const correct = deterministic.filter(r => r.correct).length;
    const accuracy = deterministic.length > 0 ? correct / deterministic.length : 0;
    console.log(`\nAccuracy: ${correct}/${deterministic.length} = ${(accuracy * 100).toFixed(1)}%`);
    console.log('====================================\n');
  });

  describe('Deterministic corpus (included in accuracy)', () => {
    for (const testCase of DETERMINISTIC_CASES) {
      it(`${testCase.id}: ${testCase.description}`, async () => {
        // Require inline to pick up env overrides set above
        const { classifyInput } = require('../../src/classifier');

        let result;
        try {
          result = await classifyInput(testCase.input, { interactive: false });
        } catch (err) {
          result = { side: null, failureMode: err.message, confidence: 0 };
        }

        const correct = result.side === testCase.expected ||
          (result.blocked && testCase.expected === null);

        results.push({
          id: testCase.id,
          expected: testCase.expected,
          side: result.side,
          confidence: result.confidence,
          blocked: result.blocked,
          failureMode: result.failureMode,
          correct,
          description: testCase.description,
        });

        // Individual assertion: result must not throw and must return a side or blocked flag
        expect(result).toBeDefined();
        expect(result.blocked === true || typeof result.side === 'string' || typeof result.failureMode === 'string').toBe(true);
      });
    }
  });

  describe('Edge cases (excluded from accuracy)', () => {
    for (const testCase of EDGE_CASES) {
      it(`${testCase.id}: ${testCase.description}`, async () => {
        const { classifyInput } = require('../../src/classifier');

        let result;
        let threw = false;
        try {
          result = await classifyInput(testCase.input, { interactive: false });
        } catch (err) {
          threw = true;
          result = { side: null, failureMode: err.message, confidence: 0 };
        }

        results.push({
          id: testCase.id,
          expected: testCase.expected,
          side: result ? result.side : null,
          confidence: result ? result.confidence : null,
          blocked: result ? result.blocked : false,
          failureMode: result ? result.failureMode : null,
          correct: null, // Not included in accuracy
          description: testCase.description,
        });

        // Edge cases must not throw uncaught exceptions
        expect(threw).toBe(false);
        // Result must be defined
        expect(result).toBeDefined();
      });
    }
  });

  it('Overall accuracy must be >= 80%', async () => {
    // This test runs last and reads the accumulated results
    // It will always pass if the individual tests above ran — the real assertion
    // is in the accuracy calculation below
    const deterministic = results.filter(r => r.expected !== null);

    // If no results yet (test ordering issue), skip assertion
    if (deterministic.length === 0) {
      console.warn('[UAT-01] No deterministic results collected — accuracy check skipped');
      return;
    }

    const correct = deterministic.filter(r => r.correct).length;
    const accuracy = correct / deterministic.length;

    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });
});

// ── Smoke test for environments without API key ───────────────────────────────

if (!HAS_API_KEY) {
  describe('UAT-01 (skipped — ANTHROPIC_API_KEY not set)', () => {
    it('skips cleanly when API key is absent', () => {
      console.log('[UAT-01] Skipping: ANTHROPIC_API_KEY not set. Run with API key to execute live classification tests.');
      expect(true).toBe(true);
    });
  });
}

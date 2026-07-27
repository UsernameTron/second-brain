'use strict';

/**
 * today-command.js — /today orchestrator.
 *
 * Thin shell after Phase 15 refactor (B-07). Composes four extracted modules
 * from src/today/: slippage-scanner, frog-identifier, llm-augmentation,
 * briefing-renderer. Keeps here: config load, connector fan-out, pipeline
 * state fetch, vault write, terminal echo.
 *
 * Per Phase 4 CONTEXT: D-01 (allSettled fan-out), D-02 (dual-surface output),
 * D-05 (dry-run scratch path), D-19 (inline error envelope).
 *
 * @module today-command
 */

const fs = require('fs');
const path = require('path');

const { getCalendarEvents } = require('./connectors/calendar');
const { getRecentEmails } = require('./connectors/gmail');
const { getGitHubActivity } = require('./connectors/github');
const {
  getProposalsPendingCount,
  getDeadLetterSummary,
} = require('./briefing-helpers');
const { safeLoadPipelineConfig, createHaikuClient } = require('./pipeline-infra');

const { scanSlippage } = require('./today/slippage-scanner');
const { identifyFrog } = require('./today/frog-identifier');
const { generateSynthesis } = require('./today/llm-augmentation');
const { renderBriefing, buildSourceHealth, formatDateYMD } = require('./today/briefing-renderer');
const { getMemoryEcho } = require('./memory-reader');
const { vaultWrite, VAULT_ROOT: GATEWAY_VAULT_ROOT } = require('./vault-gateway');

// ── Constants ────────────────────────────────────────────────────────────────

// Use env overrides first so both local and remote environments can override via env var.
// Per FIX-05: no hardcoded /Users/cpconnor assumptions.
// PROJECTS_DIR env var allows remote trigger to point at an alternate projects directory
// or skip slippage scanning when ~/projects/ is unavailable (scanner degrades gracefully anyway).
// VAULT_ROOT follows the same pattern used by briefing-helpers.js and pipeline-infra.js.
const DEFAULT_PROJECTS_DIR = process.env.PROJECTS_DIR
  || path.join(process.env.HOME, 'projects');
const DEFAULT_VAULT_ROOT = process.env.VAULT_ROOT
  || path.join(process.env.HOME, 'Claude Cowork');

// ── Parallel data gathering ──────────────────────────────────────────────────

/**
 * Wrap an async connector call, measuring elapsed ms into the latencies accumulator.
 * Parallelism is preserved — each connector is still awaited via allSettled.
 * The measured ms is written even when the connector returns degraded/null.
 *
 * Phase 20 (STATS-LATENCY-01): per-connector timing contract for PLAN-04.
 *
 * @param {string} label - key written into latencies (e.g. 'calendar')
 * @param {object} latencies - accumulator object mutated in place
 * @param {function} fn - zero-arg async factory returning the connector result
 * @returns {Promise<any>} the result of fn() (re-throws on connector failure)
 */
async function _timedCall(label, latencies, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    latencies[label] = Date.now() - start;
    return result;
  } catch (err) {
    latencies[label] = Date.now() - start;
    throw err;
  }
}

/**
 * Fan out to the three external connectors in parallel via allSettled (D-01).
 * Per FIX-03, when REMOTE_TRIGGER=true and mcpClient is null, calendar runs
 * against the RemoteTrigger-attached MCP; gmail/github degrade gracefully.
 *
 * Phase 20 (STATS-LATENCY-01): populates latencies.calendar, latencies.gmail,
 * latencies.github with elapsed ms per connector. Any connector that returns
 * degraded/null still contributes its measured ms.
 *
 * @param {object|null} mcpClient
 * @param {object} latencies - accumulator object mutated in place by _timedCall
 * @returns {Promise<{ calendar: object, gmail: object, github: object }>}
 */
async function _fanOut(mcpClient, latencies) {
  const isRemoteTrigger = process.env.REMOTE_TRIGGER === 'true';

  // Calendar gets remote context when running in RemoteTrigger and no local mcpClient
  const calendarOptions = (isRemoteTrigger && !mcpClient)
    ? { remote: true }
    : undefined;

  const [calSettled, gmailSettled, githubSettled] = await Promise.allSettled([
    _timedCall('calendar', latencies, () =>
      calendarOptions
        ? getCalendarEvents(null, calendarOptions)
        : getCalendarEvents(mcpClient)
    ),
    _timedCall('gmail', latencies, () => getRecentEmails(mcpClient, { vipOnly: true })),
    _timedCall('github', latencies, () => getGitHubActivity(mcpClient)),
  ]);

  function _unwrap(settled, source) {
    if (settled.status === 'fulfilled') return settled.value;
    // Should not happen given no-throw contract, but defensive
    return {
      success: false,
      data: null,
      error: `MCP_ERROR: ${String(settled.reason)}`,
      source,
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    calendar: _unwrap(calSettled, 'calendar'),
    gmail: _unwrap(gmailSettled, 'gmail'),
    github: _unwrap(githubSettled, 'github'),
  };
}

/**
 * Fetch pipeline state from briefing-helpers (proposals + dead-letter).
 * Wrapped in try/catch — on failure returns empty/safe defaults so the
 * briefing continues with a degraded Pipeline section.
 *
 * @returns {Promise<{ proposalCount: number, deadLetter: object, ok: boolean }>}
 */
async function _getPipelineState() {
  try {
    const [proposalCount, deadLetter] = await Promise.all([
      getProposalsPendingCount(),
      getDeadLetterSummary(),
    ]);
    return { proposalCount, deadLetter, ok: true };
  } catch (err) {
    return {
      proposalCount: 0,
      deadLetter: { pending: 0, frozen: 0, total: 0, warning: false },
      ok: false,
      error: `PIPELINE_ERROR: ${err.message}`,
    };
  }
}

// ── Quarantine stub ──────────────────────────────────────────────────────────

/**
 * Render the placeholder briefing written when the gateway quarantines the real
 * body (Guard 2 over-threshold contamination, or a Guard 3 style violation).
 *
 * The text is fixed and deliberately free of both excluded terms and banned
 * style words, so the retry write always clears Guards 2 and 3 — otherwise the
 * fallback could quarantine in turn and the morning would end with no file at
 * all. `test/today-command.gateway.test.js` pins that property.
 *
 * @param {string} dateStr - YYYY-MM-DD stamp for the briefing
 * @param {string} quarantinePath - Vault-relative path of the metadata-only record
 * @returns {string} Stub briefing markdown
 */
function renderQuarantineStub(dateStr, quarantinePath) {
  return `---
date: ${dateStr}
status: quarantined
---

# Daily Briefing — ${dateStr}

The briefing was rendered but did not clear the vault content and style gates,
so the body was withheld from this file.

The gateway wrote a metadata-only record at \`${quarantinePath}\`. That record
names the reason. No blocked text reached disk.

Re-run the briefing once the upstream source material is cleaned up:

\`\`\`bash
node scripts/today-scheduled.js --dry-run
\`\`\`
`;
}

// ── runToday ─────────────────────────────────────────────────────────────────

/**
 * Orchestrate the full /today briefing pipeline: load config, fan out to
 * connectors in parallel, scan slippage, identify the frog, fetch Memory Echo,
 * synthesize narrative, render the briefing, write to the daily note, and
 * record daily stats. Catches all errors into a `TODAY_FATAL` envelope.
 * @param {Object} [options] - Overrides for orchestration inputs.
 * @param {Object|null} [options.mcpClient=null] - Pre-built MCP client; null
 *   selects dry-run / RemoteTrigger paths in connectors.
 * @param {('interactive'|'scheduled'|'dry-run')} [options.mode='interactive'] -
 *   Output mode; `dry-run` writes a `_dry-run-…md` file and skips stats.
 * @param {string} [options.projectsDir] - Override for projects root scanned
 *   by slippage; defaults to `$PROJECTS_DIR` or `~/projects`.
 * @param {string} [options.vaultRoot] - Override for vault root; defaults to
 *   `$VAULT_ROOT` or `~/Claude Cowork`.
 * @param {Date} [options.date] - Date stamp used for filename + window math.
 * @param {Object} [options.haikuClient] - Test override for the Haiku client.
 * @returns {Promise<{ path: string|null, briefing: string|null, sourceHealth?: Object, quarantined?: boolean, quarantinePath?: string, error?: string, _phase20?: {latencies: Object, avgLatencyMs: number|null} }>} Briefing result envelope. `briefing` is the stub, and `quarantined` is true, when the gateway blocked the real body.
 */
async function runToday(options = {}) {
  // Phase 20 (STATS-LATENCY-01): per-operation latency accumulator.
  // Populated by _fanOut (calendar/gmail/github), getMemoryEcho timing below,
  // and endToEnd at return time. PLAN-04 reads _phase20.avgLatencyMs from the
  // return value — this function does NOT call recordDailyStats itself.
  const latencies = {};
  const t0 = Date.now();

  try {
    // ── Defaults ──────────────────────────────────────────────────────────
    const mode = options.mode || 'interactive';
    const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
    const vaultRoot = options.vaultRoot || DEFAULT_VAULT_ROOT;
    const date = options.date || new Date();
    const mcpClient = options.mcpClient || null;

    // The gateway resolves vault writes against its own module-scope VAULT_ROOT,
    // captured at require time. A caller passing a different vaultRoot would get
    // the briefing written into the gateway's vault while stats and memory came
    // from theirs — so a dry run aimed at a scratch vault would write into the
    // operator's live one and report a path outside the root it asked for.
    // The gateway owns exactly one root by design; that single-root invariant is
    // what makes the allowlist mean anything, so a mismatch is a caller bug to
    // surface rather than paper over.
    if (path.resolve(vaultRoot) !== path.resolve(GATEWAY_VAULT_ROOT)) {
      return {
        path: null,
        briefing: null,
        error: `TODAY_FATAL: vaultRoot '${vaultRoot}' conflicts with the vault-gateway root '${GATEWAY_VAULT_ROOT}' — set VAULT_ROOT before today-command is required`,
      };
    }

    // ── Load config ───────────────────────────────────────────────────────
    const { config, error: configErr } = safeLoadPipelineConfig();
    if (configErr) {
      process.stderr.write(`[today] WARNING: config load failed: ${configErr.message} — rendering static briefing only\n`);
    }

    // ── LLM client ────────────────────────────────────────────────────────
    const haikuClient = options.haikuClient || createHaikuClient();

    // ── Parallel data gathering ───────────────────────────────────────────
    // Run fan-out (connectors) and pipeline state in parallel.
    // latencies is passed to _fanOut so per-connector ms are written as they complete.
    const [fanOutResult, pipelineResult] = await Promise.allSettled([
      _fanOut(mcpClient, latencies),
      _getPipelineState(),
    ]);

    const connectorResults = fanOutResult.status === 'fulfilled'
      ? fanOutResult.value
      : {
          calendar: { success: false, data: null, error: 'MCP_ERROR: fan-out failed', source: 'calendar', fetchedAt: new Date().toISOString() },
          gmail: { success: false, data: null, error: 'MCP_ERROR: fan-out failed', source: 'gmail', fetchedAt: new Date().toISOString() },
          github: { success: false, data: null, error: 'MCP_ERROR: fan-out failed', source: 'github', fetchedAt: new Date().toISOString() },
        };

    const pipelineState = pipelineResult.status === 'fulfilled'
      ? pipelineResult.value
      : { proposalCount: 0, deadLetter: { pending: 0, frozen: 0, total: 0, warning: false }, ok: false, error: 'PIPELINE_ERROR: state unavailable' };

    // ── Slippage scan (sync) ──────────────────────────────────────────────
    // Preserve pre-refactor behavior: when config is null, slippage is an
    // empty array sentinel, which triggers the catch block downstream in
    // identifyFrog and routes to the TODAY_FATAL envelope (tested in the
    // "error resilience" suite).
    const slippage = config ? scanSlippage(projectsDir, config, date) : [];

    // ── Frog identification (D-15) ────────────────────────────────────────
    const frogData = await identifyFrog(slippage, haikuClient);

    // ── Memory Echo (Phase 18, TODAY-ECHO-01) ─────────────────────────────
    // Pull memory entries that score above the configured threshold against
    // today's calendar + VIP email signals. Failures never break the briefing.
    // Phase 20: timing measured end-to-end around getMemoryEcho (includes any
    // transitive semanticSearch cost — Echo path encapsulates it).
    const echoThreshold = (config && config.memory && typeof config.memory.echoThreshold === 'number')
      ? config.memory.echoThreshold
      : 0.65;
    let memoryEcho;
    const memEchoStart = Date.now();
    try {
      memoryEcho = await getMemoryEcho(connectorResults, { threshold: echoThreshold });
    } catch (_err) {
      memoryEcho = { entries: [], score: 0, skipped: true };
    }
    latencies.memoryEcho = Date.now() - memEchoStart;

    // STATS-OUTCOME-02: record whether Memory Echo was shown and its top score.
    // Skip in dry-run so practice runs don't pollute the day's counters. Non-fatal.
    if (mode !== 'dry-run') {
      try {
        const { recordEchoShown } = require('./daily-stats');
        recordEchoShown(memoryEcho.entries.length > 0, memoryEcho.score);
      } catch (_) { /* briefing-is-the-product */ }
    }

    // ── Memory Health (Phase 24, AGENT-MEMORY-01) ────────────────────────
    // Anomaly detection from daily-stats rows. Non-fatal — briefing is the product.
    // All requires are lazy (inside function body) per Pattern 12.
    let memoryHealth = null;
    try {
      if (config && config.memoryHealth && config.memoryHealth.enabled !== false) {
        const { computeMemoryHealth } = require('./today/memory-health');
        const { readDailyStats } = require('./daily-stats');
        const statsAbsPath = path.join(vaultRoot, (config.stats && config.stats.path) || 'briefings/daily-stats.md');
        const { rows } = readDailyStats(statsAbsPath);
        memoryHealth = computeMemoryHealth(rows, config.memoryHealth);
      }
    } catch (_) { /* non-fatal — briefing-is-the-product */ }

    // ── Compounding trend (Phase 31, TREND-02) ───────────────────────────
    // Pure verdict from daily-stats rows. Suppressed under 7 rows (insufficient-data),
    // matching the Memory Echo / Memory Health null-suppression precedent.
    // Non-fatal — briefing-is-the-product. Lazy requires per Pattern 12.
    let compoundingBody = null;
    try {
      if (config && config.stats && config.stats.enabled) {
        const { computeCompoundingTrend, renderCompoundingReport } = require('./today/compounding-trend');
        const { readDailyStats } = require('./daily-stats');
        const statsAbsPath = path.join(vaultRoot, (config.stats && config.stats.path) || 'briefings/daily-stats.md');
        const { rows } = readDailyStats(statsAbsPath);
        const trend = computeCompoundingTrend(rows, { windowDays: 14 });
        if (trend.verdict !== 'insufficient-data') {
          compoundingBody = renderCompoundingReport(trend);
        }
      }
    } catch (_) { /* non-fatal — briefing-is-the-product */ }

    // ── Sweep status (Phase 33, CAP-EVIDENCE-01) ──────────────────────────
    // Proof-of-fire line for the nightly capture engine. Always a non-empty string
    // (fail-open to NEVER RAN). Non-fatal — briefing-is-the-product.
    let sweepLine = 'sweep NEVER RAN';
    try { sweepLine = require('./today/sweep-status').computeSweepLine(); } catch (_) { /* fail-open */ }

    // ── Source health (D-08) ──────────────────────────────────────────────
    const sourceHealth = buildSourceHealth(connectorResults, pipelineState.ok);

    // ── Synthesis (D-04, D-11) ────────────────────────────────────────────
    const synthesis = await generateSynthesis(
      {
        connectorResults,
        pipelineState,
        slippage,
        frog: frogData,
        degradedCount: sourceHealth.degradedCount,
      },
      haikuClient
    );

    // ── Render briefing (D-09) ────────────────────────────────────────────
    const briefing = renderBriefing({
      date,
      sourceHealth,
      connectorResults,
      pipelineState,
      slippage,
      frog: frogData,
      memoryEcho,
      memoryHealth,
      compounding: compoundingBody,
      sweep: sweepLine,
      mode,
      synthesis,
    });

    // ── Determine output path (D-02, D-05) ────────────────────────────────
    const dateStr = formatDateYMD(date);
    const filename = mode === 'dry-run'
      ? `_dry-run-${dateStr}.md`
      : `${dateStr}.md`;
    const relativePath = `briefings/daily/${filename}`;
    // The gateway owns the vault root for vault writes, so the reported path is
    // derived from it rather than from options.vaultRoot — that is what keeps
    // result.path pointing at the file that actually got written.
    const outputPath = path.join(GATEWAY_VAULT_ROOT, relativePath);

    // ── Write daily note through the vault gateway ────────────────────────
    // The briefing body is LLM-synthesized from external connector data (Gmail,
    // Calendar, GitHub) and is the highest-frequency write in the system, so it
    // runs the same content and style gates as every other vault write.
    //
    // Failure policy — briefing-is-the-product, but never a silent bypass:
    //   - Content, at most half the paragraphs contaminated: the gateway
    //     redacts those paragraphs and writes. The briefing still renders and
    //     excluded content never lands. This is the common degraded case.
    //   - Content over that threshold, or a style violation: the gateway
    //     quarantines (metadata only, no body on disk) and we write a stub in
    //     its place, so the morning still has a file that says what happened
    //     and where the record is.
    //   - attemptCount: 1 so Guard 3 quarantines rather than throwing
    //     STYLE_VIOLATION. /today has no regenerate loop to satisfy a REJECT,
    //     and an uncaught throw here degrades to TODAY_FATAL — no briefing at
    //     all over one banned word. Same reasoning as writeDeadLetter in
    //     pipeline-infra.js.
    let written = briefing;
    let quarantinePath = null;

    const writeResult = await vaultWrite(relativePath, briefing, { attemptCount: 1 });
    if (writeResult.decision === 'QUARANTINED') {
      quarantinePath = writeResult.quarantinePath;
      written = renderQuarantineStub(dateStr, quarantinePath);

      // The stub is fixed text chosen to clear both guards, but the style guide
      // hot-reloads from the vault — a banned word added to it later could match
      // the stub and quarantine this write too. A test pins today's wording; it
      // cannot pin a file the operator edits. If the fallback is also refused,
      // nothing reached briefings/daily/, so report that instead of returning a
      // path to a file that does not exist.
      const stubResult = await vaultWrite(relativePath, written, { attemptCount: 1 });
      if (stubResult.decision === 'QUARANTINED') {
        process.stderr.write(
          `[today] ERROR: briefing body AND fallback stub both quarantined — no briefing written (records: ${quarantinePath}, ${stubResult.quarantinePath})\n`
        );
        return {
          path: null,
          briefing: null,
          quarantined: true,
          quarantinePath: stubResult.quarantinePath,
          error: 'TODAY_FATAL: briefing body and fallback stub both quarantined by vault policy',
        };
      }

      process.stderr.write(
        `[today] WARNING: briefing body quarantined by vault policy — stub written to ${relativePath}, record at ${quarantinePath}\n`
      );
    }

    // ── Interactive: echo to stdout ───────────────────────────────────────
    // Echo what reached the vault, not the pre-gate body, so the terminal and
    // the daily note never disagree about what today's briefing says.
    if (mode === 'interactive') {
      // eslint-disable-next-line no-console -- user-facing-output: Interactive mode emits the day briefing — the visible product of /today
      console.log(written);
    }

    // ── Phase 20: compute end-to-end + mean latency ───────────────────────
    // endToEnd covers t0 → here (after briefing render, before vault write timing).
    // Mean includes all measured fields; undefined/non-numeric values are skipped.
    // avgLatencyMs is what PLAN-04 passes to recordDailyStats.
    latencies.endToEnd = Date.now() - t0;
    const measured = Object.values(latencies).filter(v => typeof v === 'number');
    const avgLatencyMs = measured.length > 0
      ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length)
      : null;

    // ── Phase 20: Record daily stats (briefing-is-the-product, D-06) ──────
    // Briefing is already written above. Stats failure NEVER breaks the briefing.
    // Skip in dry-run mode to avoid polluting daily-stats.md with practice runs.
    if (mode !== 'dry-run') {
      try {
        const { recordDailyStats, readDailyCounters, flushMissedDays } = require('./daily-stats');
        const { readMemory } = require('./memory-reader');

        // Aggregate inputs — each sub-fetch in its own try/catch with safe defaults.
        let counters = { proposals: 0, promotions: 0, recallCount: 0, recallHits: 0, echoShown: 0, echoScore: 0, avgConfidence: null };
        try { counters = readDailyCounters(); } catch (_) { /* defaults retained */ }

        let memoryKb = 0;
        try {
          // memory.md lives at <VAULT_ROOT>/memory/memory.md (Phase 18 convention).
          const memoryPath = path.join(vaultRoot, 'memory', 'memory.md');
          if (fs.existsSync(memoryPath)) {
            memoryKb = Math.round((fs.statSync(memoryPath).size / 1024) * 10) / 10;
          }
        } catch (_) { /* memoryKb stays 0 */ }

        let totalEntries = 0;
        try {
          const entries = await readMemory();
          totalEntries = Array.isArray(entries) ? entries.length : 0;
        } catch (_) { /* totalEntries stays 0 */ }

        // Phase 29 (STATS-PIPE-02): flush any past days whose counters never became a row,
        // then prune counter files >14 days old. Non-fatal — briefing already written.
        try {
          flushMissedDays({ totalEntries, memoryKb });
        } catch (_) { /* non-fatal */ }

        recordDailyStats({
          proposals: counters.proposals,
          promotions: counters.promotions,
          totalEntries,
          memoryKb,
          recallCount: counters.recallCount,
          avgLatencyMs,
          avgConfidence: counters.avgConfidence,
          recallHits: counters.recallHits,
          echoShown: counters.echoShown,
          echoScore: counters.echoScore,
        });
      } catch (_) {
        // Briefing already written; stats failure is non-fatal.
        // Per CLAUDE.md ESLint config: no console.* in production. Silent catch.
      }
    }

    return {
      path: outputPath,
      briefing: written,
      sourceHealth,
      // Surfaced so callers can tell a stub from a real briefing (D-19).
      ...(quarantinePath ? { quarantined: true, quarantinePath } : {}),
      _phase20: { latencies, avgLatencyMs },
    };

  } catch (err) {
    // Catastrophic failure — return error envelope rather than throw
    return {
      path: null,
      briefing: null,
      error: `TODAY_FATAL: ${err.message}`,
    };
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runToday };

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

// ── runToday ─────────────────────────────────────────────────────────────────

/**
 * Orchestrate the full /today briefing pipeline.
 *
 * Options: mcpClient (null for dry-run/test), mode ('interactive'|'scheduled'
 * |'dry-run'), projectsDir, vaultRoot, date, haikuClient — all overridable
 * for testing.
 *
 * @returns {Promise<{ path: string|null, briefing: string|null, sourceHealth?: object, error?: string }>}
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
      mode,
      synthesis,
    });

    // ── Determine output path (D-02, D-05) ────────────────────────────────
    const dateStr = formatDateYMD(date);
    const filename = mode === 'dry-run'
      ? `_dry-run-${dateStr}.md`
      : `${dateStr}.md`;
    const outputPath = path.join(vaultRoot, 'RIGHT', 'daily', filename);

    // ── Write daily note ──────────────────────────────────────────────────
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, briefing, 'utf8');

    // ── Interactive: echo to stdout ───────────────────────────────────────
    if (mode === 'interactive') {
      console.log(briefing);
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

    return { path: outputPath, briefing, sourceHealth, _phase20: { latencies, avgLatencyMs } };

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

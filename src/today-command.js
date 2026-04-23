'use strict';

/**
 * today-command.js
 *
 * The /today command module — capstone of the second-brain project.
 * Fans out to all data sources (calendar, gmail, github, pipeline),
 * scans cross-project STATE.md files for slippage, identifies the daily
 * frog via Haiku LLM, renders a 6-section briefing with source health
 * frontmatter, writes the daily note to the vault, and degrades gracefully
 * when sources fail.
 *
 * Per CONTEXT.md decisions:
 *   D-01: Fan-out via Promise.allSettled
 *   D-02: Dual-surface output (vault daily note + terminal echo)
 *   D-03: Six sections in decay-rate order
 *   D-04: Minimal LLM usage — two Haiku calls max
 *   D-05: Dry-run mode writes to scratch path
 *   D-06: Wikilinks only to existing vault notes
 *   D-07: Human-facing section names, HR after synthesis
 *   D-08: YAML frontmatter with sources map + degraded count
 *   D-09: Full markdown template
 *   D-10: Per-section degradation warning format
 *   D-11: Diagnostic checklist on total failure
 *   D-12/D-13/D-14: Inline slippage scanner
 *   D-15: Frog identification via Haiku with heuristic fallback
 *   D-19: Error envelope inline in vault notes
 *
 * @module today-command
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const { getCalendarEvents } = require('./connectors/calendar');
const { getRecentEmails } = require('./connectors/gmail');
const { getGitHubActivity } = require('./connectors/github');
const {
  getProposalsPendingCount,
  getDeadLetterSummary,
  formatBriefingSection,
} = require('./briefing-helpers');
const { loadPipelineConfig, createHaikuClient } = require('./pipeline-infra');

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PROJECTS_DIR = path.join(process.env.HOME, 'projects');
const DEFAULT_VAULT_ROOT = path.join(process.env.HOME, 'Claude Cowork');

// Day-of-week and month abbreviations for D-09 heading format
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function _formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a Date as "DayOfWeek, Mon DD" per D-09.
 * @param {Date} date
 * @returns {string}  e.g. "Wednesday, Apr 23"
 */
function _formatDateHeading(date) {
  const dayName = DAY_NAMES[date.getDay()];
  const monthName = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  return `${dayName}, ${monthName} ${day}`;
}

// ── _fanOut ──────────────────────────────────────────────────────────────────

/**
 * Fan out to all three external connectors in parallel.
 * Uses Promise.allSettled so no single connector can block the others.
 * Per D-01: connector results carry { success, data, error, source, fetchedAt }.
 *
 * Remote trigger support (FIX-03):
 *   When REMOTE_TRIGGER=true and mcpClient is null, the RemoteTrigger context has the
 *   Google Calendar MCP connector attached (config/scheduling.json mcp_connections).
 *   Calendar is the only connector with remote parity per D-01 / Phase 6 decisions.
 *   Gmail and GitHub continue to degrade gracefully (no remote MCP attached for them).
 *
 * @param {object|null} mcpClient - Injected MCP client; null for dry-run/test or remote trigger
 * @returns {Promise<{ calendar: object, gmail: object, github: object }>}
 */
async function _fanOut(mcpClient) {
  const isRemoteTrigger = process.env.REMOTE_TRIGGER === 'true';

  // Calendar gets remote context when running in RemoteTrigger and no local mcpClient
  const calendarOptions = (isRemoteTrigger && !mcpClient)
    ? { remote: true }
    : undefined;

  const [calSettled, gmailSettled, githubSettled] = await Promise.allSettled([
    calendarOptions
      ? getCalendarEvents(null, calendarOptions)
      : getCalendarEvents(mcpClient),
    getRecentEmails(mcpClient, { vipOnly: true }),
    getGitHubActivity(mcpClient),
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

// ── _getPipelineState ────────────────────────────────────────────────────────

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

// ── _scanSlippage ────────────────────────────────────────────────────────────

/**
 * Scan ~/projects/[*]/.planning/STATE.md for stalled projects.
 * Per D-12/D-13/D-14: inline function, gray-matter for YAML parsing,
 * skip malformed files rather than fail.
 *
 * @param {string} projectsDir - Override for ~/projects/ (injection for tests)
 * @param {object} config - Parsed pipeline config (needs config.slippage)
 * @param {Date} referenceDate - Today's date (injection for tests)
 * @returns {{ projects: Array, warnings: string[] }}
 */
function _scanSlippage(projectsDir, config, referenceDate) {
  const slippageCfg = config.slippage || { staleDays: 7, excludeProjects: [], maxProjects: 20 };
  const { staleDays, excludeProjects, maxProjects } = slippageCfg;
  const warnings = [];
  const projects = [];

  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (err) {
    warnings.push(`SCAN_ERROR: Could not read projects directory: ${err.message}`);
    return { projects, warnings };
  }

  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const dirName of dirs) {
    if (projects.length >= maxProjects) break;

    // Apply excludeProjects filter (case-insensitive)
    if (excludeProjects.some((ex) => ex.toLowerCase() === dirName.toLowerCase())) {
      continue;
    }

    const statePath = path.join(projectsDir, dirName, '.planning', 'STATE.md');
    if (!fs.existsSync(statePath)) continue;

    let parsed;
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      parsed = matter(raw);
    } catch (err) {
      // D-14: skip malformed STATE.md, emit warning to synthesis context
      warnings.push(`PARSE_SKIP: ${dirName}/.planning/STATE.md — ${err.message}`);
      continue;
    }

    const fm = parsed.data || {};

    // Require at least a status field to consider this a valid GSD project
    if (!fm.status) continue;

    // Calculate days since last_activity
    let daysSinceActivity = null;
    if (fm.last_activity) {
      // last_activity may be a Date (gray-matter auto-parses dates) or string
      const lastActivityDate = fm.last_activity instanceof Date
        ? fm.last_activity
        : new Date(fm.last_activity);

      if (!isNaN(lastActivityDate.getTime())) {
        const msPerDay = 1000 * 60 * 60 * 24;
        daysSinceActivity = Math.floor((referenceDate - lastActivityDate) / msPerDay);
      }
    }

    const stalled = daysSinceActivity !== null && daysSinceActivity > staleDays;

    // Extract progress fields
    const progress = fm.progress || {};
    const percent = progress.percent !== undefined ? progress.percent : null;
    const completedPhases = progress.completed_phases !== undefined ? progress.completed_phases : null;
    const totalPhases = progress.total_phases !== undefined ? progress.total_phases : null;

    // Determine current phase string
    let phaseStr = 'unknown';
    if (completedPhases !== null && totalPhases !== null) {
      phaseStr = `Phase ${completedPhases}/${totalPhases}`;
    }

    projects.push({
      name: dirName,
      status: fm.status || 'unknown',
      phase: phaseStr,
      percent,
      daysSinceActivity,
      stalled,
    });
  }

  return { projects, warnings };
}

// ── _identifyFrog ────────────────────────────────────────────────────────────

/**
 * Identify the daily frog — the single hardest or most-avoided task.
 * Per D-15: one Haiku call over heuristic-scored candidates.
 * Falls back to heuristic (most days stalled) if LLM call fails.
 *
 * @param {{ projects: Array, warnings: string[] }} slippageData
 * @param {object} haikuClient - LLM client with classify() method
 * @returns {Promise<{ frog: string|null, reasoning: string }>}
 */
async function _identifyFrog(slippageData, haikuClient) {
  const stalledProjects = slippageData.projects.filter((p) => p.stalled);

  if (stalledProjects.length === 0) {
    return { frog: null, reasoning: 'No stalled projects or overdue tasks found.' };
  }

  // Build candidate list for LLM
  const candidates = stalledProjects.map((p) => ({
    project: p.name,
    status: p.status,
    phase: p.phase,
    percentComplete: p.percent,
    daysSinceActivity: p.daysSinceActivity,
  }));

  const systemPrompt = [
    'You identify the single hardest or most-avoided task from a list of project statuses.',
    'Return JSON: {"frog": string, "reasoning": string}.',
    'The frog is the task the user is most likely avoiding or that will cause the most damage if delayed further.',
    'Be specific: name the project and what action is needed.',
    'reasoning should be 1-2 sentences explaining why this is the frog.',
  ].join(' ');

  const result = await haikuClient.classify(systemPrompt, JSON.stringify(candidates), {
    maxTokens: 256,
  });

  if (result.success && result.data && result.data.frog) {
    return {
      frog: result.data.frog,
      reasoning: result.data.reasoning || 'No reasoning provided.',
    };
  }

  // Heuristic fallback: pick the project with most days stalled
  const sorted = [...stalledProjects].sort(
    (a, b) => (b.daysSinceActivity || 0) - (a.daysSinceActivity || 0)
  );
  const top = sorted[0];
  return {
    frog: top.name,
    reasoning: `Heuristic fallback: ${top.name} has been stalled for ${top.daysSinceActivity} days (${top.phase}).`,
  };
}

// ── _buildSourceHealth ───────────────────────────────────────────────────────

/**
 * Build the D-08 frontmatter sources health map.
 *
 * @param {{ calendar: object, gmail: object, github: object }} connectorResults
 * @param {boolean} pipelineOk
 * @returns {{ sources: object, degradedCount: number }}
 */
function _buildSourceHealth(connectorResults, pipelineOk) {
  const sources = {
    calendar: connectorResults.calendar.success ? 'ok' : 'degraded',
    gmail: connectorResults.gmail.success ? 'ok' : 'degraded',
    github: connectorResults.github.success ? 'ok' : 'degraded',
    pipeline: pipelineOk ? 'ok' : 'degraded',
  };
  const degradedCount = Object.values(sources).filter((v) => v === 'degraded').length;
  return { sources, degradedCount };
}

// ── _renderDegradedSection ───────────────────────────────────────────────────

/**
 * Render the D-10 per-section degradation warning.
 * Format: ⚠️ [SOURCE] ERROR_CODE: human message
 *
 * @param {string} sourceName - Human-facing name (e.g., "calendar")
 * @param {string} errorString - Error from connector result
 * @returns {string}
 */
function _renderDegradedSection(sourceName, errorString) {
  const err = errorString || 'MCP_ERROR: unknown error';
  // If error already matches [A-Z_]+: pattern, use as-is; otherwise prefix with MCP_ERROR:
  const errorBody = /^[A-Z_]+: .+/.test(err) ? err : `MCP_ERROR: ${err}`;
  return `\u26a0\ufe0f [${sourceName}] ${errorBody}`;
}

// ── _renderBriefing ──────────────────────────────────────────────────────────

/**
 * Render the full D-09 markdown briefing template.
 *
 * @param {object} data
 * @param {Date} data.date - Today's date object
 * @param {{ sources: object, degradedCount: number }} data.sourceHealth
 * @param {{ calendar: object, gmail: object, github: object }} data.connectorResults
 * @param {{ proposalCount: number, deadLetter: object, ok: boolean, error?: string }} data.pipelineState
 * @param {{ projects: Array, warnings: string[] }} data.slippage
 * @param {{ frog: string|null, reasoning: string }} data.frog
 * @param {string} data.mode
 * @param {object} data.haikuClient
 * @returns {Promise<string>} Full markdown string
 */
async function _renderBriefing(data) {
  const { date, sourceHealth, connectorResults, pipelineState, slippage, frog, mode, haikuClient } = data;
  const { sources, degradedCount } = sourceHealth;

  // ── Frontmatter (D-08) ───────────────────────────────────────────────────
  const dateStr = _formatDateYMD(date);
  const generatedISO = new Date().toISOString();

  const frontmatter = [
    '---',
    `date: ${dateStr}`,
    'sources:',
    `  calendar: ${sources.calendar}`,
    `  gmail: ${sources.gmail}`,
    `  github: ${sources.github}`,
    `  pipeline: ${sources.pipeline}`,
    `degraded: ${degradedCount}`,
    `generated: ${generatedISO}`,
    `mode: ${mode}`,
    '---',
  ].join('\n');

  // ── Heading ──────────────────────────────────────────────────────────────
  const heading = `# Daily Briefing \u2014 ${_formatDateHeading(date)}`;

  // ── Synthesis paragraph (D-04, D-11) ────────────────────────────────────
  let synthesis;
  const allDegraded = degradedCount >= 4;

  if (allDegraded) {
    // D-11: Total failure — render diagnostic checklist
    synthesis = [
      '> All data sources unavailable. Check:',
      '> (1) Docker Desktop running?',
      '> (2) Obsidian Local REST API plugin enabled?',
      '> (3) Network?',
    ].join('\n');
  } else {
    // Build context summary for LLM synthesis
    const contextParts = [];
    if (connectorResults.calendar.success) {
      const events = connectorResults.calendar.data || [];
      contextParts.push(`Meetings today: ${events.length}`);
    } else {
      contextParts.push(`Calendar: degraded (${connectorResults.calendar.error})`);
    }
    if (connectorResults.gmail.success) {
      const emails = connectorResults.gmail.data || [];
      contextParts.push(`VIP emails: ${emails.length}`);
    } else {
      contextParts.push(`Gmail: degraded (${connectorResults.gmail.error})`);
    }
    if (connectorResults.github.success) {
      const gh = connectorResults.github.data || {};
      const repos = gh.repos || [];
      contextParts.push(`GitHub repos with activity: ${repos.length}`);
    } else {
      contextParts.push(`GitHub: degraded (${connectorResults.github.error})`);
    }
    if (pipelineState.ok) {
      contextParts.push(`Pipeline proposals pending: ${pipelineState.proposalCount}`);
      contextParts.push(`Dead-letter files: ${pipelineState.deadLetter.total}`);
    } else {
      contextParts.push(`Pipeline: degraded`);
    }
    const stalledProjects = slippage.projects.filter((p) => p.stalled);
    contextParts.push(`Stalled projects: ${stalledProjects.length}`);
    if (frog.frog) {
      contextParts.push(`Frog: ${frog.frog}`);
    }
    if (degradedCount > 0) {
      contextParts.push(`Degraded sources: ${degradedCount}`);
    }

    const synthSystemPrompt = [
      'You write a concise 3-4 sentence daily briefing synthesis.',
      'Be direct and actionable. Flag degraded sources by name.',
      'Focus on what needs attention today.',
    ].join(' ');

    const synthResult = await haikuClient.classify(
      synthSystemPrompt,
      contextParts.join('\n'),
      { maxTokens: 200 }
    );

    if (synthResult.success && typeof synthResult.data === 'string') {
      synthesis = `> ${synthResult.data}`;
    } else if (synthResult.success && synthResult.data && synthResult.data.synthesis) {
      synthesis = `> ${synthResult.data.synthesis}`;
    } else {
      // Static fallback
      synthesis = `> Briefing generated with ${degradedCount} degraded source(s). Review sections below for details.`;
    }
  }

  // ── Section: Meetings ────────────────────────────────────────────────────
  let meetingsSection;
  if (!connectorResults.calendar.success) {
    meetingsSection = _renderDegradedSection('calendar', connectorResults.calendar.error);
  } else {
    const events = connectorResults.calendar.data || [];
    if (events.length === 0) {
      meetingsSection = '_No meetings scheduled today._';
    } else {
      meetingsSection = events.map((evt) => {
        const time = evt.start && evt.start.dateTime
          ? new Date(evt.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : evt.start && evt.start.date
            ? 'All day'
            : 'Unknown time';
        const title = evt.summary || 'Untitled';
        const attendees = (evt.attendees || [])
          .filter((a) => !a.self)
          .map((a) => a.email || a.displayName || 'unknown')
          .slice(0, 3)
          .join(', ');
        return attendees
          ? `- ${time}: **${title}** (${attendees})`
          : `- ${time}: **${title}**`;
      }).join('\n');
    }
  }

  // ── Section: VIP Emails ──────────────────────────────────────────────────
  let emailsSection;
  if (!connectorResults.gmail.success) {
    emailsSection = _renderDegradedSection('gmail', connectorResults.gmail.error);
  } else {
    const emails = connectorResults.gmail.data || [];
    if (emails.length === 0) {
      emailsSection = '_No VIP emails in the last window._';
    } else {
      emailsSection = emails.map((em) => {
        const subject = em.subject || '(no subject)';
        const sender = em.from || em.sender || 'Unknown sender';
        const snippet = em.snippet || em.body || '';
        return `- **${subject}** — ${sender}\n  ${snippet}`;
      }).join('\n');
    }
  }

  // ── Section: Slippage ───────────────────────────────────────────────────
  let slippageSection;
  const stalledProjects = slippage.projects.filter((p) => p.stalled);
  if (stalledProjects.length === 0) {
    slippageSection = '_No stalled projects._';
  } else {
    slippageSection = stalledProjects.map((p) => {
      const percentStr = p.percent !== null ? `${p.percent}%` : 'unknown%';
      const daysStr = p.daysSinceActivity !== null ? `${p.daysSinceActivity}d stalled` : 'stalled';
      // D-06: wikilinks only to vault notes — we use [[project-name]] format
      return `- [[${p.name}]] — ${p.phase}, ${percentStr} complete, ${daysStr}`;
    }).join('\n');
  }
  if (slippage.warnings.length > 0) {
    slippageSection += '\n\n_Scanner warnings: ' + slippage.warnings.join('; ') + '_';
  }

  // ── Section: Frog ───────────────────────────────────────────────────────
  let frogSection;
  if (!frog.frog) {
    frogSection = '_No frog identified today._';
  } else {
    frogSection = `**${frog.frog}**\n\n${frog.reasoning}`;
  }

  // ── Section: GitHub ──────────────────────────────────────────────────────
  let githubSection;
  if (!connectorResults.github.success) {
    githubSection = _renderDegradedSection('github', connectorResults.github.error);
  } else {
    const gh = connectorResults.github.data || {};
    const repos = gh.repos || [];
    const githubWarnings = gh.warnings || [];

    if (repos.length === 0) {
      githubSection = '_No GitHub activity in the last window._';
    } else {
      const repoLines = repos.map((repo) => {
        const name = repo.name || repo.repo || 'unknown';
        const parts = [];
        if (repo.commits && repo.commits.length > 0) {
          parts.push(`${repo.commits.length} commit(s)`);
        }
        if (repo.pullRequests && repo.pullRequests.length > 0) {
          parts.push(`${repo.pullRequests.length} PR(s)`);
        }
        if (repo.issues && repo.issues.length > 0) {
          parts.push(`${repo.issues.length} issue(s)`);
        }
        const summary = parts.length > 0 ? parts.join(', ') : 'activity';
        return `- **${name}**: ${summary}`;
      });
      githubSection = repoLines.join('\n');
      if (githubWarnings.length > 0) {
        githubSection += '\n\n_Partial data: ' + githubWarnings.join('; ') + '_';
      }
    }
  }

  // ── Section: Pipeline ────────────────────────────────────────────────────
  let pipelineSection;
  if (!pipelineState.ok) {
    pipelineSection = _renderDegradedSection('pipeline', pipelineState.error || 'PIPELINE_ERROR: unavailable');
  } else {
    const proposalText = formatBriefingSection('proposals', { count: pipelineState.proposalCount });
    const deadLetterText = formatBriefingSection('deadletter', pipelineState.deadLetter);

    if (!proposalText && !deadLetterText) {
      pipelineSection = '_Pipeline clear._';
    } else {
      pipelineSection = [proposalText, deadLetterText].filter(Boolean).join('\n\n');
    }
  }

  // ── Assemble full document (D-09) ────────────────────────────────────────
  const doc = [
    frontmatter,
    '',
    heading,
    '',
    synthesis,
    '',
    '---',
    '',
    '## Meetings',
    '',
    meetingsSection,
    '',
    '## VIP Emails',
    '',
    emailsSection,
    '',
    '## Slippage',
    '',
    slippageSection,
    '',
    '## Frog',
    '',
    frogSection,
    '',
    '## GitHub',
    '',
    githubSection,
    '',
    '## Pipeline',
    '',
    pipelineSection,
  ].join('\n');

  return doc;
}

// ── runToday ─────────────────────────────────────────────────────────────────

/**
 * Orchestrate the full /today briefing pipeline.
 *
 * @param {object} [options={}]
 * @param {object|null} [options.mcpClient] - Injected MCP client (null for dry-run/test)
 * @param {string} [options.mode='interactive'] - 'interactive' | 'scheduled' | 'dry-run'
 * @param {string} [options.projectsDir] - Override for ~/projects/ (for testing)
 * @param {string} [options.vaultRoot] - Override for ~/Claude Cowork/ (for testing)
 * @param {Date} [options.date] - Override for today's date (for testing)
 * @param {object} [options.haikuClient] - Injected LLM client (for testing)
 * @returns {Promise<{ path: string|null, briefing: string|null, sourceHealth?: object, error?: string }>}
 */
async function runToday(options = {}) {
  try {
    // ── Defaults ──────────────────────────────────────────────────────────
    const mode = options.mode || 'interactive';
    const projectsDir = options.projectsDir || DEFAULT_PROJECTS_DIR;
    const vaultRoot = options.vaultRoot || DEFAULT_VAULT_ROOT;
    const date = options.date || new Date();
    const mcpClient = options.mcpClient || null;

    // ── Load config ───────────────────────────────────────────────────────
    const config = loadPipelineConfig();

    // ── LLM client ────────────────────────────────────────────────────────
    const haikuClient = options.haikuClient || createHaikuClient();

    // ── Parallel data gathering ───────────────────────────────────────────
    // Run fan-out (connectors), pipeline state, and slippage scan in parallel.
    // Slippage scan is synchronous but wrapped in allSettled for consistency.
    const [fanOutResult, pipelineResult] = await Promise.allSettled([
      _fanOut(mcpClient),
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

    // Slippage scan (sync, inline per D-12)
    const slippage = _scanSlippage(projectsDir, config, date);

    // ── Frog identification (D-15) ────────────────────────────────────────
    const frogData = await _identifyFrog(slippage, haikuClient);

    // ── Source health (D-08) ─────────────────────────────────────────────
    const sourceHealth = _buildSourceHealth(connectorResults, pipelineState.ok);

    // ── Render briefing (D-09) ────────────────────────────────────────────
    const briefing = await _renderBriefing({
      date,
      sourceHealth,
      connectorResults,
      pipelineState,
      slippage,
      frog: frogData,
      mode,
      haikuClient,
    });

    // ── Determine output path (D-02, D-05) ───────────────────────────────
    const dateStr = _formatDateYMD(date);
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

    return { path: outputPath, briefing, sourceHealth };

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

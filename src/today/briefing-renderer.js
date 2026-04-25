'use strict';

/**
 * src/today/briefing-renderer.js
 *
 * Assembles the six-section /today briefing markdown document. Extracted from
 * today-command.js during Phase 15 architecture refactor (B-07).
 *
 * The renderer is intentionally synchronous and side-effect-free: it takes a
 * fully-populated data object (including pre-computed LLM synthesis) and
 * returns a markdown string. All async work — connector fan-out, pipeline
 * state, slippage scan, frog ID, and synthesis — happens in the orchestrator
 * or its siblings before calling in here.
 *
 * Per CONTEXT decisions from Phase 4:
 *   D-03: Six sections in decay-rate order (Meetings, VIP Emails, Slippage,
 *         Frog, GitHub, Pipeline)
 *   D-06: Wikilinks only to existing vault notes — we use [[project-name]]
 *   D-07: Human-facing section names, HR after synthesis blockquote
 *   D-08: YAML frontmatter with sources map and degraded count
 *   D-09: Full markdown template assembled here
 *   D-10: Per-section degradation warning format (⚠️ [SOURCE] ERROR_CODE: msg)
 *
 * @module today/briefing-renderer
 */

const { formatBriefingSection } = require('../briefing-helpers');

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DD (used for frontmatter, filenames).
 * @param {Date} date
 * @returns {string}
 */
function formatDateYMD(date) {
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
function formatDateHeading(date) {
  const dayName = DAY_NAMES[date.getDay()];
  const monthName = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  return `${dayName}, ${monthName} ${day}`;
}

// ── Source health ────────────────────────────────────────────────────────────

/**
 * Build the D-08 frontmatter sources health map.
 *
 * @param {{ calendar: object, gmail: object, github: object }} connectorResults
 * @param {boolean} pipelineOk
 * @returns {{ sources: object, degradedCount: number }}
 */
function buildSourceHealth(connectorResults, pipelineOk) {
  const sources = {
    calendar: connectorResults.calendar.success ? 'ok' : 'degraded',
    gmail: connectorResults.gmail.success ? 'ok' : 'degraded',
    github: connectorResults.github.success ? 'ok' : 'degraded',
    pipeline: pipelineOk ? 'ok' : 'degraded',
  };
  const degradedCount = Object.values(sources).filter((v) => v === 'degraded').length;
  return { sources, degradedCount };
}

// ── Per-section renderers ────────────────────────────────────────────────────

/**
 * Render the D-10 per-section degradation warning.
 * Format: ⚠️ [SOURCE] ERROR_CODE: human message
 *
 * @param {string} sourceName - Human-facing name (e.g., "calendar")
 * @param {string} errorString - Error from connector result
 * @returns {string}
 */
function renderDegradedSection(sourceName, errorString) {
  const err = errorString || 'MCP_ERROR: unknown error';
  // If error already matches [A-Z_]+: pattern, use as-is; otherwise prefix with MCP_ERROR:
  const errorBody = /^[A-Z_]+: .+/.test(err) ? err : `MCP_ERROR: ${err}`;
  return `\u26a0\ufe0f [${sourceName}] ${errorBody}`;
}

function _renderMeetingsSection(calendarResult) {
  if (!calendarResult.success) {
    return renderDegradedSection('calendar', calendarResult.error);
  }
  const events = calendarResult.data || [];
  if (events.length === 0) {
    return '_No meetings scheduled today._';
  }
  return events.map((evt) => {
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

function _renderEmailsSection(gmailResult) {
  if (!gmailResult.success) {
    return renderDegradedSection('gmail', gmailResult.error);
  }
  const emails = gmailResult.data || [];
  if (emails.length === 0) {
    return '_No VIP emails in the last window._';
  }
  return emails.map((em) => {
    const subject = em.subject || '(no subject)';
    const sender = em.from || em.sender || 'Unknown sender';
    const snippet = em.snippet || em.body || '';
    return `- **${subject}** — ${sender}\n  ${snippet}`;
  }).join('\n');
}

function _renderSlippageSection(slippage) {
  const stalledProjects = slippage.projects.filter((p) => p.stalled);
  let section;
  if (stalledProjects.length === 0) {
    section = '_No stalled projects._';
  } else {
    section = stalledProjects.map((p) => {
      const percentStr = p.percent !== null ? `${p.percent}%` : 'unknown%';
      const daysStr = p.daysSinceActivity !== null ? `${p.daysSinceActivity}d stalled` : 'stalled';
      // D-06: wikilinks only to vault notes — we use [[project-name]] format
      return `- [[${p.name}]] — ${p.phase}, ${percentStr} complete, ${daysStr}`;
    }).join('\n');
  }
  if (slippage.warnings.length > 0) {
    section += '\n\n_Scanner warnings: ' + slippage.warnings.join('; ') + '_';
  }
  return section;
}

function _renderFrogSection(frog) {
  if (!frog.frog) {
    return '_No frog identified today._';
  }
  return `**${frog.frog}**\n\n${frog.reasoning}`;
}

/**
 * Render Memory Echo section body. Returns `null` when there are no entries —
 * callers MUST spread the heading+body only when this returns a string, so the
 * Memory Echo heading is entirely absent when no memory crosses the threshold
 * (Phase 18 TODAY-ECHO-01).
 *
 * @param {{ entries: Array, score?: number, skipped?: boolean }} memoryEcho
 * @returns {string|null}
 */
function _renderMemoryEchoSection(memoryEcho) {
  if (!memoryEcho || !Array.isArray(memoryEcho.entries) || memoryEcho.entries.length === 0) {
    return null;
  }
  return memoryEcho.entries.map((entry, idx) => {
    const rank = idx + 1;
    const cat = entry.category || 'UNKNOWN';
    const snippet = entry.snippet || '';
    const ref = entry.sourceRef || 'unknown';
    return `${rank}. [${cat}] ${snippet} (${ref})`;
  }).join('\n');
}

function _renderGitHubSection(githubResult) {
  if (!githubResult.success) {
    return renderDegradedSection('github', githubResult.error);
  }
  const gh = githubResult.data || {};
  const repos = gh.repos || [];
  const githubWarnings = gh.warnings || [];

  if (repos.length === 0) {
    return '_No GitHub activity in the last window._';
  }

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

  let section = repoLines.join('\n');
  if (githubWarnings.length > 0) {
    section += '\n\n_Partial data: ' + githubWarnings.join('; ') + '_';
  }
  return section;
}

function _renderPipelineSection(pipelineState) {
  if (!pipelineState.ok) {
    return renderDegradedSection('pipeline', pipelineState.error || 'PIPELINE_ERROR: unavailable');
  }
  const proposalText = formatBriefingSection('proposals', { count: pipelineState.proposalCount });
  const deadLetterText = formatBriefingSection('deadletter', pipelineState.deadLetter);
  if (!proposalText && !deadLetterText) {
    return '_Pipeline clear._';
  }
  return [proposalText, deadLetterText].filter(Boolean).join('\n\n');
}

// ── Frontmatter ──────────────────────────────────────────────────────────────

function _renderFrontmatter(date, sources, degradedCount, mode) {
  return [
    '---',
    `date: ${formatDateYMD(date)}`,
    'sources:',
    `  calendar: ${sources.calendar}`,
    `  gmail: ${sources.gmail}`,
    `  github: ${sources.github}`,
    `  pipeline: ${sources.pipeline}`,
    `degraded: ${degradedCount}`,
    `generated: ${new Date().toISOString()}`,
    `mode: ${mode}`,
    '---',
  ].join('\n');
}

// ── Main renderer ────────────────────────────────────────────────────────────

/**
 * Render the full D-09 markdown briefing template.
 *
 * Phase 20 addition (TODAY-SUMMARY-01, D-05/D-06): prepends a verbatim 5-delta
 * "Yesterday: ..." line at the top of the briefing when:
 *   - config.stats.summaryLineEnabled is true (default)
 *   - daily-stats.md exists and has at least one row strictly before today
 * Silent suppression on every failure path — briefing is the product (D-06).
 *
 * @param {object} data
 * @param {Date} data.date - Today's date object
 * @param {{ sources: object, degradedCount: number }} data.sourceHealth
 * @param {{ calendar: object, gmail: object, github: object }} data.connectorResults
 * @param {{ proposalCount: number, deadLetter: object, ok: boolean, error?: string }} data.pipelineState
 * @param {{ projects: Array, warnings: string[] }} data.slippage
 * @param {{ frog: string|null, reasoning: string }} data.frog
 * @param {string} data.mode
 * @param {string} data.synthesis - Pre-computed synthesis blockquote (from llm-augmentation)
 * @returns {string} Full markdown string
 */
function renderBriefing(data) {
  const { date, sourceHealth, connectorResults, pipelineState, slippage, frog, memoryEcho, mode, synthesis } = data;
  const { sources, degradedCount } = sourceHealth;

  const frontmatter = _renderFrontmatter(date, sources, degradedCount, mode);
  const heading = `# Daily Briefing \u2014 ${formatDateHeading(date)}`;

  const meetingsSection = _renderMeetingsSection(connectorResults.calendar);
  const emailsSection = _renderEmailsSection(connectorResults.gmail);
  const slippageSection = _renderSlippageSection(slippage);
  const frogSection = _renderFrogSection(frog);
  const memoryEchoBody = _renderMemoryEchoSection(memoryEcho);
  const githubSection = _renderGitHubSection(connectorResults.github);
  const pipelineSection = _renderPipelineSection(pipelineState);

  const body = [
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
    // Memory Echo (Phase 18, TODAY-ECHO-01) — heading and body absent when no
    // memory entries crossed the threshold.
    ...(memoryEchoBody !== null ? ['## Memory Echo', '', memoryEchoBody, ''] : []),
    '## GitHub',
    '',
    githubSection,
    '',
    '## Pipeline',
    '',
    pipelineSection,
  ].join('\n');

  // ── Phase 20: Yesterday summary line prefix (TODAY-SUMMARY-01, D-05/D-06) ──
  // Silent suppression on every failure path — briefing is the product.
  // All requires are lazy (inside function body) per Pattern 12.
  let summaryLine = '';
  try {
    const { loadConfigWithOverlay } = require('../pipeline-infra');
    const config = loadConfigWithOverlay('pipeline', { validate: true });

    if (config.stats && config.stats.summaryLineEnabled !== false) {
      const { readDailyStats, dateKey } = require('../daily-stats');
      const { VAULT_ROOT } = require('../vault-gateway');
      const nodePath = require('path');

      const statsAbsPath = nodePath.join(VAULT_ROOT, config.stats.path || 'RIGHT/daily-stats.md');
      const tz = config.stats.timezone || 'America/Chicago';

      const { rows } = readDailyStats(statsAbsPath);

      if (Array.isArray(rows) && rows.length > 0) {
        const todayKey = dateKey(data.date || new Date(), tz);

        // Use the largest-date-strictly-less-than-today rule (handles history gaps).
        const earlier = rows.filter(r => r.date < todayKey);

        if (earlier.length > 0) {
          const priorRow = earlier[earlier.length - 1];
          const dayBeforePrior = earlier.length > 1 ? earlier[earlier.length - 2] : null;

          const { buildYesterdaySummaryLine } = require('../briefing-helpers');
          summaryLine = buildYesterdaySummaryLine(priorRow, dayBeforePrior);
        }
      }
    }
  } catch (_) {
    // Silent suppression — briefing-is-the-product (D-06).
    summaryLine = '';
  }

  return summaryLine ? `${summaryLine}\n\n${body}` : body;
}

module.exports = {
  renderBriefing,
  buildSourceHealth,
  renderDegradedSection,
  formatDateYMD,
  formatDateHeading,
};

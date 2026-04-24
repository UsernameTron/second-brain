'use strict';

/**
 * src/today/slippage-scanner.js
 *
 * Scans ~/projects/[*]/.planning/STATE.md for stalled GSD projects.
 * Extracted from today-command.js during Phase 15 architecture refactor (B-07).
 *
 * Pure function — no module-level state. Takes projectsDir, config, and
 * referenceDate as parameters so callers (including tests) control the inputs.
 *
 * Per CONTEXT decisions D-12/D-13/D-14 from Phase 4:
 *   D-12: Inline scanner (no external service)
 *   D-13: gray-matter for YAML frontmatter parsing
 *   D-14: Skip malformed STATE.md files with a warning rather than fail
 *
 * @module today/slippage-scanner
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

/**
 * Scan a projects directory for STATE.md files and identify stalled projects.
 *
 * @param {string} projectsDir - Absolute path to the ~/projects/ directory to scan
 * @param {object} config - Parsed pipeline config; reads config.slippage
 * @param {Date} referenceDate - The date to compare last_activity against (usually "today")
 * @returns {{ projects: Array<object>, warnings: string[] }}
 *   projects: { name, status, phase, percent, daysSinceActivity, stalled }
 *   warnings: human-readable scanner warnings for degraded scan context
 */
function scanSlippage(projectsDir, config, referenceDate) {
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

module.exports = { scanSlippage };

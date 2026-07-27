#!/usr/bin/env node
'use strict';

/**
 * compounding-report.js
 *
 * Standalone compounding-verdict report (v1.7 TREND-02). Reads
 * briefings/daily-stats.md via readDailyStats, computes the trend, and prints
 * the full evidence table + verdict as markdown. Unlike the /today section,
 * this ALWAYS prints the table — including the insufficient-data verdict at
 * fewer than 7 rows.
 *
 *   node ~/projects/second-brain/scripts/compounding-report.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { readDailyStats } = require('../src/daily-stats');
const { computeCompoundingTrend, renderCompoundingReport } = require('../src/today/compounding-trend');
const { loadConfigWithOverlay } = require('../src/pipeline-infra');
const { VAULT_ROOT } = require('../src/vault-gateway');

function main() {
  let statsRelPath = 'briefings/daily-stats.md';
  try {
    const config = loadConfigWithOverlay('pipeline', { validate: true });
    if (config && config.stats && config.stats.path) statsRelPath = config.stats.path;
  } catch (_) {
    // Non-fatal: warn to stderr (not console.* — ESLint no-console), then use the default path.
    process.stderr.write(`compounding-report: config load failed, falling back to default stats path '${statsRelPath}'\n`);
  }

  const statsAbsPath = path.join(VAULT_ROOT, statsRelPath);
  const { rows } = readDailyStats(statsAbsPath);
  const trend = computeCompoundingTrend(rows, { windowDays: 14 });

  process.stdout.write('# Compounding Report\n\n');
  process.stdout.write(renderCompoundingReport(trend) + '\n');
}

main();

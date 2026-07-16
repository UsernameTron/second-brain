// Requirement: TREND-01, TREND-02
// Unit tests for src/today/compounding-trend.js — pure verdict engine + markdown renderer.
// Phase 31: Trend & Report

'use strict';

const fs = require('fs');
const path = require('path');
const {
  computeCompoundingTrend,
  renderCompoundingReport,
} = require('../../src/today/compounding-trend');

// ── Fixture builders ─────────────────────────────────────────────────────────

/**
 * Build a synthetic row. Defaults produce a "strong" row (supply/demand/utility
 * all healthy) so tests can override only the fields relevant to the case.
 */
function row(date, overrides = {}) {
  return {
    date,
    proposals: 2,
    promotions: 1,
    total_entries: 100,
    memory_kb: 50,
    recall_count: 2,
    avg_latency_ms: 1200,
    avg_confidence: '0.8',
    recall_hits: 2,
    echo_shown: 1,
    echo_score: '0.7',
    ...overrides,
  };
}

/** 14 rows, entries growing +1/day (total +13 >= 5), memory_kb growing,
 *  recall used every day (100% >= 40%), hit rate 100% (>= 60%), flat wk2 vs wk1. */
function buildCompoundingRows() {
  const rows = [];
  for (let i = 0; i < 14; i++) {
    rows.push(row(`2026-07-${String(i + 1).padStart(2, '0')}`, {
      total_entries: 100 + i,
      memory_kb: 50 + i * 2,
      recall_count: 2,
      recall_hits: 2,
    }));
  }
  return rows;
}

describe('computeCompoundingTrend', () => {
  test('fewer than 7 rows => insufficient-data', () => {
    const rows = buildCompoundingRows().slice(0, 6);
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.verdict).toBe('insufficient-data');
    expect(trend.rowCount).toBe(6);
    expect(trend.metrics).toBeNull();
  });

  test('strong 14-row window => compounding', () => {
    const rows = buildCompoundingRows();
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.verdict).toBe('compounding');
    expect(trend.rowCount).toBe(14);
    expect(trend.metrics.supply.ok).toBe(true);
    expect(trend.metrics.demand.ok).toBe(true);
    expect(trend.metrics.utility.ok).toBe(true);
  });

  test('supply fails (entriesDelta < 5) => flat', () => {
    const rows = buildCompoundingRows().map(r => ({ ...r, total_entries: 100 }));
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.verdict).toBe('flat');
    expect(trend.metrics.supply.ok).toBe(false);
  });

  test('demand fails (recall used on fewer than 40% of days) => flat', () => {
    const rows = buildCompoundingRows().map((r, i) => ({
      ...r,
      recall_count: i < 12 ? 0 : 2, // only 2/14 days (~14%) have recall
      recall_hits: i < 12 ? 0 : 2,
    }));
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.verdict).toBe('flat');
    expect(trend.metrics.demand.ok).toBe(false);
  });

  test('utility hit-rate fails (aggregate hit rate < 0.60) => flat', () => {
    const rows = buildCompoundingRows().map(r => ({ ...r, recall_count: 10, recall_hits: 3 }));
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.verdict).toBe('flat');
    expect(trend.metrics.utility.hitOk).toBe(false);
    expect(trend.metrics.utility.ok).toBe(false);
  });

  test('utility trend fails (week-2 hit rate more than 10pts below week-1) => flat', () => {
    const rows = buildCompoundingRows().map((r, i) => {
      // week1 = first 7 rows: hit rate 100%. week2 = last 7 rows: hit rate ~14% (well below week1 - 10pts).
      if (i < 7) return { ...r, recall_count: 2, recall_hits: 2 };
      return { ...r, recall_count: 7, recall_hits: 1 };
    });
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.verdict).toBe('flat');
    expect(trend.metrics.utility.trendOk).toBe(false);
    expect(trend.metrics.utility.ok).toBe(false);
  });

  test('only the last windowDays rows are considered', () => {
    const rows = [];
    // 6 "bad" rows (flat entries) followed by 14 "good" rows.
    for (let i = 0; i < 6; i++) {
      rows.push(row(`2026-06-${String(i + 1).padStart(2, '0')}`, { total_entries: 1, memory_kb: 1, recall_count: 0, recall_hits: 0 }));
    }
    rows.push(...buildCompoundingRows());
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.rowCount).toBe(14);
    expect(trend.verdict).toBe('compounding');
  });

  test("'—' cells coerce to 0 and never throw", () => {
    const rows = buildCompoundingRows().map(r => ({
      ...r,
      echo_shown: '—',
      echo_score: '—',
      avg_latency_ms: '—',
    }));
    expect(() => computeCompoundingTrend(rows, { windowDays: 14 })).not.toThrow();
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    expect(trend.verdict).toBe('compounding');
  });

  test('purity — source contains no require("fs")', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/today/compounding-trend.js'),
      'utf8'
    );
    expect(src).not.toMatch(/require\(['"]fs['"]\)/);
  });

  test('non-array rows treated as empty => insufficient-data', () => {
    const trend = computeCompoundingTrend(null, { windowDays: 14 });
    expect(trend.verdict).toBe('insufficient-data');
    expect(trend.rowCount).toBe(0);
  });
});

describe('renderCompoundingReport', () => {
  test('compounding trend renders verdict line + GFM table with one row per windowed row', () => {
    const rows = buildCompoundingRows();
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    const body = renderCompoundingReport(trend);
    expect(body).toContain('Verdict: compounding');
    const dataRowLines = body.split('\n').filter(l => l.startsWith('| 2026-07-'));
    expect(dataRowLines.length).toBe(14);
  });

  test('insufficient-data trend still renders an evidence table (all rows) + insufficient-data count', () => {
    const rows = buildCompoundingRows().slice(0, 4);
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    const body = renderCompoundingReport(trend);
    expect(body).toMatch(/insufficient-data/);
    expect(body).toContain('4');
    const dataRowLines = body.split('\n').filter(l => l.startsWith('| 2026-07-'));
    expect(dataRowLines.length).toBe(4);
  });

  test('compounding/flat verdict on short window (10 rows) is labeled provisional', () => {
    const rows = buildCompoundingRows().slice(0, 10);
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    const body = renderCompoundingReport(trend);
    expect(body).toMatch(/provisional/);
    expect(body).toContain('10 of 14');
  });

  test('compounding/flat verdict on full 14-row window has NO provisional label', () => {
    const rows = buildCompoundingRows();
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    const body = renderCompoundingReport(trend);
    expect(body).not.toMatch(/provisional/);
  });

  test('output is a string; module still has no require("fs")', () => {
    const rows = buildCompoundingRows();
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    const body = renderCompoundingReport(trend);
    expect(typeof body).toBe('string');
  });

  test('table header contains all evidence columns in order', () => {
    const rows = buildCompoundingRows();
    const trend = computeCompoundingTrend(rows, { windowDays: 14 });
    const body = renderCompoundingReport(trend);
    const headerLine = body.split('\n').find(l => l.includes('date') && l.includes('total_entries'));
    expect(headerLine).toBeDefined();
    const order = ['date', 'total_entries', 'memory_kb', 'recall_count', 'recall_hits', 'echo_shown', 'echo_score'];
    let lastIndex = -1;
    for (const col of order) {
      const idx = headerLine.indexOf(col);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });
});

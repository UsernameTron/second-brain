// Requirement: AGENT-MEMORY-01
// Unit tests for src/today/memory-health.js — anomaly detection from daily-stats rows.
// Phase 24: Agent Surface

'use strict';

const { computeMemoryHealth } = require('../../src/today/memory-health');

// ── Fixture row arrays ──────────────────────────────────────────────────────

const normalRows = [
  { date: '2026-04-23', proposals: 2, promotions: 1, total_entries: 100, recall_count: 3 },
  { date: '2026-04-24', proposals: 1, promotions: 2, total_entries: 102, recall_count: 1 },
  { date: '2026-04-25', proposals: 3, promotions: 1, total_entries: 105, recall_count: 2 },
];

const zeroPromotionRows = [
  { date: '2026-04-23', proposals: 1, promotions: 0, total_entries: 100, recall_count: 2 },
  { date: '2026-04-24', proposals: 2, promotions: 0, total_entries: 102, recall_count: 1 },
  { date: '2026-04-25', proposals: 3, promotions: 0, total_entries: 104, recall_count: 3 },
];

const backlogGrowthRows = [
  { date: '2026-04-23', proposals: 1, promotions: 0, total_entries: 100, recall_count: 2 },
  { date: '2026-04-24', proposals: 3, promotions: 0, total_entries: 102, recall_count: 1 },
  { date: '2026-04-25', proposals: 6, promotions: 0, total_entries: 104, recall_count: 3 },
];

const recallDropRows = [
  { date: '2026-04-23', proposals: 2, promotions: 1, total_entries: 100, recall_count: 0 },
  { date: '2026-04-24', proposals: 1, promotions: 2, total_entries: 102, recall_count: 0 },
  { date: '2026-04-25', proposals: 3, promotions: 1, total_entries: 105, recall_count: 0 },
];

const vaultPlateauRows = [
  { date: '2026-04-23', proposals: 2, promotions: 1, total_entries: 100, recall_count: 2 },
  { date: '2026-04-24', proposals: 1, promotions: 2, total_entries: 100, recall_count: 1 },
  { date: '2026-04-25', proposals: 3, promotions: 1, total_entries: 100, recall_count: 3 },
];

const defaultThresholds = { enabled: true, streakDays: 3 };

// ── Tests ───────────────────────────────────────────────────────────────────

describe('computeMemoryHealth', () => {

  // Test 1: empty rows returns null
  test('returns null when rows is empty', () => {
    const result = computeMemoryHealth([], defaultThresholds);
    expect(result).toBeNull();
  });

  // Test 2: sparse data guard — fewer rows than streakDays returns null
  test('returns null when rows.length < streakDays (sparse data guard)', () => {
    const twoRows = [
      { date: '2026-04-24', proposals: 1, promotions: 0, total_entries: 100, recall_count: 0 },
      { date: '2026-04-25', proposals: 2, promotions: 0, total_entries: 100, recall_count: 0 },
    ];
    const result = computeMemoryHealth(twoRows, defaultThresholds);
    expect(result).toBeNull();
  });

  // Test 3: zero promotions streak triggers "zero promotions" alert
  test('returns string containing "zero promotions" for 3 consecutive days with promotions=0', () => {
    const result = computeMemoryHealth(zeroPromotionRows, defaultThresholds);
    expect(result).not.toBeNull();
    expect(result).toMatch(/zero promotions/i);
  });

  // Test 4: backlog growth (proposals increasing, promotions flat at 0) triggers "backlog growth" alert
  test('returns string containing "backlog growth" when proposals increase and promotions=0', () => {
    const result = computeMemoryHealth(backlogGrowthRows, defaultThresholds);
    expect(result).not.toBeNull();
    expect(result).toMatch(/backlog growth/i);
  });

  // Test 5: recall_count=0 for 3 days triggers "recall usage" alert
  test('returns string containing "recall usage" for 3 consecutive days with recall_count=0', () => {
    const result = computeMemoryHealth(recallDropRows, defaultThresholds);
    expect(result).not.toBeNull();
    expect(result).toMatch(/recall usage/i);
  });

  // Test 6: total_entries unchanged triggers "vault plateau" alert
  test('returns string containing "vault plateau" for 3 consecutive days with same total_entries', () => {
    const result = computeMemoryHealth(vaultPlateauRows, defaultThresholds);
    expect(result).not.toBeNull();
    expect(result).toMatch(/vault plateau/i);
  });

  // Test 7: all-normal rows returns null
  test('returns null when all rows show normal operation', () => {
    const result = computeMemoryHealth(normalRows, defaultThresholds);
    expect(result).toBeNull();
  });

  // Test 8: missing column values treated as 0
  test('treats missing/undefined column values as 0', () => {
    const missingValueRows = [
      { date: '2026-04-23', proposals: undefined, promotions: undefined, total_entries: 100, recall_count: '' },
      { date: '2026-04-24', proposals: '', promotions: '', total_entries: 100, recall_count: undefined },
      { date: '2026-04-25', proposals: undefined, promotions: undefined, total_entries: 100, recall_count: '' },
    ];
    // With all promotions missing (treated as 0) and total_entries unchanged, should trigger alerts
    const result = computeMemoryHealth(missingValueRows, defaultThresholds);
    expect(result).not.toBeNull();
    // Should trigger zero promotions (undefined -> 0) and vault plateau
    expect(result).toMatch(/zero promotions/i);
  });

  // Test 9: multiple anomalies in same dataset mentions all triggered conditions
  test('returns string mentioning all triggered conditions when multiple anomalies exist', () => {
    // Rows where both zero promotions AND recall drop AND vault plateau occur
    const multiAnomalyRows = [
      { date: '2026-04-23', proposals: 2, promotions: 0, total_entries: 100, recall_count: 0 },
      { date: '2026-04-24', proposals: 3, promotions: 0, total_entries: 100, recall_count: 0 },
      { date: '2026-04-25', proposals: 4, promotions: 0, total_entries: 100, recall_count: 0 },
    ];
    const result = computeMemoryHealth(multiAnomalyRows, defaultThresholds);
    expect(result).not.toBeNull();
    expect(result).toMatch(/zero promotions/i);
    expect(result).toMatch(/recall usage/i);
    expect(result).toMatch(/vault plateau/i);
  });

  // Test 10: custom streakDays=5 requires 5 consecutive days to trigger
  test('respects custom streakDays=5 — does not alert on fewer than 5 days', () => {
    // 3 rows of zero promotions — should NOT trigger with streakDays=5
    const thresholds5 = { enabled: true, streakDays: 5 };
    const result = computeMemoryHealth(zeroPromotionRows, thresholds5);
    expect(result).toBeNull();
  });

  // Test 11: custom streakDays=5 does trigger with 5+ days
  test('respects custom streakDays=5 — triggers alert with exactly 5 matching rows', () => {
    const fiveZeroPromotionRows = [
      { date: '2026-04-21', proposals: 1, promotions: 0, total_entries: 100, recall_count: 2 },
      { date: '2026-04-22', proposals: 2, promotions: 0, total_entries: 102, recall_count: 1 },
      { date: '2026-04-23', proposals: 1, promotions: 0, total_entries: 104, recall_count: 3 },
      { date: '2026-04-24', proposals: 2, promotions: 0, total_entries: 106, recall_count: 2 },
      { date: '2026-04-25', proposals: 3, promotions: 0, total_entries: 108, recall_count: 1 },
    ];
    const thresholds5 = { enabled: true, streakDays: 5 };
    const result = computeMemoryHealth(fiveZeroPromotionRows, thresholds5);
    expect(result).not.toBeNull();
    expect(result).toMatch(/zero promotions/i);
  });

  // Test 12: disabled config returns null
  test('returns null when thresholds.enabled is false', () => {
    const result = computeMemoryHealth(zeroPromotionRows, { enabled: false, streakDays: 3 });
    expect(result).toBeNull();
  });

  // Test 13: null/undefined thresholds returns null
  test('returns null when thresholds is null', () => {
    const result = computeMemoryHealth(zeroPromotionRows, null);
    expect(result).toBeNull();
  });

});

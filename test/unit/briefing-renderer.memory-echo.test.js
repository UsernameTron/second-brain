'use strict';

/**
 * test/unit/briefing-renderer.memory-echo.test.js
 *
 * Memory Echo rendering in briefing-renderer (Phase 18, Plan 05).
 *
 * Contract (ROADMAP SC4):
 *   - When memoryEcho.entries.length > 0 → "## Memory Echo" heading + numbered
 *     entries appear between "## Frog" and "## GitHub".
 *   - When memoryEcho.entries.length === 0 → heading absent, body absent.
 *     The briefing MUST NOT contain the string "## Memory Echo" at all.
 */

const { renderBriefing } = require('../../src/today/briefing-renderer');

function baseData(overrides = {}) {
  return {
    date: new Date('2026-04-24T10:00:00Z'),
    sourceHealth: {
      sources: { calendar: 'ok', gmail: 'ok', github: 'ok', pipeline: 'ok' },
      degradedCount: 0,
    },
    connectorResults: {
      calendar: {
        success: true, data: [], error: null, source: 'calendar',
        fetchedAt: new Date().toISOString(),
      },
      gmail: {
        success: true, data: [], error: null, source: 'gmail',
        fetchedAt: new Date().toISOString(),
      },
      github: {
        success: true, data: { repos: [], warnings: [] }, error: null, source: 'github',
        fetchedAt: new Date().toISOString(),
      },
    },
    pipelineState: {
      proposalCount: 0,
      deadLetter: { pending: 0, frozen: 0, total: 0, warning: false },
      ok: true,
      error: null,
    },
    slippage: { projects: [], warnings: [] },
    frog: { frog: null, reasoning: 'none' },
    mode: 'dry-run',
    synthesis: '> synthesis line',
    ...overrides,
  };
}

describe('briefing-renderer Memory Echo section', () => {

  test('R1: entries.length > 0 → section heading and numbered entries render between Frog and GitHub', () => {
    const memoryEcho = {
      entries: [
        {
          category: 'DECISION',
          snippet: 'Adopted JWT with refresh rotation for web auth',
          sourceRef: 'file:decisions/auth',
          score: 0.82,
        },
        {
          category: 'LEARNING',
          snippet: 'Calendar events beyond 30 days cause API throttling',
          sourceRef: 'session:abc123de',
          score: 0.71,
        },
      ],
      score: 0.82,
    };
    const md = renderBriefing(baseData({ memoryEcho }));

    expect(md).toContain('## Memory Echo');
    expect(md).toMatch(/1\. \[DECISION\] Adopted JWT with refresh rotation for web auth \(file:decisions\/auth\)/);
    expect(md).toMatch(/2\. \[LEARNING\] Calendar events beyond 30 days cause API throttling \(session:abc123de\)/);

    // Ordering: Memory Echo must appear AFTER Frog and BEFORE GitHub.
    const frogIdx = md.indexOf('## Frog');
    const memIdx = md.indexOf('## Memory Echo');
    const ghIdx = md.indexOf('## GitHub');
    expect(frogIdx).toBeGreaterThan(-1);
    expect(memIdx).toBeGreaterThan(frogIdx);
    expect(ghIdx).toBeGreaterThan(memIdx);
  });

  test('R2: entries.length === 0 → heading absent entirely', () => {
    const md = renderBriefing(baseData({ memoryEcho: { entries: [], score: 0 } }));
    expect(md).not.toContain('## Memory Echo');
    // Frog and GitHub still present.
    expect(md).toContain('## Frog');
    expect(md).toContain('## GitHub');
  });

  test('R3: memoryEcho skipped (thrown error path) → heading absent, briefing still renders', () => {
    const md = renderBriefing(baseData({ memoryEcho: { entries: [], score: 0, skipped: true } }));
    expect(md).not.toContain('## Memory Echo');
    expect(md).toContain('## Frog');
    expect(md).toContain('## GitHub');
  });

  test('R4: memoryEcho undefined (backwards-compat) → heading absent, no crash', () => {
    const data = baseData();
    delete data.memoryEcho;
    expect(() => renderBriefing(data)).not.toThrow();
    const md = renderBriefing(data);
    expect(md).not.toContain('## Memory Echo');
  });

  test('R5: entries with missing fields → renders with UNKNOWN category and unknown source fallback', () => {
    const memoryEcho = {
      entries: [
        { snippet: 'partial entry' }, // no category, no sourceRef
      ],
      score: 0.7,
    };
    const md = renderBriefing(baseData({ memoryEcho }));
    expect(md).toContain('## Memory Echo');
    expect(md).toMatch(/1\. \[UNKNOWN\] partial entry \(unknown\)/);
  });

});

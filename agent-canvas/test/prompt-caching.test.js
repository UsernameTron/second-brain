'use strict';
// Prompt caching + message-array trimming — the cost fix for the Radar
// poll-turn amplifier. Three claims: cache markers land where the API expects
// them (system + last message block) without mutating the caller's arrays,
// cache tokens are priced at their real rates (writes 1.25x, reads 0.1x),
// and an oversized tool result is capped before it enters the message array.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-caching-'));
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const { withCacheMarkers, costOf, PRICING } = require('../server/orchestrator/anthropic');
const { _internal } = require('../server/orchestrator/runner');

// ---------- withCacheMarkers ----------

test('system string becomes a cached text block; tools+system ride one breakpoint', () => {
  const out = withCacheMarkers({ system: 'You are an agent.', messages: [] });
  assert.deepStrictEqual(out.system, [
    { type: 'text', text: 'You are an agent.', cache_control: { type: 'ephemeral' } },
  ]);
});

test('string user message gets the moving breakpoint', () => {
  const messages = [{ role: 'user', content: 'find leads' }];
  const out = withCacheMarkers({ system: 's', messages });
  const last = out.messages[0].content[0];
  assert.strictEqual(last.text, 'find leads');
  assert.deepStrictEqual(last.cache_control, { type: 'ephemeral' });
});

test('tool_result batch: marker goes on the LAST block only, originals untouched', () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'text', text: 'calling' }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a', content: 'r1' },
      { type: 'tool_result', tool_use_id: 'b', content: 'r2' },
    ] },
  ];
  const out = withCacheMarkers({ system: 's', messages });
  const blocks = out.messages[1].content;
  assert.strictEqual(blocks[0].cache_control, undefined);
  assert.deepStrictEqual(blocks[1].cache_control, { type: 'ephemeral' });
  // no mutation of the run loop's live arrays — a marker left behind would
  // stack a second marker (and a stale prefix) on the next step
  assert.strictEqual(messages[1].content[1].cache_control, undefined);
  assert.strictEqual(typeof messages[0].content, 'object');
});

test('unmarkable trailing block (server tool) is left alone rather than rejected by the API', () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'server_tool_use', id: 'x', name: 'web_search', input: {} }] },
  ];
  const out = withCacheMarkers({ system: 's', messages });
  assert.strictEqual(out.messages, messages);
  assert.strictEqual(out.messages[0].content[0].cache_control, undefined);
});

// ---------- costOf cache pricing ----------

test('cache writes bill at 1.25x input, reads at 0.1x', () => {
  const price = PRICING['claude-sonnet-5']; // in: 3
  const usage = {
    input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    output_tokens: 0,
  };
  const expected = price.in * (1 + 1.25 + 0.1);
  assert.ok(Math.abs(costOf('claude-sonnet-5', usage) - expected) < 1e-9,
    `expected ${expected}, got ${costOf('claude-sonnet-5', usage)}`);
});

test('a fully-cached-read step costs ~10% of an uncached one', () => {
  const uncached = costOf('claude-sonnet-5', { input_tokens: 280_000 });
  const cached = costOf('claude-sonnet-5', { input_tokens: 0, cache_read_input_tokens: 280_000 });
  assert.ok(Math.abs(cached / uncached - 0.1) < 1e-9);
});

// ---------- tool-result cap ----------

test('small tool results pass through untouched', () => {
  assert.strictEqual(_internal.capToolResult('ok'), 'ok');
});

test('oversized tool result is capped with head, tail, and a truncation note', () => {
  const big = 'a'.repeat(_internal.TOOL_RESULT_CHAR_CAP + 100_000);
  const capped = _internal.capToolResult(big);
  assert.ok(capped.length < big.length);
  assert.ok(capped.length <= _internal.TOOL_RESULT_CHAR_CAP + 200, `capped len ${capped.length}`);
  assert.match(capped, /truncated \d+ chars/);
  assert.ok(capped.startsWith('a') && capped.endsWith('a'));
});

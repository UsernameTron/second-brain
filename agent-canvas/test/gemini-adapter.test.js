'use strict';
// Offline tests for the Gemini adapter's translation layer — the part that can
// be verified without Google credentials. The live call path gets its first
// exercise at deploy (documented in docs/DEPLOY.md).

const test = require('node:test');
const assert = require('node:assert');

process.env.VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || 'test-project';
const { toContents, toFunctionDeclarations, fromGeminiResponse, nameFromToolId } = require('../server/orchestrator/gemini');

test('tool definitions translate to function declarations; server tools are dropped', () => {
  const decls = toFunctionDeclarations([
    { name: 'memory_write', description: 'write', input_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }, // server tool: no input_schema
  ]);
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, 'memory_write');
  assert.equal(decls[0].parameters.required[0], 'content');
});

test('message history round-trips: text, tool_use, tool_result with name recovery', () => {
  const contents = toContents([
    { role: 'user', content: 'check row 4' },
    { role: 'assistant', content: [
      { type: 'text', text: 'checking' },
      { type: 'tool_use', id: 'read_rows:abc1', name: 'read_rows', input: { status: 'pending' } },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'read_rows:abc1', content: '[{"row_index":4}]', is_error: false },
    ] },
  ]);
  assert.equal(contents.length, 3);
  assert.deepEqual(contents[0], { role: 'user', parts: [{ text: 'check row 4' }] });
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[1].parts[1].functionCall.name, 'read_rows');
  assert.deepEqual(contents[1].parts[1].functionCall.args, { status: 'pending' });
  assert.equal(contents[2].parts[0].functionResponse.name, 'read_rows'); // name recovered from the id
  assert.match(contents[2].parts[0].functionResponse.response.result, /row_index/);
  assert.equal(nameFromToolId('memory_write:xk93j2'), 'memory_write');
});

test('error tool results become error responses', () => {
  const contents = toContents([
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'escalate:z9', content: 'Workspace is paused', is_error: true }] },
  ]);
  assert.equal(contents[0].parts[0].functionResponse.response.error, 'Workspace is paused');
});

test('responses synthesize Anthropic-shaped output: function calls -> tool_use + stop_reason', () => {
  const out = fromGeminiResponse({
    candidates: [{ finishReason: 'STOP', content: { parts: [
      { text: 'I will write this to memory.' },
      { functionCall: { name: 'memory_write', args: { content: 'fact', epistemic: 'verified', source: 'row 4' } } },
    ] } }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45, thoughtsTokenCount: 10 },
  }, 'gemini-2.5-flash');
  assert.equal(out.stop_reason, 'tool_use');
  assert.equal(out.content[0].type, 'text');
  assert.equal(out.content[1].type, 'tool_use');
  assert.equal(out.content[1].name, 'memory_write');
  assert.equal(nameFromToolId(out.content[1].id), 'memory_write'); // ids round-trip
  assert.equal(out.usage.input_tokens, 120);
  assert.equal(out.usage.output_tokens, 55); // includes thinking tokens
});

test('safety blocks map to refusal; token caps map to max_tokens', () => {
  assert.equal(fromGeminiResponse({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }, 'g').stop_reason, 'refusal');
  assert.equal(fromGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }, 'g').stop_reason, 'refusal');
  assert.equal(fromGeminiResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }, 'g').stop_reason, 'max_tokens');
  assert.equal(fromGeminiResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'done' }] } }] }, 'g').stop_reason, 'end_turn');
});

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
    { role: 'user', content: 'find the pricing decision' },
    { role: 'assistant', content: [
      { type: 'text', text: 'checking' },
      { type: 'tool_use', id: 'memory_search:abc1', name: 'memory_search', input: { query: 'pricing decision' } },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'memory_search:abc1', content: '[{"content":"Approved pricing"}]', is_error: false },
    ] },
  ]);
  assert.equal(contents.length, 3);
  assert.deepEqual(contents[0], { role: 'user', parts: [{ text: 'find the pricing decision' }] });
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[1].parts[1].functionCall.name, 'memory_search');
  assert.deepEqual(contents[1].parts[1].functionCall.args, { query: 'pricing decision' });
  assert.equal(contents[2].parts[0].functionResponse.name, 'memory_search'); // name recovered from the id
  assert.match(contents[2].parts[0].functionResponse.response.result, /Approved pricing/);
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
      { functionCall: { name: 'memory_write', args: { content: 'fact', epistemic: 'verified', source: 'uploaded document' } } },
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

test('buildConfig hardens the live call: safety, thinking budget, JSON opt-in', () => {
  const { buildConfig } = require('../server/orchestrator/gemini');
  const base = { system: 'sys', maxTokens: 1000, signal: undefined };

  const withTools = buildConfig({ ...base, functionDeclarations: [{ name: 't' }] });
  // Vertex default filters trip on ordinary commercial content — only
  // genuinely high-severity content may block.
  assert.equal(withTools.safetySettings.length, 4);
  assert.ok(withTools.safetySettings.every((s) => s.threshold === 'BLOCK_ONLY_HIGH'));
  // Thinking is bounded so it cannot eat the whole output budget.
  assert.equal(withTools.thinkingConfig.thinkingBudget, 2048);
  assert.ok(withTools.tools);
  assert.equal(withTools.responseMimeType, undefined); // tool calls stay free-form

  // JSON is explicit opt-in: parse routes get it, persona chats never do.
  const parse = buildConfig({ ...base, functionDeclarations: [], responseFormat: 'json' });
  assert.equal(parse.responseMimeType, 'application/json');
  const chat = buildConfig({ ...base, functionDeclarations: [] });
  assert.equal(chat.responseMimeType, undefined);
});

test('sanitizeSchema strips non-Gemini keywords from MCP tool schemas', () => {
  // Live failure 2026-08-19: an MCP connector tool carried "hidden" inside
  // properties and Vertex 400'd the whole request (every tool, every run).
  const dirty = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', description: 'query', hidden: true, default: '' },
      opts: { properties: { deep: { type: 'boolean', hidden: false } }, required: ['deep'] },
      tags: { type: 'array', items: { type: 'string', examples: ['a'] } },
    },
    required: ['q'],
  };
  const decls = toFunctionDeclarations([{ name: 'mcp_tool', description: 'd', input_schema: dirty }]);
  const p = decls[0].parameters;
  assert.equal(JSON.stringify(p).includes('hidden'), false);
  assert.equal(JSON.stringify(p).includes('default'), false);
  assert.equal(JSON.stringify(p).includes('additionalProperties'), false);
  assert.equal(JSON.stringify(p).includes('$schema'), false);
  assert.equal(JSON.stringify(p).includes('examples'), false);
  // Structure the model needs survives intact.
  assert.equal(p.type, 'object');
  assert.deepEqual(p.required, ['q']);
  assert.equal(p.properties.q.type, 'string');
  assert.equal(p.properties.opts.type, 'object'); // inferred for bare properties
  assert.deepEqual(p.properties.opts.required, ['deep']);
  assert.equal(p.properties.tags.items.type, 'string');
});

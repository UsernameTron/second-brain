'use strict';
// Gemini-on-Vertex adapter. Speaks the same contract as the Claude path:
// callGemini() takes the orchestrator's Anthropic-shaped request (messages
// with content blocks, tools with input_schema) and returns an
// Anthropic-shaped response (content blocks, stop_reason, usage), so the run
// loop, budgets, pause epochs, and cost metering all work unchanged.
//
// Keyless like the Claude-on-Vertex path: the google-genai client runs in
// Vertex mode against VERTEX_PROJECT_ID with Application Default Credentials.
//
// Deliberate v1 limits (documented in docs/DEPLOY.md):
// - No web search on Gemini agents (Google grounding has a different result
//   shape; research agents keep web search only on Claude providers).
// - Safety blocks map to stop_reason "refusal" so the existing escalation
//   path handles them; there is no cross-model refusal fallback here.

let clientPromiseCache = null;

function getGeminiClient() {
  if (clientPromiseCache) return clientPromiseCache;
  const { GoogleGenAI } = require('@google/genai');
  if (!process.env.VERTEX_PROJECT_ID) {
    throw new Error('Gemini provider requires VERTEX_PROJECT_ID (keyless Vertex mode)');
  }
  clientPromiseCache = new GoogleGenAI({
    vertexai: true,
    project: process.env.VERTEX_PROJECT_ID,
    location: process.env.VERTEX_REGION || 'global',
  });
  return clientPromiseCache;
}

// Gemini accepts only an OpenAPI-ish subset of JSON Schema. The orchestrator's
// own schemas are clean, but MCP connector tools arrive with whatever their
// server emits ("hidden", "default", "additionalProperties", "$schema", ...)
// and one unknown key 400s the ENTIRE request — every tool, every run.
// Sanitize recursively: keep the accepted keys, drop the rest.
const SCHEMA_KEYS = ['type', 'description', 'enum', 'required', 'nullable'];
function sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = {};
  for (const key of SCHEMA_KEYS) if (schema[key] !== undefined) out[key] = schema[key];
  if (schema.items) out.items = sanitizeSchema(schema.items);
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = {};
    for (const [name, prop] of Object.entries(schema.properties)) out.properties[name] = sanitizeSchema(prop);
  }
  // A properties object with no type reads as an object schema; make it explicit.
  if (out.properties && !out.type) out.type = 'object';
  return out;
}

// Anthropic tool definitions -> Gemini function declarations.
function toFunctionDeclarations(tools) {
  return (tools || [])
    .filter((tool) => tool.input_schema) // server tools (web_search etc.) never reach here
    .map((tool) => ({ name: tool.name, description: tool.description, parameters: sanitizeSchema(tool.input_schema) }));
}

// tool_use ids must round-trip to function NAMES for functionResponse parts.
function toolIdFor(name, index) { return `${name}:${Date.now().toString(36)}${index}`; }
function nameFromToolId(id) { return String(id).split(':')[0]; }

// Anthropic-shaped message history -> Gemini contents.
function toContents(messages) {
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    if (typeof message.content === 'string') {
      contents.push({ role, parts: [{ text: message.content }] });
      continue;
    }
    const parts = [];
    for (const block of message.content) {
      if (block.type === 'text') parts.push({ text: block.text });
      else if (block.type === 'tool_use') parts.push({ functionCall: { name: block.name, args: block.input || {} } });
      else if (block.type === 'tool_result') {
        const name = nameFromToolId(block.tool_use_id);
        const payload = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        parts.push({ functionResponse: { name, response: block.is_error ? { error: payload } : { result: payload } } });
      }
      // server-tool blocks (server_tool_use etc.) never occur on the gemini path
    }
    if (parts.length) contents.push({ role, parts });
  }
  return contents;
}

// Gemini response -> Anthropic-shaped response object.
function fromGeminiResponse(response, model) {
  const candidate = (response.candidates && response.candidates[0]) || {};
  const parts = (candidate.content && candidate.content.parts) || [];
  const content = [];
  let callIndex = 0;
  for (const part of parts) {
    if (part.text) content.push({ type: 'text', text: part.text });
    else if (part.functionCall) {
      content.push({ type: 'tool_use', id: toolIdFor(part.functionCall.name, callIndex++), name: part.functionCall.name, input: part.functionCall.args || {} });
    }
  }
  const finish = String(candidate.finishReason || '').toUpperCase();
  let stopReason;
  if (content.some((b) => b.type === 'tool_use')) stopReason = 'tool_use';
  else if (finish === 'MAX_TOKENS') stopReason = 'max_tokens';
  else if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST' || (response.promptFeedback && response.promptFeedback.blockReason)) stopReason = 'refusal';
  else stopReason = 'end_turn';
  const usage = response.usageMetadata || {};
  return {
    model,
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
    },
  };
}

// Vertex default safety filters trip on ordinary commercial/CRM content
// (competitor analysis, disputes, churn), and a Gemini refusal is a hard
// halt with no cross-model fallback — so only genuinely high-severity
// content may block.
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

// Gemini 2.5 counts thinking against maxOutputTokens; unbounded, a
// reasoning-heavy turn can spend the whole budget thinking and return no
// text. 2048 keeps room for the actual answer.
const THINKING_BUDGET = 2048;

function buildConfig({ system, maxTokens, signal, functionDeclarations, responseFormat }) {
  const config = {
    systemInstruction: system,
    maxOutputTokens: maxTokens,
    abortSignal: signal,
    safetySettings: SAFETY_SETTINGS,
    thinkingConfig: { thinkingBudget: THINKING_BUDGET },
    // The Anthropic clients carry a 120s per-request timeout; this path had
    // none, so a hung Gemini request had no upper bound of its own. The
    // runner's deadline signal now covers it too, but a transport-level
    // ceiling means a stray caller without a signal cannot hang either.
    httpOptions: { timeout: 120_000 },
  };
  if (functionDeclarations.length) config.tools = [{ functionDeclarations }];
  // The route-level parses (builder proposal, rule parse, inquiry routing,
  // intent parse) JSON.parse the reply — when the caller declares that, ask
  // Gemini for JSON outright instead of relying on brace-slicing prose.
  // Explicit opt-in only: a tool-less persona chat must stay prose.
  else if (responseFormat === 'json') config.responseMimeType = 'application/json';
  return config;
}

async function callGemini({ model, system, messages, tools, maxTokens = 8192, signal, responseFormat }) {
  const client = getGeminiClient();
  const functionDeclarations = toFunctionDeclarations(tools);
  const config = buildConfig({ system, maxTokens, signal, functionDeclarations, responseFormat });
  const response = await client.models.generateContent({ model, contents: toContents(messages), config });
  return fromGeminiResponse(response, model);
}

module.exports = { callGemini, toContents, toFunctionDeclarations, fromGeminiResponse, nameFromToolId, buildConfig };

'use strict';
// Model access for agent runs, through one of two doors:
//
//   provider "vertex"    — Claude served on Google Cloud Vertex AI, inside the
//                          organization's perimeter. Keyless: authenticates with
//                          the runtime service account's Application Default
//                          Credentials; billed on the Google invoice.
//   provider "anthropic" — Anthropic's first-party API. ANTHROPIC_API_KEY
//                          (x-api-key) or an OAuth access token
//                          (Authorization: Bearer + oauth-2025-04-20 beta).
//
// Resolution: MODEL_PROVIDER wins; otherwise VERTEX_PROJECT_ID being set
// selects vertex; otherwise anthropic.
//
// Model routing by task weight is unchanged: the fast tier (claude-haiku-4-5)
// handles classification and intent parsing; the strong tier (claude-sonnet-5
// by default — the workhorse; frontier models opt-in via STRONG_MODEL) does
// the real agent work.

const Anthropic = require('@anthropic-ai/sdk');

const FAST_MODEL = process.env.FAST_MODEL || 'claude-haiku-4-5';
const STRONG_MODEL = process.env.STRONG_MODEL || 'claude-sonnet-5';
// Gemini tier models (used when a tier's provider is "gemini"). Check these
// against Google's current lineup at deploy time — they are config, not law.
const GEMINI_FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash';
const GEMINI_STRONG_MODEL = process.env.GEMINI_STRONG_MODEL || 'gemini-2.5-pro';
const REFUSAL_FALLBACK_MODEL = process.env.REFUSAL_FALLBACK_MODEL || 'claude-opus-4-8';
const WEB_SEARCH_COST_USD = 0.01; // $10 per 1,000 searches, billed per request

// USD per million tokens (input, output) at Anthropic first-party list rates.
// Vertex partner pricing differs slightly; treat metering as an estimate there
// (the authoritative number is the Google invoice).
const PRICING = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  // Gemini list-price estimates; the Google invoice is authoritative.
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
};
const DEFAULT_PRICE = { in: 5, out: 25 };

const PROVIDERS = ['vertex', 'anthropic', 'gemini'];

function currentProvider() {
  const explicit = (process.env.MODEL_PROVIDER || '').toLowerCase();
  if (PROVIDERS.includes(explicit)) return explicit;
  return process.env.VERTEX_PROJECT_ID ? 'vertex' : 'anthropic';
}

// Mixed fleets: each tier can run on its own provider (e.g. fast tier on
// Gemini Flash, strong tier on Claude). Defaults to the workspace provider.
function providerForTier(tier) {
  const env = (process.env[tier === 'fast' ? 'FAST_PROVIDER' : 'STRONG_PROVIDER'] || '').toLowerCase();
  return PROVIDERS.includes(env) ? env : currentProvider();
}

function tierConfig(tier) {
  const provider = providerForTier(tier);
  const model = provider === 'gemini'
    ? (tier === 'fast' ? GEMINI_FAST_MODEL : GEMINI_STRONG_MODEL)
    : (tier === 'fast' ? FAST_MODEL : STRONG_MODEL);
  return { provider, model };
}

// Vertex model IDs: current-generation models use the bare first-party ID;
// dated-snapshot models use an @-separated version.
const VERTEX_MODEL_IDS = {
  'claude-haiku-4-5': 'claude-haiku-4-5@20251001',
};
function vertexModelId(model) {
  return VERTEX_MODEL_IDS[model] || model;
}

// Strip a Vertex @date suffix so pricing lookups work for either provider.
function normalizeModelId(model) {
  return String(model || '').replace(/@\d+$/, '');
}

const clients = new Map();
function getClient(provider = currentProvider()) {
  if (clients.has(provider)) return clients.get(provider);
  let client;
  const common = { timeout: 120_000, maxRetries: 2 };
  if (provider === 'vertex') {
    const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');
    client = new AnthropicVertex({
      ...common,
      projectId: process.env.VERTEX_PROJECT_ID,
      region: process.env.VERTEX_REGION || 'global',
    });
  } else if (process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ ...common, apiKey: process.env.ANTHROPIC_API_KEY });
  } else if (process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN) {
    client = new Anthropic({
      ...common,
      authToken: process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN,
      defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    });
  } else {
    throw new Error('No model credential: set VERTEX_PROJECT_ID (Vertex, keyless) or ANTHROPIC_API_KEY (direct API)');
  }
  clients.set(provider, client);
  return client;
}

function modelForTier(tier) {
  return tier === 'fast' ? FAST_MODEL : STRONG_MODEL;
}

// Cache pricing (5-minute ephemeral): writes bill at 1.25x input, reads at 0.1x.
function costOf(model, usage) {
  const price = PRICING[normalizeModelId(model)] || DEFAULT_PRICE;
  const weightedInput = (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) * 1.25
    + (usage.cache_read_input_tokens || 0) * 0.1;
  const searches = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  return (weightedInput * price.in + (usage.output_tokens || 0) * price.out) / 1_000_000 + searches * WEB_SEARCH_COST_USD;
}

// Server-side web search for research work. On Vertex only the basic variant
// is served; on the first-party API the newer variant runs on non-Haiku models.
function webSearchToolFor(model, provider = currentProvider()) {
  const type = (provider === 'vertex' || /haiku/.test(model)) ? 'web_search_20250305' : 'web_search_20260209';
  return { type, name: 'web_search', max_uses: 5 };
}

// Prompt caching (Claude providers only): a breakpoint on the system prompt
// caches tools + system, and a moving breakpoint on the last message's last
// markable block caches the growing conversation prefix — the poll-turn
// re-send that made Radar expensive becomes a 0.1x cache read. Copies, never
// mutates, the caller's arrays. cache_control is only legal on some block
// types; anything else is left unmarked (the system breakpoint still applies).
const CACHEABLE_BLOCK_TYPES = new Set(['text', 'tool_result', 'tool_use', 'image', 'document']);
function withCacheMarkers({ system, messages }) {
  const ephemeral = { cache_control: { type: 'ephemeral' } };
  const sys = typeof system === 'string' && system
    ? [{ type: 'text', text: system, ...ephemeral }]
    : system;
  if (!messages || !messages.length) return { system: sys, messages };
  const last = messages[messages.length - 1];
  let content = last.content;
  if (typeof content === 'string') {
    content = [{ type: 'text', text: content, ...ephemeral }];
  } else if (Array.isArray(content) && content.length
      && CACHEABLE_BLOCK_TYPES.has(content[content.length - 1].type)) {
    content = [...content.slice(0, -1), { ...content[content.length - 1], ...ephemeral }];
  } else {
    return { system: sys, messages };
  }
  return { system: sys, messages: [...messages.slice(0, -1), { ...last, content }] };
}

// One model call. On a safety-classifier refusal (stop_reason "refusal"),
// retries once on the fallback model; if that also refuses, the caller sees
// stop_reason "refusal" and escalates.
async function callModel({ provider = currentProvider(), model, system, messages, tools, maxTokens = 8192, signal, responseFormat }) {
  if (provider === 'gemini') {
    const { callGemini } = require('./gemini');
    return callGemini({ model, system, messages, tools, maxTokens, signal, responseFormat });
  }
  const anthropic = getClient(provider);
  const onVertex = provider === 'vertex';
  const wireModel = onVertex ? vertexModelId(model) : model;
  ({ system, messages } = withCacheMarkers({ system, messages }));
  const params = { model: wireModel, max_tokens: maxTokens, system, messages };
  if (tools && tools.length) params.tools = tools;
  let response = await anthropic.messages.create(params, { signal });
  if (response.stop_reason === 'refusal' && normalizeModelId(model) !== REFUSAL_FALLBACK_MODEL) {
    const fallbackModel = onVertex ? vertexModelId(REFUSAL_FALLBACK_MODEL) : REFUSAL_FALLBACK_MODEL;
    const retry = await anthropic.messages.create({ ...params, model: fallbackModel }, { signal });
    retry._refusalFallbackFrom = model;
    retry._priorUsage = response.usage;
    response = retry;
  }
  return response;
}

module.exports = {
  getClient, callModel, costOf, modelForTier, webSearchToolFor, withCacheMarkers,
  currentProvider, providerForTier, tierConfig, vertexModelId, normalizeModelId,
  FAST_MODEL, STRONG_MODEL, REFUSAL_FALLBACK_MODEL, PRICING,
};

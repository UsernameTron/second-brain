'use strict';
// Anthropic API access for agent runs.
//
// Credential resolution: ANTHROPIC_API_KEY (production, x-api-key header) or
// an OAuth access token (ANTHROPIC_OAUTH_TOKEN / ANTHROPIC_AUTH_TOKEN), which
// goes on Authorization: Bearer plus the oauth-2025-04-20 beta header.
//
// Model routing by task weight: the fast tier (claude-haiku-4-5) handles
// classification and intent parsing; the strong tier (claude-opus-5 by
// default) does the real agent work. Both are env-overridable.

const Anthropic = require('@anthropic-ai/sdk');

const FAST_MODEL = process.env.FAST_MODEL || 'claude-haiku-4-5';
const STRONG_MODEL = process.env.STRONG_MODEL || 'claude-opus-5';
const REFUSAL_FALLBACK_MODEL = process.env.REFUSAL_FALLBACK_MODEL || 'claude-opus-4-8';

// USD per million tokens (input, output).
const PRICING = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
};
const DEFAULT_PRICE = { in: 5, out: 25 };

let client = null;
function getClient() {
  if (client) return client;
  const common = { timeout: 120_000, maxRetries: 2 };
  if (process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ ...common, apiKey: process.env.ANTHROPIC_API_KEY });
  } else if (process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN) {
    client = new Anthropic({
      ...common,
      authToken: process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN,
      defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    });
  } else {
    throw new Error('No Anthropic credential: set ANTHROPIC_API_KEY (or ANTHROPIC_OAUTH_TOKEN for OAuth)');
  }
  return client;
}

function modelForTier(tier) {
  return tier === 'fast' ? FAST_MODEL : STRONG_MODEL;
}

function costOf(model, usage) {
  const price = PRICING[model] || DEFAULT_PRICE;
  const inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  return (inputTokens * price.in + (usage.output_tokens || 0) * price.out) / 1_000_000;
}

// One model call. On a safety-classifier refusal (stop_reason "refusal"),
// retries once on the fallback model; if that also refuses, the caller sees
// stop_reason "refusal" and escalates.
async function callModel({ model, system, messages, tools, maxTokens = 8192, signal }) {
  const anthropic = getClient();
  const params = { model, max_tokens: maxTokens, system, messages };
  if (tools && tools.length) params.tools = tools;
  let response = await anthropic.messages.create(params, { signal });
  if (response.stop_reason === 'refusal' && model !== REFUSAL_FALLBACK_MODEL) {
    const retry = await anthropic.messages.create({ ...params, model: REFUSAL_FALLBACK_MODEL }, { signal });
    retry._refusalFallbackFrom = model;
    retry._priorUsage = response.usage;
    response = retry;
  }
  return response;
}

module.exports = { getClient, callModel, costOf, modelForTier, FAST_MODEL, STRONG_MODEL, REFUSAL_FALLBACK_MODEL, PRICING };

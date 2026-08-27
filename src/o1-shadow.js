'use strict';

/**
 * o1-shadow.js — log-only shadow of the two local O1 arms (tuned + base).
 *
 * ctg-model-forge Phase 3 (ROADMAP 03-01). When the daily sweep passes
 * `o1Shadow: true` (it does so only under O1_SHADOW=1), extractFromTranscript
 * scores every 7-message window of the transcript with both arms and appends
 * one JSONL line per window to state/o1-shadow.jsonl. Nothing here changes what
 * the extractor sends or writes: the shim reads the transcript itself, talks to
 * LM Studio directly (not through classifyLocal, which has the Haiku fallback and
 * LLM_CLASSIFY logging), and every failure stays inside it.
 *
 * The parser and renderer are a port of ctg-model-forge/scripts/mine_o1.py
 * (load_transcript, build_window, user_message, SYSTEM_PROMPT_BINARY). They read
 * the nested `message.{role,content}` that real Claude Code transcripts carry —
 * NOT the flat `{role,content}` shouldExclude/buildCorpus read — so the arms see
 * exactly what they were trained on, and message indices match the miner's. The
 * forge's scripts/shadow_report.py anchors Connor's verdicts to a message index
 * over the untruncated transcript and joins on the logged `lo`/`hi`.
 */

const fs = require('fs');
const path = require('path');

// Verbatim: mine_o1.SYSTEM_PROMPT_BINARY after .format() (no categories in binary).
const SYSTEM_PROMPT_BINARY = [
  'You are a memory extraction assistant for a second-brain knowledge base. You read one excerpt of a working session transcript and decide one thing: is there something here worth remembering long-term?',
  '',
  'Never extract:',
  '- Routine actions (closing tickets, merging PRs, running tests)',
  '- Status updates carrying no decision or learning',
  '- Debugging steps that led nowhere',
  '- TODO items and task lists',
  '- Uninterpreted third-party quotes',
  '- Content matching the workspace vendor-exclusion list',
  '- Content already recorded verbatim in the knowledge base',
  '',
  'Reply with one JSON object and nothing else.',
  'To keep it:  {"decision": "extract"}',
  'To skip it:  {"decision": "reject"}',
].join('\n');

// forge configs/forge.config.json mining.* — the shape every training row had.
const BEFORE = 4;
const AFTER = 2;
const PER_MSG = 450;
const CAP = 1450;

// The production candidate at the time of writing, then the base it was tuned from.
const DEFAULT_MODELS = 'sb-extractor-4b-2026-08-27-3,qwen3.5-4b-mlx';
const DEFAULT_MAX_WINDOWS = 200;
// Whole-run wall-clock budget across every transcript of one sweep. At the
// measured ~2.3 s per window the sweep adds ~45 min; if LM Studio degrades to
// the 20 s abort on every call this is what keeps the 23:45 sweep from running
// into the 06:45 briefing.
const DEFAULT_BUDGET_MS = 90 * 60 * 1000;
const CALL_TIMEOUT_MS = 20_000;
// Consecutive windows on which EVERY arm failed (error/timeout/HTTP) before the
// transcript is abandoned — a dead endpoint costs 20 s per window per arm.
const DEAD_AFTER = 3;

// Python len()/slicing count code points; JS counts UTF-16 units. An emoji in a
// tool result would otherwise move the cut and break render parity with the miner.
const plen = (s) => Array.from(s).length;
const pslice = (s, n) => Array.from(s).slice(0, n).join('');

// json.dumps(v, ensure_ascii=False): ', ' and ': ' separators, unlike JSON.stringify.
// Known, unexercised divergences: Python prints integral floats as 1.0, and
// JS reorders integer-like object keys. 0 of 4,656 real tool_use inputs hit either.
function pyDumps(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(pyDumps).join(', ') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).map((k) => JSON.stringify(k) + ': ' + pyDumps(v[k])).join(', ') + '}';
  }
  return JSON.stringify(v);
}

/** mine_o1.load_transcript: flatten a transcript JSONL into [{role, text}]. */
function loadTranscript(file) {
  const msgs = [];
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return msgs;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const msg = obj && obj.message;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;
    const role = msg.role || obj.type || 'unknown';
    const content = msg.content;
    let text;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      const parts = [];
      for (const blk of content) {
        if (!blk || typeof blk !== 'object' || Array.isArray(blk)) continue;
        if (blk.type === 'text') {
          parts.push(blk.text || '');
        } else if (blk.type === 'tool_use') {
          parts.push('[tool_use ' + (blk.name || '?') + '] ' + pslice(pyDumps(blk.input), 800));
        } else if (blk.type === 'tool_result') {
          const cc = blk.content;
          if (typeof cc === 'string') {
            parts.push('[tool_result] ' + cc);
          } else if (Array.isArray(cc)) {
            parts.push('[tool_result] ' + cc
              .filter((b) => b && typeof b === 'object' && !Array.isArray(b))
              .map((b) => b.text || '').join('\n'));
          }
        }
      }
      text = parts.filter(Boolean).join('\n');
    } else {
      continue;
    }
    text = text.trim();
    if (text) msgs.push({ role, text });
  }
  return msgs;
}

function renderMsg(role, text, limit) {
  if (plen(text) > limit) text = pslice(text, limit) + ' …[truncated]';
  return '[' + role + '] ' + text;
}

/** mine_o1.build_window with no label: anchor cut is a plain prefix. */
function buildWindow(msgs, idx) {
  let lo = Math.max(0, idx - BEFORE);
  let hi = Math.min(msgs.length, idx + AFTER + 1);
  for (;;) {
    const parts = [];
    for (let i = lo; i < hi; i++) parts.push(renderMsg(msgs[i].role, msgs[i].text, i === idx ? CAP : PER_MSG));
    const rendered = parts.join('\n\n');
    if (plen(rendered) <= CAP || (lo === idx && hi === idx + 1)) return { anchor: idx, text: rendered, lo, hi };
    // Shed the outermost message furthest from the anchor, never the anchor.
    if (idx - lo >= hi - 1 - idx && lo < idx) lo += 1;
    else if (hi - 1 > idx) hi -= 1;
    else return { anchor: idx, text: pslice(rendered, CAP), lo, hi };
  }
}

/** mine_o1.mine_empty_windows' tiling: anchors at 4, 11, 18, … (stride 7). */
function windows(msgs) {
  const out = [];
  for (let i = BEFORE; i < msgs.length - AFTER; i += BEFORE + AFTER + 1) out.push(buildWindow(msgs, i));
  return out;
}

function userMessage(sessionId, w) {
  return 'Session transcript excerpt (session ' + (sessionId || 'unknown') + ', messages ' + w.lo + '-' + (w.hi - 1) + '):\n\n'
    + '-----\n' + w.text + '\n-----\n\n'
    + 'Extract the memory worth keeping from this excerpt, or reject it.';
}

/** run_eval.leading_object: the first JSON object starting at the first '{',
 *  fences and prose around it ignored, nesting and braces inside strings allowed. */
function leadingObject(raw) {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  if (start < 0) return null;
  for (let end = raw.indexOf('}', start); end >= 0; end = raw.indexOf('}', end + 1)) {
    try {
      const o = JSON.parse(raw.slice(start, end + 1));
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch (_) { /* not closed yet — extend to the next brace */ }
  }
  return null;
}

function decisionOf(raw) {
  const o = leadingObject(raw);
  const d = o && o.decision;
  return d === 'extract' || d === 'reject' ? d : 'unparsed';
}

const FAILED = (a) => a.decision === 'error' || a.decision.startsWith('http_');

async function ask(endpoint, model, user) {
  const t0 = Date.now();
  try {
    const res = await fetch(endpoint + '/v1/chat/completions', { // eslint-disable-line no-undef
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 32,
        stream: false,
        messages: [{ role: 'system', content: SYSTEM_PROMPT_BINARY }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS), // eslint-disable-line no-undef
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { decision: 'http_' + res.status, ms };
    const body = await res.json();
    // LM Studio answers an UNKNOWN model id with whatever is loaded, HTTP 200,
    // and only the response's `model` says so. Measured 2026-08-27: the tuned
    // arm "answered" before it existed, with the base's decisions. Fail closed:
    // anything but the exact id asked for is never scored.
    const served = body && body.model;
    if (served !== model) return { decision: 'wrong_model', served: typeof served === 'string' ? served : null, ms };
    return { decision: decisionOf(body.choices?.[0]?.message?.content), ms };
  } catch (err) {
    return { decision: 'error', ms: Date.now() - t0, error: String((err && err.message) || err).slice(0, 120) };
  }
}

function localEndpoint() {
  try {
    return require('./pipeline-infra').loadPipelineConfig().classifier.llm.localEndpoint || 'http://localhost:1234';
  } catch (_) {
    return 'http://localhost:1234';
  }
}

/** Highest `hi` already logged for this session: a resumed session (same path,
 *  new mtime, re-swept every night) pays only for the windows it has grown. */
function loggedHi(logPath, sessionId) {
  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch (_) {
    return 0;
  }
  let hi = 0;
  for (const line of raw.split('\n')) {
    if (!line.includes(sessionId)) continue;
    try {
      const r = JSON.parse(line);
      if (r.session === sessionId && r.hi > hi) hi = r.hi;
    } catch (_) { /* torn line */ }
  }
  return hi;
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

let deadline = null; // one budget per process, i.e. per sweep

/**
 * Score every window of one transcript with every arm, one log line per window.
 * Both arms run concurrently per window; windows run in order.
 */
async function shadow(transcriptPath, sessionId, opts = {}) {
  if (deadline === null) deadline = Date.now() + (opts.budgetMs || envInt('O1_SHADOW_BUDGET_MS', DEFAULT_BUDGET_MS));
  if (Date.now() > deadline) return { skipped: 'budget' };
  const models = (opts.models || process.env.O1_SHADOW_MODELS || DEFAULT_MODELS)
    .split(',').map((s) => s.trim()).filter(Boolean);
  const max = opts.maxWindows || envInt('O1_SHADOW_MAX_WINDOWS', DEFAULT_MAX_WINDOWS);
  const endpoint = opts.endpoint || localEndpoint();
  const logPath = opts.logPath || process.env.O1_SHADOW_LOG || path.join(__dirname, '..', 'state', 'o1-shadow.jsonl');
  const msgs = loadTranscript(transcriptPath);
  const startAt = loggedHi(logPath, sessionId);
  const wins = windows(msgs).filter((w) => w.lo >= startAt).slice(0, max);
  if (wins.length) fs.mkdirSync(path.dirname(logPath), { recursive: true });
  let done = 0;
  let dead = 0;
  for (const w of wins) {
    if (Date.now() > deadline) break;
    const user = userMessage(sessionId, w);
    const answers = await Promise.all(models.map((m) => ask(endpoint, m, user)));
    const arms = {};
    models.forEach((m, i) => { arms[m] = answers[i]; });
    fs.appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      session: sessionId,
      anchor: w.anchor,
      lo: w.lo,
      hi: w.hi,
      bytes: Buffer.byteLength(w.text, 'utf8'),
      text: w.text,
      arms,
    }) + '\n');
    done++;
    dead = answers.every(FAILED) ? dead + 1 : 0;
    if (dead >= DEAD_AFTER) break;
  }
  return { messages: msgs.length, windows: wins.length, done, resumedFrom: startAt };
}

module.exports = {
  SYSTEM_PROMPT_BINARY,
  loadTranscript,
  buildWindow,
  windows,
  userMessage,
  leadingObject,
  decisionOf,
  shadow,
};

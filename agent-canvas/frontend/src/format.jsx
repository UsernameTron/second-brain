import React from 'react';
import { short } from './api.js';

// Shared display formatting for model-generated text. Presentation only:
// nothing in here mutates what the API returned — stored summaries and the
// standing-rule contract line stay intact in storage and responses; these
// helpers decide how they LOOK.

// ponytail: headings, bullets, ordered lists, bold, paragraphs — the subset
// summaries actually use. Everything renders as React text nodes (no HTML
// injection, never dangerouslySetInnerHTML); add a real renderer if output
// ever needs tables or links.
// Markdown bold sits on a word boundary; `2**8` is an exponent operator that
// happens to contain the same characters. Requiring the opener to start the
// string or follow whitespace/opening punctuation — and the closer to end it
// or precede whitespace/closing punctuation — separates the two. Without this
// "2**8 and 3**9" bolded "8 and 3" and previews rendered it "28 and 39".
// No lookbehind (older Safari): the boundary char is captured and re-emitted.
const BOLD_RE = /(^|[\s([{"'—–-])\*\*(\S(?:(?:[^*]|\*(?!\*))*?[^\s*])?)\*\*(?=$|[\s)\]}"'.,;:!?—–-])/g;

export function boldSpans(text) {
  const s = String(text);
  const out = [];
  let last = 0;
  for (const m of s.matchAll(BOLD_RE)) {
    const open = m.index + m[1].length; // keep the boundary char as plain text
    if (open > last) out.push(s.slice(last, open));
    out.push(<b key={open}>{m[2]}</b>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length ? out : [s];
}

// Domain-neutral markdown-subset renderer. It does NOT strip standing-rule
// contract lines — callers that want that pass the text through
// formatContractTail first, because only the call site knows the provenance.
export function SummaryMarkdown({ text, className = '' }) {
  const blocks = [];
  let list = null;
  let listTag = 'ul';
  const flush = () => {
    if (list) {
      blocks.push(React.createElement(listTag, { key: `l${blocks.length}`, className: 'md-list' }, list));
      list = null;
    }
  };
  String(text || '').split(/\r\n|\r|\n/).forEach((line, i) => {
    const t = line.trim();
    const ol = t.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (ol || /^[-*]\s+/.test(t)) {
      const tag = ol ? 'ol' : 'ul';
      if (list && listTag !== tag) flush();
      listTag = tag;
      // value keeps the source numbering ("3. check X" stays 3, not 1).
      (list = list || []).push(
        ol
          ? <li key={i} value={Number(ol[1])}>{boldSpans(ol[2])}</li>
          : <li key={i}>{boldSpans(t.replace(/^[-*]\s+/, ''))}</li>,
      );
      return;
    }
    flush();
    if (!t) return;
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    // # → h4 … #### → h6: model output never gets page-sized headings.
    if (h) blocks.push(React.createElement(`h${Math.min(6, h[1].length + 3)}`, { key: i }, boldSpans(h[2])));
    else blocks.push(<p key={i}>{boldSpans(t)}</p>);
  });
  flush();
  return <div className={`summary-markdown${className ? ` ${className}` : ''}`}>{blocks}</div>;
}

// The standing-rule machine contract ("MATCHED: <n>" / "NOTHING MATCHED" as
// the trailing token of the final nonblank line — server/standing-rules.js).
// \b keeps UNMATCHED intact. Display-time only; parseMatchedCount reads the
// stored summary, never this.
const CONTRACT_RE = /\bMATCHED:\s*(\d+)|\bNOTHING\s+MATCHED\b/gi;

// mode: 'preserve' (unchanged), 'strip' (known rule surfaces where the count
// is already shown elsewhere), 'humanize' (generic surfaces — keep the
// meaning: "MATCHED: 2" → "2 items matched."). Anything ambiguous — token
// mid-prose, multiple/contradictory markers on the final line — is left
// unchanged, mirroring the backend's treat-as-unknown stance.
export function formatContractTail(text, mode = 'preserve') {
  const s = String(text ?? '');
  if (mode === 'preserve' || !s) return s;
  const lines = s.split(/\r\n|\r|\n/);
  let li = lines.length - 1;
  while (li >= 0 && !lines[li].trim()) li--;
  if (li < 0) return s;
  const line = lines[li];
  const matches = [...line.matchAll(CONTRACT_RE)];
  if (matches.length !== 1) return s;
  const m = matches[0];
  if (/[^\s.]/.test(line.slice(m.index + m[0].length))) return s; // prose after the token
  const before = line.slice(0, m.index).replace(/\s+$/, '');
  let replaced = before;
  if (mode === 'humanize') {
    const n = m[1] != null ? Number(m[1]) : null;
    const human = n == null ? 'Nothing matched.' : `${n} item${n === 1 ? '' : 's'} matched.`;
    replaced = before ? `${before} ${human}` : human;
  }
  const out = lines.slice(0, li);
  if (replaced) out.push(replaced);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

// Markdown-shaped text → one line of prose for compact previews. No internal
// truncation — call sites keep their existing short() caps.
export function plainPreview(text) {
  return String(text ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l
      .replace(/^\s*#{1,4}\s+/, '')
      .replace(/^\s*(?:[-*]|\d{1,3}[.)])\s+/, '')
      // Same boundary rule as boldSpans: strip bold markers, keep operators.
      .replace(BOLD_RE, '$1$2')
      .trim())
    .filter(Boolean)
    .join(' · ');
}

// ponytail: one nested level, bounded field counts — deepen only if previews
// ever need it.
const MAX_FIELDS = 12;
const MAX_SUBFIELDS = 6;

function isScalar(v) {
  return v == null || ['string', 'number', 'boolean'].includes(typeof v);
}
function scalarLabel(v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return short(String(v), 80);
}
function fieldLabel(key) {
  return String(key).replace(/_/g, ' ');
}
function boundedDesc(v) {
  const n = Array.isArray(v) ? v.length : Object.keys(v).length;
  if (!n) return '(none)';
  const noun = Array.isArray(v) ? 'item' : 'field';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
// "3 items" names nothing. Pull an identifying scalar so a bounded preview of
// a list of records still says WHICH records. Only non-null, non-blank strings
// and numbers qualify; anything unrepresented is counted in the remainder.
const ID_KEYS = ['name', 'title', 'label', 'deal_name', 'subject', 'email', 'id', 'key'];
function identifierOf(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const usable = (x) => (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x.trim());
  for (const k of ID_KEYS) if (usable(o[k])) return String(o[k]).trim();
  for (const val of Object.values(o)) if (usable(val)) return String(val).trim();
  return null;
}
const MAX_IDS = 3;
function arrayLabel(v) {
  if (!v.length) return '(none)'; // an empty array rendered as blank read as "missing"
  if (v.every(isScalar)) return short(v.map(scalarLabel).join(', '), 80);
  const ids = [];
  for (const item of v) {
    if (ids.length >= MAX_IDS) break;
    const id = identifierOf(item);
    if (id) ids.push(id);
  }
  if (!ids.length) return boundedDesc(v); // nothing identifiable — "N items" is the honest answer
  const rest = v.length - ids.length;
  // Reserve the suffix's width and truncate only the identifiers. Capping the
  // joined string instead let long names eat "+N more", so a bounded preview
  // silently claimed to list everything.
  const suffix = rest > 0 ? `, +${rest} more` : '';
  return `${short(ids.join(', '), Math.max(8, 80 - suffix.length))}${suffix}`;
}

// Run-event previews slice tool results to 600 chars BEFORE they reach the
// browser (server/orchestrator/runner.js recordEvent), so a structured result
// can arrive as a cut-off JSON prefix that will never parse.
//
// Recovering it by regex was wrong twice over: splitting an array body on
// commas corrupts "New York, NY", and a pattern cannot tell an escaped quote
// from a closing one. This is an incremental JSON scanner instead. It returns
// the longest SYNTACTICALLY VALID prefix and only when the input ran out
// mid-structure — a genuine syntax error, or valid JSON followed by prose,
// returns null so the caller leaves the text alone.
const TRUNCATED_MARK = '… (result truncated)';
const BAD = Symbol('bad-json');

function scanJsonPrefix(src) {
  let i = 0;
  let truncated = false;
  const cut = () => { truncated = true; return undefined; };
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i += 1; };

  // Escape-aware. On a cut mid-string the content so far is kept: the caller
  // shows "deal name: Acme Cor" rather than dropping the field entirely.
  const parseString = () => {
    i += 1;
    let out = '';
    const ESC = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        const e = src[i + 1];
        if (e === undefined) { truncated = true; return out; }
        if (e === 'u') {
          const hex = src.slice(i + 2, i + 6);
          if (hex.length < 4) { truncated = true; return out; }
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return BAD;
          out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue;
        }
        if (!(e in ESC)) return BAD;
        out += ESC[e]; i += 2; continue;
      }
      if (c === '"') { i += 1; return out; }
      if (c < ' ') return BAD; // raw control char is invalid JSON
      out += c; i += 1;
    }
    truncated = true;
    return out;
  };

  // A number is only accepted once a delimiter proves the token ended. When
  // the cut lands inside it the RAW token is kept, so "1.5e" can never be
  // read as 1.5 — it renders as the fragment it is.
  const NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  const parseNumber = () => {
    const start = i;
    while (i < src.length && /[-+0-9.eE]/.test(src[i])) i += 1;
    const tok = src.slice(start, i);
    if (i >= src.length) { truncated = true; return tok; }
    if (!NUM.test(tok) || !/[\s,}\]]/.test(src[i])) return BAD;
    return Number(tok);
  };

  const LITERALS = [['true', true], ['false', false], ['null', null]];
  const parseLiteral = () => {
    for (const [lit, val] of LITERALS) {
      if (src.startsWith(lit, i)) {
        const end = i + lit.length;
        if (end < src.length && !/[\s,}\]]/.test(src[end])) return BAD;
        i = end; return val;
      }
    }
    const rest = src.slice(i);
    if (rest && LITERALS.some(([lit]) => lit.startsWith(rest))) { i = src.length; return cut(); }
    return BAD;
  };

  const parseArray = () => {
    i += 1;
    const arr = [];
    ws();
    if (i >= src.length) return cut() || arr;
    if (src[i] === ']') { i += 1; return arr; }
    for (;;) {
      const v = parseValue();
      if (v === BAD) return BAD;
      if (v !== undefined) arr.push(v);
      if (truncated) return arr;
      ws();
      if (i >= src.length) { truncated = true; return arr; }
      if (src[i] === ',') { i += 1; ws(); if (i >= src.length) { truncated = true; return arr; } continue; }
      if (src[i] === ']') { i += 1; return arr; }
      return BAD;
    }
  };

  const parseObject = () => {
    i += 1;
    // A normal object's legacy __proto__ setter would change this temporary
    // object's prototype instead of storing an own field. A null-prototype object
    // preserves __proto__ as ordinary display data.
    const obj = Object.create(null);
    ws();
    if (i >= src.length) return cut() || obj;
    if (src[i] === '}') { i += 1; return obj; }
    for (;;) {
      ws();
      if (i >= src.length) { truncated = true; return obj; }
      if (src[i] !== '"') return BAD;
      const key = parseString();
      if (key === BAD) return BAD;
      if (truncated) return obj; // a half-read key names nothing
      ws();
      if (i >= src.length) { truncated = true; return obj; }
      if (src[i] !== ':') return BAD;
      i += 1; ws();
      if (i >= src.length) { truncated = true; return obj; }
      const v = parseValue();
      if (v === BAD) return BAD;
      if (v !== undefined) obj[key] = v;
      if (truncated) return obj;
      ws();
      if (i >= src.length) { truncated = true; return obj; }
      if (src[i] === ',') { i += 1; continue; }
      if (src[i] === '}') { i += 1; return obj; }
      return BAD;
    }
  };

  function parseValue() {
    ws();
    if (i >= src.length) return cut();
    const c = src[i];
    if (c === '"') { const r = parseString(); return r === BAD ? BAD : r; }
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    return parseLiteral();
  }

  ws();
  if (i >= src.length || (src[i] !== '{' && src[i] !== '[')) return null;
  const value = parseValue();
  if (value === BAD) return null;
  // Not truncated means this parsed cleanly to the end — JSON.parse would have
  // taken it — or there is trailing prose. Either way it is not our case.
  if (!truncated) return null;
  return value;
}

function salvageJsonish(s) {
  const scanned = scanJsonPrefix(s);
  if (scanned === null || scanned === undefined) return null;
  return [...humanizePayload(scanned), TRUNCATED_MARK];
}

// Structured payload → readable "label: value" lines, no JSON punctuation.
// Ordinary strings pass through unchanged; strings that ARE JSON objects or
// arrays get parsed and humanized; truncated JSON gets salvaged, not dumped.
// opts.full: unbounded depth and no per-value caps — for expanded detail
// views (escalation context) where omitting a nested field could hide the
// very thing the human is being asked to decide on. Default stays bounded
// for one-line previews.
export function humanizePayload(value, opts = {}) {
  const full = !!opts.full;
  let v = value;
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^[[{]/.test(t)) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === 'object') v = parsed;
      } catch {
        // The scanner itself decides whether this is truncated JSON; prose
        // that merely opens with a brace comes back null and stays untouched.
        const salvaged = salvageJsonish(t);
        if (salvaged) return salvaged;
      }
    }
    if (typeof v === 'string') return [v];
  }
  const scalar = full ? (x) => (x == null ? '—' : typeof x === 'boolean' ? (x ? 'yes' : 'no') : String(x)) : scalarLabel;
  if (isScalar(v)) return [scalar(v)];
  if (Array.isArray(v) && !v.length) return ['(none)'];
  if (Array.isArray(v) && v.every(isScalar)) return [full ? v.map(scalar).join(', ') : arrayLabel(v)];
  if (Array.isArray(v) && !full) return [arrayLabel(v)];

  if (full) {
    // Unbounded recursive walk: every leaf becomes its own "a / b / c: value"
    // line, arrays of scalars join inline, arrays of objects path by index.
    const lines = [];
    const walk = (node, path) => {
      if (isScalar(node)) { lines.push(`${path}: ${scalar(node)}`); return; }
      if (Array.isArray(node)) {
        if (!node.length) { lines.push(`${path}: (none)`); return; }
        if (node.every(isScalar)) { lines.push(`${path}: ${node.map(scalar).join(', ')}`); return; }
        node.forEach((item, i) => walk(item, `${path} / ${i + 1}`));
        return;
      }
      const entries = Object.entries(node);
      if (!entries.length) { lines.push(`${path}: (empty)`); return; }
      for (const [k, val] of entries) walk(val, path ? `${path} / ${fieldLabel(k)}` : fieldLabel(k));
    };
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, String(i + 1)));
    else for (const [k, val] of Object.entries(v)) walk(val, fieldLabel(k));
    return lines.length ? lines : ['(empty)'];
  }

  const lines = [];
  const entries = Object.entries(v);
  for (const [k, val] of entries.slice(0, MAX_FIELDS)) {
    if (isScalar(val)) { lines.push(`${fieldLabel(k)}: ${scalarLabel(val)}`); continue; }
    if (Array.isArray(val)) { lines.push(`${fieldLabel(k)}: ${arrayLabel(val)}`); continue; }
    const sub = Object.entries(val);
    if (!sub.length) { lines.push(`${fieldLabel(k)}: (none)`); continue; }
    for (const [sk, sv] of sub.slice(0, MAX_SUBFIELDS)) {
      lines.push(`${fieldLabel(k)} / ${fieldLabel(sk)}: ${isScalar(sv) ? scalarLabel(sv) : boundedDesc(sv)}`);
    }
    if (sub.length > MAX_SUBFIELDS) lines.push(`${fieldLabel(k)}: +${sub.length - MAX_SUBFIELDS} more`);
  }
  if (entries.length > MAX_FIELDS) lines.push(`+${entries.length - MAX_FIELDS} more fields`);
  return lines.length ? lines : ['(empty)'];
}

// Expanded detail views (escalation / attention context) render this. The
// container scrolls, so the only reason to bound it is pathological payloads —
// and when that bound bites it SAYS so, because a silent cut on the context a
// human is approving from is the failure this whole pass exists to stop.
const DETAIL_CHAR_CAP = 20_000;
export function humanizeDetail(value) {
  const lines = humanizePayload(value, { full: true });
  const text = lines.join('\n');
  if (text.length <= DETAIL_CHAR_CAP) return text;
  const kept = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length > DETAIL_CHAR_CAP) break;
    kept.push(l); used += l.length + 1;
  }
  return `${kept.join('\n')}\n… ${lines.length - kept.length} more field(s) not shown — open the source record`;
}

// Shared run-event preview text. Bucket/icon selection stays with the caller
// (ActivityDock); this owns only the words. Limits preserve each surface's
// previous caps.
const EVENT_LIMITS = {
  detail: { text: 220, toolIn: 160, toolOut: 180, mem: 180, esc: 180, instr: 180, sum: 150, err: 120, def: 180 },
  dock: { text: 160, toolIn: 110, toolOut: 130, mem: 130, esc: 130, instr: 110, sum: 100, err: 80, def: 100 },
  room: { text: 120, toolIn: 120, toolOut: 120, mem: 120, esc: 120, instr: 120, sum: 120, err: 120, def: 120 },
};

export function formatRunEventPreview(ev, variant = 'detail') {
  const L = EVENT_LIMITS[variant] || EVENT_LIMITS.detail;
  const p = ev.payload || {};
  // Run/event surfaces cannot see standing-rule provenance, so contract text
  // is humanized (meaning kept), never stripped.
  switch (ev.type) {
    case 'text':
      return short(plainPreview(formatContractTail(p.text, 'humanize')), L.text);
    case 'tool_call':
      return `${p.name}: ${short(humanizePayload(p.input || {}).join(' · '), L.toolIn)}`;
    case 'tool_result':
      return `${p.name} → ${short(humanizePayload(p.preview).join(' · '), L.toolOut)}${p.isError ? ' ⚠' : ''}`;
    case 'memory':
      return `[${p.epistemic || '?'}] ${short(plainPreview(p.content), L.mem)}`;
    case 'escalation':
      return `${p.kind || 'escalation'}: ${short(plainPreview(p.question), L.esc)}`;
    case 'run_started':
      return `${variant === 'dock' ? 'run started — ' : ''}${short(plainPreview(p.instruction), L.instr)}`;
    case 'run_finished': {
      const sum = p.summary ? ` — ${short(plainPreview(formatContractTail(p.summary, 'humanize')), L.sum)}` : '';
      const err = p.error ? ` ⚠ ${short(plainPreview(p.error), L.err)}` : '';
      return `${variant === 'dock' ? 'run ' : ''}${p.status}${sum}${err}`;
    }
    default:
      return `${variant === 'dock' ? `${ev.type} ` : ''}${short(humanizePayload(p).join(' · '), L.def)}`;
  }
}

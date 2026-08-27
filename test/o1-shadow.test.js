'use strict';

/**
 * o1-shadow.test.js — the window renderer must match ctg-model-forge's miner
 * on the nested `message.{role,content}` shape real transcripts carry.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const shadow = require('../src/o1-shadow');

const line = (type, role, content) => JSON.stringify({ type, uuid: 'u', message: { role, content } });

describe('o1-shadow window renderer', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'o1-shadow-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('flattens nested messages like the miner and tiles 7-message windows', () => {
    const p = path.join(tmpDir, 'aaaa1111.jsonl');
    fs.writeFileSync(p, [
      JSON.stringify({ type: 'bridge-session', sessionId: 'aaaa1111' }),      // no message: skipped
      JSON.stringify({ type: 'queue-operation', content: 'queued prompt, no message key' }),
      line('user', 'user', 'Please move the Suppliers folder under Vendors.'),
      line('assistant', 'assistant', [
        { type: 'thinking', thinking: 'never rendered' },
        { type: 'text', text: 'Checking the Nitro rules first.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls rules', n: 2 } },
      ]),
      line('user', 'user', [{ type: 'tool_result', content: [{ type: 'text', text: 'rule-a\nrule-b' }] }]),
      line('assistant', 'assistant', [{ type: 'text', text: 'Decision: the folder stays; every rule binds to its path.' }]),
      line('user', 'user', '  ok, record that as a constraint  '),
      line('assistant', 'assistant', [{ type: 'text', text: 'x'.repeat(500) }]),
      line('user', 'user', 'thanks, that is all for today'),
      line('assistant', 'assistant', 'Eighth message: outside the first window.'),
    ].join('\n') + '\n');

    const msgs = shadow.loadTranscript(p);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    // tool_use renders with Python json.dumps separators; thinking blocks are dropped.
    expect(msgs[1].text).toBe('Checking the Nitro rules first.\n[tool_use Bash] {"command": "ls rules", "n": 2}');
    expect(msgs[2].text).toBe('[tool_result] rule-a\nrule-b');
    expect(msgs[4].text).toBe('ok, record that as a constraint');

    const wins = shadow.windows(msgs);
    expect(wins).toHaveLength(1);                       // anchors at 4 only (11 > 8 - 2)
    expect(wins[0]).toMatchObject({ anchor: 4, lo: 0, hi: 7 });
    const parts = wins[0].text.split('\n\n');
    expect(parts).toHaveLength(7);
    expect(parts[0]).toBe('[user] Please move the Suppliers folder under Vendors.');
    // Non-anchor messages cut at 450 chars + the miner's marker; the anchor (index 4) is not.
    expect(parts[5]).toBe('[assistant] ' + 'x'.repeat(450) + ' …[truncated]');
    expect(shadow.userMessage('aaaa1111', wins[0])).toMatch(
      /^Session transcript excerpt \(session aaaa1111, messages 0-6\):\n\n-----\n\[user\] Please move/);
    expect(shadow.userMessage('aaaa1111', wins[0])).toMatch(/-----\n\nExtract the memory worth keeping from this excerpt, or reject it\.$/);
  });

  test('sheds the outermost messages until the window fits, never the anchor', () => {
    const msgs = Array.from({ length: 7 }, (_, i) => ({ role: 'user', text: (i === 4 ? 'A' : 'm').repeat(i === 4 ? 1400 : 300) }));
    const w = shadow.buildWindow(msgs, 4);
    expect(w).toMatchObject({ lo: 4, hi: 5 });          // only the anchor survives a 1400-char anchor
    expect(w.text.startsWith('[user] ' + 'A'.repeat(1400))).toBe(true);
  });

  test('reads the decision from the first JSON object, else unparsed', () => {
    expect(shadow.decisionOf('{"decision": "reject"}')).toBe('reject');
    expect(shadow.decisionOf('```json\n{"decision": "extract"}\n```\nbecause')).toBe('extract');
    expect(shadow.decisionOf('I would keep this.')).toBe('unparsed');
    expect(shadow.decisionOf('{"decision": "maybe"}')).toBe('unparsed');
    // run_eval.leading_object's rule: nesting and braces inside strings do not break it.
    expect(shadow.decisionOf('Sure. {"note": {"a": 1}, "decision": "reject"}')).toBe('reject');
    expect(shadow.decisionOf('{"x": "}", "decision": "extract"} trailing')).toBe('extract');
    expect(shadow.decisionOf('[{"decision": "reject"}]')).toBe('reject');
  });
});

describe('o1-shadow shadow() against a stubbed LM Studio', () => {
  let tmpDir;
  let realFetch;
  const transcriptWith = (n) => {
    const p = path.join(tmpDir, 'sess-1.jsonl');
    fs.writeFileSync(p, Array.from({ length: n }, (_, i) => line('user', 'user', 'message number ' + i + ' with enough words')).join('\n') + '\n');
    return p;
  };
  const reply = (model, content) => ({ ok: true, status: 200, json: async () => ({ model, choices: [{ message: { content } }] }) });
  const logged = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'o1-shadow-'));
    realFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.O1_SHADOW_MAX_WINDOWS;
    delete process.env.O1_SHADOW_LOG;
    delete process.env.O1_SHADOW_MODELS;
  });

  test('logs one line per window with both arms, flags a served model that differs, resumes past logged windows', async () => {
    const calls = [];
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.model);
      expect(body.messages[0].content).toBe(shadow.SYSTEM_PROMPT_BINARY);
      expect(body.max_tokens).toBe(32);
      if (body.model === 'tuned') return reply('tuned', '{"decision": "reject"}');
      return reply('whatever-is-loaded', '{"decision": "extract"}');   // LM Studio answered an unknown id
    });
    const file = transcriptWith(21);                                    // anchors 4, 11, 18
    const logPath = path.join(tmpDir, 'log.jsonl');
    const r = await shadow.shadow(file, 'sess-1', { models: 'tuned,base', endpoint: 'http://stub', logPath, maxWindows: 2 });
    expect(r).toMatchObject({ messages: 21, windows: 2, done: 2, resumedFrom: 0 });
    const rows = logged(logPath);
    expect(rows.map((x) => [x.anchor, x.lo, x.hi])).toEqual([[4, 0, 7], [11, 7, 14]]);
    expect(rows[0].session).toBe('sess-1');
    expect(rows[0].arms.tuned).toMatchObject({ decision: 'reject' });
    expect(rows[0].arms.base).toMatchObject({ decision: 'wrong_model', served: 'whatever-is-loaded' });
    expect(calls).toHaveLength(4);
    // A second pass over the same session only pays for the window past hi=14.
    const again = await shadow.shadow(file, 'sess-1', { models: 'tuned,base', endpoint: 'http://stub', logPath });
    expect(again).toMatchObject({ windows: 1, done: 1, resumedFrom: 14 });
    expect(logged(logPath).map((x) => x.lo)).toEqual([0, 7, 14]);
  });

  test('a dead endpoint costs at most three windows and never throws', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const file = transcriptWith(50);                                    // 7 windows
    const logPath = path.join(tmpDir, 'log.jsonl');
    const r = await shadow.shadow(file, 'sess-1', { models: 'tuned,base', endpoint: 'http://stub', logPath });
    expect(r).toMatchObject({ windows: 7, done: 3 });
    expect(logged(logPath)[0].arms.tuned).toMatchObject({ decision: 'error', error: 'ECONNREFUSED' });
  });

  test('HTTP errors log as http_<status>; garbage O1_SHADOW_MAX_WINDOWS falls back to the default; env selects models and log', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
    process.env.O1_SHADOW_MAX_WINDOWS = 'all';
    process.env.O1_SHADOW_MODELS = 'only-arm';
    process.env.O1_SHADOW_LOG = path.join(tmpDir, 'env.jsonl');
    const r = await shadow.shadow(transcriptWith(14), 'sess-1');     // endpoint from pipeline config
    expect(r).toMatchObject({ windows: 2, done: 2 });
    const rows = logged(process.env.O1_SHADOW_LOG);
    expect(Object.keys(rows[0].arms)).toEqual(['only-arm']);
    expect(rows[0].arms['only-arm'].decision).toBe('http_404');
  });

  test('a spent budget skips the transcript before reading it', async () => {
    jest.resetModules();
    const fresh = require('../src/o1-shadow');
    const r = await fresh.shadow(transcriptWith(14), 'sess-1', { models: 'tuned', endpoint: 'http://stub', logPath: path.join(tmpDir, 'l.jsonl'), budgetMs: -1 });
    expect(r).toEqual({ skipped: 'budget' });
    expect(fs.existsSync(path.join(tmpDir, 'l.jsonl'))).toBe(false);
  });

  test('extractFromTranscript runs the shadow only when the caller opts in, and sends the same corpus either way', async () => {
    global.fetch = jest.fn(async () => reply('tuned', '{"decision": "reject"}'));
    process.env.VAULT_ROOT = tmpDir;
    process.env.CONFIG_DIR_OVERRIDE = path.join(__dirname, '..', 'config');
    process.env.O1_SHADOW_MODELS = 'tuned';
    process.env.O1_SHADOW_LOG = path.join(tmpDir, 'hook.jsonl');
    for (const d of ['proposals', 'memory', 'archive/memory']) fs.mkdirSync(path.join(tmpDir, d), { recursive: true });
    jest.resetModules();
    const extractor = require('../src/memory-extractor');
    const file = transcriptWith(14);
    const corpora = [];
    const client = { classify: jest.fn(async (_s, user) => { corpora.push(user); return { success: true, data: [] }; }) };
    await extractor.extractFromTranscript(file, 'sess-1', { _haikuClient: client });
    expect(fs.existsSync(process.env.O1_SHADOW_LOG)).toBe(false);          // /wrap-style call: no opt-in
    await extractor.extractFromTranscript(file, 'sess-1', { _haikuClient: client, o1Shadow: true, timeoutMs: 50000 });
    expect(fs.existsSync(process.env.O1_SHADOW_LOG)).toBe(false);          // Stop-hook budget: never
    await extractor.extractFromTranscript(file, 'sess-1', { _haikuClient: client, o1Shadow: true });
    expect(logged(process.env.O1_SHADOW_LOG)).toHaveLength(2);
    expect(corpora[0]).toBe(corpora[2]);
    delete process.env.VAULT_ROOT;
    delete process.env.CONFIG_DIR_OVERRIDE;
  });
});

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

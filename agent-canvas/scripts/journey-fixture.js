'use strict';
// TEST ONLY. Disposable DB, loopback listener, fake model, no external network.
// Never imported by server/index.js or the deployed application.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const local = process.argv.includes('--local');
const identity = local ? { email: 'pete@cloudtechgurus.com', role: 'owner' }
  : { email: 'teammate@agent-canvas.invalid', role: 'member' };
if (!local && process.env.AGENT_CANVAS_JOURNEY_FIXTURE !== '1') throw new Error('Start this test fixture through npm run test:journeys or npm run preview:journeys.');
// Drop all inherited integration credentials before loading any application code.
for (const key of Object.keys(process.env)) {
  if (!['PATH', 'HOME', 'TMPDIR', 'LANG', 'TERM', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'].includes(key)) delete process.env[key];
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-journey-'));
Object.assign(process.env, { DATA_DIR: dataDir, DB_PATH: ':memory:', NODE_ENV: 'test', DEV_AUTH: '1', ANTHROPIC_API_KEY: 'test-fixture-not-a-real-key', JWT_SECRET: 'test-only-disposable-journey-session-secret', ENABLE_WEB_SEARCH: '0', SEED_MEMBERS: 'teammate@agent-canvas.invalid:Test teammate' });
let externalAttempts = 0;
const blockedNetwork = () => { externalAttempts += 1; throw new Error('External network is disabled in the journey fixture.'); };
global.fetch = blockedNetwork;
https.request = blockedNetwork; https.get = blockedNetwork;
http.request = blockedNetwork; http.get = blockedNetwork;
const textResponse = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } });
const anthropic = require('../server/orchestrator/anthropic');
anthropic.callModel = async () => textResponse('{}'); // deterministic routing fallback
const runner = require('../server/orchestrator/runner');
runner._internal.setCallModel(async ({ messages }) => {
  const request = String(messages[0]?.content || '');
  if (request.startsWith('Follow-up request:') && messages.length === 1) return {
    content: [{ type: 'tool_use', id: 'fixture-review', name: 'escalate', input: { question: 'Should we prepare the renewal checklist?', context: 'Local test fixture: confirm that the checklist should stay a draft for human review. No external records will be changed.' } }],
    stop_reason: 'tool_use', usage: { input_tokens: 0, output_tokens: 0 },
  };
  return textResponse(request.startsWith('Follow-up request:')
    ? 'Draft checklist:\n- Confirm the renewal date.\n- Review the account owner and open risks.\n- Prepare a brief for human review.\n\nA decision is waiting in Needs you. This is a local test result.'
    : 'Check the renewal date, account owner and open risks. Prepare a short checklist for review. This local test answer has no external sources.');
});
const { db } = require('../server/db');
const { audit } = require('../server/audit');
require('../server/bus').on('event', (event) => {
  if (event.type === 'escalation' && event.escalation?.question === 'Should we prepare the renewal checklist?') {
    db.prepare('UPDATE escalations SET owner_email = ? WHERE id = ?').run(identity.email, event.escalation.id);
    audit('system', 'journey-fixture', 'test_fixture.assign_review', { escalationId: event.escalation.id });
  }
});
const { server } = require('../server/index');
const contentTables = ['canvases', 'agents', 'notes', 'files', 'tasks', 'runs', 'inquiries', 'memory_entries'];
const bootCounts = Object.fromEntries(contentTables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
assert.ok(Object.values(bootCounts).every((count) => count === 0), 'Fresh boot must have no fabricated product content');
function snapshot() {
  return {
    bootCounts, externalAttempts, identity,
    inquiries: db.prepare('SELECT question, mode, status FROM inquiries ORDER BY created_at').all(),
    decisions: db.prepare("SELECT content, epistemic, source FROM memory_entries WHERE source LIKE 'escalation % resolution'").all(),
    escalations: db.prepare('SELECT question, status, owner_email FROM escalations').all(),
  };
}
process.on('message', (message) => { if (message?.type === 'snapshot') process.send?.({ type: 'snapshot', requestId: message.requestId, data: snapshot() }); });
let closing = false;
function close() { if (closing) return; closing = true; server.close(); db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', close); process.on('SIGINT', close);
server.listen(0, '127.0.0.1', () => {
  const ready = { type: 'ready', url: `http://127.0.0.1:${server.address().port}`, bootCounts, identity };
  process.send?.(ready);
  process.stdout.write(`${JSON.stringify(ready)}\n`);
  if (local) process.stdout.write(`TEST ONLY: sign in as ${identity.email} (workspace owner) and follow USER-GUIDE.md. Your review item is assigned to you. Ctrl-C discards this fixture.\n`);
});

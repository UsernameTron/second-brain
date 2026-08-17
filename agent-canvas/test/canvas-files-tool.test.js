'use strict';
// Canvas attachments are real agent-readable sources, not a decorative
// workbook. Reads are bounded, untrusted, canvas-scoped, and evidence-backed;
// user removal is a recoverable tombstone.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-files-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test-key-never-called';

const ExcelJS = require('exceljs');
const { server } = require('../server/index');
const { db, nowIso } = require('../server/db');
const evidence = require('../server/evidence');
const { executeTool, toolsForRole } = require('../server/orchestrator/tools');

const OWNER = 'pete@cloudtechgurus.com';
const VIEWER = 'jessica@cloudtechgurus.com';
const AGENT = 'agent-canvas-file';
const RUN = 'run-canvas-file';
let base;
let ownerCookie;
let viewerCookie;
let canvasId;
let otherCanvasId;

async function signIn(email) {
  const res = await fetch(`${base}/api/auth/dev`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function jsonCall(cookie, method, apiPath, body) {
  const res = await fetch(`${base}${apiPath}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function upload(cookie, targetCanvasId, name, mime, bytes) {
  const res = await fetch(`${base}/api/canvases/${targetCanvasId}/files?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': mime }, body: Buffer.from(bytes),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function putFile({ id, canvas = canvasId, name, mime, content, uploadedBy = OWNER }) {
  const bytes = Buffer.from(content);
  db.prepare('INSERT INTO files (id, canvas_id, name, mime, size, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, canvas, name, mime, bytes.length, bytes, uploadedBy, nowIso());
}

function ctx() {
  return {
    run: db.prepare('SELECT * FROM runs WHERE id = ?').get(RUN),
    agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(AGENT),
    canvas: db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId),
  };
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn(OWNER);
  viewerCookie = await signIn(VIEWER);

  const one = await jsonCall(ownerCookie, 'POST', '/api/canvases', { name: 'File Sources' });
  const two = await jsonCall(ownerCookie, 'POST', '/api/canvases', { name: 'Other Files' });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  canvasId = one.data.canvas.id;
  otherCanvasId = two.data.canvas.id;
  db.prepare("UPDATE canvases SET access_mode = 'restricted' WHERE id = ?").run(canvasId);
  db.prepare("INSERT INTO canvas_members (canvas_id, user_email, access) VALUES (?, ?, 'view')").run(canvasId, VIEWER);

  db.prepare("INSERT INTO agents (id, canvas_id, name, role, created_at) VALUES (?, ?, 'Reader', 'research', ?)")
    .run(AGENT, canvasId, nowIso());
  db.prepare(`INSERT INTO runs
    (id, agent_id, canvas_id, trigger_kind, instruction, status, step_budget, wall_ms_budget, created_at, initiated_by)
    VALUES (?, ?, ?, 'user', 'read the attachments', 'completed', 12, 240000, ?, ?)`)
    .run(RUN, AGENT, canvasId, nowIso(), OWNER);

  putFile({ id: 'text-1', name: 'brief.txt', mime: 'text/plain', content: 'Alpha brief\nSecond line.' });
  putFile({ id: 'csv-1', name: 'pipeline.CSV', mime: 'text/csv', content: 'company,stage\nAcme,open' });
  putFile({ id: 'json-1', name: 'facts.json', mime: 'application/json', content: '{"active":true}' });
  putFile({ id: 'pdf-old', name: 'legacy.pdf', mime: 'application/pdf', content: '%PDF historical' });
  putFile({ id: 'bad-utf8', name: 'broken.txt', mime: 'text/plain', content: Buffer.from([0xc3, 0x28]) });
  putFile({ id: 'long-1', name: 'long.md', mime: 'text/markdown', content: `START\n${'x'.repeat(70_000)}\nSECRET_TAIL` });
  putFile({ id: 'other-secret', canvas: otherCanvasId, name: 'other.txt', mime: 'text/plain', content: 'OTHER CANVAS SECRET' });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Pipeline');
  sheet.addRow(['company', 'seats']);
  sheet.addRow(['Acme', 650]);
  putFile({ id: 'xlsx-1', name: 'pipeline.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: Buffer.from(await wb.xlsx.writeBuffer()) });
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('common tool lists only live metadata from its own canvas', async () => {
  assert.ok(toolsForRole('strategic').some((tool) => tool.name === 'read_canvas_files'));
  const out = await executeTool('read_canvas_files', {}, ctx());
  assert.equal(out.isError, undefined);
  assert.match(out.content, /^<external_content source="canvas_file_list">/);
  assert.match(out.content, /brief\.txt/);
  assert.match(out.content, /legacy\.pdf/, 'historical unsupported files remain listable');
  assert.ok(!out.content.includes('other-secret'));
  assert.ok(!out.content.includes('OTHER CANVAS SECRET'));
  assert.equal(evidence.refsForRun(RUN).length, 0, 'metadata listing is not represented as reading an artifact');
});

test('text, CSV, JSON, and XLSX reads are untrusted and evidence-backed', async () => {
  for (const [id, expected] of [
    ['text-1', 'Alpha brief'],
    ['csv-1', 'Acme,open'],
    ['json-1', '{"active":true}'],
    ['xlsx-1', 'Acme,650'],
  ]) {
    const out = await executeTool('read_canvas_files', { file_id: id }, ctx());
    assert.ok(!out.isError, out.content);
    const closing = out.content.indexOf('</external_content>');
    const marker = out.content.indexOf('[evidence_ref:');
    assert.ok(closing >= 0 && marker > closing, 'evidence marker stays outside the untrusted file wrapper');
    assert.match(out.content, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const refs = evidence.refsForRun(RUN).filter((ref) => ref.sourceKind === 'canvas_file');
  assert.deepEqual(refs.map((ref) => ref.sourceId).sort(), ['csv-1', 'json-1', 'text-1', 'xlsx-1']);
  assert.ok(refs.every((ref) => ref.meta.canvasId === canvasId));
  assert.ok(refs.every((ref) => ref.visibility === 'canvas'));
});

test('cross-canvas ids and unsupported or invalid formats reveal no content and mint no evidence', async () => {
  const before = evidence.refsForRun(RUN).length;
  const cross = await executeTool('read_canvas_files', { file_id: 'other-secret' }, ctx());
  assert.equal(cross.isError, true);
  assert.match(cross.content, /not found on this canvas/);
  assert.ok(!cross.content.includes('other.txt'));
  assert.ok(!cross.content.includes('OTHER CANVAS SECRET'));

  const pdf = await executeTool('read_canvas_files', { file_id: 'pdf-old' }, ctx());
  assert.equal(pdf.isError, true);
  assert.match(pdf.content, /Unsupported canvas file/);
  assert.match(pdf.content, /PDF, Word, images/);

  const invalid = await executeTool('read_canvas_files', { file_id: 'bad-utf8' }, ctx());
  assert.equal(invalid.isError, true);
  assert.match(invalid.content, /not valid UTF-8/);
  assert.equal(evidence.refsForRun(RUN).length, before, 'failed reads do not mint evidence');
});

test('large text is visibly capped without leaking the omitted tail and records truncation', async () => {
  const out = await executeTool('read_canvas_files', { file_id: 'long-1' }, ctx());
  assert.ok(!out.isError, out.content);
  assert.match(out.content, /file truncated at the 60000-character cap/);
  assert.ok(!out.content.includes('SECRET_TAIL'));
  assert.ok(out.content.length < 61_000, `bounded tool result was ${out.content.length} chars`);
  const ref = evidence.refsForRun(RUN).find((item) => item.sourceId === 'long-1');
  assert.ok(ref);
  assert.equal(ref.meta.truncated, true);
});

test('upload accepts only readable supported files and rejects dead artifacts before persistence', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM files WHERE canvas_id = ?').get(canvasId).n;
  const pdf = await upload(ownerCookie, canvasId, 'new.pdf', 'application/pdf', '%PDF');
  assert.equal(pdf.status, 415);
  assert.match(pdf.data.error, /\.txt, \.md, \.csv, \.json, or \.xlsx/);
  const disguised = await upload(ownerCookie, canvasId, 'binary.txt', 'text/plain', Buffer.from([0xc3, 0x28]));
  assert.equal(disguised.status, 415);
  assert.match(disguised.data.error, /not valid UTF-8/);
  const corrupt = await upload(ownerCookie, canvasId, 'corrupt.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'not a workbook');
  assert.equal(corrupt.status, 415);
  assert.match(corrupt.data.error, /could not be read as a workbook/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files WHERE canvas_id = ?').get(canvasId).n, before);

  const good = await upload(ownerCookie, canvasId, 'operator.md', 'text/markdown', '# Operator brief');
  assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.equal(good.data.file.name, 'operator.md');
  const json = await upload(ownerCookie, canvasId, 'operator.json', 'application/json', '{"account":"Acme"}');
  assert.equal(json.status, 200, JSON.stringify(json.data));
  assert.equal(json.data.file.mime, 'application/json', 'JSON uploads bypass the app JSON parser and retain their real MIME type');
});

test('Unicode filenames download with an ASCII fallback and RFC 5987 name', async () => {
  const original = '測試📄.txt';
  const uploaded = await upload(ownerCookie, canvasId, original, 'text/plain', 'unicode filename body');
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));

  const response = await fetch(`${base}/api/canvases/${canvasId}/files/${uploaded.data.file.id}`, {
    headers: { Cookie: ownerCookie },
  });
  assert.equal(response.status, 200, 'accepted Unicode names remain downloadable');
  assert.equal(await response.text(), 'unicode filename body');
  const disposition = response.headers.get('content-disposition') || '';
  assert.match(disposition, /filename="download\.txt"/);
  assert.match(disposition, /filename\*=UTF-8''%E6%B8%AC%E8%A9%A6%F0%9F%93%84\.txt/);
});

test('file removal requires edit access, is idempotent, hides all active reads, and preserves bytes', async () => {
  const uploaded = await upload(ownerCookie, canvasId, 'remove-me.txt', 'text/plain', 'recoverable bytes');
  assert.equal(uploaded.status, 200);
  const fileId = uploaded.data.file.id;

  const denied = await jsonCall(viewerCookie, 'DELETE', `/api/canvases/${canvasId}/files/${fileId}`);
  assert.equal(denied.status, 403);
  assert.match(denied.data.error, /view-only/);

  const removed = await jsonCall(ownerCookie, 'DELETE', `/api/canvases/${canvasId}/files/${fileId}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.ok, true);
  const again = await jsonCall(ownerCookie, 'DELETE', `/api/canvases/${canvasId}/files/${fileId}`);
  assert.equal(again.status, 200);
  assert.equal(again.data.alreadyRemoved, true);

  const download = await fetch(`${base}/api/canvases/${canvasId}/files/${fileId}`, { headers: { Cookie: ownerCookie } });
  assert.equal(download.status, 404);
  const canvas = await jsonCall(ownerCookie, 'GET', `/api/canvases/${canvasId}`);
  assert.ok(!canvas.data.files.some((file) => file.id === fileId));
  const list = await executeTool('read_canvas_files', {}, ctx());
  assert.ok(!list.content.includes(fileId));
  const agentRead = await executeTool('read_canvas_files', { file_id: fileId }, ctx());
  assert.equal(agentRead.isError, true);

  const stored = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  assert.equal(Buffer.from(stored.content).toString('utf8'), 'recoverable bytes');
  assert.ok(stored.deleted_at);
  assert.equal(stored.deleted_by, OWNER);
  const auditRows = db.prepare("SELECT detail FROM audit_log WHERE action = 'file.remove'").all();
  assert.equal(auditRows.length, 1, 'idempotent retry does not duplicate the audit event');
  assert.ok(!auditRows[0].detail.includes('recoverable bytes'), 'audit carries metadata, never file contents');
});

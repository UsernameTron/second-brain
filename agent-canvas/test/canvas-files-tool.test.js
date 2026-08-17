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
const { _internal: runnerInternal } = require('../server/orchestrator/runner');

const OWNER = 'pete@cloudtechgurus.com';
const VIEWER = 'jessica@cloudtechgurus.com';
const AGENT = 'agent-canvas-file';
const RUN = 'run-canvas-file';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LONG_TEXT = `START\nBEFORE_OLD_40K\n${'a'.repeat(41_000)}\nBETWEEN_OLD_40K_AND_60K\n${'b'.repeat(21_000)}\nAFTER_OLD_60K\n${'c'.repeat(12_000)}\nEND`;
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
  putFile({ id: 'long-1', name: 'long.md', mime: 'text/markdown', content: LONG_TEXT });
  putFile({ id: 'emoji-1', name: 'unicode-boundary.txt', mime: 'text/plain', content: `${'u'.repeat(23_999)}📄TAIL` });
  putFile({ id: 'other-secret', canvas: otherCanvasId, name: 'other.txt', mime: 'text/plain', content: 'OTHER CANVAS SECRET' });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Pipeline');
  sheet.addRow(['company', 'seats']);
  sheet.addRow(['Acme', 650]);
  putFile({ id: 'xlsx-1', name: 'pipeline.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: Buffer.from(await wb.xlsx.writeBuffer()) });

  const longWb = new ExcelJS.Workbook();
  const longSheet = longWb.addWorksheet('Long');
  // Keep named evidence on both sides of the runner's old 40k boundary and
  // beyond the workbook renderer's terminal 60k bound. The first two must be
  // recoverable by continuation; the last must be called out as source-omitted
  // rather than implied to exist behind another offset.
  longSheet.addRow(['BEFORE_XLSX_40K']);
  longSheet.addRow(['a'.repeat(20_000)]);
  longSheet.addRow(['a'.repeat(20_000)]);
  longSheet.addRow(['BETWEEN_XLSX_40K_AND_60K']);
  longSheet.addRow(['b'.repeat(21_000)]);
  longSheet.addRow(['AFTER_XLSX_60K']);
  putFile({ id: 'xlsx-long', name: 'long.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: Buffer.from(await longWb.xlsx.writeBuffer()) });

  const manySheetsWb = new ExcelJS.Workbook();
  for (let i = 0; i < 11; i += 1) manySheetsWb.addWorksheet(`Sheet ${i + 1}`).addRow([`sheet-${i + 1}`]);
  putFile({ id: 'xlsx-many-sheets', name: 'many-sheets.xlsx', mime: XLSX_MIME, content: Buffer.from(await manySheetsWb.xlsx.writeBuffer()) });

  const markerTextWb = new ExcelJS.Workbook();
  markerTextWb.addWorksheet('Markers').addRow(['[...sheet truncated at 2000 rows]']);
  putFile({ id: 'xlsx-marker-text', name: 'marker-text.xlsx', mime: XLSX_MIME, content: Buffer.from(await markerTextWb.xlsx.writeBuffer()) });
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

function parseChunk(out) {
  const match = /Chunk metadata: (\{[^\n]+\})\n\n/.exec(out.content);
  assert.ok(match, `missing chunk metadata in: ${out.content.slice(0, 300)}`);
  const start = match.index + match[0].length;
  const end = out.content.indexOf('\n</external_content>', start);
  assert.ok(end >= start, 'chunk stays inside the external-content boundary');
  return { meta: JSON.parse(match[1]), text: out.content.slice(start, end) };
}

test('large text is fully retrievable through bounded continuations that the runner does not re-cap', async () => {
  let offset = 0;
  let reconstructed = '';
  let calls = 0;
  do {
    const out = await executeTool('read_canvas_files', { file_id: 'long-1', offset, length: 24_000 }, ctx());
    assert.ok(!out.isError, out.content);
    assert.equal(runnerInternal.capToolResult(out.content), out.content, 'runner cap must never alter a bounded file chunk');
    assert.ok(out.content.length < runnerInternal.TOOL_RESULT_CHAR_CAP, `tool result was ${out.content.length} chars`);
    const chunk = parseChunk(out);
    assert.equal(chunk.meta.range_start, offset);
    assert.equal(chunk.meta.returned_characters, chunk.text.length);
    assert.equal(chunk.meta.rendered_characters, LONG_TEXT.length);
    assert.equal(chunk.meta.source_complete, true);
    reconstructed += chunk.text;
    calls += 1;
    if (!chunk.meta.has_more) break;
    assert.equal(chunk.meta.next_offset, chunk.meta.range_end_exclusive);
    assert.match(chunk.meta.continuation, new RegExp(`offset ${chunk.meta.next_offset}`));
    offset = chunk.meta.next_offset;
  } while (calls < 10);

  assert.equal(reconstructed, LONG_TEXT);
  assert.match(reconstructed, /BEFORE_OLD_40K/);
  assert.match(reconstructed, /BETWEEN_OLD_40K_AND_60K/);
  assert.match(reconstructed, /AFTER_OLD_60K/);
  assert.match(reconstructed, /\nEND$/);
  assert.ok(calls >= 4, `expected multiple bounded reads, got ${calls}`);

  const refs = evidence.refsForRun(RUN).filter((item) => item.sourceId === 'long-1');
  assert.equal(refs.length, calls);
  assert.ok(refs.every((ref) => ref.meta.renderedCharacters === LONG_TEXT.length));
  assert.ok(refs.every((ref) => ref.meta.truncated === true), 'each range is evidence-marked as a partial-source read');
});

test('range arguments are bounded and invalid offsets fail without minting evidence', async () => {
  const bounded = await executeTool('read_canvas_files', { file_id: 'long-1', offset: 0, length: 9_999_999 }, ctx());
  assert.ok(!bounded.isError, bounded.content);
  const chunk = parseChunk(bounded);
  assert.ok(chunk.meta.returned_characters <= 30_000);
  assert.equal(runnerInternal.capToolResult(bounded.content), bounded.content);

  const before = evidence.refsForRun(RUN).length;
  for (const offset of [-1, LONG_TEXT.length + 1]) {
    const invalid = await executeTool('read_canvas_files', { file_id: 'long-1', offset }, ctx());
    assert.equal(invalid.isError, true);
    assert.match(invalid.content, /offset/);
  }
  assert.equal(evidence.refsForRun(RUN).length, before);
});

test('continuation offsets never split or lose a supplementary Unicode character', async () => {
  const first = parseChunk(await executeTool('read_canvas_files', { file_id: 'emoji-1', offset: 0, length: 24_000 }, ctx()));
  assert.equal(first.meta.next_offset, 23_999, 'range stops before the surrogate pair');
  assert.ok(!first.text.includes('\uFFFD'));
  const second = parseChunk(await executeTool('read_canvas_files', { file_id: 'emoji-1', offset: first.meta.next_offset, length: 24_000 }, ctx()));
  assert.equal(first.text + second.text, `${'u'.repeat(23_999)}📄TAIL`);
  assert.equal(second.meta.has_more, false);
});

test('XLSX renderer limits are terminal, explicit, and never misrepresented as complete continuation', async () => {
  let offset = 0;
  let rendered = '';
  let finalMeta;
  for (let calls = 0; calls < 5; calls += 1) {
    const out = await executeTool('read_canvas_files', { file_id: 'xlsx-long', offset, length: 30_000 }, ctx());
    assert.ok(!out.isError, out.content);
    assert.equal(runnerInternal.capToolResult(out.content), out.content);
    const chunk = parseChunk(out);
    rendered += chunk.text;
    finalMeta = chunk.meta;
    if (!chunk.meta.has_more) break;
    offset = chunk.meta.next_offset;
  }
  assert.equal(finalMeta.has_more, false);
  assert.equal(finalMeta.source_complete, false);
  assert.match(finalMeta.source_limit, /safety bound/);
  assert.match(rendered, /BEFORE_XLSX_40K/);
  assert.ok(rendered.indexOf('BETWEEN_XLSX_40K_AND_60K') > 40_000, 'continuation recovers workbook text after the runner\'s old cap');
  assert.ok(!rendered.includes('AFTER_XLSX_60K'), 'the parser-bounded tail is not misrepresented as retrievable');
  assert.match(rendered, /output truncated at the 60000-character cap/);

  const sheetLimited = parseChunk(await executeTool('read_canvas_files', { file_id: 'xlsx-many-sheets' }, ctx()));
  assert.equal(sheetLimited.meta.has_more, false);
  assert.equal(sheetLimited.meta.source_complete, false);
  assert.match(sheetLimited.meta.source_limit, /safety bound/);
  assert.match(sheetLimited.text, /1 more sheet\(s\) not shown/);

  const markerText = parseChunk(await executeTool('read_canvas_files', { file_id: 'xlsx-marker-text' }, ctx()));
  assert.equal(markerText.meta.source_complete, true, 'user cell text cannot forge parser truncation metadata');
  assert.deepEqual(markerText.meta.source_limits, []);
  assert.match(markerText.text, /sheet truncated at 2000 rows/);
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

  const dotted = await upload(ownerCookie, canvasId, 'customer..final.csv', 'text/csv', 'company,stage\nAcme,open');
  assert.equal(dotted.status, 200, JSON.stringify(dotted.data));
  assert.equal(dotted.data.file.name, 'customer..final.csv');
});

test('XLSX_READ=0 rejects both upload validation and agent reads with conversion guidance', async () => {
  const previous = process.env.XLSX_READ;
  const workbook = db.prepare('SELECT content FROM files WHERE id = ?').get('xlsx-1');
  const beforeFiles = db.prepare('SELECT COUNT(*) AS n FROM files WHERE canvas_id = ?').get(canvasId).n;
  const beforeEvidence = evidence.refsForRun(RUN).length;
  process.env.XLSX_READ = '0';
  try {
    const read = await executeTool('read_canvas_files', { file_id: 'xlsx-1' }, ctx());
    assert.equal(read.isError, true);
    assert.match(read.content, /native workbook reader is disabled \(XLSX_READ=0\)/);
    assert.match(read.content, /Open it with Google Sheets\/Docs/);
    assert.match(read.content, /export it as CSV/);

    const uploaded = await upload(ownerCookie, canvasId, 'disabled.xlsx', XLSX_MIME, Buffer.from(workbook.content));
    assert.equal(uploaded.status, 415);
    assert.match(uploaded.data.error, /native workbook reader is disabled \(XLSX_READ=0\)/);
    assert.match(uploaded.data.error, /Open it with Google Sheets\/Docs/);
    assert.match(uploaded.data.error, /export it as CSV/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files WHERE canvas_id = ?').get(canvasId).n, beforeFiles);
    assert.equal(evidence.refsForRun(RUN).length, beforeEvidence, 'disabled reads mint no evidence');
  } finally {
    if (previous === undefined) delete process.env.XLSX_READ;
    else process.env.XLSX_READ = previous;
  }
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

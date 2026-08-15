'use strict';
// P1 native bounded XLSX read. Limits enforced in our code, not the library:
// size cap before/during download, sheet/row/cell budgets, cached formula
// results only, corrupt archives as a normal error, time guard, TEXT_CAP.
// Fixtures are built in-memory with exceljs — no committed binaries.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-xlsx-'));
process.env.DEV_AUTH = '1';
process.env.ANTHROPIC_API_KEY = 'test'; // placeholder, never called

const ExcelJS = require('exceljs');
const { _internal } = require('../server/google/workspace');
const { xlsxToText, xlsxCellText, XLSX_LIMITS } = _internal;

async function buildWorkbook(fill) {
  const wb = new ExcelJS.Workbook();
  fill(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('representative workbook renders per-sheet CSV-ish text', async () => {
  const buf = await buildWorkbook((wb) => {
    const s = wb.addWorksheet('Pipeline');
    s.addRow(['company', 'tier', 'seats']);
    s.addRow(['Acme Corp', 'A', 650]);
    const s2 = wb.addWorksheet('Notes');
    s2.addRow(['renewal due in March']);
  });
  const text = await xlsxToText(buf, 'pipeline.xlsx');
  assert.match(text, /## Sheet: Pipeline/);
  assert.match(text, /Acme Corp,A,650/);
  assert.match(text, /## Sheet: Notes/);
  assert.match(text, /formulas render their cached values/);
});

test('formula cells render their cached result, never the formula', async () => {
  const buf = await buildWorkbook((wb) => {
    const s = wb.addWorksheet('Calc');
    s.addRow([2, 3]);
    s.getCell('C1').value = { formula: 'A1+B1', result: 5 };
  });
  const text = await xlsxToText(buf, 'calc.xlsx');
  assert.match(text, /2,3,5/);
  assert.ok(!text.includes('A1+B1'), 'formula source never rendered');
  // Direct cell shapes.
  assert.equal(xlsxCellText({ formula: 'SUM(A1:A9)', result: 42 }), '42');
  assert.equal(xlsxCellText({ richText: [{ text: 'a' }, { text: 'b' }] }), 'ab');
  assert.equal(xlsxCellText(null), '');
});

test('row and sheet budgets truncate with explicit markers', async () => {
  const buf = await buildWorkbook((wb) => {
    const s = wb.addWorksheet('Big');
    for (let i = 0; i < XLSX_LIMITS.rowsPerSheet + 50; i++) s.addRow([`r${i}`]);
    for (let i = 0; i < XLSX_LIMITS.sheets + 2; i++) wb.addWorksheet(`Extra${i}`).addRow(['x']);
  });
  const text = await xlsxToText(buf, 'big.xlsx');
  assert.match(text, new RegExp(`truncated at ${XLSX_LIMITS.rowsPerSheet} rows`));
  assert.match(text, /more sheet\(s\) not shown/);
});

test('corrupt archive is a normal, friendly error', async () => {
  await assert.rejects(
    () => xlsxToText(Buffer.from('this is not a zip archive at all, not even close'), 'corrupt.xlsx'),
    /could not be read as a workbook/
  );
});

test('cells containing commas or newlines are CSV-quoted, not split', async () => {
  const buf = await buildWorkbook((wb) => {
    const s = wb.addWorksheet('Names');
    s.addRow(['Acme, Inc.', 'line1\nline2', 'plain']);
  });
  const text = await xlsxToText(buf, 'names.xlsx');
  assert.match(text, /"Acme, Inc\."/);
  assert.match(text, /"line1\nline2"/);
  assert.match(text, /,plain/);
});

test('declared uncompressed size over the cap is rejected before parse', async () => {
  const buf = await buildWorkbook((wb) => {
    const s = wb.addWorksheet('S');
    for (let i = 0; i < 200; i++) s.addRow(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', i]);
  });
  const real = XLSX_LIMITS.uncompressedBytes;
  XLSX_LIMITS.uncompressedBytes = 100; // any real workbook exceeds this
  try {
    await assert.rejects(() => xlsxToText(buf, 'bomb.xlsx'), /expands to .* uncompressed|over the .*MB workbook limit/);
  } finally { XLSX_LIMITS.uncompressedBytes = real; }
});

test('character-cap truncation is explicit, never a silent cut', async () => {
  const buf = await buildWorkbook((wb) => {
    const s = wb.addWorksheet('Long');
    for (let i = 0; i < 1500; i++) s.addRow([`row ${i} `.padEnd(60, 'x')]);
  });
  const text = await xlsxToText(buf, 'long.xlsx');
  assert.ok(text.length <= 60_000);
  assert.match(text, /output truncated at the 60000-character cap/);
});

test('metadata size over the cap is rejected before download', async () => {
  await assert.rejects(
    () => _internal.downloadCapped('tok', 'https://example.invalid/x', { name: 'huge.xlsx', size: XLSX_LIMITS.fileBytes + 1 }),
    /over the .*MB workbook read limit/
  );
});

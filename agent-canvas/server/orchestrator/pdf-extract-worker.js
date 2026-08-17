'use strict';

// PDF parsing is isolated from the HTTP process because a small compressed
// content stream can expand into a large amount of decoded text before a
// parser promise yields. The parent applies both a wall-clock timeout and V8
// heap limits; this worker additionally consumes text incrementally and stops
// at the product's explicit decoded-character bound.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parentPort, workerData } = require('node:worker_threads');

async function extractPage(page, maxCharacters) {
  const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
  const parts = [];
  let characters = 0;
  let truncated = false;
  try {
    while (characters < maxCharacters) {
      const next = await reader.read();
      if (next.done) break;
      for (const item of next.value?.items || []) {
        const value = typeof item.str === 'string' ? item.str : '';
        const piece = item.hasEOL ? `${value}\n` : `${value} `;
        const remaining = maxCharacters - characters;
        if (piece.length > remaining) {
          parts.push(piece.slice(0, remaining));
          characters += remaining;
          truncated = true;
          break;
        }
        parts.push(piece);
        characters += piece.length;
      }
      if (truncated) break;
    }
    if (characters >= maxCharacters) truncated = true;
    if (truncated) await reader.cancel('PDF character limit reached').catch(() => {});
  } catch (err) {
    void reader.cancel('PDF extraction failed').catch(() => {});
    throw err;
  }
  return {
    text: parts.join('').replace(/[ \t]+\n/g, '\n').trim(),
    characters,
    truncated,
  };
}

async function extract() {
  const { bytes, name, textCap, pageLimit } = workerData;
  const pdfModulePath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = `${pathToFileURL(
    path.resolve(path.dirname(pdfModulePath), '../../standard_fonts/'),
  ).href}/`;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl,
    stopAtErrors: true,
  });
  const pdf = await loadingTask.promise;
  const reasons = new Set();
  const lines = [`PDF "${name}" (${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}):`];
  const pages = Math.min(pdf.numPages, pageLimit);
  let extractedCharacters = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const pageResult = await extractPage(page, textCap - extractedCharacters);
        extractedCharacters += pageResult.characters;
        lines.push(`\n## Page ${pageNumber}\n${pageResult.text}`);
        if (pageResult.truncated || extractedCharacters >= textCap) {
          reasons.add('character_limit');
          break;
        }
      } finally {
        page.cleanup();
      }
    }
    if (pdf.numPages > pages) reasons.add('page_limit');
  } finally {
    await pdf.destroy().catch(() => {});
  }
  return {
    text: lines.join('\n'),
    extractedCharacters,
    truncationReasons: [...reasons],
  };
}

extract().then(
  (result) => parentPort.postMessage({ ok: true, ...result }),
  (err) => parentPort.postMessage({ ok: false, error: String(err.message || err).slice(0, 300) }),
);

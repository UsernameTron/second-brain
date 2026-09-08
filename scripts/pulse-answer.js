#!/usr/bin/env node
'use strict';

/**
 * pulse-answer.js — answer the open pulse question.
 *
 *   node scripts/pulse-answer.js yes [hash]            confirm; ledger only, memory.md untouched
 *   node scripts/pulse-answer.js no [hash] [reason]    append `stale:: <date> · retired via pulse[ · reason]`
 *                                                      to the asked entry in memory.md (same lifecycle
 *                                                      field dream.js uses; recall downranks it)
 *
 * The hash is the entry the brief displayed. It is optional only while exactly
 * one question is open: questions accumulate (pulse.js asks a new entry each
 * week whether or not the last was answered), so answering "newest open" could
 * mark stale an entry the operator never read. With more than one open, the
 * hash is required.
 */

const path = require('path');
const fs = require('fs');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md');
const LEDGER = path.join(__dirname, '..', 'state', 'pulse-asked.json');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

// markStale is a read-modify-write of the whole of memory.md. Promotion writes
// the same file, so an overlapping nightly run would otherwise clobber this
// write (or be clobbered by it) and lose promoted entries. Both sides now
// serialize on the memory-proposals lock.
// ponytail: one coarse pipeline mutex; dream:apply is human-invoked and
// snapshot-first, so it stays outside this lane.
function markStale(hash, reason) {
  const raw = fs.readFileSync(MEMORY_FILE(), 'utf8');
  const line = `content_hash:: ${hash}`;
  const at = raw.indexOf(line);
  if (at < 0) throw new Error(`entry ${hash} not found in memory.md`);
  const eol = raw.indexOf('\n', at);
  const field = `\nstale:: ${today()} · retired via pulse${reason ? ' · ' + reason : ''}`;
  fs.writeFileSync(MEMORY_FILE(), raw.slice(0, eol) + field + raw.slice(eol));
}

// A missing ledger is a first run. A truncated or invalid one is corruption:
// treating it as empty would re-ask an answered entry and then overwrite the
// file, discarding every prior question and answer.
function readLedger() {
  let raw;
  try {
    raw = fs.readFileSync(LEDGER, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`pulse ledger ${LEDGER} is malformed (${err.message}); refusing to overwrite it`);
  }
  if (!Array.isArray(parsed)) throw new Error(`pulse ledger ${LEDGER} is not an array; refusing to overwrite it`);
  return parsed;
}

/** Pick the ledger row this answer is for. Ambiguity is an error, not a guess. */
function selectOpen(ledger, hash) {
  const open = ledger.filter(a => a.hash && !a.answer);
  if (!open.length) return { error: 'No open pulse question.' };
  if (hash) {
    const match = open.find(a => a.hash === hash);
    if (!match) return { error: `No open pulse question for entry ${hash}.` };
    return { entry: match };
  }
  if (open.length > 1) {
    return {
      error: `${open.length} pulse questions are open; name the entry the brief showed you: `
        + open.map(a => a.hash).join(', '),
    };
  }
  return { entry: open[0] };
}

const looksLikeHash = (s) => typeof s === 'string' && /^[0-9a-f]{6,}$/i.test(s);

async function answer(verdict, hashOrReason = '', reason = '') {
  // `no <hash> <reason>` and the older `no <reason>` both work: a leading
  // hash-shaped token is the hash, anything else is the start of the reason.
  let hash = '';
  if (looksLikeHash(hashOrReason)) hash = hashOrReason;
  else reason = [hashOrReason, reason].filter(Boolean).join(' ');

  const ledger = readLedger();
  const { entry: open, error } = selectOpen(ledger, hash);
  if (error) { console.log(error); return { error }; }

  const { acquireLock, releaseLock } = require('../src/memory-proposals');
  const lock = await acquireLock();
  if (!lock.acquired) {
    const msg = 'Could not acquire the memory-proposals lock; another writer is active. Try again.';
    console.error(msg);
    return { error: msg };
  }
  try {
    if (verdict === 'no') markStale(open.hash, reason);
    open.answer = verdict;
    open.answeredAt = new Date().toISOString();
    if (reason) open.reason = reason;
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
  } finally {
    await releaseLock();
  }

  console.log(verdict === 'no'
    ? `Marked ${open.hash} stale in memory.md (recall now downranks it).`
    : `Confirmed ${open.hash}. memory.md unchanged.`);
  return { hash: open.hash, answer: verdict };
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const [v, ...rest] = process.argv.slice(2);
  if (v !== 'yes' && v !== 'no') { console.error('usage: pulse-answer.js yes|no [hash] [reason]'); process.exit(2); }
  answer(v, rest[0] || '', rest.slice(1).join(' ')).catch(e => { console.error('pulse-answer:', e.message); process.exit(1); });
}
module.exports = { answer, markStale, selectOpen, readLedger };

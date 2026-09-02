#!/usr/bin/env node
'use strict';

/**
 * pulse-answer.js — answer the open pulse question.
 *
 *   node scripts/pulse-answer.js yes            confirm; ledger only, memory.md untouched
 *   node scripts/pulse-answer.js no [reason]    append `stale:: <date> · retired via pulse[ · reason]`
 *                                               to the asked entry in memory.md (same lifecycle
 *                                               field dream.js uses; recall downranks it)
 *
 * Targets the most recent ledgered question that has no answer yet.
 */

const path = require('path');
const fs = require('fs');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md');
const LEDGER = path.join(__dirname, '..', 'state', 'pulse-asked.json');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

function markStale(hash, reason) {
  const raw = fs.readFileSync(MEMORY_FILE(), 'utf8');
  const line = `content_hash:: ${hash}`;
  const at = raw.indexOf(line);
  if (at < 0) throw new Error(`entry ${hash} not found in memory.md`);
  const eol = raw.indexOf('\n', at);
  const field = `\nstale:: ${today()} · retired via pulse${reason ? ' · ' + reason : ''}`;
  fs.writeFileSync(MEMORY_FILE(), raw.slice(0, eol) + field + raw.slice(eol));
}

async function answer(verdict, reason = '') {
  let ledger; try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { ledger = []; }
  const open = [...ledger].reverse().find(a => a.hash && !a.answer);
  if (!open) { console.log('No open pulse question.'); return; }
  if (verdict === 'no') markStale(open.hash, reason);
  open.answer = verdict; open.answeredAt = new Date().toISOString(); if (reason) open.reason = reason;
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
  console.log(verdict === 'no'
    ? `Marked ${open.hash} stale in memory.md (recall now downranks it).`
    : `Confirmed ${open.hash}. memory.md unchanged.`);
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const [v, ...rest] = process.argv.slice(2);
  if (v !== 'yes' && v !== 'no') { console.error('usage: pulse-answer.js yes|no [reason]'); process.exit(2); }
  answer(v, rest.join(' ')).catch(e => { console.error('pulse-answer:', e.message); process.exit(1); });
}
module.exports = { answer, markStale };

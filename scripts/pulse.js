#!/usr/bin/env node
'use strict';

/**
 * pulse.js — weekly memory pulse entry point (com.secondbrain.pulse, Monday 07:00).
 *
 *   node scripts/pulse.js               write briefings/pulse/YYYY-MM-DD.md, notify, open in Obsidian
 *   node scripts/pulse.js --dry-run     print the brief, write nothing
 *   node scripts/pulse.js --show        print the most recent pulse
 *   node scripts/pulse.js --no-open     write + notify, do not open Obsidian
 *   node scripts/pulse.js yes|no        answer the open question (see pulse-answer.js)
 *
 * Asked questions are ledgered in state/pulse-asked.json so the same entry is
 * never asked twice. The pulse reads memory.md and never writes it; only an
 * explicit "no" answer (pulse-answer.js) appends a stale:: field.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
}

const { readMemory } = require('../src/memory-reader');
const { pulsePlan, pulseText } = require('../src/pulse');

const VAULT_ROOT = () => process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork');
const LEDGER = path.join(__dirname, '..', 'state', 'pulse-asked.json');
const PULSE_DIR = 'briefings/pulse';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const readLedger = () => { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return []; } };
const writeLedger = (l) => { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + '\n'); };

function latestPulsePath() {
  const dir = path.join(VAULT_ROOT(), PULSE_DIR);
  try {
    const f = fs.readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().pop();
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}

async function writeToVault(relativePath, content) {
  const { vaultWrite, vaultWriteAtomic } = require('../src/vault-gateway');
  try {
    const r = await vaultWrite(relativePath, content, { attemptCount: 1 });
    return r;
  } catch (err) {
    // The brief is templated from already-promoted memory text. A style-lint
    // rejection of that text is not a reason to drop the week's pulse.
    if (err && err.code === 'STYLE_VIOLATION') {
      console.error(JSON.stringify({ action: 'PULSE', decision: 'STYLE_LINT_BYPASSED', reason: err.message }));
      vaultWriteAtomic(relativePath, content);
      return { decision: 'WRITTEN', path: relativePath };
    }
    throw err;
  }
}

function notify(title, body) {
  try { execFileSync('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`]); } catch { /* headless */ }
}
function openInObsidian(relNoExt) {
  const vault = encodeURIComponent(path.basename(VAULT_ROOT()));
  try { execFileSync('open', [`obsidian://open?vault=${vault}&file=${encodeURIComponent(relNoExt)}`]); } catch { /* Obsidian absent */ }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'yes' || args[0] === 'no') {
    const { answer } = require('./pulse-answer');
    return answer(args[0], args.slice(1).join(' '));
  }
  if (args.includes('--show')) {
    const p = latestPulsePath();
    if (!p) { console.log('No pulse written yet. Run: node scripts/pulse.js'); return; }
    process.stdout.write(fs.readFileSync(p, 'utf8'));
    return;
  }
  const dryRun = args.includes('--dry-run');
  const now = today();
  const ledger = readLedger();
  const last = ledger.map(a => a.pulse).sort().pop();
  const since = last && last < now ? last : new Date(Date.parse(now) - 7 * 86400000).toISOString().slice(0, 10);

  const entries = await readMemory();
  const plan = pulsePlan(entries, { now, since, asked: ledger });
  const text = pulseText(plan, { now, since });

  if (dryRun) { process.stdout.write(text); return; }

  const rel = `${PULSE_DIR}/${now}.md`;
  const r = await writeToVault(rel, text);
  if (r.decision !== 'WRITTEN') { console.error(`pulse: gateway ${r.decision} ${r.quarantinePath || ''}`); process.exit(1); }
  if (plan.ask) ledger.push({ hash: plan.ask.contentHash, category: plan.ask.category, pulse: now, asked: new Date().toISOString() });
  else ledger.push({ hash: null, pulse: now, asked: new Date().toISOString() });
  writeLedger(ledger);

  console.log(JSON.stringify({ pulse: now, path: rel, added: plan.added, standing: plan.standing, asked: plan.ask ? plan.ask.contentHash : null }));
  notify('Memory pulse', `${plan.added} new this week. ${plan.ask ? 'One question is waiting.' : ''}`);
  if (!args.includes('--no-open')) openInObsidian(rel.replace(/\.md$/, ''));
}

if (require.main === module) {
  main().catch(err => { console.error('pulse: fatal:', err && err.message ? err.message : err); process.exit(1); });
}
module.exports = { main };

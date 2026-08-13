'use strict';
// Workspace-level Agent Roster — an owner-editable library of CTG-tuned agent
// templates from which canvases are staffed at creation or later. Canvas
// agents are instantiated copies (runs/memory/spend stay per-canvas); the
// nullable roster_id on the agent row carries provenance for resync.
//
// Entries 1-4 reference the EXEC_AGENTS prompts from seed.js — exactly one
// copy of each prompt exists. Entries 5-9 are defined here to the shared
// skeleton the exec prompts already follow: Identity / VOICE-or-MISSION /
// PRIORITIES / Operating rules / Escalation / DELEGATION-LANES /
// CONFIDENTIALITY_GUARD.
//
// The sr-icp-v5 registry ships as config/icp-sr-icp-v5.json (exported by
// ctg-signal-radar scripts/export_icp.py; source of truth
// src/backend/icp_registry.py). Radar's digest below interpolates its numbers
// from that data — the prompt cannot drift from the file. Exact lists (title
// taxonomy, search titles, excluded vendor domains) live only in the
// companion note, never in a prompt: no vendor is ever named in prompt text,
// which enforces the vendor-surfacing rule by construction.
//
// Note on pinning: pinned notes are injected verbatim into the system prompt
// of EVERY agent on a canvas on every run (orchestrator/runner.js). The
// synthesis protocol is small and load-bearing — pinned. The ICP registry is
// large reference data — unpinned; Radar reads it via read_notes.

const crypto = require('node:crypto');
const { db, nowIso, getSetting, setSetting } = require('./db');
const { audit } = require('./audit');
const { EXEC_AGENTS, CONFIDENTIALITY_GUARD, PROTOCOL_NOTE } = require('./seed');

// Committed asset — a missing or corrupt file must fail the boot loudly, not
// half-seed a roster.
const ICP = require('./config/icp-sr-icp-v5.json');

const execPrompt = (name) => EXEC_AGENTS.find((a) => a.name === name).system_prompt;

// ---------- ICP digest values (from data, never retyped) ----------
const W = ICP.industry_weights;
const industriesAt = (weight) => Object.keys(W).filter((k) => W[k] === weight).sort().join(', ');
const T1 = industriesAt(1.15);
const T2 = industriesAt(1.0);
const T3 = industriesAt(0.8);
const EXCLUDED = industriesAt(ICP.industry_excluded_weight);
const TM = ICP.tier_multipliers;
const [SEAT_LO, SEAT_HI] = ICP.seat_band;
const PROXY = `$${ICP.fortune_1000_revenue_proxy.toLocaleString('en-US')}`;
const SENIOR_TOKENS = ICP.title_senior_tokens.join(', ');
const UNLESS_SENIOR = ICP.title_exclusions_unless_senior.join('/');

const ICP_NOTE_TITLE = `ICP registry — ${ICP.icp_version}`;

// ---------- companion notes ----------
const ROSTER_NOTES = {
  synthesis_protocol: { title: 'Synthesis protocol', content: PROTOCOL_NOTE, pinned: true },
  icp_registry: {
    title: ICP_NOTE_TITLE,
    pinned: false,
    content: `# ${ICP_NOTE_TITLE}
Version: ${ICP.icp_version} — source of truth: ${ICP.source_of_truth} (exported by scripts/export_icp.py, ctg-signal-radar). The lists below are authoritative for scoring; prompts carry only the arithmetic digest. A fresh export is a new commit of config/icp-sr-icp-v5.json.

\`\`\`json
${JSON.stringify(ICP, null, 2)}
\`\`\``,
  },
};

// ---------- the five non-exec prompts ----------

const SCOUT_PROMPT = `You are Scout, the research agent for Cloud Tech Gurus canvases. Your job stated plainly: research for CTG decisions — vendor/competitor landscape, market signals, account intel — with honest epistemic labels.

MISSION: give the executive voices findings they can act on, labeled by how you know them — never dressed-up guesses.

PRIORITIES (ranked — every action must advance one):
1. Answer the research question actually asked, scoped to the CTG decision it feeds.
2. Epistemic honesty — a finding mislabeled "verified" is worse than no finding.
3. Retrieval provenance on every web-sourced claim.
4. One consolidated handoff, then complete.

CTG CONTEXT (per ICP registry ${ICP.icp_version} — for any targeting or fit question, defer to Radar's scoring rather than restating ICP from memory): buyers are enterprise contact-center operators, ${SEAT_LO}–${SEAT_HI.toLocaleString('en-US')} seats. Tier-1 verticals: ${T1}. Tier-2: ${T2}. ${EXCLUDED} are NOT target verticals — vendors and BPOs are CTG's supply side (250+ technology suppliers, 40+ BPO providers). Peer TSDs for benchmarking: Telarus, Avant, Intelisys — comparisons, not enemies. Public partnerships you may cite: Telarus, USU/Unymira, Playvox, Infobip. Flagship content: Contact Center Gurus podcast; primary channel LinkedIn.

OPERATING RULES:
- A fact you directly observed is "verified". A finding that requires interpretation is an "inference". Anything you cannot check is an "assumption". Never label an interpretation "verified".
- Every web finding carries retrieval provenance in its memory entry — the URL, when you retrieved it, and the passage that supports it — or it stays an inference.
- Write findings to memory as you go, one entry per finding, each naming its source.

ESCALATION: escalating is not failure; guessing is. Ambiguity with two plausible answers → escalate with the options, keep working other items.

DELEGATION / LANES: targeting and fit scoring → Radar. CRM record legwork → Gauge. Strategic, commercial, or governance judgment → Fred, Darren, or Jess per the synthesis protocol where present. When the batch is done, hand off ALL findings in ONE handoff to the requesting lane, then complete.
${CONFIDENTIALITY_GUARD}`;

const FORGE_PROMPT = `You are Forge, the build agent for Cloud Tech Gurus canvases. Your job stated plainly: turn findings into corrections, applied as ONE reviewable change set — never directly.

MISSION: conservative, cited, reviewable change sets built from other agents' findings.

PRIORITIES (ranked — every action must advance one):
1. Every change is justified by cited memory entries (cite_entry_ids) — no citation, no change.
2. Conservative correction — normalize formats and clear junk to "" rather than invent facts.
3. One change set per batch, handed to review — never applied directly.
4. Escalated items stay untouched.

OPERATING RULES:
- Read the flagged items and the memory entries handed to you; base each change on those findings and cite their entry ids.
- Never invent facts. A correction that requires interpretation is an "inference" and is labeled as such.
- Never touch escalated items.
- After propose_changes, write an "inference" memory entry summarizing what the change set does, citing your input entries.

ESCALATION: escalating is not failure; guessing is. Two plausible corrections the rules do not decide → escalate with the options, keep working other items.

DELEGATION / LANES: hand the change set to the review agent, then complete. You build; review verifies; humans decide escalations.
${CONFIDENTIALITY_GUARD}`;

const SENTINEL_PROMPT = `You are Sentinel, the review agent for Cloud Tech Gurus canvases. Your job stated plainly: verify proposed changes and outbound-looking drafts before anything is marked done.

MISSION: nothing invented ships; nothing stale ships; nothing confidential ships.

PRIORITIES (ranked — every action must advance one):
1. Every proposed change checked against the canvas's pinned rules note and its cited entries.
2. The three CTG review gates below, applied to everything you review.
3. Precise verdicts — approve or reject each change with a reason (verify_changes).
4. "Verified" memory entries with citations after confirmation.

CTG REVIEW GATES:
(a) Confidentiality: scan any outbound-looking draft against the CONFIDENTIALITY RULE below — it binds the whole canvas.
(b) Vendor surfacing: no output may present a domain on the ICP registry note's excluded_vendor_domains list as a CTG choice or recommendation. Read the note (read_notes, title "${ICP_NOTE_TITLE}") to check. Carrying the list as exclusion data is permitted; endorsement is not.
(c) ICP currency: ICP claims must match ${ICP.icp_version} (the ICP registry note, or Radar's scored entries). Flag "500–10,000+ seats" or technology/BPO-as-buyer phrasing as stale.

OPERATING RULES:
- Check every change: does the new value satisfy the rules note? Is it justified by the cited entries? Was anything invented rather than corrected?
- Approve or reject each with a reason. Write a "verified" memory entry per confirmed change (citing its entries) and one summary entry for the batch.
- Hand wrong changes back with a reason precise enough to act on.

ESCALATION: escalating is not failure; guessing is. A change you can neither approve nor precisely reject → escalate with the options.

DELEGATION / LANES: you verify; you do not build. Rework returns to the proposing agent; policy questions go to a human.
${CONFIDENTIALITY_GUARD}`;

const GAUGE_PROMPT = `You are Gauge, the HubSpot operations agent for Cloud Tech Gurus canvases. Your job stated plainly: the CRM hygiene and pipeline legwork the executive voices delegate.

MISSION: read pipeline, deal, and company state; propose clean, cited, preview-first changes; execute nothing a human has not seen previewed.

PRIORITIES (ranked — every action must advance one):
1. Accurate reads — every finding cites the HubSpot record (object type + id) it came from.
2. Preview-first writes — hs_preview_change, escalate with the preview, apply only in a run resumed from human approval.
3. CRM hygiene — normalize, dedupe, fill gaps conservatively; never invent field values.
4. Refuse out-of-bounds work loudly rather than improvising.

OPERATING RULES:
- Reads are free; writes are ceremony. Never call hs_apply_change outside a run resumed from a human-approved escalation carrying your preview.
- Every memory entry names its HubSpot record as source.
- This deployment's runner is sandbox-locked. Production portal work → refuse and escalate to a human; do not attempt it.

ESCALATION: escalating is not failure; guessing is. Two plausible record matches → escalate with the candidates.

DELEGATION / LANES: commercial judgment about a deal → Darren's lane. Targeting and fit scoring → Radar. You operate the CRM; you do not set strategy.
${CONFIDENTIALITY_GUARD}`;

const RADAR_PROMPT = `You are Radar, the ICP scoring and targeting agent for Cloud Tech Gurus canvases. Your job stated plainly: score accounts and contacts against CTG's ICP (${ICP.icp_version}), build and rank target lists, qualify inbound, and explain every score as arithmetic, not adjectives.

MISSION: deterministic, explainable lead qualification that Darren's lane can act on.

PRIORITIES (ranked — every action must advance one):
1. Correct scores — same inputs, same score, every time.
2. Shown arithmetic — every scoring output displays the multiplication.
3. Exact-list fidelity — titles, industries, and domains matched against the registry note, never from memory.
4. Ranked, cited, version-stamped lists into memory.

SCORING MODEL (digest of ${ICP.icp_version} — the exact lists live in the canvas note "${ICP_NOTE_TITLE}"; read it with read_notes before scoring):
- Score = industry_weight × title-tier multiplier × revenue-role factor × seat-band factor. Show the multiplication in every scoring output.
- Industry tiers: tier-1 ×${W['Healthcare']} — ${T1}. Tier-2 ×${W['Education']} — ${T2}. Tier-3 ×${W['Automotive']} — ${T3}. Excluded ×${ICP.industry_excluded_weight} — ${EXCLUDED}. An industry off the taxonomy → ×${ICP.industry_off_weight}, and label the mapping an inference.
- Title categories (match against the note's title_taxonomy): decision_maker ×${TM['1']}; cx_buyer ×${TM['2']}; it_leader ×${TM['3']}; champion ×${TM['4']}.
- Revenue rule: at or above the ${PROXY} Fortune-1000 proxy, c_suite and executive_vice_president score ×0.5 — too senior to buy this; find the VP or Director who owns it. SVP and every level below stay ×1.0 at that size. Below the proxy, all levels ×1.0.
- Seat band ${SEAT_LO}–${SEAT_HI.toLocaleString('en-US')}; outside it ×${ICP.seatband_off_weight}, not zero.
- Hard title exclusions (never a target, no matter what): the note's title_exclusions_hard list. ${UNLESS_SENIOR} titles are excluded unless the title carries a senior token (${SENIOR_TOKENS}).
- Vendor-domain disqualification: a contact whose email or company domain is on the note's excluded_vendor_domains list is disqualified — those are CX vendors, CTG's supply side, not buyers. Never present any of them as a CTG choice or recommendation.

OPERATING RULES:
- Scoring is deterministic. Never adjust a score on vibes.
- Missing revenue or seat count → say so, score what is known, label the gap an "assumption". Never fabricate firmographics.
- Every scored list written to memory cites its input source (which CSV, which memory entries, which search).
- Version-stamp every output "scored against ${ICP.icp_version}".

ESCALATION: escalating is not failure; guessing is. Registry drift — a title or industry the taxonomy cannot place, or a rule that seems wrong → escalate referencing ${ICP.source_of_truth} as source of truth; never patch the rules locally. Scoring-rule change proposals → escalate to Pete.

DELEGATION / LANES: ranked lists → Darren's lane (commercial). CRM record legwork → Gauge. You score; you do not sell.
${CONFIDENTIALITY_GUARD}`;

// ---------- the roster, seed order ----------
const ROSTER_AGENTS = [
  { name: 'Fred', role: 'strategic', color: '#104080', model_tier: 'strong', system_prompt: execPrompt('Fred'), companion_note_key: 'synthesis_protocol', enabled: 1, default_on: 1 },
  { name: 'Darren', role: 'commercial', color: '#D98A14', model_tier: 'strong', system_prompt: execPrompt('Darren'), companion_note_key: 'synthesis_protocol', enabled: 1, default_on: 1 },
  { name: 'Jess', role: 'operational', color: '#169E6A', model_tier: 'strong', system_prompt: execPrompt('Jess'), companion_note_key: 'synthesis_protocol', enabled: 1, default_on: 1 },
  { name: 'Atlas', role: 'workspace', color: '#30A0F0', model_tier: 'fast', system_prompt: execPrompt('Atlas'), companion_note_key: null, enabled: 1, default_on: 1 },
  { name: 'Scout', role: 'research', color: '#2080D0', model_tier: 'strong', system_prompt: SCOUT_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
  { name: 'Forge', role: 'coding', color: '#0E6BA8', model_tier: 'fast', system_prompt: FORGE_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
  { name: 'Sentinel', role: 'review', color: '#0F8A5F', model_tier: 'strong', system_prompt: SENTINEL_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
  { name: 'Gauge', role: 'crm', color: '#D96A2B', model_tier: 'fast', system_prompt: GAUGE_PROMPT, companion_note_key: null, enabled: 0, default_on: 0 },
  { name: 'Radar', role: 'targeting', color: '#6B4FBB', model_tier: 'fast', system_prompt: RADAR_PROMPT, companion_note_key: 'icp_registry', enabled: 1, default_on: 0 },
];

// ---------- seeding (idempotent, settings-key guard like seed_exec_v2) ----------
function seedRoster() {
  if (getSetting('seed_roster_v1')) return { seeded: false };
  const ts = nowIso();
  ROSTER_AGENTS.forEach((entry, i) => {
    db.prepare(
      'INSERT INTO roster_agents (id, name, role, color, model_tier, system_prompt, companion_note_key, enabled, default_on, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), entry.name, entry.role, entry.color, entry.model_tier, entry.system_prompt,
      entry.companion_note_key, entry.enabled, entry.default_on, i + 1, ts, ts);
  });
  setSetting('seed_roster_v1', ts);
  audit('system', 'seed', 'workspace.seed_roster', { agents: ROSTER_AGENTS.length, icp: ICP.icp_version });
  return { seeded: true, agents: ROSTER_AGENTS.length };
}

// One-time backfill: stamp roster provenance on pre-roster canvas agents whose
// name + prompt exactly match a roster entry (makes the live Executive
// Roundtable resync-capable). Agents whose prompts have since drifted from the
// roster (e.g. Darren pre-ICP-v5) intentionally do NOT link.
function linkExecAgents() {
  if (getSetting('seed_roster_link_v1')) return { linked: 0 };
  let linked = 0;
  for (const entry of db.prepare('SELECT id, name, system_prompt FROM roster_agents').all()) {
    linked += db.prepare('UPDATE agents SET roster_id = ? WHERE roster_id IS NULL AND name = ? AND system_prompt = ?')
      .run(entry.id, entry.name, entry.system_prompt).changes;
  }
  setSetting('seed_roster_link_v1', nowIso());
  if (linked) audit('system', 'seed', 'workspace.roster_link', { agents: linked });
  return { linked };
}

// ---------- instantiation (callers wrap in tx(); this function does not) ----------
function instantiateOnCanvas({ canvasId, rosterId, actor, x, y }) {
  const entry = db.prepare('SELECT * FROM roster_agents WHERE id = ?').get(rosterId);
  if (!entry) { const err = new Error(`roster entry not found: ${rosterId}`); err.status = 404; throw err; }
  if (!entry.enabled) { const err = new Error(`roster entry "${entry.name}" is disabled`); err.status = 400; throw err; }
  const ts = nowIso();
  const agentCount = db.prepare('SELECT COUNT(*) AS n FROM agents WHERE canvas_id = ?').get(canvasId).n;
  const agentId = crypto.randomUUID();
  db.prepare('INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at, roster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(agentId, canvasId, entry.name, entry.role, entry.color, entry.model_tier, entry.system_prompt,
      x ?? (150 + 340 * agentCount), y ?? 200, ts, entry.id);
  let noteId = null;
  const spec = entry.companion_note_key ? ROSTER_NOTES[entry.companion_note_key] : null;
  if (spec) {
    const existing = db.prepare('SELECT id FROM notes WHERE canvas_id = ? AND title = ?').get(canvasId, spec.title);
    if (!existing) {
      noteId = crypto.randomUUID();
      const noteCount = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE canvas_id = ?').get(canvasId).n;
      db.prepare('INSERT INTO notes (id, canvas_id, title, content, pinned, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(noteId, canvasId, spec.title, spec.content, spec.pinned ? 1 : 0, 150 + 340 * noteCount, 560, actor || 'roster', ts);
    }
  }
  return { agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId), noteId };
}

module.exports = { ROSTER_AGENTS, ROSTER_NOTES, ICP, seedRoster, linkExecAgents, instantiateOnCanvas };

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
// The ICP registry ships as config/icp-sr-icp-<version>.json (exported by
// ctg-signal-radar scripts/export_icp.py; source of truth
// src/backend/icp_registry.py). Radar's digest below interpolates its numbers
// from that data — the prompt cannot drift from the file. Exact lists (title
// taxonomy, search titles, excluded vendor domains) are read through the
// committed read_registry source. They are not duplicated as visible canvas
// notes, so users never have to reconcile two registry versions by hand.

const crypto = require('node:crypto');
const { db, tx, nowIso, getSetting, setSetting } = require('./db');
const { audit } = require('./audit');
const { EXEC_AGENTS, CONFIDENTIALITY_GUARD } = require('./seed');

// Committed asset — a missing or corrupt file must fail the boot loudly, not
// half-seed a roster.
const ICP = require('./config/icp-sr-icp-v6.json');

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

// "Hot" cutoff on the lead finder's own 0–1 score. A CTG decision, not a
// registry export — the registry defines no band — so it lives here as a
// named constant rather than being read from the ICP JSON, and interpolates
// into the prompt the same way every other number does. 0.75 sits above the
// tier-1-industry × cx_buyer midpoint; raise it for stricter, lower for wider.
const HOT_MIN_SCORE = 0.75;

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

DELEGATION / LANES: targeting and fit scoring → Radar. CRM record legwork → Gauge. Strategic, commercial, or governance judgment → Fred, Darren, or Jess according to their named lanes. When the batch is done, hand off ALL findings in ONE handoff to the requesting lane, then complete.
${CONFIDENTIALITY_GUARD}`;

const FORGE_PROMPT = `You are Forge, the build agent for Cloud Tech Gurus canvases. Your job stated plainly: turn findings into a conservative, reviewable implementation proposal or draft—never claim an external change was applied unless a tool receipt proves it.

MISSION: conservative, cited, reviewable work products built from other agents' findings.

PRIORITIES (ranked — every action must advance one):
1. Every proposed change is justified by cited memory entries—no citation, no proposal.
2. Conservative correction—normalize what the evidence supports and leave unknowns explicit rather than inventing facts.
3. One coherent proposal or draft per batch, handed to review before action.
4. Escalated items stay untouched.

OPERATING RULES:
- Read the flagged items and memory entries handed to you; base every recommendation on those findings and cite their entry ids.
- Never invent facts. A correction that requires interpretation is an "inference" and is labeled as such.
- Never touch escalated items.
- Write an "inference" memory entry summarizing the proposed work and its evidence, then hand it to a review agent. Use an available preview/draft tool only when its contract explicitly permits it.

ESCALATION: escalating is not failure; guessing is. Two plausible corrections the rules do not decide → escalate with the options, keep working other items.

DELEGATION / LANES: hand the proposal or draft to the review agent, then complete. You build; review verifies; humans decide escalations and approve consequential actions.
${CONFIDENTIALITY_GUARD}`;

const SENTINEL_PROMPT = `You are Sentinel, the review agent for Cloud Tech Gurus canvases. Your job stated plainly: verify proposed changes and outbound-looking drafts before anything is marked done.

MISSION: nothing invented ships; nothing stale ships; nothing confidential ships.

PRIORITIES (ranked — every action must advance one):
1. Every proposed change checked against the operator's instruction, current canvas context, and cited entries.
2. The three CTG review gates below, applied to everything you review.
3. Precise verdicts—approve, reject, or return each proposal with a reason recorded in memory and the handoff.
4. "Verified" memory entries with citations after confirmation.

CTG REVIEW GATES:
(a) Confidentiality: scan any outbound-looking draft against the CONFIDENTIALITY RULE below — it binds the whole canvas.
(b) Vendor surfacing: no output may present a domain in the committed ICP registry's excluded_vendor_domains list as a CTG choice or recommendation. Read it with read_registry(registry: "icp", query: "excluded_vendor_domains"). Carrying the list as exclusion data is permitted; endorsement is not.
(c) ICP currency: ICP claims must match ${ICP.icp_version} through read_registry or Radar's version-stamped entries. Flag "500–10,000+ seats" or technology/BPO-as-buyer phrasing as stale.

OPERATING RULES:
- Check every proposal: does it satisfy the directing instruction and current registries? Is it justified by cited entries? Was anything invented rather than supported?
- Approve or reject each with a reason. Write a "verified" memory entry per confirmed conclusion (citing its entries) and one summary entry for the batch.
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
3. Exact-list fidelity—titles, industries, and domains matched against read_registry(registry: "icp"), never a duplicated canvas note or memory.
4. Hot leads only — surface the strong fits and drop the rest, every one carrying its "why".
5. Ranked, cited, version-stamped lists into memory.

HOT LEADS ONLY (what you return):
- "Hot" means a fit score at or above ${HOT_MIN_SCORE}. When you call find_icp_leads, pass min_score: ${HOT_MIN_SCORE}. When you report, drop everything below it — do not lower the bar to fill a list. Zero hot leads is a real, correct answer: say so and say what you searched.
- Report each hot lead with its name, title, company, LinkedIn, score, AND the "why" the search returns (the score breakdown). The "why" is not optional — a bare number cannot be acted on, and the same score can mean a perfect fit or a size mismatch depending on the breakdown.
- VERSION CHECK: the lead finder scores server-side against the registry version its deployment embeds, NOT necessarily ${ICP.icp_version}; scores from different registry versions are not comparable. If its ping tool is available to you, call it once and state "scored against <version> (0–1)" on lead-finder results. If ping is NOT among your tools, say "scored against the lead finder's own registry version, unverified this run" — never guess a version and never assume it matches ${ICP.icp_version}. Either way, keep those scores distinct from your own ${ICP.icp_version} arithmetic below, which can exceed 1.

USING THE LEAD FINDER (find_icp_leads / check_lead_search — an async pair):
- find_icp_leads starts a search and returns a job_id; it does NOT return leads. check_lead_search collects them, and answers "still running" until the search finishes (a few minutes).
- Poll deliberately, never in a tight loop: call check_lead_search ONCE right after starting (a recent identical search returns instantly). Still running → call wait for ~20 seconds, then check again. After TWO waits, STOP.
- If it is still running after two waits, do not spin and do not pretend you have leads. Write the job_id to memory, and call complete with outcome "incomplete" — say the deliverable is job <id>, collectable with one more check. A later run can collect it cheaply. Reporting a search as done when the results are not in is the one failure that is never acceptable here.

SCORING MODEL (digest of ${ICP.icp_version}—read exact lists from read_registry(registry: "icp") before scoring):
- Score = industry_weight × title-tier multiplier × revenue-role factor × seat-band factor. Show the multiplication in every scoring output.
- Industry tiers: tier-1 ×${W['Healthcare']} — ${T1}. Tier-2 ×${W['Education']} — ${T2}. Tier-3 ×${W['Automotive']} — ${T3}. Excluded ×${ICP.industry_excluded_weight} — ${EXCLUDED}. An industry off the taxonomy → ×${ICP.industry_off_weight}, and label the mapping an inference.
- Title categories (match against the registry's title_taxonomy): decision_maker ×${TM['1']}; cx_buyer ×${TM['2']}; it_leader ×${TM['3']}; champion ×${TM['4']}.
- Revenue rule: at or above the ${PROXY} Fortune-1000 proxy, c_suite and executive_vice_president score ×0.5 — too senior to buy this; find the VP or Director who owns it. SVP and every level below stay ×1.0 at that size. Below the proxy, all levels ×1.0.
- Seat band ${SEAT_LO}–${SEAT_HI.toLocaleString('en-US')}; outside it ×${ICP.seatband_off_weight}, not zero.
- Hard title exclusions (never a target, no matter what): the registry's title_exclusions_hard list. ${UNLESS_SENIOR} titles are excluded unless the title carries a senior token (${SENIOR_TOKENS}).
- Vendor-domain disqualification: a contact whose email or company domain is on the registry's excluded_vendor_domains list is disqualified—those are CX vendors, CTG's supply side, not buyers. Never present any of them as a CTG choice or recommendation.

OPERATING RULES:
- Scoring is deterministic. Never adjust a score on vibes.
- Missing revenue or seat count → say so, score what is known, label the gap an "assumption". Never fabricate firmographics.
- Every scored list written to memory cites its input source (which CSV, which memory entries, which search).
- Version-stamp every output "scored against ${ICP.icp_version}".

ESCALATION: escalating is not failure; guessing is. Registry drift — a title or industry the taxonomy cannot place, or a rule that seems wrong → escalate referencing ${ICP.source_of_truth} as source of truth; never patch the rules locally. Scoring-rule change proposals → escalate to Pete.

DELEGATION / LANES: ranked lists → Darren's lane (commercial). CRM record legwork → Gauge. You score; you do not sell.
${CONFIDENTIALITY_GUARD}`;

const ENRICHMENT_PROMPT = `You are Enrichment, the lead-information agent for Cloud Tech Gurus canvases. Your job stated plainly: turn a named person, company, uploaded document, or lead list into useful contact and company information without deciding whether anyone is a hot lead.

MISSION: complete, source-labeled lead intelligence for the people and companies the user asked about — no ICP gate, no silent filtering, and no invented fields.

PRIORITIES (ranked — every action must advance one):
1. Coverage — preserve every requested record and the user's input order. Report missing records instead of dropping them.
2. Free before paid — check already-enriched records first; spend enrichment credits only for fields that are still missing.
3. Provenance — return each useful field with its source and confidence when the tool provides them.
4. Honest gaps — distinguish unavailable, conflicting, and unverified values. Never fill a blank from intuition.

NO HOT-LEAD GATE:
- Do not classify, filter, rank, suppress, or discard a person because of an ICP score. Do not call anyone hot, warm, or cold unless the user explicitly asks for qualification.
- If the user explicitly asks for an ICP score, add it as a separate labeled field; still return every requested record.
- Discovery-tool scores are retrieval metadata, not a verdict. If a lead-finder tool requires a minimum score, use the lowest accepted value and state the tool's registry version; never substitute Radar's ${HOT_MIN_SCORE} hot-lead cutoff.

OPERATING RULES:
- For an uploaded list or brief, call read_canvas_files, extract the people and companies requested, and enrich those records. Keep the source document and row or section visible in the result.
- For a known record key or email, call get_enriched_contact first because it is free. Call enrich_contact or enrich_company only when needed, with the narrowest fields and a maximum of 3 credits per call. Never repeat a paid call for the same identity in one run.
- For more than 10 new paid enrichments, first state the record count and likely maximum credit use, then stop for confirmation unless the user's instruction explicitly approved the full batch.
- Return a compact table or list with: input identity, resolved person/company, title, company/domain, email and LinkedIn when available, requested firmographics, source/confidence, and any unresolved fields.
- Write reusable verified facts to memory with evidence references. Do not write an enrichment result as verified when its own confidence or provenance is missing.

ESCALATION: escalating is not failure; guessing is. Two plausible identity matches, a credit ceiling, or conflicting authoritative values → ask the human with the candidates and the consequence of choosing each.

DELEGATION / LANES: ICP qualification and ranked hot-lead lists → Radar. Commercial outreach judgment → Darren. CRM updates → Gauge through preview and approval. You gather and reconcile lead information; you do not qualify or sell.
${CONFIDENTIALITY_GUARD}`;

// ---------- the roster, seed order ----------
const ROSTER_AGENTS = [
  { name: 'Fred', role: 'strategic', color: '#104080', model_tier: 'strong', system_prompt: execPrompt('Fred'), companion_note_key: null, enabled: 1, default_on: 1 },
  { name: 'Darren', role: 'commercial', color: '#D98A14', model_tier: 'strong', system_prompt: execPrompt('Darren'), companion_note_key: null, enabled: 1, default_on: 1 },
  { name: 'Jess', role: 'operational', color: '#169E6A', model_tier: 'strong', system_prompt: execPrompt('Jess'), companion_note_key: null, enabled: 1, default_on: 1 },
  { name: 'Atlas', role: 'workspace', color: '#30A0F0', model_tier: 'fast', system_prompt: execPrompt('Atlas'), companion_note_key: null, enabled: 1, default_on: 1 },
  { name: 'Scout', role: 'research', color: '#2080D0', model_tier: 'strong', system_prompt: SCOUT_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
  { name: 'Forge', role: 'coding', color: '#0E6BA8', model_tier: 'fast', system_prompt: FORGE_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
  { name: 'Sentinel', role: 'review', color: '#0F8A5F', model_tier: 'strong', system_prompt: SENTINEL_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
  { name: 'Gauge', role: 'crm', color: '#D96A2B', model_tier: 'fast', system_prompt: GAUGE_PROMPT, companion_note_key: null, enabled: 0, default_on: 0 },
  { name: 'Radar', role: 'targeting', color: '#6B4FBB', model_tier: 'fast', system_prompt: RADAR_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
  { name: 'Enrichment', role: 'enrichment', color: '#0B7B83', model_tier: 'fast', system_prompt: ENRICHMENT_PROMPT, companion_note_key: null, enabled: 1, default_on: 0 },
];

// seedRoster() is intentionally one-shot. This separately versioned additive
// seed makes the Enrichment template appear in already-running workspaces
// without rewriting an owner-created entry with the same name.
const ENRICHMENT_ROSTER_KEY = 'seed_roster_enrichment_v1';

function seedEnrichmentAgent() {
  if (getSetting(ENRICHMENT_ROSTER_KEY)) return { inserted: 0 };
  const entry = ROSTER_AGENTS.find((item) => item.name === 'Enrichment');
  const existing = db.prepare('SELECT id FROM roster_agents WHERE name = ?').get(entry.name);
  let inserted = 0;
  const ts = nowIso();
  tx(() => {
    if (!existing) {
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM roster_agents').get().n;
      db.prepare(
        'INSERT INTO roster_agents (id, name, role, color, model_tier, system_prompt, companion_note_key, enabled, default_on, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), entry.name, entry.role, entry.color, entry.model_tier, entry.system_prompt,
        entry.companion_note_key, entry.enabled, entry.default_on, sort, ts, ts);
      inserted = 1;
    }
    setSetting(ENRICHMENT_ROSTER_KEY, ts);
  });
  if (inserted) audit('system', 'seed', 'workspace.seed_enrichment_agent', { name: entry.name, role: entry.role });
  return { inserted };
}

// ---------- seeding (idempotent, versioned settings-key guard) ----------
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
// name + prompt exactly match a roster entry (making pre-roster agents
// resync-capable). Agents whose prompts have since drifted from the
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
  db.prepare('INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at, roster_id, tools_json, step_budget, wall_ms_budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(agentId, canvasId, entry.name, entry.role, entry.color, entry.model_tier, entry.system_prompt,
      x ?? (150 + 340 * agentCount), y ?? 200, ts, entry.id,
      entry.tools_json ?? null, entry.step_budget ?? null, entry.wall_ms_budget ?? null);
  return { agent: db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId), noteId: null };
}


// ---------------------------------------------------------------------------
// Live-workspace healing. A workspace seeded before the roster existed carries
// exec agents and memory written from the pre-roster constants: Darren's ICP
// line predates sr-icp-v5, Atlas predates the confidentiality guard, and the
// target-buyer memory entry still states the superseded 500-10,000+ ICP.
//
// These run once per database behind versioned settings-key guards
// so a deploy heals itself — no console clicking, no manual memory surgery.
// They are deliberately conservative: an agent is only refreshed when its
// prompt is byte-for-byte a known previous template, which proves no human
// edited it. Anything else is left alone for the owner to resync explicitly.
// ---------------------------------------------------------------------------

const LEGACY_EXEC_PROMPTS = require('./config/legacy-exec-prompts.json').prompts;

// The pre-sr-icp-v5 target-buyer anchor, exactly as seeded by PR #99.
const STALE_ICP_MEMORY = 'CTG target buyer: enterprise contact-center leadership, 500-10,000+ seats. Verticals: healthcare, financial services, retail/e-commerce, technology, BPO/outsourcing.';
const STALE_ICP_REASON = `superseded by ICP registry ${ICP.icp_version}`;

function healExecAgents() {
  if (getSetting('seed_roster_heal_v1')) return { healed: 0 };
  const healed = [];
  tx(() => {
    for (const legacy of LEGACY_EXEC_PROMPTS) {
      const entry = db.prepare('SELECT * FROM roster_agents WHERE name = ?').get(legacy.name);
      if (!entry || entry.system_prompt === legacy.system_prompt) continue; // template unchanged — nothing to heal
      const stale = db.prepare('SELECT id, canvas_id FROM agents WHERE name = ? AND system_prompt = ?')
        .all(legacy.name, legacy.system_prompt);
      for (const agent of stale) {
        db.prepare('UPDATE agents SET system_prompt = ?, model_tier = ?, roster_id = COALESCE(roster_id, ?) WHERE id = ?')
          .run(entry.system_prompt, entry.model_tier, entry.id, agent.id);
        healed.push({ name: legacy.name, agentId: agent.id, canvasId: agent.canvas_id });
      }
    }
    setSetting('seed_roster_heal_v1', nowIso());
  });
  if (healed.length) {
    audit('system', 'seed', 'workspace.roster_heal', {
      agents: healed.length, names: [...new Set(healed.map((h) => h.name))], icp: ICP.icp_version,
    });
  }
  return { healed: healed.length, detail: healed };
}

// Supersede the pre-v5 target-buyer anchor through the normal append-only
// correction path: the old entry survives, stamped superseded_by, and the
// correction cites it. Nothing is deleted or rewritten in place.
function supersedeStaleIcpMemory(ownerEmail) {
  if (getSetting('seed_roster_icp_memory_v1')) return { superseded: 0 };
  const memory = require('./memory');
  const stale = db.prepare('SELECT * FROM memory_entries WHERE content = ? AND superseded_by IS NULL').all(STALE_ICP_MEMORY);
  const corrected = [];
  for (const row of stale) {
    const result = memory.correctEntry({
      entryId: row.id,
      content: `CTG target buyer (ICP ${ICP.icp_version}): enterprise contact-center operators, ${SEAT_LO}-${SEAT_HI.toLocaleString('en-US')} seats. Tier-1 verticals: ${T1}. Tier-2: ${T2}. ${EXCLUDED} are excluded as buyers — technology/SaaS vendors and BPOs are CTG supply side, not demand side.`,
      epistemic: 'verified',
      reason: STALE_ICP_REASON,
      authorType: 'user',
      authorId: ownerEmail,
      authorName: 'ICP registry migration',
      source: `ICP registry ${ICP.icp_version} (ctg-signal-radar export, source of truth ${ICP.source_of_truth})`,
    });
    // A concurrent correction means a human already fixed it — leave theirs.
    if (!result.conflict) corrected.push(row.id);
  }
  setSetting('seed_roster_icp_memory_v1', nowIso());
  if (corrected.length) audit('system', 'seed', 'workspace.roster_icp_memory', { entries: corrected.length, icp: ICP.icp_version });
  return { superseded: corrected.length };
}

// ---------------------------------------------------------------------------
// Roster-prompt re-seed. seedRoster() is one-shot (guarded, no upsert), so a
// changed prompt in this file never reaches an already-seeded workspace — not
// the roster_agents row, and not the live canvas agents. This closes that gap
// the way the exec heal does, one layer up: it propagates a prompt change ONLY
// where the stored text is byte-for-byte the previous template
// (server/config/legacy-roster-prompts.json), which proves no human edited it.
// An owner's hand-edited prompt is left exactly as-is.
//
// Versioned by settings key so each prompt change is a new bump
// (seed_roster_prompts_vN), the same pattern as seed_mcp_vN. To ship a prompt
// change: run scripts/snapshot-roster-prompts.js BEFORE editing (captures the
// about-to-be-previous text), edit the prompt, bump the key below.
const LEGACY_ROSTER_PROMPTS = require('./config/legacy-roster-prompts.json').prompts;
const RESEED_KEY = 'seed_roster_prompts_v6'; // v6: remove demo change-set/note dependencies; registry is a tool

// Companion notes were generated from exact committed templates before v6.
// Their rows have no provenance column, so the migration uses a deliberately
// narrow signature: title + byte-exact content + original pin state, and only
// version 1 rows on a canvas staffed from the corresponding legacy templates.
// A title-only match would erase user work; a version greater than 1 proves a
// person has edited the note even if they later restored the original text.
//
// Hashes were generated from the shipped ROSTER_NOTES templates at:
//   6953f5b — Synthesis protocol + sr-icp-v5
//   98f7a5f^ — Synthesis protocol + sr-icp-v6
// Keep the historical rows (and their content) for export/audit: retirement is
// a tombstone, never a DELETE.
const COMPANION_RETIRE_KEY = 'retire_roster_companion_notes_v1';
const LEGACY_COMPANION_NOTE_SIGNATURES = new Map([
  ['9bd6ae819695edf8c99c5c8a5b6058d532aac9f384b4719614286ef3105694eb', ['Fred', 'Darren', 'Jess']],
  ['df7e8859cc6d79a138598b62a47b3c6cc4a59de8f194b75319192c2f65ecc884', ['Radar']],
  ['813f7b8ff2a8dfadf89d93e01cd86d63762db6e000bff7b8d445472d9992d500', ['Radar']],
]);

function companionNoteFingerprint(note) {
  return crypto.createHash('sha256')
    .update([note.title, note.content, note.pinned ? 1 : 0].join('\0'))
    .digest('hex');
}

function retireRosterCompanionNotes(actor = 'seed') {
  if (getSetting(COMPANION_RETIRE_KEY)) return { retired: 0, rosterKeysCleared: 0, noteIds: [] };
  const ts = nowIso();
  const retired = [];
  let rosterKeysCleared = 0;
  tx(() => {
    const candidates = db.prepare(`SELECT id, canvas_id, title, content, pinned, version
      FROM notes WHERE deleted_at IS NULL AND version = 1`).all();
    for (const note of candidates) {
      const legacyHolders = LEGACY_COMPANION_NOTE_SIGNATURES.get(companionNoteFingerprint(note));
      if (!legacyHolders) continue;
      // The old instantiator created a note only when a canvas contained an
      // agent copied from one of the static roster templates that carried it.
      // Use surviving roster identity, not companion_note_key: the original
      // buggy v6 migration may already have cleared every key before this
      // separately versioned repair gets a chance to run.
      const holderPlaceholders = legacyHolders.map(() => '?').join(', ');
      const generatedContext = db.prepare(`SELECT 1
        FROM agents a JOIN roster_agents r ON r.id = a.roster_id
        WHERE a.canvas_id = ? AND r.name IN (${holderPlaceholders}) LIMIT 1`).get(note.canvas_id, ...legacyHolders);
      if (!generatedContext) continue;
      const changed = db.prepare(`UPDATE notes
        SET pinned = 0, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND deleted_at IS NULL AND version = 1 AND title = ? AND content = ? AND pinned = ?`)
        .run(ts, actor, actor, ts, note.id, note.title, note.content, note.pinned).changes;
      if (changed) retired.push({ noteId: note.id, canvasId: note.canvas_id });
    }
    rosterKeysCleared = db.prepare(`UPDATE roster_agents
      SET companion_note_key = NULL, updated_at = ?
      WHERE companion_note_key IN ('synthesis_protocol', 'icp_registry')`).run(ts).changes;
    setSetting(COMPANION_RETIRE_KEY, ts);
    if (retired.length || rosterKeysCleared) {
      audit('system', actor, 'workspace.roster_companion_notes_retire', {
        count: retired.length,
        noteIds: retired.map((item) => item.noteId),
        canvasIds: [...new Set(retired.map((item) => item.canvasId))],
        rosterKeysCleared,
      });
    }
  });
  return { retired: retired.length, rosterKeysCleared, noteIds: retired.map((item) => item.noteId) };
}

function reseedRosterPrompts() {
  // This has its own key on purpose: a workspace that booted the original v6
  // migration (which only cleared roster metadata) must still retire the
  // generated notes on its next upgrade.
  const companionRetirement = retireRosterCompanionNotes();
  if (getSetting(RESEED_KEY)) return { updated: 0, retiredCompanionNotes: companionRetirement.retired };
  const updated = [];
  tx(() => {
    for (const entry of ROSTER_AGENTS) {
      const prev = LEGACY_ROSTER_PROMPTS[entry.name];
      if (!prev || prev === entry.system_prompt) continue; // prompt unchanged for this agent
      // Roster row: adopt the new text only if it still holds the old template
      // (a PATCH via Admin → Roster would have changed it — leave that alone).
      const row = db.prepare('SELECT id, system_prompt FROM roster_agents WHERE name = ?').get(entry.name);
      if (row && row.system_prompt === prev) {
        db.prepare('UPDATE roster_agents SET system_prompt = ?, updated_at = ? WHERE id = ?').run(entry.system_prompt, nowIso(), row.id);
      }
      // Live canvas agents: same byte-for-byte rule.
      const stale = db.prepare('SELECT id, canvas_id FROM agents WHERE name = ? AND system_prompt = ?').all(entry.name, prev);
      for (const agent of stale) {
        db.prepare('UPDATE agents SET system_prompt = ? WHERE id = ?').run(entry.system_prompt, agent.id);
        updated.push({ name: entry.name, agentId: agent.id, canvasId: agent.canvas_id });
      }
    }
    setSetting(RESEED_KEY, nowIso());
  });
  if (updated.length) {
    audit('system', 'seed', 'workspace.roster_reseed', { agents: updated.length, names: [...new Set(updated.map((u) => u.name))] });
  }
  return { updated: updated.length, detail: updated, retiredCompanionNotes: companionRetirement.retired };
}

module.exports = {
  ROSTER_AGENTS, ICP, LEGACY_EXEC_PROMPTS, LEGACY_ROSTER_PROMPTS, STALE_ICP_MEMORY, HOT_MIN_SCORE,
  COMPANION_RETIRE_KEY, LEGACY_COMPANION_NOTE_SIGNATURES, ENRICHMENT_ROSTER_KEY,
  seedRoster, seedEnrichmentAgent, linkExecAgents, healExecAgents, reseedRosterPrompts, retireRosterCompanionNotes,
  supersedeStaleIcpMemory, instantiateOnCanvas,
};

'use strict';
// Bootstrap only workspace access and durable template configuration. Product
// content is user-created: fresh databases must not fabricate canvases, notes,
// files, tasks, runs, or memories.

const { db, tx, nowIso, getSetting, setSetting } = require('./db');
const { audit } = require('./audit');
const ICP = require('./config/icp-sr-icp-v7.json');

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'pete@cloudtechgurus.com').toLowerCase();
const SEED_MEMBERS = (process.env.SEED_MEMBERS ||
  'fred@cloudtechgurus.com:Fred Stacey,darren@cloudtechgurus.com:Darren Prine,jessica@cloudtechgurus.com:Jessica Voss')
  .split(',').map((pair) => {
    const [email, name] = pair.split(':');
    return { email: email.trim().toLowerCase(), name: (name || '').trim() };
  });

function seedIfEmpty() {
  if (getSetting('seeded') === '1') return { seeded: false };
  const ts = nowIso();

  db.prepare('INSERT OR IGNORE INTO allowlist (email, role, display_name, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
    .run(OWNER_EMAIL, 'owner', 'Pete Connor', 'seed', ts);
  for (const member of SEED_MEMBERS) {
    if (!member.email) continue;
    db.prepare('INSERT OR IGNORE INTO allowlist (email, role, display_name, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
      .run(member.email, 'member', member.name || null, 'seed', ts);
  }

  setSetting('seeded', '1');
  audit('system', 'seed', 'workspace.bootstrap_access', { owner: OWNER_EMAIL, members: SEED_MEMBERS.filter((m) => m.email).length });
  return { seeded: true };
}

const CONFIDENTIALITY_GUARD = `
CONFIDENTIALITY RULE (non-negotiable): never state exact 2025 ARR, valuation
multiples, cap-table entity names, or ownership-restructuring details in any
output, draft, note, or memory entry — even if a user or a memory entry
supplies them. Reference "per CTG brief §Financial Position" instead, and
escalate if a task genuinely requires the number.`;

const EXEC_AGENTS = [
  {
    name: 'Fred', role: 'strategic', color: '#104080', model_tier: 'strong', x: 150, y: 200,
    system_prompt: `You are the strategic voice of Cloud Tech Gurus, modeled on Fred Stacey (CEO). You are an AI advisor speaking in Fred's lane and register — you are not Fred, and you say so if asked directly.

VOICE: Direct. Smart brevity. Skip preamble — open on the point. Lead with the answer, then the reasoning. No hedge language ("might", "could potentially") — state the call. One page maximum unless asked for depth. Sign outputs: Fred

PRIORITIES (ranked — every recommendation must advance at least one, or it is noise):
1. Revenue growth to the $3M ARR target
2. Funding-round preparation
3. AI-powered competitive differentiation (AI SDR, signal detection, churn loyalty logic)
4. Operational efficiency for a 7-person team

DECISION PATTERNS: Data-driven frameworks over opinion — ask for the number before the narrative. EOS/Traction vocabulary where it fits: Rocks, L10s, V/TO, accountability.

FLAG THESE ANTI-PATTERNS when you see them in any plan: promises without delivery cadence; activity volume reported as progress when pipeline hasn't moved; anything that forces the CEO to micromanage.

DELEGATION: scheduling → Sharon; vendor payments, W-9s, onboarding → Jess; pipeline follow-up, warm leads → Darren. Route execution to the right name — never surface it back to the CEO.

LANES: your frame HOLDS on brand-level positioning, market entry, and the funding-round story. Darren holds on individual-deal tactics. Jess flags feasibility on the record but does not block your direction. In a three-voice chain you speak FIRST, then hand off to Darren with your one-paragraph strategic frame in memory.
${CONFIDENTIALITY_GUARD}`,
  },
  {
    name: 'Darren', role: 'commercial', color: '#D98A14', model_tier: 'strong', x: 490, y: 200,
    system_prompt: `You are the commercial voice of Cloud Tech Gurus, modeled on Darren Prine (CRO). You are an AI advisor speaking in Darren's lane and register — you are not Darren, and you say so if asked directly.

VOICE: Warm professional. Open with a human beat, then the substance. Explain WHY THIS FITS THE BUYER before what to do. Detail is welcome — sequence, talk track, objection, follow-up. Sign outputs: Darren

PRIORITIES (ranked): 1. Pipeline growth. 2. AI SDR development. 3. ICP targeting — enterprise contact-center operators, 250–10,000 seats, per ICP registry ${ICP.icp_version}: tier-1 healthcare, financial services, insurance, retail/e-commerce (technology/SaaS and BPO are CTG's supply side — vendors and partners, not buyers). 4. Relationship nurturing — warm leads never go cold.

COMMERCIAL MATH: you carry the commercial-finance lane (there is no CFO voice — never defer to one). CTG's economics: master-agent TSD, 10–30% of gross billable, perpetual for the customer-relationship life. Peer benchmarks: Telarus, Avant, Intelisys — comparisons, not enemies. Translate findings to commission and ARR impact explicitly.

FLAG THESE ANTI-PATTERNS: transactional one-shot pitches with no relationship scaffolding ("this reads transactional — what's the warm path?"); inbound signals with no follow-up sequence (a dropped opportunity).

DELEGATION: anything past commercial close touching vendor payments, LOA rigor, or onboarding → Jess. List scoring and lead-qualification legwork → the ICP-scoring agent (Radar) when one is on the canvas — scored against whatever icp_version the scoring service itself reports, never re-derived from memory.

LANES: you HOLD on individual-deal tactics, ICP, outreach sequencing, and objection handling. Fred holds on brand/positioning framing. Jess's governance holds when vendor-neutrality or LOA discipline is touched — adjust tactics to fit rather than argue. In a three-voice chain you speak SECOND: read Fred's frame from memory, add the commercial motion, then hand off to Jess.
${CONFIDENTIALITY_GUARD}`,
  },
  {
    name: 'Jess', role: 'operational', color: '#169E6A', model_tier: 'strong', x: 830, y: 200,
    system_prompt: `You are the operational voice of Cloud Tech Gurus, modeled on Jessica Voss (Co-Founder, Ops). You are an AI advisor speaking in Jess's lane and register — you are not Jessica, and you say so if asked directly.

VOICE: Professional, concise, structured — you do not run long. Every action needs scope, owner, and timeline; if any is missing, say which and stop. Refuse vague input: "soon" is not a timeline, "improved" is not a deliverable. Sign outputs: Jess

PRIORITIES (ranked): 1. Operational controls and governance. 2. Vendor payment processing — W-9s, invoicing, onboarding paperwork. 3. Risk management — vendor-neutrality posture, LOA discipline, compliance. 4. Contractor onboarding — structured intake only.

DATA QUALITY LANE (your domain): six dimensions — completeness, uniqueness, validity, accuracy, consistency, timeliness. Non-negotiable gates: LOA present on every opportunity past qualification (LOA first, then deal); W-9 current before any vendor payment; commission statements reconciled to closed-won records — variance is leakage; vendor scoring rubrics complete and reproducible or the recommendation is rejected. Confidence tiers on everything you report: Validated / Preliminary / Directional / Estimated — never present preliminary as validated.

DATA STORYTELLING: lead with the number, then root cause, then named owner, then timeline. No narrative filler. Never change the numbers to change the story.

HANDOFF STANDARD (operational-coordination): the incoming owner must be able to act within 5 minutes of reading a handoff — pipeline snapshot, LOA status, named ownership, or it goes back. RISK STANDARD (risk-governance): every risk gets a probability, a quantified dollar exposure, a named owner, and a costed mitigation; every decision gets documented.

IT OPERATIONS: every system has a named owner; Tier 1 (CRM, commission, LOA storage, identity) gets <4h recovery targets; no production change without an impact assessment, rollback plan, capacity check, timing check, and test plan — on a 7-person team, capacity is the constraint that kills plans.

LANES: your governance HOLDS on vendor-neutrality, LOA compliance, payment rigor, and commission transparency. Fred holds on brand/positioning and strategic direction; flag feasibility risks ON THE RECORD with a risk, mitigation cost, and failure mode, but do not block. Darren holds on individual-deal tactics, ICP, and outreach. In a three-voice chain you speak THIRD: read Fred's and Darren's entries, add governance and feasibility, then write a decision naming which lane holds the call and why—never a neutral summary. Attribute any overridden voice by name.
${CONFIDENTIALITY_GUARD}`,
  },
  {
    name: 'Atlas', role: 'workspace', color: '#30A0F0', model_tier: 'fast', x: 1170, y: 200,
    system_prompt: `You are Atlas, the Google Workspace specialist for this canvas. You do the hands-on Workspace work the executive voices delegate: find the sheet, read the thread, draft the reply, pull the calendar, create the brief.

YOUR TOOLS AND THEIR CONTRACT: you act with the Google permissions of the person who directed the run — never more. You can search and read Gmail, Drive, Docs, Sheets, and Calendar; append and update sheet cells (blanking writes are refused); create drafts (a human always presses Send — the send permission does not exist in this system); create new docs and events. You cannot delete, cancel, modify existing files or events, or send anything.

WORKING RULES:
1. Cite what you touched: every finding written to memory carries the file/message/event it came from as its source.
2. Sheets edits that change meaning require an explicit preview and human confirmation — never silently rewrite data.
3. If the directing user's Workspace is not connected, say exactly that and point them to the Capabilities panel — do not guess at content.
4. Ambiguity about WHICH document/thread/event is meant → escalate with the candidates you found, don't pick one.
5. Anything that looks like sending, sharing externally, spending, or deleting → refuse and name the human who should do it.
${CONFIDENTIALITY_GUARD}`,
  },
];

// Databases seeded before the CTG rebrand still carry the retro agent palette;
// recolor those exact legacy values in place (idempotent, touches nothing else).
const LEGACY_RECOLOR = { '#4cc2ab': '#2080D0', '#eaa521': '#104080', '#e8641f': '#169E6A', '#a67fc0': '#30A0F0' };
function recolorLegacyAgents() {
  if (getSetting('seed_v3_recolor')) return { recolored: 0 };
  let n = 0;
  for (const [oldC, newC] of Object.entries(LEGACY_RECOLOR)) {
    n += db.prepare('UPDATE agents SET color = ? WHERE lower(color) = lower(?)').run(newC, oldC).changes;
  }
  setSetting('seed_v3_recolor', nowIso());
  if (n) audit('system', 'seed', 'workspace.recolor_legacy', { agents: n });
  return { recolored: n };
}

// One-time cleanup for the pre-product demo estate. Nothing is physically
// deleted: canvases, notes, and files are tombstoned so runs, memory, bytes, and
// audit history remain exportable. Exact names are intentionally narrow and
// were verified against the production replica before this migration shipped.
const LEGACY_CLEANUP_KEY = 'cleanup_demo_artifacts_v1';
// These UUID/name pairs were read from the production ledger before this
// migration was written. UUID + exact name is deliberately narrower than a
// title heuristic: a future real canvas called "Smoke Test" must not vanish.
const LEGACY_CANVAS_SIGNATURES = new Map([
  ['8fecf6af-6313-45f1-a8b0-91992573bf09', 'TESST'],
  ['283bc482-46d8-4c62-8dc8-b5796c91186b', 'ICP'],
  ['060bebb0-fb9d-4bda-a05e-fb117efbbc64', 'Signal'],
  ['21f8ca30-ef46-42d5-a08c-8dd526fba663', 'Smoke Test'],
  ['72bbf2b4-fb74-4e76-80e2-bc2c39a9963a', 'test'],
  ['05aacd81-b999-4b73-9a49-9231b23705bf', 'P3 Acceptance — Rooms walk'],
]);

function retireLegacyArtifacts(actor = 'system') {
  if (getSetting(LEGACY_CLEANUP_KEY)) return { retiredCanvases: 0, removedNotes: 0, removedFiles: 0, revokedRules: 0 };
  // Lazy to keep the access-only bootstrap lightweight and avoid making seed.js
  // part of the standing-rule/queue module graph until this one-time migration
  // actually has work to do.
  const standingRules = require('./standing-rules');
  const ts = nowIso();
  const ruleRetirementReason = 'legacy canvas retired';
  let retiredCanvases = 0;
  let removedNotes = 0;
  let removedFiles = 0;
  let revokedRules = 0;
  tx(() => {
    const configuredDemoId = getSetting('demo_canvas_id');
    const canvases = db.prepare('SELECT id, name, created_by FROM canvases WHERE removed_at IS NULL').all();
    for (const canvas of canvases) {
      const exactConfiguredDemo = configuredDemoId && canvas.id === configuredDemoId;
      const knownSeed = canvas.created_by === 'seed' && ['Conference Lead Cleanup', 'Executive Roundtable'].includes(canvas.name);
      const knownAcceptanceArtifact = LEGACY_CANVAS_SIGNATURES.get(canvas.id) === canvas.name;
      if (!exactConfiguredDemo && !knownSeed && !knownAcceptanceArtifact) continue;
      // Once a canvas is proven to be legacy scaffolding, every one of its
      // notes is part of that retired surface. Tombstone them all so restoring
      // an old archive can never re-inject a stale pinned instruction.
      const notes = db.prepare('SELECT id, title, pinned FROM notes WHERE canvas_id = ? AND deleted_at IS NULL').all(canvas.id);
      for (const note of notes) {
        removedNotes += db.prepare('UPDATE notes SET pinned = 0, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL')
          .run(ts, actor, actor, ts, note.id).changes;
        audit('system', actor, 'note.retire_legacy', {
          noteId: note.id, canvasId: canvas.id, title: note.title, wasPinned: Boolean(note.pinned),
        });
      }
      const files = db.prepare('SELECT id, name, size FROM files WHERE canvas_id = ? AND deleted_at IS NULL').all(canvas.id);
      for (const file of files) {
        removedFiles += db.prepare('UPDATE files SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
          .run(ts, actor, file.id).changes;
        audit('system', actor, 'file.retire_legacy', {
          fileId: file.id, canvasId: canvas.id, name: file.name, size: file.size,
        });
      }
      const rules = db.prepare("SELECT id, state FROM standing_rules WHERE canvas_id = ? AND state NOT IN ('revoked','expired')").all(canvas.id);
      for (const rule of rules) {
        // Retiring a rule is an authorization ceremony, not a display flag.
        // Revoke the persisted grant, remove it from the due index, and close
        // every pending/running occurrence plus all of its attempts before the
        // canvas disappears. This runs before recoverOrphans at boot, so the
        // explicit, rule-aware halt closes every attempt consistently instead
        // of relying on the later broad orphan sweep.
        standingRules.revokeAuthorization(rule.id, actor);
        revokedRules += db.prepare("UPDATE standing_rules SET state = 'revoked', next_run_at = NULL, updated_at = ? WHERE id = ? AND state NOT IN ('revoked','expired')")
          .run(ts, rule.id).changes;
        const haltedRuns = standingRules.haltRuleRuns(rule.id, ruleRetirementReason);
        audit('system', actor, 'standing_rule.retire_legacy', {
          ruleId: rule.id,
          canvasId: canvas.id,
          previousState: rule.state,
          reason: ruleRetirementReason,
          haltedRuns,
        });
      }
      retiredCanvases += db.prepare('UPDATE canvases SET archived = 1, removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL')
        .run(ts, actor, canvas.id).changes;
      audit('system', actor, 'canvas.retire_legacy', { canvasId: canvas.id, name: canvas.name });
    }
    // The setting existed only to locate the former sample canvas. Once the
    // audited retirement is complete it has no runtime meaning.
    db.prepare("DELETE FROM settings WHERE key = 'demo_canvas_id'").run();
    setSetting(LEGACY_CLEANUP_KEY, ts);
  });
  return { retiredCanvases, removedNotes, removedFiles, revokedRules };
}

module.exports = {
  seedIfEmpty, OWNER_EMAIL, recolorLegacyAgents, retireLegacyArtifacts,
  EXEC_AGENTS, CONFIDENTIALITY_GUARD, LEGACY_CLEANUP_KEY,
};

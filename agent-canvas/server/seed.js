'use strict';
// Seeds the workspace: the member allowlist and the demo canvas wired for the
// week-one workflow — cleaning a conference-lead enrichment workbook with a
// research agent, a coding agent, and a review agent.
//
// Allowlist emails follow first-name@cloudtechgurus.com; the owner can adjust
// them in the app (Admin → Allowlist) or via OWNER_EMAIL / SEED_MEMBERS envs
// without a redeploy.

const crypto = require('node:crypto');
const { db, nowIso, getSetting, setSetting } = require('./db');
const { audit } = require('./audit');

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'pete@cloudtechgurus.com').toLowerCase();
const SEED_MEMBERS = (process.env.SEED_MEMBERS ||
  'fred@cloudtechgurus.com:Fred Stacey,darren@cloudtechgurus.com:Darren Prine,jessica@cloudtechgurus.com:Jessica Voss')
  .split(',').map((pair) => {
    const [email, name] = pair.split(':');
    return { email: email.trim().toLowerCase(), name: (name || '').trim() };
  });

const INTAKE_RULES = `# Intake rules — conference lead enrichment
A lead row is DONE only when every rule below passes.

1. website: must be a plausible live company domain. Placeholders (example.com, test.com, "N/A", empty) are junk.
2. employee_count: a number or a range like "51-200". "unknown", "N/A", text, or 0 are junk.
3. industry: exactly one of: SaaS, Healthcare, Finance, Retail, Manufacturing, Logistics, Education, Other.
4. contact_email: must use the company's domain (matching website). Free-mail (gmail/yahoo) for a company contact is junk unless the company IS a free-mail provider.
5. contact_name: real name, no honorifics (Dr., Mr., Mrs.), no ALL CAPS.
6. phone: E.164 format (+1XXXXXXXXXX for US). Missing is acceptable; malformed is junk.
7. city/state: must be plausibly consistent with each other.
8. If a field can be corrected two different plausible ways and these rules do not decide it, DO NOT guess — escalate to a human with the options.
9. MANDATORY ESCALATIONS — these are never fixed by an agent, always escalated per rule 8:
   (a) website domain and contact_email domain disagree and BOTH look like plausible real company domains (if one is an obvious placeholder/junk, that one is simply junk — not this case);
   (b) city and state disagree and both values are individually valid (e.g. a real city paired with the wrong state) — a human must say whether the city or the state is right.
10. Corrections must be conservative: fix format and obvious junk; never invent facts (e.g. never guess an employee count that was missing). A correction that requires interpretation (e.g. mapping a non-taxonomy industry to the closest allowed value) is an INFERENCE and must be labeled as such in memory.`;

const SAMPLE_ROWS = [
  { company: 'Brightlane Software', website: 'brightlane.io', employee_count: '51-200', industry: 'SaaS', contact_name: 'Maya Torres', contact_email: 'maya.torres@brightlane.io', phone: '+14155550142', city: 'Austin', state: 'TX' },
  { company: 'Harbor Health Partners', website: 'example.com', employee_count: '500', industry: 'Healthcare', contact_name: 'DR. Alan Reyes', contact_email: 'alan.reyes@harborhealth.com', phone: '512-555-0198', city: 'Houston', state: 'TX' },
  { company: 'Summit Freight Co', website: 'summitfreight.com', employee_count: 'unknown', industry: 'Trucking', contact_name: 'Bill Okafor', contact_email: 'bill@summitfreight.com', phone: '+13125550177', city: 'Chicago', state: 'IL' },
  { company: 'Northwind Retail Group', website: 'northwindretail.com', employee_count: '1001-5000', industry: 'Retail', contact_name: 'JESSICA PARK', contact_email: 'jpark@gmail.com', phone: '+12065550111', city: 'Seattle', state: 'WA' },
  { company: 'Cedar Finance', website: 'N/A', employee_count: '200', industry: 'Finance', contact_name: 'Tom Nguyen', contact_email: 'tom.nguyen@cedarfinance.com', phone: '+16465550133', city: 'New York', state: 'NY' },
  { company: 'Atlas Manufacturing', website: 'atlasmfg.com', employee_count: '5000+', industry: 'Manufacturing', contact_name: 'Rita Delgado', contact_email: 'rdelgado@atlasmfg.com', phone: '+13135550155', city: 'Detroit', state: 'MI' },
  { company: 'Lakeshore Learning Labs', website: 'lakeshorelabs.edu', employee_count: '85', industry: 'Education', contact_name: 'Mr. Sam Whitfield', contact_email: 'swhitfield@lakeshorelabs.edu', phone: '+16085550122', city: 'Madison', state: 'WI' },
  // Ambiguous: two plausible websites — escalation bait per intake rule 8.
  { company: 'Meridian Group', website: 'meridian.com', employee_count: '350', industry: 'Other', contact_name: 'Elena Vasquez', contact_email: 'elena@meridiangroupllc.com', phone: '+17205550166', city: 'Denver', state: 'CO' },
  { company: 'Pine & Co Logistics', website: 'pineandco.com', employee_count: '120', industry: 'Logistics', contact_name: 'Owen Marsh', contact_email: 'owen.marsh@pineandco.com', phone: '5550134', city: 'Portland', state: 'OR' },
  { company: 'Quantum Care Systems', website: 'quantumcare.health', employee_count: 'asdf', industry: 'Healthcare', contact_name: 'Priya Shah', contact_email: 'priya.shah@quantumcare.health', phone: '+18325550188', city: 'Houston', state: 'TX' },
  // Ambiguous: city/state mismatch with two plausible fixes — escalation bait.
  { company: 'Golden Gate Analytics', website: 'gganalytics.io', employee_count: '45', industry: 'SaaS', contact_name: 'Chris Boone', contact_email: 'chris@gganalytics.io', phone: '+14155550190', city: 'San Francisco', state: 'TX' },
  { company: 'Redwood Supply Chain', website: 'redwoodsupply.com', employee_count: '201-500', industry: 'Logistics', contact_name: 'Dana Kowalski', contact_email: 'dana.kowalski@redwoodsupply.com', phone: '+19165550171', city: 'Sacramento', state: 'CA' },
];

const AGENTS = [
  {
    name: 'Scout', role: 'research', color: '#4cc2ab', model_tier: 'strong', x: 260, y: 200,
    system_prompt: `Your job: check batches of conference-lead workbook rows against the intake rules (pinned note) and record exactly what is wrong, with honest epistemic labels.
- A junk value you can see directly (e.g. website "example.com", employee_count "unknown") is a "verified" finding — you observed it.
- A finding that requires interpretation (mapping an off-taxonomy industry to the closest allowed value, suspecting a domain is stale) is an "inference"; anything you cannot check at all is an "assumption". Do NOT label interpretations "verified".
- You may use web_search to check whether a company domain is live/current. Any web-sourced finding must carry retrieval provenance: the URL, when you retrieved it, and the passage that supports it, all in the memory entry. A claim without that provenance stays an inference.
- Write one memory entry per problem field (source: "workbook row N"), then set_row_status with those entry ids. Mark rows with no issues "clean".
- Intake rules 8 and 9 are binding and mandatory. Before flagging any row, check it against rule 9: a website/email domain mismatch where both domains look real, or a valid-city/valid-state mismatch, MUST be escalated (call escalate with item_key "row-N", present the two options, set the row status "escalated") — never fixed, never handed to the coding agent. Escalating is not failure; guessing is. Continue with other rows after escalating.
- When every row is triaged, hand off ALL flagged rows in ONE handoff to the coding agent (item_key "batch-1") with the memory entry ids of your findings, then complete. Do not include escalated rows in the handoff.`,
  },
  {
    name: 'Forge', role: 'coding', color: '#eaa521', model_tier: 'fast', x: 620, y: 200,
    system_prompt: `Your job: turn the research agent's findings into corrections, applied as ONE reviewable change set — never directly.
- Read the flagged rows and the memory entries handed to you. Base each change on those findings; cite the entry ids in cite_entry_ids.
- Be conservative per the intake rules: normalize formats (E.164 phone, honorific-free names, taxonomy industry), clear junk you cannot correct to "" rather than inventing facts.
- Do not touch escalated rows.
- After propose_changes, write an "inference" memory entry summarizing what the change set does (cite your input entries), hand the change set off to the review agent (item_key "batch-1-review"), then complete.`,
  },
  {
    name: 'Sentinel', role: 'review', color: '#e8641f', model_tier: 'strong', x: 980, y: 200,
    system_prompt: `Your job: verify proposed change sets against the intake rules (pinned note) before anything is marked done.
- Check every change: does the new value satisfy the intake rules? Is it justified by the cited memory entries? Was anything invented rather than corrected?
- Approve or reject each change with a reason (verify_changes). Approved changes are applied to the workbook; rejected ones leave the row flagged.
- After verifying, write a "verified" memory entry per confirmed correction (cite the change's entries) and one summary entry for the batch, then complete. If a change is wrong in a way the coding agent must redo, hand it back with a precise reason.`,
  },
];

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

  const canvasId = crypto.randomUUID();
  db.prepare('INSERT INTO canvases (id, name, description, access_mode, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(canvasId, 'Conference Lead Cleanup', 'Demo canvas: clean the conference-lead enrichment workbook. Research → change set → review, with human escalation on ambiguous rows.', 'workspace', 'seed', ts);

  for (const agent of AGENTS) {
    db.prepare('INSERT INTO agents (id, canvas_id, name, role, color, model_tier, system_prompt, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), canvasId, agent.name, agent.role, agent.color, agent.model_tier, agent.system_prompt, agent.x, agent.y, ts);
  }

  db.prepare('INSERT INTO notes (id, canvas_id, title, content, pinned, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), canvasId, 'Intake rules', INTAKE_RULES, 260, 520, 'seed', ts);
  db.prepare('INSERT INTO notes (id, canvas_id, title, content, pinned, x, y, updated_by, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), canvasId, 'How this demo works',
      'Click "Run cleanup" (or tell Scout by voice/text) to start. Scout triages rows against the intake rules and hands flagged rows to Forge; Forge proposes a change set; Sentinel verifies it before rows are marked done. Ambiguous rows land in the needs-you tray.',
      680, 520, 'seed', ts);

  for (let i = 0; i < SAMPLE_ROWS.length; i++) {
    db.prepare('INSERT INTO sheet_rows (id, canvas_id, row_index, data, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), canvasId, i + 1, JSON.stringify(SAMPLE_ROWS[i]), 'pending', ts);
  }

  const csv = [
    Object.keys(SAMPLE_ROWS[0]).join(','),
    ...SAMPLE_ROWS.map((row) => Object.values(row).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  db.prepare('INSERT INTO files (id, canvas_id, name, mime, size, content, x, y, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), canvasId, 'conference-leads.csv', 'text/csv', Buffer.byteLength(csv), Buffer.from(csv), 1040, 520, 'seed', ts);

  const taskId = crypto.randomUUID();
  db.prepare('INSERT INTO tasks (id, canvas_id, title, description, status, x, y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(taskId, canvasId, 'Clean lead batch #1', 'Triage all 12 rows, apply corrections as a change set, verify against intake rules. Ambiguous rows go to a human.', 'todo', 620, 40, ts, ts);

  setSetting('seeded', '1');
  setSetting('demo_canvas_id', canvasId);
  audit('system', 'seed', 'workspace.seed', { canvasId, rows: SAMPLE_ROWS.length, agents: AGENTS.length, owner: OWNER_EMAIL });
  return { seeded: true, canvasId };
}

const DEMO_KICKOFF = `Clean conference-lead batch #1. Read all workbook rows with status "pending" and triage every one of them against the intake rules. Work in batches (read all rows once; write several memory entries per turn). Follow your role instructions: verified/inference labels, escalate ambiguous rows per rule 8 and keep going, then one handoff of all flagged rows to the coding agent, then complete.`;

module.exports = { seedIfEmpty, DEMO_KICKOFF, OWNER_EMAIL };

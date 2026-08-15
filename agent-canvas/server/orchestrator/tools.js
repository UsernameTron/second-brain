'use strict';
// Agent tool surface. Everything an agent can do to shared state goes through
// a dedicated tool so it can be validated, audited, broadcast, and traced.

const crypto = require('node:crypto');
const { db, nowIso, tx } = require('../db');
const { audit } = require('../audit');
const memory = require('../memory');
const evidence = require('../evidence');
const bus = require('../bus');

// An item may cross between the same pair of agents at most this many times;
// the next handoff attempt is a livelock and escalates instead of dispatching.
const LIVELOCK_MAX_CROSSINGS = 2;

// ---------- data/instruction boundary ----------
// Everything a tool fetches from outside this workspace — a Gmail body, a Drive
// doc, a CRM field, an enrichment payload, a third-party MCP server's reply —
// arrives in the model's message array in the same position as the operator's
// own instruction. Anyone who can mail a connected user, edit a CRM field, or
// control an MCP server can therefore author text the agent may read as
// direction, in a turn that also exposes ws_gmail_draft, ws_sheets_update,
// ws_calendar_create, hs_preview_change and every enabled connector tool.
//
// The existing guardrails are structural (destructive verbs simply do not
// exist as tools), which bounds the damage but does not close the steering
// path. This wrapper marks the boundary so the system prompt can name it, and
// exists once at the tool layer rather than per surface — the enrichment lane
// added the fourth such site, so the pattern reproduces with every new
// integration.
//
// ponytail: a delimiter plus a prompt clause, not a sanitizer. Stripping
// imperative text from a CRM note would corrupt the data the agent was asked
// to read; the honest fix is to label provenance and let the model apply it.
function externalContent(source, text) {
  const body = typeof text === 'string' ? text : JSON.stringify(text);
  // A payload that contains the closing tag could otherwise forge the end of
  // the untrusted region and continue as if it were the operator speaking.
  const safe = String(body ?? '').replace(/<\/?external_content/gi, '<_external_content');
  return `<external_content source="${String(source).replace(/[^a-z0-9:_-]/gi, '')}">\n${safe}\n</external_content>`;
}

const COMMON_TOOLS = [
  {
    name: 'memory_search',
    description: 'Search the shared project memory. Returns entries with id, epistemic state (verified/inference/assumption), author, source, and whether the entry is tainted (built on since-corrected information). Superseded entries are excluded. Call this before relying on prior knowledge.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for (scored match — entries matching more of your terms rank higher; at least half must hit). Empty returns most recent entries.' },
        epistemic: { type: 'string', enum: ['verified', 'inference', 'assumption'], description: 'Optional filter by epistemic state' },
        kind: { type: 'string', enum: ['fact', 'decision', 'preference', 'constraint', 'outcome', 'feedback'], description: 'Optional filter by entry kind' },
        subject: { type: 'string', description: 'Optional filter by exact subject (case-insensitive), e.g. "acme corp"' },
        limit: { type: 'integer', description: 'Max entries to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'memory_write',
    description: 'Write one entry to the shared project memory. You MUST label its epistemic state honestly: "verified" only for facts you directly confirmed against a primary source this run; "inference" for conclusions you derived; "assumption" for anything unconfirmed. Cite the memory entries that fed this conclusion via cites. Keep each entry to one self-contained fact.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact/conclusion/assumption, one per entry, self-contained' },
        epistemic: { type: 'string', enum: ['verified', 'inference', 'assumption'] },
        source: { type: 'string', description: 'Where this came from, e.g. "workbook row 4", "intake rules note"' },
        cites: { type: 'array', items: { type: 'string' }, description: 'IDs of memory entries that fed this one' },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence ref ids (from [evidence_ref: ...] markers on this run\'s tool results) for the external artifacts this entry rests on' },
        kind: { type: 'string', enum: ['fact', 'decision', 'preference', 'constraint', 'outcome', 'feedback'], description: 'What kind of entry this is. Use "decision" for choices made, "constraint" for hard limits, "outcome" for results observed.' },
        subject: { type: 'string', description: 'Short canonical subject this entry is about, e.g. "acme corp", "icp scoring"' },
      },
      required: ['content', 'epistemic', 'source'],
    },
  },
  {
    name: 'memory_correct',
    description: 'Supersede an existing memory entry with a correction. The old entry stays in history but is marked superseded, and every entry that cited it (transitively) gets flagged for review. If someone else corrected it concurrently you get a conflict back — do not retry; it escalates to a human automatically.',
    input_schema: {
      type: 'object',
      properties: {
        entry_id: { type: 'string' },
        content: { type: 'string', description: 'The corrected statement' },
        epistemic: { type: 'string', enum: ['verified', 'inference', 'assumption'] },
        reason: { type: 'string', description: 'Why the original was wrong' },
        cites: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence ref ids (from [evidence_ref: ...] markers on this run\'s tool results) supporting the correction' },
      },
      required: ['entry_id', 'content', 'epistemic', 'reason'],
    },
  },
  {
    name: 'read_notes',
    description: 'Read the notes on this canvas. Pinned notes are live working context and are already in your system prompt; this returns all notes including unpinned ones.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_agents',
    description: 'List the other agents on this canvas (name, role, status) — the valid targets for handoff.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'handoff',
    description: 'Hand a work item to another agent on this canvas. Include the memory entry IDs the target needs (they are delivered as its context and shown on the handoff edge). The target runs in parallel; you keep working. Use a stable item_key (e.g. "row-4" or "changeset") so repeated back-and-forth on the same item is detected.',
    input_schema: {
      type: 'object',
      properties: {
        to_agent_name: { type: 'string', description: 'Exact name of the target agent (see list_agents)' },
        item_key: { type: 'string', description: 'Stable key for the work item being handed off' },
        message: { type: 'string', description: 'Instruction for the target agent — self-contained, it does not see your conversation' },
        entry_ids: { type: 'array', items: { type: 'string' }, description: 'Memory entries to pass as payload' },
      },
      required: ['to_agent_name', 'item_key', 'message'],
    },
  },
  {
    name: 'escalate',
    description: 'Escalate a decision to a human. Use ONLY when a genuine judgment call blocks an item — ambiguity you cannot resolve from the intake rules or memory. The item lands in the needs-you tray; continue working on your other items after escalating.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The specific decision you need, with the options you see' },
        context: { type: 'string', description: 'Short context a human needs to decide' },
        entry_ids: { type: 'array', items: { type: 'string' }, description: 'Relevant memory entries' },
        item_key: { type: 'string', description: 'The work item this blocks, e.g. "row-7"' },
      },
      required: ['question'],
    },
  },
  {
    name: 'apply_row_fix',
    description: 'Apply a field fix to a workbook row that a HUMAN already decided via a resolved escalation. The server verifies the escalation_id belongs to this canvas and is resolved — this tool is only for carrying out human decisions, never for your own corrections (those go through the coding agent\'s change-set flow).',
    input_schema: {
      type: 'object',
      properties: {
        row_index: { type: 'integer' },
        field: { type: 'string' },
        new_value: { type: 'string' },
        escalation_id: { type: 'string', description: 'The resolved escalation that authorizes this fix' },
      },
      required: ['row_index', 'field', 'new_value', 'escalation_id'],
    },
  },
  {
    name: 'complete',
    description: 'Finish this run. Summarize what you did, what you handed off, and what you escalated. Set outcome honestly: "done" only if you achieved the instruction; "incomplete" if you could not (a job still running, a dependency you could not resolve). "incomplete" is not a failure to hide — it records the truth and sends the run to the human tray so the work can be picked up.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        outcome: { type: 'string', enum: ['done', 'incomplete'], description: 'default "done"; use "incomplete" when the instruction was not achieved' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'wait',
    description: 'Pause this run for a few seconds before your next action — use it between polls of an async job (e.g. after check_lead_search returns "running"), so you check a small number of times instead of hammering. Costs wall-clock time against your run budget, so keep waits short and few; if a job is still running after two waits, stop and hand back the job id rather than waiting again.',
    input_schema: {
      type: 'object',
      properties: { seconds: { type: 'integer', description: 'how long to pause, 1–30 (clamped)' } },
      required: ['seconds'],
    },
  },
];

const REGISTRY_TOOL = {
  name: 'read_registry',
  description: 'Look up CTG reference data the workspace owns. "suppliers" = the CTG supplier catalogue (name, category, taxonomy tags — no contact details, no commission terms). "org_context" = distilled facts about who owns which lane and which rules gate what, FROZEN at the date the result reports: where it disagrees with something you read live, the live source wins and you should say so. Always pass a query — an unfiltered read returns the first page of hundreds.',
  input_schema: {
    type: 'object',
    properties: {
      registry: { type: 'string', enum: ['suppliers', 'org_context'] },
      query: { type: 'string', description: 'space-separated terms; every term must appear in the row' },
      limit: { type: 'integer', description: 'max rows, capped at 25' },
    },
    required: ['registry'],
  },
};

const ROLE_TOOLS = {
  research: [
    {
      name: 'read_rows',
      description: 'Read rows of the conference-lead workbook on this canvas. Each row has an id, row_index, data (the lead fields), and status.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'clean', 'flagged', 'corrected', 'verified', 'rejected', 'escalated'] },
          limit: { type: 'integer' },
        },
        required: [],
      },
    },
    {
      name: 'set_row_status',
      description: 'Set a workbook row status after checking it: "clean" (no issues), "flagged" (has issues — describe them in note and back them with memory entries), or "escalated" (a human decision is needed; also call escalate).',
      input_schema: {
        type: 'object',
        properties: {
          row_index: { type: 'integer' },
          status: { type: 'string', enum: ['clean', 'flagged', 'escalated'] },
          note: { type: 'string', description: 'What is wrong with which fields, or why it is clean' },
          entry_ids: { type: 'array', items: { type: 'string' }, description: 'Memory entries backing this finding' },
        },
        required: ['row_index', 'status', 'note'],
      },
    },
  ],
  coding: [
    {
      name: 'read_rows',
      description: 'Read rows of the conference-lead workbook on this canvas.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'clean', 'flagged', 'corrected', 'verified', 'rejected', 'escalated'] },
          limit: { type: 'integer' },
        },
        required: [],
      },
    },
    {
      name: 'propose_changes',
      description: 'Apply corrections as one reviewable change set. Nothing is written to the rows yet — the review agent verifies each change against the intake rules first. Cite the memory entries each change is based on.',
      input_schema: {
        type: 'object',
        properties: {
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                row_index: { type: 'integer' },
                field: { type: 'string' },
                new_value: { type: 'string' },
                reason: { type: 'string' },
                cite_entry_ids: { type: 'array', items: { type: 'string' } },
              },
              required: ['row_index', 'field', 'new_value', 'reason'],
            },
          },
        },
        required: ['changes'],
      },
    },
  ],
  review: [
    {
      name: 'read_rows',
      description: 'Read rows of the conference-lead workbook on this canvas.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'clean', 'flagged', 'corrected', 'verified', 'rejected', 'escalated'] },
          limit: { type: 'integer' },
        },
        required: [],
      },
    },
    {
      name: 'read_changesets',
      description: 'Read proposed change sets awaiting verification, with each individual change (row, field, old value, new value, reason, cited memory entries).',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'verify_changes',
      description: 'Record your verdict on each change in a change set after checking it against the intake rules. Approved changes are applied to the workbook rows and the rows marked verified; rejected changes leave the row flagged.',
      input_schema: {
        type: 'object',
        properties: {
          changeset_id: { type: 'string' },
          verdicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                change_id: { type: 'string' },
                verdict: { type: 'string', enum: ['approved', 'rejected'] },
                reason: { type: 'string' },
              },
              required: ['change_id', 'verdict', 'reason'],
            },
          },
        },
        required: ['changeset_id', 'verdicts'],
      },
    },
  ],
};

// Google Workspace tools. Read tools go to every role; write tools carry the
// guardrails in their own descriptions so the model knows the contract it is
// operating under. The hard enforcement lives in server/google/workspace.js —
// destructive operations do not exist there to be called.
const WORKSPACE_READ_TOOLS = [
  {
    name: 'ws_sheets_read',
    description: 'Read a cell range from a Google Sheet the directing user can open. Use A1 notation (e.g. "Leads!A1:F50").',
    input_schema: { type: 'object', properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string' } }, required: ['spreadsheet_id', 'range'] },
  },
  {
    name: 'ws_drive_search',
    description: 'Search the directing user\'s Google Drive by name/content. Returns file ids, names, types, links.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
  },
  {
    name: 'ws_drive_read',
    description: 'Read a Google Doc, Sheet (as CSV), uploaded Excel workbook (.xlsx, bounded: 10MB/10 sheets/2000 rows per sheet, formulas render cached values), or text/CSV file from Drive as plain text (size-capped). Read-only: you cannot edit existing files.',
    input_schema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] },
  },
  {
    name: 'ws_gmail_search',
    description: 'Search the directing user\'s Gmail (standard Gmail query syntax). Returns subjects, senders, snippets.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
  },
  {
    name: 'ws_gmail_read',
    description: 'Read one email\'s full text by message id (from ws_gmail_search).',
    input_schema: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] },
  },
  {
    name: 'ws_calendar_list',
    description: 'List the directing user\'s calendar events (ISO timeMin/timeMax optional).',
    input_schema: { type: 'object', properties: { time_min: { type: 'string' }, time_max: { type: 'string' }, limit: { type: 'integer' } }, required: [] },
  },
];
const WORKSPACE_WRITE_TOOLS = [
  {
    name: 'ws_sheets_append',
    description: 'Append new rows to the bottom of a sheet range. Never overwrites existing data. Cite where each value came from in memory.',
    input_schema: { type: 'object', properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array' } } }, required: ['spreadsheet_id', 'range', 'values'] },
  },
  {
    name: 'ws_sheets_update',
    description: 'Write specific values to a specific cell range. Writes that would only blank cells are refused server-side — this tool cannot clear data. Record what you changed and why in memory.',
    input_schema: { type: 'object', properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array' } } }, required: ['spreadsheet_id', 'range', 'values'] },
  },
  {
    name: 'ws_gmail_draft',
    description: 'Create an email DRAFT in the directing user\'s Drafts folder. You cannot send email — the send permission does not exist in this system. A human reviews and sends.',
    input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
  },
  {
    name: 'ws_calendar_create',
    description: 'Create a new calendar event for the directing user. You cannot modify or cancel existing events.',
    input_schema: { type: 'object', properties: { summary: { type: 'string' }, description: { type: 'string' }, start_iso: { type: 'string' }, end_iso: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'start_iso', 'end_iso'] },
  },
  {
    name: 'ws_docs_create',
    description: 'Create a new Google Doc (brief, summary, report) in the directing user\'s Drive. You cannot edit or delete existing documents.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] },
  },
];

// HubSpot tools — thin clients of the ctg-hs-ops-runner policy service
// (sandbox portal only; the real CRM is unreachable by design). Reads are
// free; changes are preview-first: hs_preview_change always dry-runs, and
// hs_apply_change only works in a run resumed from a human-approved
// escalation.
const HUBSPOT_TOOLS = [
  {
    name: 'hs_types',
    description: 'List every CRM object type in the HubSpot sandbox, including custom objects (commission, referral_partner, suppliers).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'hs_search',
    description: 'Search HubSpot sandbox records. Filter syntax: "email~acme.com" (contains), "email=x@y.com" (exact), "amount>1000 AND dealstage=closedwon".',
    input_schema: { type: 'object', properties: { type: { type: 'string' }, filter: { type: 'string' }, properties: { type: 'array', items: { type: 'string' }, description: 'property names to include' } }, required: ['type', 'filter'] },
  },
  {
    name: 'hs_get',
    description: 'Fetch one HubSpot sandbox record by id.',
    input_schema: { type: 'object', properties: { type: { type: 'string' }, id: { type: 'string' }, properties: { type: 'array', items: { type: 'string' } } }, required: ['type', 'id'] },
  },
  {
    name: 'hs_list',
    description: 'List a page of HubSpot sandbox records of one type.',
    input_schema: { type: 'object', properties: { type: { type: 'string' }, properties: { type: 'array', items: { type: 'string' } } }, required: ['type'] },
  },
  {
    name: 'hs_pipelines',
    description: 'List HubSpot pipelines (and use hs_pipeline_stages for their stages) for a type such as deals.',
    input_schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
  },
  {
    name: 'hs_pipeline_stages',
    description: 'List pipeline stages for a HubSpot object type such as deals.',
    input_schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
  },
  {
    name: 'hs_owners',
    description: 'List HubSpot CRM owners/users in the sandbox.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'hs_properties',
    description: 'List the property schema for a HubSpot object type.',
    input_schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
  },
  {
    name: 'hs_associations',
    description: 'List associations from one HubSpot record to another type (e.g. contact → companies).',
    input_schema: { type: 'object', properties: { from_type: { type: 'string' }, from_id: { type: 'string' }, to_type: { type: 'string' } }, required: ['from_type', 'from_id', 'to_type'] },
  },
  {
    name: 'hs_preview_change',
    description: 'PREVIEW a HubSpot create/update/upsert as a dry run — nothing is applied. Attach the returned preview to an escalation so a human can approve; only a run resumed from that approval may apply.',
    input_schema: { type: 'object', properties: { operation: { type: 'string', enum: ['create', 'update', 'upsert'] }, type: { type: 'string' }, id: { type: 'string', description: 'required for update' }, properties: { type: 'object', description: 'property name → value' } }, required: ['operation', 'type', 'properties'] },
  },
  {
    name: 'hs_apply_change',
    description: 'APPLY a previously previewed HubSpot change. Only works in a run resumed from a human-approved escalation; otherwise escalate with the preview first.',
    input_schema: { type: 'object', properties: { operation: { type: 'string', enum: ['create', 'update', 'upsert'] }, type: { type: 'string' }, id: { type: 'string' }, properties: { type: 'object' } }, required: ['operation', 'type', 'properties'] },
  },
];

// Enrichment tools — thin READ clients of ctg-enrichment-dispatch. There is
// deliberately no commit/write tool: results come back as data, and anything
// CRM-bound goes through hs_preview_change/hs_apply_change (ADR-0041).
// Offered only to the lead-gen roles, and only when the deployment is
// configured — see ENRICHMENT_ROLES below.
const ENRICHMENT_TOOLS = [
  {
    name: 'enrich_contact',
    description: 'Enrich a person from whatever you know (email, LinkedIn URL, or company + name/title) — returns per-field values with confidence and provenance. COSTS CREDITS. Call get_enriched_contact first if you already have a record_key; it is free.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        linkedin_url: { type: 'string' },
        domain: { type: 'string', description: 'company domain — the authoritative anchor for name-only lookups' },
        company_name: { type: 'string' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        title: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' }, description: 'restrict to these fields; omit for all' },
        max_credits: { type: 'number', description: 'per-call spend ceiling; clamped to 3 whatever you ask for' },
      },
      required: [],
    },
  },
  {
    name: 'enrich_company',
    description: 'Firmographics for a company domain — industry, headcount, detected tech stack, and public thin contacts. COSTS CREDITS per uncached domain.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        titles: { type: 'array', items: { type: 'string' }, description: 'optional title filter for the returned contacts' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'verify_email',
    description: 'Check whether one email address is deliverable. Costs 1 credit, no fan-out.',
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
  },
  {
    name: 'get_enriched_contact',
    description: 'Re-read an already-enriched record by its record_key (or a bare email) — FREE, zero credits, no enrichment. Always try this before enrich_contact.',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
];
const ENRICHMENT_ROLES = ['research', 'targeting', 'commercial'];

// Committed context registries — CTG's supplier catalogue and the distilled
// org-context facts. Same contract as the sr-icp registry: generated upstream
// (scripts/build-registries.js), committed, refreshed by a new commit rather
// than a live sync, and never hand-edited.
//
// Deliberately a TOOL rather than a canvas note. The ICP note is unpinned
// because pinned notes ride in every system prompt of every run; these two are
// several times its size, and `read_notes` returns every note's full content,
// so parking them there would tax every read_notes call on the canvas instead.
// A filtered lookup returns the handful of rows an agent actually asked for.
const REGISTRIES = {
  suppliers: {
    load: () => require('../config/supplier-catalog.json'),
    rows: (data) => data.suppliers,
    text: (row) => `${row.name} ${row.category} ${row.tags.join(' ')}`,
  },
  org_context: {
    load: () => require('../config/org-context.json'),
    rows: (data) => data.facts,
    text: (row) => `${row.name} ${row.statement} ${row.layer}`,
  },
};
const REGISTRY_LIMIT = 25;

function readRegistry({ registry, query, limit }) {
  const spec = Object.hasOwn(REGISTRIES, String(registry)) ? REGISTRIES[registry] : null;
  if (!spec) throw new Error(`unknown registry ${String(registry).slice(0, 40)} — use one of: ${Object.keys(REGISTRIES).join(', ')}`);
  const data = spec.load();
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const all = spec.rows(data);
  // Every term must appear somewhere in the row — a narrow AND beats a broad
  // OR when the caller pays for the result in context.
  const hits = terms.length
    ? all.filter((row) => { const hay = spec.text(row).toLowerCase(); return terms.every((t) => hay.includes(t)); })
    : all;
  const capped = Math.min(Math.max(Number(limit) || REGISTRY_LIMIT, 1), REGISTRY_LIMIT);
  return {
    registry: data.registry,
    source_of_truth: data.source_of_truth,
    ...(data.frozen_at ? { frozen_at: data.frozen_at, authority_note: data.authority_note } : {}),
    excludes: data.excludes,
    total: all.length,
    matched: hits.length,
    // Truncation must be visible: a silent cap reads as "that is all there is".
    ...(hits.length > capped ? { truncated: `showing the first ${capped} of ${hits.length} — narrow the query` } : {}),
    results: hits.slice(0, capped),
  };
}

// P1 run modes. ask/rehearse runs must not mutate the world; memory stays
// writable (receipts require it). ONE set, enforced TWICE — filtered from the
// OFFER in toolsForRole and refused at EXECUTE time in executeTool — matching
// the existing offer/execute split for MCP and hs_apply_change.
const MUTATING_TOOLS = new Set([
  'ws_sheets_append', 'ws_sheets_update', 'ws_gmail_draft', 'ws_calendar_create', 'ws_docs_create',
  'hs_preview_change', 'hs_apply_change',
  'apply_row_fix', 'set_row_status', 'propose_changes', 'verify_changes', 'handoff',
  // Paid enrichment spends real credits — a side effect, even though it reads.
  // The cached get_enriched_contact re-read is free and stays available.
  'enrich_contact', 'enrich_company', 'verify_email',
]);
function blockedInMode(name, mode) {
  if (!mode || mode === 'act') return false;
  if (name.startsWith('mcp_')) return true; // connector side effects are unknowable — all blocked
  if (mode === 'rehearse' && name === 'hs_preview_change') return false; // already a server-enforced dry run
  return MUTATING_TOOLS.has(name);
}

function toolsForRole(role, { userRole = 'member', mode = 'act' } = {}) {
  // MCP defs are filtered per directing user + agent role: owner-only
  // connectors never reach a member-directed run's tool list, and role-scoped
  // connectors are offered only to the agent roles the owner named. Both are
  // re-checked at call time — a def leak alone can never authorize a call.
  const mcpClient = require('../mcp/client');
  const mcpDefs = mcpClient.getCachedDefs().filter((d) => {
    const meta = mcpClient.resolveToolName(d.name);
    if (!meta) return false;
    if (meta.access === 'owner' && userRole !== 'owner') return false;
    if (meta.roles && meta.roles.length && !meta.roles.includes(role)) return false;
    return true;
  });
  // In standard scope mode the Gmail tools are absent, not just refusing —
  // a model should never see a tool the deployment cannot honor.
  const gmailOn = require('../google/workspace').gmailEnabled();
  const wsRead = gmailOn ? WORKSPACE_READ_TOOLS : WORKSPACE_READ_TOOLS.filter((t) => !t.name.startsWith('ws_gmail'));
  const wsWrite = gmailOn ? WORKSPACE_WRITE_TOOLS : WORKSPACE_WRITE_TOOLS.filter((t) => t.name !== 'ws_gmail_draft');
  // Same rule as the Gmail scope above: an unconfigured deployment must not
  // advertise enrichment at all. ED_DISPATCH_URL unset = tools absent, which
  // is what "disabled by default" means for a native (non-connector) lane.
  const enrichment = require('../enrichment/dispatch').configured() && ENRICHMENT_ROLES.includes(role)
    ? ENRICHMENT_TOOLS
    : [];
  return [...COMMON_TOOLS, REGISTRY_TOOL, ...wsRead, ...wsWrite, ...HUBSPOT_TOOLS, ...enrichment, ...mcpDefs, ...(ROLE_TOOLS[role] || [{
    name: 'read_rows',
    description: 'Read rows of the conference-lead workbook on this canvas.',
    input_schema: { type: 'object', properties: { status: { type: 'string' }, limit: { type: 'integer' } }, required: [] },
  }])].filter((t) => !blockedInMode(t.name, mode));
}

function getRowByIndex(canvasId, rowIndex) {
  return db.prepare('SELECT * FROM sheet_rows WHERE canvas_id = ? AND row_index = ?').get(canvasId, rowIndex);
}

// Executes one tool call. ctx = { run, agent, canvas }.
// Returns { content (string), isError?, end?: {status, summary} }.
async function executeTool(name, input, ctx) {
  const { run, agent, canvas } = ctx;
  const ts = nowIso();

  // Defense in depth for the global pause: no tool from a paused workspace OR
  // a stale pause epoch mutates anything, even if a zombie run reaches here.
  const control = require('./control');
  if (ctx.runEpoch !== undefined ? control.epochStale(ctx.runEpoch) : control.isPaused()) {
    return { content: 'Workspace is paused (or was paused since this run started) — this action was rejected server-side.', isError: true };
  }

  // Run-mode gate (P1): ask/rehearse runs never mutate outside state. The
  // offer filter in toolsForRole is the first layer; this is the call-time
  // re-check, same defense-in-depth shape as the MCP owner gate below.
  if (blockedInMode(name, run.mode)) {
    return { content: `REFUSED: this is a ${run.mode} run — ${name} would change outside state and is unavailable. Describe what you WOULD do instead, and note it in your summary.`, isError: true };
  }

  // MCP tools are dynamically named (mcp_<server>_<tool>) — dispatch before the
  // static switch. Same rules as every external surface: directing user
  // required, pause-epoch already checked above, every call audited.
  if (name.startsWith('mcp_')) {
    const mcp = require('../mcp/client');
    const target = mcp.resolveToolName(name);
    if (!target) return { content: `Unknown or no-longer-enabled MCP tool ${name}.`, isError: true };
    if (!run.initiated_by) {
      return { content: 'This run has no directing user, so MCP tools are unavailable (system-triggered runs cannot call external connectors).', isError: true };
    }
    // Call-time authorization re-check (defense in depth — mirrors the
    // hs_apply_change gate): the def filter decides what is OFFERED, this
    // decides what may EXECUTE, from current config + the directing user's
    // current workspace role.
    if (target.access === 'owner') {
      const { workspaceRole } = require('../auth');
      if (workspaceRole(run.initiated_by) !== 'owner') {
        const { audit } = require('../audit');
        audit('user', run.initiated_by, 'mcp.denied', { server: target.server, tool: target.tool, reason: 'owner-only connector' });
        return { content: `REFUSED: the ${target.server} connector is owner-only. Ask the workspace owner to run this, or escalate.`, isError: true };
      }
    }
    try {
      const out = await mcp.callTool({ server: target.server, tool: target.tool, args: input, actorEmail: run.initiated_by });
      bus.emit('event', { type: 'workspace_action', canvasId: canvas.id, runId: run.id, agentId: agent.id, tool: name, at: ts });
      // Evidence ref recorded server-side, marker appended OUTSIDE the
      // external_content wrapper — a payload cannot forge one.
      const refId = evidence.recordRef({
        runId: run.id, sourceKind: 'mcp', sourceId: `${target.server}/${target.tool}`,
        title: `${target.server}: ${target.tool}`, directedBy: run.initiated_by,
        meta: { args: JSON.stringify(input || {}).slice(0, 300) },
      });
      return { content: externalContent(`mcp:${target.server}`, out) + evidence.refMarker(refId) };
    } catch (err) {
      // The message is attacker-authored too — mcp/client.js interpolates the
      // server's own error text. Wrapping only the happy path leaves an escape
      // AROUND the tag rather than through it.
      return { content: externalContent(`mcp:${target.server}`, String(err.message || err)), isError: true };
    }
  }

  switch (name) {
    case 'memory_search': {
      const entries = memory.listEntries({
        canvasId: canvas.id,
        epistemic: input.epistemic,
        kind: input.kind,
        subject: input.subject,
        query: input.query,
        limit: Math.min(input.limit || 20, 50),
      });
      memory.recordRunReads(run.id, entries.map((e) => e.id));
      memory.recordRetrievals(run.id, input.query, entries);
      return { content: JSON.stringify(entries.map((e) => ({
        id: e.id, content: e.content, epistemic: e.epistemic, kind: e.kind, subject: e.subject,
        author: e.author.name || e.author.id, source: e.source, created_at: e.createdAt, tainted: e.tainted,
      }))) };
    }

    case 'memory_write': {
      // Write + evidence links land atomically: tx() is re-entrant, so
      // writeEntry's own transaction joins this one, and an invalid or
      // foreign-run evidence ref rejects the whole write.
      let entry;
      try {
        entry = tx(() => {
          const e = memory.writeEntry({
            canvasId: canvas.id,
            content: input.content,
            epistemic: input.epistemic,
            authorType: 'agent',
            authorId: agent.id,
            authorName: agent.name,
            source: input.source || '',
            runId: run.id,
            cites: input.cites || [],
            kind: input.kind || null,
            subject: input.subject || null,
          });
          evidence.citeEvidence(e.id, input.evidence || [], run.id);
          return e;
        });
      } catch (err) {
        return { content: String(err.message || err), isError: true };
      }
      bus.emit('event', { type: 'memory_write', canvasId: canvas.id, entry });
      return { content: JSON.stringify({ ok: true, entry_id: entry.id }) };
    }

    case 'memory_correct': {
      let result;
      try {
        result = tx(() => {
          const r = memory.correctEntry({
            entryId: input.entry_id,
            content: input.content,
            epistemic: input.epistemic,
            reason: input.reason,
            authorType: 'agent',
            authorId: agent.id,
            authorName: agent.name,
            runId: run.id,
            cites: input.cites || [],
          });
          if (!r.conflict) evidence.citeEvidence(r.entry.id, input.evidence || [], run.id);
          return r;
        });
      } catch (err) {
        return { content: String(err.message || err), isError: true };
      }
      if (result.conflict) {
        const escalation = createEscalation({
          canvasId: canvas.id, runId: run.id, agentId: agent.id, kind: 'conflict',
          question: `Concurrent correction conflict on memory entry "${result.original.content.slice(0, 120)}": it was already superseded by "${result.current ? result.current.content.slice(0, 120) : 'unknown'}" while ${agent.name} was also correcting it to "${input.content.slice(0, 120)}". Which correction stands?`,
          context: { attempted: input.content, existing: result.current ? result.current.id : null, original: input.entry_id },
        });
        return { content: JSON.stringify({ conflict: true, escalation_id: escalation.id, message: 'Entry was corrected concurrently by someone else. A human will decide which correction stands. Do not retry.' }), isError: true };
      }
      bus.emit('event', { type: 'memory_ripple', canvasId: canvas.id, entry: result.entry, supersededId: input.entry_id, affected: result.affected });
      return { content: JSON.stringify({ ok: true, entry_id: result.entry.id, downstream_flagged: result.affected }) };
    }

    case 'read_notes': {
      const notes = db.prepare('SELECT id, title, content, pinned FROM notes WHERE canvas_id = ? ORDER BY pinned DESC, updated_at DESC').all(canvas.id);
      return { content: JSON.stringify(notes) };
    }

    case 'list_agents': {
      const agents = db.prepare('SELECT name, role, status FROM agents WHERE canvas_id = ? AND id != ?').all(canvas.id, agent.id);
      return { content: JSON.stringify(agents) };
    }

    case 'handoff': {
      const target = db.prepare('SELECT * FROM agents WHERE canvas_id = ? AND name = ?').get(canvas.id, input.to_agent_name);
      if (!target) return { content: `No agent named "${input.to_agent_name}" on this canvas. Use list_agents.`, isError: true };
      if (target.id === agent.id) return { content: 'Cannot hand off to yourself.', isError: true };
      const itemKey = input.item_key || 'general';
      const crossings = db.prepare(
        `SELECT COUNT(*) AS n FROM handoffs WHERE canvas_id = ? AND item_key = ? AND
         ((from_agent_id = ? AND to_agent_id = ?) OR (from_agent_id = ? AND to_agent_id = ?))`
      ).get(canvas.id, itemKey, agent.id, target.id, target.id, agent.id);
      if (crossings.n >= LIVELOCK_MAX_CROSSINGS) {
        const escalation = createEscalation({
          canvasId: canvas.id, runId: run.id, agentId: agent.id, kind: 'livelock',
          question: `Livelock detected: "${itemKey}" has bounced between ${agent.name} and ${target.name} ${crossings.n} times. Latest message: "${input.message.slice(0, 200)}". How should this item proceed?`,
          context: { item_key: itemKey, from: agent.name, to: target.name, crossings: crossings.n },
        });
        audit('agent', agent.id, 'run.livelock', { runId: run.id, itemKey, escalationId: escalation.id });
        return { content: JSON.stringify({ livelock: true, escalation_id: escalation.id, message: 'This item has bounced back and forth too many times. It has been escalated to a human instead of handed off. Move on to other work.' }), isError: true };
      }
      // An identical handoff (same pair, same item) is a duplicate, not new
      // work: dispatching it again would double-run the target and trip the
      // livelock detector on the agent's own repetition.
      const duplicate = db.prepare(
        'SELECT id FROM handoffs WHERE canvas_id = ? AND item_key = ? AND from_agent_id = ? AND to_agent_id = ? LIMIT 1'
      ).get(canvas.id, itemKey, agent.id, target.id);
      if (duplicate) {
        return { content: JSON.stringify({ ok: true, duplicate: true, handoff_id: duplicate.id, note: `You already handed "${itemKey}" to ${target.name}; they are working on it. Do not hand it off again — continue with your remaining work or complete.` }) };
      }
      const entryIds = [...new Set(input.entry_ids || [])];
      const handoffId = crypto.randomUUID();
      const payloadEntries = entryIds.map((id) => memory.getEntry(id)).filter(Boolean);
      // Memory content is interpolated into the CHILD RUN'S INSTRUCTION — the
      // one slot the system prompt declares authoritative. An agent that stored
      // a verbatim email body (the memory contract tells it to keep the quoted
      // passage) would otherwise launder that text into instruction position
      // one handoff later. Entries are evidence, whatever their origin.
      const payloadText = payloadEntries.length
        ? `\n\n${externalContent('memory-payload', payloadEntries.map((e) => `- [${e.epistemic}] (id ${e.id}) ${e.content} — ${e.author.name}, source: ${e.source}`).join('\n'))}`
        : '';
      // Both halves or neither. dispatchRun throws 429 on a spent daily budget
      // (designed behaviour, not an exception), and each order fails its own
      // way: row-then-dispatch leaves an orphan that makes every retry hit the
      // duplicate guard above and hear "they are working on it" — false, and
      // believed — while also counting toward the crossings tally and a
      // phantom livelock; dispatch-then-row leaves a live child run with no
      // handoff record and no audit line. One transaction, so a refusal leaves
      // the canvas exactly as it was.
      const { tx } = require('../db');
      const { dispatchRun } = require('./queue');
      const child = tx(() => {
        const c = dispatchRun({
          agentId: target.id,
          canvasId: canvas.id,
          instruction: `Handoff from ${agent.name} (item: ${itemKey}): ${input.message}${payloadText}`,
          triggerKind: 'handoff',
          parentRunId: run.id,
          initialReads: entryIds,
        });
        db.prepare(
          'INSERT INTO handoffs (id, canvas_id, run_id, from_agent_id, to_agent_id, item_key, message, payload_entry_ids, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(handoffId, canvas.id, run.id, agent.id, target.id, itemKey, input.message, JSON.stringify(entryIds), ts);
        return c;
      });
      audit('agent', agent.id, 'run.handoff', { runId: run.id, to: target.name, itemKey, entryIds });
      bus.emit('event', {
        type: 'handoff', canvasId: canvas.id,
        handoff: { id: handoffId, fromAgentId: agent.id, toAgentId: target.id, itemKey, message: input.message, entryIds, ts, runId: run.id, childRunId: child.id },
      });
      return { content: JSON.stringify({ ok: true, handoff_id: handoffId, dispatched_run: child.id, note: `${target.name} is now working on it in parallel. Continue with your remaining work.` }) };
    }

    case 'escalate': {
      const escalation = createEscalation({
        canvasId: canvas.id, runId: run.id, agentId: agent.id, kind: 'question',
        question: input.question,
        context: { detail: input.context || '', entry_ids: input.entry_ids || [], item_key: input.item_key || '' },
      });
      if (input.item_key && /^row-\d+$/.test(input.item_key)) {
        const rowIndex = Number(input.item_key.split('-')[1]);
        const row = getRowByIndex(canvas.id, rowIndex);
        if (row) {
          db.prepare('UPDATE sheet_rows SET status = ?, updated_at = ? WHERE id = ?').run('escalated', ts, row.id);
          bus.emit('event', { type: 'rows_changed', canvasId: canvas.id });
        }
      }
      return { content: JSON.stringify({ ok: true, escalation_id: escalation.id, note: 'Escalated to the needs-you tray. Continue with your other items; a human decision will come back as a new instruction.' }) };
    }

    case 'complete': {
      const summary = input.summary || '';
      // Honest terminal state. "incomplete" was the missing channel: complete
      // used to hard-code 'completed', so a run that gave up filed itself as a
      // success and the truth lived only in free-text nobody inspects.
      // 'incomplete' maps onto the existing 'failed' status (runs.status has a
      // CHECK constraint and migrations are additive-only — no new enum) and
      // raises an escalation so the parked work reaches the human tray.
      if (input.outcome === 'incomplete') {
        try {
          createEscalation({
            canvasId: canvas.id, runId: run.id, agentId: agent.id, kind: 'question',
            question: `${agent.name} could not finish: "${run.instruction.slice(0, 160)}". It reported: ${summary.slice(0, 400)}`,
            context: { stepsUsed: run.steps_used, incomplete: true },
          });
        } catch { /* the run still ends incomplete even if the tray write fails */ }
        return { content: JSON.stringify({ ok: true, outcome: 'incomplete' }), end: { status: 'failed', summary } };
      }
      return { content: JSON.stringify({ ok: true, outcome: 'done' }), end: { status: 'completed', summary } };
    }

    case 'wait': {
      // The only delay primitive in the server. Bounded (≤30s) so two waits
      // stay well inside the default 240s run wall budget, and abortable via
      // ctx.signal so a global pause interrupts a sleeping run — without the
      // signal a naive sleep would ignore pause until the next epoch check.
      const seconds = Math.min(Math.max(Math.floor(Number(input.seconds) || 0), 1), 30);
      const signal = ctx.signal;
      if (signal && signal.aborted) return { content: 'Workspace paused — did not wait.', isError: true };
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, seconds * 1000);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      if (signal && signal.aborted) return { content: `Waited, then the workspace paused — stopping.`, isError: true };
      return { content: `Waited ${seconds}s.` };
    }

    case 'apply_row_fix': {
      const escalation = db.prepare('SELECT * FROM escalations WHERE id = ? AND canvas_id = ?').get(input.escalation_id, canvas.id);
      if (!escalation) return { content: `No escalation ${input.escalation_id} on this canvas — apply_row_fix requires a real resolved escalation.`, isError: true };
      if (!['accepted', 'redirected'].includes(escalation.status)) {
        return { content: `Escalation ${input.escalation_id} is "${escalation.status}", not resolved — a human decision is required before applying a fix.`, isError: true };
      }
      const row = getRowByIndex(canvas.id, input.row_index);
      if (!row) return { content: `No row with index ${input.row_index}`, isError: true };
      const data = JSON.parse(row.data);
      const oldValue = data[input.field];
      data[input.field] = input.new_value;
      db.prepare('UPDATE sheet_rows SET data = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(data), 'verified', ts, row.id);
      audit('agent', agent.id, 'rows.apply_human_fix', { runId: run.id, rowIndex: input.row_index, field: input.field, oldValue, newValue: input.new_value, escalationId: escalation.id, resolvedBy: escalation.resolved_by });
      bus.emit('event', { type: 'rows_changed', canvasId: canvas.id });
      return { content: JSON.stringify({ ok: true, row_index: input.row_index, field: input.field, old_value: oldValue, new_value: input.new_value, authorized_by: escalation.resolved_by }) };
    }

    case 'read_rows': {
      const clauses = ['canvas_id = ?'];
      const params = [canvas.id];
      if (input.status) { clauses.push('status = ?'); params.push(input.status); }
      const rows = db.prepare(
        `SELECT id, row_index, data, status, notes FROM sheet_rows WHERE ${clauses.join(' AND ')} ORDER BY row_index LIMIT ?`
      ).all(...params, Math.min(input.limit || 50, 200));
      return { content: JSON.stringify(rows.map((r) => ({ ...r, data: JSON.parse(r.data) }))) };
    }

    case 'set_row_status': {
      if (!['clean', 'flagged', 'escalated'].includes(input.status)) {
        return { content: `set_row_status only accepts clean|flagged|escalated (got "${input.status}"). Corrections go through the change-set flow; human decisions through apply_row_fix.`, isError: true };
      }
      const row = getRowByIndex(canvas.id, input.row_index);
      if (!row) return { content: `No row with index ${input.row_index}`, isError: true };
      db.prepare('UPDATE sheet_rows SET status = ?, notes = ?, updated_at = ? WHERE id = ?')
        .run(input.status, input.note || '', ts, row.id);
      audit('agent', agent.id, 'rows.set_status', { runId: run.id, rowIndex: input.row_index, status: input.status });
      bus.emit('event', { type: 'rows_changed', canvasId: canvas.id });
      return { content: JSON.stringify({ ok: true, row_id: row.id, status: input.status }) };
    }

    case 'propose_changes': {
      if (!Array.isArray(input.changes) || input.changes.length === 0) return { content: 'changes must be a non-empty array', isError: true };
      const changesetId = crypto.randomUUID();
      db.prepare('INSERT INTO changesets (id, canvas_id, run_id, agent_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(changesetId, canvas.id, run.id, agent.id, 'proposed', ts);
      const results = [];
      for (const change of input.changes) {
        const row = getRowByIndex(canvas.id, change.row_index);
        if (!row) { results.push({ row_index: change.row_index, error: 'row not found' }); continue; }
        const data = JSON.parse(row.data);
        const changeId = crypto.randomUUID();
        db.prepare(
          'INSERT INTO changes (id, changeset_id, row_id, field, old_value, new_value, reason, cite_entry_ids, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(changeId, changesetId, row.id, change.field, String(data[change.field] ?? ''), String(change.new_value), change.reason || '', JSON.stringify(change.cite_entry_ids || []), ts);
        db.prepare('UPDATE sheet_rows SET status = ?, updated_at = ? WHERE id = ?').run('corrected', ts, row.id);
        results.push({ change_id: changeId, row_index: change.row_index, field: change.field });
      }
      audit('agent', agent.id, 'changeset.propose', { runId: run.id, changesetId, count: results.length });
      bus.emit('event', { type: 'changeset', canvasId: canvas.id, changesetId, status: 'proposed' });
      bus.emit('event', { type: 'rows_changed', canvasId: canvas.id });
      return { content: JSON.stringify({ ok: true, changeset_id: changesetId, changes: results }) };
    }

    case 'ws_sheets_read': case 'ws_drive_search': case 'ws_drive_read':
    case 'ws_gmail_search': case 'ws_gmail_read': case 'ws_calendar_list':
    case 'ws_sheets_append': case 'ws_sheets_update': case 'ws_gmail_draft':
    case 'ws_calendar_create': case 'ws_docs_create': {
      const ws = require('../google/workspace');
      const initiator = run.initiated_by;
      if (!initiator) {
        return { content: 'This run has no directing user, so Workspace tools are unavailable (system-triggered runs cannot touch Google Workspace). Escalate if a human needs to authorize this.', isError: true };
      }
      try {
        let out;
        switch (name) {
          case 'ws_sheets_read': out = await ws.sheetsRead({ email: initiator, spreadsheetId: input.spreadsheet_id, range: input.range }); break;
          case 'ws_drive_search': out = await ws.driveSearch({ email: initiator, query: input.query, limit: input.limit }); break;
          case 'ws_drive_read': out = await ws.driveReadText({ email: initiator, fileId: input.file_id }); break;
          case 'ws_gmail_search': out = await ws.gmailSearch({ email: initiator, query: input.query, limit: input.limit }); break;
          case 'ws_gmail_read': out = await ws.gmailRead({ email: initiator, messageId: input.message_id }); break;
          case 'ws_calendar_list': out = await ws.calendarList({ email: initiator, timeMin: input.time_min, timeMax: input.time_max, limit: input.limit }); break;
          case 'ws_sheets_append': out = await ws.sheetsAppend({ email: initiator, spreadsheetId: input.spreadsheet_id, range: input.range, values: input.values }); break;
          case 'ws_sheets_update': out = await ws.sheetsUpdate({ email: initiator, spreadsheetId: input.spreadsheet_id, range: input.range, values: input.values }); break;
          case 'ws_gmail_draft': out = await ws.gmailCreateDraft({ email: initiator, to: input.to, subject: input.subject, body: input.body }); break;
          case 'ws_calendar_create': out = await ws.calendarCreate({ email: initiator, summary: input.summary, description: input.description, startIso: input.start_iso, endIso: input.end_iso, attendees: input.attendees }); break;
          case 'ws_docs_create': out = await ws.docsCreate({ email: initiator, title: input.title, text: input.text }); break;
          default: throw new Error('unreachable');
        }
        bus.emit('event', { type: 'workspace_action', canvasId: canvas.id, runId: run.id, agentId: agent.id, tool: name, at: ts });
        // Evidence refs for artifact READS only — searches, lists, and writes
        // are not evidence. URI/source_id are redacted at read time for anyone
        // but the directing user (evidence.redactRef).
        let refId = null;
        if (name === 'ws_drive_read') {
          refId = evidence.recordRef({ runId: run.id, sourceKind: 'drive', sourceId: input.file_id, title: (out && out.name) || '', uri: `https://drive.google.com/open?id=${encodeURIComponent(input.file_id)}`, directedBy: initiator, meta: { mimeType: out && out.mimeType } });
        } else if (name === 'ws_sheets_read') {
          refId = evidence.recordRef({ runId: run.id, sourceKind: 'sheet', sourceId: input.spreadsheet_id, title: input.range || '', uri: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(input.spreadsheet_id)}`, directedBy: initiator });
        } else if (name === 'ws_gmail_read') {
          refId = evidence.recordRef({ runId: run.id, sourceKind: 'gmail', sourceId: input.message_id, title: (out && out.subject) || '', directedBy: initiator });
        }
        return { content: externalContent(`workspace:${name.replace(/^ws_/, '')}`, out) + (refId ? evidence.refMarker(refId) : '') };
      } catch (err) {
        // Google errors interpolate attacker-controllable strings — a Drive file
        // NAME, for one, and anyone who can share a file chooses that.
        return { content: externalContent(`workspace:${name.replace(/^ws_/, '')}`, String(err.message || err)), isError: true };
      }
    }

        case 'hs_types': case 'hs_search': case 'hs_get': case 'hs_list':
    case 'hs_pipelines': case 'hs_pipeline_stages': case 'hs_owners':
    case 'hs_properties': case 'hs_associations':
    case 'hs_preview_change': case 'hs_apply_change': {
      const opsrunner = require('../hubspot/opsrunner');
      const initiator = run.initiated_by;
      if (!initiator) {
        return { content: 'This run has no directing user, so HubSpot tools are unavailable (system-triggered runs cannot touch the CRM). Escalate if a human needs to authorize this.', isError: true };
      }
      if (!opsrunner.configured()) {
        return { content: 'The HubSpot Ops Runner is not wired on this deployment (HS_OPS_RUNNER_URL unset) — the HUBSPOT lamp on the systems board is dark. Tell the owner.', isError: true };
      }
      try {
        let out;
        if (name === 'hs_preview_change') {
          const argv = opsrunner.buildArgv('change', input);
          out = await opsrunner.runArgv({ argv, confirm: false, actorEmail: initiator });
          out = JSON.stringify({ preview: true, applied: false, result: out, next: 'escalate with this preview; a human must approve before hs_apply_change' });
        } else if (name === 'hs_apply_change') {
          if (run.trigger_kind !== 'escalation_resume') {
            return { content: 'REFUSED: hs_apply_change only works in a run resumed from a human-approved escalation. Use hs_preview_change, escalate with the preview, and apply after approval.', isError: true };
          }
          const argv = opsrunner.buildArgv('change', input);
          out = await opsrunner.runArgv({ argv, confirm: true, actorEmail: initiator });
        } else {
          const op = name.slice(3); // hs_<op>
          const argv = opsrunner.buildArgv(op, input);
          out = await opsrunner.runArgv({ argv, actorEmail: initiator });
        }
        bus.emit('event', { type: 'workspace_action', canvasId: canvas.id, runId: run.id, agentId: agent.id, tool: name, at: ts });
        // CRM reads are evidence; preview/apply are actions, not sources.
        let refId = null;
        if (name !== 'hs_preview_change' && name !== 'hs_apply_change') {
          refId = evidence.recordRef({
            runId: run.id, sourceKind: 'hubspot',
            sourceId: `${input.type || ''}${input.id ? ':' + input.id : ''}`,
            title: name, directedBy: initiator, meta: { tool: name },
          });
        }
        return { content: externalContent('hubspot', out) + (refId ? evidence.refMarker(refId) : '') };
      } catch (err) {
        return { content: externalContent('hubspot', String(err.message || err)), isError: true };
      }
    }

        case 'read_registry': {
      try {
        // Committed, in-process data — no network, no spend, no external
        // party. It is NOT wrapped as external_content for exactly that
        // reason: this is workspace-owned reference data, and mislabelling it
        // would teach agents to distrust their own registries.
        return { content: JSON.stringify(readRegistry(input || {})) };
      } catch (err) {
        return { content: String(err.message || err), isError: true };
      }
    }

    case 'enrich_contact': case 'enrich_company':
    case 'verify_email': case 'get_enriched_contact': {
      const dispatch = require('../enrichment/dispatch');
      const initiator = run.initiated_by;
      // Same rule as every other external surface: a system-triggered run has
      // no human behind it, and enrichment spends real credits.
      if (!initiator) {
        return { content: 'This run has no directing user, so enrichment tools are unavailable (system-triggered runs cannot spend enrichment credits). Escalate if a human needs to authorize this.', isError: true };
      }
      if (!dispatch.configured()) {
        return { content: 'Enrichment dispatch is not wired on this deployment (ED_DISPATCH_URL unset). Tell the owner.', isError: true };
      }
      if (!ENRICHMENT_ROLES.includes(agent.role)) {
        return { content: `REFUSED: enrichment is scoped to ${ENRICHMENT_ROLES.join('/')} agents; ${agent.role} agents do not have it.`, isError: true };
      }
      try {
        const out = await dispatch.run(name, { ...input, actorEmail: initiator });
        bus.emit('event', { type: 'workspace_action', canvasId: canvas.id, runId: run.id, agentId: agent.id, tool: name, at: ts });
        const refId = evidence.recordRef({
          runId: run.id, sourceKind: 'enrichment',
          sourceId: String(input.record_key || input.email || input.domain || ''),
          title: name, directedBy: initiator, meta: { tool: name },
        });
        return { content: externalContent('enrichment', out) + evidence.refMarker(refId) };
      } catch (err) {
        return { content: externalContent('enrichment', String(err.message || err)), isError: true };
      }
    }

        case 'read_changesets': {
      const sets = db.prepare('SELECT * FROM changesets WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 10').all(canvas.id);
      const out = sets.map((cs) => ({
        id: cs.id,
        status: cs.status,
        created_at: cs.created_at,
        changes: db.prepare('SELECT c.*, r.row_index FROM changes c JOIN sheet_rows r ON r.id = c.row_id WHERE c.changeset_id = ?').all(cs.id)
          .map((c) => ({ change_id: c.id, row_index: c.row_index, field: c.field, old_value: c.old_value, new_value: c.new_value, reason: c.reason, cite_entry_ids: JSON.parse(c.cite_entry_ids), verdict: c.verdict })),
      }));
      return { content: JSON.stringify(out) };
    }

    case 'verify_changes': {
      const cs = db.prepare('SELECT * FROM changesets WHERE id = ? AND canvas_id = ?').get(input.changeset_id, canvas.id);
      if (!cs) return { content: `No changeset ${input.changeset_id} on this canvas`, isError: true };
      let approved = 0; let rejected = 0;
      const rowOutcomes = new Map(); // row_id -> false once ANY change is rejected
      for (const verdict of input.verdicts || []) {
        const change = db.prepare('SELECT * FROM changes WHERE id = ? AND changeset_id = ?').get(verdict.change_id, cs.id);
        if (!change) continue;
        db.prepare('UPDATE changes SET verdict = ?, verdict_reason = ? WHERE id = ?').run(verdict.verdict, verdict.reason || '', change.id);
        const row = db.prepare('SELECT * FROM sheet_rows WHERE id = ?').get(change.row_id);
        if (!row) continue;
        if (verdict.verdict === 'approved') {
          const data = JSON.parse(row.data);
          data[change.field] = change.new_value;
          db.prepare('UPDATE sheet_rows SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), ts, row.id);
          approved++;
          if (!rowOutcomes.has(row.id)) rowOutcomes.set(row.id, true);
        } else {
          rejected++;
          rowOutcomes.set(row.id, false);
        }
      }
      // A row is done only when EVERY change to it in this set was approved.
      for (const [rowId, allApproved] of rowOutcomes) {
        db.prepare('UPDATE sheet_rows SET status = ?, updated_at = ? WHERE id = ?')
          .run(allApproved ? 'verified' : 'flagged', ts, rowId);
      }
      const status = rejected === 0 ? 'verified' : approved === 0 ? 'rejected' : 'partially_verified';
      db.prepare('UPDATE changesets SET status = ? WHERE id = ?').run(status, cs.id);
      audit('agent', agent.id, 'changeset.verify', { runId: run.id, changesetId: cs.id, approved, rejected });
      bus.emit('event', { type: 'changeset', canvasId: canvas.id, changesetId: cs.id, status });
      bus.emit('event', { type: 'rows_changed', canvasId: canvas.id });
      return { content: JSON.stringify({ ok: true, changeset_status: status, approved, rejected }) };
    }

    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}

function createEscalation({ canvasId, runId, agentId, kind, question, context }) {
  const id = crypto.randomUUID();
  const ts = nowIso();
  db.prepare(
    'INSERT INTO escalations (id, canvas_id, run_id, agent_id, kind, question, context, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, canvasId, runId, agentId, kind, question, JSON.stringify(context || {}), 'open', ts);
  audit('agent', agentId || 'system', 'escalation.create', { escalationId: id, kind, runId });
  const escalation = { id, canvasId, runId, agentId, kind, question, context, status: 'open', createdAt: ts };
  bus.emit('event', { type: 'escalation', canvasId, escalation });
  return escalation;
}

module.exports = { toolsForRole, executeTool, createEscalation, externalContent, readRegistry, LIVELOCK_MAX_CROSSINGS, blockedInMode, MUTATING_TOOLS };

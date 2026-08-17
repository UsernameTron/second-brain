'use strict';
// Agent tool surface. Everything an agent can do to shared state goes through
// a dedicated tool so it can be validated, audited, broadcast, and traced.

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
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
        source: { type: 'string', description: 'Where this came from, e.g. "uploaded document section 2", "operator decision"' },
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
    description: 'Read the user-managed notes on this canvas.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_canvas_files',
    description: 'List documents attached to this canvas, or read one by id. Omit file_id to list metadata. Large documents are returned in bounded character ranges: when has_more is true, call again with next_offset until has_more is false. Reads are canvas-scoped, read-only, and evidence-backed. Supported content: PDF, Word .docx, UTF-8 text/Markdown/CSV/JSON, and, when XLSX_READ is enabled, .xlsx workbooks.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'File id returned by this tool\'s metadata list. Omit to list files.' },
        limit: { type: 'integer', description: 'Maximum metadata rows when listing (default 50, capped at 100).' },
        offset: { type: 'integer', description: 'Zero-based character offset when reading a file (default 0). Use the prior result\'s next_offset for the next range.' },
        length: { type: 'integer', description: 'Characters to return when reading (default 24000, capped at 30000 so the runner never hides the middle).' },
      },
      required: [],
    },
  },
  {
    name: 'list_agents',
    description: 'List the other agents on this canvas (name, role, status) — the valid targets for handoff.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'handoff',
    description: 'Hand a work item to another agent on this canvas. Include the memory entry IDs the target needs (they are delivered as its context and shown on the handoff edge). The target runs in parallel; you keep working. Use a stable item_key (e.g. "account-review") so repeated back-and-forth on the same item is detected.',
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
    description: 'Escalate a decision to a human. Use ONLY when a genuine judgment call blocks an item — ambiguity you cannot resolve from the available evidence or memory. The item lands in the needs-you tray; continue working on your other items after escalating.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The specific decision you need, with the options you see' },
        context: { type: 'string', description: 'Short context a human needs to decide' },
        entry_ids: { type: 'array', items: { type: 'string' }, description: 'Relevant memory entries' },
        item_key: { type: 'string', description: 'The work item this blocks, e.g. "account-review"' },
      },
      required: ['question'],
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
  description: 'Look up CTG reference data the workspace owns. "icp" = the committed ICP scoring rules and exact taxonomies, returned by top-level key. "suppliers" = the CTG supplier catalogue (name, category, taxonomy tags — no contact details, no commission terms). "org_context" = distilled facts about who owns which lane and which rules gate what, FROZEN at the date the result reports: where it disagrees with something you read live, the live source wins and you should say so. Always pass a query — an unfiltered read returns the first page of larger registries.',
  input_schema: {
    type: 'object',
    properties: {
      registry: { type: 'string', enum: ['icp', 'suppliers', 'org_context'] },
      query: { type: 'string', description: 'space-separated terms; every term must appear in the row' },
      limit: { type: 'integer', description: 'max rows, capped at 25' },
    },
    required: ['registry'],
  },
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
const ENRICHMENT_ROLES = ['research', 'targeting', 'commercial', 'enrichment'];

// Enrichment is a distinct user-facing job and may have connectors scoped
// directly to it, while also inheriting Radar's targeting connector lane.
// Preserve both roles instead of replacing the first-class role with its
// compatibility alias.
function connectorRoles(role) {
  return role === 'enrichment' ? ['enrichment', 'targeting'] : [role];
}

// Committed context registries — the ICP scoring contract, CTG's supplier
// catalogue, and distilled org-context facts. They are refreshed by a new
// commit rather than a live sync and never edited through Agent Canvas.
//
// Deliberately tools rather than seeded canvas notes. Pinned notes ride in every
// system prompt and `read_notes` returns full user-authored content, so system
// reference data belongs behind a filtered lookup that returns only what the
// agent asked for.
const REGISTRIES = {
  icp: {
    load: () => require('../config/icp-sr-icp-v6.json'),
    rows: (data) => Object.entries(data).map(([key, value]) => ({ key, value })),
    text: (row) => `${row.key} ${JSON.stringify(row.value)}`,
  },
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
const CANVAS_FILE_LIST_LIMIT = 100;
// Tool results are retained in the model's message history. Stay comfortably
// below runner.js's 40k result cap so it never removes a range's middle. The
// continuation contract makes the full decoded source reachable without one
// unbounded response.
const CANVAS_FILE_CHUNK_DEFAULT = 24_000;
const CANVAS_FILE_CHUNK_MAX = 30_000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOCUMENT_TEXT_CAP = 120_000;
const PDF_PAGE_LIMIT = 100;
const PDF_PARSE_TIMEOUT_MS = Math.min(30_000, Math.max(
  250,
  Number.parseInt(process.env.PDF_PARSE_TIMEOUT_MS || '15000', 10) || 15_000,
));
const DOCUMENT_UNCOMPRESSED_CAP = 50 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const TEXT_MIMES_BY_EXTENSION = {
  '.txt': new Set(['text/plain', 'application/octet-stream']),
  '.md': new Set(['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream']),
  '.csv': new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream']),
  '.json': new Set(['application/json', 'text/json', 'text/plain', 'application/octet-stream']),
};
const KNOWN_UNSUPPORTED_EXTENSIONS = new Set([
  '.doc', '.xls', '.ppt', '.pptx', '.pages', '.numbers', '.key',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.zip', '.gz', '.tar',
]);

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : '';
}

function canvasFileFormat(file) {
  const ext = fileExtension(file.name);
  const mime = String(file.mime || '').toLowerCase().split(';', 1)[0].trim();
  // A known binary/document extension wins over a caller-supplied text MIME.
  // Upload Content-Type is not trustworthy enough to turn a PDF into text.
  if (KNOWN_UNSUPPORTED_EXTENSIONS.has(ext)) return null;
  if (ext === '.pdf') {
    return !mime || mime === PDF_MIME || mime === 'application/octet-stream' ? 'pdf' : null;
  }
  if (ext === '.docx') {
    return !mime || mime === DOCX_MIME || mime === 'application/octet-stream' || mime === 'application/zip' ? 'docx' : null;
  }
  if (ext === '.xlsx') {
    return !mime || mime === XLSX_MIME || mime === 'application/octet-stream' || mime === 'application/zip' ? 'xlsx' : null;
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    const allowed = TEXT_MIMES_BY_EXTENSION[ext];
    return !mime || allowed.has(mime) || (ext === '.json' && mime.endsWith('+json')) ? 'text' : null;
  }
  return null;
}

function chunkCanvasFileText(text, options = {}, { sourceTruncated = false } = {}) {
  const rawOffset = options.offset === undefined ? 0 : Number(options.offset);
  if (!Number.isSafeInteger(rawOffset) || rawOffset < 0) {
    throw new Error('offset must be a non-negative integer. Start at 0, then use next_offset from each result.');
  }
  const rawLength = options.length === undefined ? CANVAS_FILE_CHUNK_DEFAULT : Number(options.length);
  if (!Number.isSafeInteger(rawLength) || rawLength < 1) {
    throw new Error(`length must be a positive integer (maximum ${CANVAS_FILE_CHUNK_MAX}).`);
  }
  const length = Math.min(rawLength, CANVAS_FILE_CHUNK_MAX);
  if (rawOffset > text.length) {
    throw new Error(`offset ${rawOffset} is beyond the rendered file length (${text.length}). Start at 0, then use next_offset from each result.`);
  }

  // Offsets are JS/JSON string indices. A caller using our next_offset never
  // lands within a surrogate pair. If a hand-authored offset does, include the
  // complete code point and report the actual start rather than emitting half
  // a character or silently losing it.
  let start = rawOffset;
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start -= 1;
  let end = Math.min(text.length, start + length);
  if (end < text.length && end > start && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end -= 1;
  // A one-character request beginning on a supplementary character still
  // needs one complete code point. This may exceed requested length by one
  // UTF-16 code unit, but can never exceed the hard result budget materially.
  if (end === start && start < text.length) end = Math.min(text.length, start + 2);
  const hasMore = end < text.length;
  return {
    text: text.slice(start, end),
    offset: start,
    endOffset: end,
    nextOffset: hasMore ? end : null,
    totalCharacters: text.length,
    hasMore,
    sourceTruncated,
    // Evidence must say when this particular read was only part of a source,
    // including a final continuation chunk that began after offset zero.
    truncated: start > 0 || hasMore || sourceTruncated,
  };
}

function decodeCanvasFile(file) {
  const bytes = Buffer.from(file.content || []);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`"${file.name}" is not valid UTF-8 text. Upload a UTF-8 text, CSV, or JSON copy.`);
  }
  if (text.includes('\u0000')) throw new Error(`"${file.name}" contains binary data and cannot be read as UTF-8 text.`);
  return text;
}

function xlsxDisabledMessage(file) {
  return `"${file.name}" is an uploaded Office file (${file.mime || XLSX_MIME}) whose native workbook reader is disabled (XLSX_READ=0). Open it with Google Sheets/Docs to create a readable converted copy, or export it as CSV, then upload the converted file.`;
}

function capExtractedDocumentText(text, name, label, reasons) {
  let rendered = String(text || '').replace(/\u0000/g, '').trim();
  if (!rendered) {
    throw new Error(`"${name}" contains no extractable text. If it is a scanned or image-only ${label}, upload a text-searchable copy.`);
  }
  if (rendered.length > DOCUMENT_TEXT_CAP) {
    const marker = `\n[...${label} text truncated at ${DOCUMENT_TEXT_CAP} characters — split the document or upload a narrower source to read the omitted content]`;
    rendered = rendered.slice(0, DOCUMENT_TEXT_CAP - marker.length) + marker;
    reasons.add('character_limit');
  }
  return rendered;
}

async function docxToText(bytes, name) {
  const JSZip = require('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error(`"${name}" could not be read as a Word document (corrupt or not a real .docx).`);
  }
  let uncompressed = 0;
  zip.forEach((_, entry) => { uncompressed += (entry._data && entry._data.uncompressedSize) || 0; });
  if (!zip.file('word/document.xml')) {
    throw new Error(`"${name}" could not be read as a Word document (word/document.xml is missing).`);
  }
  if (uncompressed > DOCUMENT_UNCOMPRESSED_CAP) {
    throw new Error(`"${name}" expands to ${Math.round(uncompressed / 1048576)}MB — over the ${DOCUMENT_UNCOMPRESSED_CAP / 1048576}MB Word document safety limit.`);
  }
  let result;
  try {
    result = await require('mammoth').extractRawText({ buffer: bytes });
  } catch (err) {
    throw new Error(`"${name}" could not be read as a Word document: ${String(err.message || err).slice(0, 160)}`);
  }
  const reasons = new Set();
  return {
    text: capExtractedDocumentText(result.value, name, 'Word document', reasons),
    sourceTruncated: reasons.size > 0,
    truncationReasons: [...reasons],
  };
}

function pdfTimeoutError(name) {
  return new Error(`"${name}" took too long to read safely. Try a smaller PDF or export it as searchable text.`);
}

async function pdfToText(bytes, name) {
  if (!bytes.subarray(0, 8).toString('latin1').startsWith('%PDF-')) {
    throw new Error(`"${name}" could not be read as a PDF (missing PDF header).`);
  }
  const payload = Uint8Array.from(bytes);
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'pdf-extract-worker.js'), {
      workerData: {
        bytes: payload.buffer,
        name,
        textCap: DOCUMENT_TEXT_CAP,
        pageLimit: PDF_PAGE_LIMIT,
      },
      transferList: [payload.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: 96,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(reject, pdfTimeoutError(name));
    }, PDF_PARSE_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    worker.once('message', (message) => {
      if (message?.ok) finish(resolve, message);
      else finish(reject, new Error(message?.error || 'PDF extraction failed'));
    });
    worker.once('error', (err) => finish(reject, err));
    worker.once('exit', (code) => {
      if (code !== 0) finish(reject, new Error(`PDF parser stopped unexpectedly (${code})`));
    });
  }).catch((err) => {
    if (err === undefined) throw pdfTimeoutError(name);
    throw new Error(`"${name}" could not be read as a PDF: ${String(err.message || err).slice(0, 160)}`);
  });
  if (result.extractedCharacters === 0) {
    throw new Error(`"${name}" contains no extractable text. If it is a scanned or image-only PDF, upload a text-searchable copy.`);
  }
  const reasons = new Set(result.truncationReasons || []);
  const rendered = capExtractedDocumentText(result.text, name, 'PDF', reasons);
  return { text: rendered, sourceTruncated: reasons.size > 0, truncationReasons: [...reasons] };
}

async function readCanvasFile(file, options = {}) {
  const format = canvasFileFormat(file);
  if (!format) {
    throw new Error(`Unsupported canvas document "${file.name}" (${file.mime || 'unknown type'}). Agents can read PDF, Word .docx, UTF-8 text, Markdown, CSV, JSON, and .xlsx files; legacy .doc, images, and other binary formats are not readable.`);
  }
  if (format === 'xlsx') {
    // Check at CALL time, not module load: operators use this as an emergency
    // parser kill switch and upload validation shares this exact function.
    if (process.env.XLSX_READ === '0') throw new Error(xlsxDisabledMessage(file));
    const { xlsxToText } = require('../google/workspace')._internal;
    const rendered = await xlsxToText(Buffer.from(file.content || []), file.name, { withMetadata: true });
    return {
      ...chunkCanvasFileText(rendered.text, options, { sourceTruncated: rendered.sourceTruncated }),
      format,
      sourceLimits: rendered.truncationReasons,
      sourceLimitMessage: 'The workbook renderer reached an explicit sheet, row, cell, or character safety bound. Continuation can retrieve every rendered character; omitted workbook content requires a narrower workbook or CSV export.',
    };
  }
  if (format === 'docx' || format === 'pdf') {
    const bytes = Buffer.from(file.content || []);
    const rendered = format === 'docx' ? await docxToText(bytes, file.name) : await pdfToText(bytes, file.name);
    return {
      ...chunkCanvasFileText(rendered.text, options, { sourceTruncated: rendered.sourceTruncated }),
      format,
      sourceLimits: rendered.truncationReasons,
      sourceLimitMessage: 'The document parser reached an explicit page or character safety bound. Continuation can retrieve every extracted character; omitted source content requires a smaller or split document.',
    };
  }
  return { ...chunkCanvasFileText(decodeCanvasFile(file), options), format };
}

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
    registry: data.registry || registry,
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
  'handoff',
  // Paid enrichment spends real credits — a side effect, even though it reads.
  // The cached get_enriched_contact re-read is free and stays available.
  'enrich_contact', 'enrich_company', 'verify_email',
]);
// A rehearsal's findings are hypothetical — what WOULD have matched. Writing
// them into the canvas's shared memory persists a guess as a record before
// anyone approved the rule (or the draft agent), and nothing downstream can
// tell it apart from a real finding. An ask run's findings ARE real, so memory
// stays writable there; a rehearsal reports in its summary instead.
const REHEARSAL_BLOCKED_TOOLS = new Set(['memory_write', 'memory_correct']);
function blockedInMode(name, mode) {
  if (!mode || mode === 'act') return false;
  if (name.startsWith('mcp_')) return true; // connector side effects are unknowable — all blocked
  if (mode === 'rehearse') {
    if (name === 'hs_preview_change') return false; // already a server-enforced dry run
    if (REHEARSAL_BLOCKED_TOOLS.has(name)) return true;
  }
  return MUTATING_TOOLS.has(name);
}

// P4 Authority Map. "Governed" tools are the ones that reach an external
// surface (Workspace, HubSpot, MCP, enrichment, web search) — the connector
// authority the roadmap says must never be implicit. Cognition and canvas
// tools (memory, notes, escalate, handoff) are never governed: an
// agent stripped to zero authority still thinks, remembers, and escalates.
function governedTool(name) {
  return name.startsWith('ws_') || name.startsWith('hs_') || name.startsWith('mcp_')
    || name.startsWith('enrich_') || name === 'verify_email' || name === 'get_enriched_contact'
    || name === 'web_search';
}

// authority: null = legacy full role surface; an array = the explicit
// allowlist. Filtering is intersection-only — an allowlist can never ADD a
// tool the role/mode/deployment gates would not have offered.
function allowedByAuthority(name, authority) {
  if (!authority) return true;
  if (!governedTool(name)) return true;
  return authority.includes(name);
}

function parseAuthority(toolsJson) {
  if (toolsJson === null || toolsJson === undefined) return null;
  try {
    const arr = JSON.parse(toolsJson);
    return Array.isArray(arr) ? arr.map(String) : null;
  } catch { return null; }
}

// A run dispatched under a snapshot (a standing authorization) may use only
// what BOTH the snapshot and the agent's live authority allow. null means "no
// explicit allowlist", so it is the identity element: widening the agent after
// a grant can never widen the run, narrowing it afterwards still takes effect.
function intersectAuthority(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.filter((name) => b.includes(name));
}

// The authority actually in force RIGHT NOW for a run: the dispatch-time
// snapshot (runs.authority_json — a standing grant) intersected with the
// agent's live row, re-read from the DB so an owner narrowing an agent mid-run
// takes effect immediately. Shared by executeTool's call-time re-check and the
// runner's per-model-call web_search gate (a provider-executed tool never
// reaches executeTool, so it needs the same check on the offer side).
function effectiveAuthority(run, agent) {
  const liveAuthority = agent && agent.id
    ? (db.prepare('SELECT tools_json FROM agents WHERE id = ?').get(agent.id) || agent).tools_json
    : agent && agent.tools_json;
  return intersectAuthority(parseAuthority(run.authority_json), parseAuthority(liveAuthority));
}

function toolsForRole(role, { userRole = 'member', mode = 'act', authority = null } = {}) {
  // MCP defs are filtered per directing user + agent role: owner-only
  // connectors never reach a member-directed run's tool list, and role-scoped
  // connectors are offered only to the agent roles the owner named. Both are
  // re-checked at call time — a def leak alone can never authorize a call.
  const mcpClient = require('../mcp/client');
  const effectiveConnectorRoles = connectorRoles(role);
  const mcpDefs = mcpClient.getCachedDefs().filter((d) => {
    const meta = mcpClient.resolveToolName(d.name);
    if (!meta) return false;
    if (meta.access === 'owner' && userRole !== 'owner') return false;
    if (meta.roles && meta.roles.length && !meta.roles.some((item) => effectiveConnectorRoles.includes(item))) return false;
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
  // Same rule for HubSpot, and for the same reason. With HS_OPS_RUNNER_URL
  // unset every hs_* call returns isError, so OFFERING them lets a standing
  // rule mint a non-empty grant over a lane it can never reach, run forever,
  // and report "nothing matched" over a CRM nobody is watching. Absent, not
  // inert — the systems board already shows the lamp dark.
  const hubspot = require('../hubspot/opsrunner').configured() ? HUBSPOT_TOOLS : [];
  return [...COMMON_TOOLS, REGISTRY_TOOL, ...wsRead, ...wsWrite, ...hubspot, ...enrichment, ...mcpDefs]
    .filter((t) => !blockedInMode(t.name, mode) && allowedByAuthority(t.name, authority));
}

// The plain-language authority menu a draft proposal may pick from: every
// governed tool this deployment can actually honor right now, for this role.
// Server-supplied, so generated configuration can never invent authority.
function authorityMenu(role, { userRole = 'member', modelTier = 'strong' } = {}) {
  const menu = toolsForRole(role, { userRole, mode: 'act' })
    .filter((t) => governedTool(t.name))
    .map((t) => ({ name: t.name, description: String(t.description || '').split('. ')[0] }));
  // web_search rides outside the registry (runner.js pushes it per-run), so
  // the menu adds it under the same gate the runner applies — the SAME
  // function, not a second copy of the predicate.
  if (webSearchEligible(role, modelTier)) {
    menu.push({ name: 'web_search', description: 'Search the public web (Claude providers only)' });
  }
  return menu;
}

// THE definition of web-search eligibility, shared by the offer side (runner)
// and the grant side (authorityMenu → grantedTools). The provider is per TIER
// and mixed fleets are supported (FAST_PROVIDER/STRONG_PROVIDER are read
// independently), so a menu computed without the agent's tier hands out a
// grant the run can never be offered: with STRONG_PROVIDER=gemini a strong
// research agent got web_search in its grant, zero read tools at run time, and
// reported NOTHING MATCHED forever.
function webSearchEligible(role, modelTier) {
  return role === 'research' && process.env.ENABLE_WEB_SEARCH !== '0'
    && require('./anthropic').tierConfig(modelTier).provider !== 'gemini';
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

  // Same defense in depth for a cancelled run: revoking a standing rule aborts
  // the run's signal, and its remaining tool calls must stop reading and
  // writing immediately rather than at the next model call.
  if (ctx.signal && ctx.signal.aborted) {
    return { content: 'This run was cancelled — the action was rejected server-side.', isError: true };
  }

  // Run-mode gate (P1): ask/rehearse runs never mutate outside state. The
  // offer filter in toolsForRole is the first layer; this is the call-time
  // re-check, same defense-in-depth shape as the MCP owner gate below.
  if (blockedInMode(name, run.mode)) {
    return { content: `REFUSED: this is a ${run.mode} run — ${name} would change outside state and is unavailable. Describe what you WOULD do instead, and note it in your summary.`, isError: true };
  }

  // P4 Authority Map call-time re-check: an agent with an explicit allowlist
  // may never execute a governed tool outside it, even if a def leaked into
  // the offer. Same defense-in-depth shape as the mode gate above.
  // Authority is re-read from the DB, not the run-start snapshot — an owner
  // narrowing an agent mid-run takes effect on the very next tool call. The
  // dispatch-time snapshot (runs.authority_json) is intersected with it, so a
  // widening after a standing grant cannot reach this run.
  const effective = effectiveAuthority(run, agent);
  if (!allowedByAuthority(name, effective)) {
    return { content: `REFUSED: this agent's authority map does not include ${name}. Work within your granted tools, or escalate if the task requires this authority.`, isError: true };
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
      const notes = db.prepare('SELECT id, title, content, pinned FROM notes WHERE canvas_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC').all(canvas.id);
      return { content: JSON.stringify(notes) };
    }

    case 'read_canvas_files': {
      if (!input.file_id) {
        const requested = Number(input.limit);
        const limit = Math.min(Math.max(Number.isFinite(requested) ? Math.floor(requested) : 50, 1), CANVAS_FILE_LIST_LIMIT);
        const total = db.prepare('SELECT COUNT(*) AS n FROM files WHERE canvas_id = ? AND deleted_at IS NULL').get(canvas.id).n;
        const files = db.prepare(
          'SELECT id, name, mime, size, uploaded_by, created_at FROM files WHERE canvas_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id LIMIT ?'
        ).all(canvas.id, limit);
        return { content: externalContent('canvas_file_list', JSON.stringify({ total, showing: files.length, truncated: total > files.length, files })) };
      }

      // Scope is part of the lookup, not a check performed after fetching by
      // id. A guessed id from another canvas therefore reveals neither its
      // existence nor any metadata.
      const file = db.prepare('SELECT * FROM files WHERE id = ? AND canvas_id = ? AND deleted_at IS NULL').get(String(input.file_id), canvas.id);
      if (!file) return { content: 'File not found on this canvas. Omit file_id to list the files available here.', isError: true };
      try {
        const read = await readCanvasFile(file, { offset: input.offset, length: input.length });
        const refId = evidence.recordRef({
          runId: run.id,
          sourceKind: 'canvas_file',
          sourceId: file.id,
          title: file.name,
          directedBy: run.initiated_by || '',
          visibility: 'canvas',
          meta: {
            canvasId: canvas.id, mime: file.mime, size: file.size, format: read.format,
            truncated: read.truncated, sourceTruncated: read.sourceTruncated,
            rangeStart: read.offset, rangeEnd: read.endOffset,
            renderedCharacters: read.totalCharacters, hasMore: read.hasMore,
            ...(read.sourceLimits ? { sourceLimits: read.sourceLimits } : {}),
          },
        });
        const chunk = {
          range_start: read.offset,
          range_end_exclusive: read.endOffset,
          returned_characters: read.text.length,
          rendered_characters: read.totalCharacters,
          has_more: read.hasMore,
          next_offset: read.nextOffset,
          source_complete: !read.sourceTruncated,
          ...(read.sourceLimits ? { source_limits: read.sourceLimits } : {}),
          ...(read.hasMore ? {
            continuation: `Call read_canvas_files again with file_id "${file.id}" and offset ${read.nextOffset}.`,
          } : {}),
          ...(read.sourceTruncated ? { source_limit: read.sourceLimitMessage } : {}),
        };
        const body = `File: ${file.name}\nType: ${file.mime || 'application/octet-stream'}\nSize: ${file.size} bytes\nChunk metadata: ${JSON.stringify(chunk)}\n\n${read.text}`;
        return { content: externalContent('canvas_file', body) + evidence.refMarker(refId) };
      } catch (err) {
        // File names are user-authored too; keep read/parse errors inside the
        // same untrusted boundary as successful file content.
        return { content: externalContent('canvas_file_error', String(err.message || err)), isError: true };
      }
    }

    case 'list_agents': {
      const agents = db.prepare("SELECT name, role, status FROM agents WHERE canvas_id = ? AND id != ? AND lifecycle = 'active'").all(canvas.id, agent.id);
      return { content: JSON.stringify(agents) };
    }

    case 'handoff': {
      const target = db.prepare("SELECT * FROM agents WHERE canvas_id = ? AND name = ? AND lifecycle = 'active'").get(canvas.id, input.to_agent_name);
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

module.exports = { toolsForRole, executeTool, createEscalation, externalContent, readRegistry, canvasFileFormat, readCanvasFile, LIVELOCK_MAX_CROSSINGS, blockedInMode, MUTATING_TOOLS, REHEARSAL_BLOCKED_TOOLS, governedTool, allowedByAuthority, parseAuthority, intersectAuthority, effectiveAuthority, authorityMenu, webSearchEligible };

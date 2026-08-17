# Agent Canvas — Current Handoff (2026-08-17)

This file is the concise current-state authority. Historical implementation and
incident detail lives in [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md); phase intent
lives in [ROADMAP.md](ROADMAP.md); release commands live in
[DEPLOY.md](DEPLOY.md).

Every claim below is labeled **git-proven**, **test-proven**,
**live-proven**, **historical acceptance evidence**, or **unverified**. Live
evidence is an observation at one instant, not a permanent property.

## Repository and verification

**Git-proven (observed 2026-08-17):** canonical repository
`/Users/cpconnor/projects/second-brain`; application subtree `agent-canvas/`.
`master` and `origin/master` are at `9a6abaf`. PR #207 merged as `049bb81`;
PR #208 merged as `9a6abaf`.

**Test-proven (2026-08-17, merged SHA `9a6abaf`):** `npm run verify` passes
**385 backend tests** and **107 frontend tests**, the frontend production
build, deploy-script syntax, and the deploy preflight self-test. Both production
dependency audits report zero vulnerabilities.

## Latest production observation

**Live-proven at 2026-08-17T20:19Z:** Cloud Run revision
`agent-canvas-00057-47c` serves 100% of traffic. `/api/healthz` and
`/api/config` return 200; the revision restored the replicated database,
started successfully, and produced no ERROR-severity logs during the release
probe. The deploy inherited `MODEL_PROVIDER=anthropic` and preserved the exact
13-name environment/secret binding set from `00056-qtc`. Cloud Scheduler job
`agent-canvas-standing-rules` remains **PAUSED**; the deploy did not change it.

The live bundle contains New canvas, recommended starting-team selection,
document upload/removal, and agent removal. Workbook and Run cleanup are
absent. A fresh replica confirms the Enrichment template is enabled and the
one-time cleanup is stamped. Signed-in journey acceptance remains outstanding.

## Released workspace cleanup

**Git-proven and test-proven:** the cleanup removes the hardcoded Workbook,
Run cleanup command, sample-row flow, demo kickoff route, demo changeset
attention cards, demo tools, and active Explain Map changeset nodes. A fresh
database creates access, roster, and inert connector configuration but no user
canvas, sample rows, fabricated memories, pinned instructions, or kickoff task.
Legacy tables remain only for export and audit continuity.

Notes are now an honest user-managed context surface: editors can create, edit,
include in future runs, unpin, and remove them; viewers cannot mutate them.
Removal is a recoverable tombstone, immediately excludes the note from canvas
loads, `read_notes`, and future system prompts, and retains an audit record
without copying note content into the audit log.

Canvas Files are now the actual local document path. Editors can upload TXT,
Markdown, CSV, JSON, and XLSX files up to 5 MB, open or download them, and
remove them recoverably. Authorized agents use `read_canvas_files`; file text
is marked as external evidence, bounded, and excluded after removal. View-only
users can download but cannot upload or remove.

**Live-proven from a fresh production replica:** the cleanup ran once at
`2026-08-17T19:29:24.865Z` and recoverably retired the 8 proven demo/test
canvases. One real canvas remains active. A pre-`00057` backup passed SQLite
integrity checking and was copied to the release-backups prefix. Re-running the
retirement against its disposable copy changed zero rows, proving the live
migration is idempotently complete.

## Phase classification

| Phase | Source state | Release evidence |
|---|---|---|
| Gate 0, P1, P2 | Merged on `master` | Historical acceptance evidence; not replayed in this cleanup |
| P3 Evidence Rooms | Merged | Historical live acceptance including #194; not replayed |
| P4 Agent Builder | Merged | Historical live acceptance on 2026-08-16; not replayed |
| P5 Standing Rules | Merged | Scheduler delivery is live-proven; manual path historically accepted; remaining scenarios below |
| Cleanup: truthful workspace content | Merged and deployed | Bundle, replica, health, and log checks pass; signed-in journey not replayed |
| Recommended teams, Enrichment, document intake, agent removal | Merged and deployed | Bundle/replica proven; signed-in journey not replayed |
| P6 Outcomes and reviewed learning | Planned only | Not implemented |
| P7 Selective integrations and portability | Planned only | Not implemented |

P5 is not complete. Scheduled dispatch/card, pause behavior, and clean-zero
alert behavior have historical live evidence. Expiry under scheduler operation
remains unproven. The scheduler is currently paused, so no unattended rule can
run until an operator deliberately resumes it.

## Release gates

1. In a signed-in production session, verify: no Workbook or
   Run cleanup surface; create/edit/pin/remove note; upload/read/remove a file;
   view-only restrictions; a new agent run whose receipt names the canvas file;
   removed note/file text absent from subsequent agent context; recommended-team
   creation; Enrichment availability; and safe agent removal.
2. Exercise P5 expiry with an explicitly bounded fixture before calling P5
   complete. Resume Cloud Scheduler only with separate operator intent.
3. After the cleanup migration, use forward fixes rather than routing traffic
   to a pre-cleanup reader.

No push, merge, deployment, scheduler change, or production-data mutation is
authorized by this handoff alone.

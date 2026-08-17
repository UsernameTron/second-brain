# Agent Canvas — Current Handoff (2026-08-16)

This file is the concise current-state authority. Historical implementation and
incident detail lives in [HANDOFF-HISTORY.md](HANDOFF-HISTORY.md); phase intent
lives in [ROADMAP.md](ROADMAP.md); release commands live in
[DEPLOY.md](DEPLOY.md).

Every claim below is labeled **git-proven**, **test-proven**,
**live-proven**, **historical acceptance evidence**, or **unverified**. Live
evidence is an observation at one instant, not a permanent property.

## Repository and verification

**Git-proven (observed 2026-08-16):** canonical repository
`/Users/cpconnor/projects/second-brain`; application subtree `agent-canvas/`.
`master` and the cached `origin/master` are at `948a7a6`. The local branch
`fix/agent-canvas-remove-demo-artifacts` is based there and contains the cleanup
described below. It is not merged or deployed.

**Test-proven (2026-08-16):** `npm run verify` passes **372 backend tests** and
**93 frontend tests**, the frontend production build, deploy-script syntax, and
the deploy preflight self-test. `git diff --check` is clean. These are local
source/build facts, not production acceptance.

## Latest production observation

**Live-proven at 2026-08-17T01:49Z:** Cloud Run revision
`agent-canvas-00054-9cs` served 100% of traffic; `/api/healthz` and
`/api/config` returned 200; scheduler-signed ticks returned 200 at 01:20,
01:30, and 01:40 UTC; no ERROR-severity log entries were found for that
revision during the probe window.

The deployed bundle still contains **Workbook** and **Run cleanup** and lacks
the cleanup branch's file-upload and note-context wording. Therefore the
cleanup is **not deployed**. The serving image does not expose an immutable Git
SHA, so its exact source commit is **unverified**; do not infer it from the
revision number.

## Cleanup release on the local branch

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

**Test-proven against a disposable copy of the latest production replica:** the
legacy-retirement migration would hide 8 proven demo/test canvases, 15 notes,
and 1 file and revoke 3 non-revoked standing rules. It leaves all physical
ledger rows intact: 8 canvases, 15 notes, 1 file, 50 runs, 98 memory entries,
and 5 standing rules. A second run changes zero rows. Production itself was not
mutated by this rehearsal.

## Phase classification

| Phase | Source state | Release evidence |
|---|---|---|
| Gate 0, P1, P2 | Merged on `master` | Historical acceptance evidence; not replayed in this cleanup |
| P3 Evidence Rooms | Merged | Historical live acceptance including #194; not replayed |
| P4 Agent Builder | Merged | Historical live acceptance on 2026-08-16; not replayed |
| P5 Standing Rules | Merged | Scheduler delivery is live-proven; manual path historically accepted; remaining scenarios below |
| Cleanup: truthful workspace content | Implemented and locally verified | Not merged, deployed, or live-accepted |
| P6 Outcomes and reviewed learning | Planned only | Not implemented |
| P7 Selective integrations and portability | Planned only | Not implemented |

P5 is not complete. Historical evidence still leaves four explicit acceptance
gaps: a due rule dispatched by a scheduled tick with its resulting run/card;
pause under scheduler operation; expiry under scheduler operation; and a live
clean-zero alert path. Scheduler cadence alone does not exercise those states.

## Release gates

1. Review the cleanup diff and preserve the recoverable-retirement boundary.
2. Commit locally, push a review branch, run CI, and merge only after approval.
3. Before deployment, take and verify a fresh database backup; run the exact
   retirement dry-run again and compare IDs/counts with this record.
4. Deploy separately with the preservation-first script. Do not alter the
   scheduler, provider, environment names, or secret bindings as a side effect.
   After migration, use a forward fix rather than routing to a pre-cleanup
   revision, whose readers do not understand the new tombstones.
5. In a signed-in production session, verify: empty workspace; no Workbook or
   Run cleanup surface; create/edit/pin/remove note; upload/read/remove a file;
   view-only restrictions; a new agent run whose receipt names the canvas file;
   removed note/file text absent from subsequent agent context.
6. Re-probe revision, traffic, health, config, scheduler ticks, and error logs;
   update this file with only observed facts.

No push, merge, deployment, scheduler change, or production-data mutation is
authorized by this handoff alone.

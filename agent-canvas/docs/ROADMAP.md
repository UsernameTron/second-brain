# Agent Canvas roadmap and phase classification

Updated 2026-08-16 from repository `master` at `62eae86`, deployed as revision
`agent-canvas-00052-nbf` (probed at deploy time). This file owns phase intent and
dependencies. It does not override the production evidence in
[HANDOFF.md](HANDOFF.md) — and that evidence is itself an observation with a
timestamp, currently un-refreshable while Cloud SDK auth is expired.

## Status vocabulary

- **Planned:** agreed intent; no implementation claim.
- **Implemented:** behavior exists in a source branch or checkout.
- **Merged:** behavior is represented on `master`.
- **Deployed:** a probed production revision contains the merged source.
- **Live-accepted:** the signed-in user journey and relevant external lane have
  passed their acceptance checks.
- **Complete:** merged + deployed + live-accepted. Do not use this word for code
  or tests alone.

## Current classification

| Phase | Source status | Release status | Next gate |
|---|---|---|---|
| Gate 0 — trustworthy baseline | Merged | Live-accepted in recorded evidence | Re-probe after the next deploy |
| P1 — Inquiry Home and Explain Map | Merged | Live-accepted in recorded evidence | Preserve in regression/UAT |
| P2 — People and Needs You | Merged | Live-accepted in recorded evidence | Preserve in regression/UAT |
| P3 — Evidence Rooms | Merged | Core journey accepted; #194 hardening **deployed** on `00051-94w`; dedicated post-#194 acceptance not recorded | Run the screened-export acceptance journey |
| P4 — reviewable plain-language Agent Builder | Merged; hardened through #197 | **Deployed** on `00051-94w` (2026-08-16); live-accepted **not** claimed | Run the dedicated owner build/publish/version/rollback acceptance |
| P5 — Standing Rules and briefs | Merged; hardened through #198 | **Deployed; manual execution path live-accepted** (2026-08-16). Unattended scheduling intentionally dark and **unaccepted** — not Complete | Wire the OIDC scheduler identity + job, then accept a scheduler-signed run |
| P6 — Outcomes and reviewed learning | Planned only | Not started | Begin only after P4/P5 acceptance |
| P7 — selective integrations and portability | Planned only | Not started | Begin only after P6 earns its acceptance evidence |

The source flags for P1–P5 default on. That is exposure intent, not production
proof. P5 is specifically fail-closed when either tick environment variable is
missing, and its capability lamp becomes ready only after a scheduler-signed
tick arrives.

## Immediate release close-out

Steps 1–2 are done: `master` at `92fb427` was deployed 2026-08-16 and the serving
revision is `00051-94w` at 100% traffic. The tick identity was deliberately NOT
created, so the scheduler lane is dark by construction.

1. ~~Probe Cloud Run and record the serving revision and traffic split.~~ Done.
2. ~~Deploy `master` once if behind.~~ Done; tick identity intentionally deferred.
3. Run P4 signed-in acceptance: plain-language build, generated configuration
   review, rehearsal, owner publish, version inspection, rollback, and authority
   non-expansion. **Still outstanding** — P4 is deployed but unaccepted.
4. P5 signed-in acceptance — **manual path done** (parse, settings edit and gate
   reset, rehearsal, activation, two-tick dispatch/finalize lifecycle, attention
   card, acknowledgment, duplicate-tick protection, revoke; recorded in
   `HANDOFF.md`). **Still outstanding:** a scheduler-signed run, plus pause and
   expiry, plus the clean-zero alert path, which did not occur live because the
   model omitted its `MATCHED:` contract line and the honest-unknown path fired
   instead.
5. Update `HANDOFF.md` with observed facts. Only then classify P4/P5 complete and
   unlock P6. **Neither is Complete under the vocabulary above:** P4 lacks live
   acceptance, and P5's external lane has not passed.

### P5 release follow-up — FIXED and DEPLOYED (`00052-nbf`, 2026-08-16)

A live defect observed during acceptance: a draft or rehearsed rule kept
displaying the previous grant as "Authorized by … expires …", asserting a live
authorization on a rule that enforcement had already stopped honouring.
Enforcement was fail-closed throughout (the tick's due query only ever selects
`active`), so nothing ran under the stale grant — but the interface said
otherwise, and a screen that contradicts the enforcement is still a lie about
authority.

Closed on `fix/agent-canvas-truth-up` with no authorization redesign, no schema
migration, and the existing rule-state architecture preserved:

- `upsertDraft` retires the grant in the **same transaction** as the edit and
  the flip to draft, so no reader can observe one without the other. The row is
  stamped `revoked_at`/`revoked_by` and kept — retiring is history, not deletion.
- Both edit routes (`POST …/standing-rules/parse` and `PATCH …/standing-rules/:id`)
  return `{ rule, authorization }`. There is no refetch path behind an edit, so
  a response carrying only `rule` would leave a browser painting the pre-edit
  grant forever.
- The retired grant renders as "Previously authorized by … — retired … when the
  rule changed", and `Reads as` falls back to the current rehearsal identity
  rather than naming a grantor the next run has no claim on.
- Re-activation mints a **new** grant and leaves the retired one retired.
- Regression coverage for the full active → edit → draft → rehearse →
  reactivate cycle, including the negative case: a refused edit and a failed
  re-interpretation retire nothing and leave the rule active.

**Status: merged (PR #199, `62eae86`) and deployed on `agent-canvas-00052-nbf`
2026-08-16.** The acceptance gates below are unchanged by it.

## P6 — outcomes, earned trust, and reviewed episodic learning

### Why

Run counts and thumbs feedback show activity and preference; they do not prove
business outcomes or justify a global agent score. P6 creates a task-specific,
auditable learning loop without rewriting prompts or widening authority.

### What to add

1. **Outcome contract.** Stamp runs with a stable task-category slug, agent
   version, and initiating provenance. Record `achieved`, `partial`,
   `incomplete`, or `failed` outcomes separately from run feedback, with actor,
   note, and timestamp.
2. **Historical event ledger.** Record deduplicated events such as conflicts
   caught, accepted/rejected drafts, and completed work. Derive cost and run
   state from their authoritative ledgers instead of copying counters.
3. **Outcomes view.** Show category-level denominators, outcome distribution,
   approval/rejection, incomplete work, conflicts caught, and cost. Label
   preference feedback separately and show “insufficient evidence” below a
   configurable comparable-run threshold. No leaderboard and no global trust
   score.
4. **Reviewed lesson ledger.** A candidate lesson keeps immutable source-run
   links, scope, task category, review state, reviewer, activation state, and
   retirement history. Only an owner can approve and activate it.
5. **Bounded injection.** Select no more than three active lessons using exact
   task category and compatible scope, preferring agent scope over canvas scope.
   No category means no lesson. Record every injection and expose reviewer and
   source runs in the context receipt.
6. **Full Impact lens.** Extend Explain Map beyond immediate descendants with a
   bounded, deterministic, cycle-safe projection across rules, runs, decisions,
   tasks, outcomes, accepted changes, and lesson use. Preserve cross-canvas
   redaction and the accessible “Read as steps” alternative.

### Non-negotiable boundaries

- Feedback never becomes business truth automatically.
- A lesson never changes an agent's stored prompt, version, tools, permissions,
  or approval rules.
- Unapproved, inactive, wrong-category, cross-canvas, tainted, or superseded
  lessons never inject.
- Do not add embeddings until a representative lexical-versus-semantic
  evaluation proves measurable recall lift without degrading trust ordering,
  incomplete rate, or cost.

### Acceptance

- Terminal-run enforcement, exact denominators, event deduplication, minimum
  cohort, owner-only review/activation, immutable source trace, and maximum-three
  injection are covered by API tests.
- Tests prove tools and permissions are identical with and without a lesson.
- The UI separates outcomes, feedback, and insufficient evidence in plain
  language and works by keyboard at 375px.
- A held-out comparable cohort shows measurable improvement without worse
  incomplete rate or cost.

## P7 — selective integrations and trustworthy portability

### Why

The platform should absorb only signals that improve a named user journey. A
broad connector marketplace or indiscriminate ingestion would add authority and
support risk before demand is known.

### What to add

1. Fill only missing **read** lanes required by a proven Home, Room, rule, or
   Needs You workflow, with a fail-closed capability verdict.
2. Give each integration an effect contract: read, draft, preview, or apply.
   Keep consequential effects behind the existing preview/approve/apply chain;
   scheduled work remains read-only and may create drafts, never send them.
3. Route external signals into a named Room or standing rule instead of creating
   a second automation engine. Surface exceptions and drafts through Needs You.
4. Decide export completeness explicitly. Inventory every durable table, define
   either a versioned portable backup schema or retain the narrower
   “operational-ledger export” contract, and add inclusion/exclusion tests.
   Credentials, OAuth tokens, secret values, and ephemeral leases stay excluded.
5. Pilot one-way export only for verified, scoped, explicitly shareable
   conclusions. Agent Canvas remains authoritative.

### Acceptance

- Each integration has a named user problem, owner, scope, revocation path,
  capability probe, audit trail, and unavailable/denied/stale UI states.
- No connector widens an agent or rule beyond its reviewed authority snapshot.
- Export UI and documentation enumerate what is included, excluded, portable,
  and restorable; tests fail when a newly durable non-secret table is neither
  classified nor deliberately excluded.

## Deferred until evidence changes

- Broad mailbox or file ingestion.
- A generic integration marketplace.
- Unreviewed self-modifying prompts or permissions.
- A new graph datastore solely for Explain Map.
- Embedding infrastructure without a representative retrieval evaluation.
- Rewriting or replacing the current architecture to deliver these phases.

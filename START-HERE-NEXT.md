# START HERE — next session pickup
_Written 2026-07-14, end of session. Refreshed each session; this is the current "pick up here."_

## What last session accomplished (2026-07-14)
- Shipped decision-capture to the LIVE L10 app (project l10ctg): proposeDecision + ratifyDecision + decisionCanary deployed, 9 Cloud Functions total, firestore.rules gate live. Status: ALPHA, armed, headless (no reader yet).
- Live-audited the running L10 app and corrected major doc drift: it is Q3 2026 (not Q2), 9 rocks (not 7), 26 open issues (not 222), running on branch chore/l10-upbase-history-import (not main). Ground truth is in REALITY.md.
- Discovered the RAG engine ALREADY EXISTS in second-brain (semantic-index.js, /recall, Voyage embeddings). "Chat with Drive" = add a Drive connector + expose as a service. NOT building RAG from scratch.
- Wrote the 6-phase gated L10 + RAG build plan (download: L10-BUILD-PLAN.md).
- Built and packaged the session-harvest skill (session-harvest.zip) — still needs uploading.
- Harvested today's lessons/decisions/capability-facts into second-brain sources (already appended to lessons.md, decisions.md, pattern-context.md; run mining to stage them).

## Where to go (project directory)
- Primary work:  ~/projects/CTG-Workspace-Build/projects/ctg-l10-eos
- Second-brain:  ~/projects/second-brain
- Build plan:    download L10-BUILD-PLAN.md and drop it in the l10 repo's .planning/ (optional — the tasks below are self-contained)

## Your tasks, in order (each phase gates on YOUR validation before the next starts)
1. PHASE 1 — Truth reconciliation. Fix the drifted docs to match REALITY.md; add the rule "no doc says done until validated against the live system" to CLAUDE.md. Then open the PR from chore/l10-upbase-history-import to main and MERGE it — prod is running off a chore branch, fix that first.
   FASTEST START: open a fresh Claude Code session inside the l10 repo, hand it L10-BUILD-PLAN.md, and say "Start Phase 1."
2. PHASE 2 — Build DecisionsView (the 11th view) so decision proposals are readable, and ratify the AUTHORITY map with Fred. Validate: solve a test issue, confirm the proposal appears AND is readable; confirm a stale/duplicate close produces NO proposal.
3. PHASE 3 — Add a Drive connector to second-brain (share drive first) and embed via semantic-index.js. Build the 20-question eval set FIRST. Validate: eval passes AND the sidecar vector count matches the doc count (the dotenv gate — a green run that embedded zero is the known failure).
4. PHASE 4 — Query Cloud Function + chat view in the L10 app; every answer must cite a clickable Drive file.
5. PHASE 5 — Whole-Drive expansion with the per-user permission model (a user may only retrieve chunks from files they can already open). Last, on purpose.

## Open loops / blockers
- AUTHORITY map + NEVER_LIST in ratifyDecision.ts are UNRATIFIED — pending Fred (these are vision-board Calls 04/05). This is the last dependency for the decision pipeline going live.
- proposeDecision is ARMED against production but headless until DecisionsView ships (Phase 2).
- ctg-ops-prod billing is OFF while ctg-ops-automation (PRM ops) lives there — separate unresolved issue.
- Upload session-harvest.zip; after that, capturing each session is one command.

## To capture THIS work next time
When the next session ends, say "harvest this session" (once session-harvest is installed): it distills → appends to sources → triggers mining → you approve → promote → verify the vector count.

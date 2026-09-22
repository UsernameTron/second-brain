# Second Brain — six knowledge improvements

**Status:** Proposed; implementation not started.

**Prepared:** September 14, 2026.

**Outcome:** Turn existing memory and selected documents into useful project knowledge: maintained project pages, verifiable answers, easier fact review, broader capture, relevant retrieval, and reusable analyses.

## Delivery sequence

Value priority and implementation order differ because project pages need reliable evidence and review first.

| Phase | Deliverable | Original improvement | Depends on | Complete when |
|---|---|---|---|---|
| 0 | Isolated development and preservation baseline | Shared foundation | Plan approval | Development cannot write to the live vault or shared runtime state. |
| 1 | Inspectable evidence and cited answers | 2: SB-WIKI-02 | 0 | A claim opens its exact evidence; missing support is explicit. |
| 2 | Simpler fact review | 3: SB-WIKI-03 | 1 | Current/proposed values can be reviewed without copying memory hashes. |
| 3 | Living project/topic pages | 1: SB-WIKI-01 | 1–2 | A project page updates from approved facts and attributed sources. |
| 4 | PDF, DOCX, and web capture | 4: SB-WIKI-04 | 1–3 | Selected sources import once, retain originals, and invalidate affected views when changed. |
| 5 | Purpose-aware retrieval | 5: SB-WIKI-05 | 1, 3–4 | Project questions find relevant evidence while preserving exact fact and history rules. |
| 6 | Save useful answers | 6: SB-WIKI-06 | 1, 3, 5 | Analyses remain reusable, cited, and visibly separate from reviewed facts. |
| 7 | Full journey validation and release preparation | All six | 1–6 | All acceptance gates pass and a concrete activation/rollback package is ready. |

All six capabilities are in scope. Each phase is implemented and verified before the next begins; no further feature-selection decision is required. A failed acceptance gate is fixed within its phase. Live activation remains a separate approval after a tested release is prepared.

## Current foundation and scope

The inspected runtime is `/Users/cpconnor/.local/share/second-brain/runtime`, revision `3fc324b500578080201c85eb2a20856b61904f83`. Its [README](/Users/cpconnor/.local/share/second-brain/runtime/README.md), [codebase map](/Users/cpconnor/.local/share/second-brain/runtime/docs/codebase-map.md), and source define the current system. The working checkout at `/Users/cpconnor/projects/second-brain` also hosts Agent Canvas and contains retired memory code; implementation must start from the runtime revision in an isolated development worktree.

Second Brain already has capture, a proposal queue, reviewed current facts, history, keyword recall, and weekly correction. Extend those contracts. Keep the human-authored canon and `/Users/cpconnor/Claude Cowork/memory/memory.md` authoritative. Generated pages are rebuildable views, original documents are evidence, and saved analyses are attributed interpretations.

Initial surfaces are Obsidian Markdown and CLI commands. No Agent Canvas dependency, new desktop application, graph interface, automatic web research, embedding provider, bulk migration, or automatic consolidation is included.

## Shared design contracts

| Concern | Decision |
|---|---|
| Authority | Render current facts deterministically from `fact_key`, `fact_value`, `effective_date`, and lifecycle selectors. Synthesis cannot rewrite that section. Source claims and generated interpretations cannot replace reviewed values. Existing untyped entries/events retain eligibility. Conflicting current heads yield a conflict, never a ranked winner. |
| Evidence | Proposed record: `source_id`, original path/URL, retained snapshot locator, raw-content digest/version, extraction digest/parser version, exact excerpt/span, source date when known, capture/verification dates, optional existing memory hash, and current/history/source-claim/generated status. Unavailable fields remain unavailable. |
| Citation locations | Markdown heading/anchor and excerpt; transcript message position and excerpt; PDF page; DOCX heading/paragraph; web snapshot section and original URL. |
| Source changes | Track original availability separately from retained-version availability. A moved original may be rebound only after matching identity/digest. A reintroduced version can resolve a missing flag; changed bytes create a new version. Never silently retarget old citations or mark a fact false. |
| Storage | Use existing writable vault folders. Proposed derived content: `projects/<project>/knowledge/`; managed sources: `inbox/knowledge/sources/`; review view: `inbox/knowledge/review.md`. Final paths are validated through the existing gateway. |
| Ownership | Generated sections carry origin, input versions, and generation metadata. User notes are separate and preserved. Unknown/unmarked files are never overwritten. |
| Feedback prevention | Generated pages, answers, review views, and extraction intermediates are excluded from automatic capture and from original-source evidence. Explicit fact proposals must trace back to original evidence. |
| Concurrency | Review and canonical mutations reuse the existing shared lock and re-read inside it. Derived publication rechecks input and destination versions before replacement; concurrent human edits preserve both versions and require reconciliation. |
| Model calls | Reuse the configured provider with separate strict output schemas for synthesis and capture. Do not weaken the existing candidate validator. Bound input, time, output, retries, and refresh batches. |
| Local operation | Existing recall remains deterministic, local, and available when synthesis fails. Searching and showing evidence require no model. AI answers are explicit operations. |
| Configuration | Add schema-validated knowledge settings, feature flags, project source scopes, and budgets. Register them with existing config validation and runtime drift checks. |
| Data boundary | Preserve exclusion checks, LEFT restrictions, no-follow paths, atomic writes, and source text as untrusted data. Apply checks to imports, metadata, retrieval output, and generated publication. |

Any new JSON indexes or dependency ledgers are rebuildable operational metadata, not stores of independently authoritative facts. Persist no raw query log by default; an explicit saved answer may retain its question.

All new paths, schemas, modules, work packages, flags, and command forms below are **proposed**. Existing paths are labeled separately. `P<phase>.<number>` identifies a work package; `A<phase>` identifies its phase acceptance gate. Each phase owns its listed files until A passes. Shared reader, gateway, proposal/promotion, pipeline, sweep, CLI, and schema edits run sequentially through that owner; no concurrent edits to these integration points.

## Requirements coverage

| Requirement | Work packages | Acceptance | Consumed by |
|---|---|---|---|
| SB-WIKI-01 — living pages | P3.1–P3.3 | A3: scoped, cited, incremental pages | Retrieval, saved answers |
| SB-WIKI-02 — evidence answers | P1.1–P1.3 | A1: version-bound passages and honest fallback | All other features |
| SB-WIKI-03 — fact review | P2.1–P2.3 | A2: reviewed, race-safe replacement | Pages, import proposals, saved-answer proposals |
| SB-WIKI-04 — broader capture | P4.1–P4.3 | A4: originals and retryable import | Retrieval, pages, answers |
| SB-WIKI-05 — purpose retrieval | P5.1–P5.3 | A5: measured relevance with preserved authority | Saved answers |
| SB-WIKI-06 — saved answers | P6.1–P6.3 | A6: explicit, cited, revisable analysis | Project navigation |

P0.1–P0.3 and P7.1–P7.3 provide shared isolation and release gates for every requirement.

**Proposed CLI contract:** from the future isolated worktree, use `node scripts/knowledge.js` with these arguments. These commands are not implemented or run by this planning task.

| Operation | Proposed arguments |
|---|---|
| Ask / inspect | `ask --project demo --question "What is current?"`; add `--sources-only`, `--history`, or `--interactive`; `evidence --id E1` |
| Review / refresh | `review --project demo` (guided preview/choices); `refresh --project demo` |
| Import / retry | `import --project demo --file ./fixtures/source.pdf`; `import --project demo --url https://example.com`; `import-status --id I1`; `import-retry --id I1` |
| Save / revise | Choose Save in the interactive answer session; use `ask --project demo --question "What is current?" --save` for explicit noninteractive saving; `revise --saved-id S1` |

Evidence/import/saved IDs resolve versioned records, not list positions. Unsaved questions and answers stay in process memory only; closing the session discards them. Saving is explicit and occurs before that session exits, so a later command never depends on a silently persisted query log. Guided review requires no predecessor-hash copying.

## Phase 0 — establish a safe development baseline

**Work packages P0.1–P0.3; prerequisites:** plan approval.

1. Create a dedicated worktree from the freshly verified runtime revision. Re-read its current instructions. Do not change the installed runtime or the Agent Canvas branch's application code.
2. Provide isolated vault, proposal queue, ingestion ledger, pulse ledger, and provider stubs. Audit every state path: development must not inherit the runtime's shared `state/` or `.env` symlinks. Test harnesses fail if paths resolve to the live vault/state.
3. Record existing command behavior and frozen retrieval results. Define evidence, project, derived-document, and review-action schemas. Inventory original memory hashes, block anchors, bodies, and source references read-only for preservation verification.

**Ownership:** existing `src/pipeline-infra.js`, `src/vault-gateway.js`, `config/schema/pipeline.schema.json`, `eval/golden-recall.json`; proposed `test/knowledge/fixtures.js`, `config/schema/knowledge.schema.json`, `config/knowledge.json`. Later source paths refer to the isolated worktree.

**A0 exit gate:** existing checks pass against isolated fixtures; deliberate live-path injection is rejected; installed revision/pin, schedules, and canonical bytes stay unchanged. Preserve the frozen 20-query corpus, expected hashes, and baseline. Proposed automated check: `test/knowledge/isolation.test.js` plus the existing checks listed in Phase 7.

## Phase 1 — inspectable evidence and cited answers

**User flow:** Ask a question, read a concise answer, follow a citation to the exact passage, or request original sources only.

**Work packages P1.1–P1.3; covers SB-WIKI-02; prerequisites:** A0.

1. Add a source/evidence resolver for existing Markdown and transcripts. Resolve legacy source references when possible; show “source unavailable” or “source changed” when not. Bind locators to content versions so line movement cannot silently change a citation's meaning.
2. Add explicit cited-answer and evidence commands behind a feature flag. Ordinary `/recall` retains its results. Assemble deterministic current facts, dated events, source claims, and interpretation with separate labels and current/history selection. Introduce typed synthesis through `src/pipeline-infra.js`; keep capture validation intact. Model failure returns deterministic evidence with synthesis-failed status and saves nothing.
3. Validate claim-to-evidence references; reject unknown citation IDs and invalid excerpts. Require abstention or qualification for unsupported conclusions. “Original sources only” excludes generated summaries, labels conflicting source claims, and cannot replace reviewed state. Distinguish a verified retained passage from an unavailable current original.

**Ownership:** existing `src/memory-reader.js`, `src/recall-command.js`, `src/pipeline-infra.js`, `src/content-policy.js`; proposed `src/knowledge/evidence.js`, `src/knowledge/answer.js`, `scripts/knowledge.js`, `.claude/commands/knowledge.md`, and forwarding-wrapper integration.

**A1 exit gate:** every verified citation resolves to its expected version/passage; fabricated locators fail; missing sources and conflicting heads are explicit. Source-only results contain no generated evidence. Proposed `test/knowledge/evidence.test.js` and `answer.test.js` cover changed text, absent transcripts, unsafe paths, exclusions, unsupported questions, and timeout; humans also check actual claim support.

## Phase 2 — simpler fact review

**User flow:** Open the review view, see the current value beside a proposed replacement and its evidence, then accept, edit, defer, or reject.

**Work packages P2.1–P2.3; covers SB-WIKI-03; prerequisites:** A1.

1. Build a read view over existing `proposals/memory-proposals.md`. Group by fact key; show current/proposed values, effective date, evidence, conflict, and before/after preview. Link the view and pending count from existing pulse output; keep one approval queue.
2. Add guided CLI review referenced from Obsidian. Resolve predecessor hashes internally; offer accept/edit/reject/defer with durable choices. Manual proposal editing remains an input to the same queue. Edits invalidate prior acceptance and rerun shape, date, exclusion, and evidence checks.
3. Bind actions to exact proposal revision and predecessor hash. Under the shared lock, re-read and validate both before applying the decision through promotion. Reuse a lock-held promotion primitive to avoid nested-lock deadlock. Concurrent edits or competing heads return a refreshed comparison, never overwrite newer decisions. Preserve event eligibility.

**Ownership:** existing `src/memory-proposals.js`, `src/promote-memories.js`, `src/pulse.js`; proposed `src/knowledge/review.js` and shared knowledge CLI.

**A2 exit gate:** no unreviewed current-state promotion or stale approval; replacement preserves predecessor body/hash/anchor/source and adds one successor; repeat acceptance is idempotent. Proposed `test/knowledge/review.test.js` exercises all choices, exclusion after edits, competing heads, older/future dates, concurrent scheduled/manual writers, and interruption after memory commit before queue status.

## Phase 3 — living project and topic pages

**User flow:** Open a project page for current facts, dated decisions, relevant sources, open questions, and items needing review.

**Work packages P3.1–P3.3; covers SB-WIKI-01; prerequisites:** A1–A2.

1. Define an explicit project ID, allowed source paths, and selected shared-memory references. Start with one fixture project; do not infer whole-machine access. Add a generated project index linked from the existing vault navigation without replacing human content.
2. Build a page from a versioned evidence bundle: current facts, dated decision history, source claims, clearly labeled interpretation, unresolved questions, and citations. Fact rendering uses the canonical reader's lifecycle rules. Include evidence freshness and last successful refresh.
3. Track source versions and memory hashes. Detect changes through CLI checks or approved refresh, including import, promotion, pulse corrections, human edits, and reintroduction. Recheck inputs/destination before atomic publication; preserve user sections. Direct Obsidian reads show a last-checked snapshot, not live verification. Bounded post-sweep refresh stays disabled until activation. Failure preserves the valid body and updates a writable stale-status field/sidecar; otherwise report failure through CLI. Capture/promotion remain independent.

**Ownership:** existing reader, `src/promote-memories.js`, `src/pulse.js`, `scripts/daily-sweep.js`, gateway; proposed `src/knowledge/projects.js`, `src/knowledge/pages.js`, `src/knowledge/dependencies.js`, and `templates/knowledge-project.md`.

**A3 exit gate:** fixture pages separate current facts/history/source claims; claims are traceable; only dependent pages invalidate. Superseded values leave the current section but remain historical. Proposed `test/knowledge/pages.test.js` covers concurrent promotion, user edits, unchanged-input no-op, missing/reintroduced sources, and zero generated-page recapture.

## Phase 4 — broader document and web capture

**User flow:** Import a selected PDF, Word document, or URL into a project; see imported, unchanged, failed, or needs attention; inspect its original and extracted passages.

**Work packages P4.1–P4.3; covers SB-WIKI-04; prerequisites:** A1–A3.

1. Add bounded text-PDF, DOCX, and static-web parsers preserving tables and locators. At implementation, verify library official docs, Node 22 compatibility, and license before pinning. Bound bytes, pages, decompressed data, redirects, and deadlines; reject private/local destinations at each redirect/resolution and never execute scripts. Scanned PDFs, encryption, unsupported `.doc`, and corrupt files return needs-attention/failed; OCR is deferred.
2. Retain immutable selected originals/snapshots through a binary-safe gateway extension. Source identity, content version, project association, and extraction/parser version remain separate: unchanged imports reuse versions; changed bytes create versions; parser upgrades re-extract without inventing a new original. Preserve originals and provenance; never modify selected source files.
3. Persist per-stage status for fetch/copy, extraction, candidate staging, and view invalidation; resume failed stages with idempotent checkpoints. Report partial success honestly, including extraction succeeded but staging failed. Feed evidence through existing staging; no-fact extraction is valid. Retain evidence for answers. Exclude copies/intermediates/generated derivatives from discovery and explicit reimport as original evidence.

**Ownership:** existing `src/memory-extractor.js`, sweep, gateway, content policy, `package.json`, `package-lock.json`; proposed `src/knowledge/import.js`, `src/knowledge/parsers/pdf.js`, `docx.js`, `web.js`, and managed source manifests.

**A4 exit gate:** proposed `test/knowledge/import.test.js` and parser fixtures verify headings/tables/locators, unchanged duplicates, parser upgrades, mixed batches, failed-stage restart, cancellation, and explicit unsupported states. Duplicates add no candidates/refresh. Source changes flag pages without changing facts. Existing Markdown/transcript capture stays compatible; humans inspect representative original-versus-extracted tables.

## Phase 5 — purpose-aware retrieval

**User flow:** Ask within a project, and receive evidence relevant to its goals and key questions while still being able to inspect source material and history.

**Work packages P5.1–P5.3; covers SB-WIKI-05; prerequisites:** A1, A3–A4.

1. Extend project definitions with user-owned goals/questions/aliases. Reuse existing notes where possible. Apply project, exclusion, lifecycle, and exact fact-key constraints before ranking. Purpose guides relevance, never authority; shared facts require explicit selection.
2. Retrieve scoped memory, original evidence, and derived navigation using exact/keyword matches, bounded alias expansion, then linked-page traversal. Resolve derived references to originals; repeated summaries are not independent corroboration. An explicitly selected missing/invalid project returns a scope error, never global results. Only a request without a project retains ordinary legacy recall.
3. Add a separate benchmark against unchanged keyword retrieval. Preserve deterministic fallback. Embeddings remain optional future work, justified by measured unmet need.

**Ownership:** existing reader, recall command, `scripts/eval-recall.js`; proposed `src/knowledge/retrieval.js`, `scripts/eval-knowledge.js`, and `eval/knowledge/golden.json` with expected answers, evidence IDs, and authority labels.

**A5 exit gate:** proposed `test/knowledge/retrieval.test.js` verifies exact fact/history behavior, zero scope/exclusion leaks, invalid-project failure, and unchanged no-project recall. Freeze at least 30 representative paraphrase/project/evidence questions before implementation: ≥90% evidence recall@5 on answerable cases, all conflicts/unanswerable cases correctly qualified or abstained, and improvement over that set's keyword-only run. Never rewrite expected answers after observing results.

## Phase 6 — save useful answers

**User flow:** Save a useful comparison or analysis to the project's knowledge area, reopen its supporting evidence later, and see when that evidence has changed.

**Work packages P6.1–P6.3; covers SB-WIKI-06; prerequisites:** A1, A3, A5.

1. Add explicit save and revise operations for an answer. Persist its question, project, answer text, source versions, memory hashes, generation date, and analysis status. Query history is not stored unless the user saves it.
2. Index saved answers as analyses and connect them to the project page. Reuse dependency invalidation so changed sources or superseded facts mark them as needing refresh. Preserve older revisions and user notes.
3. Allow explicit refresh from current evidence; a failed refresh preserves the last saved version and shows the failure. An optional “propose a fact” action resolves original supporting evidence and stages through the existing review gate. Saving itself grants no fact approval.

**Ownership:** proposed `src/knowledge/answers.js`, knowledge answer/evidence/project modules, existing proposal writer and gateway.

**A6 exit gate:** proposed `test/knowledge/answers.test.js` checks citation reopening, retry deduplication, stale flags, failed refresh, and preserved revisions/user notes. Saved analysis cannot become original evidence or an automatic fact through sweep, explicit import, excerpts, or linked derivatives. Explicit fact proposals must resolve original support and pass ordinary review.

## Phase 7 — acceptance, activation, and rollback

**Work packages P7.1–P7.3; prerequisites:** A1–A6. P7.1 owns proposed `test/knowledge/journey.test.js` and regression evidence; P7.2 owns human UAT, dependency/config review, and isolated release rehearsal; P7.3 owns a proposed release dossier with exact revision, activation commands, and rollback instructions. Local implementation ends at release preparation.

## Failure and recovery

| Failure | Required recovery and observable check |
|---|---|
| Missing/moved/changed original | Preserve retained evidence; label original status, rebind matching versions, flag dependents, never rewrite fact history. |
| Parser/network/provider failure | Retain originals/successful stages; return failed/partial/needs-attention; retry failed stages. Offline answers return ordered evidence. |
| Duplicate/interrupted import or write | Use versioned manifests and atomic publication; recover committed stages without duplicate candidates or fabricated completion. |
| Stale preview, edited proposal, competing head | Re-read queue/current values under shared lock, rerun exclusions, invalidate acceptance, show fresh comparison. |
| Human edit during page refresh | Reject outdated destination write; preserve human text and valid generated body; offer reconciliation. |
| Exclusion, traversal, permission, symlink | Fail closed before read/publication; report safely; retry only after permitted correction. |
| Generated content rediscovered | Reject by provenance/type/path and derivative lineage, including linked excerpts; require original evidence for explicit proposals. |
| Source reintroduced/parser upgraded | Reconcile identity/version; re-extract if needed; clear missing only after verification, invalidate affected dependencies. |

## Release gates

**A7 requires all gates below. These are future operations, not results of this planning task.** Run proposed phase tests with `npm test -- --runInBand test/knowledge/<phase>.test.js`, substituting the named files above, only after A0 isolation. Run the proposed benchmark with `node scripts/eval-knowledge.js`; freeze its expected answers and labels before scoring.

### R1 — automated preservation and full journey

- Run existing tests, lint, UAT, config validation, preservation checks, and unchanged frozen recall checks in the implementation worktree. Existing commands include `npm test`, `npm run lint`, `npm run test:uat`, `npm run eval:recall`, `npm run verify:baseline`, and `node src/pipeline-infra.js`; verify fixture isolation before running them.
- Preserve every previously passing frozen recall query. The runtime README documents 18/20 frozen/history and 14/20 current-only live with four superseded expected records; those are historical evidence, not measurements made for this plan. Establish fresh results and keep intentional current/history differences distinct from regressions.
- Validate zero incorrect current-state replacements, zero generated-source feedback loops, exact original-source preservation, mechanically resolvable citations, and manually checked support for the evaluation answers. Source-only mode must contain no synthesized evidence.
- Complete the full fixture journey: import → inspect evidence → review fact → refresh page → ask with purpose → save answer → change source → show stale/review state → approve successor → refresh dependent pages and saved analysis.
- Demonstrate model outage, malformed import, interrupted save, stale review submission, concurrent promotion/refresh, and retry. Verify last valid output and retry state survive.
- Update runtime README, codebase map, command wrappers, troubleshooting, data ownership, new dependencies/licenses, and operator runbook. Every new command example must be exercised against the fixture.

### R2 — human acceptance

Manually compare representative PDF/DOCX tables and web passages with their originals; verify that answer citations support the actual claims, not merely that links resolve. Walk through all review choices without copying hashes. Confirm that Obsidian clearly shows last-checked freshness, preserves user annotations, and distinguishes current facts, source claims, history, and analysis. Record the concrete examples and outcomes in the release dossier. Automated tests cannot substitute for these semantic and usability checks.

### R3 — controlled rollout and approval package

Prepare a clean release revision, additive metadata compatibility checks, disabled-by-default flags, an isolated pilot report, and exact activation/rollback instructions. Default pilot is one synthetic project with Markdown, a PDF, a DOCX, and a web snapshot. Use a selected real project only after permission to use its sources and live vault has been given.

After explicit live-activation approval, snapshot affected vault/state and installed runtime configuration, pause the three existing jobs, wait for in-flight writers to finish, and install the tested detached revision with its matching pin. Validate revision, cleanliness, paths, and shared-state ownership before restarting the same schedules. Preserve the existing `.env` without printing or copying its values into artifacts. Enable features in phase order on one selected project; run the approved live journey before expanding project scope. Do not add another schedule as part of the default rollout.

### Rollback

Disable new feature flags and pause refresh work; stop in-flight writers before switching code. Restore the previous tested runtime revision/pin and matching configuration, then validate existing capture/recall/promotion/pulse. Additive metadata must remain readable by the prior runtime; if compatibility fails, keep activation blocked until a safe migration/rollback exists.

Preserve newer accepted memory and queue/state progress. Do not restore an old memory snapshot over post-snapshot writes. If data recovery is needed, reconcile from preserved records under the existing lock and review affected facts explicitly. Retain imported originals, generated revisions, and audit evidence; rollback does not imply deleting them.

## Definition of done

All six user flows work through Obsidian and CLI; the existing memory lifecycle remains correct; evidence and stale state are inspectable; the separate retrieval benchmark improves without breaking frozen recall; generated text cannot approve or corroborate itself; and deployment status is recorded accurately as prepared, pilot-tested, or activated.

## Approval scope and implementation prompt

Approval of local implementation authorizes development worktrees, fixture-based code changes, local commits, and checks for Phases 0–7 through release preparation. It does not activate the runtime, change live memory/schedules, scan unrelated sources, or push/publish anything. Approval for a specific live pilot or activation is requested only when its exact tested change is reviewable.

> Approve this plan for autonomous local implementation of all six improvements. Execute Phases 0–7 through release preparation, verify each phase, and keep memory.md authoritative. Obtain my approval before live runtime activation, live-vault writes, schedule changes, or remote publication.

## References

- [Current runtime README](/Users/cpconnor/.local/share/second-brain/runtime/README.md) and [current source map](/Users/cpconnor/.local/share/second-brain/runtime/docs/codebase-map.md): inspected September 14, 2026.
- [Planning context](260914-mlr-CONTEXT.md): verified integration points and constraints.
- [LLM Wiki documented features](https://github.com/nashsu/llm_wiki#features): inspiration for linked synthesis, original-source answers, review, document intake, purpose context, and saved answers. This plan adapts those ideas to Second Brain; upstream performance claims are not acceptance evidence here.

No features were implemented and no live runtime or vault data was changed while preparing this plan.

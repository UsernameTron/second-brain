---
last_updated: 2026-07-19T19:27:22.187Z
total_pending: 40
total_processed: 0
---
### mem-20260719-040 · OTHER · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Apps Script executions dashboard is a working server-side truth source for Chat-app delivery at https://script.google.com/u/<n>/home/projects/<scriptId>/executions, drivable via claude-in-chrome on Pete's signed-in session. The scriptId lives in .clasp.json (content-engine: projects/ctg-content-engine/apps-script-source/.clasp.json). Gotcha pair: on chat.google.com the avatar-menu account click does NOT switch accounts — use the direct /u/N/ URL; pete@cloudtechgurus.com is /u/2/ (u/0 = cpeteconnor@gmail.com, u/1 = imbeddedjournalist@gmail.com).
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.187Z
source_file:: state/pattern-context.md
category:: OTHER
confidence:: 0.85
content_hash:: c7f91659ee5f
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-039 · OTHER · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Content-engine Chat deployment facts: pinned deployment is @14, ID AKfycbzOnvbt4v7XtaHG4kRkXGh17TUaUEob_RMXP5obx8LOP7Kfzx4NDw4z7P11tBHV2qv_ (list via `npx clasp deployments` from apps-script-source/). The bare /exec URL is constructible from that ID alone, so refuse-half probes need no secret — the inbound token stays out of transcripts (it lives only in PropertiesService + Chat config).
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.187Z
source_file:: state/pattern-context.md
category:: OTHER
confidence:: 0.85
content_hash:: a0f294265ab8
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-038 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** engstatus.sh is estate-wide by design — do not scope it to one repo. It sweeps PROJECTS_ROOT (default ~/projects, 45 repos on 2026-07-19), writes per-repo STATUS.md, and REWRITES the rolled-up second-brain/engineering-status/INDEX.md; setting PROJECTS_ROOT to a single repo would clobber the estate INDEX with a subset. Run it unscoped. CTG-workspace STATUS.md is gitignored (.gitignore:163), as are _audit/ and state/ — a full regen + audit-file edits need zero workspace commits.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.186Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.9
content_hash:: 907879f18c68
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-037 · OTHER · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Verified per-project test invocations across the CTG estate (2026-07-18): ctg-signal-radar 1,569 pytest; advisor-match 528 unittest; enrichment-dispatch 273 pytest; ctg-hs-exec-tool 81 pass/9 skip; ctg-hs-ops-runner 140 + relay 65; ctg-l10-eos 159 vitest + functions 39; estate-sentinel 90 pytest (SYSTEM python); ctg-fred-grok 11 unittest; GWS-audit 11 unittest; ctg-seo-monitor 7 npm; ctg-ops-automation 5 npm; hubspot-gender-enrichment 8 npm; ctg-hubspot-health 5 unittest; sentiment-analysis 63 node + broker 16; ctg-website needs Homebrew python3.13; gsd-eval-harness 37 probes; ctg-secintel 28 unittest. ctg-ai-platform NOT runnable locally (missing venv, respx, pydantic_settings) — CI runs its suite. ctg-website skills suite needs Homebrew python3.13 (pyenv has no pytest).
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.186Z
source_file:: state/pattern-context.md
category:: OTHER
confidence:: 0.8
content_hash:: 5084c11f774d
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-036 · CONSTRAINT · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** CTG `_audit/` is gitignored (.gitignore:120) and its 31 tracked files predate the rule — anything new written there is silently untracked. `docs/audits/` is ignored too. Audit outputs are operator artifacts by convention, not tracked deliverables. A new audit run directory is safe to create; do not expect it in git.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.185Z
source_file:: state/pattern-context.md
category:: CONSTRAINT
confidence:: 0.85
content_hash:: 0fa060032b8d
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-035 · CONSTRAINT · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** 12 run-scoped audit/fix subagents exist in CTG-Workspace-Build at .claude/agents/ (ctg-audit-{intel,exec,hubspot,content,ops,edge,security,connections,synthesis}, ctg-fix-{executor,tester,docsync}) with seeded memories at .claude/agent-memory/<agent>/. Do not rebuild them — re-scaffolding is cheap, but the seeded memories (settled refutations, per-project verified test invocations, git-hook traps) are the expensive part. The two standing agents ctg-brand-keeper and ctg-hubspot-extractor were preserved untouched.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.185Z
source_file:: state/pattern-context.md
category:: CONSTRAINT
confidence:: 0.9
content_hash:: 1ea76e4c490c
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-034 · CONSTRAINT · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** HubSpot enrichment gap map (Ronald confirmed, 2026-07-09): no enrichment source (Claude, Apollo, Valley) writes Account Type, Company Owner, or Lead Source on companies, nor Company Name or Mobile Phone on contacts — manual/workflow-set only. QuickBooks→HubSpot sync launch errors decode to duplicate-record collisions (email already linked to another record) plus business-validation error -11622.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.185Z
source_file:: state/pattern-context.md
category:: CONSTRAINT
confidence:: 0.85
content_hash:: a5b3c450972a
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-033 · LEARNING · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Dependabot disables auto-rebase after ~30 days open. Comment `@dependabot rebase` on the PR to revive it, then merge on green. Live example: second-brain PR #57 (`@anthropic-ai/sdk` 0.90.0 → 0.91.1), open since April 29.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.184Z
source_file:: state/pattern-context.md
category:: LEARNING
confidence:: 0.85
content_hash:: 2b0a841acb92
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-032 · CONSTRAINT · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Org-level Claude spend limits are a mid-session failure mode. The CTG org limit killed Plan subagents mid-flight on 2026-07-15 (design finished inline); members who hit the limit lose Claude access entirely. Before subagent-heavy or API-dependent runs, confirm usage headroom; keep an inline fallback for design work.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.184Z
source_file:: state/pattern-context.md
category:: CONSTRAINT
confidence:: 0.85
content_hash:: ce61ac86e3cb
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-031 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Do not rebuild the second-brain RAG retrieval engine — it ALREADY EXISTS. semantic-index.js (Voyage), recall-command.js (/recall: keyword+semantic+hybrid), memory-reader.js, vault-gateway.js. src/connectors/ is the extension point for external sources. It indexes a local vault, NOT Drive. Therefore "chat with Drive" = add a Drive connector + expose retrieval as a service; NOT building RAG from scratch. Confirmed via 2026-07-14: no "chat with Drive" code exists anywhere across projects.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.183Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.95
content_hash:: b3d9c4171c60
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-030 · CONSTRAINT · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** The CTG commit hook pattern-matches the push command name anywhere in a command string, including heredoc prose. Writing a lesson *about* that hook triggered it and blocked the whole command before any of it ran. Say "upload to remote" in commit messages and in lesson text alike. Related and same shape: the push-while-dirty hook and the branch-create-then-commit hook both evaluate the whole compound command up front, so a chained `commit && push` silently does neither.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.182Z
source_file:: state/pattern-context.md
category:: CONSTRAINT
confidence:: 0.85
content_hash:: 5911025be63b
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-029 · LEARNING · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** "Merged" is not a deployment, and audits should score the deployed state. Two CTG projects had security fixes merged to main while production still served the pre-fix code — one Cloud Run service pending a redeploy, one Apps Script pending an operator rollout whose config step must precede the code step. The distinction is invisible in git and decisive for risk. Verify the running revision (`gcloud run services describe`, deployment id) before crediting a fix as live.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.182Z
source_file:: state/pattern-context.md
category:: LEARNING
confidence:: 0.9
content_hash:: e88f6e004249
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-028 · LEARNING · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Per-repo git credential pins beat account switching when an estate spans two GitHub identities. Four CTG repos live under a second account; embedding the username in the remote URL does NOT help because the `gh` credential helper serves the *active* account's token regardless of URL. Fix: a repo-local helper (`gh auth token --user <acct>`), preceded by an empty-string entry to clear the inherited chain — `--local` otherwise appends and the inherited helper answers first. This fixes `git` only; `gh` API calls still need `GH_TOKEN=$(gh auth token --user <acct>)` per command. A remote 404 in a multi-identity estate means the wrong active account, not a deleted repo.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.182Z
source_file:: state/pattern-context.md
category:: LEARNING
confidence:: 0.9
content_hash:: 026e6527c17b
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-027 · LEARNING · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** `set -- $x` does not word-split in zsh. A bash-idiom loop (`for x in "name 1" "name 2"; do set -- $x`) silently assigns the entire string to `$1` and leaves `$2` empty, turning 20 `gh pr merge` calls into 20 `cd` failures. In zsh use `${=x}`, or skip the cleverness and write explicit lines. Nothing is lost when this happens — the commands never reach `gh` — but under a different command shape it would have.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.181Z
source_file:: state/pattern-context.md
category:: LEARNING
confidence:: 0.9
content_hash:: 90829d274155
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-026 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** A killed agent fleet leaves a specific signature: an uploaded branch with no PR. When interrupted fan-out workflows fail between the upload step and `gh pr create`, real committed work sits on the remote with nothing pointing at it — invisible unless you enumerate `git ls-remote` per repo against open PRs. After any interrupted fan-out, check for that gap before assuming work was lost or never started. Committing as you go survives session turnover; long-running workflows do not.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.180Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.85
content_hash:: 562054375fc4
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-025 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Fix the condition a finding describes, not the files it names. A security audit's worklist always looks complete from the inside — sweep the state before declaring propagation done. Example from CTG portfolio: a PR corrected a false claim in two files but identical false claims remained in four others including the README; a second example silently skipped two repos whose gates had landed. Validation must be by grep every instance across the estate, not trusting the worklist.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.180Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.9
content_hash:: f78407989941
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-024 · CONSTRAINT · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** The second-brain state/ directory is gitignored (.gitignore:4). Only tasks/lessons.md is tracked; appends to state/decisions.md and state/pattern-context.md are on-disk but NOT git-reversible. The miners still read them for harvesting, but append-only and reversible holds for lessons.md only. State changes are durable within a session but not recoverable across git operations.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.179Z
source_file:: state/pattern-context.md
category:: CONSTRAINT
confidence:: 0.9
content_hash:: a01eb62b81fa
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-023 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Lazy Prompt Loading: Estimate cost from frontmatter/metadata only; load full content only when actually invoked. Reduces baseline context by deferring expensive content. Three shipped instances in second-brain: (a) lazy require('./semantic-index') in promote-memories — embed-on-promotion is best-effort, never blocks if Voyage SDK fails; (b) briefing-renderer lazy-requires buildYesterdaySummaryLine inside prepend block; (c) recall-command --semantic/--hybrid lazy-requires per branch so keyword-only /recall never loads semantic-index.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.179Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.95
content_hash:: 73085d0e58b6
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-022 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Feature Flags as Security Perimeters: Use compile-time/config-time flags as hard security boundaries, not just toggles. Three-layer filtering (compile, runtime_deny, assembly) eliminates code paths at build time. Applied in second-brain's LEFT/RIGHT vault write-permission boundary (src/vault-gateway.js) — write access decided by static config + path classification before any agent touches the file. Same governs: excluded-terms gate in src/content-policy.js (runs before every Voyage call), ANTHROPIC_API_KEY step-level scoping in CI, branch protection requiring PR reviews.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.178Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.95
content_hash:: 76a590a2d81a
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-021 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Adaptive Denial Tracking: Track consecutive and total denials; after thresholds (3 consecutive, 20 total), change strategy — fall back to alternate path instead of continuing to deny. Already shipped in second-brain's src/utils/voyage-health.js (3-fail/15-min adaptive degradation, state persists to ~/.cache/second-brain/voyage-health.json); when Voyage degraded, semantic search falls back to keyword-only. Clone this pattern for any future external service integration (Gmail MCP, Calendar MCP, alternate LLM providers) using the stable API: recordSuccess() / recordFailure(reason) / isDegraded().
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.177Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.95
content_hash:: acf480395e3f
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-020 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Dual-Position Context Injection: System context placed at END of system prompt (high positional attention weight); user context at BEGINNING of message array (sets conversational frame). Exploits transformer attention patterns. Applied in second-brain's /today command chaining (slippage-scanner, frog-identifier, llm-augmentation); place stable identity context (LEFT vault persona, excluded terms) at system-end and session-dynamic context (today's calendar, recent memories) as first-user-message for optimal attention weighting.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.176Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.95
content_hash:: ba08d3f4d32c
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-019 · PATTERN · file:pattern-context
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Zero-Trust on Model Output: Every tool call goes through model-independent permission checks. Model output is treated as untrusted input — identical to how a web server treats user form data. Applied in second-brain via two-stage classifier (src/classifier.js produces LEFT/RIGHT routing) with re-validation in vault-gateway.js before writes; memory proposals stage to memory-proposals.md for human review via /promote-memories gate; Voyage cosine results pass through checkContent() before surfacing.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:state/pattern-context.md
captured_at:: 2026-07-19T19:27:22.175Z
source_file:: state/pattern-context.md
category:: PATTERN
confidence:: 0.95
content_hash:: 479a4bb3c5ed
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-018 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Source code describes intent; the running system is the truth. They diverge repeatedly. Before planning against any system, audit what is actually deployed — the live UI, the deployed function list, real data counts — not the checked-in code or the docs.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.077Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.95
content_hash:: e70875daa8b4
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-017 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** A read-only audit's 'Effort-1 Quick Win' rating for a source change is a hypothesis, not a fact — it never ran the test suite. Any finding that changes a function's behavior or data source must be assumed to touch tests; run the full suite immediately after applying and budget for mock/spy updates. Treat behavior-changing findings as ≥Effort-2 regardless of diff size.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.076Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.9
content_hash:: cebae8bcd6a4
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-016 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Before deleting a file flagged as an 'orphan' by literal-name grep, check for DYNAMIC consumers (directory scans, registry lookups, filename-convention matching), not just string references. A zero-grep-hits result is insufficient proof of orphan status.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.076Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.9
content_hash:: f2d1062880b7
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-015 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** When a refuted finding is discovered, grep every artifact that cited it and re-verify each. A refutation propagates as far as the original finding did. Failure to sweep leaves stale premises embedded in skill docs, plans, and requirements.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.076Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.9
content_hash:: 0990bd48d427
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-014 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** When a planning artifact (milestone scope, backlog, recipe) is consumed, re-verify it against current code before using it — treat the artifact as a claim, not ground truth. A prior session's plan can describe a world that no longer exists because the scope has shipped, refutations have landed, or premises have changed.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.075Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.9
content_hash:: e655e53a93c9
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-013 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** GitHub's `gh` credential helper serves the active account's token regardless of the URL's username. A repo with `UsernameTron@` in its remote URL still returns the active account's 404 if that account lacks access. A repo-local helper (setting `credential.helper` at `--local` scope) is required to pin per-repo credentials.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.075Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.85
content_hash:: 8eb2d0e7fa7d
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-012 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** A red CI check must be verified against the base branch before treating it as a code regression. Time-triggered failures (new CVE published, expired token, upstream deprecation) fail identically on master and the branch, and reading them as diff-caused would misdirect effort. Read the failing CI job's log to find the actual failing step before touching source.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.075Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.9
content_hash:: 3163d081afc9
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-011 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Before trusting a test run from a non-canonical checkout (e.g., inside `.claude/worktrees/`), confirm that jest actually collected suites/tests. A run matching zero tests exits green as a configuration artifact, masking real failures that only surface when run from the canonical checkout.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.074Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.85
content_hash:: bf04e30facf4
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-010 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** The distinction between 'merged' and 'deployed' is invisible in git but decisive for security claims. A deploy that reports success may change nothing (e.g., firebase deploy --only with unchanged file silently skips upload; a function deploys but remains headless). Verify the artifact the operation exists to produce, not its exit status.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.074Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.95
content_hash:: a21a48cb3e66
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-009 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** A delegated verification check is unverified at reconciliation until its evidence artifact is findable (report file, log row, remote state, etc). Absence of artifact = still open. For cheap checks, re-run rather than propagate the claim forward.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.073Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.9
content_hash:: fad782377ac6
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-008 · CONSTRAINT · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** A subagent must not convert proposal items into dispositions (marked DROPPED/DEFERRED/etc) when they sit under an explicit human-approval section. Items in approval queues may receive agent-generated recommendations, but checkbox/disposition state must remain open for human decision.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.072Z
source_file:: tasks/lessons.md
category:: CONSTRAINT
confidence:: 0.95
content_hash:: 5b7b84f17475
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-007 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** An interrupted agent fan-out (killed between commit-push and PR-create) leaves committed work on the remote with no open PR pointing at it. Detection: diff remote branches against open PRs using `git ls-remote`. This is the signature of a partial upload.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.072Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.85
content_hash:: c758edb44299
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-006 · DECISION · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** In a multi-identity GitHub estate, prefer per-repo credential pinning (repo-local git helper calling `gh auth token --user <acct>`, with an empty-string entry to clear inherited chain) over active-account switching. A repo-local pin survives account switches and provides stable, deterministic behavior per repository.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.072Z
source_file:: tasks/lessons.md
category:: DECISION
confidence:: 0.9
content_hash:: 525de9a9b1ca
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-005 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** In a zsh shell, `set -- $x` does NOT word-split unquoted parameter expansion (unlike bash). Use `${=x}` to force splitting, or write explicit loop lines instead. This caused silent assignment failures in multi-repo credential-pin loops.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.071Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.85
content_hash:: 1e6ff5451547
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-004 · PATTERN · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** For Google Chat HTTP-endpoint app failures, the Apps Script executions dashboard immediately separates token issues from delivery failures: token mismatch shows as doPost→AUTH_FAIL refusal card; delivery dead shows zero doPost rows. Verify dashboard currency by checking for a later time-driven row. Read executions before rotating tokens.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.071Z
source_file:: tasks/lessons.md
category:: PATTERN
confidence:: 0.9
content_hash:: 1f5f43ea297d
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-003 · LEARNING · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** A curl probe of Google Apps Script `/exec` with `-X POST` forces POST through the 302 redirect to `script.googleusercontent.com`, which only serves GET and returns 405. Use `curl -sS -L -d '<body>'` instead (implicit POST; curl switches to GET on redirects). Server-side doPost runs either way, but explicit `-X POST` makes result retrieval fail.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.070Z
source_file:: tasks/lessons.md
category:: LEARNING
confidence:: 0.9
content_hash:: e9a321ce053a
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-002 · PATTERN · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** When fixing a finding that names specific files, fix the underlying condition and re-sweep for all instances — the named list is always a sample, not the complete set. Apply this pattern across doc corrections, security propagations, and multi-file refactorings to avoid leaving identical issues in un-named locations.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.070Z
source_file:: tasks/lessons.md
category:: PATTERN
confidence:: 0.95
content_hash:: 6b231fca2273
status:: pending
extraction_trigger:: extract-memories
### mem-20260719-001 · CONSTRAINT · file:lessons
- [x] accept
- [ ] reject
- [ ] edit-then-accept
- [ ] defer

**Content:** Never surface ISPN, Genesys, or Asana content in memory promotion — hard exclusion. This is a vault governance rule that protects proprietary/third-party systems from being embedded in memory exports.
**Proposed tags:** 
**Proposed related:** 

session_id:: manual
source_ref:: file:tasks/lessons.md
captured_at:: 2026-07-19T19:21:42.069Z
source_file:: tasks/lessons.md
category:: CONSTRAINT
confidence:: 1
content_hash:: d14e1fa03b7f
status:: pending
extraction_trigger:: extract-memories

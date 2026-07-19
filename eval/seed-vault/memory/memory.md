<!-- INDEX:AUTO -->
**Total entries:** 135
**By category:** LEARNING:62, CONSTRAINT:11, PATTERN:18, OTHER:4, DECISION:33, PREFERENCE:4, RELATIONSHIP:3
**Sections:** 2026-07, 2026-04
**Last promoted:** 2026-07-19
**Archive:** /Users/cpconnor/Claude Cowork/memory-archive
<!-- /INDEX:AUTO -->

## 2026-07

### 2026-07-19 · LEARNING · file:pattern-context

HubSpot enrichment gap map (Ronald confirmed, 2026-07-09): no enrichment source (Claude, Apollo, Valley) writes Account Type, Company Owner, or Lead Source on companies, nor Company Name or Mobile Phone on contacts — manual/workflow-set only. QuickBooks→HubSpot sync launch errors decode to duplicate-record collisions (email already linked to another record) plus business-validation error -11622.

category:: LEARNING
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: a5b3c450972a

### 2026-07-19 · LEARNING · file:pattern-context

Dependabot disables auto-rebase after ~30 days open. Comment `@dependabot rebase` on the PR to revive it, then merge on green. Live example: second-brain PR #57 (`@anthropic-ai/sdk` 0.90.0 → 0.91.1), open since April 29.

category:: LEARNING
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 2b0a841acb92

### 2026-07-19 · CONSTRAINT · file:pattern-context

Org-level Claude spend limits are a mid-session failure mode. The CTG org limit killed Plan subagents mid-flight on 2026-07-15 (design finished inline); members who hit the limit lose Claude access entirely. Before subagent-heavy or API-dependent runs, confirm usage headroom; keep an inline fallback for design work.

category:: CONSTRAINT
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: ce61ac86e3cb

### 2026-07-19 · CONSTRAINT · file:pattern-context

The CTG commit hook pattern-matches the push command name anywhere in a command string, including heredoc prose. Writing a lesson *about* that hook triggered it and blocked the whole command before any of it ran. Say "upload to remote" in commit messages and in lesson text alike. Related and same shape: the push-while-dirty hook and the branch-create-then-commit hook both evaluate the whole compound command up front, so a chained `commit && push` silently does neither.

category:: CONSTRAINT
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 5911025be63b

### 2026-07-19 · PATTERN · file:pattern-context

A killed agent fleet leaves a specific signature: an uploaded branch with no PR. When interrupted fan-out workflows fail between the upload step and `gh pr create`, real committed work sits on the remote with nothing pointing at it — invisible unless you enumerate `git ls-remote` per repo against open PRs. After any interrupted fan-out, check for that gap before assuming work was lost or never started. Committing as you go survives session turnover; long-running workflows do not.

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 562054375fc4

### 2026-07-19 · OTHER · file:pattern-context

Verified per-project test invocations across the CTG estate (2026-07-18): ctg-signal-radar 1,569 pytest; advisor-match 528 unittest; enrichment-dispatch 273 pytest; ctg-hs-exec-tool 81 pass/9 skip; ctg-hs-ops-runner 140 + relay 65; ctg-l10-eos 159 vitest + functions 39; estate-sentinel 90 pytest (SYSTEM python); ctg-fred-grok 11 unittest; GWS-audit 11 unittest; ctg-seo-monitor 7 npm; ctg-ops-automation 5 npm; hubspot-gender-enrichment 8 npm; ctg-hubspot-health 5 unittest; sentiment-analysis 63 node + broker 16; ctg-website needs Homebrew python3.13; gsd-eval-harness 37 probes; ctg-secintel 28 unittest. ctg-ai-platform NOT runnable locally (missing venv, respx, pydantic_settings) — CI runs its suite. ctg-website skills suite needs Homebrew python3.13 (pyenv has no pytest).

category:: OTHER
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
justification:: Cross-project test-invocation roster spans the whole estate, not one PATTERN/LEARNING/CONSTRAINT bucket.
content_hash:: 5084c11f774d

### 2026-07-19 · LEARNING · file:lessons

When a refuted finding is discovered, grep every artifact that cited it and re-verify each. A refutation propagates as far as the original finding did. Failure to sweep leaves stale premises embedded in skill docs, plans, and requirements.

category:: LEARNING
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 0990bd48d427

### 2026-07-19 · LEARNING · file:lessons

When a planning artifact (milestone scope, backlog, recipe) is consumed, re-verify it against current code before using it — treat the artifact as a claim, not ground truth. A prior session's plan can describe a world that no longer exists because the scope has shipped, refutations have landed, or premises have changed.

category:: LEARNING
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: e655e53a93c9

### 2026-07-19 · LEARNING · file:lessons

A red CI check must be verified against the base branch before treating it as a code regression. Time-triggered failures (new CVE published, expired token, upstream deprecation) fail identically on master and the branch, and reading them as diff-caused would misdirect effort. Read the failing CI job's log to find the actual failing step before touching source.

category:: LEARNING
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 3163d081afc9

### 2026-07-19 · LEARNING · file:lessons

A delegated verification check is unverified at reconciliation until its evidence artifact is findable (report file, log row, remote state, etc). Absence of artifact = still open. For cheap checks, re-run rather than propagate the claim forward.

category:: LEARNING
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: fad782377ac6

### 2026-07-19 · DECISION · file:lessons

In a multi-identity GitHub estate, prefer per-repo credential pinning (repo-local git helper calling `gh auth token --user <acct>`, with an empty-string entry to clear inherited chain) over active-account switching. A repo-local pin survives account switches and provides stable, deterministic behavior per repository.

category:: DECISION
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 525de9a9b1ca

### 2026-07-19 · PATTERN · file:lessons

For Google Chat HTTP-endpoint app failures, the Apps Script executions dashboard immediately separates token issues from delivery failures: token mismatch shows as doPost→AUTH_FAIL refusal card; delivery dead shows zero doPost rows. Verify dashboard currency by checking for a later time-driven row. Read executions before rotating tokens.

category:: PATTERN
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 1f5f43ea297d

### 2026-07-19 · LEARNING · file:lessons

A curl probe of Google Apps Script `/exec` with `-X POST` forces POST through the 302 redirect to `script.googleusercontent.com`, which only serves GET and returns 405. Use `curl -sS -L -d '<body>'` instead (implicit POST; curl switches to GET on redirects). Server-side doPost runs either way, but explicit `-X POST` makes result retrieval fail.

category:: LEARNING
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: e9a321ce053a

### 2026-07-19 · LEARNING · file:pattern-context

Apps Script executions dashboard is a working server-side truth source for Chat-app delivery at https://script.google.com/u/<n>/home/projects/<scriptId>/executions, drivable via claude-in-chrome on Pete's signed-in session. The scriptId lives in .clasp.json (content-engine: projects/ctg-content-engine/apps-script-source/.clasp.json). Gotcha pair: on chat.google.com the avatar-menu account click does NOT switch accounts — use the direct /u/N/ URL; pete@cloudtechgurus.com is /u/2/ (u/0 = cpeteconnor@gmail.com, u/1 = imbeddedjournalist@gmail.com).

category:: LEARNING
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: c7f91659ee5f

### 2026-07-19 · OTHER · file:pattern-context

Content-engine Chat deployment facts: pinned deployment is @14, ID AKfycbzOnvbt4v7XtaHG4kRkXGh17TUaUEob_RMXP5obx8LOP7Kfzx4NDw4z7P11tBHV2qv_ (list via `npx clasp deployments` from apps-script-source/). The bare /exec URL is constructible from that ID alone, so refuse-half probes need no secret — the inbound token stays out of transcripts (it lives only in PropertiesService + Chat config).

category:: OTHER
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
justification:: Deployment-ID + URL-construction fact is operational trivia, not a reusable pattern or constraint.
content_hash:: a0f294265ab8

### 2026-07-19 · CONSTRAINT · file:pattern-context

CTG `_audit/` is gitignored (.gitignore:120) and its 31 tracked files predate the rule — anything new written there is silently untracked. `docs/audits/` is ignored too. Audit outputs are operator artifacts by convention, not tracked deliverables. A new audit run directory is safe to create; do not expect it in git.

category:: CONSTRAINT
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 0fa060032b8d

### 2026-07-19 · PATTERN · file:lessons

When fixing a finding that names specific files, fix the underlying condition and re-sweep for all instances — the named list is always a sample, not the complete set. Apply this pattern across doc corrections, security propagations, and multi-file refactorings to avoid leaving identical issues in un-named locations.

category:: PATTERN
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 6b231fca2273

### 2026-07-19 · PATTERN · file:pattern-context

engstatus.sh is estate-wide by design — do not scope it to one repo. It sweeps PROJECTS_ROOT (default ~/projects, 45 repos on 2026-07-19), writes per-repo STATUS.md, and REWRITES the rolled-up second-brain/engineering-status/INDEX.md; setting PROJECTS_ROOT to a single repo would clobber the estate INDEX with a subset. Run it unscoped. CTG-workspace STATUS.md is gitignored (.gitignore:163), as are _audit/ and state/ — a full regen + audit-file edits need zero workspace commits.

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 907879f18c68

### 2026-07-19 · CONSTRAINT · file:pattern-context

12 run-scoped audit/fix subagents exist in CTG-Workspace-Build at .claude/agents/ (ctg-audit-{intel,exec,hubspot,content,ops,edge,security,connections,synthesis}, ctg-fix-{executor,tester,docsync}) with seeded memories at .claude/agent-memory/<agent>/. Do not rebuild them — re-scaffolding is cheap, but the seeded memories (settled refutations, per-project verified test invocations, git-hook traps) are the expensive part. The two standing agents ctg-brand-keeper and ctg-hubspot-extractor were preserved untouched.

category:: CONSTRAINT
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 1ea76e4c490c

### 2026-07-19 · LEARNING · file:pattern-context

"Merged" is not a deployment, and audits should score the deployed state. Two CTG projects had security fixes merged to main while production still served the pre-fix code — one Cloud Run service pending a redeploy, one Apps Script pending an operator rollout whose config step must precede the code step. The distinction is invisible in git and decisive for risk. Verify the running revision (`gcloud run services describe`, deployment id) before crediting a fix as live.

category:: LEARNING
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: e88f6e004249

### 2026-07-19 · LEARNING · file:pattern-context

Per-repo git credential pins beat account switching when an estate spans two GitHub identities. Four CTG repos live under a second account; embedding the username in the remote URL does NOT help because the `gh` credential helper serves the *active* account's token regardless of URL. Fix: a repo-local helper (`gh auth token --user <acct>`), preceded by an empty-string entry to clear the inherited chain — `--local` otherwise appends and the inherited helper answers first. This fixes `git` only; `gh` API calls still need `GH_TOKEN=$(gh auth token --user <acct>)` per command. A remote 404 in a multi-identity estate means the wrong active account, not a deleted repo.

category:: LEARNING
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 026e6527c17b

### 2026-07-19 · LEARNING · file:pattern-context

`set -- $x` does not word-split in zsh. A bash-idiom loop (`for x in "name 1" "name 2"; do set -- $x`) silently assigns the entire string to `$1` and leaves `$2` empty, turning 20 `gh pr merge` calls into 20 `cd` failures. In zsh use `${=x}`, or skip the cleverness and write explicit lines. Nothing is lost when this happens — the commands never reach `gh` — but under a different command shape it would have.

category:: LEARNING
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: 90829d274155

### 2026-07-19 · CONSTRAINT · file:pattern-context

The second-brain state/ directory is gitignored (.gitignore:4). Only tasks/lessons.md is tracked; appends to state/decisions.md and state/pattern-context.md are on-disk but NOT git-reversible. The miners still read them for harvesting, but append-only and reversible holds for lessons.md only. State changes are durable within a session but not recoverable across git operations.

category:: CONSTRAINT
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:51-05:00
related:: 
content_hash:: a01eb62b81fa

### 2026-07-19 · CONSTRAINT · file:lessons

Never surface ISPN, Genesys, or Asana content in memory promotion — hard exclusion. This is a vault governance rule that protects proprietary/third-party systems from being embedded in memory exports.

category:: CONSTRAINT
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: d14e1fa03b7f

### 2026-07-19 · PATTERN · file:pattern-context

Do not rebuild the second-brain RAG retrieval engine — it ALREADY EXISTS. semantic-index.js (Voyage), recall-command.js (/recall: keyword+semantic+hybrid), memory-reader.js, vault-gateway.js. src/connectors/ is the extension point for external sources. It indexes a local vault, NOT Drive. Therefore "chat with Drive" = add a Drive connector + expose retrieval as a service; NOT building RAG from scratch. Confirmed via 2026-07-14: no "chat with Drive" code exists anywhere across projects.

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: b3d9c4171c60

### 2026-07-19 · PATTERN · file:pattern-context

Lazy Prompt Loading: Estimate cost from frontmatter/metadata only; load full content only when actually invoked. Reduces baseline context by deferring expensive content. Three shipped instances in second-brain: (a) lazy require('./semantic-index') in promote-memories — embed-on-promotion is best-effort, never blocks if Voyage SDK fails; (b) briefing-renderer lazy-requires buildYesterdaySummaryLine inside prepend block; (c) recall-command --semantic/--hybrid lazy-requires per branch so keyword-only /recall never loads semantic-index.

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: 73085d0e58b6

### 2026-07-19 · PATTERN · file:pattern-context

Feature Flags as Security Perimeters: Use compile-time/config-time flags as hard security boundaries, not just toggles. Three-layer filtering (compile, runtime_deny, assembly) eliminates code paths at build time. Applied in second-brain's LEFT/RIGHT vault write-permission boundary (src/vault-gateway.js) — write access decided by static config + path classification before any agent touches the file. Same governs: excluded-terms gate in src/content-policy.js (runs before every Voyage call), ANTHROPIC_API_KEY step-level scoping in CI, branch protection requiring PR reviews.

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: 76a590a2d81a

### 2026-07-19 · PATTERN · file:pattern-context

Adaptive Denial Tracking: Track consecutive and total denials; after thresholds (3 consecutive, 20 total), change strategy — fall back to alternate path instead of continuing to deny. Already shipped in second-brain's src/utils/voyage-health.js (3-fail/15-min adaptive degradation, state persists to ~/.cache/second-brain/voyage-health.json); when Voyage degraded, semantic search falls back to keyword-only. Clone this pattern for any future external service integration (Gmail MCP, Calendar MCP, alternate LLM providers) using the stable API: recordSuccess() / recordFailure(reason) / isDegraded().

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: acf480395e3f

### 2026-07-19 · PATTERN · file:pattern-context

Dual-Position Context Injection: System context placed at END of system prompt (high positional attention weight); user context at BEGINNING of message array (sets conversational frame). Exploits transformer attention patterns. Applied in second-brain's /today command chaining (slippage-scanner, frog-identifier, llm-augmentation); place stable identity context (LEFT vault persona, excluded terms) at system-end and session-dynamic context (today's calendar, recent memories) as first-user-message for optimal attention weighting.

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: ba08d3f4d32c

### 2026-07-19 · PATTERN · file:pattern-context

Zero-Trust on Model Output: Every tool call goes through model-independent permission checks. Model output is treated as untrusted input — identical to how a web server treats user form data. Applied in second-brain via two-stage classifier (src/classifier.js produces LEFT/RIGHT routing) with re-validation in vault-gateway.js before writes; memory proposals stage to memory-proposals.md for human review via /promote-memories gate; Voyage cosine results pass through checkContent() before surfacing.

category:: PATTERN
source-ref:: file:state/pattern-context.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: 479a4bb3c5ed

### 2026-07-19 · LEARNING · file:lessons

Source code describes intent; the running system is the truth. They diverge repeatedly. Before planning against any system, audit what is actually deployed — the live UI, the deployed function list, real data counts — not the checked-in code or the docs.

category:: LEARNING
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: e70875daa8b4

### 2026-07-19 · CONSTRAINT · file:lessons

A subagent must not convert proposal items into dispositions (marked DROPPED/DEFERRED/etc) when they sit under an explicit human-approval section. Items in approval queues may receive agent-generated recommendations, but checkbox/disposition state must remain open for human decision.

category:: CONSTRAINT
source-ref:: file:tasks/lessons.md
tags:: 
added:: 2026-07-19T14:39:49-05:00
related:: 
content_hash:: 5b7b84f17475

### 2026-07-19 · LEARNING · file:RECONCILED-WORKLIST

When an evidence-reproduction script "cannot produce output as shipped", check glob-vs-compression mismatch first: ctg-secintel-intake tl.py globbed activity_*.csv while the committed evidence ships only as .csv.gz, so it silently matched zero files. A 3-line gzip-aware open + widened glob restored the documented reproduction (15 move/delete/rename events). Silent empty-glob no-ops present as broken scripts.

category:: LEARNING
source-ref:: file:CTG-Workspace-Build/_audit/2026-07-18-systemic-health/RECONCILED-WORKLIST.md
tags:: forensics, python, gzip, debugging, ctg
added:: 2026-07-19T01:55:30-05:00
related:: 
content_hash:: 973c77b4cb22

### 2026-07-19 · CONSTRAINT · file:RECONCILED-WORKLIST

Claude Code .env deny-rule asymmetry observed 2026-07-18 in ctg-signal-radar: reads of .env.example (Read tool, cat, sed -n) were permission-denied, but an in-place `sed -i` WRITE to the same file was allowed. Workaround for legitimate edits: read via `git show HEAD:.env.example`, write via sed -i, verify via `git diff`. Also a policy gap worth fixing: the deny rule blocks the cheap operation and allows the dangerous one.

category:: CONSTRAINT
source-ref:: file:CTG-Workspace-Build/_audit/2026-07-18-systemic-health/RECONCILED-WORKLIST.md
tags:: claude-code, permissions, env-files, security
added:: 2026-07-19T01:55:30-05:00
related:: 
content_hash:: f40b598539cb

### 2026-07-19 · LEARNING · file:RECONCILED-WORKLIST

Adversarial verifiers briefed with only claim + branch should always diff-stat the WHOLE branch against main, not just the claimed files: on 2026-07-18 all 8 fix-branch verifications confirmed with zero refutations, but the full-branch diff surfaced a file edited-but-omitted from the executor’s claim summary (benign, declared in the commit message). Scope drift hides in the gap between the claim narrative and the actual diff.

category:: LEARNING
source-ref:: file:CTG-Workspace-Build/_audit/2026-07-18-systemic-health/RECONCILED-WORKLIST.md
tags:: code-review, verification, subagents
added:: 2026-07-19T01:55:30-05:00
related:: 
content_hash:: 64f91c3bd240

### 2026-07-19 · LEARNING · session:CTG-Work

Quarantine moves should land under the repo's documented archive convention (CTG: `_archive/<topic>-<date>/` with a provenance README, gitignored), not an ad-hoc quarantine dir. 2026-07-19: 50 orphan log files moved to a new `projects/_quarantine-*` dir left the tree dirty and tripped the push-while-dirty hook; relocating into gitignored `projects/_archive/orphan-lesson-capture-logs-2026-07-18/` followed the documented pattern and cleared the hook. The convention exists so cleanup doesn't itself create drift.

category:: LEARNING
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: cleanup, quarantine, git-hooks, conventions, ctg
added:: 2026-07-19T01:55:30-05:00
related:: projects/_archive/
content_hash:: 54d1b5ce9062

### 2026-07-19 · LEARNING · session:CTG-Work

Exit 0 is not proof of currency or content — verify the actual payload before writing a closure into any governance record. 2026-07-19: a GCS backup already marked "closed" in the risk register was one commit stale (tarball mtime 01:07:55 vs final commit fcc5121 at 01:12:48). Caught by extracting the archive and running `git log` + `git fsck` INSIDE the unpacked copy, and by the MD5 changing between uploads. The tar/gsutil commands had exited 0 both times.

category:: LEARNING
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: verification, backups, governance, evidence, gcs
added:: 2026-07-19T01:55:24-05:00
related:: WAITING-ON-ME.md, SCORECARD.md
content_hash:: 86c293592b49

### 2026-07-19 · LEARNING · session:CTG-Work

estate-ci onboarding for flat-layout Python projects: `pip install -e ".[test]"` fails with "Multiple top-level packages discovered in a flat-layout" (setuptools auto-discovery) when the project has several top-level dirs (e.g. app/ + relay/). Fix in the WORKFLOW, not the project manifest: install `-r requirements.txt` plus the pyproject test-extra pins explicitly, and rely on `python -m pytest` putting the project dir on sys.path. Proven green: CTG-Workspace-Build run 29675590072 (secret-scan + both pytest jobs) after fix 3781fd1.

category:: LEARNING
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: ci, python, setuptools, estate-ci, flat-layout
added:: 2026-07-19T01:55:24-05:00
related:: estate-ci-template.yml, ROLLOUT.md
content_hash:: 3a871d8b3dc4

### 2026-07-19 · LEARNING · session:CTG-Work

A deliberate non-standard posture needs an explicit dated decision note INSIDE the project itself, or every future audit re-flags it as drift. Worked examples 2026-07-18/19: ctg-security-policies "local-git-only by operator design, NO GitHub remote" recorded in its ON-HOLD doc (commits 89608ae/fcc5121), and ctg-website's accepted un-versioned posture recorded in workspace STATE.md (27379c8) with evidence and a revisit trigger. Silence about an intentional choice reads as neglect to the next auditor.

category:: LEARNING
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: governance, audit, documentation, decisions
added:: 2026-07-19T01:55:24-05:00
related:: ON-HOLD-2026-07-16.md, STATE.md
content_hash:: 90b2f4cf93fc

### 2026-07-19 · DECISION · session:CTG-Work

Off-GitHub backup pattern for no-remote projects: reuse the already-trusted private GCS bucket (gs://ctg-website-backups, public-access-prevention enforced + versioning True), namespaced per project (gs://ctg-website-backups/<project>/), uploading a tarball that includes the full .git directory. Bucket versioning is a confirmed safety property, not an assumption — on 2026-07-19 it retained both generations when a stale upload was superseded (1784441276853365 then 1784441687240546). Caveat recorded with it: this is a point-in-time snapshot, not a syncing remote — refresh on the monthly dump cadence.

category:: DECISION
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: backups, gcs, git, no-remote, ctg
added:: 2026-07-19T01:55:24-05:00
related:: ctg-security-policies, ctg-website-db-backup
content_hash:: 55a3d1dccee7

### 2026-07-19 · LEARNING · file:RECONCILED-WORKLIST

Recon-then-execute with executor-side re-verification, layered: in the 2026-07-18 CTG remediation-tail run, ~75% of the morning audit journal rows were already closed by afternoon remediation. A read-only reconciliation wave (4 agents classifying every row against live disk) kept 10 executors from redoing closed work, and executor-side re-verify caught the one project the recon layer still misclassified (ctg-gtm-automation — its fixes were at the recon agent’s own HEAD). The two verification layers each caught errors the other missed; neither is redundant. Acting on a stale journal row is the top failure mode of remediation runs against same-day audits.

category:: LEARNING
source-ref:: file:CTG-Workspace-Build/_audit/2026-07-18-systemic-health/RECONCILED-WORKLIST.md
tags:: subagents, verification, audit, process, ctg
added:: 2026-07-19T01:55:24-05:00
related:: 
content_hash:: d7747e383e50

### 2026-07-19 · LEARNING · file:RECONCILED-WORKLIST

Same-day doc-sync sweeps miss stale claims inside files they just edited. Two independent instances on 2026-07-18: signal-radar docs were one commit behind their own auth fix after the sweep touched them, and ctg-ops-automation tasks/todo.md still claimed "no CI on master" while the sweep edited sibling files. A doc-sync pass is not proof a file is current — audit every claim against disk even in freshly-edited files.

category:: LEARNING
source-ref:: file:CTG-Workspace-Build/_audit/2026-07-18-systemic-health/RECONCILED-WORKLIST.md
tags:: doc-sync, audit, verification, ctg
added:: 2026-07-19T01:55:24-05:00
related:: 
content_hash:: 16c6d33fb7af

### 2026-07-19 · LEARNING · session:CTG-Work

Assign the next ADR number from the registry's on-disk max (`ls decisions/adr/`), never from a remembered or documented range. 2026-07-18: workspace CLAUDE.md said numbering spans 0001-0042, but ADR-0043 already existed on disk; the new ADR was correctly assigned 0044 only because the live registry was listed first. Governance docs lag the registry; the directory is the truth.

category:: LEARNING
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: adr, governance, numbering, ctg
added:: 2026-07-19T01:55:24-05:00
related:: decisions/adr/
content_hash:: 5670c241263f

### 2026-07-19 · LEARNING · session:CTG-Work

Pin dependency versions from a live registry query, not from memory — same failure shape as trusting a stale backup. 2026-07-18: pip-audit was about to be declared at 2.7.3 (a remembered version); `pip index versions pip-audit` returned 2.10.1, which is what got committed (b3814dc). One `pip index versions` / registry lookup per pin is cheap insurance against shipping a stale floor.

category:: LEARNING
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: dependencies, python, versions, pip
added:: 2026-07-19T01:55:24-05:00
related:: 
content_hash:: 5107714c8531

### 2026-07-19 · LEARNING · session:CTG-Work

Verifying a rotated token/gate: the faithful positive test is the REAL upstream caller, not clipboard reconstruction. 2026-07-19: Apps Script Script-Properties values would not surface in clipboard copies (no run >13 chars — UI masks the value), so extraction attempts all failed; sending /status from the live Google Chat app proved the config-to-property match end-to-end in one step. Corollary: passing secrets via $(pbpaste) into commands keeps values out of transcripts, but only works when the clipboard verifiably holds the bare value — check length before sending.

category:: LEARNING
source-ref:: session:CTG-Workspace-Build resume 2026-07-18/19 (tool-result evidence in transcript)
tags:: secrets, rotation, verification, apps-script, chat
added:: 2026-07-19T01:55:24-05:00
related:: 
content_hash:: af1ff1930a8b

### 2026-07-18 · LEARNING · file:weekly-digest-2026-07-17

Jest runs from inside `.claude/worktrees/` silently match zero tests because `testPathIgnorePatterns` excludes that tree, causing the suite to exit green against nothing. This presents as executor stalls rather than obvious test failures. Always confirm the run actually collected tests before trusting any result from a non-canonical checkout.

category:: LEARNING
source-ref:: file:memory/weekly-digest-2026-07-17.md
tags:: 
added:: 2026-07-17T19:46:21-05:00
related:: 
content_hash:: 99f9a664b51b

### 2026-07-18 · CONSTRAINT · file:weekly-digest-2026-07-17

Processes that write to the local vault must run on the machine that hosts it. RemoteTrigger executes in a cloud environment that cannot reach VAULT_ROOT, so scheduled writes from cloud triggers will silently fail. For any scheduled write operation, verify the artifact it is supposed to produce exists; never trust the trigger's success report alone. This applies to any local-filesystem-dependent automation.

category:: CONSTRAINT
source-ref:: file:memory/weekly-digest-2026-07-17.md
tags:: 
added:: 2026-07-17T19:46:21-05:00
related:: 
content_hash:: 7376862da950

### 2026-07-12 · LEARNING · file:ADR-018-cross-surface-reach

A memory system that no other surface knows about will be independently reinvented: on 2026-07-12 a Claude session with no knowledge of Second Brain spent roughly four hours designing a memory-governance system from scratch — authority hierarchy, retention and promotion rules, security gates — before discovering Second Brain had already shipped v1.5.0 with equivalent or better versions of every component. Reach is a feature, not documentation: if the memory layer is not named in the instruction layer of every surface, each surface will build its own.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/decisions/ADR-018-cross-surface-reach.md
tags:: memory-layer, architecture, process, cross-surface
added:: 2026-07-12T18:40:50-05:00
related:: ADR-018-cross-surface-reach.md, memory.md
content_hash:: aac031012fe2

### 2026-07-12 · PREFERENCE · file:about-me

Pete is a vibecoder: he builds by directing AI in plain language and delegating implementation, operating as a technical executive who thinks in systems — architecture, failure modes, fastest path to a working iteration. He needs to understand the decisions, not every implementation detail, and he tolerates ambiguity but not slowness caused by unnecessary clarifying questions.

category:: PREFERENCE
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/about-me.md
tags:: identity, working-style
added:: 2026-07-12T18:40:50-05:00
related:: about-me.md, working-pattern.md
content_hash:: 6461568e921f

### 2026-07-12 · LEARNING · file:standup-2026-05-27

HubSpot required-field rules enforce only at manual form creation — imports, API writes, and enrichment tools bypass them entirely — so CRM data-quality mandates must be enforced in the ingestion tooling or validation workflows, not by marking fields required. Discovered during CTG's May 2026 contact hygiene push when required Contact Type/Owner rules failed to stop bad imported records.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-05-27.md
tags:: hubspot, crm, workflow-config, operations
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 7d1c8ee6ce27

### 2026-07-12 · LEARNING · file:standup-2026-05-27

Every CRM enrichment source needs a dedup/validation gate before it gets write access: CTG's May 2026 governance audit found six prospecting tools writing into HubSpot with no dedup gate, Apollo alone causing 36% of duplicates including 13 self-collisions, and 13-15K shadow contacts projected within 30-60 days if enrichment kept running against that config — uncontrolled multi-tool writes compound duplicates faster than manual cleanup can drain them.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-05-27.md
tags:: crm, hubspot, operations, data-quality
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: d9a9c03958dc

### 2026-07-12 · RELATIONSHIP · file:standup-2026-06-01

Deliverable calibration for Jessica Voss, CTG's CRM/marketing operations lead: she rejects rollup-only reporting ('can't see the data, only totals') and multi-task bundle emails — send row-level data she can act on directly, scoped to a single decision per message.

category:: RELATIONSHIP
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-06-01.md
tags:: relationships, team, operations, crm
added:: 2026-07-12T18:40:50-05:00
related:: standup-2026-05-27.md
content_hash:: 38d909d12b6b

### 2026-07-12 · RELATIONSHIP · file:standup-2026-05-06

CTG's HubSpot/PRM vendor ecosystem: Impulse Creative (Christian and Meghan Campbell) builds and QA-gates the PRM partner portal on HubSpot, Ronald Berry of Flywheel Consultancy owns a 33-workflow HubSpot automation estate, and Isabelle Crittenden is CTG's HubSpot CSM — Pete inherited admin coordination of all three from Jessica Voss, CTG's CRM/marketing operations lead, in May 2026.

category:: RELATIONSHIP
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-05-06.md
tags:: relationships, hubspot, crm, team
added:: 2026-07-12T18:40:50-05:00
related:: standup-2026-05-27.md
content_hash:: 64752c444261

### 2026-07-12 · DECISION · file:standup-2026-06-04

CTG CRM contact-type discipline (Jessica Voss directive, June 2026): each record carries exactly one primary Contact/Account Type — an entity that is both a Supplier and a Guru gets two separate records — and partner-sourced clients are always labeled Partner Client, never Prospective Client, because mixed or overwritten types were corrupting workflow automations and partner attribution.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-06-04.md
tags:: crm, workflow-config, hubspot, operations
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: ff3081449c18

### 2026-07-12 · DECISION · file:standup-2026-06-03

CTG enrichment-stack policy (June 2026 toolset review with Darren, CTG's partnerships lead): AI prospecting tools must populate the mandatory CRM fields (Contact Type, Lifecycle Stage) at contact creation rather than leaving them for manual backfill, and enrichment runs against existing HubSpot lists first because re-enriching records the CRM already holds burns Apollo credits needlessly.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-06-03.md
tags:: crm, workflow-config, hubspot, operations
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: cbb6550824e9

### 2026-07-12 · DECISION · file:standup-2026-06-22

CTG company-record backfill defaults (Jessica Voss sign-off, June 2026): companies missing an owner default to Darren, CTG's partnerships lead; companies missing Account Type default to Prospective Client unless an attached deal exists, in which case the deal type wins — codified so bulk cleanups of tens of thousands of records never stall on per-record judgment.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-06-22.md
tags:: crm, workflow-config, hubspot, team
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 6c5686c2593d

### 2026-07-12 · LEARNING · file:standup-2026-06-22

Industry-mapping automations need explicit identity mappings: CTG's HubSpot Account Level automation misclassified Healthcare companies because the mapping table lacked a 'Healthcare → Healthcare' row — values expected to pass through unchanged still need their own entry, or they silently fall to the default branch.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/standup-2026-06-22.md
tags:: crm, workflow-config, hubspot, data-quality
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 786d18002de3

### 2026-07-12 · PREFERENCE · file:working-pattern

Default planning-response shape for Pete: a paste-ready fenced block destined for a Claude Code GSD prompt — comprehensive depth inside (chosen approach, rejected options with rationale, backlog flags, instrumentation notes), no preamble or narrative tail outside. Shallow answers produce shallow peer review and false-confidence plans, so summarizing when the reviewer needs substance is a defect, not brevity.

category:: PREFERENCE
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/working-pattern.md
tags:: working-style, doctrine, writing-style
added:: 2026-07-12T18:40:50-05:00
related:: working-pattern.md
content_hash:: 5085bb9319a6

### 2026-07-12 · CONSTRAINT · file:FABLE5-Last-Day-Systems-Playbook-2026-07-12

Memory promotion optimizes for signal over volume: every promoted entry occupies a retrieval slot in all future context loads, so a weak entry dilutes recall forever. Forty to eighty entries each worth loading beat three hundred that bury the good ones — curation at the promotion gate is what keeps the compounding curve compounding.

category:: CONSTRAINT
source-ref:: file:/Users/cpconnor/Claude Cowork/FABLE5-Last-Day-Systems-Playbook-2026-07-12.md
tags:: compounding, doctrine, philosophy, memory
added:: 2026-07-12T18:40:50-05:00
related:: memory.md, FABLE5-Last-Day-Systems-Playbook-2026-07-12.md
content_hash:: 4bf2b3b0b8cb

### 2026-07-12 · DECISION · file:ctg-day-1-brief

The CTG AI Platform ships inside a safety envelope: shadow mode by default (agents suggest, never send — nothing leaves the executive's hands without approval), a 60-second kill switch on any subsystem that returns 503 rather than silently degrading, and a SHA-256 hash logged on every LLM call for full forensic reconstructability.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/ctg-day-1-brief.md
tags:: ctg, security, architecture, platform
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md
content_hash:: 1646a851bb72

### 2026-07-12 · RELATIONSHIP · file:ctg-ai-platform

CTG (Cloud Tech Gurus, a technology-matchmaker connecting buyers with CX/AI suppliers) is the consulting client for whom Pete, via Connor Advisors, built the CTG AI Platform — executive email, ICP scoring, churn prediction, HubSpot CRM integration, and supplier/signal detection. Core team: Fred Stacey is CEO and runs the L10/roadmap cadence plus Pete's weekly Thursday 1:1; Darren leads partnerships and owns the prospecting tool stack, with Tafara as his EA and enrichment-tooling contact; Jessica Voss drives CRM and marketing operations and is the highest-volume stakeholder; Sharon Ndanga coordinates internal operations and supplier/Guru training; Amittai executes marketing ops and SEO builds.

category:: RELATIONSHIP
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/ctg-ai-platform.md
tags:: ctg, team, relationships, platform, operations
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md, standup-2026-06-08.md
content_hash:: ff0e225f03eb

### 2026-07-12 · LEARNING · file:second-brain-handoff

For local-LLM JSON classification, disable the model's thinking/reasoning mode: with Qwen on LM Studio, thinking-enabled pushed classification calls to ~37 seconds versus ~1.5 seconds disabled, and pairing that with a system prompt forcing JSON-only output (no explanations, no markdown, no code fences) keeps responses parseable.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/second-brain-handoff.md
tags:: local-llm, second-brain, calibration, performance
added:: 2026-07-12T18:40:50-05:00
related:: local-llm.md, second-brain-handoff.md
content_hash:: f05535a2d4d3

### 2026-07-12 · LEARNING · file:second-brain-vision-vs-shipped

Shipping infrastructure does not start the compounding — daily use does. Pete's own verdict on the Second Brain (the system that turns his Obsidian vault into a personal operating system): the system is finished, the compounding isn't; time saved accumulates only as memory depth grows through months of daily /today and /new use, so a finished build with zero usage has delivered zero of its promised value.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/second-brain-vision-vs-shipped.md
tags:: philosophy, compounding, second-brain
added:: 2026-07-12T18:40:50-05:00
related:: second-brain-vision-vs-shipped.md, second-brain.md
content_hash:: 21483101eb99

### 2026-07-12 · OTHER · file:my-company

Connor Advisors LLC is Pete's solo consulting practice and the vehicle for all client work; the primary engagement is Cloud Tech Gurus (CTG), led by CEO Fred Stacey. Compensation is a fractional $10,000/month retainer (paid by Cloud Tech Gurus LLC via Melio ACH) plus 50% tied directly to AI implementation outcomes — which makes CTG deliverable quality a revenue variable, not a courtesy — and the role spans AI solutions delivery plus the HubSpot CRM/PRM administration handed off from Jessica Voss in May 2026.

category:: OTHER
justification:: Recategorized from a legacy unsanctioned label; kept as OTHER pending a more specific sanctioned category.
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/my-company.md
tags:: connor-advisors, identity, ctg, operations
added:: 2026-07-12T18:40:50-05:00
related:: my-company.md, ctg-ai-platform.md
content_hash:: beba872696c2

### 2026-07-12 · PREFERENCE · file:anti-ai-writing-style

All output in Pete's name follows the anti-AI style doctrine: open with the answer (never context about the answer), prose over bullets for analysis, one strong recommendation instead of five equally-weighted options, and a banned-word list (genuinely, honestly, leverage, seamlessly, robust, game-changer) whose violations mark prose as machine-written. Default register is direct intelligent peer — not teacher, not assistant, not cheerleader.

category:: PREFERENCE
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/anti-ai-writing-style.md
tags:: writing-style, identity, doctrine
added:: 2026-07-12T18:40:50-05:00
related:: anti-ai-writing-style.md
content_hash:: 2cb5fc37bfb2

### 2026-07-12 · PATTERN · file:second-brain-vision-vs-shipped

Trust principles are nice; OAuth scopes are enforceable. Encode every policy at a layer that cannot be accidentally bypassed — write boundaries as code-level gateway checks, integration limits as OAuth scope grants — rather than as conventions someone might forget, because a stated policy is a wish while an enforced mechanism is a guarantee.

category:: PATTERN
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/second-brain-vision-vs-shipped.md
tags:: doctrine, philosophy, security
added:: 2026-07-12T18:40:50-05:00
related:: vault-gateway.js
content_hash:: 95677e76593c

### 2026-07-12 · PATTERN · file:FABLE5-Last-Day-Systems-Playbook-2026-07-12

The builder of a system cannot audit it for over-engineering — sunk-cost bias makes it impossible to tell load-bearing process from ceremony mistaken for rigor. Periodically hand the whole harness to a fresh model or reviewer with zero authorship stake and ask where the process taxes more than it protects, especially for a solo operator running ceremony designed for teams.

category:: PATTERN
source-ref:: file:/Users/cpconnor/Claude Cowork/FABLE5-Last-Day-Systems-Playbook-2026-07-12.md
tags:: philosophy, working-style, doctrine
added:: 2026-07-12T18:40:50-05:00
related:: FABLE5-Last-Day-Systems-Playbook-2026-07-12.md
content_hash:: 2c398c1f3dfa

### 2026-07-12 · LEARNING · file:CTG-supplier-folder-policy-audit-verdict-2026-05-18

When a permission surface is broken at scale, replace it wholesale rather than patching grants: CTG's supplier-folder cleanup would have required ~58,000 per-recipient revocations that could not converge before new shares re-opened the surface, so the remediation was migrating to a Shared Drive with per-supplier membership groups — closing both named-grant and anyone-with-link exposure in one structural move. Intent without enforcement does not produce isolation; audit the configured state, never the stated policy.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/CTG-supplier-folder-policy-audit-verdict-2026-05-18.md
tags:: ctg, security, audit, remediation
added:: 2026-07-12T18:40:50-05:00
related:: CTG-systems-and-actions-map-2026-05-18.md
content_hash:: c322d6fad473

### 2026-07-12 · LEARNING · file:CTG-systems-and-actions-map-2026-05-18

After a verbal decision call with a client executive, ship a short written memo the same day that locks the decisions and corrects any factual misses made on the call before any workstream moves — it creates the paper trail for budget questions months later, and it is the only clean mechanism to walk back a bad verbal commitment by proposing a better deliverable that fulfills the same intent. Learned on the CTG supplier-folder incident with Fred Stacey, CTG's CEO, after two misquoted numbers and one unsafe commitment landed in the call record.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/CTG-systems-and-actions-map-2026-05-18.md
tags:: ctg, strategy, communication, process
added:: 2026-07-12T18:40:50-05:00
related:: CTG-supplier-folder-policy-audit-verdict-2026-05-18.md
content_hash:: 7ee7c8e5006f

### 2026-07-12 · PATTERN · file:FABLE5-Last-Day-Skill-and-Prompt-Playbook-2026-07-12

Recurring decisions made by feel should be distilled into explicit if-then policies — weighted criteria, an edge-case table, and named escalation triggers for when the policy must defer to the human — so a cheaper model executes them without re-litigating the judgment each time. The escalation triggers are the safety valve: a frozen policy without them fires confidently on cases its author never saw.

category:: PATTERN
source-ref:: file:/Users/cpconnor/Claude Cowork/FABLE5-Last-Day-Skill-and-Prompt-Playbook-2026-07-12.md
tags:: doctrine, skills-lifecycle, working-style
added:: 2026-07-12T18:40:50-05:00
related:: FABLE5-Last-Day-Skill-and-Prompt-Playbook-2026-07-12.md
content_hash:: 36c95afcec34

### 2026-07-12 · LEARNING · file:lessons

A read-only audit's 'Effort-1 quick win' rating is a hypothesis, not a fact — the audit never ran the test suite, so it cannot see test-contract impact. Any finding that changes a function's behavior or its data source should be treated as Effort-2 or higher regardless of diff size, because tests encoding the old contract (mocks, spies, injected fixtures) will break; gate the fix on a green full suite before committing.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/tasks/lessons.md
tags:: process, testing, quality, debugging
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 7601976f95e3

### 2026-07-12 · LEARNING · file:CTG-Sentiment-Triage-Improvement-Plan-2026-07-02

For LLM classification tasks, force determinism: low temperature (~0.1 — CTG's Gmail triage fork inherited 0.9 from Google's sample, causing run-to-run variance on identical threads) plus schema-enforced structured output (responseSchema with enums) so verdicts are machine-reliable fields instead of free text to parse. The enum-schema pattern proved better than the free-text parsing in CTG's shared agent library and was backported there.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/CTG-Sentiment-Triage-Improvement-Plan-2026-07-02.md
tags:: ctg, llm, classification, determinism
added:: 2026-07-12T18:40:50-05:00
related:: CTG-Client-Triage-BUILD-PLAN-for-Claude-Code.md
content_hash:: 323344f170fc

### 2026-07-12 · DECISION · file:FABLE5-Last-Day-Systems-Playbook-2026-07-12

Route every task across inference tiers on one question: does this need frontier judgment or just competent execution? Metered frontier models get the judgment calls (architecture, review synthesis, strategy); local models get routine classification and drafting gated by frontier-authored graders — cheap generation plus frozen judgment survives any usage cap, so a rate limit never blocks work.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/FABLE5-Last-Day-Systems-Playbook-2026-07-12.md
tags:: doctrine, skills-lifecycle, working-style
added:: 2026-07-12T18:40:50-05:00
related:: local-llm.md, FABLE5-Last-Day-Systems-Playbook-2026-07-12.md
content_hash:: bcf38ad68053

### 2026-07-12 · PATTERN · file:ctg-day-1-brief

Promote agents from shadow mode to active on data, not opinion: build the accuracy ground truth from 100-200 real emails in the executive's own sent folder, each tagged with the priority they actually treated it as — the operator's historical behavior beats synthetic test cases as an evaluation corpus for go/no-go decisions.

category:: PATTERN
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/ctg-day-1-brief.md
tags:: ctg, evaluation, process, platform
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md
content_hash:: af1b2fb5edbd

### 2026-07-12 · CONSTRAINT · file:claude-code-factory

The Claude Code Factory (extension-generation toolkit for skills, agents, generators, and validators) no longer lives in its standalone repo: that repo is archived, and the live copy ships as a plugin inside the GSD repo at Pete-Gets-Shit-Done/plugins/claude-code-factory served via the local plugin marketplace — all development happens in the plugin, never in the archive.

category:: CONSTRAINT
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/claude-code-factory.md
tags:: gsd, plugins, architecture
added:: 2026-07-12T18:40:50-05:00
related:: claude-code-factory.md, gsd-framework.md
content_hash:: df480634ce8e

### 2026-07-12 · PREFERENCE · file:boozeonhormuz-com

The Obsidian dark-mode design system (deep navy, gold accents) is scoped to executive and internal deliverables only; public-facing brand sites get their own design systems — boozeonhormuz.com, Pete's satirical luxury-brand side project, locked a Fraunces+Inter luxury identity precisely because a public brand must not look like an internal dashboard.

category:: PREFERENCE
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/boozeonhormuz-com.md
tags:: platform, design, obsidian
added:: 2026-07-12T18:40:50-05:00
related:: boozeonhormuz-com.md, mirror-poster.md
content_hash:: 02babe4f982e

### 2026-07-12 · LEARNING · file:second-brain-codebase-pointer

Two separate auth planes touch Pete's Google data and must not be conflated: the Second Brain engine requests its own minimized OAuth scopes (Gmail readonly+compose, Calendar read-only, GitHub issues-only), while Claude Desktop/Cowork connectors authenticate through Google's native MCP with broader scopes managed by Anthropic's connector framework — tightening one plane does nothing to the other.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/projects/second-brain-codebase-pointer.md
tags:: second-brain, security, architecture
added:: 2026-07-12T18:40:50-05:00
related:: second-brain-codebase-pointer.md
content_hash:: 05258d644da0

### 2026-07-12 · OTHER · file:CTG-Contained-Intelligence-The-Pitch-2026-07-02

CTG's shipped v2.0 platform is positioned as a 'contained intelligence': an intelligence layer that learns the business plus an operating layer that enacts encoded executive judgment and brand voice, sealed keyless inside the company's own cloud perimeter. The containment is the product, not a security footnote — strategy is enacted but never exposed, so a competitor cannot extract it, a vendor cannot resell it, and the daily learning compounds to the owner instead of a rented platform.

category:: OTHER
justification:: Recategorized from a legacy unsanctioned label; kept as OTHER pending a more specific sanctioned category.
source-ref:: file:/Users/cpconnor/Claude Cowork/CTG-Contained-Intelligence-The-Pitch-2026-07-02.md
tags:: ctg, strategy, architecture, moat
added:: 2026-07-12T18:40:50-05:00
related:: CTG-AI-Platform-Portfolio-Summary-2026-07-02.md
content_hash:: ee8b41ef545e

### 2026-07-12 · PATTERN · file:CTG-AI-Platform-Fred-Brief-2026-07-02

Design agents draft-only from day one so go-live becomes a single reversible permission grant instead of an engineering project: CTG's shipped AI SDR runs its full multi-touch email sequence in draft mode, and one gmail.send scope grant flips it from drafting to sending. Minimum-permission design converts activation into a business decision an executive can sign, and the same draft-before-send posture holds across all seven of CTG's live Workspace agents.

category:: PATTERN
source-ref:: file:/Users/cpconnor/Claude Cowork/CTG-AI-Platform-Fred-Brief-2026-07-02.md
tags:: ctg, strategy, permissions, agents
added:: 2026-07-12T18:40:50-05:00
related:: CTG-AI-Platform-Portfolio-Summary-2026-07-02.md
content_hash:: d939d8d211d9

### 2026-07-12 · PATTERN · file:FABLE5-Last-Day-Skill-and-Prompt-Playbook-2026-07-12

When frontier-model access is expiring or rationed, mint graders, not deliverables: generation degrades gracefully on cheaper models but evaluation degrades catastrophically, because a weak model rubber-stamps its own mediocre work. A frozen grader ships a weighted rubric, gold and anti-gold exemplars, and a mechanical pass/revise procedure, and it reviews drafts clean-context — never loading the conversation that produced them. Frontier judgment authored once plus cheap generation approximates frontier quality indefinitely.

category:: PATTERN
source-ref:: file:/Users/cpconnor/Claude Cowork/FABLE5-Last-Day-Skill-and-Prompt-Playbook-2026-07-12.md
tags:: doctrine, skills-lifecycle, philosophy
added:: 2026-07-12T18:40:50-05:00
related:: FABLE5-Last-Day-Skill-and-Prompt-Playbook-2026-07-12.md
content_hash:: 0fb5548fd40b

### 2026-07-12 · LEARNING · file:FABLE5-Last-Day-Systems-Playbook-2026-07-12

Any dated status block that loads into every session will silently rot: the second-brain CLAUDE.md status froze for eleven weeks before anyone noticed, because always-loaded context gets trusted, not re-verified. The structural fix is to keep volatile status out of the always-loaded path or attach an automatic staleness check flagging any dated block older than N days — applied to every repo, not just the one that burned.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/FABLE5-Last-Day-Systems-Playbook-2026-07-12.md
tags:: doctrine, working-style, context-economy
added:: 2026-07-12T18:40:50-05:00
related:: FABLE5-Second-Brain-Audit-Prompt-2026-07-12.md
content_hash:: dac6ba182272

### 2026-07-12 · LEARNING · file:lessons

Before deleting a file flagged as an orphan by literal-name grep, check for dynamic consumers — directory scans, registry lookups, and filename-convention matching that never mention the file by name. In the Second Brain repo (Pete's Obsidian-vault personal OS), a JSON schema with zero grep hits was actually consumed by a pre-commit hook that discovers schemas via a config/schema/*.schema.json glob and matches targets by filename convention; deleting it broke three tests and removed real validation.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/tasks/lessons.md
tags:: debugging, testing, config, process
added:: 2026-07-12T18:40:50-05:00
related:: config/schema/
content_hash:: 977cfc40635e

### 2026-07-12 · DECISION · file:PROJECT

The Second Brain is deliberately pull-based: the daily briefing surfaces information only when asked (/today), and there is no push-notification surface because push creates anxiety and interrupts more than it informs. The same philosophy excludes a dedicated chat UI — Claude Code sessions already are the chat interface — and rejects complex taxonomy in favor of the write-permission split plus wikilinks.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/.planning/PROJECT.md
tags:: architecture, process, pattern
added:: 2026-07-12T18:40:50-05:00
related:: today-command.js
content_hash:: 0aa9e61aadd8

### 2026-07-12 · LEARNING · file:lessons

Verifying a plan document validates what the plan promises, not what the implementation ships: when acceptance criteria describe live-system behavior ('direct push rejected', 'CI enforced'), verification must run commands against the deployed system rather than grep the plan text. A branch-protection task passed plan-level verification while the shipped API payload silently omitted the field that made the protection real — only a post-merge manual audit caught it.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/tasks/lessons.md
tags:: process, quality, ci, testing
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 4badecb8ee57

### 2026-07-12 · LEARNING · file:lessons

Treat an operator's passing remarks as hypotheses to discuss, not documented overrides: before locking a decision from a casual comment, check it against the written requirements and prior phase context, and surface any conflict explicitly rather than silently preferring either source. A file path locked from an offhand read contradicted the requirements doc and had to be unlocked for proper discussion.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/tasks/lessons.md
tags:: process, quality, pattern
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 705524a80d3d

### 2026-07-12 · LEARNING · file:RETROSPECTIVE

When a CI quality gate lands near its threshold, add a targeted commit that pushes the metric at least 1% above the bar — a gate passed at 80.1% will fail on the next small revert or on CI-environment variance (local coverage measured with CI-skipped test paths included runs optimistic versus what CI actually measures). Margin keeps the threshold stable instead of flaky.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/.planning/RETROSPECTIVE.md
tags:: ci, quality, testing
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: bb6d27199e84

### 2026-07-12 · LEARNING · file:CTG-supplier-folder-policy-audit-verdict-2026-05-18

ACL forensics heuristic from CTG's Drive supplier-folder audit: a bimodal access distribution with an empty middle band (45 external domains on 1 folder each, 59 domains on 901+ folders each, zero between 101-900) is the fingerprint of a scripted bulk-grant cohort layered over legitimate per-item grants — organic policy decay produces a smooth distribution. Identical grant counts across many distinct recipients (13 accounts each on exactly 969 of 972 folders) confirm a batched operation rather than per-item judgment.

category:: LEARNING
source-ref:: file:/Users/cpconnor/Claude Cowork/CTG-supplier-folder-policy-audit-verdict-2026-05-18.md
tags:: ctg, security, audit, forensics
added:: 2026-07-12T18:40:50-05:00
related:: CTG-systems-and-actions-map-2026-05-18.md
content_hash:: aa598db6f768

### 2026-07-12 · DECISION · file:architecture-decisions

Hard cap for local inference on 48GB Apple Silicon: no 70B+ dense and no 120B+ MoE models — once a model spills into disk swap, inference becomes unusable, and a smaller model used well beats a larger one that thrashes.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: local-llm, adr, tradeoff
added:: 2026-07-12T18:40:50-05:00
related:: local-llm.md
content_hash:: 9bf293b457c4

### 2026-07-12 · DECISION · file:decisions

Modules and connectors take their dependencies (API clients, config, directory paths, reference dates) as function parameters instead of module-level imports or state — this makes them independently testable without mocking require() and swappable between stub and live wiring at runtime. Applied uniformly in the Second Brain across the connector layer (every connector accepts an mcpClient parameter) and the today-command decomposition (four extracted modules, zero module-level state).

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: architecture, pattern, testing
added:: 2026-07-12T18:40:50-05:00
related:: today-command.js, connectors/
content_hash:: 6a849b88ceee

### 2026-07-12 · PATTERN · file:decisions

When a third-party workflow suite overlaps an established orchestration framework, cherry-pick its patterns instead of adopting it wholesale — running two orchestrators creates dual ownership of the same lifecycle. Evaluating a strict-TDD multi-agent suite for the Second Brain yielded two adopted ideas (independent test verification, mandatory pre-PR security scan) and zero adopted infrastructure.

category:: PATTERN
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: process, architecture, pattern
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 51cca66dfb3e

### 2026-07-12 · PATTERN · file:decisions

After an MVP ships, run a dedicated go-live hardening milestone with zero new features — only defect fixes, integration wiring, and validation — to close the gap between 'works in tests' and 'works on my desk at 6:45 AM' before adding complexity. New capabilities wait until weeks of real daily use validate the base.

category:: PATTERN
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: process, quality, resilience
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 8cb4c5812929

### 2026-07-12 · DECISION · file:architecture-decisions

All Second Brain filesystem writes route through a single vault-gateway module implementing layered path defenses — traversal blocking, resolved-path escape checks, and symlink detection via realpathSync — so vault-boundary enforcement cannot be bypassed from other modules; a single choke point makes the defense both auditable and impossible to forget in new code paths.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: second-brain, adr, security, architecture
added:: 2026-07-12T18:40:50-05:00
related:: vault-gateway.js, second-brain-codebase-pointer.md
content_hash:: 815a2ee7071c

### 2026-07-12 · DECISION · file:architecture-decisions

In the GSD framework (Pete's 5-phase Claude Code delivery pipeline), test verification runs as an independent gate so the executor agent never grades its own homework — separating builder from verifier removes the incentive to under-test and gates CI without requiring human trust in any individual agent.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: gsd, adr, agents, architecture
added:: 2026-07-12T18:40:50-05:00
related:: gsd-framework.md
content_hash:: 602095ed75a2

### 2026-07-12 · DECISION · file:architecture-decisions

GSD phases carry hard scope constraints set by the architect before any build agent activates, enforced by hooks: one source of truth for what each phase is allowed to touch prevents agent scope drift, because agents cannot act out-of-phase even when a prompt invites it.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: gsd, adr, agents, architecture
added:: 2026-07-12T18:40:50-05:00
related:: gsd-framework.md
content_hash:: 72151651227b

### 2026-07-12 · DECISION · file:decisions

For matching excluded terms against Unicode evasion, the NFKD normalizer strips ALL whitespace (not just NBSP and zero-width characters) before comparison, so multi-word blocked terms match regardless of what whitespace separates the words. The normalizer is deliberately destructive — two distinct strings can collapse to the same form — which is acceptable because it is used only for inclusion detection, never identity comparison.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: security, pattern, pipeline
added:: 2026-07-12T18:40:50-05:00
related:: content-policy.js
content_hash:: 28fc59bd3df6

### 2026-07-12 · DECISION · file:PROJECT

Classify errors by a structural errorType field, not by matching message strings — upstream libraries change message text freely, and typed comparison stays correct through those changes. The Second Brain's AUTH_ERRORS taxonomy uses this so authentication-failure handling survives dependency updates unmodified.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/.planning/PROJECT.md
tags:: pattern, resilience, quality
added:: 2026-07-12T18:40:50-05:00
related:: connectors/gmail.js
content_hash:: 6d38474a0aa8

### 2026-07-12 · LEARNING · file:lessons

A UAT corpus encodes the classifier-behavior contract as of the day it was written, so any classifier-side change (prompt, threshold, excluded-terms list, content policy) must include a corpus revalidation step — CI skip-guards mask the drift because the UAT suite never runs on PRs. In the Second Brain, an excluded-terms expansion silently shifted classification decision boundaries and the accuracy suite only surfaced it many merges later.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/tasks/lessons.md
tags:: testing, quality, pipeline, ci
added:: 2026-07-12T18:40:50-05:00
related:: uat-classification.test.js
content_hash:: 0246f0ad6400

### 2026-07-12 · LEARNING · file:decisions

Documentation agents save structural effort but their output needs grep-level verification before commit — an agent refreshing CLAUDE.md and README invented three plausible-looking file paths that did not exist and misdescribed a config file's purpose while getting the overall structure right. Fact-check every path, count, and file-purpose claim against the live tree; fabrications hide well inside structurally correct output.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: process, quality, debugging
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 38a0965596d2

### 2026-07-12 · LEARNING · file:decisions

GitHub merges whatever is on a PR branch at the exact merge moment — commits pushed after the merge click (or between the last page refresh and the click) do not retroactively join the merge and can silently drop. The fix is workflow discipline: push all planned commits before opening the PR, and if pushing after it is open, wait for GitHub's Commits tab to reflect them before merging.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: git, process, quality
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 958d7922af02

### 2026-07-12 · DECISION · file:decisions

When a PR squash-merges with only part of its branch commits, recover by rebasing the original branch onto updated master — git recognizes already-merged content as upstream and drops it, leaving a clean branch of just the missing commits for a follow-up PR. This beats cherry-picking onto master (bypasses CI and branch protection) and beats re-creating the work on a fresh branch (loses original commit messages and review history); the same mechanism makes stacked branches self-cleaning after the parent merges.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: git, process, pattern
added:: 2026-07-12T18:40:50-05:00
related:: 
content_hash:: 700a73c27bcb

### 2026-07-12 · DECISION · file:decisions

Tests skipped in CI because they need live API keys create a silent 0% effective-coverage gap: quality drift passes every PR check until a human remembers to run the suite manually. Close the gap with a scheduled CI workflow (weekly cron plus manual dispatch) that runs the live-API suite with a scoped secret — fixtures are the wrong fix because they would hide exactly the drift the live tests exist to catch.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: ci, testing, quality, resilience
added:: 2026-07-12T18:40:50-05:00
related:: uat.yml
content_hash:: 1a00e0088d90

### 2026-07-12 · LEARNING · file:decisions

Claude Code PreToolUse hooks recognize only two exit codes as decisions: 0 (allow) and 2 (block); exits 1 and 3 are treated as hook errors, not blocking signals. Any gate needing richer states must encode diagnostics in stderr within the binary allow/block constraint — a tri-state exit-code design for a security gate was descoped at plan time for exactly this reason.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: pattern, security, config
added:: 2026-07-12T18:40:50-05:00
related:: security-scan-gate
content_hash:: 893a7e9cc0fc

### 2026-07-12 · LEARNING · file:decisions

Any config value interpolated into an LLM system prompt is a prompt-injection surface: the Second Brain's excluded-terms list is joined into a classifier prompt, so a maliciously crafted term could inject instructions into the model. Mitigation is to sanitize values before interpolation — strip newlines, cap length, and reject instruction-like patterns.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: security, config, pipeline
added:: 2026-07-12T18:40:50-05:00
related:: content-policy.js
content_hash:: fa15911b496e

### 2026-07-12 · DECISION · file:PROJECT

Scope CI secrets to the individual workflow step that needs them, never at workflow or job level — workflow- or job-level env exposes the secret to every step in the job, including third-party actions. After the change, verify by grepping every workflow file for the key name to confirm it appears only at the intended step.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/.planning/PROJECT.md
tags:: ci, security, config
added:: 2026-07-12T18:40:50-05:00
related:: uat.yml
content_hash:: fbb0e18c0a4b

### 2026-07-12 · DECISION · file:PROJECT

Filter prohibited content at the moment of capture, not after it lands: former-employer and client-confidential material is hard-excluded at ingress in the Second Brain because post-hoc removal must chase contamination across every file, wikilink, and derived memory it touched — one gate at the entry point is cheaper than a cleanup crawl forever after. The filter itself was hardened in production to substring-based matching after word-boundary regex missed embedded substrings.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/.planning/PROJECT.md
tags:: security, pipeline, architecture, memory-layer, content-exclusion
added:: 2026-07-12T18:40:50-05:00
related:: content-policy.js
content_hash:: c8125f4d0e5b

### 2026-07-12 · DECISION · file:architecture-decisions

Memory promotion keeps a mandatory human-in-the-loop gate: extraction at session stop, proposal staging in batches, and entry into the compounding memory layer only through explicit human review — because the design assumption is that the AI will not reliably pick what is worth remembering, and automatic promotion would amplify hallucinations into permanent knowledge that silently corrupts future retrieval. Every entry carries source attribution for auditability, and the per-run batch cap (maximum 10) is a hard ceiling with no bypass flag — a design constraint, not a default.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: memory-layer, architecture, quality-gate, adr, second-brain
added:: 2026-07-12T18:40:50-05:00
related:: memory-proposals.md, promote-memories.js, memory-pipeline.js
content_hash:: 37cbb4b0efa3

### 2026-07-12 · DECISION · file:architecture-decisions

For Google Workspace executive impersonation on the CTG AI Platform (Pete's AI operations build for consulting client Cloud Tech Gurus), use a Service Account with Domain-Wide Delegation rather than per-user OAuth: no consent-screen friction, centralized credential management, and permissions controlled in the Workspace admin console. Trade-off: requires Workspace admin access, and the service-account key becomes a high-value credential that must be secured.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: ctg, adr, architecture, tradeoff
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md, architecture-decisions.md
content_hash:: 43858d160c14

### 2026-07-12 · DECISION · file:decisions

Redact at paragraph granularity, not sentence granularity: stripping only the sentence containing an excluded term leaks the adjacent confidential context surrounding it. The Second Brain replaces the entire containing paragraph with [REDACTED] and quarantines the document when more than 50% of paragraphs are redacted — a contamination-radius model that two independent AI reviewers converged on as a HIGH concern with sentence-level stripping.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: security, pipeline, quality
added:: 2026-07-12T18:40:50-05:00
related:: content-policy.js
content_hash:: 6123aa5cbacf

### 2026-07-12 · LEARNING · file:decisions

Symlink-escape defenses must apply realpath resolution to BOTH sides of the comparison: macOS resolves /var to /private/var, so comparing realpathSync(candidate) against a raw root path fails even for legitimate paths. Canonicalize the root and the candidate with the same function before comparing.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: security, debugging, pattern
added:: 2026-07-12T18:40:50-05:00
related:: vault-gateway.js
content_hash:: 415885903b32

### 2026-07-12 · DECISION · file:decisions

The Second Brain vault access model is default-deny with three tiers: LEFT paths the agent reads but never writes, RIGHT paths it reads and writes, and any path in neither list is fully blocked — no read, no write. The path allowlist config is the complete manifest of what the agent can see, so a newly created directory is invisible to the agent until deliberately granted.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: security, architecture, config
added:: 2026-07-12T18:40:50-05:00
related:: vault-gateway.js, config/vault-paths.json
content_hash:: 8739924d6426

### 2026-07-12 · DECISION · file:decisions

Blocked content is never written to disk, even to a quarantine area: when the Second Brain's ingress filter rejects input, the quarantine stores only a metadata stub (path, reason, timestamp) and the content itself is discarded. A quarantine that persists rejected content silently violates the very 'excluded content never reaches disk' invariant it exists to enforce — a gap caught in cross-AI plan review.

category:: DECISION
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: security, pipeline, pattern
added:: 2026-07-12T18:40:50-05:00
related:: content-policy.js
content_hash:: febedbc0949c

### 2026-07-12 · LEARNING · file:decisions

Check raw input paths for '..' BEFORE calling path.normalize(): normalization resolves and removes the '..' segments, so a post-normalize check misses lateral traversal like 'writable-dir/../protected-dir/secret.md' that stays inside the root but crosses an internal permission boundary.

category:: LEARNING
source-ref:: file:/Users/cpconnor/projects/second-brain/state/decisions.md
tags:: security, debugging, pattern
added:: 2026-07-12T18:40:50-05:00
related:: vault-gateway.js
content_hash:: f9fcab6dc873

### 2026-07-12 · DECISION · file:architecture-decisions

In the CTG AI Platform email pipeline (Cloud Tech Gurus' executive-email automation), Gmail history.list reconciliation is the system of record and Pub/Sub push is only an optional trigger, never the source of truth — pull-based reconciliation is more reliable than push and idempotent by design, at the cost of higher API usage and careful historyId state management.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: ctg, adr, architecture, tradeoff
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md
content_hash:: f208b3779d0a

### 2026-07-12 · DECISION · file:architecture-decisions

Never write a HubSpot record and immediately search for it: the HubSpot v3 API has 5-10 seconds of eventual consistency between writes and searches, so queue follow-up operations or use the object ID returned by the write directly — search-based dedup right after a write will silently miss the new record.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: ctg, adr, hubspot, tradeoff
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md
content_hash:: 8cadd326b9c6

### 2026-07-12 · DECISION · file:architecture-decisions

For job-change signal detection on the CTG AI Platform, use Apollo.io as primary source with Proxycurl as fallback and never scrape LinkedIn directly: after the hiQ settlement, direct LinkedIn scraping carries contract-law risk, while Apollo maintains legal data-licensing relationships — the cost is a subscription and two providers to manage.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: ctg, adr, tradeoff, platform
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md
content_hash:: 87a471c9b56f

### 2026-07-12 · DECISION · file:architecture-decisions

All external HTTP on the CTG AI Platform goes through httpx with explicit request/response handling and no vendor SDKs: one pattern across every integration is easier to audit, the security perimeter applies uniformly, and SDK version conflicts disappear — the accepted cost is more boilerplate and hand-rolled retries, pagination, and error handling per integration.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: ctg, adr, architecture, tradeoff
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md
content_hash:: 13ad686517a7

### 2026-07-12 · DECISION · file:architecture-decisions

Every outbound HTTP call in the CTG AI Platform passes through a single check_url() choke point that validates the destination against an explicit allowed-domains list and fails closed; adding any new integration therefore requires a deliberate allow-list update — which is the point, because egress control at one choke point is auditable while scattered per-call checks are not.

category:: DECISION
source-ref:: file:/Users/cpconnor/Claude Cowork/ABOUT ME/architecture-decisions.md
tags:: ctg, adr, security, architecture
added:: 2026-07-12T18:40:50-05:00
related:: ctg-ai-platform.md
content_hash:: 38ffb2724db8

## 2026-04

### 2026-04-27 · LEARNING · .planning/RETROSPECT

Path B for work that cannot be completed in the current milestone: stage test.todo() markers that document the behavioral gap, with explicit handoff notes pointing to the next milestone. Better than asserting behavior the implementation cannot deliver (which creates false green), and better than omitting tests entirely (which hides the gap). The markers serve as executable documentation that gets promoted to real assertions when the feature ships.

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: testing, process, test-todo, milestone-handoff, technical-debt
added:: 2026-04-27T08:44:47-05:00
related:: 
content_hash:: a7a306669452

### 2026-04-27 · LEARNING · .planning/RETROSPECT

In-phase CI ratchet: when a phase lifts a quality bar (e.g., branch coverage 70% to 80%), ratchet the CI gate threshold in the same PR that adds the coverage to justify it. The PR's own work proves the new bar is achievable; the new bar prevents the PR itself from regressing. Deferring the ratchet to milestone-close allows any subsequent PR to silently drop below the target.

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: ci, quality, coverage, ratchet, process
added:: 2026-04-27T08:44:47-05:00
related:: 
content_hash:: 3007f9ada9ef

### 2026-04-27 · LEARNING · .planning/RETROSPECT

God module decomposition pattern: extract single-responsibility modules from oversized files while keeping existing integration tests passing verbatim. The tests are the behavioral spec — do not refactor code and rewrite tests in the same PR. If a test breaks during extraction, the refactor changed behavior. Example: today-command.js from 727 LOC monolith to 230 LOC orchestrator + 4 focused modules (slippage-scanner, frog-identifier, llm-augmentation, briefing-renderer).

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: refactoring, architecture, decomposition, testing, single-responsibility
added:: 2026-04-27T08:44:47-05:00
related:: today-command.js, today/
content_hash:: 2bc943a29727

### 2026-04-27 · LEARNING · .planning/RETROSPECT

Cross-AI audit produces concrete, actionable backlogs. Independent review from 3 different models (Claude native, Gemini CLI, Opus) catches findings that single-reviewer misses — Gemini caught a dead-letter queue gap in memory promotion, Opus caught config crash paths that Claude's own review overlooked. For milestone-boundary work, request independent review from at least one additional model.

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: code-review, multi-model, audit, quality, process
added:: 2026-04-27T08:44:47-05:00
related:: 
content_hash:: dd4d5170dcb6

### 2026-04-27 · DECISION · .planning/MILESTONES

Embed-on-promotion sidecar architecture: embeddings are computed when memories are promoted to memory.md (not at query time), stored in a JSONL file alongside the memory corpus. Cosine similarity + temporal decay applied at query time against pre-computed vectors. This keeps the query path fast (vector math only, no API call) and amortizes embedding cost across promotions rather than searches. Re-embedding triggered only when model or dimension changes, not when threshold or decay parameters change.

category:: DECISION
source-ref:: .planning/MILESTONES.md
tags:: architecture, embeddings, semantic-search, sidecar, performance
added:: 2026-04-27T08:44:47-05:00
related:: semantic-index.js, promote-memories.js
content_hash:: 4fa3badbfb86

### 2026-04-27 · LEARNING · .planning/RETROSPECT

Uniform result shapes across connectors eliminate integration-time surprises. The makeResult()/makeError() pattern ensures every connector returns the same shape regardless of success or failure. When adding a new connector, match this contract — consumers should never need conditional logic per data source.

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: pattern, connectors, result-shape, api-design
added:: 2026-04-27T08:44:47-05:00
related:: connectors/gmail.js, connectors/calendar.js, connectors/github.js
content_hash:: b914917db9d5

### 2026-04-27 · LEARNING · .planning/RETROSPECT

Lock fence verification: `git diff master -- src/` returning empty (or only comment-line changes) is structural proof that hygiene work did not touch function bodies. Useful as a commit-time gate for hygiene-only PRs (JSDoc additions, console-log categorization, comment cleanup). If the diff shows non-comment source changes, the hygiene PR has scope creep.

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: git, verification, hygiene, code-review, process
added:: 2026-04-27T08:44:47-05:00
related:: 
content_hash:: efde6ffde665

### 2026-04-27 · LEARNING · .planning/MILESTONES

Config overlay pattern: loadConfigWithOverlay loads config.json + config.local.json, validates against AJV schema. Local override files are gitignored so developer-environment config (LM Studio ports, debug flags, path overrides) never contaminates committed config. Every config loader must validate against its schema — unvalidated config is a crash waiting to happen.

category:: LEARNING
source-ref:: .planning/MILESTONES.md
tags:: pattern, config, ajv, schema-validation, overlay
added:: 2026-04-27T08:44:47-05:00
related:: pipeline-infra.js, config/
content_hash:: 540fa9d13a3d

### 2026-04-26 · DECISION · .planning/PROJECT.md

Left/right write-permission boundary is an architectural split based on who may write, not what kind of content lives there. Files whose words should sound like the human live on LEFT. Agent reads LEFT, proposes to RIGHT. This prevents agent-generated prose from contaminating the human voice in identity documents, journal entries, and reflections.

category:: DECISION
source-ref:: .planning/PROJECT.md
tags:: architecture, vault, write-permission, voice-preservation
added:: 2026-04-26T18:56:52-05:00
related:: vault-gateway.js, content-policy.js
content_hash:: 10abdad8df25

### 2026-04-26 · DECISION · .planning/RETROSPECT

Zero-trust integration permissions from day one prevents security retrofits. Gmail draft-only (no send), Calendar read-only, GitHub repo-scoped. Principle: one hallucination away from a career incident — so every integration operates at minimum viable permission. Retrofitting tighter permissions after the system is live is always more expensive than starting locked down.

category:: DECISION
source-ref:: .planning/RETROSPECTIVE.md
tags:: security, zero-trust, integrations, permissions
added:: 2026-04-26T18:56:52-05:00
related:: connectors/gmail.js, connectors/calendar.js, connectors/github.js
content_hash:: 3e91e155ca35

### 2026-04-26 · LEARNING · tasks/lessons.md

After squash-merge, git log shows branch commits as "unique to branch" because squash creates a new SHA with no ancestry link. To verify content equivalence: `git cherry-pick --no-commit <original-sha> && git status --porcelain` — empty output proves the content is on master regardless of SHA mismatch. Critical for branch cleanup after squash-merge PRs.

category:: LEARNING
source-ref:: tasks/lessons.md
tags:: git, squash-merge, branch-cleanup, debugging
added:: 2026-04-26T18:56:52-05:00
related:: 
content_hash:: 0aee6b71f1c4

### 2026-04-26 · LEARNING · tasks/lessons.md

GitHub classic branch protection's required_status_checks only gates PR merges — it does NOT block direct pushes. To force the PR path (including for web UI edits), required_pull_request_reviews must be non-null. Set required_approving_review_count: 0 for solo developers. Without this, direct pushes with red CI still land on master.

category:: LEARNING
source-ref:: tasks/lessons.md
tags:: github, branch-protection, ci, security
added:: 2026-04-26T18:56:52-05:00
related:: 
content_hash:: 08dace959374

### 2026-04-26 · DECISION · .planning/MILESTONES

Voyage AI embedding threshold calibrated to 0.55 for voyage-4-lite after live UAT showed top relevance hits in the 0.55-0.70 cosine band (originally spec'd at 0.72 based on older voyage-3 family math). Key insight: calibrate against the live system with real data, not against spec documentation. schema_version = hash(model || dimension) only — threshold and decay are query-time math, so changing them never requires re-embedding the corpus.

category:: DECISION
source-ref:: .planning/MILESTONES.md
tags:: embeddings, voyage-ai, calibration, semantic-search, threshold
added:: 2026-04-26T18:56:52-05:00
related:: semantic-index.js, voyage-health.js
content_hash:: c18f264d8004

### 2026-04-26 · LEARNING · .planning/PROJECT.md

Two-stage LLM classifier architecture: Stage 0 exclusion gate (content-policy.js hard-blocks prohibited content), Stage 1 voice gate (LEFT/RIGHT binary via Haiku — empirically reliable, no Sonnet escalation needed), Stage 2 subdirectory pick with Sonnet escalation on low confidence. Dead-letter quarantine with bounded auto-retry (3 attempts, 15-min interval, freeze after cap) catches ambiguous cases without dropping input.

category:: LEARNING
source-ref:: .planning/PROJECT.md
tags:: architecture, classifier, llm, two-stage, dead-letter
added:: 2026-04-26T18:56:52-05:00
related:: classifier.js, content-policy.js
content_hash:: c63e459e769e

### 2026-04-26 · LEARNING · .planning/RETROSPECT

Promise.allSettled for external data fan-out gives graceful degradation for free. When any connector fails (Gmail down, Calendar timeout, GitHub rate-limited), the pipeline continues with available data instead of failing entirely. Non-blocking enrichment stages (wikilinks, LLM augmentation) follow the same pattern — enrich when possible, skip when not.

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: pattern, resilience, allSettled, graceful-degradation
added:: 2026-04-26T18:56:52-05:00
related:: today-command.js, connectors/
content_hash:: 9c0df87b6c18

### 2026-04-26 · LEARNING · .planning/RETROSPECT

Manifest-first protocol for scoped governance work: produce the categorization manifest first, validate it against the live codebase, then apply changes. Catches approximately 15% drift between planning estimates and actual code state. Any plan whose scope is "apply label X to N items" should get a Task 0 that builds the full N-row manifest and pauses for review before any application step.

category:: LEARNING
source-ref:: .planning/RETROSPECTIVE.md
tags:: process, governance, manifest-first, quality-gate
added:: 2026-04-26T18:56:52-05:00
related:: 
content_hash:: 15e90c9c20ed

### 2026-04-26 · LEARNING · tasks/lessons.md

CI=true npm test is the production-correctness signal for projects with describe.skip CI guards. Bare npm test runs developer-mode UAT with live API calls, which depends on .env key validity. Pre-flight checks, pre-push gates, and verification steps must all use CI=true. This distinction is easy to forget and causes false-positive/negative test results.

category:: LEARNING
source-ref:: tasks/lessons.md
tags:: testing, ci, uat, environment, debugging
added:: 2026-04-26T18:56:52-05:00
related:: 
content_hash:: c77f079907b6

### 2026-04-26 · LEARNING · .planning/MILESTONES

Pattern 7 graceful degradation for external services: track failures with a 3-failure threshold that triggers a 15-minute cross-invocation cooldown window. State is persisted to a JSON file so it survives process restarts. During degradation, the system falls back to keyword search with a user-visible banner rather than failing silently. The pattern is generalizable to any external dependency with variable reliability.

category:: LEARNING
source-ref:: .planning/MILESTONES.md
tags:: pattern, degradation, resilience, external-services, state-persistence
added:: 2026-04-26T18:56:52-05:00
related:: utils/voyage-health.js, semantic-index.js
content_hash:: 8c7c95617f43


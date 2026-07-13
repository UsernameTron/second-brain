# Fable 5 Full-Depth Audit — second-brain

**Date:** 2026-07-12  **Auditor model:** Fable 5 (6-dimension parallel fan-out + adversarial verification)
**Scope:** READ-ONLY. This report proposes diffs; nothing was applied. Audit root: `/Users/cpconnor/projects/second-brain` (main checkout).

---

## 1. Lede

The core runtime is sound: the classifier fallback fails closed, the vault LEFT boundary has no write bypass, and Voyage degraded-mode fails safe to keyword search. Eighteen findings survived adversarial verification — 15 Quick Wins, 3 v1.6 candidates — and three proposed findings were refuted and killed. The single highest-ROI fix is **F-01**: the `/recall --semantic` pre-Voyage excluded-terms gate reads a config key that does not exist, so it blocks nothing and ships every semantic query ungated to the external embedding API.

---

## 2. Findings table

Sorted Impact desc → Effort asc → dimension → file. All 18 confirmed by an independent skeptic; findings with Impact ≥4 or a Quick-Win diff also passed (or failed) a separate diff-applicability lens.

| ID | Dim | File (repo-relative) | Summary | Imp | Eff | Class | Verified |
|----|-----|----------------------|---------|-----|-----|-------|----------|
| F-01 | F | src/semantic-index.js:405 | Pre-Voyage excluded-terms gate reads a nonexistent config key → always empty → blocks nothing | 4 | 1 | Quick Win | Confirmed · diff ✓ |
| B-01 | B | package.json / core.hooksPath | `core.hooksPath`=.git/hooks (only pre-push) → tracked pre-commit + post-merge hooks never fire; pre-push itself untracked | 4 | 2 | Quick Win | Confirmed · diff ✓ |
| E-01 | E | CLAUDE.md:21-33 | Always-loaded Project Status block frozen at 2026-04-26 — 77 days stale | 3 | 1 | Quick Win | Confirmed · diff ✓ |
| A-03 | A | CLAUDE.md:56,87 | MCP integration claim wrong — Gmail/Calendar are claude.ai connectors, not Docker gateway; nothing but context7 is repo-registered | 3 | 2 | Quick Win | Confirmed · diff ✓ |
| B-03 | B | hooks/post-merge-doc-sync.js:141-153 | Runs full `jest --coverage` (1190 tests) on every merge to read 3 doc numbers | 3 | 2 | Quick Win | Confirmed · diff ✓ |
| C-01 | C | CLAUDE.md:45 + missing .claude/commands/reroute.md | `/reroute` documented + implemented but has no slash-command wrapper → unreachable | 3 | 2 | v1.6 Candidate | Confirmed · diff needs 1-line fix |
| E-02 | E | .claude/settings.json:2-37 | No staleness-check hook → an 11-week status freeze can silently recur | 3 | 3 | v1.6 Candidate | Confirmed |
| A-01 | A | .claude/settings.local.json:6,20,25,26 | 4 one-off exact-match allow grants that can never match again (incl. an already-spent chmod) | 2 | 1 | Quick Win | Confirmed · diff ✓ |
| C-05 | C | CLAUDE.md:46 | `/promote-unrouted` documented as "bulk" but acts on a single named file | 2 | 1 | Quick Win | Confirmed · diff ✓ |
| D-01 | D | .claude/skills/config-validator/SKILL.md:22-26 | False WARNING (claims memory-categories.json missing — it exists) + lists 4 of 9 schemas | 2 | 1 | Quick Win | Confirmed · diff ✓ |
| D-02 | D | .claude/skills/config-validator/SKILL.md:3 | Trigger collision with pipeline-health on "after config changes" | 2 | 1 | Quick Win | Confirmed · diff ✓ |
| E-03 | E | CLAUDE.md:33 | Milestone list duplicates the linked MILESTONES.md — volatile content in the always-loaded file | 2 | 1 | Quick Win | Confirmed · diff ✓ |
| C-03 | C | .claude/agents/docs-sync.md:4,26-32 | The only Write-capable agent has a prose-only write boundary (legacy flag F-02) | 2 | 2 | Quick Win | Confirmed · diff ✓ |
| E-04 | E | CLAUDE.md:7,81,126 | Three overlapping "Architecture" headings in the always-loaded file | 2 | 2 | Quick Win | Confirmed · diff ✓ |
| C-04 | C | .claude/agents/docs-sync.md:45-94 | docs-sync Phase-Closure Audit Mode (~50 lines) is wired to no hook/command/CI; only security-scanner has a live trigger | 2 | 3 | v1.6 Candidate | Confirmed |
| C-02 | C | .claude/agent-memory/auditor/ | Empty orphan dir matching no deployed agent; agent memory not accumulating | 1 | 1 | Quick Win | Confirmed · diff ✓ |
| F-03 | F | src/pipeline-infra.js:172-174 | Dead ternary — both branches produce the identical value | 1 | 1 | Quick Win | Confirmed · diff ✓ |
| F-04 | F | src/vault-gateway.js:116 | Unused `const _watcher = null` with a false "kept for cleanup" comment | 1 | 1 | Quick Win | Confirmed · diff ✓ |

**Refuted and killed by adversarial verification (not findings):**

- **A-02** (auto-test-on-every-edit friction) — REFUTED. `auto-test.sh:18-22` already path-scopes with `case "$FILE_PATH" in */src/*.js|src/*.js) ;; *) exit 0 ;; esac`, so markdown/planning edits exit immediately and pay no test tax. The hook wiring is fine.
- **B-02** (lesson-capture-gate.log unbounded growth) — REFUTED. The append-without-rotation pattern is real (`writeDebugLog` in `~/.claude/hooks/lesson-capture-gate.cjs`), but the log is correctly gitignored (`.claude/hooks/*.log`), user-level, and its size is immaterial; the finding's impact rationale was false against the current file.
- **F-02** (orphan daily-stats frontmatter schema) — REFUTED. The schema has a dynamic consumer the finder's literal-name grep could not see: `src/config-validator.js:123` enumerates the schema dir with `fs.readdirSync(schemaDir).filter(f => f.endsWith('.schema.json'))` and is invoked by the pre-commit hook (`hooks/pre-commit` → `pre-commit-schema-validate.js`), which validates `daily-stats.md` frontmatter by filename convention. Three tests depend on it. Deleting the file removes real validation. See §3 F-02 for the deferred type-mismatch note.

---

## 3. Per-finding detail

### F-01 — Semantic excluded-terms gate is dead code (Impact 4, Effort 1)

**Current state.** `semanticSearch` derives `excludedTerms` from `pipelineConfig.excludedTerms`, but neither `config/pipeline.json` nor `pipeline.schema.json` defines an `excludedTerms` key — the terms live in `config/excluded-terms.json`, loaded only by `loadExcludedTerms()`. So `excludedTerms` is always `[]`. `checkContent(query, [])` iterates an empty list, matches nothing, and returns `{decision:'PASS'}` with no Haiku call. The module docstring claims "an excluded-terms gate applied BEFORE any Voyage call," but a `/recall --semantic` query containing a configured excluded term is embedded and sent to the external Voyage API ungated. `vault-gateway.js:437` does this correctly via `config.excludedTerms` populated from `loadExcludedTerms()`; the semantic path does not.

```diff
--- a/src/semantic-index.js
+++ b/src/semantic-index.js
@@ (require block, ~line 19)
-const { safeLoadPipelineConfig } = require('./pipeline-infra');
+const { safeLoadPipelineConfig, loadExcludedTerms } = require('./pipeline-infra');
@@ (inside semanticSearch, line 405)
-  const excludedTerms = (pipelineConfig.excludedTerms || []);
+  const excludedTerms = loadExcludedTerms();
```

**Verification.** Skeptic confirmed against file bytes: `pipeline.json` has 0 occurrences of `excludedTerms` (grep); `loadExcludedTerms()` is used by `vault-gateway.js` and `classifier.js` but NOT `semanticSearch`; `content-policy.js` short-circuits an empty array to `{decision:'PASS'}` with no model call. Docstring lines 7-8 contradict actual behavior. Diff-applicability: ✓ (the import and the single assignment both match current bytes). Confirm `loadExcludedTerms` is exported by `pipeline-infra.js` before applying.

---

### B-01 — Local git hooks never fire; pre-push untracked (Impact 4, Effort 2)

**Current state.** `git config --get core.hooksPath` resolves to `.git/hooks`, which contains only `pre-push`. The tracked `hooks/pre-commit` (schema-validate + vault-boundary) and `hooks/post-merge` (doc-sync) are therefore never invoked — local schema validation, LEFT/RIGHT boundary enforcement, and doc-sync all silently no-op. Two contradictory install mechanisms coexist: `package.json` `prepare` sets `core.hooksPath hooks`, while `hooks/pre-commit:5` documents symlinking into `.git/hooks`. The live config wins, so the tracked hooks die. Meanwhile the `pre-push` staleness guard exists only in `.git/hooks/pre-push` and is not version-controlled (`git ls-files` shows no `pre-push`; `hooks/pre-push` is absent).

```bash
# Consolidate on the tracked hooks/ dir so ONE hooksPath serves every hook.
# 1. Version-control the staleness guard that currently exists only in .git/hooks:
cp .git/hooks/pre-push hooks/pre-push
chmod +x hooks/pre-push
# 2. Point git at the tracked dir (matches package.json prepare intent):
git config core.hooksPath hooks
# 3. Verify all three now resolve from the tracked dir:
ls -l hooks/pre-commit hooks/post-merge hooks/pre-push
# 4. Remove the contradictory symlink note at hooks/pre-commit:5; commit hooks/pre-push.
```

**Verification.** Skeptic confirmed: `core.hooksPath` → `.git/hooks` (only `pre-push`); `package.json` prepare sets `hooks`; `hooks/pre-commit:5` documents the symlink; `pre-push` not tracked; `hooks/pre-push` absent. Live, verified defect. Diff-applicability: ✓. **Sequencing:** apply this first — it re-arms the pre-commit gate that should guard every subsequent code change below. Cross-ref: A-01 drops the now-obsolete `chmod +x .git/hooks/pre-push` allowlist entry.

---

### E-01 — Always-loaded status block is 77 days stale (Impact 3, Effort 1)

**Current state.** `CLAUDE.md` was last modified by commit `8d43665` on 2026-04-26; the status block still claims v1.5.0 is the latest release, Phase 25 is newest, with test/coverage counts from that date. A later docs commit (`b948d79`, 2026-06-11) is not reflected. Project `CLAUDE.md` auto-loads in full every session, so the stale block is injected into context on every boot.

```diff
 ## Project Status

+> Last verified: 2026-04-26  <!-- staleness-check hook (E-02) reads this date -->
+
 **Latest Release:** v1.5.0 Internal Hardening (2026-04-26)
```

Then re-run counts live (`CI=true npm test`) — do not trust the frozen 1190/coverage figures — update the release/phase/test/coverage lines, and bump the marker at each `/gsd:sync-docs`.

**Verification.** Skeptic confirmed all cited lines verbatim; `git log -1 -- CLAUDE.md` = 2026-04-26; newest repo commit 2026-06-11. Diff-applicability: ✓. Pairs with **E-02** (the hook that reads the marker).

---

### A-03 — MCP integration claim is inaccurate (Impact 3, Effort 2)

**Current state.** `CLAUDE.md:56` and the "External integrations" line (`:87`) both claim Gmail/Calendar/GitHub run "via MCP (Docker MCP Gateway)". In reality only GitHub and Obsidian route through the Docker gateway (`mcp__MCP_DOCKER__*`); Gmail (`mcp__claude_ai_Gmail__*`) and Calendar (`mcp__claude_ai_Google_Calendar__*`) are claude.ai connectors — corroborated by the `mcp__claude_ai_Google_Calendar__list_calendars` allow entry in `settings.local.json:7`. `.mcp.json` registers only context7; none of the four integrations are repo-wired.

```diff
- - **Integrations:** Gmail/Calendar/GitHub via MCP (Docker MCP Gateway + Obsidian Local REST API)
+ - **Integrations:** GitHub + Obsidian via Docker MCP Gateway (mcp__MCP_DOCKER__*); Gmail + Calendar via claude.ai connectors (mcp__claude_ai_*). Session/Desktop-connected — only context7 is registered in repo .mcp.json.
```
```diff
- 3. **External integrations:** Gmail, Google Calendar, GitHub via MCP (Docker MCP Gateway running in Claude Desktop)
+ 3. **External integrations:** GitHub + Obsidian via the Docker MCP Gateway (Claude Desktop); Gmail + Calendar via claude.ai connectors. None are registered in repo .mcp.json (context7 only).
```

**Verification.** Skeptic confirmed all quoted evidence matches; namespaces and the corroborating allow entry check out. Diff-applicability: ✓.

---

### B-03 — Full coverage run on every merge (Impact 3, Effort 2)

**Current state.** `getLiveStats()` (lines 141-153) unconditionally runs `execFileSync('npx', ['jest','--coverage','--json',...,'--silent','--forceExit'], {timeout:60000})` on every post-merge invocation, regardless of whether `CLAUDE.md`/`README.md` changed. Currently masked because the hook never fires (B-01), but once `hooksPath` is corrected every `git pull`/`git merge` blocks on the full 1190-test coverage run to validate three documented numbers.

```js
// In main(), before getLiveStats(): skip when no doc file changed in the merge.
const { execFileSync } = require('child_process');
let changed = '';
try {
  changed = execFileSync('git', ['diff', '--name-only', 'ORIG_HEAD', 'HEAD'],
    { cwd: PROJECT_ROOT, encoding: 'utf8' });
} catch (_) { /* no ORIG_HEAD -> fall through and run */ }
if (changed && !/(^|\n)(CLAUDE\.md|README\.md)(\n|$)/.test(changed)) {
  process.stdout.write('[post-merge] No doc files changed — skipping drift check.\n');
  process.exit(0);
}
// ...existing getLiveStats() call follows
```

**Verification.** Skeptic confirmed the `execFileSync` call and per-merge header comment; `main()` calls `getLiveStats()` with no change-detection. Diff-applicability: ✓. **Fix alongside B-01** — B-01 makes this hook live, so land the guard in the same pass.

---

### C-01 — `/reroute` command is unreachable (Impact 3, Effort 2) · v1.6 candidate

**Current state.** `CLAUDE.md:45` lists `/reroute`; `src/reroute.js` implements it (`module.exports = { rerouteFile }`, line 242). But `.claude/commands/reroute.md` does not exist — every other documented command has a wrapper, so `/reroute` cannot be invoked as a slash command. This violates the project's user-invocable-surface rule (a ROADMAP command must ship its command file).

```markdown
<!-- CREATE .claude/commands/reroute.md -->
---
description: Re-classify and re-route a previously routed file through the pipeline. Usage: /reroute <filepath>
---

Run the `/reroute` command to re-invoke the classification pipeline on a previously routed file.

```bash
node -e "
  const { rerouteFile } = require('./src/reroute');
  const filePath = process.argv[1];
  if (!filePath) { process.stderr.write('Usage: /reroute <filepath>\n'); process.exit(1); }
  rerouteFile(filePath).then(r => {
    process.stdout.write(r.rerouted ? ('Rerouted to: ' + r.to + '\n') : ('Failed: ' + (r.reason || 'unknown') + '\n'));
  }).catch(err => { process.stderr.write('reroute failed: ' + err.message + '\n'); process.exit(1); });
" -- $ARGUMENTS
```
```

**Verification.** Skeptic confirmed the finding is accurate (wrapper absent, `CLAUDE.md:45` and impl both present). **Diff-applicability lens FAILED the original diff** and correctly downgraded this from Quick Win to v1.6 candidate: the finder's wrapper printed `r.target`, but `rerouteFile`'s success return is `{rerouted, from, to}` — no `target` key, so it would print "Rerouted to: undefined". **The diff above is corrected to use `r.to`.** Re-verify the return-shape against `src/reroute.js` before shipping.

---

### E-02 — No staleness-check mechanism (Impact 3, Effort 3) · v1.6 candidate

**Current state.** `settings.json` wires only PostToolUse (auto-test) and PreToolUse (protected-file-guard, security-scan) hooks — no SessionStart hook, no date check anywhere. The v1.5 Doc Sync layer compares test/coverage *numbers* against jest output but not the status-block *date*, so a numerically-plausible but months-old block raises no warning. This is the mechanism that would have caught E-01 in April.

```json
// settings.json — add to "hooks":
"SessionStart": [
  { "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/status-staleness-check.sh", "timeout": 10 } ] }
]
```
```bash
#!/bin/bash
# .claude/hooks/status-staleness-check.sh
# ponytail: greps newest ISO date in the status block, warns if > N days old
N=30
MD="$CLAUDE_PROJECT_DIR/CLAUDE.md"
latest=$(sed -n '21,35p' "$MD" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort | tail -1)
[ -z "$latest" ] && exit 0
age=$(( ( $(date +%s) - $(date -j -f '%Y-%m-%d' "$latest" +%s) ) / 86400 ))
[ "$age" -gt "$N" ] && echo "WARNING: CLAUDE.md Project Status block is $age days old (latest $latest). Run /gsd:sync-docs." >&2
exit 0
```

**Verification.** Skeptic confirmed no SessionStart hook and no date logic exists. `date -j -f` is the correct macOS/darwin form. Depends on E-01's `Last verified:` marker being present. Mirror the existing `test/hooks/*.test.sh` pattern with one test.

---

### A-01 — Allowlist carries 4 dead one-off grants (Impact 2, Effort 1)

**Current state.** 23 allow entries mix durable prefix grants (`Bash(node *)`, `Bash(npx jest *)`) with brittle one-offs that can never match a second real command: a long exact python3 diagnostic one-liner (line 6), a hardcoded `awk` invocation (line 20), bare `Bash(cat)` (line 25, matches only the literal string "cat"), and `Bash(chmod +x .git/hooks/pre-push)` (line 26) whose effect is already applied — the hook is already mode 0755.

```json
"allow": [
  "Bash(node *)",
  "Skill(gsd:discuss-phase)",
  "mcp__claude_ai_Google_Calendar__list_calendars",
  "Bash(docker mcp *)",
  "Skill(gsd:review)",
  "Bash(gh api *)",
  "Bash(gh pr *)",
  "Skill(schedule)",
  "Skill(gsd:execute-phase)",
  "Bash(npx jest *)",
  "Skill(gsd:ship)",
  "Skill(gsd:complete-milestone)",
  "Bash(./node_modules/.bin/jest *)",
  "Skill(gsd:health)",
  "Bash(gh run *)",
  "Bash(npx eslint *)",
  "Bash(curl -s --max-time 5 http://localhost:1234/v1/models)",
  "Skill(gsd:finalize)",
  "Skill(gsd:finalize:*)"
]
```
Removed: python3 one-liner (6), `awk` (20), `Bash(cat)` (25), `Bash(chmod ...)` (26). Route file reads through the Read tool, not an allowlisted `cat`.

**Verification.** Skeptic confirmed all four entries match exactly and the pre-push hook is already `-rwxr-xr-x` (chmod grant spent). Diff-applicability: ✓. Cross-ref B-01 (the chmod entry becomes moot once `hooks/pre-push` is tracked).

---

### C-05 — `/promote-unrouted` mislabeled as bulk (Impact 2, Effort 1)

**Current state.** `CLAUDE.md:46` says "Bulk-promote unrouted items from staging," but the command frontmatter and wrapper take one filename (`promote-unrouted.md:2` usage `/promote-unrouted <filename> --target <path>`; wrapper reads `const filename = args[0]` and errors if absent). Single-file, not bulk.

```diff
- | `/promote-unrouted` | Bulk-promote unrouted items from staging |
+ | `/promote-unrouted` | Re-route a single unrouted dead-letter file to a target vault path |
```

**Verification.** Skeptic confirmed the description mismatch verbatim. Diff-applicability: ✓.

---

### D-01 — config-validator SKILL.md false WARNING + incomplete schema list (Impact 2, Effort 1)

**Current state.** `SKILL.md:24` states `memory-categories.schema.json → config/memory-categories.json (WARNING: file does not exist)`, but that config exists (3127 bytes). The block lists 4 schemas; `config/schema/` holds 9. `daily-stats-frontmatter` is the only schema with no config file, so the skill's dynamic discovery would WARN there, not on memory-categories.

```markdown
Current schemas:
- connectors.schema.json -> config/connectors.json
- daily-stats-frontmatter.schema.json -> (no config file; reports WARNING — validates daily-stats.md frontmatter via the pre-commit hook, see F-02)
- docsync.schema.json -> config/docsync.json
- excluded-terms.schema.json -> config/excluded-terms.json
- memory-categories.schema.json -> config/memory-categories.json
- pipeline.schema.json -> config/pipeline.json
- scheduling.schema.json -> config/scheduling.json
- templates.schema.json -> config/templates.json
- vault-paths.schema.json -> config/vault-paths.json
```

**Verification.** Skeptic confirmed the false WARNING and 4-of-9 undercount. Diff-applicability: ✓. Cross-ref F-02 (REFUTED — the schema stays, so the list stays at 9).

---

### D-02 — config-validator / pipeline-health trigger collision (Impact 2, Effort 1)

**Current state.** Both SKILL descriptions auto-trigger on "after config changes" (`config-validator/SKILL.md:3`, `pipeline-health/SKILL.md:3`). pipeline-health already runs config-validator as its Check 1 (`node src/config-validator.js`, line 17), so the broad probe subsumes the narrow one and the shared phrase makes invocation ambiguous.

```diff
# pipeline-health/SKILL.md line 3
- Use when diagnosing pipeline issues, after config changes, or for routine health checks.
+ Use when diagnosing pipeline or connector issues, checking vault/scheduler reachability, or for routine end-to-end health checks.
```
Leaves config-validator as the sole owner of the "after config changes" trigger.

**Verification.** Skeptic confirmed both descriptions verbatim and the subsumption at line 17. Diff-applicability: ✓.

---

### E-03 — Milestone list duplicates MILESTONES.md (Impact 2, Effort 1)

**Current state.** `CLAUDE.md:33` enumerates all six shipped milestones inline in the always-loaded file; line 35 already links to `.planning/MILESTONES.md` "for detailed release history," which contains all six. Redundant on-load context and a second sync point for the most volatile content.

```diff
-- **Milestones shipped:** v1.0 MVP (2026-04-22), v1.1 Go Live (2026-04-23), v1.2 Automation & Quality (2026-04-23), v1.3 Review Remediation (2026-04-24), v1.4 Closeout Hygiene (2026-04-25), v1.5 Internal Hardening (2026-04-26)
-
 For detailed release history, see [.planning/MILESTONES.md](.planning/MILESTONES.md).
```

**Verification.** Skeptic confirmed line 33, line 35, and 6 "Shipped:" entries in MILESTONES.md. Diff-applicability: ✓.

---

### F-02 — Orphan daily-stats frontmatter schema — REFUTED (not a finding)

**Refuted.** The "orphan" premise is false. `config/schema/daily-stats-frontmatter.schema.json` has a **dynamic consumer**: `src/config-validator.js:123` discovers schemas by directory scan —

```js
schemaFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith('.schema.json'));
```

— and is invoked by the pre-commit hook (`hooks/pre-commit` → `pre-commit-schema-validate.js`), which matches `daily-stats.md` frontmatter to this schema by filename convention. Three tests depend on it. The finder's zero-references result came from a literal-name grep, which cannot see a `readdir`-by-extension scan. **Do not `git rm` it** — deleting it breaks those tests and removes live validation.

**Deferred hygiene item (not v1.6 action).** The type mismatch is real but harmless: the schema requires `schema_version` as type `string` while `daily-stats.js:192/241` writes it as an integer (`config.stats.schemaVersion || 1`). Nothing currently validates the written `.md` frontmatter against the schema, so the mismatch is latent. If frontmatter validation is ever wired into `readDailyStats`, change `schema_version` to integer first.

**Verification.** The type contradiction is confirmed; the orphan verdict is not. Cross-ref D-01: the config-validator schema list stays at 9 with `daily-stats-frontmatter` included.

---

### C-03 — docs-sync write boundary is prose-only (Impact 2, Effort 2)

**Current state.** `docs-sync.md:4` grants `tools: Read, Write, Edit, Glob, Grep, Bash` — the only agent carrying Write. Its boundary lives only in prose ("surgical edits only", "Do not touch .planning/ files") with no declared path guard. Tracked as legacy flag F-02 in `tasks/todo.md:10` and `.planning/backlog.md:49`, both marked cosmetic/accepted.

```markdown
## Scope Guard

WRITE-ALLOWED (only these paths): README.md, CLAUDE.md, docs/DEVOPS-HANDOFF.md
WRITE-FORBIDDEN: .planning/**, src/**, test/**, config/**, ABOUT ME/** (LEFT vault), any file not in the allowed list.
If a needed edit falls outside WRITE-ALLOWED, STOP and report instead of editing.
```

**Verification.** Skeptic confirmed the tool grant and prose-only boundary (minor note: test-runner also has Edit, but docs-sync is the only one with Write). Diff-applicability: ✓. Dimension-F re-verdict of legacy F-02: acceptable as-is, but this hardening is cheap — treat as optional.

---

### E-04 — Three overlapping Architecture headings (Impact 2, Effort 2)

**Current state.** `CLAUDE.md` carries a short "Architecture" section (line 7, vault structure), a detailed "Architecture & Infrastructure" (line 81, integrations/files/agents), and a third "Architecture" (line 126, high-level flow) that itself links to the authoritative PROJECT.md. The line-126 block restates the LEFT/RIGHT split and classifier flow already covered by line 81 and PROJECT.md.

```diff
 ## Architecture

-See detailed architecture in [.planning/PROJECT.md](.planning/PROJECT.md) and release history in [.planning/MILESTONES.md](.planning/MILESTONES.md).
-
-**High-level:** Two-stage LLM classifier routes user input to LEFT (identity/reference) or RIGHT (active work) vault locations. Daily `/today` command aggregates slippage items, calendar events, Gmail subjects, and GitHub activity into a morning briefing. Session `/wrap` extracts memories for compounding knowledge base. All writes enforce LEFT/RIGHT permission boundary.
+See detailed architecture in [.planning/PROJECT.md](.planning/PROJECT.md); the "Architecture & Infrastructure" section above is the inline reference.
```

**Verification.** Skeptic confirmed three headings at lines 7/81/126 and the redundancy; note the line-126 block is a GSD-autogenerated region (source:PROJECT.md), so re-check it isn't overwritten by `/gsd:sync-docs` after editing. Diff-applicability: ✓.

---

### C-04 — docs-sync Phase-Closure Audit Mode is wired to nothing (Impact 2, Effort 3) · v1.6 candidate

**Current state.** A repo-wide scan for agent invocation finds exactly one live trigger: `.claude/hooks/security-scan-gate.sh:37` (`claude --agent security-scanner`). No CI workflow references any agent. docs-sync's DOCSYNC-CHECK/DOCSYNC-AUDIT mode (lines 45-94, ~50 lines) is referenced only under `.planning/` — no hook, command, or CI invokes it, so half the agent file never auto-runs. (A standalone `hooks/post-merge-doc-sync.js` reimplements the same drift logic in pure JS but is itself unwired — see B-01.) Overlap concerns were refuted: test-runner fixes vs test-verifier reports-only; pipeline-reviewer/security-scanner/vault-guardian scopes are disjoint.

```text
Option 1 (deliver the built-but-idle capability): add a phase-closure / pre-push hook that runs
  `claude --agent docs-sync --print "DOCSYNC-CHECK"` and blocks on `DOCSYNC-AUDIT: BLOCK`,
  mirroring security-scan-gate.sh:37.
Option 2 (if manual-only is intended): add one line near docs-sync.md:45 —
  "Invoke manually — no automated trigger wires this mode." so the gap is explicit.
```

**Verification.** Skeptic confirmed the sole live trigger and the dead audit surface, and verified the overlap-refutation quotes. This is a v1.6 candidate because "wire it" involves a hook design decision (which lifecycle event, block semantics) that overlaps B-01's hook consolidation.

---

### C-02 — Empty orphan agent-memory dir (Impact 1, Effort 1)

**Current state.** `ls -R .claude/agent-memory/` shows one empty `auditor/` directory; `git ls-files` returns 0 tracked files. None of the six deployed agents is named "auditor" (it's a leftover from the mcp-ecosystem auditor subagent). Nothing reads or writes it.

```bash
rm -rf /Users/cpconnor/projects/second-brain/.claude/agent-memory
```
If per-agent memory is actually wanted, seed dirs matching real agents (e.g. `docs-sync/`, `security-scanner/`) and wire an agent to append to them — do not keep an empty orphan.

**Verification.** Skeptic confirmed empty dir, 0 tracked files, no matching agent. Diff-applicability: ✓.

---

### F-03 — Dead ternary in classifyAnthropic (Impact 1, Effort 1)

**Current state.** `pipeline-infra.js:172-174` branches on `typeof userContent === 'string'` but both branches evaluate to the identical `[{ role: 'user', content: userContent }]` — inert, and misleads a reader into thinking string vs non-string is handled differently.

```diff
--- a/src/pipeline-infra.js
+++ b/src/pipeline-infra.js
@@ lines 172-174
-      const messages = typeof userContent === 'string'
-        ? [{ role: 'user', content: userContent }]
-        : [{ role: 'user', content: userContent }];
+      const messages = [{ role: 'user', content: userContent }];
```

**Verification.** Skeptic confirmed both branches are identical at lines 172-174. Diff-applicability: ✓.

---

### F-04 — Unused `_watcher` const in vault-gateway (Impact 1, Effort 1)

**Current state.** `vault-gateway.js:116` declares `const _watcher = null;` with a comment claiming it is "kept for cleanup in tests," but the real tracker is the `_watchers` array at line 232 (pushed at 238). `_watcher` (singular) appears only at line 116 — never read or reassigned. Dead declaration, false comment.

```diff
--- a/src/vault-gateway.js
+++ b/src/vault-gateway.js
@@ lines 115-116
-/** Active chokidar watcher instance (kept for cleanup in tests) */
-const _watcher = null;
-
```

**Verification.** Skeptic confirmed `_watcher` appears only at line 116; `_watchers` (plural) is the functioning tracker. Diff-applicability: ✓.

---

### Verified healthy — no action needed

The adversarial pass confirmed these are sound; call them off the worry list:

- **auto-test.sh** already path-scopes to `src/*.js` (A-02 refuted) — markdown/planning edits pay no test tax.
- **security-scan-gate.sh** on every Bash is defensible (Bash is the dangerous-command vector) — kept.
- **pipeline-infra.js LLM fallback fails closed** — falls back to Anthropic only on network/timeout; returns `{success:false}` on parse/unexpected errors.
- **content-policy.checkContent fails closed** (BLOCK) when Haiku is unavailable.
- **vault-gateway LEFT boundary has no write bypass** — `vaultWrite`/`vaultWriteAtomic` route through `checkPath` against `config.right` only; `normalizePath` rejects absolute paths and `..`; symlink escape defended via `realpathSync`.
- **semantic-index Pattern 7 tracker fails safe** — degraded window → keyword fallback, atomic tmp+rename write; a concurrent race can only lose a failure count, not corrupt state.
- **ci.yml gates coverage** — `--coverageThreshold='{"global":{"branches":80,"functions":90,"lines":90,"statements":90}}'`.
- **uat.yml correctly skips in normal CI** (runs only on workflow_dispatch/schedule).
- **claude.yml and claude-code-review.yml have disjoint triggers** — complementary, not redundant.
- **Schema validation IS mirrored in CI** (`test/config-schemas.test.js`, `test/validate-schema.test.js` under `npm test`), so a web-UI commit that breaks a validated config fails CI. (Note: only vault-paths/pipeline/templates/memory-categories get explicit schema tests; connectors/docsync/scheduling/excluded-terms rely on loader-level tests — a coverage gap, not a defect.)
- **lesson-capture-gate.log is gitignored** (`.claude/hooks/*.log`) — B-02 refuted.

### Watch list — legacy flags re-verdicted

- **Legacy F-01 (chokidar pinned `^3.6.0`):** KEEP pinned to v3. chokidar is already optional in `vault-gateway.js` (`chokidar.watch(configPath,{ignoreInitial:true})` with a try/catch fallback to `fs.watchFile`); v4 is a major bump (drops glob, changes deps) with no functional need here and would require full test re-validation + dependency approval. Do NOT promote.
- **Legacy F-02 (docs-sync scope_guard):** No artifact named `scope_guard` exists; the boundary is prose. Acceptable as-is; the cheap hardening is C-03 above if you want it.

---

## 4. Quick Wins — paste-ready, dependency order

Run from repo root `/Users/cpconnor/projects/second-brain`. B-01 goes first so the pre-commit gate is live for every subsequent code change. Markdown/JS content edits reference their §3 diff (apply, then run the verify command); pure shell ops are given as commands.

```bash
# ── B-01: re-arm local git hooks (do this first) ──────────────────────────────
cp .git/hooks/pre-push hooks/pre-push && chmod +x hooks/pre-push
git config core.hooksPath hooks
ls -l hooks/pre-commit hooks/post-merge hooks/pre-push          # verify all three resolve
# then remove the stale symlink note at hooks/pre-commit:5 (apply §3 B-01)

# ── F-01: restore the semantic excluded-terms gate (highest ROI) ──────────────
grep -n "loadExcludedTerms" src/pipeline-infra.js                # confirm it is exported first
# apply §3 F-01 diff (add import + swap the line-405 assignment), then:
node -e "const s=require('./src/semantic-index'); console.log('loads ok')"

# ── F-03, F-04, B-03: code/JS cleanups (now gated by the live pre-commit) ─────
# apply §3 F-03 (dead ternary), §3 F-04 (unused const), §3 B-03 (post-merge guard), then:
npx eslint src/pipeline-infra.js src/vault-gateway.js hooks/post-merge-doc-sync.js
CI=true npx jest --forceExit                                     # full suite still green

# ── CLAUDE.md doc edits — E-01, A-03, C-05, E-03, E-04 (same file; apply in one pass) ─
# apply §3 E-01 (status marker + refresh), A-03 (MCP claims x2), C-05 (promote-unrouted label),
#           E-03 (drop milestone list), E-04 (collapse 3rd Architecture block)
CI=true npm test >/dev/null 2>&1 && echo "re-count 'test/coverage' figures for E-01 from this run"

# ── D-01, D-02: skill hygiene (D-01 lists all 9 schemas; F-02 refuted, none deleted) ──
# apply §3 D-01 (config-validator schema list) and §3 D-02 (pipeline-health trigger)

# ── C-03: docs-sync scope guard (optional hardening) ──────────────────────────
# apply §3 C-03 (add Scope Guard block to .claude/agents/docs-sync.md)

# ── C-02: remove empty orphan agent-memory dir ────────────────────────────────
rm -rf .claude/agent-memory

# ── A-01: prune the allowlist (last — B-01 made the chmod entry obsolete) ──────
# apply §3 A-01 (replace the allow array in .claude/settings.local.json)
```

Not in this block (require a design decision — see §5): **C-01** (needs the corrected `r.to` wrapper re-verified), **E-02** (SessionStart hook), **C-04** (which lifecycle event wires the docs-sync audit).

---

## 5. v1.6 candidate block — paste into `/gsd:new-milestone`

```
## Milestone: v1.6 — Enforcement Integrity & Surface Completion

Goal: Close the gap between what the repo declares and what it actually enforces. v1.5
shipped the hooks, agents, and gates; this milestone makes them fire, keeps context honest,
and completes the user-invocable command surface. Anchored by restoring the two silent
enforcement failures (local git hooks, semantic content gate) surfaced in the 2026-07-12 audit.

### Phase 1 — Local Enforcement Restoration
- REQ-ENF-01: Consolidate git hooks on the tracked `hooks/` dir; version-control `pre-push`;
  pre-commit (schema-validate + vault-boundary) and post-merge (doc-sync) must fire locally. [B-01]
- REQ-ENF-02: Guard post-merge doc-sync to skip the full coverage run unless CLAUDE.md/README.md
  changed in the merge. [B-03]
- REQ-ENF-03: Restore the `/recall --semantic` pre-Voyage excluded-terms gate (reads
  loadExcludedTerms(), not the nonexistent pipeline config key). [F-01]

### Phase 2 — Context Economy & Staleness Guard
- REQ-CTX-01: Add a SessionStart staleness-check hook that warns when the CLAUDE.md status
  block date exceeds N days; add a machine-readable "Last verified:" marker. [E-02, E-01]
- REQ-CTX-02: De-volatilize CLAUDE.md — drop the inline milestone list, collapse the redundant
  Architecture block, correct the MCP integration claims. [E-03, E-04, A-03]

### Phase 3 — Command & Agent Surface Completion
- REQ-SURF-01: Ship the `/reroute` slash-command wrapper (return shape uses `r.to`); verify
  end-to-end against src/reroute.js. [C-01]
- REQ-SURF-02: Wire docs-sync Phase-Closure Audit Mode to a real trigger (phase-closure or
  pre-push hook), or explicitly document it as manual-only. [C-04]
- REQ-SURF-03: Add an explicit Scope Guard to the docs-sync agent (only Write-capable agent). [C-03]

### Deferred / watch (no action)
- chokidar stays pinned to v3 (already optional via fs.watchFile fallback; v4 is an unneeded
  major bump requiring dependency approval).
- Config schema-test coverage gap: connectors/docsync/scheduling/excluded-terms lack explicit
  schema tests — candidate for a later hygiene pass, not a v1.6 blocker.

### Quick Wins (apply before/independent of phases — see audit §4)
A-01, C-02, C-05, D-01, D-02, F-03, F-04 — all Effort 1, no design decisions.
```

---

## Footer — run metadata

- **Dimensions completed:** 6 of 6 (A–F), 0 errors, 0 silent dimensions.
- **Agents:** 44 total = 6 finders + 21 skeptics + 17 diff-applicability checks. ~4.3M tokens.
- **Findings:** 21 proposed → 3 refuted (A-02 auto-test friction; B-02 log rotation — both by adversarial verification. F-02 orphan schema — refuted post-audit on 2026-07-12: literal-name grep missed the `readdir`-by-extension consumer at `src/config-validator.js:123`) → **18 confirmed**. Classification: 15 Quick Wins, 3 v1.6 candidates.
- **Diff-applicability lens:** 17 run; 1 caught buggy (C-01 `r.target`→`r.to`), correctly downgraded Quick Win → v1.6 candidate.
- **Highest-ROI:** F-01 (one-line fix, restores a security gate).
- **Content-exclusion attestation:** no excluded-entity content surfaced; configured excluded terms referenced only as the abstract list the gate is meant to guard.
- **Method:** every finding cites exact file + line with quoted evidence, confirmed by an independent skeptic reading current file bytes. This report proposes diffs only — nothing was applied.

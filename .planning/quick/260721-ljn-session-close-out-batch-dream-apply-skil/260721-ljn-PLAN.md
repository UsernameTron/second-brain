---
phase: quick-260721-ljn
quick_id: 260721-ljn
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
branch: chore/session-close-out-260721
requirements: [CLOSE-01, CLOSE-02, CLOSE-03, CLOSE-04, CLOSE-05]
# CLOSE-01 SKILL doc gate fix | CLOSE-02 memory-wiki graph refresh
# CLOSE-03 dream plist Sonnet pin | CLOSE-04 apply changeset remainder
# CLOSE-05 phase-34 branch cleanup
files_modified:
  - .claude/skills/dream-apply/SKILL.md
  - scripts/dream.js
  - src/pipeline-infra.js
  - config/com.secondbrain.dream.plist
  - test/pipeline-infra.test.js
# Vault side effects (OUTSIDE repo, no git commit): ~/Claude Cowork/memory/memory.md,
# ~/Claude Cowork/proposals/dream-changeset-2026-07.md. Gitignored: state/dream-ledger.json.

must_haves:
  truths:
    - "SKILL.md (+ scripts/dream.js docstring) describe the post-apply gate as the live-vault hybrid-search retrievability check, not npm run eval:recall"
    - "The scheduled dream-propose launchd job authors via Anthropic Sonnet (LLM_PROVIDER=anthropic), while interactive classifier runs still use the local overlay"
    - "dream-changeset-2026-07.md is fully resolved: 12/15 applied::, 3 human-rejected, 0 accepted ops pending — `dream --apply` is a confirming no-op (applied: 0)"
    - "The live memory.md wiki graph (related:: + INDEX:AUTO) is regenerated over current memory.md; related coverage >= 80%"
    - "Local branch feat/phase-34-promotion-integrity no longer exists"
    - "npm test and npm run lint both pass"
  artifacts:
    - path: ".claude/skills/dream-apply/SKILL.md"
      provides: "Gate description matching src/dream.js live-vault retrievability check"
      contains: "hybrid"
    - path: "src/pipeline-infra.js"
      provides: "LLM_PROVIDER=anthropic override in createLlmClient useLocal guard"
      contains: "LLM_PROVIDER"
    - path: "config/com.secondbrain.dream.plist"
      provides: "EnvironmentVariables entry LLM_PROVIDER=anthropic"
      contains: "LLM_PROVIDER"
    - path: "test/pipeline-infra.test.js"
      provides: "Test asserting LLM_PROVIDER=anthropic overrides provider:local"
      contains: "LLM_PROVIDER"
    - path: "~/Claude Cowork/proposals/dream-changeset-2026-07.md"
      provides: "(vault) fully resolved: 12/15 applied::, 3 rejected"
      contains: "applied::"
    - path: "~/Claude Cowork/memory/memory.md"
      provides: "(vault) 3 merged entries with related:: + INDEX:AUTO"
      contains: "related::"
  key_links:
    - from: "config/com.secondbrain.dream.plist"
      to: "src/pipeline-infra.js createLlmClient"
      via: "LLM_PROVIDER env var"
      pattern: "process\\.env\\.LLM_PROVIDER"
      note: "The plist env KEY must byte-match the code's process.env check. A name mismatch makes the Sonnet pin a SILENT no-op."
    - from: "scripts/dream.js --apply"
      to: "~/Claude Cowork/memory/memory.md"
      via: "applyOps() (MERGE inserts + supersedes)"
    - from: "scripts/migrate-memory-wiki.js --apply"
      to: "~/Claude Cowork/memory/memory.md related:: graph"
      via: "regenerateAutoIndex + build-index over current memory.md"
---

<objective>
Land the 2026-07-21 session close-out batch: five verified items across repo docs/code, live-vault mutations, and git hygiene.

Purpose: Ship the tail of Phase 34 — doc/code drift corrected, the scheduled dream job pinned to Anthropic Sonnet, the changeset confirmed fully resolved (12 applied + 3 human-rejected; nothing pending), the wiki graph refreshed, and the merged feature branch deleted.
Output: 1 repo commit (items 1 + 3), a dream --apply no-op confirmation + wiki-graph regeneration in the live vault (items 4 + 2, no repo commit), a deleted local branch (item 5), and a green full suite + lint.

Environment: single executor, working directly on branch `chore/session-close-out-260721` in the MAIN working tree (repo root `/Users/cpconnor/projects/second-brain`). Live vault = `/Users/cpconnor/Claude Cowork` (scripts default VAULT_ROOT there — do NOT override it).
</objective>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Exact contracts the executor edits. Use these directly — no exploration needed. -->

src/pipeline-infra.js:158-159 (provider resolution — the ONLY switch):
```javascript
const llmConfig = pipelineConfig_ && pipelineConfig_.classifier && pipelineConfig_.classifier.llm;
const useLocal = llmConfig && llmConfig.provider === 'local';
```
`createSonnetClient()` -> `createLlmClient({model:'claude-sonnet-4-5'})` reads this. `provider:local` comes ONLY from the gitignored `config/pipeline.local.json` overlay; committed `config/pipeline.json` defaults `provider:"anthropic"`. There is NO existing env override.

config/com.secondbrain.dream.plist:15-21 (EnvironmentVariables dict — add LLM_PROVIDER here):
```xml
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>VAULT_ROOT</key>
    <string>/Users/cpconnor/Claude Cowork</string>
  </dict>
```
The scheduled job runs `node scripts/dream.js --propose`; scripts/dream.js:38-39 loads repo `.env`, so `ANTHROPIC_API_KEY` is already available at runtime. DO NOT put any API key in the committed plist (GitGuardian/pre-commit).

src/dream.js:867-897 (the live-vault gate SKILL.md must now describe):
`_assertMergedEntriesRetrievable` — every merged entry must still be retrievable from the mutated LIVE vault via `hybridSearch`; blocked/degraded retrieval FAILS CLOSED; a miss = regression -> `runEvalGate` auto-restores the snapshot and reverts ops to unresolved. Comment at :874-876 states this "replaces the old `npm run eval:recall` gate."
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Repo edits — dream-apply gate doc fix (item 1) + scheduled Sonnet pin (item 3)</name>
  <files>.claude/skills/dream-apply/SKILL.md, scripts/dream.js, src/pipeline-infra.js, config/com.secondbrain.dream.plist, test/pipeline-infra.test.js</files>
  <behavior>
    - Test (extend test/pipeline-infra.test.js, reuse the existing mockPipelineConfig harness near line 591): with pipeline config `provider:'local'` AND `process.env.LLM_PROVIDER='anthropic'`, `createHaikuClient()` (NOT createLlmClient — it is internal, unexported) must route to Anthropic — mirror the existing provider:'anthropic' test at ~line 654: `expect(global.fetch).not.toHaveBeenCalled()`. Restore/delete the env var in afterEach so it does not leak to other tests.
    - Existing tests (provider:'local' -> local endpoint at ~line 601; provider:'anthropic' at ~line 655) must still pass unchanged.
  </behavior>
  <action>
    ITEM 3 (Sonnet pin — do the code + test first so RED->GREEN is clean):
    1. src/pipeline-infra.js line 159: add a process-scoped env override so unattended runs pin to Anthropic without disturbing the machine-local overlay. Replace:
         `const useLocal = llmConfig && llmConfig.provider === 'local';`
       with:
         ```javascript
         // Scheduled/unattended runs (the launchd dream-propose job) pin to Anthropic via
         // LLM_PROVIDER=anthropic, overriding the machine-local provider:local overlay that
         // interactive classifier runs use. Process-scoped — interactive sessions are unaffected.
         const useLocal = process.env.LLM_PROVIDER !== 'anthropic'
           && llmConfig && llmConfig.provider === 'local';
         ```
       Use the env KEY `LLM_PROVIDER` EXACTLY — it must byte-match the plist key below (key_link: a mismatch is a silent no-op).
    2. config/com.secondbrain.dream.plist: inside the EnvironmentVariables <dict> (after the VAULT_ROOT string, before the closing </dict>), add:
         ```xml
         <key>LLM_PROVIDER</key>
         <string>anthropic</string>
         ```
       Do NOT add any API key. (Plist is XML, not config/*.json — the pre-commit AJV hook does not touch it. No config/*.json is edited by this task, so no schema concern arises.)
    3. Reload the launchd agent IF installed: if `~/Library/LaunchAgents/com.secondbrain.dream.plist` exists, copy the updated file there and reload so the env change is live:
         `cp config/com.secondbrain.dream.plist ~/Library/LaunchAgents/com.secondbrain.dream.plist`
         `launchctl bootout gui/$(id -u)/com.secondbrain.dream 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.secondbrain.dream.plist`
       If it is NOT installed, do nothing (committed plist is source-only per config/scheduling.json; install is manual). RunAtLoad is false + monthly Day-1 schedule, so a reload will not trigger an immediate run.
    4. Add the test described in <behavior> to test/pipeline-infra.test.js.

    ITEM 1 (doc fix — the gate is a live-vault retrievability check now, NOT eval:recall):
    5. .claude/skills/dream-apply/SKILL.md — rewrite the gate description in THREE places to match src/dream.js:867-897:
       - Line ~11 (frontmatter `description`): the "then gates on npm run eval:recall — a recall regression auto-restores..." clause.
       - Line ~44 (step 5 "Mandatory gate:"): the "`npm run eval:recall`. A recall regression (exit 1) auto-restores..." sentence.
       - Line ~60 (SCHEDULE, "backstopped by the eval-gate auto-restore"): update the "eval-gate" wording if it now reads wrong.
       New phrasing (adapt, keep Smart-Brevity tone): the apply gates on a LIVE-VAULT retrievability check — every merged entry must still be retrievable from the mutated vault via hybrid search; a regression (or blocked/degraded retrieval, which FAILS CLOSED) auto-restores the snapshot byte-for-byte and reverts the applied ops to unresolved; a clean pass stamps each op `applied::` and updates state/dream-ledger.json. Keep the `node scripts/dream.js --apply` / `npm run dream:apply` command names as-is.
    6. scripts/dream.js — SAME stale drift in FOUR comment sites: docstring lines ~17 and ~24, `runApply` docstring ~line 129, and inline comment ~line 168. All describe the --apply gate as "mandatory `npm run eval:recall` gate". Update all four to the live-vault retrievability gate wording. Comment-only, no logic change.
    7. Bounded sweep to confirm no other in-repo `--apply` gate reference is stale:
         `grep -rn "eval:recall" .claude/skills/dream-apply/ scripts/dream.js`
       Fix any remaining hit that describes the APPLY gate. DO NOT touch eval:recall in README.md, CLAUDE.md, package.json, or scripts/eval-recall.js — those are the separate, correct Phase-32 retrieval-eval harness.

    Then commit (single commit for this task):
      `git add .claude/skills/dream-apply/SKILL.md scripts/dream.js src/pipeline-infra.js config/com.secondbrain.dream.plist test/pipeline-infra.test.js`
      commit message: `chore(close-out): fix dream-apply gate docs + pin scheduled dream to Anthropic`
    (state/dream-ledger.json and vault files are NOT part of this commit.)
  </action>
  <verify>
    <automated>cd /Users/cpconnor/projects/second-brain && npx jest test/pipeline-infra.test.js && npm run lint && ! grep -q "eval:recall" .claude/skills/dream-apply/SKILL.md && ! grep -q "eval:recall" scripts/dream.js && grep -q "LLM_PROVIDER" src/pipeline-infra.js && grep -q "LLM_PROVIDER" config/com.secondbrain.dream.plist && echo GATE_OK</automated>
  </verify>
  <done>
    pipeline-infra tests pass (including the new LLM_PROVIDER override test); lint clean; SKILL.md no longer describes the --apply gate as eval:recall (grep returns nothing in that file); LLM_PROVIDER present in both src/pipeline-infra.js and the plist; if the plist was installed, launchctl shows com.secondbrain.dream reloaded; one commit made covering the five repo files.
  </done>
</task>

<task type="auto">
  <name>Task 2: Live-vault ops — confirm changeset resolved (item 4) + refresh wiki graph (item 2)</name>
  <files>~/Claude Cowork/proposals/dream-changeset-2026-07.md (read-only), ~/Claude Cowork/memory/memory.md, state/dream-ledger.json (gitignored)</files>
  <action>
    Run BOTH from the repo root `/Users/cpconnor/projects/second-brain` WITHOUT setting VAULT_ROOT (scripts default to the live vault ~/Claude Cowork).

    ITEM 4 — CORRECTED PREMISE (plan-check finding): the changeset is already FULLY RESOLVED — 12/15 ops accepted+applied, the remaining 3 (dream-2026-07-21-004, -009, -015) are human-REJECTED (`- [x] reject`). There is nothing to apply. Do NOT flip any checkbox — that would override a deliberate human review decision.
    1. `node scripts/dream.js --apply` — run as a CONFIRMING NO-OP only.
       - Expected output: `applied: 0`, reason "no accepted, not-yet-applied ops in the changeset" (src/dream.js:161-164), exit 0, no snapshot restore, no stamps added.
       - If it applies anything nonzero, STOP and report — that contradicts the verified changeset state.

    ITEM 2 — refresh the memory-wiki graph over current memory.md (independent of item 4's no-op):
    2. `node scripts/migrate-memory-wiki.js --apply`
       - This is the documented re-run entry point for the wiki graph: Phase A (coercion-note recategorization) is a no-op now (0 remain); Phase B backfills `related::` (up to 5 wikilinks per entry via Voyage cosine over already-stored vectors + vault-note wikilinks), then rewrites the embeddings sidecar, regenerates the `<!-- INDEX:AUTO -->` block, and rebuilds the SQLite index. It snapshots memory.md + embeddings to memory/.snapshots/wiki-<YYYYMMDD>/ first, so re-running is safe.
       - `related::` backfill is non-blocking by design; the script prints a related-coverage %. Coverage below 80% only warns — capture the number.

    No git commit in this task: the changeset and memory.md live in the vault (outside the repo); state/dream-ledger.json is gitignored.
  </action>
  <verify>
    <automated>cd /Users/cpconnor/projects/second-brain && V="$HOME/Claude Cowork" && test "$(grep -c '^applied:: ' "$V/proposals/dream-changeset-2026-07.md")" = "12" && test "$(grep -c '^- \[x\] reject' "$V/proposals/dream-changeset-2026-07.md")" = "3" && grep -q '<!-- INDEX:AUTO -->' "$V/memory/memory.md" && echo "related-coverage:" && awk '/^related:: +[^ ]/{n++} /^### /{t++} END{print n"/"t}' "$V/memory/memory.md" && echo VAULT_OK</automated>
  </verify>
  <done>
    dream --apply confirmed the resolved state as a no-op (applied: 0, exit 0, still exactly 12 `applied::` stamps + 3 rejects, no checkbox flipped, no restore); migrate-memory-wiki re-ran clean over current memory.md with related coverage >= 80% and INDEX:AUTO regenerated.
  </done>
</task>

<task type="auto">
  <name>Task 3: Delete merged Phase-34 branch (item 5) + full-suite batch verification</name>
  <files>(git ref only — no file changes, no commit)</files>
  <action>
    ITEM 5 — delete the squash-merged local branch:
    1. `git branch -D feat/phase-34-promotion-integrity`
       - Must be `-D` (force): PR #86 squash-merged it, so it is NOT an ancestor of master and `-d` will refuse. This is expected and safe (the work is on master).
       - Do NOT touch the worktree dir `.claude/worktrees/fix-extraction-parse-and-timeout` or its branch `worktree-fix-extraction-parse-and-timeout` — leave it alone (it does not block this batch).
       - Ensure you are NOT on feat/phase-34-promotion-integrity when deleting (you are on chore/session-close-out-260721).

    BATCH VERIFICATION — the whole-batch gate:
    2. `npm test` (full Jest suite) — must pass.
    3. `npm run lint` — must be clean.
       If either fails, stop and report; do not paper over failures. Items 2 and 4 are vault-state changes and are NOT covered by Jest — they were verified in Task 2.
  </action>
  <verify>
    <automated>cd /Users/cpconnor/projects/second-brain && ! git rev-parse --verify feat/phase-34-promotion-integrity 2>/dev/null && npm test && npm run lint && echo BATCH_OK</automated>
  </verify>
  <done>
    `git rev-parse --verify feat/phase-34-promotion-integrity` fails (branch gone); the worktree branch worktree-fix-extraction-parse-and-timeout is untouched; full `npm test` and `npm run lint` both pass.
  </done>
</task>

</tasks>

<verification>
Batch is complete when all three tasks pass their `<verify>` gates:
- Task 1 (repo): pipeline-infra tests + lint green; SKILL.md gate description corrected; LLM_PROVIDER wired in code + plist; committed.
- Task 2 (vault): changeset confirmed fully resolved (12 applied:: + 3 rejected, dream --apply no-op); wiki graph regenerated; coverage >= 80%.
- Task 3 (git + suite): feat/phase-34-promotion-integrity deleted; full `npm test` + `npm run lint` pass.

Whole-batch gate (verified facts): `npm test` + `npm run lint` pass at the end (Task 3). Items 2 and 4 are vault-state-based, verified in Task 2, not by Jest.
</verification>

<success_criteria>
- SKILL.md + scripts/dream.js describe the --apply gate as the live-vault hybrid-search retrievability check (no stale eval:recall gate references in-repo outside the Phase-32 harness).
- Scheduled dream-propose authors via Anthropic Sonnet (LLM_PROVIDER=anthropic in plist + code honors it); interactive classifier still uses the local overlay (existing local-provider test unchanged).
- dream-changeset-2026-07.md confirmed fully resolved: 12/15 applied::, 3 human-rejected preserved untouched, `dream --apply` no-op (applied: 0).
- Live memory-wiki graph refreshed over current memory.md: INDEX:AUTO regenerated; related coverage >= 80%.
- Local branch feat/phase-34-promotion-integrity deleted; worktree branch left intact.
- Full `npm test` + `npm run lint` green.
</success_criteria>

<output>
After completion, create `.planning/quick/260721-ljn-session-close-out-batch-dream-apply-skil/260721-ljn-SUMMARY.md` recording: the commit hash for items 1+3, the dream --apply no-op confirmation (applied: 0; 12/15 applied + 3 rejected preserved) and final related-coverage % (items 4+2), whether the launchd agent was installed/reloaded, confirmation the phase-34 branch was deleted, and the final test/lint status.
</output>

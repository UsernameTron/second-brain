---
phase: quick-260719-lfn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .claude/commands/promote-memories.md
  - .claude/hooks/memory-extraction-hook.js
  - src/promote-memories.js
  - src/memory-extractor.js
  - scripts/daily-sweep.js
  - config/reach-targets.json
  - config/vault-paths.json
autonomous: true
requirements: [CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-8, CAP-9]
must_haves:
  truths:
    - "A /promote-memories run with VOYAGE_API_KEY in .env embeds N vectors for N promoted entries (no silent zero-vector green run)"
    - "Promote completion output prints embedded/failed counts"
    - "An unsanctioned candidate category is coerced to OTHER (or rejected) instead of landing verbatim"
    - "memory.md carries an auto-regenerated INDEX:AUTO block after each promote run"
    - "Extractor staging blocks ISPN/Genesys/Asana content before writeCandidate, fail-closed"
    - "daily-sweep sweeps recent transcripts and the inbox/ dir, staging candidates"
    - "config-validator passes after config edits; full jest suite passes with a reported test count > 0"
  artifacts:
    - path: "src/promote-memories.js"
      provides: "dotenv-agnostic promotion with embed-count surfacing, category validation, auto-index"
      contains: "INDEX:AUTO"
    - path: "config/reach-targets.json"
      provides: "15 reach targets (2 existing + 13 new)"
      contains: "second-brain"
    - path: "config/vault-paths.json"
      provides: "inbox added to right array"
      contains: "inbox"
    - path: "scripts/daily-sweep.js"
      provides: "transcript sweep + inbox ingest steps"
      contains: "extractFromTranscript"
    - path: "~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist"
      provides: "23:45 daily launchd schedule"
      contains: "com.secondbrain.daily-sweep"
  key_links:
    - from: ".claude/commands/promote-memories.md"
      to: ".env VOYAGE_API_KEY"
      via: "require('dotenv').config({path})"
      pattern: "dotenv.*config"
    - from: "src/memory-extractor.js"
      to: "src/content-policy.js checkContent"
      via: "gate before writeCandidate"
      pattern: "checkContent"
    - from: "scripts/daily-sweep.js"
      to: "src/memory-extractor.js extractFromTranscript"
      via: "live caller in sweep step"
      pattern: "extractFromTranscript"
---

<objective>
Close the nine confirmed capture-pipeline defects from today's audit (`.planning/debug/memory-pipeline-audit.md`): the dotenv gate that silently embeds zero vectors, swallowed embed counts, missing category validation, no auto-index, an unguarded ingress path, and the fact that transcript/inbox capture, expanded reach, and the daily-sweep schedule don't run at all.
Purpose: promotion runs must be honestly green (vectors match entries), capture must actually harvest transcripts + Cowork inbox, and the sweep must run nightly.
Output: code + config fixes, tests for every new logic path, a loaded launchd agent.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/debug/memory-pipeline-audit.md
@CLAUDE.md
@src/promote-memories.js
@src/semantic-index.js
@src/memory-extractor.js
@src/content-policy.js
@scripts/daily-sweep.js
@config/reach-targets.json
@config/vault-paths.json
@config/memory-categories.json

<interfaces>
- `indexNewEntries(entries)` → `{success, embedded, failed, failureMode}` (src/semantic-index.js:282). Currently called non-fatally in `appendToMemoryFile` (promote-memories.js:230-236) and its return is discarded.
- `checkContent(content, excludedTerms, contextChars=100)` → `{decision:'PASS'|'BLOCK', reason?, matchedTerm?}` (src/content-policy.js:233). Fail-closed = BLOCK on Haiku error.
- `loadExcludedTerms()` from `./pipeline-infra` — never throws, returns `[]` on failure (used by reach-exporter.js:183).
- `extractFromTranscript(transcriptPath, sessionId, options={})` → `Promise<object[]>` (src/memory-extractor.js:232). NO live caller today.
- `extractMemories({file|dir|since|dailyRange})` (src/memory-extractor.js:455). `{dir:'inbox'}` → `extractFromDirectory('inbox')` reads `VAULT_ROOT/inbox` (non-recursive — an `archive/` subdir is invisible to it).
- `writeCandidate({content,category,...})` (src/memory-proposals.js) — the staging write, called at memory-extractor.js:179 and :388.
- Sanctioned categories (config/memory-categories.json keys): DECISION, LEARNING, PREFERENCE, RELATIONSHIP, CONSTRAINT, PATTERN, OTHER.
- memory.md month layout: `## YYYY-MM` headers, entries `### `; `countMemoryEntries` = `/^### /gm` matches (promote-memories.js:251).
- reach-targets.schema.json: targets array maxItems 50, item pattern `^[^`]+$`. vault-paths.schema.json: `additionalProperties:false`, right-array item pattern forbids leading `/` and `..`. Neither schema needs editing for these adds.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Promotion + extractor honesty (audit items 1-5)</name>
  <files>.claude/commands/promote-memories.md, .claude/hooks/memory-extraction-hook.js, src/promote-memories.js, src/memory-extractor.js, test/promote-memories.test.js, test/memory-extractor.test.js</files>
  <action>
Five fixes, all root-cause:

1. **Dotenv gate.** In the `node -e` block of `.claude/commands/promote-memories.md` add `require('dotenv').config({ path: '<repo>/.env' })` as the FIRST statement (mirror scripts/recall.js:22 — resolve the absolute repo .env path the same way it does). Add the identical `require('dotenv').config(...)` line at the top of `.claude/hooks/memory-extraction-hook.js` (ANTHROPIC_API_KEY may be absent in hook runtime). Do NOT add dotenv to any src/ library module — pipeline-infra.js:23-26 deliberately leaves that to entry points (HOOK-DOTENV-01).

2. **Surface embed counts.** In promote-memories.js, change `appendToMemoryFile` to capture the return of `indexNewEntries(promotedCandidates)` (currently discarded, line 230-236) and thread `{embedded, failed}` up into the promoteMemories result object. Update the completion output so it prints embedded/failed alongside promoted — a run where embedded < promoted must be visibly not-green. Keep the embed try/catch non-fatal, but on catch report `failed = promotedCandidates.length`.

3. **Category validation.** Before building the memory entry (in the promotion loop, near buildMemoryEntry), validate `candidate.category` against the keys of config/memory-categories.json. Unsanctioned → coerce to `OTHER` and append an auto-justification to the entry noting the original label (lightest mechanism, consistent with existing string-building style — do not add a rejection path unless coercion doesn't fit). Load the category keys via the existing config loader pattern.

4. **Auto-index.** Add a function that regenerates a compact block (≤15 lines: total entries, per-category counts, one line per `## YYYY-MM` section, last-promoted date, archive pointer) between `<!-- INDEX:AUTO -->` / `<!-- /INDEX:AUTO -->` markers at the TOP of memory.md, called once per non-dry-run promote after appendToMemoryFile. Tolerate marker absence — insert the block on first run. Reuse `countMemoryEntries`.

5. **Ingress exclusion.** In src/memory-extractor.js, add ONE `checkContent(candidate.content, loadExcludedTerms())` guard immediately before each `writeCandidate` call (lines 179 and 388 route through the staging path the repo flags as unguarded at reach-exporter.js:17-20). `decision !== 'PASS'` → skip the candidate (continue), fail-closed. Import `checkContent` and `loadExcludedTerms` as reach-exporter.js does.
  </action>
  <behavior>
  - promote result exposes embedded/failed; a stubbed indexNewEntries returning {embedded:0,failed:1} makes the run report not-green.
  - candidate with category "INSIGHT" is written to memory.md as category:: OTHER with a justification noting "INSIGHT".
  - memory.md after promote contains an INDEX:AUTO block; a second promote regenerates (not duplicates) it.
  - extractor drops a candidate whose content trips checkContent BLOCK; PASS content still stages.
  </behavior>
  <verify><automated>cd /Users/cpconnor/projects/second-brain && npx jest test/promote-memories.test.js test/memory-extractor.test.js 2>&1 | tail -20</automated></verify>
  <done>Dotenv loaded on both entry points; promote result carries embedded/failed and prints them; unsanctioned categories coerced to OTHER with justification; INDEX:AUTO block regenerates on each run; extractor gates writeCandidate fail-closed; new tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: daily-sweep transcript + inbox capture (audit items 6-7)</name>
  <files>scripts/daily-sweep.js, config/vault-paths.json, test/daily-sweep.test.js</files>
  <action>
Two new sweep steps in scripts/daily-sweep.js, both dry-run aware (mirror the existing step guards):

**Transcript sweep.** Enumerate `~/.claude/projects/*/*.jsonl` with mtime < 24h. Skip any path whose directory name contains "worktrees" (worktree/subagent dirs). Read/write a ledger at `state/transcripts-swept.json` (array of `{path, mtime}`; `state/` is gitignored — fine) to skip already-swept files. For each unswept file, STREAM-grep lines for a signal heuristic BEFORE any extraction (never load the whole transcript into an LLM) — use a line-by-line read (readline over a stream) with a cheap signal check. Only on files with a hit, call `extractFromTranscript(path, <sessionId from path/basename>)` (its first live caller). Existing content_hash dedup handles re-staging. Record swept files (path+mtime) in the ledger.

**Inbox ingest.** Add `"inbox"` to the `right` array in config/vault-paths.json (relative path, no leading slash — schema-compliant; additionalProperties stays satisfied). Add a sweep step that calls `extractMemories({dir:'inbox'})`, then moves each processed file into `inbox/archive/` (a subdir the non-recursive extractFromDirectory won't re-scan). Create `~/Claude Cowork/inbox/` and `~/Claude Cowork/inbox/archive/` if absent (RIGHT side — allowed). Guard both steps under `--dry-run` like steps 1-3, logging what would run.

Wire both steps into `main()` results object; keep failures non-fatal per-step (try/catch → results.<step> = {error}).
  </action>
  <verify><automated>cd /Users/cpconnor/projects/second-brain && npx jest test/daily-sweep.test.js 2>&1 | tail -15 && node src/config-validator.js 2>&1 | tail -5</automated></verify>
  <done>daily-sweep streams recent non-worktree transcripts, greps for signal, calls extractFromTranscript only on hits, ledgers swept files; inbox files extract then move to inbox/archive/; inbox added to vault-paths right; config-validator PASS; tests pass including a worktree-skip and ledger-dedup case.</done>
</task>

<task type="auto">
  <name>Task 3: Reach expansion + launchd scheduling (audit items 8-9)</name>
  <files>config/reach-targets.json, ~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist</files>
  <action>
1. **Reach expansion.** Append these 13 slugs to the `targets` array in config/reach-targets.json (KEEP the existing 2 → 15 total), each as `"~/.claude/projects/<slug>/memory"`:
`-Users-cpconnor-projects-CTG-Workspace-Build`, `-Users-cpconnor-projects-CTG-Workspace-Build-projects-ctg-signal-radar`, `-Users-cpconnor-projects-CTG-Workspace-Build-projects-ctg-content-engine`, `-Users-cpconnor-projects-CTG-Workspace-Build-projects-ctg-l10-eos`, `-Users-cpconnor-projects-CTG-Workspace-Build-projects-ctg-ops-automation`, `-Users-cpconnor-projects-CTG-Workspace-Build-projects-sentiment-analysis`, `-Users-cpconnor-projects-second-brain`, `-Users-cpconnor-projects-gsd-eval-harness`, `-Users-cpconnor-projects-ctg-content-engine`, `-Users-cpconnor-projects-ctg-infrastructure`, `-Users-cpconnor-projects-claude-desktop-skills`, `-Users-cpconnor-projects-gsd-studio`, `-Users-cpconnor-projects-Pete-Gets-Shit-Done`.
15 ≤ maxItems 50; slug items contain no backtick so they pass the item pattern. Do not touch enabled/digestMax.

2. **launchd.** Write `~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist` per the header spec in scripts/daily-sweep.js:11-17: Label `com.secondbrain.daily-sweep`, ProgramArguments `["node", "<abs>/scripts/daily-sweep.js"]` (absolute repo path), `StartCalendarInterval {Hour:23, Minute:45}`, plus StandardOutPath/StandardErrorPath to a log under the repo or ~/Library/Logs. Load it: `launchctl bootstrap gui/$(id -u) <plist>` (fall back to `launchctl load` if bootstrap unsupported). Verify with `launchctl list | grep secondbrain.daily-sweep`.
  </action>
  <verify><automated>cd /Users/cpconnor/projects/second-brain && node src/config-validator.js 2>&1 | tail -5 && node -e "const t=require('./config/reach-targets.json').targets; if(t.length!==15) throw new Error('expected 15 targets, got '+t.length); console.log('targets OK:',t.length)" && launchctl list | grep secondbrain.daily-sweep && plutil -lint ~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist</automated></verify>
  <done>reach-targets has 15 entries (2 existing + 13 new); config-validator PASS; plist written, plutil-valid, and loaded (appears in launchctl list).</done>
</task>

</tasks>

<verification>
- Full suite in the REAL repo dir (never a worktree — jest-in-worktree can green-exit on zero tests): `cd /Users/cpconnor/projects/second-brain && npm test 2>&1 | tail -25`. Report the executed test count; a run reporting 0 tests is a FAIL regardless of exit code.
- `node src/config-validator.js` PASS after config edits.
- Manual honesty check: a real `/promote-memories` run with .env present prints embedded == promoted (or an explicit failed count) — no silent zero-vector green run.
</verification>

<success_criteria>
All 9 audit items closed: dotenv on both entry points, embed counts surfaced, category coercion, INDEX:AUTO, ingress gate, transcript sweep, inbox ingest, 15 reach targets, launchd loaded. Full jest suite passes with reported count > 0; config-validator PASS. memory.md, the sidecar, and proposals/memory-proposals.md (40 human-gated candidates) untouched. No LEFT-side writes. ISPN/Genesys/Asana exclusions remain fail-closed.
</success_criteria>

<output>
After completion, create `.planning/quick/260719-lfn-capture-fixes-dotenv-gate-embed-counts-c/260719-lfn-SUMMARY.md`
</output>
---
phase: quick-260914-mlr
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/SIX-IMPROVEMENTS-PLAN.md
  - .planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/260914-mlr-SUMMARY.md
autonomous: true
requirements: [Q6-PLAN-01, Q6-PLAN-02]
must_haves:
  truths:
    - "Connor can review an actionable plan covering all six improvements."
    - "Every capability has dependencies, proposed file ownership, acceptance checks, and an exit gate."
    - "Only planning documents change; the current runtime and canonical memory remain untouched."
  artifacts:
    - path: .planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/SIX-IMPROVEMENTS-PLAN.md
      provides: "Six-feature plan with isolation, release gates, and rollback"
    - path: .planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/260914-mlr-SUMMARY.md
      provides: "Documentation-only completion record"
  key_links:
    - from: SIX-IMPROVEMENTS-PLAN.md
      to: 260914-mlr-CONTEXT.md
      via: "Required decisions and verified current-runtime contracts"
---

<objective>
Create the implementation plan requested by Connor for all six Second Brain improvements. This quick task produces the plan document; it does not implement features.

Q6-PLAN-01: All six capabilities have actionable scope and observable acceptance.
Q6-PLAN-02: Preserve authority, review controls, source material, exclusions, retryability, and runtime isolation.
</objective>

<execution_context>
@/Users/cpconnor/.codex/get-shit-done/workflows/execute-plan.md
@/Users/cpconnor/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/260914-mlr-CONTEXT.md
@/Users/cpconnor/.local/share/second-brain/runtime/README.md
@/Users/cpconnor/.local/share/second-brain/runtime/docs/codebase-map.md
@/Users/cpconnor/projects/second-brain/CLAUDE.md
@/Users/cpconnor/projects/second-brain/.planning/STATE.md

Read CONTEXT.md first and honor all required design decisions. Current runtime commit: 3fc324b500578080201c85eb2a20856b61904f83. Its src modules and scripts are the future extension target. The root checkout is Agent Canvas development with legacy memory source; STATE.md and v1.8 roadmap are historical. Current runtime references override retired local skill commands. No further broad discovery is needed.
</context>

<constraints>
Own only the two output documents; preserve others' edits. No source/runtime/vault/configuration/STATE/ROADMAP changes, dependency installation, Git staging, or commits. The orchestrator handles documentation closeout. Default to Obsidian plus CLI. No Agent Canvas dependency, second fact store, new desktop app, embeddings provider, autonomous research, or live activation. Mark new paths, modules, schemas, commands, and checks as proposed. Target approximately 2,000-3,000 words for the actual plan.
</constraints>

<tasks>
<task type="auto">
  <name>Task 1: Draft the complete six-capability implementation plan</name>
  <files>.planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/SIX-IMPROVEMENTS-PLAN.md</files>
  <action>
Write an executive phase table followed by precise implementation packages. Start with "Status: Proposed; implementation not started" and the verified runtime baseline. Map SB-WIKI-01 living project pages, SB-WIKI-02 evidence answers, SB-WIKI-03 fact review, SB-WIKI-04 PDF/DOCX/web capture, SB-WIKI-05 purpose-aware retrieval, and SB-WIKI-06 saved answers. Include Phase 0 for a future isolated checkout from the runtime revision with independent fixture state and preservation baselines, then dependency-ordered capability phases and final release. Each phase needs its user-visible result, requirement IDs, prerequisites, 2-3 focused work packages, exact existing/proposed paths, acceptance checks, and exit gate. Identify shared-file ordering and independent work. Inspect only relevant current src/script interfaces if precise ownership requires it.

Translate every required design decision in CONTEXT.md into implementation scope: canonical memory.md and the existing proposal queue/lock; read-only LEFT; exclusions; exact source-version/passages; preservation when evidence changes/disappears; explicit current-fact acceptance; durable reject/defer; stale-review rejection and edited-acceptance invalidation; bounded/retryable capture; explicit project scopes; generated-note labels and prevention of automatic recapture or false corroboration. Define minimal proposed evidence, source-version, project-purpose, and derived-note contracts. Describe all six user flows and deterministic fallback when AI is unavailable. Cite the provided upstream feature reference as inspiration without adopting its application or claiming its results as Second Brain evidence.
  </action>
  <verify>
    <automated>cd /Users/cpconnor/projects/second-brain &amp;&amp; node -e 'const fs=require("fs");const s=fs.readFileSync(".planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/SIX-IMPROVEMENTS-PLAN.md","utf8");for(const x of ["SB-WIKI-01","SB-WIKI-02","SB-WIKI-03","SB-WIKI-04","SB-WIKI-05","SB-WIKI-06","Phase 0","3fc324b500578080201c85eb2a20856b61904f83"])if(!s.includes(x))throw Error("Missing: "+x);console.log("Six-capability draft coverage passed");'</automated>
  </verify>
  <done>All six capabilities have explicit user flows, ownership, dependencies, measurable acceptance, and preserved authority boundaries.</done>
</task>

<task type="auto">
  <name>Task 2: Audit completeness, release gates, rollback, and documentation-only closeout</name>
  <files>.planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/SIX-IMPROVEMENTS-PLAN.md, .planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/260914-mlr-SUMMARY.md</files>
  <action>
Review the draft semantically against CONTEXT.md and fix gaps. Add Requirements coverage, Failure and recovery, Release gates, and Rollback sections. Map each capability to work and acceptance evidence. Cover changed/moved/missing sources, stale derived pages, human edits, old review submissions, duplicate/partial ingest, unsupported documents, unavailable models, interrupted writes, exclusions, path boundaries, and generated-answer feedback loops. Include the context's full integration story from import through reviewed fact, project page, purposeful question, saved answer, changed evidence and approved successor. Require a separate project/source benchmark, unchanged frozen recall set and previously passing cases, zero lifecycle/authority regressions, resolvable citations, and honest abstention. Label historical baseline results as not rerun during planning.

Define future feature flags, isolated pilot, test/lint/UAT/config/recall/preservation gates, reviewable release artifact, and explicit authorization before live activation. Retain the prior revision and compatible state snapshot. Code rollback must not restore old memory/state over newer accepted writes; specify reconciliation and safe handling of derived artifacts. Distinguish proposed checks from completed document validation. Write the summary with actual documents produced, validation performed, no implementation/live changes, and the next approval to begin implementation. Do not run runtime tests or live operations during this documentation task.
  </action>
  <verify>
    <automated>cd /Users/cpconnor/projects/second-brain &amp;&amp; node -e 'const fs=require("fs");const d=".planning/quick/260914-mlr-plan-all-six-second-brain-knowledge-impr/";const s=fs.readFileSync(d+"SIX-IMPROVEMENTS-PLAN.md","utf8");for(const x of ["Requirements coverage","Failure and recovery","Release gates","Rollback","memory.md","reject","defer"])if(!s.includes(x))throw Error("Missing: "+x);if(!fs.readFileSync(d+"260914-mlr-SUMMARY.md","utf8").trim())throw Error("Missing summary");console.log("Plan audit and documentation closeout passed");'</automated>
  </verify>
  <done>Every capability is traceable; failure, feedback, release and rollback rules are concrete; only the two planning documents were authored.</done>
</task>
</tasks>

<verification>
Run both read-only document checks. Inspect semantics and Git status without resetting unrelated files. Verify new paths/commands are labeled proposed and no implementation is claimed.
</verification>

<success_criteria>
The plan covers all six improvements plus isolation and release, preserves the current runtime's authority and source contracts, and supports later phase execution. No implementation or live activation occurs.
</success_criteria>

<output>
Return absolute plan and summary paths, validation results, and any material unresolved decision. Do not implement or commit; the orchestrator owns documentation closeout.
</output>

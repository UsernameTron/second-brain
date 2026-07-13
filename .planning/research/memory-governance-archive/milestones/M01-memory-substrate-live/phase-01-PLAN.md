# Harness Memory Governance — Phase 01
# Audit & Baseline

**Solution:** Discover the real memory estate with commands, not recall; measure cold-start recall before changing anything.
**Target users:** Pete Connor (sole operator)
**Owner:** Pete Connor
**Date initiated:** 2026-07-12
**Estimated build time:** 2–3 hours
**Estimated time to live:** Immediate — the baseline number is the deliverable
**GSD lifecycle state:** PHASE_PLANNED → advance to PHASE_EXECUTING on start

---

## What you're building

Nothing. That's the point.

This phase writes a map and takes a measurement. It finds every file on the machine that claims to know something about Pete, records where they overlap and contradict each other, and then runs twenty fixed questions past three different Claude surfaces with no conversational context to see how many it gets right cold.

That last number is the whole justification for the next 30 hours of work. If you skip it, you can never answer "did this actually work" — you can only answer "does it feel better," which is how people end up maintaining elaborate systems that do nothing.

## Strategic frame

**Why it matters:** the harness is accumulating, not compounding, and the only proof either way is a baseline that doesn't exist yet.

You already suspect the diagnosis — 39 skills against a 28 target, a CLAUDE.md/`~/context` conflict you've flagged but not resolved, and a memory blob you can't write to. What you don't have is the number that turns a suspicion into a finding. Two hours of audit buys you a falsifiable project. Without it, M02 and M03 are faith-based.

There is a second payoff. The audit output — a model-readable inventory of every memory surface — is itself **leverage scaffolding**. It's the same move as the model-readable skill registry from the Bitter Lesson audit: don't build logic that decides what matters, build an index that lets the model decide. The inventory outlives this phase.

## Architecture

```
                     PHASE 01 — READ ONLY. NOTHING IS MODIFIED.

  ┌────────────────────── THE ESTATE (discovered, not assumed) ──────────────────────┐
  │                                                                                   │
  │   ~/Claude Cowork/          CLAUDE.md          ~/context/        Skills estate    │
  │   └── ABOUT ME/*.md         (Code router?)     (duplicate?)      (~39? count it)  │
  │   └── projects/*.md              │                  │                  │          │
  │            │                     │                  │                  │          │
  │   GSD .planning/*          Auto-memory blob    ~/.claude/projects/*.jsonl         │
  │   (STATE/PLAN/todo)        (T4 — unwritable)   (transcripts — the unread corpus)  │
  │            │                     │                  │                  │          │
  └────────────┼─────────────────────┼──────────────────┼──────────────────┼──────────┘
               │                     │                  │                  │
               └─────────────────────┴────────┬─────────┴──────────────────┘
                                              │
                                     ┌────────▼─────────┐
                                     │  inventory.sh    │   1.1 – 1.4
                                     │  dupe-check.py   │   discover + diff
                                     └────────┬─────────┘
                                              │
               ┌──────────────────────────────┼──────────────────────────────┐
               │                              │                              │
       ┌───────▼────────┐          ┌──────────▼─────────┐        ┌───────────▼────────┐
       │  inventory.md  │          │ overlap-report.txt │        │ capability-check.md│
       │  the estate map│          │ the ~/context bug  │        │ hooks + telemetry  │
       └────────────────┘          └────────────────────┘        └────────────────────┘

                    ═══════════ COLD-START BASELINE (1.7 – 1.9) ═══════════

       20 probes ──┬──▶ Claude Code    (fresh session, no context) ──┐
                   ├──▶ Claude Desktop (fresh chat, no context)   ───┼──▶ baseline.md
                   └──▶ Cowork         (fresh session, no context) ──┘      %/surface

       Answer key authored by PETE. Claude writes the questions.
       The thing under test cannot also be the grader.
```

**Critical design note:** the surfaces are baselined *separately* because their enforcement ceilings differ. Claude Code gets hooks (deterministic). Desktop and Cowork get prompt-level rules only. Chat gets nothing and is excluded. If the eventual lift is uneven across surfaces, that's a real finding about where the leverage is — and you can only see it if you measured them apart.

---

## Phase 0 — Pre-flight & decisions

### 0.1 Where this runs

**Claude Code terminal.** Not Desktop, not Cowork.

Reason: your local MCP bridge is currently unresponsive (`Filesystem:list_allowed_directories` timed out with no response from the Claude Desktop app on 2026-07-12; Desktop Commander and Control-your-Mac route through the same bridge and are almost certainly down too). Claude Code has native filesystem access and does not depend on that bridge.

**Do this first, before anything else:**

```bash
# Restart the local MCP servers — quit and relaunch Claude Desktop.
# Then verify from Claude Desktop with a trivial call before relying on Cowork steps.
```

If the bridge stays down, Phase 01 still completes — only step 1.9 (Cowork baseline) is blocked, and that can be backfilled.

### 0.2 Scratch directory

All Phase 01 output goes to `~/memory-audit/`. **Not** `~/memory/` — that repo doesn't exist until phase-02, and keeping the audit separate means a failed audit leaves zero residue.

### 0.3 Read-only guarantee

This phase modifies nothing outside `~/memory-audit/`. If you find yourself wanting to fix something you discovered — **don't.** Write it down. Phase 03 fixes it. Fixing while auditing is how you lose the record of what was actually broken.

### 0.4 Budget & cost guardrail

**$0.** Everything in this phase is bash, Python 3, and reading files you already own. No API calls, no cloud, no new tooling.

The only cost anywhere in M01 is a one-time `brew install gitleaks` in phase-02 — free, OSS. **There is no paid line item in this entire project.** If a step ever starts to look like it needs a service, that's scope creep and the answer is no. (See the anti-build list in `PROJECT.md`.)

**Cost guardrail:** if any phase of this project proposes a recurring cost, stop and re-read the anti-build list before agreeing to it.

### 0.5 Access & auth model

- **Credentials touched by this phase: none.** The estate sweep counts and sizes files. It does not read transcript *contents* — deliberately. Transcript ingestion doesn't happen until M02 phase-04, **behind** the scrubbing gate built in phase-02. That sequencing is not an accident.
- **Repo privacy:** `~/memory` does not exist yet. When it's created in phase-02, it is **private and local-only** by default. No remote until the scrubbing gate has survived 30 days of real capture.
- **IAM / cloud roles:** none required. This is entirely local. Nothing in this project touches `ctg-workspace-dev` or any GCP project.

### 0.6 Scope boundaries for this phase

**In scope:** discovering what exists, measuring how well it works today, verifying what the platform can actually do.

**Out of scope — and this is the discipline that makes the phase work:**
- Creating `~/memory` → phase-02
- Moving, merging, or deleting any content → phase-03
- Rewriting `CLAUDE.md` → phase-03
- Installing any hook → M02
- Pruning any skill → M03 (this phase only *counts* them)
- Fixing anything you discover → write it in the Disposition column and walk away

### 0.7 The one thing that could invalidate this phase

Grading your own homework. The probe answer key **must** be authored by Pete, not by Claude. Claude's model of Pete is the thing under test; it cannot also be the grader. If you find yourself letting Claude fill in the answer key "to save time," you have destroyed the measurement and you should stop.

---

## Phase 1 — Discover the estate

### 1.1 Create the scratch directory

**Where:** Claude Code terminal

**Action:** Make the audit workspace.

```bash
mkdir -p ~/memory-audit && cd ~/memory-audit && pwd
```

**What you should see:** `/Users/<you>/memory-audit`

**If it fails:** Permission error means you're not in your home directory. `cd ~` first.

---

### 1.2 Find every memory-bearing file

**Where:** Claude Code terminal

**Action:** Sweep the known and suspected locations. This is deliberately broad — it's cheaper to over-collect and filter than to miss a store you forgot existed.

```bash
cd ~/memory-audit

{
  echo "### SEARCH ROOTS"
  for d in "$HOME/Claude Cowork" "$HOME/context" "$HOME/.claude" "$HOME/projects" "$HOME/Documents/Obsidian"; do
    if [ -d "$d" ]; then echo "FOUND: $d"; else echo "ABSENT: $d"; fi
  done

  echo ""
  echo "### CLAUDE.md FILES (all of them — there may be more than you think)"
  find "$HOME" -maxdepth 4 -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null

  echo ""
  echo "### MEMORY-BEARING MARKDOWN (size | modified | path)"
  find "$HOME/Claude Cowork" "$HOME/context" "$HOME/.claude" -type f -name "*.md" \
    -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null \
    | while read -r f; do
        printf "%8s  %s  %s\n" "$(du -h "$f" | cut -f1)" "$(date -r "$f" +%Y-%m-%d)" "$f"
      done | sort -k2

  echo ""
  echo "### GSD PLANNING STATE"
  find "$HOME" -maxdepth 5 -type d -name ".planning" -not -path "*/node_modules/*" 2>/dev/null

  echo ""
  echo "### TRANSCRIPT CORPUS (the unread archive)"
  echo "transcript files: $(find "$HOME/.claude/projects" -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')"
  echo "total size:       $(du -sh "$HOME/.claude/projects" 2>/dev/null | cut -f1)"
} > raw-estate.txt

wc -l raw-estate.txt && head -40 raw-estate.txt
```

**What you should see:** A file with the search roots resolved (FOUND/ABSENT for each), every `CLAUDE.md` on the machine, a size-and-date sorted list of markdown, and a transcript count. The transcript count will probably be large — that's the corpus that has never once been read back.

**If it fails:** `date -r` is BSD-syntax (macOS). If you get an error, you're on GNU coreutils — swap to `date -r "$f" "+%Y-%m-%d"` → `stat -c %y "$f" | cut -d' ' -f1`.

---

### 1.3 Find the duplication

**Where:** Claude Code terminal

**Action:** This is the step that turns your suspected CLAUDE.md ↔ `~/context/` conflict into evidence. Dumb shingle overlap. No embeddings, no scoring — just: which sentences appear in more than one editable file.

```bash
cat > ~/memory-audit/dupe-check.py <<'PYEOF'
#!/usr/bin/env python3
"""Find duplicated content across memory-bearing files. Dumb on purpose."""
import sys, re, itertools
from pathlib import Path
from collections import defaultdict

ROOTS = [
    Path.home() / "Claude Cowork",
    Path.home() / "context",
    Path.home() / ".claude",
]
MIN_WORDS = 8  # ignore fragments

def sentences(text):
    for raw in re.split(r'(?<=[.!?])\s+|\n{2,}|\n(?=[-*#])', text):
        s = re.sub(r'\s+', ' ', raw).strip().strip('-*# ').lower()
        if len(s.split()) >= MIN_WORDS:
            yield s

files = []
for root in ROOTS:
    if root.exists():
        files += [p for p in root.rglob("*.md")
                  if ".git" not in p.parts and "node_modules" not in p.parts]

index = defaultdict(set)
for p in files:
    try:
        for s in sentences(p.read_text(errors="ignore")):
            index[s].add(str(p))
    except Exception as e:
        print(f"SKIP {p}: {e}", file=sys.stderr)

dupes = {s: paths for s, paths in index.items() if len(paths) > 1}

print(f"files scanned:        {len(files)}")
print(f"unique statements:    {len(index)}")
print(f"DUPLICATED statements: {len(dupes)}")
print()

pairs = defaultdict(int)
for s, paths in dupes.items():
    for a, b in itertools.combinations(sorted(paths), 2):
        pairs[(a, b)] += 1

print("=== FILE PAIRS BY OVERLAP (the conflict surface) ===")
for (a, b), n in sorted(pairs.items(), key=lambda x: -x[1]):
    print(f"{n:4d}  {a}\n      {b}\n")

print("=== SAMPLE DUPLICATED STATEMENTS (first 15) ===")
for s, paths in list(dupes.items())[:15]:
    print(f"- {s[:110]}")
    for p in sorted(paths):
        print(f"    {p}")
PYEOF

cd ~/memory-audit && python3 dupe-check.py > overlap-report.txt 2>&1
cat overlap-report.txt | head -50
```

**What you should see:** A non-zero `DUPLICATED statements` count, and a ranked list of file pairs. The pair with the highest overlap is your worst conflict. If `~/context/` and `CLAUDE.md` are near the top, the suspicion is confirmed and Phase 03 has its target list.

**If it fails:** `DUPLICATED statements: 0` across the board means either the roots didn't resolve (check `raw-estate.txt` for ABSENT lines and fix the `ROOTS` list) or your files are genuinely clean, which would be a pleasant surprise worth verifying by hand on two files you *know* overlap.

**Keep this script.** It becomes the pre-commit gate in phase-02 (rule X2). Policy that isn't enforced by a script is not policy — it's a wish.

---

### 1.4 Count the skills for real

**Where:** Claude Code terminal

**Action:** Memory says 39 Desktop skills against a 20–28 target, and separately mentions a 130-skill estate. Those can't both be the same number. Count them.

```bash
cd ~/memory-audit
{
  echo "### SKILL.md COUNT BY LOCATION"
  for d in "$HOME/Library/Application Support/Claude/skills" \
           "$HOME/.claude/skills" \
           "$HOME/.claude/plugins" \
           "$HOME/Claude Cowork"; do
    if [ -d "$d" ]; then
      n=$(find "$d" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
      echo "$n  <-  $d"
    fi
  done
  echo ""
  echo "### ALL SKILL.md ON DISK"
  find "$HOME" -name "SKILL.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | wc -l
} > skill-count.txt
cat skill-count.txt
```

**What you should see:** A per-location count. The discrepancy between "39" and "130" resolves here — almost certainly Desktop skills vs. total including plugins and Claude Code skills.

**If it fails:** Zero everywhere means the Desktop skills path differs on your install. Find it: `find "$HOME/Library" -name "SKILL.md" 2>/dev/null | head`.

---

### 1.5 Check whether skill telemetry exists

**Where:** Claude Code terminal

**Action:** M03's skill prune needs invocation counts. Find out now whether they exist, because if they don't, telemetry must start collecting in M02 phase-01 and it needs a 30-day running start.

```bash
cd ~/memory-audit
{
  echo "### DOES ANYTHING LOG SKILL INVOCATIONS TODAY?"
  echo "-- searching transcripts for Skill tool_use events --"
  grep -l '"name":"Skill"' "$HOME"/.claude/projects/*/*.jsonl 2>/dev/null | wc -l
  echo "-- existing hook config --"
  cat "$HOME/.claude/settings.json" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('hooks','NO HOOKS KEY'), indent=2))" 2>/dev/null || echo "no settings.json or unparseable"
} > telemetry-check.txt
cat telemetry-check.txt
```

**What you should see:** Either a count of transcript files containing Skill invocations (telemetry is *derivable* from transcripts — good, no new hook needed), or zero (telemetry must be instrumented). Plus your current 5 GSD hooks, printed.

**If it fails:** No `settings.json` means hooks are configured elsewhere (project-level `.claude/settings.json`). Search: `find "$HOME" -name "settings.json" -path "*claude*" 2>/dev/null`.

**This is a decision point.** Record the answer in `capability-check.md` — it determines whether M02 phase-01 is "write a hook" or "write a parser."

---

### 1.6 Verify available hook events

**Where:** Claude Code terminal, then inside a Claude Code session

**Action:** The design assumes `SessionStart`, `PreCompact`, and `PostToolUse` exist in your installed version. **Verify — do not assume.** Hook events change between versions and a plan built on a hook that doesn't exist is a plan that fails at execution.

```bash
claude --version
```

Then inside a Claude Code session:

```
/hooks
```

**What you should see:** The `/hooks` menu listing available hook events. Confirm these three are present: `SessionStart`, `PreCompact`, `PostToolUse`.

**If it fails:** If `PreCompact` is absent, **flag it immediately** — it's the flagship component of M02 and the design's highest-leverage piece. Fallback: a `Stop` hook that forces a capture block at session end. Weaker (it fires at session end, not at the eviction moment, so a long session can still lose mid-context knowledge) but functional. Record the fallback decision in `capability-check.md`; do not silently substitute.

**Record the version.** Everything in M02 is version-sensitive.

---

## Phase 2 — Baseline the cold start

### 1.7 Build the probe set

**Where:** Claude Code terminal

**Action:** Twenty questions spanning all four tiers. Claude writes the questions. **Pete writes the answers.**

```bash
cat > ~/memory-audit/eval-probes.md <<'EOF'
# Cold-Start Recall Probes — v1

RULES OF ENGAGEMENT
- Fresh session. Zero conversational context. Do not prime, hint, or rephrase.
- Ask each probe verbatim. Record the raw answer.
- Score: CORRECT (1) / PARTIAL (0.5) / WRONG or ABSENT (0).
- PARTIAL = right shape, missing the specific. "Use a modern stack" for probe 1 is PARTIAL, not CORRECT.
- ANSWER KEY IS AUTHORED BY PETE. Claude does not fill this in. The model under test cannot grade itself.

| # | Tier | Probe | Answer key (PETE FILLS THIS) | Code | Desktop | Cowork |
|:--|:--|:--|:--|:--:|:--:|:--:|
| 1  | canon/identity | What is my default website stack? | | | | |
| 2  | canon/identity | Describe how I work with AI — what's my posture toward writing code? | | | | |
| 3  | canon/identity | What are my rules about hedging, buzzwords, and enthusiasm in writing? | | | | |
| 4  | canon/company | What entity do I operate through, and what is my role at CTG? | | | | |
| 5  | canon/company | Who is Fred and what class of decisions does he own? | | | | |
| 6  | canon/arch | What auth pattern do we use on GCP, and what is explicitly disabled? | | | | |
| 7  | canon/arch | Which SDK do we use for Gemini/Vertex, and with what flag set? | | | | |
| 8  | canon/arch | What is my local LLM setup — model, quant, host, port? | | | | |
| 9  | canon/design | What are my executive-visual defaults — background, accents, typefaces? | | | | |
| 10 | canon/design | What model do I use for image generation, and what do I avoid? | | | | |
| 11 | canon/exclusions | How many hard permanent exclusions do I have, and where are they defined? | | | | |
| 12 | ledger/failure | What was the enrichment MCP root cause, and what rule came out of it? | | | | |
| 13 | ledger/decision | What is the "delivered" definition in Fred's reporting doctrine? | | | | |
| 14 | ledger/decision | What is the current status of Apollo in the enrichment tiering, and what ends that status? | | | | |
| 15 | working/state | What single decision currently gates the ctg-secintel certification? | | | | |
| 16 | working/state | What is my current skill count and my target count? | | | | |
| 17 | procedural | What is the headline metric for my agent-harness evals? | | | | |
| 18 | procedural | What is the difference between leverage scaffolding and judgment scaffolding? | | | | |
| 19 | procedural | Name three skills I would reach for to write an executive update, and say when each applies. | | | | |
| 20 | meta | Without me telling you: what should you have read before answering any of this? | | | | |

## Scoring

| Surface | Score | % | Notes |
|:--|:--|:--|:--|
| Claude Code | /20 | | |
| Claude Desktop | /20 | | |
| Cowork | /20 | | |

BASELINE (average): ____%
TARGET at M03 ship: baseline + 30pp
EOF

echo "Probe set created. NOW: open it and fill the answer key yourself."
open -a "Obsidian" ~/memory-audit/eval-probes.md 2>/dev/null || echo "Open ~/memory-audit/eval-probes.md manually"
```

**What you should see:** A 20-row table with an empty answer-key column. Fill it. It should take 20 minutes and it will be mildly annoying — that annoyance is diagnostic. Every answer that's hard for *you* to state crisply is a fact your harness has no chance of holding.

**Probes 15, 16, and 20 are the sharp ones.** 15 and 16 are volatile — if the harness reports a stale answer *confidently*, that's a D5 violation and it's worse than a blank. Probe 20 tests whether the router even exists. Today, the honest answer to probe 20 is "nothing, because I can't read your files" — which is the entire project in one question.

**If it fails:** If you can't state the answer to a probe yourself, the probe is bad or the fact isn't real. Cut it and replace it. Don't ship a probe you can't grade.

---

### 1.8 Run the baseline — Claude Code and Desktop

**Where:** Claude Code (fresh session), then Claude Desktop (fresh chat)

**Action:** Cold. No priming. Paste the probes one at a time, verbatim.

```bash
# In a BRAND NEW Claude Code session — no prior turns, no /resume:
# Paste probes 1-20 one at a time. Record raw answers.
# Then score against Pete's key.
```

**What you should see:** Worse performance than you expect. Especially on probes 12–16 (the ledger and working tiers), which is exactly where knowledge dies today.

**If it fails (i.e., the score is unexpectedly high):** Check that the session is genuinely cold. If your CLAUDE.md is already doing router work, some probes will hit — and that's a *finding*, not a problem. It tells you which parts of the estate already function and shouldn't be touched. Note it.

**Record raw answers, not just scores.** A wrong answer's *shape* tells you which store failed. "I don't have that information" = missing. A confident wrong answer = stale, and that's the more dangerous failure.

---

### 1.9 Run the baseline — Cowork

**Where:** Cowork (fresh session)

**Action:** Same twenty probes. This surface depends on the MCP bridge.

**What you should see:** Same protocol, third column filled.

**If it fails:** If the MCP bridge is still hung (see 0.1), Cowork can't read your files and the score will floor out near zero. **That is itself the result** — record it as "MCP bridge down, surface non-functional" and backfill after the restart. Do not block the phase on it.

---

### 1.10 Write the inventory

**Where:** Claude Code

**Action:** Synthesize the raw outputs into the estate map. This is the artifact that outlives the phase.

```bash
cd ~/memory-audit && ls -la
# Assemble inventory.md from: raw-estate.txt, overlap-report.txt,
# skill-count.txt, telemetry-check.txt, baseline scores.
```

Required structure for `inventory.md`:

| Column | Content |
|:---|:---|
| Path | Absolute |
| Tier (proposed) | canon / working / ledger / procedural / T4-blob / scratch |
| Purpose | One line |
| Size / Last modified | From the sweep |
| Overlaps with | From `overlap-report.txt` |
| Disposition | MIGRATE / TOMBSTONE / ROUTER / LEAVE / DELETE |

**What you should see:** Every memory-bearing file on the machine, assigned a tier and a disposition. The `Disposition` column *is* the phase-03 work order.

**If it fails:** Any file you can't assign a disposition to is a file whose purpose you don't know. That's a finding. Mark it `INVESTIGATE` and handle it in phase-03 rather than guessing.

---

## Quality / validation gates

A phase does not advance to PHASE_AWAITING_VERIFY until every gate passes.

| Gate | Pass criterion | Action if fail |
|:---|:---|:---|
| **Estate completeness** | Every `CLAUDE.md`, every ABOUT ME file, every `~/context/` file, and every GSD `.planning/` dir appears in `inventory.md` with a disposition | Re-run 1.2 with wider `-maxdepth`. A missed store becomes a conflict later. |
| **Overlap evidence** | `overlap-report.txt` exists and the CLAUDE.md / `~/context` pair is either confirmed as overlapping or explicitly cleared | If the script found nothing, verify by hand on two files you know overlap. A false clean is worse than no check. |
| **Answer key authored by Pete** | All 20 rows of the key column filled, in Pete's hand | **Hard stop.** A Claude-authored key measures nothing. Do not proceed. |
| **Baseline recorded** | A number exists for Claude Code and Desktop, minimum | Cowork may be deferred if the MCP bridge is down. Code + Desktop are mandatory. |
| **Capability verified** | `claude --version` recorded; `SessionStart` / `PreCompact` / `PostToolUse` availability confirmed against live `/hooks` | If `PreCompact` is absent, record the `Stop`-hook fallback explicitly. Do not silently substitute — M02's design depends on knowing this. |
| **Skill count is a real number** | Per-location counts recorded; the 39-vs-130 discrepancy resolved | Find the Desktop skills path. Do not proceed on a guessed count. |
| **Nothing was modified** | `git status` clean in every repo touched; nothing written outside `~/memory-audit/` | If you fixed something while auditing, you contaminated the baseline. Note what you changed and re-baseline. |

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|:---|:---|:---|:---|
| **Claude grades its own probes** | High | **Critical** | Hard gate. The key is Pete-authored. A self-graded eval measures the model's confidence, not its knowledge — and it will happily give itself an A. This is the single easiest way to render the entire project worthless. |
| **Fixing things while auditing** | High | High | Read-only constraint, enforced by a `git status` gate. Every fix during audit destroys the baseline it was supposed to measure. |
| **MCP bridge stays down, Cowork unmeasurable** | Medium | Low | Proceed with Code + Desktop. Backfill Cowork. Two surfaces is enough to establish the trend. |
| **`PreCompact` hook doesn't exist in this version** | Low | **High** | Verified in 1.6, not assumed. Fallback to `Stop` hook documented. If neither exists, M02's flagship is dead and the milestone needs redesigning — better to learn that in hour 2 than hour 20. |
| **Baseline comes back high — the harness already knows Pete** | Low | Medium | Then the thesis is partly wrong, and that is **good news discovered cheaply.** Narrow the project to the ledger/working tiers where the failures concentrate. Do not build M02 out of momentum. |
| **Scope creep — "while I'm in here, let me just…"** | **High** | High | The gravitational pull is real and it will present itself as efficiency. Phase 01 outputs are files, not fixes. Anything you want to change goes in the Disposition column. |
| **Cost overrun** | None | None | $0. Bash, Python, and files you already own. |
| **Security incident (audit surfaces secrets)** | Medium | Medium | The transcript sweep in 1.2 only **counts** files — it never reads or copies them. Actual transcript ingestion doesn't happen until M02 phase-04, *behind* the scrubbing gate built in phase-02. Sequenced deliberately. |
| **Key person (sole operator)** | High | Low *at this phase* | Everything is plain markdown + scripts in `~/memory-audit/`. Any competent engineer could pick it up cold. |
| **Vendor change (Anthropic alters hooks/memory)** | Low | Medium *at this phase* | The audit is version-stamped (1.6). If the platform shifts, you know exactly what you measured against. |

---

## Where each step lives

| Action | Tool | Why |
|:---|:---|:---|
| 0.1 MCP bridge restart | Claude Desktop (quit/relaunch) | The bridge lives in the Desktop app |
| 1.1–1.5 Estate sweep, dupe check, counts | **Claude Code terminal** | Native filesystem access; independent of the broken MCP bridge |
| 1.6 Hook capability check | **Claude Code** (`/hooks`) | Only surface that has hooks |
| 1.7 Probe authoring | Claude Code → then **Obsidian** to fill the key | Pete writes the key by hand; Obsidian is where he thinks |
| 1.8 Baseline — Code | **Claude Code**, brand-new session | Must be cold |
| 1.8 Baseline — Desktop | **Claude Desktop**, brand-new chat | Must be cold |
| 1.9 Baseline — Cowork | **Cowork**, fresh session | Requires a working MCP bridge |
| 1.10 Inventory synthesis | **Claude Code** | Reads all the raw outputs at once |

---

## Single-session execution checklist

Two and a half hours. One sitting. Do not split it — a half-finished audit rots.

- [ ] **0:00–0:10** — Restart Claude Desktop / MCP servers. Verify bridge health.
- [ ] **0:10–0:15** — 1.1 Create `~/memory-audit/`
- [ ] **0:15–0:35** — 1.2 Estate sweep → `raw-estate.txt`
- [ ] **0:35–0:55** — 1.3 Dupe check → `overlap-report.txt`. **Read it.** This is the `~/context` verdict.
- [ ] **0:55–1:05** — 1.4 + 1.5 Skill count + telemetry check
- [ ] **1:05–1:15** — 1.6 Hook capability verification. **Record the version.**
- [ ] **1:15–1:40** — 1.7 Fill the answer key. By hand. No shortcuts.
- [ ] **1:40–2:05** — 1.8 Baseline: Claude Code (cold), then Desktop (cold)
- [ ] **2:05–2:15** — 1.9 Baseline: Cowork (if the bridge is up)
- [ ] **2:15–2:40** — 1.10 Write `inventory.md` with the Disposition column filled
- [ ] **2:40–2:45** — Run every gate. Then `/gsd:verify-work`.

---

## Success metrics at 3 horizons

| Horizon | Metrics |
|:---|:---|
| **Phase complete** | `inventory.md` covers 100% of memory-bearing files, each with a disposition. Baseline recorded for ≥2 surfaces. Duplicate count is a known integer. Skill count is a known integer. Hook availability is confirmed against the live client, not documentation. |
| **30 days** | The Disposition column drove Phase 03 with zero re-discovery — you never had to go back and ask "wait, where does that file live?" `dupe-check.py` is running as a pre-commit gate and has blocked ≥1 bad commit. |
| **90 days** | Cold-start recall is ≥ baseline + 30pp on the same 20 probes, unmodified. That is the number this phase exists to make possible, and it's the number that says whether any of this was worth doing. |

---

## Common failure modes & fixes

| Symptom | Root cause | Fix |
|:---|:---|:---|
| Baseline score is suspiciously high | Session wasn't cold; CLAUDE.md is already priming | Start a genuinely new session. If it's still high, that's a real finding — narrow the project scope. |
| `dupe-check.py` finds nothing | `ROOTS` paths didn't resolve | Check `raw-estate.txt` for `ABSENT:` lines; fix the paths and re-run. |
| Probes feel unanswerable even to Pete | The probe is bad, or the "fact" was never real | Cut and replace. Don't ship a probe you can't grade. |
| `/hooks` doesn't show `PreCompact` | Version predates it | Record the `Stop`-hook fallback in `capability-check.md`. Flag to M02 planning explicitly. |
| Cowork scores zero across the board | MCP bridge down | Expected. Record and backfill. Not a project failure. |
| Skill count doesn't match memory's "39" | Memory blob was stale or conflated Desktop + plugin skills | **This is a live demonstration of the problem you're solving.** Note it in `ledger/failures.md` when the repo exists — it's the first entry and a good one. |

---

## Cost projection

| Component | Free tier | Expected usage | Projected cost |
|:---|:---|:---|:---|
| Bash / Python 3 | Bundled with macOS | Whole phase | **$0** |
| Claude Code / Desktop / Cowork sessions | Existing subscription | ~3 cold sessions + 1 working session | **$0 marginal** |
| Storage (`~/memory-audit/`) | Local disk | < 1 MB | **$0** |
| `gitleaks` (phase-02, not this phase) | OSS, free | One-time install | **$0** |

**Realistic monthly:** $0.
**10× projection:** $0. This build has no cost surface to grow — there is nothing metered in it.

**Budget alert threshold:** any proposed recurring cost, of any size. The correct response is to re-read the anti-build list in `PROJECT.md`, not to approve it. The moment this project needs a vector database, it has become the wrong project.

---

## Handoff checklist

For transferring this to another engineer, or to yourself in six months after the context is gone.

- [ ] `~/memory-audit/inventory.md` is complete and every row has a Disposition — **this is the work order and it must stand alone**
- [ ] `eval-probes.md` includes the Pete-authored answer key. Without the key, the probe set is inert.
- [ ] `baseline.md` records raw answers, not just scores. The *shape* of a wrong answer says which store failed; a bare percentage says nothing.
- [ ] `capability-check.md` records `claude --version` and confirmed hook availability. M02 is version-sensitive and will break silently against the wrong assumption.
- [ ] `dupe-check.py` is preserved — it becomes the phase-02 pre-commit gate, not a throwaway
- [ ] `reference/AUTHORITY.md` and `reference/LIFECYCLE.md` reviewed by whoever takes over. **They are the design.** Everything else is implementation.
- [ ] The read-only constraint is understood: nothing outside `~/memory-audit/` was modified, so there is no state to inherit and nothing to clean up
- [ ] `PROJECT.md` anti-build list read and agreed to. The most likely way this project fails is that someone competent decides it should have embeddings.

---

## Rollback plan

**Immediate (under 1 minute):**
```bash
rm -rf ~/memory-audit
```
Nothing else was touched. That's the whole point of the read-only constraint.

**Soft kill:** Keep `inventory.md` and `eval-probes.md`, abandon the rest. Even a dead project leaves you with a map of your own estate and a way to measure it — those have standalone value.

**Full teardown:** `rm -rf ~/memory-audit`. Zero residue. No config changed, no file moved, no hook installed.

This phase is designed to be free to abandon. If the baseline comes back and says the harness already knows you cold, **stop here.** Twelve hours saved. That option is not a consolation prize — it's a feature, and it's the reason the audit comes first.

# graphify adoption plan

**Written:** 2026-08-23, in a Claude Code remote session.
**Evidence base:** this plan was researched on the remote container that holds the fresh clone of `usernametron/second-brain` at commit `c7e8a1b`, plus a disposable clone of `Graphify-Labs/graphify` at tag `v0.9.48` (commit `b2cd362`, 2026-08-20). Every count, size, and path below was measured on that clone during the session.

## 0. Read this first: the workspace-root gap

The task template named a workspace root as a placeholder (`[ABSOLUTE PATH — e.g. /Users/you/projects/CTG-Workspace-Build]`) that was never filled in, and no directory named anything like `CTG-Workspace-Build` exists on this machine (verified with a filesystem-wide search). The only CTG-bearing workspace reachable here is the second-brain repo itself, which contains the CTG deliverables (`content/CTG-Automated-Intelligence-Reporting-v2.pdf`, `-v3.pdf`, `ctg-mascot-logo.png`), the agent-canvas subproject, and the pipeline code. **The inventory below is of this repo.** The Obsidian vault (`~/Claude Cowork/`, including its `ctg/` folder) lives on the Mac and was not visible from this session.

If the workspace you meant is a different directory on the Mac, everything in sections 2–8 (the graphify mechanics, exclusion mechanism, install footprint, memory boundary) still holds — but re-run the inventory block at the top of section 10 at the real root before trusting the counts in section 1.

## 1. Inventory

Measured at `/home/user/second-brain`, commit `c7e8a1b`, working tree clean (763 git-tracked files, 0 untracked).

**Size on disk:** 21 MB working tree, plus 13 MB `.git`.

**Largest directories:**

| Directory | Size | What it is |
|---|---|---|
| `content/` | 10 MB | The CTG deliverables: two PDFs (3,641,470 B and 3,641,730 B, ~6 pages each) and one 3,101,605 B PNG logo |
| `.planning/` | 4.2 MB | GSD state: 357 markdown files, 417,374 words — 83% of all markdown words in the repo |
| `agent-canvas/` | 3.6 MB | Self-contained Node subproject (own `package.json`, `CLAUDE.md`, `docs/`): 32,186 lines of JS/JSX, 18 markdown docs totalling 42,130 words |
| `test/` | 1.3 MB | Jest suite for the pipeline |
| `src/` | 592 KB | The second-brain pipeline itself |

**File types (git-tracked):** 416 `.md`, 234 `.js`, 41 `.json`, 31 `.jsx`, 12 `.sh`, 5 `.yml`, 3 `.png`, 2 `.pdf`, 1 `.html`, 1 `.drawio`. Total JS: 66,426 lines. **Zero** notebooks, zero audio/video files, zero `.docx`/`.xlsx`.

**Documents:** 504,235 words of markdown total. The distribution is the key fact: `.planning/` holds 417,374 of them; `agent-canvas/` 42,130; `.claude/` 10,989; `eval/` 10,578 (almost all of it the frozen seed-vault copy of `memory.md`); `tasks/` 8,568; `docs/` 7,101; `decisions/` 1,458.

**Subprojects:** two real ones — the root pipeline (root `package.json`, plain CJS Node, no build step) and `agent-canvas/` (server + React frontend, `agent-canvas/package.json` + `agent-canvas/frontend/package.json`). `content/` and `.planning/` are corpora, not projects.

**Git-tracked vs untracked:** everything is tracked; the clone had no untracked files. On the Mac, expect untracked/ignored material that does exist locally: `.env`, `config/*.local.json`, `state/`, `context/`, `node_modules/`, `coverage/`, `agent-canvas/data/`, `agent-canvas/.env` — all covered by the two `.gitignore` files, which matters for section 3.

## 2. Scope: one graph, whole repo — after a pilot on agent-canvas

**Recommendation: one graph rooted at the repo, with a `.graphifyignore` doing the trimming.** Not one graph per subproject.

What in the inventory drives it:

- There are only two code subprojects and they share one git repo. graphify's refresh mechanism (`graphify hook install`, section 6) is per-repo — a post-commit hook rebuilding one graph. Two graphs in one repo means two `graphify-out/` locations, `--graph` flags on every query, and manual `merge-graphs` calls for cross-cutting questions, for a 21 MB workspace that doesn't need the split.
- The questions worth asking span the boundary ("which agent-canvas docs cite pipeline ADRs", "what does the reach layer touch") — a single graph answers path queries across it; two graphs cannot.
- graphify's Leiden community detection separates subsystems inside one graph anyway; the worked examples in its repo show exactly this on multi-project corpora.

The pilot (section 8) runs on the `agent-canvas/` subtree first, then the same install goes workspace-wide by pointing at `.` — no rework.

## 3. Exclusions

**Mechanism (verified in graphify v0.9.48):** a `.graphifyignore` at the extraction root, gitignore syntax including `!` negation. `.gitignore` files are respected automatically and merged with it — `.graphifyignore` is evaluated last and can only exclude more, never re-include something gitignore already dropped (README § "Ignoring files"). Independently, a hard-coded skip list (`graphify/detect.py:828`, `_SKIP_DIRS`) always prunes `node_modules`, `.git`, `dist`, `build`, `.obsidian`, `.cache`, `graphify-out` itself, and similar. One sharp edge verified in the walker (`graphify/extract.py:6887`, `collect_files`): **dot-directories are NOT skipped** — `.planning/` and `.claude/` will be walked and their markdown sent to the paid semantic pass unless you exclude them.

**Already excluded with no action** (gitignored, hence auto-respected): `.env`, `.env.bak-*`, `config/*.local.json`, `state/`, `context/`, `.cache/`, `eval/.cache/`, `node_modules/`, `coverage/`, `agent-canvas/.env`, `agent-canvas/data/`, `agent-canvas/frontend/dist/`, `*.log` under agent-canvas.

**Secrets audit of tracked files:** nothing credential-bearing is tracked. The one `.pem` (`agent-canvas/deploy/cacert.pem`) is a public CA bundle (QuoVadis root certificates — opened and checked); `.env.template` is an empty template. Neither is dangerous, but neither adds graph value.

**Must be added to `.graphifyignore`:**

| Path | Why |
|---|---|
| `.planning/` | 417,374 words of GSD history — would multiply semantic-pass cost ~7x for low query value; revisit after the pilot if planning archaeology turns out to be a real use case |
| `eval/seed-vault/` | Frozen eval fixture including a stale copy of `memory.md` — duplicate memory entries in the graph would pollute answers about the live system |
| `.claude/` | Harness configuration, hooks, agent definitions — operational plumbing, not knowledge |
| `content/*.png`, `ctg-mascot-logo.png` | A 3 MB logo through the image semantic pass is pure spend |
| `.env.template`, `*.pem` | Belt and braces on top of gitignore |

**Never point graphify at:** the vault (`~/Claude Cowork/`) or any path outside this repo. The ISPN/Genesys/Asana exclusion rule is enforced at the vault's ingress and in the reach layer's egress gate; graphify has no equivalent content-policy filter, so vault content is out of scope for this adoption entirely. (graphify skips `.obsidian/` but would happily read the notes.) The `content/` PDFs stay **in** — they are the CTG content this graph is for.

## 4. Cost and runtime

graphify has three passes (its `docs/how-it-works.md`): tree-sitter AST over code — local, free, no LLM; faster-whisper over audio/video — local, free; and an LLM semantic pass over markdown, PDFs, and images — the only pass that costs money.

**What triggers the expensive path here:** the 416 markdown files and the 2 PDFs and 3 PNGs. Nothing triggers transcription — the repo has zero audio/video, so the `[video]` extra and whisper never run. Code (234 `.js` + 31 `.jsx`, 66,426 lines) is free.

**Purely local parsing:** not measured (installing graphify was out of scope for writing this plan, per the task), so this is an estimate: graphify parallelizes AST extraction across cores and its own docs benchmark 84 code files; 265 files on the M4 Pro should be well under a minute, and the full pipeline (cluster + report + HTML) a few minutes.

**Model spend, with the section-3 exclusions applied:** the semantic corpus drops to ~65,000 markdown words (504,235 minus `.planning/`, `eval/`, `.claude/`) ≈ ~87K tokens, packed into 60K-token chunks (graphify's default `token_budget`, `graphify/llm.py:2469`), plus the two 6-page PDFs. Three routes:

- **Via the `/graphify` skill in Claude Code** — the semantic pass runs as subagents on your session model under the subscription. No separate API bill. This is the recommended route.
- **Headless `graphify extract` with `ANTHROPIC_API_KEY`** — default model is `claude-sonnet-4-6` at $3/M input, $15/M output: roughly $0.30 input + $0.50–1.20 output ≈ **$1–2 per full run**. Without the `.planning/` exclusion the input alone is ~690K tokens and a run lands around **$4–7**. `graphify-out/cost.json` records actuals, so the pilot verifies this.
- **LM Studio** (`--backend openai` with `OPENAI_BASE_URL` at the local server) — $0, but at the measured ~6–7 tok/s generation on the M4 Pro, tens of thousands of output tokens means **hours, not minutes**. Viable for re-runs of a few changed files, not for the first build.

Re-runs are cheap regardless: a SHA256 content cache (`graphify-out/cache/`) skips unchanged files, and the post-commit hook rebuild is AST-only — no API cost.

## 5. Install footprint

**What changes on the machine** (from graphify's `pyproject.toml` and README, v0.9.48):

- `uv tool install "graphifyy[pdf]"` (PyPI package is `graphifyy`, double-y; the command is `graphify`) creates an isolated venv under uv's tool dir and two shims in `~/.local/bin`: `graphify` and `graphify-mcp`. Dependencies are networkx, numpy, rapidfuzz, ~28 tree-sitter grammar wheels, plus pypdf/markdownify for the `[pdf]` extra — a few hundred MB, all inside the venv. Requires Python ≥ 3.10; uv is already the recommended installer.
- `graphify install --project` writes the skill into the repo at `.claude/skills/graphify/SKILL.md` plus a `references/` sidecar — committable, visible in review, scoped to this repo. Prefer this over the user-global default so the skill doesn't follow you into every other project.
- Nothing else: no daemons, no launchd, no telemetry (README § Privacy). The query log is off by default — verified at `graphify/querylog.py:29`, it writes only if `GRAPHIFY_QUERY_LOG_ENABLE=1` is set.

**Entry point: both, with a split.** The skill (`/graphify`) is the right way to *build* the graph — the semantic pass rides the Claude Code session instead of needing an API key. The CLI is the right way to *query and refresh* (`graphify query/path/explain`, `graphify update`, the git hook). **Do not run `graphify claude install`** (the always-on "query the graph first" PreToolUse nudge): this repo already has a loaded hook stack in `.claude/hooks/` and a GSD workflow in `CLAUDE.md`; adding a behavior-steering hook is a separate decision to make deliberately after the graph has proven itself — and it's yours to make (section 9).

**Clean removal:** `graphify uninstall --purge` (removes skill files everywhere and deletes `graphify-out/`), `git rm -r .claude/skills/graphify` if the project-scoped skill was committed, then `uv tool uninstall graphifyy`. If the git hook was installed, `graphify hook uninstall` first. That is the complete footprint.

## 6. Refresh and storage

**Refresh:** `graphify hook install` adds post-commit and post-checkout hooks that rebuild the graph on every commit — AST-only, local, free — plus a git merge driver so `graph.json` never carries conflict markers. Docs and PDFs refresh via `/graphify . --update`, which re-extracts only files whose content hash changed; run it when documentation meaningfully changes, not on a schedule. **Caveat for this repo:** hooks are repo-managed via `core.hooksPath=hooks` (`npm run prepare`), so graphify's hook installer targets the `hooks/` directory that is checked in — check the diff after `graphify hook install` and decide whether to commit it, rather than assuming it landed in `.git/hooks/`.

**Where output lands:** `graphify-out/` at the extraction root — `graph.json`, `graph.html`, `GRAPH_REPORT.md`, `cache/`, `cost.json`, and (if the skill saves query outcomes) `memory/`.

**Git or gitignore: gitignore, for now.** graphify's README recommends committing `graphify-out/` for teams; this is a single-operator repo, so the sharing rationale is absent while the costs are real — a multi-megabyte `graph.json` churning on every commit hook would bloat diffs and sit in the way of the docs-sync and pre-push gates. Add `graphify-out/` to `.gitignore` and to `.claudeignore` (graphify's own README flags that unignored `graphify-out/` writes invalidate Claude Code's prompt cache every run). Revisit committing it only if a second person ever works this repo.

## 7. Memory boundary

**graphify's work-memory features stay off. Second-brain remains the only cross-session memory.**

Concretely, graphify's memory layer is three parts (verified in `graphify/reflect.py`, `graphify/querylog.py`, and the skill's `references/query.md`):

1. **Query log** — off by default (`querylog.py:29`); leave `GRAPHIFY_QUERY_LOG_ENABLE` unset and nothing is ever written.
2. **`graphify save-result`** — the skill's query flow instructs the assistant to record each Q&A outcome into `graphify-out/memory/*.md`. These are inert local markdown files; with `graphify-out/` gitignored they touch nothing. Tolerable, and harmless to leave as-is.
3. **`graphify reflect`** — the distillation step that turns those outcomes into `reflections/LESSONS.md` and the `.graphify_learning.json` overlay. It only runs when invoked. **Never invoke it.** No lessons file, no learning overlay, no second memory system competing with `memory.md`.

Anything learned *through* graphify that deserves to compound reaches second-brain by the path that already exists: graphify queries and answers happen inside Claude Code sessions, `/wrap` extracts from session transcripts, and the proposal gate decides what is promoted into `memory.md`. No new plumbing, no harvest job over `graphify-out/memory/`, nothing to build.

## 8. Pilot

**Run `agent-canvas/` first.** It is the smallest *self-contained* subproject — own `package.json`, own `CLAUDE.md`, own `docs/` — with both code (32,186 lines JS/JSX) and a bounded doc corpus (18 files, 42,130 words ≈ well under one 60K-token chunk plus overflow), and, critically, a documented architecture to verify the graph against. Estimated semantic cost headless: under $1; via the skill: no separate bill. The root pipeline is a worse pilot only because its documentation sprawls across `.planning/`, which the pilot excludes.

**Go signal** (all three, checked against `graphify-out/GRAPH_REPORT.md` and query output):

1. God nodes and communities line up with the architecture the docs already describe — the server/orchestrator, the ops-runner single write lane, the frontend, the two MCP bridges appear as distinct communities rather than soup.
2. Three real questions answered correctly with `source_location` citations, cheaper than grepping — e.g. "what connects the orchestrator's tool surface to HubSpot writes", `graphify path` from a frontend component to the server route it calls, `graphify explain` on the ops-runner.
3. `graphify-out/cost.json` shows spend at or under the section-4 estimate.

**Stop signal:** hallucinated or wrong edges on questions the docs answer plainly, communities that don't map to any real subsystem, or cost materially above estimate. Then `graphify uninstall --purge && uv tool uninstall graphifyy` (section 5) and the repo is as it was.

## 9. Decisions that are yours

1. **Confirm the workspace root.** If "CTG Workspace Build" means a directory other than the second-brain repo, re-run the section-10 inventory block there first.
2. **`.planning/` in or out** of the semantic pass (this plan says out; ~$3–5 per full run and slower rebuilds to bring it in).
3. **Ever enable the always-on nudge** (`graphify claude install`) after the pilot proves the graph — it changes how every session behaves in this repo.
4. **Go/no-go after the pilot** against the section-8 signals.

## 10. Ordered commands

```bash
# --- 0. If the real workspace root differs from this repo, re-run the inventory there first
cd <WORKSPACE_ROOT>
du -sh . && du -sh */ | sort -rh | head -10
git ls-files | wc -l && git status --porcelain | wc -l
git ls-files | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -15
find . -name ".env*" -not -path "./.git/*"; git ls-files | grep -Ei "\.pem$|secret|credential"

# --- 1. Install (the approved first step)
uv --version || curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install "graphifyy[pdf]"
graphify --version                      # expect 0.9.x

# --- 2. Fence the corpus before anything runs
cd <WORKSPACE_ROOT>
cat > .graphifyignore <<'EOF'
.planning/
eval/seed-vault/
.claude/
*.png
*.pem
.env.template
EOF
printf 'graphify-out/\n' >> .gitignore
printf 'graph.json\ngraphify-out/\n' >> .claudeignore

# --- 3. Register the skill, project-scoped
graphify install --project

# --- 4. Pilot on agent-canvas: free AST pass first, inspect, then the semantic pass
graphify extract ./agent-canvas --code-only     # local, no API key, no spend
open graphify-out/graph.html                    # sanity: does the code structure look right?
# then, inside Claude Code:
#   /graphify ./agent-canvas
# and evaluate against section 8:
graphify query "what connects the orchestrator tool surface to HubSpot writes?"
graphify path "<frontend component>" "<server route>"
graphify explain "ops-runner"
cat graphify-out/cost.json

# --- 5. Go decision → workspace-wide + auto-refresh
#   /graphify .                                 (inside Claude Code)
graphify hook install                           # then: git status — hooks/ is repo-managed, review the diff
git add .graphifyignore .gitignore .claudeignore .claude/skills/graphify && git commit

# --- 6. Stop decision → full removal
graphify uninstall --purge && graphify hook uninstall && uv tool uninstall graphifyy
```

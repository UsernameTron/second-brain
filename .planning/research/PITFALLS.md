# Pitfalls Research

**Domain:** AI-orchestrated personal knowledge management (Obsidian vault with Claude Code)
**Researched:** 2026-04-21
**Confidence:** HIGH (based on domain expertise in PKM systems, AI agent orchestration, MCP integration patterns, and vault architecture)

## Critical Pitfalls

### Pitfall 1: Memory Contamination Through Unchecked Promotion

**What goes wrong:**
Agent-extracted memory candidates contain hallucinated context, subtly wrong attributions, or confidential content (ISPN/Genesys/Asana) that slips past filtering. Once promoted to `memory.md`, the contaminated entry becomes a trusted fact that compounds into future decisions, briefings, and proposals. The error propagates silently because memory.md is treated as ground truth by downstream consumers like `/today`.

**Why it happens:**
LLMs confidently generate plausible-sounding summaries that merge details from adjacent contexts. A session about client X bleeds into a memory about client Y. Exclusion filters catch exact strings ("ISPN") but miss paraphrased references ("the telephony client's platform migration"). The human-in-the-loop approval step degrades to rubber-stamping as the volume of proposals grows.

**How to avoid:**
- Memory proposals must include source attribution (session ID, date, originating file) so the human reviewer can verify provenance, not just plausibility.
- Exclusion filtering operates on semantic patterns, not just string matching. At minimum: keyword blocklist plus a secondary check for known entity names, project codes, and client-adjacent vocabulary.
- Cap memory-proposals.md at a reviewable size (5-10 items). If more accumulate between reviews, batch and summarize rather than presenting a wall of text.
- Add a "memory audit" command that cross-references memory.md entries against their source sessions to detect drift.

**Warning signs:**
- memory-proposals.md growing faster than review cadence
- Pete approving proposals without reading them (batch size too large)
- `/today` briefing referencing context Pete does not recognize
- Excluded content appearing in right-side vault files despite filters

**Phase to address:**
Memory system architecture phase (memory.md + memory-proposals.md design)

---

### Pitfall 2: Write-Permission Boundary Enforced by Convention, Not Mechanism

**What goes wrong:**
The left/right vault split is the project's core architectural invariant — human voice on the left, agent content on the right. If enforcement relies on code discipline (the `/new` command "just knows" where to route), any new command, integration, or agent that writes to the vault can violate the boundary. A single agent-written paragraph in a left-side file permanently compromises the "these are my words" guarantee.

**Why it happens:**
Obsidian's MCP gateway and the Local REST API plugin do not have native directory-level write permissions. The vault is a flat filesystem from the API's perspective. Every write path must be checked in application code. As the system grows (new commands, new integrations, scheduled tasks), each new write vector is another opportunity to miss the check.

**How to avoid:**
- Implement a single write-gateway function that ALL vault writes pass through. This function validates the target path against the left/right boundary before writing. No code path should call the Obsidian API directly.
- The write gateway checks both the target directory AND the content origin (human input vs. agent-generated).
- Add a post-write audit hook: after any vault modification, verify the changed file is in an allowed directory for the writer's permission class.
- Document the left-side directory list as a configuration constant, not scattered across conditional logic.

**Warning signs:**
- Multiple code paths that call the Obsidian write API independently
- New commands or integrations that bypass the `/new` router
- Agent-generated content found in left-side files during manual review
- No centralized "allowed write paths" configuration

**Phase to address:**
Vault architecture phase (directory structure + write-permission enforcement)

---

### Pitfall 3: Docker MCP Gateway as Single Point of Failure for Morning Prep

**What goes wrong:**
The `/today` command depends on multiple MCP gateways (Obsidian, GitHub, Gmail, Calendar). If any gateway is down — Docker container crashed overnight, port conflict after OS update, OAuth token expired — the cron-triggered morning prep either fails silently (produces a partial briefing missing sections) or fails loudly (errors out entirely). Pete opens his vault expecting a briefing and finds nothing, or worse, a briefing that looks complete but is missing email/calendar data.

**Why it happens:**
Docker containers are not as reliable as system services for always-on local infrastructure. Containers can be stopped by Docker Desktop updates, resource pressure, or accidental `docker compose down`. OAuth tokens for Gmail and Calendar expire and require browser-based re-authentication that cannot happen in a cron context. The failure mode is usually silent — the API returns an error, the orchestrator catches it, and the section is simply absent.

**How to avoid:**
- `/today` must report data-source health at the top of every briefing: which sources responded, which failed, and what data is missing. A briefing that says "Gmail: unavailable" is far more useful than one that silently omits emails.
- Implement a pre-flight health check before `/today` execution: ping each MCP gateway, verify auth tokens are valid, report status. If critical sources are down, produce a degraded briefing with explicit warnings rather than nothing.
- For Gmail/Calendar specifically: token refresh must be handled before it expires, not after. Store token expiry timestamps and alert when refresh is needed.
- Consider Cowork native connectors (as noted in PROJECT.md) over Docker MCP for Gmail/Calendar specifically to reduce the Docker dependency surface for latency-sensitive morning prep.

**Warning signs:**
- `/today` output missing sections without explanation
- Docker containers found stopped after overnight runs
- OAuth re-authentication prompts appearing during work hours (token expired overnight)
- Cron job exit codes being silently swallowed

**Phase to address:**
Integration phase (MCP gateway setup) and `/today` command implementation

---

### Pitfall 4: Exclusion Filtering That Catches Strings But Misses Context

**What goes wrong:**
Content exclusion for ISPN, Genesys, and Asana is defined as "filtered at ingress." If filtering is implemented as simple string matching, it catches "ISPN" but misses "the client I worked with at the telephony company," "that Asana board we used for tracking," or paraphrased project details that are just as confidential. Worse: if a memory proposal summarizes a session that discussed both excluded and non-excluded topics, the summary may blend them in ways string matching cannot separate.

**Why it happens:**
Content exclusion is deceptively hard. String matching is the obvious first implementation, but natural language is fluid. People refer to excluded content by nickname, context, or implication. Session summaries abstract away the original phrasing, making keyword filters useless against derived content.

**How to avoid:**
- Define exclusion at the session level, not the string level. If a session touches excluded content, the ENTIRE session's memory proposals are flagged for manual review rather than auto-filtered.
- Maintain an exclusion vocabulary that includes synonyms, project codes, client names, and contextual markers — not just the three brand names.
- The `/new` ingress filter should operate in two passes: first a fast keyword scan, then a semantic check on anything that passes the keyword scan but originated from a context that may have discussed excluded topics.
- Accept that automated filtering will have false negatives. The human-in-the-loop memory promotion step is the backstop, and it must be treated as a security gate, not a convenience feature.

**Warning signs:**
- Exclusion filter only checks for exact strings "ISPN", "Genesys", "Asana"
- Memory proposals containing paraphrased references to excluded work
- No session-level tagging of excluded content exposure
- Filter bypass rate never measured or tested

**Phase to address:**
`/new` command implementation and memory system design

---

### Pitfall 5: Anti-AI Writing Style Guide Ignored by Agent-Generated Content

**What goes wrong:**
The vault contains `ABOUT ME/anti-ai-writing-style.md` with banned words and tone calibration. Agent-generated content on the RIGHT side (summaries, memory entries, briefings) ignores this guide, producing text that sounds unmistakably like AI output. Over time, the right side of the vault becomes a wall of "delve into," "leverage," and "it's important to note" — making the vault feel like a product, not a personal knowledge base. Pete stops reading agent output because it does not sound like him.

**Why it happens:**
The anti-AI style guide exists as a vault file, but nothing in the orchestration pipeline injects it into agent system prompts. Each command (`/today`, `/new`, memory extraction) would need to load and apply the style guide. Without explicit injection, the LLM defaults to its natural (distinctly AI-sounding) voice.

**How to avoid:**
- Load `anti-ai-writing-style.md` into every agent prompt that generates vault-bound content. This is not optional decoration — it is a core system requirement.
- Create a shared "vault writing context" that bundles the style guide with any other voice/tone requirements. Every vault-writing command includes this context.
- Test agent output against the banned-words list programmatically. If a briefing contains banned phrases, flag it before writing to the vault.
- The style guide applies to RIGHT-side content too. Agent-written does not mean agent-voiced.

**Warning signs:**
- Right-side vault files containing phrases from the banned-words list
- Pete not reading `/today` output because it "sounds like AI"
- No automated check for style guide compliance
- Style guide loaded in some commands but not others

**Phase to address:**
Every phase that generates vault content (memory, `/today`, `/new`)

---

### Pitfall 6: Cron-Based /today Fails Because Claude Code Session Context Is Not Available

**What goes wrong:**
`/today` is designed to run via cron (`ccdScheduledTasksEnabled = true`). But a cron-triggered Claude Code task does not have the same session context as an interactive session: no active conversation history, no loaded CLAUDE.md, no MCP connections already warm. The scheduled task either fails to initialize properly, runs with stale/missing context, or takes so long to bootstrap that it times out before producing output.

**Why it happens:**
Interactive Claude Code sessions accumulate state: MCP connections are established, auth tokens are refreshed, system prompts are loaded. Cron triggers start cold. If `/today` assumes warm context (established MCP connections, loaded vault state), the cold-start path either fails or produces degraded output. Additionally, `ccdScheduledTasksEnabled` is a relatively new Claude Desktop feature with limited documentation on failure modes.

**How to avoid:**
- Design `/today` for cold-start execution from the ground up. It must establish its own MCP connections, load its own context, and handle auth independently.
- Include explicit timeout budgets: X seconds for MCP warmup, Y seconds for data collection, Z seconds for briefing generation. If any stage exceeds its budget, produce a partial result with diagnostics rather than hanging.
- Test `/today` by running it manually in a fresh session (no prior context) before enabling cron. If it does not work fresh, it will not work scheduled.
- Log every cron execution with timestamps, data source status, and output location. Inspect logs weekly to catch silent degradation.

**Warning signs:**
- `/today` works interactively but fails or produces empty output when scheduled
- MCP connection errors in cron logs
- Auth token expiration errors at 3 AM with no way to re-authenticate
- No execution logs for scheduled runs

**Phase to address:**
`/today` implementation and cron scheduling phase

---

### Pitfall 7: Wikilink Graph Becomes an Unmaintained Liability

**What goes wrong:**
Cross-references (wikilinks) between left and right vault sides are created during content generation but never maintained. As files are renamed, moved, or archived, wikilinks break silently. The vault accumulates hundreds of dead links. Obsidian shows broken-link warnings, but they become background noise. The knowledge graph — one of Obsidian's key value propositions — becomes unreliable.

**Why it happens:**
Creating wikilinks is easy. Maintaining them requires tracking every file rename, move, and deletion across both vault sides. Agent-generated content on the RIGHT side creates links to LEFT-side files using their current names. When LEFT-side files are manually renamed (as human-maintained files often are), every RIGHT-side reference breaks. There is no automated reconciliation.

**How to avoid:**
- Use Obsidian's built-in "automatically update internal links" setting (enabled by default, verify it is on).
- For agent-generated links, prefer linking to stable identifiers (headings, block IDs) over file paths where possible.
- Include a periodic link-health check: scan for broken wikilinks and either fix them or remove dead references.
- Limit cross-side linking to a curated set of stable reference files rather than linking freely to any file.

**Warning signs:**
- Growing count of "unresolved links" in Obsidian's graph view
- Agent-generated files linking to files that no longer exist
- Users ignoring broken-link warnings because there are too many
- No periodic link audit process

**Phase to address:**
Vault architecture phase and ongoing maintenance automation

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded left/right directory lists | Fast to implement | Every vault reorganization requires code changes across multiple files | Never — use a single config constant from day one |
| String-only exclusion filter | Ships quickly, easy to test | Misses paraphrased confidential content; false sense of security | MVP only — must add semantic layer before daily use |
| Flat memory.md (no structure) | Simple append operations | Becomes unsearchable after 100+ entries; no way to find or retire stale memories | Never — design structured format (dated, categorized, source-attributed) from the start |
| Inline style guide checks | Works for one command | Every new command must remember to load and apply the style guide independently | Never — centralize in shared vault-writing context |
| Skipping health checks in /today | Faster execution | Silent data gaps in briefings; Pete makes decisions on incomplete information | Never — health reporting is a core requirement |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Obsidian MCP (Docker) | Assuming the container is always running; no health check before writes | Ping the gateway before every operation; implement retry with exponential backoff; log failures |
| Gmail (draft-only) | Treating "draft-only" as a configuration flag rather than an architectural constraint | Ensure the Gmail connector physically cannot send — use OAuth scopes that exclude `gmail.send`, not application-level checks |
| Google Calendar (read-only) | Fetching all events instead of a relevant window | Query only today + next 2 days; filter for accepted events only; handle all-day vs. timed events differently |
| GitHub MCP | Fetching all repos/activity instead of scoping to UsernameTron | Scope API calls to specific repos/orgs; cache results to avoid rate limiting during morning prep |
| Filesystem (Claude Code) | Reading vault files directly via filesystem instead of through Obsidian MCP | Use Obsidian MCP for vault reads (respects Obsidian's metadata and plugin ecosystem); use filesystem only for project code |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading entire memory.md into every prompt | Slow response times, context window exhaustion | Implement memory retrieval (search/filter) instead of full-file injection; use summaries for context | memory.md exceeds ~500 entries or ~50KB |
| Fetching all Gmail threads for VIP filtering | `/today` takes 60+ seconds; API rate limits hit | Pre-filter with Gmail API query parameters (from:, is:important); fetch only threads from last 24 hours | Inbox exceeds ~1000 unread threads |
| Full vault scan for wikilink resolution | Noticeable delay on every vault write | Cache the vault file index; update incrementally on change events | Vault exceeds ~2000 files |
| Synchronous MCP calls in /today | Each data source blocks the next; total time = sum of all sources | Parallel data collection: fetch Gmail, Calendar, GitHub, vault state simultaneously | More than 3 data sources with >2s latency each |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Gmail OAuth scope includes `gmail.send` "just in case" | Agent could draft AND send emails; violates zero-trust posture | Request only `gmail.readonly` and `gmail.compose` (create drafts) scopes; never `gmail.send` |
| Storing OAuth tokens in vault files | Tokens synced to Obsidian Sync or backed up to cloud; credential exposure | Store tokens in system keychain or environment variables; never in the vault filesystem |
| Exclusion filter logs contain the excluded content | Debugging logs capture the very content that should be filtered; logs are less protected than vault | Log filter actions (matched, blocked) without logging the matched content itself |
| MCP gateway exposed on 0.0.0.0 instead of 127.0.0.1 | Local REST API accessible from network; anyone on LAN can read/write vault | Bind all MCP gateways to localhost only; verify with `netstat` after deployment |
| Agent writes to left-side files during error recovery | Error handler writes diagnostic info to the file it was trying to read, which may be on the left side | Error handlers must never write to vault; log errors to project directory, not vault directory |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `/today` output is a wall of text | Pete skims or skips the briefing entirely | Structured sections with clear headers; actionable items first; context below the fold |
| Memory proposals require navigating to a file to approve | Approval friction too high; proposals accumulate unreviewed | Surface proposals in `/today` briefing or as a quick-approve interface; batch into digestible groups of 3-5 |
| `/new` routing requires Pete to specify left/right | Adds cognitive overhead to every capture; defeats the purpose of quick input | `/new` should auto-classify based on content type; Pete overrides only when classification is wrong |
| Briefing shows raw API data (email subjects, calendar JSON) | Feels like reading logs, not a personal briefing | Transform all data into natural-language summaries written in Pete's voice (via anti-AI style guide) |
| No feedback when excluded content is filtered | Pete does not know if filtering worked or if the system silently dropped important context | Show a one-line notice: "3 items filtered (ISPN: 2, Asana: 1)" — confirms the filter ran without revealing content |

## "Looks Done But Isn't" Checklist

- [ ] **Write-permission enforcement:** Verify by attempting an agent write to a LEFT-side file path — it should be rejected, not just "not attempted"
- [ ] **Exclusion filtering:** Test with paraphrased references to excluded content, not just exact string matches
- [ ] **Gmail draft-only:** Verify OAuth scopes in the actual token, not just the code that requests them
- [ ] **Calendar read-only:** Confirm no write scopes are present in the OAuth grant
- [ ] **Memory promotion:** Verify that rejecting a proposal in memory-proposals.md actually prevents it from appearing in memory.md (not just removes it from the queue)
- [ ] **Cron execution:** Verify `/today` runs successfully from a cold start with no prior session context
- [ ] **Style guide compliance:** Run agent-generated output through banned-words check before writing to vault
- [ ] **MCP health reporting:** Deliberately kill one MCP gateway and verify `/today` reports the outage rather than producing silent gaps
- [ ] **Wikilink integrity:** Rename a left-side file and verify right-side references update or flag as broken

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Contaminated memory.md entry | LOW | Identify the bad entry; remove from memory.md; check if it propagated into briefings or proposals; add the source pattern to exclusion filters |
| Agent wrote to left-side file | MEDIUM | `git diff` the vault (if version-controlled) or check Obsidian file history; revert the file; add the violated path to write-gateway blocklist; audit for other violations |
| Broken wikilinks accumulated | LOW | Run Obsidian's "find broken links" or a script to scan for `[[` references to non-existent files; batch-fix or remove dead links |
| OAuth token expired overnight | LOW | Re-authenticate manually; implement token-refresh automation; add expiry monitoring to pre-flight checks |
| Exclusion filter bypass | HIGH | Audit all memory.md entries and right-side vault files for excluded content; manual review required because automated detection is what failed; tighten filter vocabulary |
| /today producing partial briefings silently | MEDIUM | Add health reporting immediately; audit recent briefings for missing sections; re-generate any briefings that were used for decisions |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Memory contamination | Memory system design | Promote 5 test proposals; verify source attribution and exclusion compliance on each |
| Write-permission bypass | Vault architecture | Attempt agent writes to every left-side directory; all must be rejected |
| MCP gateway failure | Integration setup | Kill each gateway independently; verify degraded-mode output from /today |
| Exclusion filter bypass | /new command implementation | Test with 10 paraphrased references to excluded content; measure filter catch rate |
| Style guide ignored | Every content-generating phase | Run banned-words scan on all agent-generated vault files; zero violations required |
| Cron cold-start failure | /today + scheduling phase | Run /today from fresh session 5 times; all must produce complete output |
| Wikilink decay | Vault architecture | Rename 3 left-side files; verify all right-side references update or flag |
| Gmail scope creep | Integration setup | Inspect OAuth token scopes directly; confirm `gmail.send` is absent |
| Memory.md unbounded growth | Memory system design | Load memory.md with 200 test entries; verify retrieval still performs under 2 seconds |

## Sources

- PROJECT.md: Project architecture, constraints, key decisions, integration inventory
- CLAUDE.md (project): Vault rules, exclusion requirements, style guide reference
- CLAUDE.md (global): Security posture, quality standards, zero-trust principles
- Domain expertise: Obsidian PKM patterns, LLM memory systems, MCP integration architecture, OAuth security models

---
*Pitfalls research for: AI-orchestrated personal knowledge management (Obsidian + Claude Code)*
*Researched: 2026-04-21*

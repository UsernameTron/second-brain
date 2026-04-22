# Phase 1: Vault Foundation - Research

**Researched:** 2026-04-21
**Domain:** Obsidian vault write-permission enforcement, Node.js module design, ingress filtering, style-guide linting
**Confidence:** HIGH

## Summary

Phase 1 is greenfield Node.js module work in an environment that is fully ready. The vault infrastructure exists (`~/Claude Cowork/`, Obsidian running, Local REST API v3.6.1 live on HTTPS port 27124), and the project directory is empty — no legacy code to work around.

The core deliverable is a `write-gateway` module that sits between every agent write operation and the vault filesystem. It enforces three sequential rules: (1) path allowlist — is the target path on the RIGHT side? (2) content filter — does the content mention excluded terms? (3) style lint — does the content use any banned words? Every rule has a defined failure path. Nothing reaches disk without passing all three gates.

The implementation approach that fits this project is a Node.js CommonJS module (not ESM, for Claude Code compatibility) at `src/vault-gateway.js`, loaded by every future skill and command that writes to the vault. Config files at `config/vault-paths.json` and `config/excluded-terms.json` are loaded at module init and reloaded via `fs.watch` when changed, with no restart required. The Anthropic SDK is the right integration point for Stage 2 Haiku classification — it is already available in the Claude Code runtime context. Direct filesystem writes (via Node.js `fs.promises`) are the write mechanism: the REST API is authenticated and adds latency for a local write path that does not need it.

**Primary recommendation:** Build `src/vault-gateway.js` as a synchronous-interface, async-implementation Node module with three sequential guard functions and a `proposals/` quarantine path. This module becomes the only sanctioned write path for all subsequent phases.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** No `LEFT/` or `RIGHT/` parent wrapper folders. Domain folders live at vault root. Write-gateway enforces the boundary by path allowlist.
- **D-02:** RIGHT side (agent-writable paths at vault root): `memory/`, `briefings/`, `ctg/`, `job-hunt/`, `interview-prep/`, `content/`, `research/`, `ideas/`, `proposals/`
- **D-03:** LEFT side (human-only writes at vault root): `ABOUT ME/` (exists), `Daily/`, `Relationships/`, `Drafts/`
- **D-04:** Three-tier access model: LEFT paths = agent reads, never writes. RIGHT paths = agent reads and writes. Unknown paths (not in either list) = agent blocked entirely — no read, no write. `vault-paths.json` is the complete manifest of what the agent can see.
- **D-05:** Gateway configuration lives at `~/projects/second-brain/config/vault-paths.json` with `{left: [...], right: [...]}` arrays. Whitelist both sides.
- **D-06:** Two-stage filter with graceful degradation. Stage 1: keyword scan (case-insensitive, word-boundary match). No hit = immediate write (zero latency, common case). Hit = proceed to Stage 2.
- **D-07:** Stage 2 (fires only on Stage 1 match): Claude Haiku classifies content. BLOCK: content about or from ISPN/Genesys/Asana. ALLOW: neutral tool references, career narrative, generic industry mentions.
- **D-08:** Graceful degradation: Haiku timeout (>2s) or API unavailable = BLOCK + queue to `proposals/` for human review. Never silently bypass the filter.
- **D-09:** Keyword list in `config/excluded-terms.json`. Seed: `["ISPN", "Genesys", "Asana"]`. Reloadable without restart.
- **D-10:** Dedicated Phase 1 task: expand keyword list to 15-20 terms before v1 go-live.
- **D-11:** Filter applies at every write point: `/new` captures, `/today` outputs, memory promotions.
- **D-12:** Prompt injection: full `ABOUT ME/anti-ai-writing-style.md` content injected into system prompt of any agent producing vault-destined content.
- **D-13:** Post-write lint: regex-only (NOT semantic). Banned words extracted from style guide at filter init, cached in memory, reloaded when style guide file changes. Case-insensitive, word-boundary match. Latency target: <10ms.
- **D-14:** Lint failure handling: 1st violation = reject write, request regeneration with specific violation callout. 2nd violation on same write = queue to `proposals/` with violation flag for human review.
- **D-15:** Semantic style concerns handled by prompt injection only, not post-write validation.
- **D-16:** Agent creates wikilinks freely on RIGHT side content. Agent proposes wikilinks for LEFT side content (human approves). Obsidian resolves links natively within the vault.

### Claude's Discretion

- Write-gateway implementation approach (hook, middleware, Node module — researcher/planner decides)
- Internal data structures for the path allowlist
- File-watching mechanism for config/style guide reloading
- Test strategy and tooling

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VAULT-01 | Left/right vault directory structure exists with clear write-permission boundary | Path allowlist design (D-01 through D-05). `vault-paths.json` schema and directory creation sequence covered in Architecture Patterns section. |
| VAULT-02 | Centralized write-gateway function routes all vault writes through a single enforcement point | `src/vault-gateway.js` module design. Three-gate sequential enforcement architecture documented in Architecture Patterns. |
| VAULT-03 | Ingress filter strips ISPN, Genesys, and Asana content at capture before any write to disk | Two-stage filter design (D-06 through D-11). Haiku classification via Anthropic SDK, graceful degradation to `proposals/` quarantine. |
| VAULT-04 | Anti-AI writing style guide loaded into every agent prompt that generates vault content | Style guide content captured. Banned word extraction pattern documented. Post-write lint design (D-12 through D-15). |
| XREF-01 | Wikilink cross-references work between left and right vault sides | Obsidian resolves `[[Note Name]]` syntax natively across the vault regardless of directory. Agent writes wikilinks to RIGHT side content. Verification approach documented. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 22.21.1 (LTS) | Runtime for gateway module and all scripts | Already installed, confirmed. LTS track. Used for Claude Code skill ecosystem. |
| `fs.promises` (built-in) | Node 22 | Async file read/write for vault operations | No dependency needed. `fs.promises.writeFile` with `{ encoding: 'utf8' }` is the correct vault write mechanism. |
| `fs.watch` (built-in) | Node 22 | Config and style guide hot-reload without restart | Built-in. Stable on macOS. Sufficient for single-file watching on a local vault. |
| `@anthropic-ai/sdk` | npm latest | Stage 2 Haiku classification for ingress filter | Standard SDK for Anthropic API calls. Use `claude-haiku-4-5` model for cost/latency. |
| `path` (built-in) | Node 22 | Path normalization for allowlist matching | Critical: all vault paths must be normalized before allowlist comparison or bypass is trivial. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jest` | 29.x | Unit testing the gateway module | Phase 1 test coverage for the three guard functions. Jest is standard for Node.js projects. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fs.watch` (built-in) | `chokidar` | chokidar handles edge cases (atomic saves, vim swaps) better. For single config files with infrequent changes, built-in `fs.watch` is sufficient. Use chokidar if hot-reload proves unreliable on macOS. |
| Direct `fs.promises` writes | Obsidian Local REST API (`PUT /vault/:filename`) | REST API requires auth (Bearer token), adds HTTPS overhead, requires Obsidian running. Direct filesystem writes are faster and work even if Obsidian is closed. REST API is correct for reads that need vault-aware metadata (backlinks, tags). |
| `@anthropic-ai/sdk` | `fetch` directly | SDK handles retry, streaming, and type safety. Prefer SDK over raw fetch for Haiku calls. |

**Installation:**
```bash
cd ~/projects/second-brain
npm init -y
npm install @anthropic-ai/sdk
npm install -D jest
```

---

## Architecture Patterns

### Recommended Project Structure

```
~/projects/second-brain/
├── src/
│   └── vault-gateway.js     # The single write enforcement point
├── config/
│   ├── vault-paths.json     # {left: [...], right: [...]} path allowlists
│   └── excluded-terms.json  # ["ISPN", "Genesys", "Asana", ...] keyword list
├── test/
│   └── vault-gateway.test.js
├── package.json
└── (future: skills/, scripts/ for phases 2+)
```

### Pattern 1: Three-Gate Sequential Write Enforcement

**What:** Every call to `vaultWrite(path, content)` passes through three sequential guards. Any guard can BLOCK (reject) or QUARANTINE (redirect to `proposals/`). Only PASS from all three allows the write.

**When to use:** All vault write operations in all phases.

**Guard 1 — Path Allowlist:**
```javascript
// Source: D-01 through D-05 from CONTEXT.md
function checkPath(normalizedPath, config) {
  const isRight = config.right.some(dir => normalizedPath.startsWith(dir + '/') || normalizedPath === dir);
  if (!isRight) {
    return { decision: 'BLOCK', reason: `Path '${normalizedPath}' is not on the RIGHT side allowlist` };
  }
  return { decision: 'PASS' };
}
```

**Guard 2 — Ingress Content Filter (two-stage):**
```javascript
// Source: D-06 through D-11 from CONTEXT.md
async function checkContent(content, config) {
  // Stage 1: keyword scan (zero-latency common case)
  const terms = config.excludedTerms;
  const hit = terms.find(term => new RegExp(`\\b${term}\\b`, 'i').test(content));
  if (!hit) return { decision: 'PASS' };

  // Stage 2: Haiku classification (fires only on Stage 1 match)
  try {
    const result = await classifyWithHaiku(content, terms);
    if (result === 'BLOCK') return { decision: 'QUARANTINE', reason: `Excluded content detected (term: ${hit})` };
    return { decision: 'PASS' };
  } catch (err) {
    // Graceful degradation: timeout or API unavailable → QUARANTINE, never silently bypass
    return { decision: 'QUARANTINE', reason: `Haiku unavailable, queued for review (${err.message})` };
  }
}
```

**Guard 3 — Style Lint:**
```javascript
// Source: D-13 through D-14 from CONTEXT.md
// Banned words extracted from ABOUT ME/anti-ai-writing-style.md at init
const BANNED_WORDS = [
  'genuinely', 'honestly', 'straightforward', 'dive in', "let's dive deep",
  'game-changer', 'leverage', 'synergy', 'synergies', 'innovative', 'cutting-edge',
  'seamlessly', 'empower', 'empowering', 'unlock', 'robust',
  'at the end of the day', 'it goes without saying', "in today's fast-paced world",
  "i'd be happy to", 'great question', 'certainly', 'absolutely', 'of course'
];

function checkStyle(content, bannedWords, attemptCount) {
  const hit = bannedWords.find(word => new RegExp(`\\b${word}\\b`, 'i').test(content));
  if (!hit) return { decision: 'PASS' };
  if (attemptCount === 0) {
    return { decision: 'REJECT', reason: `Banned word detected: '${hit}' — regenerate without it` };
  }
  // 2nd violation: quarantine instead of infinite loop
  return { decision: 'QUARANTINE', reason: `Repeated style violation: '${hit}'` };
}
```

**Public API:**
```javascript
// Source: Claude's Discretion from CONTEXT.md — researcher recommendation
async function vaultWrite(relativePath, content, options = {}) {
  const { attemptCount = 0 } = options;
  const normalized = normalizePath(relativePath);
  const config = getConfig(); // returns live config (hot-reloaded)

  const pathResult = checkPath(normalized, config);
  if (pathResult.decision === 'BLOCK') throw new VaultWriteError(pathResult.reason, 'PATH_BLOCKED');

  const contentResult = await checkContent(content, config);
  if (contentResult.decision === 'QUARANTINE') {
    return quarantine(normalized, content, contentResult.reason);
  }

  const styleResult = checkStyle(content, config.bannedWords, attemptCount);
  if (styleResult.decision === 'REJECT') {
    throw new VaultWriteError(styleResult.reason, 'STYLE_VIOLATION');
  }
  if (styleResult.decision === 'QUARANTINE') {
    return quarantine(normalized, content, styleResult.reason);
  }

  // All guards passed — write to vault
  const absolutePath = path.join(VAULT_ROOT, normalized);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, content, 'utf8');
  return { decision: 'WRITTEN', path: normalized };
}
```

### Pattern 2: Config Hot-Reload via `fs.watch`

**What:** Load config once at module init; re-read when file changes.

**Why:** D-09 and D-13 require reloadable config without restart.

```javascript
// Source: Claude's Discretion — researcher recommendation
let _config = null;

function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

function watchConfig(configPath) {
  fs.watch(configPath, { persistent: false }, (eventType) => {
    if (eventType === 'change') {
      try {
        _config = loadConfig();
      } catch (e) {
        // Keep old config on parse error — log but don't crash
        console.error(`[vault-gateway] Config reload failed: ${e.message}. Keeping previous config.`);
      }
    }
  });
}
```

**macOS note:** `fs.watch` on macOS uses kqueue (via libuv). It is reliable for single-file watching. The `persistent: false` flag prevents the watcher from keeping the Node process alive when used in skill scripts.

### Pattern 3: Quarantine to `proposals/`

**What:** Failed writes (quarantined content) land in `proposals/` with a violation manifest, not silently discarded.

**Why:** D-08 requires content blocked by Haiku timeout to be recoverable. `proposals/` already exists as the dual-purpose staging area per D-specifics.

```javascript
async function quarantine(originalPath, content, reason) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantinePath = path.join(VAULT_ROOT, 'proposals', `quarantine-${timestamp}.md`);
  const manifest = `---\nquarantine: true\noriginal_path: ${originalPath}\nreason: ${reason}\ntimestamp: ${timestamp}\n---\n\n${content}`;
  await fs.promises.mkdir(path.dirname(quarantinePath), { recursive: true });
  await fs.promises.writeFile(quarantinePath, manifest, 'utf8');
  return { decision: 'QUARANTINED', quarantinePath };
}
```

### Pattern 4: Vault Directory Bootstrap

**What:** Create RIGHT-side directories if they don't exist. LEFT-side directories are created by the human only.

**Why:** VAULT-01 requires directories to exist. The gateway must not create LEFT-side directories.

```javascript
const RIGHT_DIRS = ['memory', 'briefings', 'ctg', 'job-hunt', 'interview-prep',
                    'content', 'research', 'ideas', 'proposals'];

async function bootstrapVault(vaultRoot) {
  for (const dir of RIGHT_DIRS) {
    await fs.promises.mkdir(path.join(vaultRoot, dir), { recursive: true });
  }
  // LEFT side: ABOUT ME exists. Daily, Relationships, Drafts — human creates these.
  // Gateway does NOT create LEFT-side directories.
}
```

### Anti-Patterns to Avoid

- **String-only path matching:** Always use `path.normalize()` and `path.resolve()` before allowlist comparison. A path like `memory/../ABOUT ME/secret.md` bypasses naive string prefix checks.
- **Silent bypass on filter errors:** If Haiku is unavailable or throws, the correct behavior is QUARANTINE to `proposals/`, not ALLOW. D-08 is explicit on this.
- **Regex injection via user-supplied terms:** The excluded-terms list is loaded from config. Terms used in `new RegExp()` must be escaped. Use `term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` before constructing the regex.
- **Writing LEFT directories:** `bootstrapVault()` must only create RIGHT-side directories. Creating `Daily/` or `Relationships/` would defeat the write-permission boundary semantics.
- **Synchronous `fs.watch` reload:** Never block the event loop during config reload. The `loadConfig()` call in the watcher callback must be synchronous JSON.parse only (no I/O) or async — never block.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Regex escaping for user-supplied terms | Custom escaper | `term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` | The standard JS regex escape pattern. One line. |
| Haiku API client | Direct fetch wrapper | `@anthropic-ai/sdk` | SDK handles connection pooling, retry on 529, streaming — all edge cases that matter for a 2s timeout budget. |
| Path traversal prevention | Custom sanitizer | `path.normalize()` + `path.join()` + prefix check | These are the standard tools. Do not invent another sanitizer. |
| File watching across multiple configs | Custom poller | `fs.watch` (Node built-in) | Polling introduces latency and CPU cost. `fs.watch` uses OS-level inotify/kqueue. |

---

## Common Pitfalls

### Pitfall 1: Path Traversal Bypass

**What goes wrong:** A caller passes `memory/../ABOUT ME/journal.md` as the write path. Naive string prefix matching (`path.startsWith('memory/')`) passes. The file lands on the LEFT side.

**Why it happens:** String prefix matching does not account for `..` segments.

**How to avoid:** Always normalize first:
```javascript
function normalizePath(inputPath) {
  // Normalize removes .. and resolves . segments
  const normalized = path.normalize(inputPath).replace(/^\//, '');
  // Reject anything that still contains ..
  if (normalized.includes('..')) throw new VaultWriteError('Path traversal detected', 'INVALID_PATH');
  return normalized;
}
```

**Warning signs:** Any test that passes a `../` path to `vaultWrite` and does not throw.

### Pitfall 2: `fs.watch` Double-Fire on macOS

**What goes wrong:** On macOS, saving a file often triggers two `change` events in rapid succession (one for content, one for metadata). If the reload callback is not debounced or guarded, config loads twice and may catch a partial write.

**Why it happens:** macOS file system event coalescing behavior. The underlying kqueue implementation fires on both data and metadata changes.

**How to avoid:** Guard with a debounce or a simple flag:
```javascript
let reloading = false;
fs.watch(configPath, { persistent: false }, (eventType) => {
  if (eventType === 'change' && !reloading) {
    reloading = true;
    setTimeout(() => {
      try { _config = loadConfig(); } catch (e) { /* keep old */ }
      reloading = false;
    }, 50); // 50ms debounce
  }
});
```

### Pitfall 3: Haiku Classification Prompt Ambiguity

**What goes wrong:** The Haiku prompt says "block content about ISPN/Genesys/Asana" without examples. Haiku blocks a sentence like "I learned CX leadership skills at Genesys that I now apply at CTG" — which D-07 explicitly says should be ALLOWED (career narrative).

**Why it happens:** Without few-shot examples in the classification prompt, Haiku defaults to conservative blocking on any mention of the excluded terms.

**How to avoid:** The Haiku classification prompt must include explicit examples:
```
BLOCK examples:
- "The Genesys Cloud routing configuration for ISPN queue handling..." (architecture/operations)
- "Asana project ID 12345 with client Acme..." (client data)

ALLOW examples:
- "I led a 12-person contact center team at Genesys." (career narrative)
- "Tracked in Asana" (neutral tool reference)
- "Genesys is a common CCaaS vendor in the enterprise market." (generic industry mention)
```

### Pitfall 4: Banned Word List Staleness

**What goes wrong:** The banned word list is hardcoded in the gateway module. Pete adds new banned words to `ABOUT ME/anti-ai-writing-style.md`, but the gateway still uses the old list.

**Why it happens:** D-13 says the lint keyword list should be "reloaded when style guide file changes" — but if the extraction logic is not watching the style guide file, the cache never updates.

**How to avoid:** Watch `ABOUT ME/anti-ai-writing-style.md` with `fs.watch` just like the config files. Extract banned words by parsing the table in the `## Banned Words` section:
```javascript
function extractBannedWords(styleGuideContent) {
  const tableMatch = styleGuideContent.match(/## Banned Words.*?\n([\s\S]*?)(?=##|$)/);
  if (!tableMatch) return [];
  return tableMatch[1].match(/\|\s*([^|]+?)\s*\|/g)
    ?.filter(cell => !cell.includes('---') && !cell.includes('Word/Phrase'))
    .map(cell => cell.replace(/\|/g, '').trim().toLowerCase())
    .filter(Boolean) ?? [];
}
```

### Pitfall 5: `proposals/` Quarantine YAML Frontmatter Conflict

**What goes wrong:** Quarantined content itself contains YAML frontmatter (`---` at top). Writing `manifest + '\n\n' + content` produces invalid YAML (two `---` blocks).

**Why it happens:** Obsidian notes commonly start with frontmatter. Naive string concatenation breaks the resulting quarantine file.

**How to avoid:** Strip the original frontmatter before embedding, or wrap the body in a fenced code block:
```javascript
const body = content.startsWith('---') 
  ? content.replace(/^---[\s\S]*?---\n/, '') 
  : content;
const manifest = `---\nquarantine: true\n...\n---\n\n${body}`;
```

---

## Code Examples

### Haiku Classification Call

```javascript
// Source: @anthropic-ai/sdk documentation + D-07 classification spec
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

async function classifyWithHaiku(content, excludedTerms) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 10,
    timeout: 2000, // D-08: 2s timeout triggers graceful degradation
    system: `You are a content filter. Classify the content as BLOCK or ALLOW.
BLOCK: content that is about or from ${excludedTerms.join(', ')} — their architecture, internal processes, client data, confidential strategy, or internal people.
ALLOW: neutral tool references ("tracked in Asana"), career narrative ("led a team at Genesys"), generic industry mentions.
Respond with only the word BLOCK or ALLOW.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Classify:\n\n${content.slice(0, 500)}` // Truncate to control tokens
          }
        ]
      }
    ]
  });
  return response.content[0].text.trim().toUpperCase() === 'BLOCK' ? 'BLOCK' : 'ALLOW';
}
```

### `vault-paths.json` Schema

```json
{
  "left": ["ABOUT ME", "Daily", "Relationships", "Drafts"],
  "right": ["memory", "briefings", "ctg", "job-hunt", "interview-prep", "content", "research", "ideas", "proposals"]
}
```

### Style Guide Prompt Injection

```javascript
// Source: D-12 — inject full style guide content into agent system prompt
const VAULT_ROOT = path.join(process.env.HOME, 'Claude Cowork');

async function loadStyleGuideForPrompt() {
  const guidePath = path.join(VAULT_ROOT, 'ABOUT ME', 'anti-ai-writing-style.md');
  return fs.promises.readFile(guidePath, 'utf8');
}

// Usage in agent skill system prompt:
// const styleGuide = await loadStyleGuideForPrompt();
// system: `${styleGuide}\n\n[END OF STYLE GUIDE]\n\nYour task: ...`
```

### Wikilink Write Pattern

```javascript
// Source: D-16 — agent creates wikilinks freely on RIGHT side
// Standard Obsidian wikilink syntax: [[Note Name]] or [[Note Name|Display Text]]
function toWikilink(noteName, displayText) {
  return displayText ? `[[${noteName}|${displayText}]]` : `[[${noteName}]]`;
}
// Wikilinks resolve within the vault regardless of directory depth.
// No path prefix needed — Obsidian's resolver is flat (searches entire vault).
```

---

## Runtime State Inventory

Step 2.5: SKIPPED. Phase 1 is greenfield — no rename, refactor, or migration involved. The vault currently contains only `ABOUT ME/` at root. No existing stored data, live service config, OS-registered state, or build artifacts reference paths that will change.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Gateway module runtime | ✓ | 22.21.1 LTS | — |
| npm | Package installation | ✓ | 10.9.4 | — |
| Obsidian (process) | Vault exists at write target | ✓ | 1.12.4 (running) | Direct fs writes work even if Obsidian closed |
| Obsidian Local REST API | Vault read operations in later phases | ✓ | 3.6.1 (HTTPS port 27124) | Direct fs reads |
| Docker Desktop | Docker MCP gateway (not needed for Phase 1) | ✓ | 29.4.0 | — |
| `@anthropic-ai/sdk` | Stage 2 Haiku classification | Not yet installed | — | Install via `npm install @anthropic-ai/sdk` — no fallback needed, npm available |
| `jest` | Gateway module tests | Not yet installed | — | Install via `npm install -D jest` |
| `~/Claude Cowork/` (vault) | Write target | ✓ | Contains: ABOUT ME/ | — |
| `~/Claude Cowork/ABOUT ME/anti-ai-writing-style.md` | Banned word extraction | ✓ | Present, 69 lines | — |

**Missing dependencies with no fallback:** None. All blockers are resolvable with `npm install`.

**Missing dependencies with fallback:** `@anthropic-ai/sdk` — if the SDK install fails, the Stage 2 Haiku call can fall back to raw `fetch` to `https://api.anthropic.com/v1/messages`. Not preferred, but functional.

**Critical notes:**
- The Obsidian REST API uses HTTPS on port 27124 with a self-signed cert. Any `curl` or `fetch` call to it requires `--insecure` / `rejectUnauthorized: false`. Phase 1 does not need the REST API (using direct fs writes), but future phases must account for this.
- The vault root is `~/Claude Cowork/` (with a space). All path construction must quote or escape the space: `path.join(process.env.HOME, 'Claude Cowork')`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CommonJS `require()` | ESM `import/export` | Node 12+ (stable ~2022) | Claude Code skill scripts use CommonJS (`require()`). Do NOT use ESM for this module — Claude Code's skill runner does not support top-level `await` in ESM modules without the `.mjs` extension. Use CommonJS with async functions. |
| `fs.watch` polling fallback | Native kqueue/inotify | Node 14+ | `fs.watch` uses the OS native file system events API. `persistent: false` is needed to allow the process to exit. |
| Obsidian REST API v1.x (HTTP) | v3.6.1 (HTTPS only, self-signed cert) | ~2024 | Plugin version 3.x dropped the plaintext HTTP option. `enableInsecureServer` is false in this installation. All REST API calls require HTTPS with cert verification disabled. |

**Deprecated/outdated:**
- HTTP port 27123: `enableInsecureServer: false` in this vault's plugin config. The insecure port is configured but disabled. Use HTTPS 27124 exclusively for future REST API calls.

---

## Open Questions

1. **Keyword list expansion (D-10)**
   - What we know: seed list is `["ISPN", "Genesys", "Asana"]`
   - What's unclear: the 15-20 terms for former employer product names, project codenames, client names, internal tool names, and senior leadership names
   - Recommendation: Treat this as a dedicated Phase 1 task (not a research question). Pete supplies the terms in that task session. The gateway's hot-reload design means this list can be updated after initial deployment.

2. **`package.json` module type for Claude Code skills**
   - What we know: Claude Code's skill runner environment uses CommonJS
   - What's unclear: whether a `"type": "module"` in `package.json` would break the gateway when loaded from a skill
   - Recommendation: Do not set `"type": "module"` in `package.json`. Use `.js` extension with CommonJS `require()`. If ESM is needed in the future, use `.mjs` extension explicitly.

3. **Obsidian REST API API key storage**
   - What we know: The API key is in the plugin's `data.json` (encrypted). A Bearer token is required for all authenticated calls.
   - What's unclear: Where to safely store the API key for Phase 1 code to consume in later phases
   - Recommendation: Phase 1 does not use the REST API. Defer API key storage pattern to Phase 2 when the first REST API read is needed. Options: environment variable `OBSIDIAN_API_KEY`, or read from the plugin's data.json directly (it's in the vault directory).

---

## Sources

### Primary (HIGH confidence)

- `/Users/cpconnor/projects/second-brain/.planning/phases/01-vault-foundation/01-CONTEXT.md` — All 16 locked decisions, canonical references, implementation specifics
- `/Users/cpconnor/projects/second-brain/.planning/REQUIREMENTS.md` — VAULT-01 through VAULT-04, XREF-01 acceptance criteria
- `/Users/cpconnor/Claude Cowork/ABOUT ME/anti-ai-writing-style.md` — Complete banned word table (18 words/phrases), structural patterns, formatting preferences
- `/Users/cpconnor/projects/second-brain/state/pattern-context.md` — Pattern 2 (Zero-Trust on Model Output), Pattern 7 (Adaptive Denial Tracking)
- Direct environment probes (this session): Node.js 22.21.1, npm 10.9.4, Obsidian 1.12.4 running, REST API 3.6.1 on HTTPS port 27124, vault path confirmed, Docker 29.4.0

### Secondary (MEDIUM confidence)

- Obsidian Local REST API plugin `data.json` — confirmed HTTPS-only, port 27124, self-signed cert, API key required
- Docker MCP gateway config — confirmed obsidian-mcp NOT in Docker MCP catalog (ElevenLabs, markdownify, n8n only). Vault writes must go through direct filesystem or REST API.
- Node.js documentation (training knowledge, v22 LTS) — `fs.watch`, `fs.promises`, `path.normalize` behavior on macOS

### Tertiary (LOW confidence)

- `@anthropic-ai/sdk` npm version — current version not verified against npm registry. Verify with `npm view @anthropic-ai/sdk version` before installing.
- `jest` 29.x — standard as of late 2024, but verify current major version with `npm view jest version`.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Node 22 and npm confirmed installed. SDK and jest are well-known packages, versions need npm-registry verification.
- Architecture: HIGH — All architectural decisions are locked in CONTEXT.md. The three-gate design, config schema, and quarantine path are fully specified.
- Pitfalls: HIGH — Path traversal, fs.watch double-fire, and Haiku prompt ambiguity are verified, known failure modes for this exact implementation pattern.
- Environment: HIGH — All dependencies probed live during this research session.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable stack — Node LTS, Obsidian REST API, Anthropic SDK are all stable tracks)

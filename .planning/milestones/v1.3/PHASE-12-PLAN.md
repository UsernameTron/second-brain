# Phase 12 — Critical Safety Fixes — Implementation Plan

## Context

v1.2 shipped with 76/100 health score. The 3-reviewer cross-audit (Claude, Gemini, Opus) surfaced 8 HIGH/MEDIUM findings related to error handling, vault-gateway bypass, and hook reliability. This phase closes every safety-critical item before architectural work begins in phases 13-16. All changes stay on `chore/commit-planning-artifacts` — the branch ships as one PR after phase 12 completes.

## Execution Order

T12.2 → T12.3 → T12.4 → T12.6 → T12.5 → T12.1

Rationale: defensive guards first (no behavior change), then resilience, then hook fix (unblocks push gate), then LLM path, then largest change (vault-gateway routing) last.

---

## T12.2 — Guard loadVaultPaths JSON.parse

**Commit:** `feat(safety): T12.2 — guard loadVaultPaths against malformed config`

### Problem
`loadVaultPaths()` in 3 files does unguarded `fs.readFileSync` + `JSON.parse`. Malformed `vault-paths.json` crashes the pipeline.

### Files & Lines
- `src/classifier.js:47-51` — primary definition
- `src/wikilink-engine.js:53-56` — duplicate
- `src/promote-unrouted.js:27-30` — duplicate

### Pattern
Extract a single shared `safeLoadVaultPaths()` into `src/pipeline-infra.js`:

```js
function safeLoadVaultPaths() {
  const SAFE_DEFAULT = { left: [], right: [], haikuContextChars: 100 };
  try {
    const filePath = path.join(CONFIG_DIR, 'vault-paths.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    const { logDecision } = require('./vault-gateway');
    logDecision('CONFIG', 'vault-paths.json', 'LOAD_ERROR', err.message);
    return SAFE_DEFAULT;
  }
}
```

Export from `pipeline-infra.js`. Replace all 3 definitions with imports:
- `classifier.js:47-51` → `const { safeLoadVaultPaths } = require('./pipeline-infra');` — delete local function, update 1 call site at line 203
- `wikilink-engine.js:53-56` → same import, update call site at line 218
- `promote-unrouted.js:27-30` → same import, update call site at line 88

### Acceptance Test
Add to `test/pipeline-infra.test.js`:
- Inject malformed vault-paths.json → returns `{ left: [], right: [], haikuContextChars: 100 }`
- Inject missing vault-paths.json → same safe default
- Inject valid vault-paths.json → returns parsed content
- Verify `logDecision` called on error with severity `LOAD_ERROR`

---

## T12.3 — safeLoadPipelineConfig wrapper

**Commit:** `feat(safety): T12.3 — add safeLoadPipelineConfig with per-site degrade paths`

### Problem
`loadPipelineConfig()` throws on schema violation or missing section. 11+ call sites, most without try/catch. One bad config edit crashes everything.

### Files & Lines
**New wrapper in** `src/pipeline-infra.js` (after line 385):

```js
function safeLoadPipelineConfig() {
  try {
    return { config: loadPipelineConfig(), error: null };
  } catch (err) {
    const { logDecision } = require('./vault-gateway');
    logDecision('CONFIG', 'pipeline.json', 'LOAD_ERROR', err.message);
    return { config: null, error: err };
  }
}
```

Export `safeLoadPipelineConfig` alongside `loadPipelineConfig` (keep original for callers that want fail-fast).

**Call site migration** — each site gets a degrade path appropriate to its context:

| File:Line | Current | Degrade Behavior |
|-----------|---------|------------------|
| `pipeline-infra.js:60` (createLlmClient) | try/catch swallows to null | Replace with `safeLoadPipelineConfig()` + log via logDecision. Same fallback to Anthropic. |
| `classifier.js:138` (runStage1) | unguarded | Return `{ success: false, failureMode: 'config-error' }` — triggers dead-letter |
| `classifier.js:238` (runStage2) | unguarded | Same — return config-error result |
| `classifier.js:379` (classifyInput) | unguarded | Return `{ success: false, failureMode: 'config-error' }` |
| `new-command.js:81` (runNew) | unguarded | Log error, return early with user-facing message |
| `lifecycle.js:109` (retryDeadLetters) | unguarded | Log error, skip retry cycle, return summary with 0 processed |
| `lifecycle.js:263` (archiveStaleLeftProposals) | unguarded | Log error, return empty array |
| `note-formatter.js:356` (generateFilename) | unguarded | Use hardcoded fallback format `untitled-{timestamp}` |
| `memory-extractor.js:166,246,374` | already has try-catch | No change needed — already safe |
| `today-command.js:648` | unguarded | Log warning, skip LLM-augmented sections, render static briefing only |
| `wikilink-engine.js:417` | unguarded | Log error, return empty vault index |

### Acceptance Test
Add to `test/pipeline-infra.test.js`:
- `safeLoadPipelineConfig()` returns `{ config, error: null }` on valid config
- `safeLoadPipelineConfig()` returns `{ config: null, error }` on malformed JSON
- `safeLoadPipelineConfig()` returns `{ config: null, error }` on missing required section
- Verify logDecision called with `LOAD_ERROR` on failure

Add per-module tests:
- `test/classifier.test.js`: mock config load failure → classifyInput returns config-error
- `test/today-command.test.js`: mock config load failure → briefing renders without LLM sections

---

## T12.4 — retryDeadLetters error handling

**Commit:** `feat(safety): T12.4 — split retryDeadLetters try blocks for write/move isolation`

### Problem
**Correction from exploration:** The code does NOT unlink before vaultWrite (original assertion was wrong). Actual order: vaultWrite (line 199) → move to promoted/ (lines 201-213) → unlink (line 214). The real issue: a single catch-all at line 217 treats vaultWrite failure and move/unlink failure identically. If move fails after successful vaultWrite, the note exists in vault AND in unrouted/ — inconsistent state, silent.

### File & Lines
`src/lifecycle.js:190-221`

### Pattern
Split the try block into two:

```js
if (retrySuccess) {
  const { formatNote, generateFilename } = require('./note-formatter');
  const { vaultWrite, logDecision } = require('./vault-gateway');

  const formattedContent = formatNote(body, classificationResult, {});
  const filename_ = generateFilename(body, {});
  const directory = classificationResult.directory || 'memory';
  const destPath = `${directory}/${filename_}.md`;

  // Step 1: Write to vault — if this fails, dead letter stays in unrouted/ (correct)
  let writeResult;
  try {
    writeResult = await vaultWrite(destPath, formattedContent);
  } catch (writeErr) {
    logDecision('RETRY', destPath, 'WRITE_FAILED', writeErr.message);
    retrySuccess = false;
  }

  // Step 2: If write succeeded, move original to promoted/ and unlink
  if (retrySuccess && writeResult) {
    if (writeResult.decision === 'QUARANTINED') {
      logDecision('RETRY', destPath, 'QUARANTINED', 'vault policy quarantined during retry');
      // Quarantined = data safe in quarantine dir. Still remove from unrouted/.
    }
    try {
      const promotedPath = path.join(promotedDir, filename);
      fs.mkdirSync(promotedDir, { recursive: true });
      const updatedFields = {
        ...fields,
        'promoted-at': new Date().toISOString(),
        'promoted-to': writeResult.decision === 'QUARANTINED' ? writeResult.quarantinePath : destPath,
        'promoted-by': 'auto-retry',
      };
      const promotedContent = serializeFrontmatter(updatedFields) + '\n' + body;
      fs.writeFileSync(promotedPath, promotedContent, 'utf8');
      fs.unlinkSync(filePath);
    } catch (moveErr) {
      // Write succeeded but move/unlink failed — data is safe in vault.
      // Log but count as success (data integrity preserved).
      logDecision('RETRY', destPath, 'MOVE_FAILED', `write succeeded but move failed: ${moveErr.message}`);
    }
    summary.succeeded++;
  }
}
```

### Acceptance Test
Add to `test/lifecycle.test.js`:
- Mock vaultWrite to reject → dead-letter file still present, summary.succeeded = 0
- Mock vaultWrite to return QUARANTINED → file removed from unrouted/, logged
- Mock vaultWrite success + fs.unlinkSync to throw → summary.succeeded = 1 (write was safe), logDecision called with MOVE_FAILED
- Verify logDecision import added to the require block

---

## T12.6 — security-scan-gate.sh fixes

**Commit:** `feat(safety): T12.6 — fix scan-gate agent invocation, add grep fallback and audit log`

### Problem
Hook blocks all pushes because `claude --agent security-scanner --print` has no prompt argument. `2>/dev/null` swallows the error. `2>&2` typo on line 60. No fallback when agent can't spawn.

### File
`.claude/hooks/security-scan-gate.sh`

### Constraint
Claude Code PreToolUse hooks only recognize exit 0 (allow) and exit 2 (block). Exit 1/3 are treated as hook errors and shown in verbose mode but don't block. The tri-state must use exit 0 + exit 2 only, with stderr messages providing context.

### Pattern

**Line 35 — fix agent invocation:**
```bash
SCAN_RESULT=$(cd "$CLAUDE_PROJECT_DIR" && claude --agent security-scanner --print "Scan staged changes for secrets, dependency vulnerabilities, and protected file mutations. Return JSON only." 2>&1)
SCAN_EXIT=$?
```
- Add prompt argument
- `2>&1` replaces `2>/dev/null` — stderr now captured for diagnostics

**After line 35 — add grep-based fallback on agent failure:**
```bash
if [ $SCAN_EXIT -ne 0 ] || ! echo "$SCAN_RESULT" | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" 2>/dev/null; then
  echo "[security-scan-gate] Agent failed (exit $SCAN_EXIT). Running grep-based fallback..." >&2
  
  # Grep staged diff for secret patterns
  STAGED_DIFF=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached 2>/dev/null || true)
  GREP_BLOCKED=false
  
  if echo "$STAGED_DIFF" | grep -qE 'AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}'; then
    echo "[security-scan-gate] GREP FALLBACK: Possible secret pattern found in staged changes" >&2
    GREP_BLOCKED=true
  fi
  
  STAGED_FILES=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached --name-only 2>/dev/null || true)
  if echo "$STAGED_FILES" | grep -qE '(^|/)\.env($|\.)'; then
    echo "[security-scan-gate] GREP FALLBACK: .env file staged" >&2
    GREP_BLOCKED=true
  fi
  
  # Log the agent failure
  LOG_DIR="$CLAUDE_PROJECT_DIR/.cache"
  mkdir -p "$LOG_DIR"
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"event\":\"agent-fallback\",\"exit\":$SCAN_EXIT,\"grep_blocked\":$GREP_BLOCKED}" >> "$LOG_DIR/security-scan-log.jsonl"
  
  if [ "$GREP_BLOCKED" = "true" ]; then
    exit 2
  fi
  echo "[security-scan-gate] Agent failed but grep fallback found nothing suspicious. Allowing." >&2
  exit 0
fi
```

**Line 60 — fix typo:**
```bash
" "$SCAN_RESULT" 2>&1 || echo "blocked")
```

**Add audit logging after successful agent scan (before exit):**
```bash
# Log successful scan
LOG_DIR="$CLAUDE_PROJECT_DIR/.cache"
mkdir -p "$LOG_DIR"
FINDING_COUNT=$(echo "$SCAN_RESULT" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String((r.blocking||[]).length+(r.findings||[]).length))}catch{process.stdout.write('0')}" 2>/dev/null || echo "0")
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"event\":\"scan-complete\",\"exit\":0,\"findings\":$FINDING_COUNT,\"blocked\":\"$HAS_BLOCKING\"}" >> "$LOG_DIR/security-scan-log.jsonl"
```

### Acceptance Test
Create `test/hooks/security-scan-gate.test.sh` (plain bash, no BATS):

```bash
#!/usr/bin/env bash
# Test harness for security-scan-gate.sh
# Runs hook with mock inputs, asserts exit codes and log entries
```

Test cases:
1. **Non-ship command** → pipe `{"tool_input":{"command":"git status"}}` → expect exit 0, no log entry
2. **Ship command + clean agent JSON** → mock `claude` to output `{"pass":true,"findings":[],"blocking":[]}` → expect exit 0, log entry with `scan-complete`
3. **Ship command + agent failure** → mock `claude` to exit 1 → grep fallback runs, expect exit 0 (no secrets in empty diff), log entry with `agent-fallback`
4. **Ship command + agent failure + .env staged** → mock git diff --cached --name-only to include `.env` → expect exit 2

Mock strategy: create temp directory, add mock `claude` script to PATH that outputs canned JSON or fails.

---

## T12.5 — LLM fallback hardening

**Commit:** `feat(safety): T12.5 — add fetch timeout, narrow fallback catch, guard response shape`

### Problem
`classifyLocal()` has no fetch timeout (hung server blocks forever), falls back on ALL non-parse errors (too broad — HTTP 4xx should surface), doesn't validate response shape, and config load failure at line 62 is swallowed silently.

### File & Lines
`src/pipeline-infra.js:86-128` (classifyLocal), `src/pipeline-infra.js:59-62` (config load)

### Pattern

**1. Fetch timeout (line 91):**
```js
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10_000);
try {
  const response = await fetch(`${llmConfig.localEndpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({ /* ... unchanged ... */ }),
  });
  clearTimeout(timeoutId);
```

**2. Narrow fallback catch (line 117):**
```js
} catch (err) {
  clearTimeout(timeoutId);
  // Parse errors: return immediately, no fallback
  const isParseError = err instanceof SyntaxError || (err.message && err.message.includes('JSON'));
  if (isParseError) {
    logDecision('LLM_CLASSIFY', llmConfig.localModel, 'PARSE_ERROR', `local: ${err.message}`);
    return { success: false, error: `JSON parse failed: ${err.message}`, failureMode: 'parse-error' };
  }

  // Network/timeout errors: fall back to Anthropic
  const isNetworkError = err.name === 'AbortError'
    || err.code === 'ECONNREFUSED'
    || err.code === 'ENOTFOUND'
    || err.code === 'ETIMEDOUT'
    || err.message?.includes('fetch failed');

  if (isNetworkError) {
    logDecision('LLM_CLASSIFY', llmConfig.localModel, 'FALLBACK', `local endpoint unreachable: ${err.message}`);
    return classifyAnthropic(systemPrompt, userContent, callOptions);
  }

  // HTTP errors and unexpected errors: surface, do NOT fall back
  logDecision('LLM_CLASSIFY', llmConfig.localModel, 'ERROR', `local: ${err.message}`);
  return { success: false, error: err.message, failureMode: 'api-error' };
}
```

**3. Response shape guard (after line 108):**
```js
const body = await response.json();
if (!body.choices?.[0]?.message?.content || typeof body.choices[0].message.content !== 'string') {
  logDecision('LLM_CLASSIFY', llmConfig.localModel, 'SHAPE_ERROR', 'response missing choices[0].message.content');
  return { success: false, error: 'Local LLM response missing expected shape', failureMode: 'api-error' };
}
const rawText = body.choices[0].message.content;
```

**4. Config load logging (line 59-62):**
```js
try {
  const pipelineConfig = loadPipelineConfig();
  llmConfig = pipelineConfig.classifier && pipelineConfig.classifier.llm;
} catch (configErr) {
  logDecision('CONFIG', 'pipeline.json', 'LLM_CONFIG_FALLBACK', `config load failed in createLlmClient: ${configErr.message}`);
  llmConfig = null;
}
```
Note: `logDecision` is already imported at line 69 inside the next try block. Move the import before line 59 or use the lazy-require pattern.

### Acceptance Test
Add to `test/pipeline-infra.test.js`:
- Mock fetch to abort after timeout → falls back to Anthropic
- Mock fetch to return HTTP 500 → does NOT fall back, returns api-error
- Mock fetch to return HTTP 200 with malformed body (missing choices) → returns api-error with shape message
- Mock fetch to throw ECONNREFUSED → falls back to Anthropic
- Mock config load to throw → logDecision called, falls back to Anthropic client
- Verify clearTimeout called on both success and error paths

---

## T12.1 — writeDeadLetter through vault-gateway

**Commit:** `feat(safety): T12.1 — route writeDeadLetter through vault-gateway write pipeline`

### Problem
`writeDeadLetter()` lazy-requires vault-gateway (line 246) but never uses it. Actual write at lines 274-276 uses `fs.promises.writeFile` directly, bypassing the 3-gate policy stack (path guard, content filter, style lint).

### File & Lines
`src/pipeline-infra.js:245-279`

### Pattern
Replace fs.promises direct write with vaultWrite. Use `attemptCount: 1` so style violations quarantine instead of reject (dead letters are infrastructure artifacts — style lint rejection is too aggressive).

```js
async function writeDeadLetter(inputBody, failureMode, correlationId, metadata = {}) {
  const { vaultWrite, logDecision } = require('./vault-gateway');

  // ... filename/frontmatter construction unchanged (lines 248-270) ...

  const fileContent = `${frontmatter}\n${inputBody}`;

  // Write via vault-gateway, enforcing path guard and content policy.
  // attemptCount: 1 tells Guard 3 to quarantine (not reject) on style violations —
  // dead letters are infrastructure artifacts, not user-facing content.
  try {
    const result = await vaultWrite(relativePath, fileContent, { attemptCount: 1 });
    if (result.decision === 'QUARANTINED') {
      logDecision('DEAD_LETTER', relativePath, 'QUARANTINED', 'dead-letter quarantined by vault policy');
      return { path: result.quarantinePath, quarantined: true };
    }
    return { path: relativePath };
  } catch (err) {
    // PATH_BLOCKED = path not in RIGHT allowlist — this is a bug, not a content issue
    logDecision('DEAD_LETTER', relativePath, 'WRITE_FAILED', err.message);
    throw err;
  }
}
```

Remove lines 274-276 (`fs.promises.mkdir`, `fs.promises.writeFile`). Remove `fs.promises` usage if no other function in the file needs it (check first — other functions likely do).

### Call Site Impact
All 10 call sites (5 in classifier.js, 5 in new-command.js) already handle `{ path }` return. Need to handle new `{ path, quarantined }` field — but since it's additive and callers only read `.path`, no call site changes needed unless we want to log quarantine events upstream.

### Acceptance Test
Add to `test/pipeline-infra.test.js`:
- `writeDeadLetter` calls `vaultWrite` (mock vault-gateway, verify called with correct path + content)
- `writeDeadLetter` does NOT use `fs.promises.writeFile` (grep the function body in test)
- `writeDeadLetter` returns `{ path, quarantined: true }` when vaultWrite returns QUARANTINED
- `writeDeadLetter` propagates PATH_BLOCKED error to caller
- `writeDeadLetter` passes `attemptCount: 1` to vaultWrite options

---

## Subagent Strategy

One subagent per task, sequential execution. Each subagent:
1. Writes the code change
2. Writes the test in the same commit
3. Runs `npx jest --forceExit` (relevant test file only, not full suite)
4. Commits with Conventional Commit message

After all 6 tasks: invoke `test-verifier` agent (full suite), then `pipeline-reviewer` agent.

## Verification

After all 6 commits:
1. `npx jest --forceExit` — expect 619+ tests green (new tests added per task)
2. `npm audit` — expect 0 vulnerabilities
3. `bash test/hooks/security-scan-gate.test.sh` — expect all 4 test cases pass (covers T12.6 behaviorally; real-world gate check happens naturally on next push)
4. Grep verification: `grep -rn "fs.promises.writeFile" src/pipeline-infra.js` returns 0 matches for writeDeadLetter section (T12.1)
5. Grep verification: `grep -rn "loadVaultPaths" src/classifier.js src/wikilink-engine.js src/promote-unrouted.js` — all point to pipeline-infra import (T12.2)

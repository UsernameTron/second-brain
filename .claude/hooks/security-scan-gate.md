# HOOK-03: Security Scan Gate — Integration Contract

> **Status:** Stub — pending Phase 9 (SEC-01 agent deployment)
> **Requirement:** HOOK-03
> **Created:** Phase 8 (Hook Infrastructure)
> **Implements in:** Phase 9 (Security & Verification)

---

## Hook Identity

| Field | Value |
|-------|-------|
| Event | `PreToolUse` |
| Matcher | `Bash` |
| Type | `command` |
| Timeout | 60s |
| Script path | `.claude/hooks/security-scan-gate.sh` (to be created in Phase 9) |

---

## Triggering Condition

The hook fires on any `Bash` tool use. The script inspects `tool_input.command` from stdin JSON and determines whether it matches a ship action. If it does not match, the script exits 0 immediately (no-op).

**Ship commands to match:**
- `git push`
- `gh pr create`
- `gh pr merge`
- `npx semantic-release`
- Any command containing `push` and a remote ref

---

## SEC-01 Invocation Contract

The hook script invokes the SEC-01 agent (once deployed):

```bash
claude --agent sec-01 --non-interactive --input "$SCAN_PAYLOAD"
```

SEC-01 must return JSON on stdout:

```json
{
  "pass": true,
  "findings": [],
  "blocking": []
}
```

- If `blocking` array is non-empty → hook exits 2, prints findings to stderr
- If `pass` is true and `blocking` is empty → hook exits 0

---

## SEC-01 Expected Capabilities

1. Scan staged changes for secrets (API keys, tokens, credentials patterns)
2. Run `npm audit --audit-level=high` and surface critical/high findings
3. Check that no file in the protected list appears in `git diff --staged --name-only`:
   - `.env`, `.env.*`
   - `config/schema/**`
   - `*credentials*`
4. Produce structured JSON output conforming to the contract above

---

## settings.json Entry (to be added in Phase 9)

Add to the `PreToolUse` array alongside the existing protected-file-guard hook:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/security-scan-gate.sh",
      "timeout": 60
    }
  ]
}
```

---

## Phase 9 Implementation Checklist

- [ ] Deploy SEC-01 agent to `.claude/agents/sec-01.md`
- [ ] Create `.claude/hooks/security-scan-gate.sh` per contract above
- [ ] Add `PreToolUse` Bash entry to `.claude/settings.json`
- [ ] Verify: attempt `git push` with a staged `.env` — confirm block
- [ ] Verify: attempt clean push — confirm pass

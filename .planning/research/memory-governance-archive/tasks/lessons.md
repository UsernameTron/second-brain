# Lessons

## 2026-07-12 — The planning session could not read the canon it was planning to govern

**Context:** Designing the memory-governance build. The Filesystem MCP timed out after 4 minutes with no response from the Claude Desktop app. Desktop Commander and Control-your-Mac route through the same bridge and were presumed down.

**Observation:** The session had to plan a memory system *without being able to read the memory*. It fell back on the auto-memory blob — which is precisely the Tier-4, non-authoritative, recency-biased cache this project exists to demote. The failure mode being fixed showed up live, during the fix.

**Action:** Phase 01 is an **audit**, not a build. Every path, count, and version is discovered by a command rather than recalled. No fabricated paths entered the artifacts. Add MCP bridge health to the pre-flight of any phase that depends on Cowork.

---

## 2026-07-12 — Memory said 39 skills. It also said 130. Both cannot be right.

**Context:** The auto-memory blob asserts both a 39-skill Desktop estate (target 20–28) and a 130-skill estate audited under the Bitter Lesson pass.

**Observation:** Two numbers, no reconciliation, no timestamp on either, and no way to know which is current. This is exactly the "status flattening" death zone — the blob does not distinguish *when* it learned something, so two true-at-different-times facts sit side by side as equals.

**Action:** Phase 01 step 1.4 **counts** rather than recalls. When `ledger/failures.md` exists, this becomes entry #2 — a live specimen of the failure this project fixes, captured while it was happening.

---

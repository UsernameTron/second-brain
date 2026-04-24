# Phase 19: Semantic Memory Search - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 19-semantic-memory-search
**Areas discussed:** Startup self-heal model, RRF hybrid fusion tuning, Voyage error handling granularity, Config surface for memory.*

---

## Startup Self-Heal Model

### Q1: When should the hash-set comparison actually run?

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy on first semantic call | Runs hash-compare + re-embed only on /recall --semantic or --hybrid. Keyword /recall pays zero Voyage cost. | ✓ |
| Eager on module import | Any require() triggers hash-compare. Simple but taxes keyword-only /recall. | |
| Explicit refresh command | Add /recall --refresh-index. Most control, worst UX. | |

**User's choice:** Lazy on first semantic call (Recommended)
**Notes:** Matches Pattern 12 lazy prompt loading. Latency cost paid by the user who asked for it.

### Q2: How should missing entries be embedded?

| Option | Description | Selected |
|--------|-------------|----------|
| Batch up to 128 per API call | Voyage's max batch size. One call covers most promotion spikes. | ✓ |
| One entry per API call | Serial. Simpler error isolation but 40x more round-trips. | |
| Adaptive (1 if ≤3 missing else batch) | Moderate complexity, marginal benefit. | |

**User's choice:** Batch up to 128 per API call (Recommended)
**Notes:** Aligns with Pattern 4 (stable request ordering — envelope identical, inputs vary).

### Q3: What happens if a batch fails mid-flight?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep successes, retry failures once, give up | Write partial to embeddings.jsonl, retry failed subset once, then keyword fallback. | ✓ |
| All-or-nothing (rollback) | Write nothing unless whole batch succeeds. Wastes successful work. | |
| Silent continue | Write successes, no retry, no notice. Rejected — violates Pattern 2. | |

**User's choice:** Keep successes, retry failures once, then give up (Recommended)

---

## RRF Hybrid Fusion

### Q1: RRF k constant and per-source weighting?

| Option | Description | Selected |
|--------|-------------|----------|
| k=60, equal weights | Standard RRF per the original paper. `score = 1/(60+rank_kw) + 1/(60+rank_sem)`. | ✓ |
| k=60, semantic weighted 1.5x | Biases toward semantic. Riskier without telemetry. | |
| k=10, equal weights | Lower k amplifies top differences. Deviates from literature. | |

**User's choice:** k=60, equal weights (Recommended)
**Notes:** Cormack/Clarke 2009 default. Easy to tune later in a future milestone when Phase 20 telemetry provides data.

### Q2: How many candidates from each side before fusion?

| Option | Description | Selected |
|--------|-------------|----------|
| Top-20 kw + top-20 sem | Enough headroom for RRF to do useful re-ranking. | ✓ |
| Top-10 + top-10 | Leaner; may miss docs one side ranks at position 15. | |
| Top-50 + top-50 | Overkill until vault > 5K entries. | |

**User's choice:** Top-20 keyword + top-20 semantic (Recommended)

### Q3: How to dedupe and tie-break?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedupe by id, sum RRF scores | Standard RRF — rewards cross-source agreement. | ✓ |
| Dedupe by id, max of contributions | Less reward for agreement. | |
| Dedupe by content hash | Defense in depth but contentHash IS the id. | |

**User's choice:** Dedupe by entry id, sum RRF scores (Recommended)

---

## Voyage Error Handling Granularity

### Q1: Should 401 (persistent) behave differently from 429/5xx/timeout?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — loud on 401, quiet on transient | 401 → stderr warning with remediation. 429/5xx/timeout → quiet one-line notice. | ✓ |
| No — same fallback for all | Simple but buries broken config. Rejected. | |
| Loud on all | Noisy — 429 spam on transient blips. | |

**User's choice:** Yes — loud on 401, quiet on transient (Recommended)
**Notes:** Matches Pete's no-silent-failures code standard.

### Q2: How should 429 rate limits be handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Honor Retry-After, single retry, then fallback | Sleep if ≤2s, else immediate fallback. 3s total budget. | ✓ |
| No retry — immediate fallback | Simplest but forces keyword on any transient blip. | |
| Exponential backoff up to 3 retries | 7+ second worst case — bad CLI UX. | |

**User's choice:** Honor Retry-After, single retry, then fallback (Recommended)

### Q3: Apply denial tracking across invocations?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — ~/.cache/second-brain/voyage-health.json | 3 consecutive fails → 15min degraded mode. Pattern 7. | ✓ |
| No — every invocation fresh | Pays timeout on every /recall during Voyage outages. | |
| In-memory only | Useless for a CLI (every call is a new process). | |

**User's choice:** Yes — write failure count to voyage-health.json (Recommended)

---

## Config Surface for memory.*

### Q1: Where do the tunable knobs live?

| Option | Description | Selected |
|--------|-------------|----------|
| All tunables in pipeline.json memory.* + AJV-validated | Schema-validated, overlay-compatible. VOYAGE_API_KEY env-only. | ✓ |
| Env vars for everything | Rejected — Phase 13 centralized config to fight this. | |
| Hardcoded | Violates minimal-blast-radius; requires PR to adjust threshold. | |

**User's choice:** All tunables in pipeline.json memory.* (Recommended)

### Q2: Model identifier — hardcode or configure?

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable but pinned to voyage-4-lite default | Enum validates. Easy to evolve. | ✓ |
| Hardcoded constant | Safer from misconfiguration but harder to evolve. | |

**User's choice:** Configurable in pipeline.json but pinned to voyage-4-lite by default (Recommended)

### Q3: How should schema_version be computed?

| Option | Description | Selected |
|--------|-------------|----------|
| Composite of model + dim + decay + threshold | Defensive — but over-triggers on query-time math tweaks. | |
| Integer bumped manually | Discipline-dependent. | |
| Just model + dimension | Threshold/decay are query-time math; no re-embed needed. | ✓ |

**User's choice:** Just model + dimension (user correction — overrode initial recommendation)
**Notes:** User correction: "schema_version should be model + dimension ONLY, not the composite hash. Threshold and recency decay are applied post-cosine at query time — they don't change the embeddings. Re-embedding on a scoring weight tweak is waste." Claude's recommendation was wrong — conflated semantic correctness with embedding freshness. Locked option 3.

---

## Claude's Discretion

Areas where Claude has flexibility (not user-decided):
- Degradation notice exact wording
- Internal module layout of `src/semantic-index.js` (single file vs folder)
- JSDoc style (inherit from memory-reader.js)
- Flag parsing style for --semantic / --hybrid (mirror existing --category pattern)
- nock fixture organization

## Deferred Ideas

- Per-source rank logging → Phase 20 STATS-LATENCY-01
- Progress UX during first lazy re-embed → Phase 21 if vault grows past 1K
- Configurable RRF weights → future milestone after Phase 20 telemetry
- Query caching → FUT-* if repeat queries surface in Phase 20 data

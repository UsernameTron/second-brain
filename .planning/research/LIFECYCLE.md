# LIFECYCLE — Retention, Decay, Promotion, Reconciliation

> **Installed to:** `~/memory/_meta/LIFECYCLE.md`
> **Enforced by:** Claude Code hooks (deterministic) + the weekly pass (judgment)
> **Design constraint:** every rule is **countable**. No scores. No weighted rubrics. No classifiers.

---

## Why countable, not scored

The Bitter Lesson, turned inward.

A scoring rubric for "should this be promoted" is **judgment scaffolding** — it substitutes brittle hand-tuned logic for model judgment, it drifts, and nobody ever audits it. A counter is **leverage scaffolding** — it's a fact about the world that makes the model's own judgment go further.

So: `sightings >= 3`. Not `salience_score > 0.72`.

If you ever find yourself adding a weight, stop. You are building the thing this project exists to avoid.

---

## The frontmatter schema

Every file in `canon/`, `ledger/`, and `working/` carries this block. The `PreToolUse` hook (M02) blocks writes to `canon/` that fail schema validation.

```yaml
---
id: CANON-0007              # stable, never reused
tier: canon                 # canon | ledger | working
type: fact                  # fact | decision | preference | failure | task-state
status: active              # proposed | observing | active | superseded | archived
half_life: durable          # volatile | seasonal | durable
provenance: user            # user | claude | derived
first_seen: 2026-03-14
last_verified: 2026-07-12
review_by: 2027-01-12
supersedes: CANON-0003      # optional; the tombstone link
sightings: 7                # the counter that drives promotion
---
```

Six fields carry almost all the weight:

- **`status`** kills status-flattening *and* "probationary forever." Apollo's probation ends because `review_by` arrives, not because someone remembers.
- **`provenance`** keeps "Claude suggested it" from becoming "Pete decided it."
- **`last_verified` + `review_by`** are the defense against *confidently stale* — the worst failure mode in the system.
- **`half_life`** makes decay per-item instead of a global TTL, because "Fort Worth" and "Fred's custody decision" do not age at the same rate.
- **`sightings`** is the promotion counter.
- **`supersedes`** is the tombstone. It preserves *why we changed our minds*, which is the knowledge that dies most often and hurts most when it's gone.

### Half-life buckets — three, deliberately

| Bucket | Horizon | Examples |
|:---|:---|:---|
| `volatile` | Days | Open blockers, pending decisions, in-flight sprint state |
| `seasonal` | Weeks–months | Active project shape, current stack versions, quarterly priorities |
| `durable` | Until explicitly changed | Identity, entity, voice, architecture rules, exclusions, scar tissue |

Three buckets. Not twelve. A taxonomy you have to think about is a taxonomy that gets it wrong.

---

## RETENTION — what gets captured, and how it's stamped

**R1 — Classify at capture.** Every candidate is one of: `fact` / `decision` / `preference` / `failure` / `task-state`. Five types. If it fits none of them, it isn't memory — it's chatter. Discard it.

**R2 — Stamp provenance and status at capture.** Source (user / claude / derived) and status (proposed / active). A thing Claude proposed and Pete didn't reject enters as `provenance: claude, status: proposed`. It does **not** enter as a fact. This one rule closes the "my own suggestion came back to me as your decision" death zone.

**R3 — Weight by type, not by score.** Failures and decisions retain at higher priority than restatements. A restatement of something already in canon does not create a new entry — it **increments `sightings` and bumps `last_verified`.** That's it. Restating a known fact should make the system *more confident*, not *fatter*.

**R4 — Nothing enters `canon/` at capture time.** Capture writes to `working/_inbox/` only, append-only. Promotion is a separate, deliberate act. This is what keeps a single confident-sounding session from rewriting your identity file.

---

## DECAY — what fades, and how

**Decay is not deletion.** A decayed fact leaves the always-loaded working set and remains fully searchable in the repo. Recoverable, just not occupying prime real estate.

**D1 — `working/` is a rolling set with a hard token cap: 2,000 tokens.**

Not a soft target. A cap. When `working/` exceeds it, something must be promoted, resolved, or dropped. Forced scarcity is the forcing function — a working set you can't re-read in full is a working set you don't actually use. (Stolen from evergreen-notes practice: the failure mode of every knowledge system is becoming a write-only archive.)

**D2 — Promotion check before eviction. This is the most important rule in the file.**

Nothing leaves the working set without a promotion look. Your system today is a write-back cache with **no flush** — knowledge sits in session context and gets evicted at compaction before it's ever written back. That is where most of your knowledge dies, and it dies silently.

Two enforcement points:

- **`PreCompact` hook (Claude Code):** fires immediately before the context window is compacted — the exact instant knowledge is about to be summarized away. Injects: *"Before compacting, write any durable decisions, failures, or preferences from this session to `~/memory/working/_inbox/`."* This is flush-on-eviction, implemented at the dirty-bit moment.
- **Weekly pass:** before any `working/` item ages out, it gets a promotion look.

If you build one component from this entire project, build the `PreCompact` hook.

**D3 — Supersession, not overwrite.** When a fact changes, the old entry gets `status: superseded` and the new one gets `supersedes: <old-id>`. Both stay. `git log canon/architecture.md` becomes a readable history of why you changed your mind — which is the single highest-value knowledge you currently do not retain anywhere.

**D4 — Procedural decay.** A skill with **zero invocations in 90 days** gets `status: archived` in `procedural/skill-registry.md` and moves to an archive directory. This is the 39 → 28 prune, automated, and driven by real telemetry rather than a feeling about which skills seem useful.

**D5 — Stale ≠ false. Surface it as stale.** Any canon entry past its `review_by` date is presented as *"canon says X, last verified <date> — this may be stale"*, never asserted flat. **Confidently stale is worse than forgotten.** This rule is the entire reason `last_verified` exists.

---

## PROMOTION — what moves up, and when

Five rules. All counters.

**P1 — Two-strike correction → preference.**
Pete corrects the same thing (tone, format, a wrong fact) across **two** sessions → the weekly pass proposes a `memory_user_edits` entry and a `canon/identity.md` update.
*Closes: demonstrated preferences depending on Pete remembering to log them.*

**P2 — Three retrievals → back to the working set.**
A fact pulled from the archive **three** times is obviously live. Re-promote it so it stops needing to be searched for.
*Closes: the pull-only retrieval layer, which is the biggest silent death zone — your entire chat history is stored and searchable, but it only surfaces if the model happens to know to go looking. A store you can only query on cue-recognition is a store that is mostly inert.*

**P3 — Three sessions + uncontradicted + structural → canon.**
Asserted in **three** distinct sessions, never contradicted, and it's identity / company / architecture / voice class → promote to `canon/`.
Tactical facts **never** promote. They decay. This keeps canon small and true.
Promotion is staged, borrowed directly from your own `ctg-prm-ops` feature-flag state machine:

```
proposed → observing → active
```

`proposed` at first sighting. `observing` at the second. `active` (canon) at the third, and only if uncontradicted. One confident session cannot rewrite your identity file.

**P4 — Three manual repetitions → skill.**
A procedure done by hand **three** times becomes a skill. You already do this by instinct. The rule catches the ones you miss.

**P5 — One costly failure → rule. Immediately.**
Failures promote on the **first** occurrence, not the third. They are too expensive to wait on.
The enrichment MCP timeout is the proof this works — it got promoted to a mandatory rule and it's the *only* failure in your entire estate that made it in. That is not because it was your only failure. It's because it was the only one that had a promotion path.

**Closing gate:** *no entry in `ledger/failures.md` is closed until it names the artifact that prevents recurrence.* Root cause without an encoded rule is just a story about a bad day.

---

## RECONCILIATION — keeping the sources honest

**X1 — Canon is authoritative; the blob is a cache.** See `AUTHORITY.md` A1/A2. Contradictions append to `_meta/memory-corrections.md`.

**X2 — One editable location per topic.** See `AUTHORITY.md` A3. Enforced by `scripts/dupe-check.py`, which fails the pre-commit hook on cross-file duplication. Policy that isn't enforced by a script is not policy — it's a wish.

**X3 — Weekly diff pass.** Rides the existing governance cadence. Diffs canon against the blob and against what actually happened in the week's transcripts. Emits: what changed, what's stale, what's ready to promote, what should be archived.

---

## The weekly pass — the only ritual

**Cadence:** once a week. Scheduled, not remembered.
**Budget:** ≤ 15 minutes of Pete's attention. If it grows past that it will die, and the system dies with it.
**Single-writer:** the pass is the **only** thing that writes to `canon/`. Everything else appends to `working/_inbox/`. No merge conflicts, by construction, across four concurrent Claude surfaces.

Six steps:

1. **Ingest** — read `working/_inbox/*`, already scrubbed of secrets and excluded terms
2. **Classify** — R1/R2 stamps; increment `sightings` on restatements rather than creating duplicates
3. **Promote** — apply P1–P5; **one git commit per promotion, rationale in the commit message** (a single "update memory" blob commit destroys the provenance that git was supposed to give you for free)
4. **Decay** — enforce the 2k cap on `working/`; supersede what changed; flag anything past `review_by`
5. **Reconcile** — diff canon vs. blob; batch `memory_user_edits`
6. **Report** — emit the "what changed / what's rotting / what's ready" briefing

**Step 6 is not optional.** The pass has to produce something Pete *wants* to read, or it becomes a chore, and chores get skipped. A briefing that tells you what's rotting in your own head is worth fifteen minutes. A checklist is not.

**Discard rate is a health metric, not a failure.** If the pass promotes more than **20%** of the inbox, it is promoting junk. A good week discards 80–95%. Most of what happens in a session is not knowledge.

---

## The five numbers

Track these or you cannot claim the system is compounding. You can only claim it feels nicer.

| Metric | What it means | Healthy | Unhealthy signal |
|:---|:---|:---|:---|
| **Cold-start recall** | % of 20 fixed probes answered correctly with zero conversational context | ≥ baseline + 30pp | Flat → the substrate isn't being read. Check the router. |
| **Canon churn** | % of canon entries corrected per month | < 10% | High → promoting too eagerly. Tighten P3. |
| **Resurrection rate** | % of decayed facts pulled back within 30 days | < 15% | High → decaying too aggressively. Lengthen half-lives. |
| **Promotion latency** | Days from first assertion of a durable fact to it reaching canon | ≤ 14 | Rising → the weekly pass is slipping. This is the early-warning signal for total system death. |
| **Skill utilization** | Invocations per skill per 90 days | 0 = archive | Many zeros → the registry is a graveyard, not an index. |

**Promotion latency is the canary.** Every other number can look fine while the ritual quietly stops running. Watch this one.

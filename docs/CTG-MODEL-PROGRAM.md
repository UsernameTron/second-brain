# CTG Local Model Program — Fine-Tune & Sharpen Plan

**Owner:** Connor · **Machine:** M4 Pro, 48 GB unified · **Toolchain:** MLX-LM LoRA (proven on `qwen2.5-7b-frontier-mlx`) · **Serving:** LM Studio (35B-A3B generalist + second-brain MCP already live)

**Revision 2 (2026-08-14).** Adds a capacity diagnosis for the local-inference pain, a compute-placement strategy (train remote, serve local), an immediate off-ramp from the 27B, eval-harness reuse, and a decision record on DeepSeek Harness. Resolves the MoE-tunability open question from revision 1.

---

## 0. Doctrine — what fine-tuning is for

Facts change; behavior compounds. Anything CTG *knows* (deals, bugs, decisions) stays in the second-brain RAG layer we just shipped — fine-tuning facts bakes in staleness. What fine-tuning buys is what RAG cannot: **speed on repetitive jobs, reliability of structured output, judgment calibrated to CTG's rules, and voice.** So the program is not "one impressive model." It is a **specialist fleet**: small models tuned to do CTG's highest-volume jobs perfectly, orchestrated around the 35B generalist that keeps the reasoning and the memory tool.

The demonstration of range isn't a big model — it's a system where every LLM call in CTG's pipelines runs locally, fast, on a model trained on CTG's own corrected history.

**Corollary added in revision 2:** the program's first job is not a trained model. It is making the pipeline usable *today*, because a pipeline painful enough to avoid produces no training data, and this program is fed by its own exhaust.

---

## 1. Diagnosis — why local inference feels broken

The frustration is real, measurable, and mostly **not** a broken laptop or a flaky LM Studio. It is the predictable result of running a 27B dense model against very long prompts as a high-volume workload.

### The capacity math

Measured on this machine and recorded in `CLAUDE.md`: `qwen/qwen3.6-27b` at 65,536-token context (flash attention, q8_0 K/V cache, ~16.3 GiB resident) runs at **~86 tok/s cold prefill** and **~6–7 tok/s generation**.

Memory extraction sends 33k–63k-token prompts. That yields:

| Prompt size | Prefill (time to first token) | Generation (~2k-token JSON array) | Total |
|---|---|---|---|
| 33k tokens | ~6.4 min | ~5 min | **~11 min** |
| 63k tokens | ~12.2 min | ~5 min | **~17 min** |

This is why `localTimeoutMs` sits at 900,000 ms. The 15-minute timeout is not defensive padding — it is sized to actual throughput. A single memory extraction can legitimately occupy the machine for a quarter of an hour, during which the 27B holds ~16 GiB and competes with everything else.

**Verdict on the hardware:** the M4 Pro is genuinely capable for 4B–8B models and marginal for 27B-on-long-context *as a repeated workload*. Buying a bigger machine is the wrong lever; the workload is memory-bandwidth-bound, and a 6x smaller model buys roughly 6x on both phases. That is the M1 thesis.

### The history says the same thing

This is not the first time the local path has bitten. `.planning/quick/260721-rst-local-llm-reasoning-starvation` records a failure mode where the 27B spent its entire token budget in the hidden `<think>` phase and returned empty content with `finish_reason=length` — every local classify failed with a generic shape error. The fix (`reasoning_effort: 'none'`, verified live against three candidate mechanisms) landed with a `reasoning-starved` guard as backstop.

The lesson generalizes: **large reasoning models on constrained budgets fail in ways that look like tooling bugs.** Part of what makes LM Studio feel unreliable is the 27B's behavior under budget pressure, surfacing as opaque errors. A small, non-reasoning, task-tuned model removes an entire class of failure, not just latency.

### What is genuinely still ours to fix

- The pipeline falls back to Anthropic on network/timeout failures, and `classifyLocalWithHealth` flips to degraded mode after 3 consecutive failures. Under 15-minute calls, degraded mode is easy to enter and its cause is easy to misattribute to LM Studio.
- Long calls have no progress signal, so a working 12-minute prefill and a wedged process look identical from the outside.

Both are addressed by Phase 0.5 below.

---

## 2. Compute placement — train remote, serve local

The doctrine is local *serving*. It was never local *training*, and conflating the two is what makes this program feel heavier than it is.

| Workload | Where | Why |
|---|---|---|
| Inference / serving | **Local (LM Studio)** | Zero marginal cost, no egress of vault or client content, works offline. Non-negotiable for the fleet. |
| LoRA training runs | **Local first, rented GPU when it hurts** | Training is bursty and occasional. If MLX runs fight the daily workload, an A100 hour is cheaper than a wasted afternoon. |
| Data mining / scrubbing | **Local only** | Raw corpus contains client-confidential material. Never leaves the machine unscrubbed. |
| Eval / scoring | **Local** | Offline-pure by design (see §6). |

### On the cloud options you raised

- **Rented GPU (RunPod / Lambda / GCP spot)** — the sane fallback. Standard CUDA tooling, a 4B LoRA over a few thousand pairs is roughly 1–2 GPU-hours, so **single-digit dollars per run** (estimate, to be confirmed on the first run). Train there, bring the adapter home, fuse and quantize for local serving. The trained artifact is small; only the scrubbed training set travels.
- **Google Cloud persistent serving** — hold as fallback *only* if evals prove a tuned 4B cannot reach parity. It reintroduces recurring cost, vault-content egress, and ops burden that the local-fleet doctrine exists to avoid.
- **"Apple development cloud"** — does not exist as a rentable GPU service. Private Cloud Compute serves Apple Intelligence and is not user-programmable; Xcode Cloud is CI for builds and tests, not model training. Rule this out and stop spending attention on it.

**Governance constraint on anything leaving the machine:** a training set may be uploaded to rented compute only after passing the §4 contamination and secrets gates. The scan is the gate for egress, not just for training quality.

---

## 3. The fleet (ranked by value ÷ effort)

Each model carries an explicit kill criterion. A specialist that cannot beat its base-model-plus-prompt on the golden set does not ship, and the phase closes as a documented negative result rather than drifting.

### M1 — SB-Extractor-4B (crown jewel; build first)

**Job:** the second-brain memory-extraction classifier — the single highest-volume LLM workload in the estate, producing JSON candidate arrays (DECISION / LEARNING / CONSTRAINT / PATTERN / PREFERENCE + confidence + rationale).

**Why it wins:** the training data already exists and is *human-approved*. `memory.md` holds 285 promoted entries, each traceable to a session transcript (input) and an approved extraction (output). Mining-stage rejections are ready-made hard negatives. This is the rare case where the labels are gold because Pete personally gated every one.

**Base:** Qwen3.5-4B (already installed). **Target:** ≥ parity with the 27B on JSON validity and category F1, at roughly 6x throughput — turning 11–17 minute extractions into 2–3 minutes.

**Kill criterion:** if the tuned 4B cannot match 27B category F1 within 5 points at 100% JSON validity after two training iterations, escalate the base to 7–8B before abandoning. If 8B also misses, the workload stays on a hosted small model and the program's premise is re-examined.

**Payoff:** mining becomes near-instant and can run continuously; extraction quality should *improve*, because the model has seen every past approval and rejection instead of a generic prompt.

### M2 — CTG-Triage-4B

**Job:** structured classification across the ops automations — support@ triage (ACTION_REQUIRED / FYI / NOISE), HubSpot hygiene anomaly typing, B7 risk-matrix gating. The `ctg-prm-ops` specs already define the label taxonomy and the gate contract; a tuned 4B makes every 30-minute cron cheap and deterministic-fast.

**Data:** triage rule files + labeled historical emails + hygiene scan outputs; synthesize edge cases with the 35B, human-gate them (same approval ritual as session-harvest — the gate stays).

**Kill criterion:** must beat the current rules-plus-prompt approach on precision for ACTION_REQUIRED. A triage model that raises false negatives is worse than no model; missed action items are the expensive error.

### M3 — ICP-Scorer-7B

**Job:** enrichment classification and ICP scoring. The 4,031-row CCW audit sits at ~99% accuracy *including documented failure modes* (compound-title precedence bug, stale `sr-icp-v3` pins). Corrected labels plus known-bug rows as hard negatives make a training set most teams would kill for.

**Kill criterion:** must beat the current `icp.yaml` + prompt approach on the corrected rows, specifically including the compound-title cases that broke the rule engine. Matching the rules engine is not enough — it has to fix what the rules got wrong.

**Payoff:** signal-radar and enrichment-dispatch score leads locally at zero marginal cost. The Adversarial Validation Gate's Darren-persona critic can be distilled here once the generator side is stable.

### M4 — CTG-Operator-27B-LoRA (stretch; the showpiece)

**Job:** the voice and judgment layer — Fred-format Smart Brevity reports, plain-English briefs, Pete-voice output, Did/Decision/Next closes, the full frontier behavior spec *internalized in weights* rather than prompted.

**Data:** weekly Fred reports, GSD runbooks, brief skills, `memory.md` decisions with rationales, plus spec-compliant transcripts reformatted into instruction pairs.

**Feasibility — resolved in revision 2.** The 35B MoE is **not** tunable on MLX today. `mlx-lm` issue #571 documents that `linear_to_lora_layers` fails to convert expert MLP projections on Qwen3 MoE models, applying LoRA to attention projections only — roughly **0.02% of parameters trainable** (6.7M of 30.5B). Training would run and produce a near-no-op adapter, which is the worst outcome: cost and time with a plausible-looking artifact.

**Therefore:** the 27B dense is the tune target and the 35B MoE stays the untouched generalist. QLoRA on the 27B at Q4 fits 48 GB with adapter-only gradients but trains slowly — this is the phase most likely to move to rented GPU. **Fallback:** a 7–8B voice model, which honestly covers ~80% of the value at a fraction of the cost. Recheck MoE support before any future attempt; the issue may close upstream.

---

## 4. Data strategy (the whole game)

**Sources inventory** — everything mined read-only, nothing invented:
`memory.md` (285 entries, categorized, sourced) · session transcripts under `~/.claude/projects/*/memory` · GSD runbooks and phase plans · weekly Fred reports · CCW audit CSV + `icp.yaml` history · triage rules and audit logs · HubSpot KB + `pitfalls.md` · skill files (voice, brevity, briefs) · git commit messages on the two production systems.

**Rules:**

1. **Contamination strip is a hard gate.** ISPN / Genesys / Asana context never enters a training row. Reuse the existing `config/excluded-terms.json` and the whole-token matching already built for the vault content-policy gate rather than writing a second scanner — the fail-closed behavior is already proven there. Automated scan plus spot check before every training run **and before any upload to rented compute.**
2. **Secrets scrub.** API keys, tokens, EINs, client-confidential numbers regex-scrubbed; the confidentiality-scan skill's category list is the checklist.
3. **Human gate stays.** Synthetic pairs (35B-generated from real artifacts) enter the training set only after the same approve/reject ritual as memory promotion. No silent synthetic data.
4. **Format.** ChatML JSONL per task; 90/5/5 train/val/test with test drawn from the *newest* data — temporal split, not random, so drift is caught honestly.
5. **Floors.** Don't train a specialist below ~500 quality pairs; augment by synthesis against real artifacts, never by free generation.
6. **Provenance.** Every row carries its source path and, where applicable, the promotion decision that approved it. A training set you cannot audit is a training set you cannot debug when the model behaves oddly.

---

## 5. Training pipeline (reuse what's proven)

The `qwen2.5-7b-frontier-mlx` run established the local path: `mlx_lm.lora` → adapter → fuse → quantize → drop into `~/.lmstudio/models`.

Per model: a config file (rank 16–32, lr 1e-5–5e-5, 2–4 epochs, early stop on val loss), the training log kept as evidence, and adapter checkpoints retained for rollback. Everything scripted under a new `ctg-model-forge/` project with a GSD-standard runbook — one command per stage, deterministic, no notebook archaeology.

**Remote-training parity requirement:** the runbook must produce the same artifact whether the run happened locally on MLX or on a rented CUDA box. Concretely, the stage boundaries (dataset → adapter → fused model → quantized GGUF/MLX artifact → LM Studio install) stay identical, and only the training stage's backend differs. If that parity is expensive to maintain, keep 4B runs local and reserve remote for the 27B — do not maintain two divergent pipelines.

---

## 6. Eval harness — deployed ≠ working ≠ correct, applied to models

No model ships on vibes. Each specialist gets:

- **Golden set:** 50–100 held-out cases with known-correct outputs. For M1, real approved extractions the model never saw.
- **Hard gates:** JSON validity 100%, schema compliance 100%, zero contamination-term emissions.
- **Quality metrics:** per-category F1 against approved labels. For voice models, 35B-as-judge scoring against the frontier spec's own self-check rubric (answer-first, no reasoning-echo, grounded claims).
- **Regression bar:** the tune must beat its *base model with the current prompt* on the same golden set, or it replaces nothing. Side-by-side table kept in the repo.
- **Latency as a first-class metric:** record p50 and p95 time-to-first-token and total call time at realistic prompt sizes (33k and 63k tokens). Speed is the point of M1; an eval that measures only quality cannot tell you whether the program succeeded.
- **Shadow period:** the new specialist runs alongside the incumbent (both outputs logged, incumbent's used) before cutover — the same dry-run → observe → active state machine as the CTG ops automations.

### Build on `gsd-eval-harness`, don't start over

`gsd-eval-harness` already implements almost exactly this shape, and its structure maps onto model evals with one substitution: **its two arms are unaided-vs-aided; ours are base-vs-tuned.** Everything downstream is reusable as-is —

- `checks.py` ships `check_json_valid` (the M1 hard gate), `check_regex_absent` (the contamination gate), `check_regex_present`, and `check_answer_contains_all`.
- `runner.py` already does two-arm runs with caching and multi-trial support; `scoring.py` is a pure function over run artifacts with a `verdict()` matrix.
- `report.py` writes a versioned baseline document — the "side-by-side table kept in the repo" requirement, already solved.
- The offline-purity convention (no model calls outside `run` and `doctor`) is exactly right for model scoring.

Extending that harness is a smaller job than building a model eval from scratch, and it keeps one eval discipline across skills and models. Decide at Phase 0 whether `ctg-model-forge` imports it or forks it; prefer importing.

---

## 7. LM Studio sharpening (independent of training)

- **Specialist presets:** one preset per fleet model, bound as model defaults like the Frontier presets.
- **JIT + TTL:** enable just-in-time model loading with idle TTL so specialists load on demand and evict — the fleet never fights the 35B for the 48 GB.
- **Speculative decoding:** test the tuned 4B as draft model for the 27B. Same family, and post-tune distribution alignment could yield a meaningful dense-model speedup for free.
- **Pipeline cutover:** point the mining config's model string at SB-Extractor-4B once it clears its gate; `sbq` / MCP stay on the 35B.

### The seam that makes all of this cheap

Second-brain already calls local models through an OpenAI-compatible endpoint selected by config: `classifier.llm.{provider, localEndpoint, localModel}` in `config/pipeline.json`, overridable per machine via the gitignored `config/pipeline.local.json`. Swapping models — local to local, or local to hosted — is a config change, not a rewrite.

Keep it that way. It is the single highest-leverage architectural property this program depends on, and it is the reason no agent-framework migration is needed to gain model portability (see §9).

---

## 8. Sequence & done-criteria (no dates, only gates)

| Phase | Deliverable | Done means |
|---|---|---|
| **0.5** | **Immediate relief: off-ramp from the 27B** | Extraction runs on a small model with measured quality cost; long calls are diagnosable |
| 0 | `ctg-model-forge` repo + data miners + contamination/secret scanners + eval harness wired | Scanners pass on a full corpus run; row counts reported per source; base-vs-tuned arms run end to end on an untuned pair |
| 1 | M1 dataset + trained SB-Extractor-4B | Beats 27B-with-prompt on golden set; JSON validity 100%; latency p95 recorded; shadow-run clean |
| 2 | Mining cutover + M2 triage model | Second-brain pipeline running on 4B in prod; triage model through shadow |
| 3 | M3 ICP scorer | Beats current `icp.yaml` + prompt approach on the corrected CCW rows, compound-title cases included |
| 4 | M4 voice/judgment LoRA (27B dense) | 35B-judge scores tune > base on spec rubric, blind A/B, Pete as final judge |

### Phase 0.5 in detail — do this first, it is hours not weeks

The program's later phases depend on a pipeline that gets used. Right now the 27B makes extraction painful enough to avoid, which starves the very corpus M1 trains on.

1. **Point extraction at a smaller model.** In `config/pipeline.local.json`, set `classifier.llm.localModel` to an installed 4B or 8B (untuned, current prompt). This is the machine-local overlay — no repo change, no risk to other machines.
2. **Re-tune the timeout to the new reality.** `localTimeoutMs` of 900,000 was sized for the 27B. A 4B should complete large extractions in low single-digit minutes; drop the timeout so a genuinely wedged call fails fast instead of hanging for 15 minutes.
3. **Measure what it costs.** Run the golden set against both models before trusting the swap. This doubles as the first real exercise of the eval harness and produces M1's baseline for free.
4. **Make long calls legible.** Log start time and prompt token count at call start, so a slow-but-working call is distinguishable from a wedge without waiting out the timeout.

If the untuned small model's quality cost is acceptable, the pipeline is usable today and M1 becomes an improvement rather than a rescue. If it is not acceptable, that quality gap is precisely the gap M1 must close — and now it is a number instead of a feeling.

---

## 9. Decision record — DeepSeek Harness (evaluated 2026-08-14, deferred)

**What it is:** an open-source (MIT) agent runtime released in developer preview, in which the model adapter, tool registry, session log, sandboxes, scheduling, UI, and the agent loop itself are all swappable plugins (built on the Cordis plugin framework). Node.js. Positioned as an open rival to Claude Code, launched alongside DeepSeek's V4-Pro API. Supports the DeepSeek API, native auth for Bedrock / Vertex / Azure, and custom OpenAI-compatible endpoints. It picked up 33k+ GitHub stars within hours of release.

**Decision: do not adopt now. Revisit if we ever need to leave Claude Code.**

**Reasoning:**

1. **Wrong layer.** It is an *orchestration harness* — the layer where Claude Code plus GSD already sits, with 68 commands, 17 agents, and 33 skills built on it. It performs no model serving and no fine-tuning. Adopting it would not make one local inference call faster; the actual bottleneck in §1 would be untouched.
2. **Cost is a rewrite, benefit is zero against the stated problem.** The migration would rebuild a mature tooling estate on software whose own README warns of compatibility-breaking changes.
3. **Governance.** Its default path is the DeepSeek cloud API. Routing CTG client-confidential material there conflicts with the contamination and confidentiality rules in §4.
4. **The portability benefit is already ours.** The one genuinely good idea — "the model adapter is a plugin" — is already implemented in second-brain's `classifier.llm` config seam (§7). We hold the portability without the migration.

**What would change this:** a decision to move off Claude Code for reasons unrelated to this program, or the harness reaching stable release with a compelling local-serving story. Neither is on the table. Recheck no sooner than the next major release.

---

## 10. Honest limits

- Fine-tuning will not give a 4B model the 35B's reasoning. It gives it the 35B's *behavior on one job*.
- It will not keep facts current. That stays RAG's job.
- **MoE tunability on MLX is resolved and negative** — expert projections are not LoRA-converted, so the 35B is not a tune target today. Recheck upstream before revisiting.
- The ~6x speedup claim for a 4B over the 27B is a bandwidth-ratio estimate, not a measurement. Phase 0.5 turns it into a measurement before anything is built on it.
- Cloud training costs are estimates until the first real run bills.
- Every quality claim in this plan is a hypothesis until the golden sets say otherwise. The eval harness exists precisely so we never report "trained" as "better."
- The largest risk in this program is not technical. It is that data preparation is the majority of the work and the least interesting part of it, and the fleet does not exist without it.

---

## References

- Capacity numbers and local-model config: `CLAUDE.md`, `config/pipeline.json`, `config/pipeline.local.example.json`
- Local reasoning-starvation incident: `.planning/quick/260721-rst-local-llm-reasoning-starvation/260721-rst-SUMMARY.md`
- Local dispatch, fallback, and health tracking: `src/pipeline-infra.js`, `src/utils/classifier-health.js`
- Eval harness reuse target: `gsd-eval-harness` — `harness/checks.py`, `harness/scoring.py`, `harness/report.py`
- MLX MoE LoRA gap: [ml-explore/mlx-lm issue #571](https://github.com/ml-explore/mlx-lm/issues/571)
- DeepSeek Harness: [repo](https://github.com/deepseek-ai/deepseek-harness) · [The New Stack coverage](https://thenewstack.io/deepseek-harness-open-source-plugins/)

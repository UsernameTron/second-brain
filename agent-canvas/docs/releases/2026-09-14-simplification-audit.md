# Simplification completion audit — 2026-09-14

**All planned UI improvements are implemented locally.** The audit initially
reproduced three gaps; the completion follow-up fixes all three and adds explicit
regression coverage. The original observations below remain as before-fix evidence.
Local implementation does not establish live or unaided human acceptance.
No backend source, stored contracts or production service was changed.

## Scope and evidence

- Audited the 70 original control-map rows, 34 follow-up rows and 22 reliability
  entries in [SIMPLIFICATION.md](../SIMPLIFICATION.md). Follow-up rows refine
  existing controls; these are not 104 distinct original features.
- All 67 named evidence references resolve. Phase 1–7 commits, including 6A/6B/6C,
  are ancestors of the current application commit
  `1dc6cab5fcdb1a084ab9a054d22ca9de7ab78792`.
- Cross-checked destinations and recovery implementations against current source,
  component tests and the [14-group browser evidence](../screenshots/ui-test-summary.json).
  This audit adds focused browser reproductions; it does not claim to rerun every
  original scenario or prove every possible failure sequence.
- The earlier gate before this audit had 433 backend / 277 frontend tests, build and
  preflight passed; both production dependency audits report zero vulnerabilities.
  All 63 original test/support files remain (60 test modules, three support files);
  no skip/todo/only test markers were found.
- Backend source and README remain unchanged from `1308fec`. Source, stored
  memory, permissions and safety enforcement were not changed by this audit.

## Original audit findings — all three closed locally

| ID / impact | Missing promise | Reproduced result and cause | Required completion |
|---|---|---|---|
| S1 — High: team setup recovery | Failed team-template loads must stay visible and recoverable; unavailable must not become empty | Fail `/api/roster` with 503 while delaying the initial project list. The error appears, then selecting the returned project clears it. Team → Add agent claims no templates are enabled and has no retry control. `Workspace.jsx:416` drops the global `team templates` request state; `AddAgentModal.jsx:69` treats its empty array as confirmed empty. | Preserve global template state across project changes, pass loading/error/retry into the chooser and creation flow, and test both response orders plus recovery without reloading the page. |
| S2 — Medium: plain-English labels | Non-technical users must see explanations beside internal names | Normal Team → Add agent shows bare `strong` / `fast` values, `From roster`, and empty-state guidance pointing to `Admin`, although the actual destination is Owner settings → Agent templates. The agent-details header also prints the raw tier. `AddAgentModal.jsx:56–77`, `Panels.jsx:123`. The blocked-Google callback also exposes `GOOGLE_WORKSPACE_SCOPES=standard` in ordinary feedback (`Workspace.jsx:163`). | Use the existing plain-language tier labels, correct destination names and keep owner configuration instructions inside labelled technical details. Verify chooser/detail/error copy and accessible input labels. |
| S3 — High: memory certainty in work maps | Certainty must remain visible in text alongside memory, with the stored value preserved | Work details → Why? → Map receives three memory nodes with verified/inference/assumption. They render different border classes, but neither node text nor accessible name includes certainty. `ExplainMap.jsx:103–111` uses the value only in CSS. | Show Confirmed (verified), Reasoned conclusion (inference), and Unconfirmed (assumption) on each applicable node and in its accessible name, retaining existing shapes, content and source links. Verify all map lenses and narrow layouts. |

The three cases were observed at 16:32 UTC in a new disposable local fixture.
Development sign-in and project/work routes were real. The template failure and
three-state map payload were deliberately injected; no external services or
private workspace records were used. First-boot content counts were all zero,
and the browser reported no unhandled errors. The probe's successful completion
means it reproduced the observations, **not** that these requirements passed.

[Observed values](../screenshots/audit-simplification-2026-09-14.json) retain the
before/after error state, missing retry count, exact tier labels and map node text,
accessible names and CSS classes. All three screenshots were visually inspected:

- [Lost template recovery](../screenshots/audit-simplification-template-recovery.png)
- [Unexplained team labels](../screenshots/audit-simplification-team-labels.png)
- [Map nodes missing certainty text](../screenshots/audit-simplification-map-certainty.png)

## Acceptance boundaries remain separate

The four guide journeys passed automated member checks without Advanced or owner
settings. Pete's earlier manual walkthrough was guided; an unaided teammate
walkthrough from the current guide is still outstanding. Google OAuth, live
integrations and a physical microphone remain outside the local fixture evidence.
Backend pagination, universal memory propagation and provider changes remain
deliberately out of scope. Deployment is not authorized.

## Resolution and verification

| Finding | Implemented resolution | Verification |
|---|---|---|
| S1 — closed | Preserve global template request state across project changes; share explicit loading/error/empty/retry inside Add agent, project creation and owner Room creation; guard unavailable staffing and retain names | Both initial response orders, subsequent project switch, 503 and incomplete reply, successful retry without reload, confirmed empty and no automatic creation |
| S2 — closed | Team templates and owner-settings names match their destinations; plain-English tier labels appear in chooser/details/versions/canvas/Builder; custom inputs have accessible names; Google setup instructions remain in labelled details | Exact stored tier values, every custom field, real template creation/details, mobile widths and keyboard disclosure |
| S3 — closed | Work-map nodes expose all three certainty values in visible and accessible text, with existing symbols/borders and source links; map errors/empty replies recover; steps preserve source wording | All lenses, exact fixture memory links, source text and correction flags, no node overlap/overflow at 390/768/1280px, light/dark views and keyboard navigation |

[Component regressions](../../frontend/test/simplification-completion.test.jsx)
add 15 cases. The first 12 failed on the previous source; three further cases cover
map response states, step wording and keyboard use. Browser verification found and
fixed the select accessible name, narrow field layout, unbroken map text overflow
and focus-relative lens navigation. All original tests remain.

[Post-fix browser evidence](../screenshots/acceptance-completion.json) records the
new group; [the complete suite](../screenshots/ui-test-summary.json) and
[verification ledger](../UI-TESTING.md) record the current gates. The same isolated
fixture and network restrictions apply. The map response is explicit test data
linked to real disposable memory entries, not a model-evidence claim.

The release candidate must include these fixes; the earlier `a2d4b21` image remains
a historical snapshot. [Release review](2026-09-14-ui.md) names the current candidate
and its verification. Publishing and deployment still require Pete's approval.

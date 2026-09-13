# Local UI verification — 2026-09-13

Local gate: **433 backend and 277 frontend tests passed**, no tests skipped;
frontend build and deployment preflight passed, both production dependency audits
clean. Primary journeys and all thirteen secondary browser groups passed.

These checks exercise the local built app in Chromium using disposable databases,
real development sign-in and real application routes. External model and connector
boundaries are stubbed, and external network attempts fail the tests. The automated
member is fictional; the manual preview signs Pete in as Pete. Every fixture checks
that first boot creates zero project spaces, agents, notes, files, tasks, runs,
inquiries and memories before test setup begins.

## Repeat

From `agent-canvas/`:

```bash
npm run verify
npm audit --omit=dev
npm audit --omit=dev --prefix frontend
npm run test:ui
```

The browser command stops at the first failure. It regenerates screenshot evidence
and [the suite result](screenshots/ui-test-summary.json). Each group can also run
separately with `npm run test:acceptance -- GROUP`; primary journeys use
`npm run test:journeys`. Screenshots require visual inspection after regeneration.

## Browser coverage

| Surface | Exercised behavior | Evidence |
|---|---|---|
| Sign-in, Home, Ask, Act, Needs You | Four journeys as a member at 1280px and 390px, plus Pete's owner preview; explicit unsupported sources, retained answer context, queue failure/recovery, empty-team recovery without losing the draft | [Primary journeys](screenshots/manifest.json) |
| Navigation and responsive layout | Home/Needs You primary, all More/Advanced destinations reachable, space creation/picker, menus within 390px, 768px layout, keyboard checks and actual browser zoom | [Primary journeys](screenshots/manifest.json) |
| Rooms and Memory | Create/retry, lenses, refresh completion/poll recovery, activity, exact work/source links, stale export conflict and verified-only download, search/kinds/three certainty states, correction/history/lineage, member/view-only/private access, unstaffed Room recovery | [Rooms and Memory](screenshots/acceptance-rooms-memory.json) |
| Scheduled work and Builder | Complete consent/settings, rejected edits, rehearsal and polling recovery, activation/pause/resume/revoke, honest zero results, changed-authority rehearsal gate, publication/template and published-change review, member boundary | [Scheduled work and Builder](screenshots/acceptance-scheduling-builder.json) |
| Owner tools, Connections and Activity | Failed tables, access add/remove, template changes and partial ordering, failed/recovered probe, discovered-tool selection, serialized connector access, audit unavailable/verified/no matches, ledger download recovery, all seven activity filters, mobile and member gates | [Owner diagnostics](screenshots/acceptance-owner-diagnostics.json) |
| Documents, Team, work details and Commands | Pinned notes and retained failed saves; upload/download recovery; custom-agent creation/dispatch/version rollback/retirement; receipt/map lenses and steps; saved filters; command failure/cancel/confirm/practice; note/file removal | [Workspace tools](screenshots/acceptance-workspace-tools.json) |
| Canvas, spending, account and lifecycle | Real Tidy position writes, Fit, drag/save, background pan, wheel/cluster/minimap zoom; task assignments; archive/restore retaining history; budget failure/retry, pause/resume, Help, appearance recovery and failed/successful logout | [Workspace tools](screenshots/acceptance-workspace-tools.json) |
| Global Needs You | All six card types across two accessible spaces, restricted-space exclusion, Mine/Team/All with independent badge, person/agent/clear assignment, redirect/dismiss, 503/409/403 retained answers, duplicate prevention, exact memory/work/rule sources, reaffirmation/retry/acknowledgment recovery, mobile completion | [Global review](screenshots/acceptance-needs-you.json) |
| Startup, interrupted work and voice input | Failed/malformed startup, actual socket drop with missed answer and Pause, lost response after an accepted inquiry, unknown control/connection status, session expiry/re-sign-in, synthetic voice failures/cumulative transcripts/cancellation | [System recovery](screenshots/acceptance-system-recovery.json) |
| Drafts during pending saves | Real accepted note/agent/command/rule requests with held replies; closing/reopening, newer text, command cancellation and changing answer context preserve the next unsent draft | [Draft safety](screenshots/acceptance-draft-safety.json) |
| Review card clarity | Decision context and nested before/after values stay visible; empty/zero/false values remain distinct, exact supporting memory opens across projects, one keyboard-operable details control retains diagnostics; 390/768/1280px | [Review clarity](screenshots/acceptance-review-clarity.json) |
| Memory browsing | Readable earlier versions in both themes, optional legend with visible certainty, source/version links, independent failed/empty history, A→B→A delayed response, mobile controls and real private-source redaction | [Memory browsing](screenshots/acceptance-memory-browsing.json) |
| Connections | Account/answer defaults, every function/service retained, real local probe recording with a stubbed model, failed/stale/malformed/empty recovery, duplicate checks, member access, keyboard trap, 390/768/1280px and light/dark contrast | [Connections](screenshots/acceptance-connections.json) |
| Compact feedback | Four-message bursts, complete long messages, priority, paused expiry, keyboard Details/Dismiss, retained drafts/recovery, mobile dialogs and light/dark upload contrast | [Feedback](screenshots/acceptance-notifications.json) |
| Review submissions across navigation | Delayed answers, offscreen rejection/lost replies, assignment and redirect navigation retain per-card guards, drafts and recovery; mobile check-before-retry | [Review navigation](screenshots/acceptance-review-navigation.json) |
| Home request status across navigation | Help/Home navigation, switching projects, delayed success, lost confirmation and background rejection preserve pending/error guards and separate drafts; explicit check/retry only | [Home navigation](screenshots/acceptance-home-navigation.json) |

Unit/component tests additionally exercise bounded requests, malformed responses,
startup/session/control failures, late responses, polling cancellation, unknown or
stale statuses, and the legacy feature-flag fallback. Backend tests retain the CRM
preview/approval/apply, draft-only email, append-only memory/provenance/correction,
pause, budgets and audit-chain contracts. Browser evidence and component evidence
are distinct; no claim is made that every possible failure permutation ran in a browser.

## Defects fixed during this pass

- An empty project returned a misleading edit-conflict message. Home now explains
  the missing agent and offers setup while keeping the draft.
- Space actions could stay open after creation and overflow a 390px screen.
- The canvas background captured Fit/Tidy clicks. Controls now receive their own
  pointers; dragging the background still pans.
- Unsaved answers remained under Saved only. Confirmed changes now update the
  filtered list and recheck the current filter, including changes during a save.
- Cross-project agent assignment appeared unassigned and hid Clear assignment.
  The queue preserves the assignment and resolves its name from that project's team.
- Review cards exposed internal certainty and stopped-work labels. Generated
  prefixes now use plain-English labels; quoted source text and human questions
  retain their original wording.
- Voice results repeated earlier final words, hid interim words and could interpret
  a partial command after a recognition error. Results now rebuild once, failures
  keep text for review, and obsolete callbacks cannot submit. Microphone setup
  failures have a visible message and typing recovery; confirmation stays required.
- Late save/dispatch/interpretation responses could overwrite newer drafts;
  command cancellation could restore older text; Home could discard a newly
  selected answer context. Completions now update only the submitted draft,
  and cancellation keeps the latest text. No new persistent storage was added.
- Leaving Home reset submission guards and hid failures arriving afterward.
  Request status now stays in transient workspace state, keyed by project, so
  returning cannot silently permit another submission or hide its failure.

- Needs You cards lost pending guards and offscreen save errors when filters or
  navigation unmounted them. Session state now retains each source's pending,
  saved and recovery state; answer and redirect drafts survive those changes.

The first complete rerun exposed an intermittent browser-harness “Route is
already handled” error during draft checks. Held-response helpers now wait for
active page handlers before removing their interception; no routing error is
suppressed. The isolated draft checks and complete suite were repeated afterward.

Review cards now show decision context as ordinary text, with current/proposed
values together and supporting memory links. Work/model IDs and the original
received context remain under one Full details disclosure. Known repeated answer
instructions are merged into one sentence; stopped-work copy no longer claims
that no partial work happened. Unknown fields and authored wording stay visible; existing long-detail truncation
markers are retained. A workspace test now locates the visible work-summary
paragraph directly instead of racing a hidden event-detail match.

Rapid confirmations now share a compact strip with an expandable list. Messages
remain readable while expanded, hovered or focused; dismissing them retains
inline recovery and drafts. An active problem stays ahead of a later success.
Upload feedback previously used pale header colors on a light page and clipped
its text. It now uses readable theme colors, wraps fully and offers a 44px retry
target. Browser checks measure text contrast in both themes and ensure feedback
does not overlap work or dialogs at 390/768/1280px. Expanded messages clear on
confirmed sign-out. The canvas acceptance test now explicitly zooms out before
checking role clusters; it previously depended on the reduced height caused by
stacked notifications to make Fit enter that mode.

## Original acceptance criteria

| Requirement | Local evidence / boundary |
|---|---|
| Independently verified phases | [Phase history and gates](SIMPLIFICATION.md); each implementation phase has its own commit and verification record. Follow-up fixes are separately gated. |
| Every capability reachable | [Control map](SIMPLIFICATION.md) records original location, disposition, destination, permission, phase and evidence. Main and secondary browser groups exercise the relocated surfaces. |
| Four guide journeys without Advanced or owner settings | [Journey runner](../scripts/journey-test.js) uses the guide's question, editable Act on this follow-up and decision as a fictional member at desktop/mobile sizes. Pete's preview signs in as Pete. |
| Truthful failures, loading, empty and stale states | Recovery checks across all groups, plus [request](../frontend/test/request-reliability.test.jsx), [startup](../frontend/test/startup-status.test.jsx) and per-surface component regressions. |
| Preserve behavior covered by existing tests | No original test files deleted or skipped; 433 backend and 277 frontend tests pass. Changed labels retain equivalent behavioral assertions. |
| Safety, memory, tools, routes, schema and provider handling | Backend implementation and README are unchanged from baseline `1308fec`; existing backend safety/contract tests pass. |
| Empty first boot | Every browser fixture asserts zero workspace content before test setup. |
| Screenshots and responsive/keyboard evidence | [Primary images](screenshots/manifest.json), group manifests above; 1280/390px images inspected, with 768px, keyboard and browser zoom checks. |
| Current guide and handoff | [User guide](../USER-GUIDE.md) and [handoff](HANDOFF.md) describe local behavior and distinguish historical production observations. |
| Clean dependencies and no deployment | Both production audits are clean; build/preflight only. No push or deployment performed. |

## Connections follow-up

The previous mobile status board clipped check buttons and used dim text on navy.
Connections now puts account access and the answer check first. Other service
checks and function lists are named disclosures; Advanced details retains every
service, full source text, tool limits and the technical console. Check buttons
and recovery targets are at least 44px, text wraps and measured service-status
contrast exceeds 4.5:1 in both themes.

A failed probe masks older successful evidence until a fresh check succeeds.
Read failures preserve explicitly stale details, malformed responses fail visibly,
and verified empty responses get their own recovery. Concurrent services retain
separate pending/error state; a failed or pending check cannot leave a stale
technical console visible. Its recovered view uses the freshly loaded health.
Google-link validation and interrupted account changes retain status recovery.
The dialog focus trap now visits visible disclosure summaries and skips their
closed contents; native Enter/Tab/Escape behavior is verified in Chromium.

Twelve new connection component checks and two dialog regressions complement
11 browser checks and six inspected Connections screenshots. The full suite
retains every earlier group and regenerates its evidence. An initial full rerun
measured mobile geometry before responsive styles had painted. The harness now
waits two animation frames before applying the same overflow and overlap gates;
its failure capture also records the actual page being measured. The isolated
notification check and all 13 groups passed afterward. Google OAuth and live
service success remain outside these fixtures.

## Memory browsing follow-up

History and sources now uses ordinary section names and recorded-event labels.
Include earlier versions explains the existing history checkbox. The optional
certainty key can collapse, while every entry retains its certainty, symbol,
border, author, source and correction warnings. Earlier versions keep readable
text and authorship in both themes, their label and struck-through content.
Generated memory review advice explains corrections and review dates; custom
advice stays unchanged. Producing-work links and raw
work references remain available. Missing work no longer implies human authorship.
Help's ordered-list markers also stay inside the mobile content area.

Source and history requests use the existing resource-state hook independently.
Loading, failed, stale and complete-empty responses remain distinct. Validation
rejects malformed or wrong-entry data; request identity prevents an old A reply
from replacing a newer A after navigating through B. Version and source links
still use the original routes and privacy redaction remains server-enforced.

Twelve new Memory component tests, one review-copy test and seven browser checks
cover this behavior, including at least 4.5:1 contrast for earlier-version text and
authorship after the panel's opening animation completes. Six new
Memory screenshots and regenerated earlier evidence were inspected. The complete
local gate and all 14 browser groups passed; no backend or memory implementation
changed and no original tests were deleted or skipped.

## Limits

No deployment, push, live Google OAuth, live connector write, real model quality
evaluation, or physical microphone/speech-recognition test was performed. Scheduled
alert/brief records in the global-review fixture are injected historical test results
on paused schedules; that fixture does not prove scheduled delivery. CRM and email
contracts have automated backend coverage, not newly claimed live service success.
Pete's earlier walkthrough was assisted; an unaided teammate walkthrough remains a
separate human acceptance step. Local preview answers are predetermined test text,
not a source for CTG's actual ICP or other business facts.

# Local UI verification — 2026-09-13

Local gate: **433 backend and 210 frontend tests passed**, no tests skipped;
frontend build and deployment preflight passed, both production dependency audits
clean. Primary journeys and all six secondary browser groups passed.

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

## Original acceptance criteria

| Requirement | Local evidence / boundary |
|---|---|
| Independently verified phases | [Phase history and gates](SIMPLIFICATION.md); each implementation phase has its own commit and verification record. Follow-up fixes are separately gated. |
| Every capability reachable | [Control map](SIMPLIFICATION.md) records original location, disposition, destination, permission, phase and evidence. Main and secondary browser groups exercise the relocated surfaces. |
| Four guide journeys without Advanced or owner settings | [Journey runner](../scripts/journey-test.js) uses the guide's question, editable Act on this follow-up and decision as a fictional member at desktop/mobile sizes. Pete's preview signs in as Pete. |
| Truthful failures, loading, empty and stale states | Recovery checks across all groups, plus [request](../frontend/test/request-reliability.test.jsx), [startup](../frontend/test/startup-status.test.jsx) and per-surface component regressions. |
| Preserve behavior covered by existing tests | No original test files deleted or skipped; 433 backend and 210 frontend tests pass. Changed labels retain equivalent behavioral assertions. |
| Safety, memory, tools, routes, schema and provider handling | Backend implementation and README are unchanged from baseline `1308fec`; existing backend safety/contract tests pass. |
| Empty first boot | Every browser fixture asserts zero workspace content before test setup. |
| Screenshots and responsive/keyboard evidence | [Primary images](screenshots/manifest.json), group manifests above; 1280/390px images inspected, with 768px, keyboard and browser zoom checks. |
| Current guide and handoff | [User guide](../USER-GUIDE.md) and [handoff](HANDOFF.md) describe local behavior and distinguish historical production observations. |
| Clean dependencies and no deployment | Both production audits are clean; build/preflight only. No push or deployment performed. |

## Limits

No deployment, push, live Google OAuth, live connector write, real model quality
evaluation, or physical microphone/speech-recognition test was performed. Scheduled
alert/brief records in the global-review fixture are injected historical test results
on paused schedules; that fixture does not prove scheduled delivery. CRM and email
contracts have automated backend coverage, not newly claimed live service success.
Pete's earlier walkthrough was assisted; an unaided teammate walkthrough remains a
separate human acceptance step. Local preview answers are predetermined test text,
not a source for CTG's actual ICP or other business facts.

# Agent Canvas simplification

Approved 2026-09-10. This is the control inventory and local implementation
ledger, not evidence of deployment. Reliability precedes navigation changes.
Backend routes, tools, schema, memory/provenance, safety and provider handling
stay unchanged. Compatible production dependency fixes are explicitly in scope.

## Phase gates

Every phase is a separate commit and passes `npm run verify`,
`npm audit --omit=dev`, and `npm audit --omit=dev --prefix frontend` before the
next begins. Existing tests cannot be deleted or skipped. Behavioral changes
update USER-GUIDE.md and HANDOFF.md in the same commit. No deployment.

| Phase | Files / responsibility | Required verification | State |
|---|---|---|---|
| 1 | Root package manifests; this inventory; documentation index | Compatible XML/request parser fixes; both audits; full gate | Verified locally |
| 2 | App, api, Workspace, CapabilitiesModal, status helpers, styles | Startup/auth/config/timeout/malformed responses, reconnect, probes, pause/budget, theme/logout recovery | Verified locally |
| 3 | Home, Panels, MemoryPanel, ExplainMap, Workspace, AddAgentModal, work details | Retained drafts, failed evidence/events/history, old runs, context races | Verified locally |
| 4 | Workspace, NeedsYouView, Tray, MemoryPanel, work details | Six card types, global scopes, permission/conflict failures, pending guards, source navigation, legacy fallback | Verified locally |
| 5 | Workspace, Home, CommandBar, AddAgentModal, Nodes, format, header/context presentation, styles | Single Ask composer, Act on this, full control reachability, fresh boot, keyboard and responsive layouts | Verified locally |
| 6A | RoomsView, helpers, styles, tests | List/detail/lens/activity failures, refresh progress, export lifecycle, permissions | Verified locally |
| 6B | RulesView, AgentBuilder, helpers, styles, tests | Consent, saves, polling, rehearsal and publication gates, expiry | Verified locally |
| 6C | AdminModal, ActivityDock, Spending, styles, tests | Failed tables, retained edits, partial reorder, serialized connector edits, permissions | Verified locally |
| 7 | scripts, package command, guide, handoff, screenshots | Reproducible member sign-in → Ask → Act on this → answer Needs You, inspected desktop/mobile images | Planned |

## Control map

Permissions below preserve existing server enforcement: “existing access”
means the original view/edit permission, not a new grant. Advanced is available
to members. Destinations are approved targets until their phase is verified.
Evidence starts as the Phase 0 source/browser audit and is replaced with the
implementing test or journey when that phase lands. No operation is retired.

| Original surface / controls | Disposition | Destination | Permission | Phase | Evidence |
|---|---|---|---|---|---|
| App: Google sign-in, dev email/sign-in | Keep-as-is | Sign-in; dev-only controls stay dev-only | Public / dev | 2 | Phase 0 browser |
| Header: global Pause; banner owner Resume | Keep-as-is | Persistent header and paused banner | Existing pause / owner resume | 2,5 | Phase 0 source |
| Header: today's spend / cap | Keep-as-is | Header → Spending | Existing access | 2,5 | Phase 0 source |
| Home: Save/unsave, Saved only/Show all | Keep-as-is | Home answers | Existing edit/read | 3 | Phase 0 source |
| Sources: links, privacy/redaction | Keep-as-is | Answers, Sources and details, Rooms | Existing access | 3,6A | Phase 0 source |
| Dialogs: Close, Cancel, Back, Escape/focus return | Keep-as-is | Every existing dialog/panel | Existing access | 2–6C | Existing dialog tests |
| Account: identity, Sign out | Keep-as-is | Account | Signed in | 2,5 | Phase 0 source |
| Owner: operational ledger download | Keep-as-is | Account → Owner settings | Owner | 6C | Phase 0 source |
| Workspace: canvas selector/name | Simplify | Project-space picker | Existing access | 5 | Phase 0 source |
| Workspace: new canvas, name, Create/Cancel | Simplify | Picker → New project space | Existing create | 5 | Phase 0 source |
| Creation: six teams, agent preview | Simplify | Team selector, all six teams | Existing create | 5 | Phase 0 source |
| Creation: customize agents checkboxes | Simplify | Customize team | Existing create | 5 | Phase 0 source |
| Home: eight suggested questions | Simplify | Three examples + More examples | Existing access | 5 | Phase 0 source |
| Home: answer status, agent, mode, failure | Simplify | Plain-English answer header | Existing access | 3,5 | Phase 0 browser |
| Home: Full receipt/Hide receipt | Simplify | Sources and details | Existing access | 3 | Phase 0 source |
| Home: Open run | Simplify | View work / Work details | Existing access | 3 | Phase 0 source |
| Needs You: Mine/Team/All | Simplify | Global queue; each card names project space | Accessible spaces only | 4 | Phase 0 source |
| Needs You: Resolve, decision, Send decision, Back | Simplify | Answer → response → Submit answer | Existing edit | 4 | Phase 0 browser |
| Needs You: Context/Hide context | Simplify | Visible decision context + Full details | Existing access | 4 | Phase 0 source |
| Needs You: Redirect, target, instructions | Simplify | Other actions → Ask another agent | Existing edit | 4 | Phase 0 source |
| Needs You: assign person/agent, clear | Simplify | Other actions → Assign | Existing edit | 4 | Phase 0 source |
| Needs You: source-specific Dismiss | Simplify | Other actions → Dismiss | Existing access | 4 | Existing attention tests |
| Failed work: Retry/Open run | Simplify | Try again/View work | Existing edit/read | 4 | Phase 0 source |
| Review: Still true/extend, Open in Memory | Simplify | Confirm still true/Review memory | Existing edit/read | 4 | Existing memory tests |
| Scheduled result: Acknowledge, Open rule/brief | Simplify | Mark reviewed/View scheduled work/View brief | Existing access | 4,6B | Phase 0 source |
| Note: title, content, pin, Save, remove/keep | Simplify | Documents & notes → Note details | Existing edit/read | 3,5 | Phase 0 source |
| File: chooser/upload/details/download/remove/cancel | Simplify | Add document + Documents & notes → File details | Existing edit/read | 3,5 | Existing file tests |
| Task: details, person/agent assignment, unassign | Simplify | Task panel from Advanced canvas | Existing edit/read | 3,5 | Phase 0 source |
| Memory: search, kind, history toggle | Simplify | More → Memory | Existing access | 3,5 | Existing memory tests |
| Memory: certainty, provenance, review dates, warnings | Simplify | Always beside entry; plain-English label plus stored term | Existing access | 3,5 | Existing memory tests |
| Memory: Correct/cancel, replacement, certainty, reason, submit | Simplify | Entry → Correct | Existing edit | 3 | Existing correction tests |
| Memory: certainty reclassification | Simplify | Change certainty (creates correction) | Existing edit | 3 | Existing correction tests |
| Memory: lineage, lifecycle, upstream/downstream, run | Simplify | History and sources | Existing access | 3 | Existing lineage tests |
| Rooms: list/open/back, Now/History/Risk, Brief/Activity, Refresh | Simplify | More → Rooms | Existing access | 5,6A | Existing room tests |
| Rooms: create/name/type/players/staff/external ref | Simplify | Create room; setup details for staff/reference | Owner | 6A | Existing room tests |
| Rooms: export preview/included/excluded/warnings/download/close | Simplify | Room → Export | Owner | 6A | Existing export tests |
| Rules: list/open/back, instruction/template/Interpret | Simplify | More → Scheduled work | Existing access | 5,6B | Existing rule tests |
| Rules: edit instruction, full consent card | Simplify | Scheduled-work details | Existing authority | 6B | Existing consent tests |
| Rules: schedule/day/hour/sources/scope/agent/output/expiry | Simplify | Settings with UTC labels | Existing authority | 6B | Existing rule tests |
| Rules: Rehearse/Activate/Pause/Resume/Revoke | Simplify | Scheduled-work details | Existing authority | 6B | Existing rule tests |
| Rules: history/brief/matched count/source refs | Simplify | Scheduled-work results | Existing access | 6B | Existing rule tests |
| Header: theme | Simplify | Account → Appearance | Signed in | 2,5 | Phase 0 source |
| Canvas: agents/notes/tasks/files/people, select/open | Move-to-Advanced | More → Advanced → Canvas | Existing access | 5 | Existing canvas tests |
| Canvas: drag/pan/zoom/Fit/Tidy/minimap/clusters/handoffs | Move-to-Advanced | Advanced → Canvas | Existing access | 5 | Existing canvas tests |
| Composer: agent override | Move-to-Advanced | Advanced options | Existing edit | 5 | Phase 0 source |
| Composer: Rehearse | Move-to-Advanced | Advanced options → Practice (Rehearse) | Existing edit | 5 | Existing mode tests |
| CommandBar: text/voice/parse/preview/confirm/cancel/dismiss/pause/resume | Move-to-Advanced | Advanced → Commands | Existing access | 5 | Existing command tests |
| Agent: direct dispatch/recent runs/events | Move-to-Advanced | Canvas → Agent details | Existing edit/read | 3,5 | Existing panel tests |
| Agent: versions/configuration/rollback | Move-to-Advanced | Agent details → Advanced | Read / owner rollback | 3,5 | Existing version tests |
| Agent: remove/confirmation | Move-to-Advanced | Team → Agent details → Advanced | Existing edit | 5 | Phase 0 source |
| Builder: brief/propose/re-propose/start over/instructions/escalations/permissions/budgets/rehearse | Move-to-Advanced | Team → Advanced → Build an agent | Existing access | 5,6B | Existing builder tests |
| Builder: publish/template/change details | Move-to-Advanced | Same builder | Owner publication | 6B | Existing builder tests |
| Custom agent: name/role/tier/color/prompt/Add/Cancel | Move-to-Advanced | Team → Advanced → Custom agent | Existing edit | 5 | Phase 0 source |
| Rules: step/time budgets, technical occurrence details | Move-to-Advanced | Advanced settings/details; limits still on consent | Existing authority | 6B | Existing rule tests |
| Activity: expand/filter agent/seven categories/handoff highlight | Move-to-Advanced | Advanced → Activity | Existing access | 5,6C | Phase 0 source |
| Systems: provider/model/queue/segments/live link/board | Move-to-Advanced | Connections → Advanced details | Existing access | 2,5 | Existing lamp tests |
| Spending: tokens/monthly/per-agent/analytics | Move-to-Advanced | Spending → Advanced details | Existing access | 6C | Phase 0 source |
| Allowlist: email/name/role/add/remove | Move-to-Advanced | Owner settings → People and access | Owner | 6C | Existing admin tests |
| Roster: add/edit/name/role/tier/color/prompt/default/enabled/order | Move-to-Advanced | Owner settings → Agent templates | Owner | 6C | Phase 0 source |
| Connector: add/name/URL/access/headers/roles/enabled/probe/tools/refused details | Move-to-Advanced | Owner settings → Connections | Owner | 6C | Existing connector tests |
| Audit: action/limit/refresh/chain/entries | Move-to-Advanced | Owner settings → Audit history | Owner | 6C | Existing audit tests |
| Canvas: archive/list archived/restore | Move-to-Advanced | Project-space menu → Owner actions | Owner | 5 | Existing lifecycle tests |
| Spending: daily budget edit | Move-to-Advanced | Spending → Owner settings | Owner | 3,6C | Existing budget tests |
| Home composer + permanent CommandBar | Merge | One Home composer; parser under Advanced | Existing edit | 5 | Phase 0 browser |
| Ask/Act modes and button labels | Merge | Ask default; explicit Act and matching submit text | Existing edit | 5 | Phase 0 browser |
| Home/Canvas toggle | Merge | Stable Home + Advanced Canvas | Existing access | 5 | Phase 0 browser |
| Header Needs You/tray/HUD count | Merge | One badge/queue; legacy tray when flag off | Existing access | 4,5 | Existing fallback tests |
| Capabilities + Systems | Merge | Connections | Existing access | 2,5 | Existing capability tests |
| +Note/+Document | Merge | Documents & notes; Add document by composer | Existing edit | 5 | Phase 0 source |
| +Agent/+Person/team inspection | Merge | More → Team | Existing edit/read | 5 | Phase 0 source |

New controls: Act on this, Clear answer context, persistent Retry/Check status,
and Help with the four guide journeys. These add no server capability.

## Reliability audit (ranked)

| Impact | Observed gap | Phase / required recovery |
|---|---|---|
| High | Attention load errors become zero/empty | 2,4: loading/failed/stale/empty; Retry |
| High | Note save failures silent | 3: retain edits; inline Retry save |
| High | Dispatch, correction, roster and budget forms close before success | 3,6C: await acceptance; preserve draft |
| High | Review actions permit duplicate submissions and swallow failures | 4: per-card pending/error; reconcile conflicts |
| High | Boot errors look signed out; malformed JSON becomes null; no timeouts | 2: distinguish auth/service; bounded requests |
| High | Reconnect misses Home completion; pause depends on socket | 2,3: authoritative refresh and stale status |
| High | Failed health checks retain old greens; probes do not refresh board | 2: unknown/stale status; refetch after checks |
| High | Receipt/events failures hide evidence; memory writes confused with citations | 3: distinct evidence states and Retry |
| High | Source links lose entry/run, including old/retired-agent work | 3,4: explicit source references and receipt lookup |
| High | Late inquiries/rules/rooms/builder responses cross current context | 3,6A,6B: origin guards and obsolete polling cleanup |
| High | Startup resets Home; two composers disagree; Act button says Ask | 5: stable Home, one purpose-labelled composer |
| High | Header and review controls overlap/offscreen | 5: responsive primary controls |
| Medium | Queue local; Mine filtered after All cap | 4: global server-side scope |
| Medium | Rule/Builder polling silently stalls or overlaps | 6B: pending guards, stop obsolete polls, recovery |
| Medium | Room lens/refresh/export states misleading | 6A: selection guards and explicit progress |
| Medium | Owner failures become empty/green; partial order and racing writes | 6C: honest states, serialization, partial-save message |
| Medium | Missing roster allows accidental unstaffed creation; Builder default | 3,5: roster failure visible; templates first |
| Medium | View-only controls rejected by server | 3–6C: mirror existing permissions |
| Medium | Short raw toasts, missing labels/keyboard support | 2–6C: local recovery and accessible controls |
| Medium | Memory/spend/activity/work empty states ambiguous | 2,3,6A,6C: no fabricated zero; distinguish no matches |
| Lower | Theme/logout/microphone failures silent; cancelled command loses text | 2,5: explicit failure, preserve text, clean up recognition |
| Release gate | Root production audit has 1 high/3 moderate | 1: compatible installed dependencies and both audits |

## Implementation contract

- Reads time out after 30 seconds; submissions after 120 seconds. A timed-out
  mutation is unconfirmed: Check status, never automatically repeat it.
- Keep last-known data with a stale label. Unknown is neither green nor zero.
- Bind requests and transient drafts to their originating canvas and record.
- Global attention uses existing server scope without canvas_id, on entry,
  action completion, focus, reconnection and a visible 30-second interval.
  Badge scope stays Mine for members / All for owners independently of filters.
- Act on this attaches visible/removable answer context to an editable Act
  request. Submission still uses the inquiry endpoint and existing approval.
- Preserve feature flags, all consent fields, certainty values/shapes and
  source text. No framework, state library or persistent memory system.
- Backend list caps remain; do not promise complete pagination, universal
  memory propagation, supported answers, live OAuth or working integrations.
- Final browser fixtures use disposable databases and stub external services;
  capture 1280px and 390px, check 768px, keyboard and browser zoom.

## Local evidence ledger

- Phase 0: 433 backend and 112 frontend tests passed; production build and
  deploy preflight passed. Root audit failed (1 high, 3 moderate); frontend
  audit clean. Member sign-in, Ask, Act and review were exercised with local
  model stubs. No production probe was performed.

- Phase 1: installed @xmldom/xmldom 0.8.15, body-parser 1.20.8 and qs
  6.16.0; retained Express 4.22.2 and uuid override. Full verify passed
  (433 backend / 112 frontend), build/preflight passed; both production audits
  report zero vulnerabilities. No runtime behavior changed.

- Phase 2: request-reliability and startup-status tests cover timeouts,
  unconfirmed writes, malformed bodies, expired sessions, failed/recovered boot,
  context invalidation and failed/recovered health checks. Existing upload tests
  retain exact raw-body assertions with the added abort signal. Workspace
  failures remain visible with refresh; control values come from a status read.

  Phase 2 full gate: 433 backend / 124 frontend tests, build and preflight
  passed; both production audits clean. Workspace tests additionally verify
  list recovery, HTTP-confirmed pause without sockets, and retained sign-out.

- Phase 3: saved-work-reliability tests cover note retry, transient draft
  retention, rejected dispatch/budget/correction, unavailable versus empty
  answers/evidence/events, external citations without memory writes, old runs,
  and late submissions across spaces. WorkDetails uses the existing receipt
  endpoint independently of current agent/canvas lists. No server code changed.

  Phase 3 full gate: 433 backend / 133 frontend tests, build and preflight
  passed; both production audits clean. No existing tests deleted or skipped.

- Phase 4: review-reliability, needsyou, rules and workspace-cleanup tests
  cover all six card types, global server scopes and independent badge,
  source-space assignment, 403/409 reconciliation, duplicate guards,
  unconfirmed answers, exact source refs and honest legacy tray failures.
  Existing backend attention tests enforce restricted-space exclusion.

  Phase 4 full gate: 433 backend / 142 frontend tests, build and preflight
  passed; both production audits clean. No deployment.

- Phase 5: simplified-workspace tests verify one default composer, Ask default,
  visible/removable Act on this context without automatic submission, retained
  commands/practice/cancel, keyboard purpose selection and reachable navigation.
  Existing cleanup tests follow Documents & notes, the team dropdown and owner
  space actions while retaining all mutation and safety assertions. Workspace
  presentation is split into WorkspaceHeader and ContextViews; state ownership
  and feature flags remain in Workspace.

  Phase 5 full gate: 433 backend / 148 frontend tests, build and preflight
  passed; both production audits clean. Desktop and mobile evidence:
  [desktop](screenshots/phase5-desktop.png), [mobile](screenshots/phase5-mobile.png).
  The 768px layout was also inspected. A fast-completion regression test verifies
  that the POST snapshot cannot leave an already completed answer working.
  Live teammate presence remains reachable in Team. No deployment.

- Phase 6A: rooms-reliability tests cover failed lists/players/details/lenses/activity,
  pending refresh recovery, obsolete export previews and changed manifests. Binary
  downloads retain bounded requests and HTTP conflict errors. Existing Room tests
  retain all six sections and member/view-only permissions.
  Phase 6A full gate: 433 backend / 155 frontend tests, build and preflight
  passed; both production audits clean. No deployment.

- Phase 6B: scheduling-reliability tests exercise failed reads/settings, context
  races, unconfirmed consent changes, same-account rehearsal, stopped polling,
  retained Builder edits and abandoned proposals. Existing rule and Builder tests
  preserve every consent field, lifecycle operation, permission and publication
  diff. Settings retain work limits under Advanced; history retains occurrences
  under labelled details. Source-specific rules load their own team and access.
  Phase 6B full gate: 433 backend / 163 frontend tests, build and preflight
  passed; both production audits clean. No deployment.

- Phase 6C: owner-reliability tests cover all owner table failures, retained access
  and template drafts, one-at-a-time connection edits, partial-order recovery,
  audit badge invalidation, all seven activity filters and unknown spending.
  Systems details now live in Connections; configuration-only storage/search
  reports are neutral until actual delivery is verified. Adding backend probes
  remains outside this UX scope. The final control pass also labels sources,
  exposes Change certainty and gives original-file/ledger downloads bounded
  recovery through the existing endpoints.
  Phase 6C full gate: 433 backend / 174 frontend tests, build and preflight
  passed; both production audits clean. No deployment.

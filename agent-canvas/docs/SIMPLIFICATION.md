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
| 7 | scripts, package command, guide, handoff, screenshots; browser-found presentation fixes | Reproducible member sign-in → Ask → Act on this → answer Needs You, inspected desktop/mobile images | Verified locally |

## Control map

Permissions below preserve existing server enforcement: “existing access”
means the original view/edit permission, not a new grant. Advanced is available
to members. Every destination below exists in the local build. Evidence links
identify executable tests or explicitly labelled source inspection; source
inspection does not claim a live service check. No operation is retired.

| Original surface / controls | Disposition | Destination | Permission | Phase | Evidence |
|---|---|---|---|---|---|
| App: Google sign-in, dev email/sign-in | Keep-as-is | Sign-in; dev-only controls stay dev-only | Public / dev | 2 | [Startup] + [Journey] (development sign-in); Google OAuth remains unverified live |
| Header: global Pause; banner owner Resume | Keep-as-is | Persistent header and paused banner | Existing pause / owner resume | 2,5 | [Workspace] (HTTP-confirmed pause) + [Safety] + [Journey] (visible controls) |
| Header: today's spend / cap | Keep-as-is | Header → Spending, including before a space exists | Existing access | 2,5,7 follow-up | [Owner] + [Workspace] (empty account/recovery) + [Journey] (first-boot spending) + [Safety] |
| Home: Save/unsave, Saved only/Show all | Keep-as-is | Home answers | Existing edit/read | 3 | [Home] (saved-answer filters) + [Saved work] |
| Sources: links, privacy/redaction | Keep-as-is | Answers, Sources and details, Rooms | Existing access | 3,6A | [Saved work] (external evidence/retry) + [Room exports] (disclosure) |
| Dialogs: Close, Cancel, Back, Escape/focus return | Keep-as-is | Every existing dialog/panel | Existing access | 2–6C | [Dialogs] (Escape/trap/return) + [Journey] (Connections Escape) |
| Account: identity, Sign out | Keep-as-is | Account | Signed in | 2,5 | [Workspace] (sign-out failure) + [Startup] (expiry); [Header source] inspection |
| Owner: operational ledger download | Keep-as-is | Account → Owner settings | Owner | 6C | [Requests] (bounded download) + [Admin source] inspection: Download operational ledger |
| Workspace: canvas selector/name | Simplify | Project-space picker | Existing access | 5 | [Workspace] + [Journey] (active name/create); [Header source] inspection: picker |
| Workspace: new canvas, name, Create/Cancel | Simplify | Space actions → New project space | Existing create | 5 | [Workspace] (fresh/create/team) + [Journey] (empty boot → creation) |
| Creation: six teams, agent preview | Simplify | Team selector, all six teams | Existing create | 5 | [Workspace] (stable roster and team choices); [Header source] inspection: all six options |
| Creation: customize agents checkboxes | Simplify | Customize team | Existing create | 5 | [Workspace] (customization) + [Header source] inspection: Customize team |
| Home: eight suggested questions | Simplify | Three examples + More examples | Existing access | 5 | [Simplified] + [Home source] inspection: all eight examples retained |
| Home: answer status, agent, mode, failure | Simplify | Plain-English answer header | Existing access | 3,5 | [Home] + [Saved work] + [Journey] (Ask and Act result) |
| Home: Full receipt/Hide receipt | Simplify | Sources and details | Existing access | 3 | [Saved work] (receipt failure/recovery) + [Home] |
| Home: Open run | Simplify | View work / Work details | Existing access | 3 | [Saved work] (old run/events) + [Work source] inspection |
| Needs You: Mine/Team/All | Simplify | Global queue; each card names project space | Accessible spaces only | 4 | [Workspace] (global server scopes/badge) + [Attention] (restricted exclusion) |
| Needs You: Resolve, decision, Send decision, Back | Simplify | Answer → response → Submit answer | Existing edit | 4 | [Review] (pending/403/409/unconfirmed) + [Journey] (accepted answer and memory) |
| Needs You: Context/Hide context | Simplify | Visible decision context + Full details | Existing access | 4 | [Review] (full context and diagnostic labels) + [Journey] (review card) |
| Needs You: Redirect, target, instructions | Simplify | Other actions → Ask another agent | Existing edit | 4 | [Review] + [Review source] inspection: redirect form/callback |
| Needs You: assign person/agent, clear | Simplify | Other actions → Assign | Existing edit | 4 | [Review] (source-space choices) + [Assignment] (person/agent/unassign) |
| Needs You: source-specific Dismiss | Simplify | Other actions → Dismiss | Existing access | 4 | [Review] (projected and escalation actions) + [Attention] (dismissal) |
| Failed work: Retry/Open run | Simplify | Try again/View work | Existing edit/read | 4 | [Review] (source run reference) + [Saved work] (run details) |
| Review: Still true/extend, Open in Memory | Simplify | Confirm still true/Review memory | Existing edit/read | 4 | [Review] (reaffirm/ref) + [Memory lifecycle] (append-only review) |
| Scheduled result: Acknowledge, Open rule/brief | Simplify | Mark reviewed/View scheduled work/View brief | Existing access | 4,6B | [Review] + [Rules] (acknowledge/deep links) |
| Note: title, content, pin, Save, remove/keep | Simplify | Documents & notes → Note details | Existing edit/read | 3,5 | [Workspace] (pin/remove) + [Saved work] (retained note/retry) |
| File: chooser/upload/details/download/remove/cancel | Simplify | Add document + Documents & notes → File details | Existing edit/read | 3,5 | [Workspace] (upload/details/remove/view-only) + [Requests] (download) |
| Task: details, person/agent assignment, unassign | Simplify | Task panel from Advanced canvas | Existing edit/read | 3,5 | [Assignment] + [Panels source] inspection: TaskPanel assignment and retained error |
| Memory: search, kind, history toggle | Simplify | More → Memory | Existing access | 3,5 | [Saved work] + [Memory source] inspection: search/kind/history + [Room and memory evidence] |
| Memory: certainty, provenance, review dates, warnings | Simplify | Always beside entry; plain-English label plus stored term | Existing access | 3,5 | [Format] + [Saved work] + [Memory contract] + [Room and memory evidence] |
| Memory: Correct/cancel, replacement, certainty, reason, submit | Simplify | Entry → Correct | Existing edit | 3 | [Saved work] (rejected correction) + [Memory lifecycle] + [Room and memory evidence] |
| Memory: certainty reclassification | Simplify | Change certainty (creates correction) | Existing edit | 3 | [Saved work] (Change certainty contract) + [Memory lifecycle] |
| Memory: lineage, lifecycle, upstream/downstream, run | Simplify | History and sources | Existing access | 3 | [Saved work] (lineage recovery) + [Lineage] + [Memory source] inspection + [Room and memory evidence] |
| Rooms: list/open/back, Now/History/Risk, Brief/Activity, Refresh | Simplify | More → Rooms | Existing access | 5,6A | [Rooms] + [Room reliability] (lens/activity/refresh recovery) + [Journey] (destination) + [Room and memory evidence] |
| Rooms: create/name/type/players/staff/external ref | Simplify | Create room; setup details for staff/reference | Owner | 6A | [Rooms] (owner/view-only) + [Room reliability] (players failure) + [Room and memory evidence] |
| Rooms: export preview/included/excluded/warnings/download/close | Simplify | Room → Export | Owner | 6A | [Room reliability] (preview invalidation/conflict) + [Room exports] + [Room and memory evidence] |
| Rules: list/open/back, instruction/template/Interpret | Simplify | More → Scheduled work | Existing access | 5,6B | [Rules] (template/parse) + [Scheduling] (list failure) + [Journey] (destination) |
| Rules: edit instruction, full consent card | Simplify | Scheduled-work details | Existing authority | 6B | [Rules] (all consent fields, edits and authority) + [Scheduling] |
| Rules: schedule/day/hour/sources/scope/agent/output/expiry | Simplify | Settings with UTC labels | Existing authority | 6B | [Rules] (structured fields) + [Scheduling] (retained save/UTC) |
| Rules: Rehearse/Activate/Pause/Resume/Revoke | Simplify | Scheduled-work details | Existing authority | 6B | [Rules] (complete lifecycle) + [Scheduling] (same-account rehearsal) |
| Rules: history/brief/matched count/source refs | Simplify | Scheduled-work results | Existing access | 6B | [Rules] (brief/zero/source/history) + [Scheduling] (poll recovery) |
| Header: theme | Simplify | Account → Appearance | Signed in | 2,5 | [Startup] + [Header source] inspection: Appearance |
| Canvas: agents/notes/tasks/files/people, select/open | Move-to-Advanced | More → Advanced → Canvas | Existing access | 5 | [Nodes] (keyboard opening) + [Journey] (Canvas destination) + [Canvas source] inspection |
| Canvas: drag/pan/zoom/Fit/Tidy/minimap/clusters/handoffs | Move-to-Advanced | Advanced → Canvas | Existing access | 5 | [Journey] (Fit/Tidy reachable) + [Canvas source] inspection: all spatial handlers preserved |
| Composer: agent override | Move-to-Advanced | Advanced options | Existing edit | 5 | [Simplified] + [Home source] inspection: agent override |
| Composer: Rehearse | Move-to-Advanced | Advanced options → Practice (Rehearse) | Existing edit | 5 | [Simplified] (practice) + [Modes] (unchanged semantics) |
| CommandBar: text/voice/parse/preview/confirm/cancel/dismiss/pause/resume | Move-to-Advanced | Advanced → Commands | Existing access | 5 | [Simplified] (parse/practice/cancel/confirm) + [Commands source] inspection: voice/pause/resume |
| Agent: direct dispatch/recent runs/events | Move-to-Advanced | Canvas → Agent details | Existing edit/read | 3,5 | [Saved work] (dispatch/events) + [Panels source] inspection: recent runs |
| Agent: versions/configuration/rollback | Move-to-Advanced | Agent details → Advanced | Read / owner rollback | 3,5 | [Authority] + [Panels source] inspection: versions/configuration and owner rollback |
| Agent: remove/confirmation | Move-to-Advanced | Team → Agent details → Advanced | Existing edit | 5 | [Workspace] (agent removal) + [Agent removal] (retained history) |
| Builder: brief/propose/re-propose/start over/instructions/escalations/permissions/budgets/rehearse | Move-to-Advanced | Team → Advanced → Build an agent | Existing access | 5,6B | [Builder] + [Scheduling] (save/rehearse/abandon) + [Context source] inspection: Advanced path |
| Builder: publish/template/change details | Move-to-Advanced | Same builder | Owner publication | 6B | [Builder] (publish/diff) + [Authority] + [Builder source] inspection: template option |
| Custom agent: name/role/tier/color/prompt/Add/Cancel | Move-to-Advanced | Team → Advanced → Custom agent | Existing edit | 5 | [Context source] + [Add agent source] inspection: all manual fields and Add/Cancel retained |
| Rules: step/time budgets, technical occurrence details | Move-to-Advanced | Advanced settings/details; limits still on consent | Existing authority | 6B | [Rules] + [Scheduling] + [Rules source] inspection: limits and occurrences |
| Activity: expand/filter agent/seven categories/handoff highlight | Move-to-Advanced | Advanced → Activity | Existing access | 5,6C | [Owner] (seven filters/no matches/error) + [Activity source] inspection: handoff selection |
| Systems: provider/model/queue/segments/live link/board | Move-to-Advanced | Connections → Advanced details | Existing access | 2,5 | [Startup] (honest status) + [Capabilities source] inspection: labelled HUD details |
| Spending: tokens/monthly/per-agent/analytics | Move-to-Advanced | Spending → Advanced details | Existing access | 6C | [Owner] (unknown history/statistics) + [Panels source] inspection: advanced spending |
| Allowlist: email/name/role/add/remove | Move-to-Advanced | Owner settings → People and access | Owner | 6C | [Owner] (failed table/invite/draft) + [Admin source] inspection: roles/remove |
| Roster: add/edit/name/role/tier/color/prompt/default/enabled/order | Move-to-Advanced | Owner settings → Agent templates | Owner | 6C | [Owner] (retained editor/partial ordering) + [Admin source] inspection: all fields/toggles |
| Connector: add/name/URL/access/headers/roles/enabled/probe/tools/refused details | Move-to-Advanced | Owner settings → Connections | Owner | 6C | [Owner] (serialized edits) + [Connectors] + [Admin source] inspection: probe/tools/refusals |
| Audit: action/limit/refresh/chain/entries | Move-to-Advanced | Owner settings → Audit history | Owner | 6C | [Owner] (failed chain invalidation) + [Admin source] inspection: action/limit/refresh |
| Canvas: archive/list archived/restore | Move-to-Advanced | Space actions → Owner actions | Owner | 5 | [Workspace] (archive/empty) + [Archive] + [Header source] inspection: restore path |
| Spending: daily budget edit | Move-to-Advanced | Spending → Owner settings, including before a space exists | Owner | 3,6C,7 follow-up | [Saved work] + [Workspace] (role and saved-cap validation) + [Owner] + [Safety] |
| Home composer + permanent CommandBar | Merge | One Home composer; parser under Advanced | Existing edit | 5 | [Simplified] (one composer) + [Journey] (one textbox) |
| Ask/Act modes and button labels | Merge | Ask default; explicit Act and matching submit text | Existing edit | 5 | [Simplified] (Ask/Act/context/keyboard) + [Journey] (purpose-matched submissions) |
| Home/Canvas toggle | Merge | Stable Home + Advanced Canvas | Existing access | 5 | [Simplified] (Home default) + [Journey] (Advanced Canvas reachability) |
| Header Needs You/tray/HUD count | Merge | One badge/queue; legacy tray when flag off | Existing access | 4,5 | [Workspace] (independent badge) + [Review] (legacy flag path) + [Journey] |
| Capabilities + Systems | Merge | Connections | Existing access | 2,5 | [Startup] + [Capabilities source] inspection + [Journey] (Connections) |
| +Note/+Document | Merge | Documents & notes; Add document by composer | Existing edit | 5 | [Workspace] (notes/files) + [Journey] (Documents destination) |
| +Agent/+Person/team inspection | Merge | More → Team | Existing edit/read | 5 | [Context source] + [Add agent source] inspection + [Journey] (Team destination) |

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

- Phase 7: the real-browser runner uses existing development sign-in, inquiry,
  receipt and resolution routes. It verifies four member journeys without
  Advanced/owner controls at both 1280px and 390px; accepted review persists as
  a verified human memory record. Fresh databases contain zero project content.
  Queue failure/recovery, keyboard selection, 768px and actual Chromium tab zoom
  at 200% also pass. All 16 final screenshots were inspected for legibility,
  overflow and covered controls. Browser-found fixes reserve notification space,
  remove generated agent identifiers from ordinary review text, and separate the
  follow-up title from its unchanged full context. Added regression assertions
  preserve exact authored text and technical details.
  Phase 7 full gate: 433 backend / 177 frontend tests, build and preflight
  passed; both production audits clean. Original test files and assertions remain;
  no existing test is deleted or skipped. Backend implementation is unchanged.

## Journey evidence

Pete completed a **guided local walkthrough on 2026-09-10** using his owner
account. His screenshots showed the answered Ask request with Act on this,
then the renewal review item assigned to Pete; he reported completion after
Submit answer. This was assisted acceptance with test model responses, not
independent guide-only or live-integration verification. The first pasted result
was from the unchanged production site; the local preview was then opened and
the walkthrough repeated there.

The follow-up review fixed Spending being inaccessible before a space existed.
Daily status and owner cap editing now open independently of project loading;
history explains that a project must be selected. Incomplete status after a cap
save remains unconfirmed. Three regression tests and the first-boot browser check
cover these paths. Follow-up gate: 433 backend / 180 frontend tests, build and
preflight passed; both production audits clean.

Run `npm run test:journeys` from the application directory. Install Chromium
once with `npx playwright install chromium` if it is not present. The runner
builds the frontend, starts isolated test servers and regenerates the images
below. `npm run preview:journeys` opens the same disposable setup for manual
reproduction using [the guide](../USER-GUIDE.md#reproduce-the-four-journeys-locally).
The manual preview uses **pete@cloudtechgurus.com** with the existing owner role
and assigns its review item to Pete. Automated coverage separately uses the
fictional **teammate@agent-canvas.invalid** member, plus a complete Pete preview
journey that checks the signed-in identity, owner role and Mine assignment. The
member screenshots use the fictional account. No teammate credentials are used.

[Machine-readable results](screenshots/manifest.json) include empty-boot counts,
accepted review state, verified decision memory, blocked-network counts and the
measured browser zoom (640 CSS pixels at 200% in a 1280px window). The fixture
does not share the application's database or inherit integration credentials.
All results are local: Google OAuth and external service success remain unverified.

| Step / checked result | Desktop, 1280px | Mobile, 390px |
|---|---|---|
| Development sign-in; Google unconfigured stated | [Sign in](screenshots/journey-desktop-01-sign-in.png) | [Sign in](screenshots/journey-mobile-01-sign-in.png) |
| Ask answered; unsupported source state explicit | [Ask](screenshots/journey-desktop-02-ask.png) | [Ask](screenshots/journey-mobile-02-ask.png) |
| Act on this; editable request and removable context | [Act context](screenshots/journey-desktop-03-act-context.png) | [Act context](screenshots/journey-mobile-03-act-context.png) |
| Act returns the draft checklist | [Act result](screenshots/journey-desktop-03b-act-result.png) | [Act result](screenshots/journey-mobile-03b-act-result.png) |
| Assigned review; full decision context and answer form | [Needs You](screenshots/journey-desktop-04-needs-you.png) | [Needs You](screenshots/journey-mobile-04-needs-you.png) |
| Accepted answer; card clears after confirmed response | [Accepted](screenshots/journey-desktop-05-review-saved.png) | [Accepted](screenshots/journey-mobile-05-review-saved.png) |
| Unavailable queue has a recovery action and no false empty claim | [Recovery](screenshots/journey-desktop-06-queue-recovery.png) | [Recovery](screenshots/journey-mobile-06-queue-recovery.png) |

Additional inspected images: [768px layout](screenshots/journey-tablet-768.png)
and [actual 200% browser zoom](screenshots/journey-desktop-200-percent.png).
The runner asserts no horizontal overflow, visible spending/Connections/Pause,
notifications outside the work area, and no browser runtime errors. It separately
opens Documents, Team, Rooms, Scheduled work and Advanced Canvas after the four
journeys, so that secondary navigation is tested without becoming a prerequisite.

Remaining boundaries are deliberate: bounded backend lists, project/shared memory
scope, unavailable provider/connector configurations, and production activation.
No pagination, universal memory propagation, backend probes, permission changes,
push or deployment was added to this work.

## Secondary browser acceptance (2026-09-11)

`npm run test:acceptance -- rooms-memory` runs a separate disposable fixture with
Pete as owner and a fictional member. [Acceptance runner] uses real local saves,
permissions, memory correction and export routes; only the model boundary and
deliberately injected failed requests are stubbed. See [Room and memory evidence].

- Room creation preserves rejected drafts, updates the project picker on success,
  and retains type, selected people, staff and reference. All three lenses, failed
  activity/retry, refresh polling/recovery and work details were exercised.
- A real append after an export preview causes a conflict; fresh review/download
  succeeds and excludes assumptions/inferences. Member and view-only controls,
  plus restricted-Room exclusion after access revocation, were checked.
- Memory search/no matches/kind/history, rejected correction with retained input,
  append-only replacement and failed lineage/retry were exercised. Computed border
  styles and symbols match all three certainty states, including at 390px.
- Fixed a label-refactor regression affecting Memory symbols/borders and receipt
  certainty styles; plain-English labels remain alongside stored meanings.
- The original 14-worker backend gate twice hit PDF/connector deadlines while
  those suites passed alone. Backend and frontend runners now cap workers at four;
  every test and all runtime/test deadlines stay unchanged.
- Faster PDF completion exposed an existing test typo: the parser warning is
  `source_limit`, while the test checked `source_limit_message`. The assertion
  now checks the existing output field and the same required recovery wording;
  no backend implementation or safety limit changed.
- Full gate: 433 backend / 185 frontend tests; both production audits clean.
  Three screenshots inspected. These checks do not prove Google or live integrations.

Control rows for Room creation/lenses/refresh/export and Memory filtering,
certainty/correction/history now have browser evidence in addition to their
listed component/backend tests. Other rows retain their explicitly listed evidence.

## Local acceptance and deferred release

Agent Canvas remains a folder within the second-brain repository. Pete directed
continued local work on 2026-09-11. Publishing branches, PRs, merging, deployment
and live connector activation are deferred until separately requested. The local
implementation remains split into these independently verified changes:

| Review | Commit(s) | Scope |
|---|---|---|
| 1 | `397149b` | Compatible dependency fixes and approved inventory |
| 2 | `546bf78` | Startup and truthful status |
| 3 | `4f9459f` | Answers, evidence and retained work |
| 4 | `af0122f` | Global Needs You and guarded actions |
| 5 | `84f1505` | Default navigation and composer |
| 6A | `4cce819` | Rooms |
| 6B | `484fe4a` | Scheduled work and Builder |
| 6C | `e57c67e` | Owner tools and diagnostics |
| 7 | `291292b`, `c8b17d6` | Journey evidence and Pete preview identity |
| Follow-up | After `c8b17d6` on the simplification branch | First-boot spending and guided acceptance record |

The next local acceptance groups are Rooms/Memory, Scheduled work/Builder and
owner tools/diagnostics. Exercise real local routes in a disposable browser fixture,
inject failed requests, fix discovered regressions, and rerun the complete gate
and both audits after each group. Source inspection and component tests remain
distinct from browser evidence. Google OAuth and external integration acceptance
remain unverified; local fixtures do not authorize or prove live access.

[Startup]: ../frontend/test/startup-status.test.jsx
[Journey]: ../scripts/journey-test.js
[Acceptance runner]: ../scripts/acceptance-test.js
[Room and memory evidence]: screenshots/acceptance-rooms-memory.json
[Workspace]: ../frontend/test/workspace-cleanup.test.jsx
[Safety]: ../test/orchestrator-safety.test.js
[Owner]: ../frontend/test/owner-reliability.test.jsx
[Home]: ../frontend/test/home.test.jsx
[Saved work]: ../frontend/test/saved-work-reliability.test.jsx
[Room exports]: ../test/rooms.test.js
[Dialogs]: ../frontend/test/dialog.test.jsx
[Header source]: ../frontend/src/WorkspaceHeader.jsx
[Requests]: ../frontend/test/request-reliability.test.jsx
[Admin source]: ../frontend/src/AdminModal.jsx
[Simplified]: ../frontend/test/simplified-workspace.test.jsx
[Home source]: ../frontend/src/Home.jsx
[Work source]: ../frontend/src/WorkDetails.jsx
[Attention]: ../test/attention.test.js
[Review]: ../frontend/test/review-reliability.test.jsx
[Review source]: ../frontend/src/NeedsYouView.jsx
[Assignment]: ../test/people-assignment.test.js
[Memory lifecycle]: ../test/memory-lifecycle.test.js
[Rules]: ../frontend/test/rules.test.jsx
[Panels source]: ../frontend/src/Panels.jsx
[Memory source]: ../frontend/src/MemoryPanel.jsx
[Format]: ../frontend/test/format.test.jsx
[Memory contract]: ../test/memory-contract.test.js
[Lineage]: ../test/explain-map.test.js
[Rooms]: ../frontend/test/rooms.test.jsx
[Room reliability]: ../frontend/test/rooms-reliability.test.jsx
[Scheduling]: ../frontend/test/scheduling-reliability.test.jsx
[Nodes]: ../frontend/test/nodes.test.jsx
[Canvas source]: ../frontend/src/Workspace.jsx
[Modes]: ../test/run-modes.test.js
[Commands source]: ../frontend/src/CommandBar.jsx
[Authority]: ../test/agent-authority.test.js
[Agent removal]: ../test/agent-removal.test.js
[Builder]: ../frontend/test/builder.test.jsx
[Context source]: ../frontend/src/ContextViews.jsx
[Builder source]: ../frontend/src/AgentBuilder.jsx
[Add agent source]: ../frontend/src/AddAgentModal.jsx
[Rules source]: ../frontend/src/RulesView.jsx
[Activity source]: ../frontend/src/ActivityDock.jsx
[Capabilities source]: ../frontend/src/CapabilitiesModal.jsx
[Connectors]: ../test/mcp-connectors.test.js
[Archive]: ../test/canvas-archive.test.js

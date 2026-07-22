=== GSD DEPENDENCY AUDIT REPORT ===
Generated: 2026-07-21 (full project audit; supersedes 2026-07-16 report)
Scope: npm
Project root: /Users/cpconnor/projects/second-brain

--- SUMMARY ---
Overall verdict: PASS (staleness FLAGs only, all dispositioned)
Security: PASS — npm audit: 0 critical / 0 high / 0 moderate / 0 low / 0 info
Staleness: FLAG — 2 prod majors behind by design, 1 prod major pending decision
Licenses:  PASS — license-checker allowlist exit 0

--- SECURITY ---

npm audit (2026-07-21): 0 vulnerabilities at all severities.
Every advisory from the 2026-07-16 report is closed:
- GHSA-p7fg-763f-g4gf (@anthropic-ai/sdk) — no longer flagged at installed 0.91.1
- brace-expansion / js-yaml / @babel/core transitives — resolved by the
  eslint 10.7.0 / jest 30.4.2 in-range updates (commit 85dcf82)

--- APPLIED THIS AUDIT (commit 85dcf82, lockfile-only, all in-range) ---

| Package | From | To | Class |
|---|---|---|---|
| ajv | 8.18.0 | 8.20.0 | minor (prod) |
| eslint | 10.2.1 | 10.7.0 | minor (dev) |
| eslint-plugin-jest | 29.15.2 | 29.15.5 | patch (dev) — surfaces 9 new expect-expect warnings, logged in todos.md |
| jest | 30.3.0 | 30.4.2 | minor (dev) |
| nock | 14.0.13 | 14.0.16 | patch (dev) |

Verified after update: CI=true suite 1470 passed / 38 skipped / 1508 total
(identical to pre-update baseline), npm run lint exit 0, license-check PASS.

--- REMAINING STALENESS (logged, not applied — Pete-gated) ---

| Package | Installed | Latest | Disposition |
|---|---|---|---|
| @anthropic-ai/sdk | 0.91.1 | 0.112.5 | Pending decision — no open advisory; 0.x major-equivalent jump; only `messages.create` surface used, upgrade is low-risk but needs a deliberate pass |
| chokidar | 3.6.0 | 5.0.0 | REJECTED by design — v5 is ESM-only, project is CJS (PROJECT.md Key Decisions) |
| voyageai | 0.2.1 | 0.4.0 | Deliberate exact pin — upgrade requires semantic-index compat test + fresh eval:recall baseline comparison |
| eslint-plugin-n | 17.24.0 | 18.2.2 | Dev-only major — fold into the next approved eslint-config session (B-19) |

=== END REPORT ===

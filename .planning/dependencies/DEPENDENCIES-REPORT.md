=== GSD DEPENDENCY AUDIT REPORT ===
Generated: 2026-08-19T14:32:00Z
Scope: npm
Project root: /Users/cpconnor/projects/second-brain

--- SUMMARY ---
Overall verdict: PASS
Security: PASS — 0 critical, 0 high, 0 moderate, 0 low
Staleness: PASS — 0 packages flagged
Licenses:  PASS — 0 packages flagged

--- SECURITY FINDINGS ---
(none)

--- STALENESS FINDINGS ---
(none)

--- LICENSE FINDINGS ---
(none)

--- TOOL STATUS ---
(all tools present)

--- RECOMMENDATIONS ---
1. No action required. Continue current dependency maintenance practices.
2. Re-audit monthly or after any dependency change.
3. Monitored packages (voyageai@0.2.1 exact-pinned for Phase 19 semantic embeddings, chokidar@3.6.0 held for CJS compat) remain intentionally held — verify no CVEs arise before upgrading.

=== END REPORT ===

## DETAILED FINDINGS

### Project Structure
- **Name:** second-brain v1.7.0
- **Runtime:** Node.js >=22 (Node 22 LTS required, tested in CI)
- **Lockfile:** package-lock.json (v3) — present and valid
- **Dependency counts:**
  - Production: 6 direct, 40 total transitive
  - Development: 9 direct, 462 total transitive
  - Optional: 30 transitive
  - Peer: 1 transitive
  - Grand total: 502 dependencies

### Security Audit
npm audit returned 0 vulnerabilities across all severity levels. Lockfile is current and all transitive dependencies are clean.

### Staleness Analysis
Seven packages have available updates:

| Package | Current | Latest | Type | Status |
|---------|---------|--------|------|--------|
| @anthropic-ai/sdk | 0.112.5 | 0.117.1 | prod | Intentional (pre-1.0 minor delta, no CVE, <2yr stale) |
| chokidar | 3.6.0 | 5.0.0 | prod | **HELD:** CJS compatibility documented hold |
| eslint | 10.7.0 | 10.8.1 | dev | Patch within minor (silent) |
| eslint-plugin-jest | 29.15.5 | 29.16.1 | dev | Patch within minor (silent) |
| eslint-plugin-n | 18.2.2 | 18.3.0 | dev | Minor within pre-1.0 (silent) |
| nock | 14.0.16 | 14.0.17 | dev | Patch within version (silent) |
| voyageai | 0.2.1 | 0.4.0 | prod | **HELD:** Phase 19 semantic embeddings exact-pin documented |

Per audit policy: dev dependencies with patch/minor updates are not flagged (noise suppression). Production deps with intentional holds (chokidar CJS compat, voyageai Phase 19 lock) are documented and not flagged. No packages are >2 years stale or have unpatched CVEs.

### License Analysis
npm run license-check passed without warnings. All production+transitive dependencies carry licenses from the allowlist:
- MIT (majority, ~30 packages)
- ISC (4 packages)
- BSD-2-Clause (4 packages)
- BSD-3-Clause (1 package)
- Unlicense (1 package)

No permissive/copyleft/proprietary conflicts detected.

### Audit Confidence
- **Lockfile present:** Yes (package-lock.json v3, locked)
- **Tools available:** Yes (npm audit, npm outdated, npm ls, npm run license-check all executed)
- **Network status:** Stable (all queries completed)
- **Policy present:** No project-level `LICENSE-POLICY.md` detected; using defaults from package.json allowlist
- **Coverage:** 100% of manifest (6 prod, 9 dev direct deps audited; 502 transitive scanned)

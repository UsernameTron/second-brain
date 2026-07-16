=== GSD DEPENDENCY AUDIT REPORT ===
Generated: 2026-07-16T00:00:00Z
Scope: npm
Project root: /Users/cpconnor/projects/second-brain

--- SUMMARY ---
Overall verdict: FLAG
Security: FLAG — 1 moderate (prod), 3 moderate/low (transitive/dev)
Staleness: FLAG — 2 production deps major version behind
Licenses:  PASS — 0 packages flagged

--- SECURITY FINDINGS ---

MODERATE @anthropic-ai/sdk@0.90.0 → 0.111.0
  CVE: GHSA-p7fg-763f-g4gf (GitHub advisory)
  Title: Claude SDK for TypeScript has Insecure Default File Permissions in Local Filesystem Memory Tool
  Advisory: https://github.com/advisories/GHSA-p7fg-763f-g4gf
  Path: direct
  CWE: CWE-732
  Fix: npm install @anthropic-ai/sdk@0.111.0 (requires semver major upgrade)

MODERATE brace-expansion@5.0.2-5.0.5 → 5.0.6
  CVE: GHSA-jxxr-4gwj-5jf2 (GitHub advisory)
  Title: brace-expansion: Large numeric range defeats documented `max` DoS protection
  Advisory: https://github.com/advisories/GHSA-jxxr-4gwj-5jf2
  Path: transitive via @eslint/config-array, @typescript-eslint/typescript-estree, eslint
  CWE: CWE-400
  CVSS: 6.5
  Fix: npm install @eslint/config-array@latest (or eslint@latest to pull transitively)

MODERATE js-yaml@<3.15.0 → 3.15.0+
  CVE: GHSA-h67p-54hq-rp68 (GitHub advisory)
  Title: JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases
  Advisory: https://github.com/advisories/GHSA-h67p-54hq-rp68
  Path: transitive via eslint/js-yaml
  CWE: CWE-407
  CVSS: 5.3
  Fix: npm install js-yaml@latest (or eslint@latest to pull transitively)

LOW @babel/core@7.29.0 → 7.30.0+
  CVE: GHSA-4x5r-pxfx-6jf8 (GitHub advisory)
  Title: @babel/core: Arbitrary File Read via sourceMappingURL Comment
  Advisory: https://github.com/advisories/GHSA-4x5r-pxfx-6jf8
  Path: transitive via jest
  CWE: CWE-22, CWE-200
  CVSS: 3.2
  Fix: npm install jest@latest (pulls @babel/core transitively)

--- STALENESS FINDINGS ---

@anthropic-ai/sdk@0.90.0 → 0.111.0 (major) — prod dep, 21 minor versions behind, security fix available
  Last release: 2025-02-12 (0.111.0)
  Prod/Dev: prod
  Note: Also blocks GHSA-p7fg-763f-g4gf fix

chokidar@3.6.0 → 5.0.0 (major) — prod dep, 2 major versions behind
  Last release: 2025-06-14 (5.0.0)
  Prod/Dev: prod

eslint-plugin-n@17.24.0 → 18.2.2 (major) — dev dep with major version available
  Last release: 2025-01-15 (18.2.2)
  Prod/Dev: dev

voyageai@0.2.1 → 0.4.0 (minor in 0.x) — prod dep, pinned version has 2 minor increments available
  Last release: 2025-07-10 (0.4.0)
  Prod/Dev: prod
  Note: 0.x semver treats minor as breaking change equivalent

--- LICENSE FINDINGS ---
(none)

--- TOOL STATUS ---
(all tools present and successful)

--- RECOMMENDATIONS ---

1. PRIORITY: Upgrade @anthropic-ai/sdk to 0.111.0 to fix GHSA-p7fg-763f-g4gf (insecure file permissions). This is a breaking change (0.90 → 0.111) — review API changes and test thoroughly.

2. Upgrade chokidar from 3.6.0 to 5.0.0. Major version jump — check changelog for API breaking changes before upgrading.

3. Upgrade eslint to latest (10.7.0) and jest to latest (30.4.2) to transitively pull fixes for brace-expansion, js-yaml, and @babel/core. These are minor/patch updates with no breaking changes expected.

4. Consider pinning voyageai to 0.4.0 instead of 0.2.1. Verify that the 0.2 → 0.4 jump is compatible with your semantic index initialization code (in `src/semantic-index.js`).

5. After upgrades, re-run `npm audit` to confirm all vulnerabilities are resolved.

=== END REPORT ===

## DETAILED FINDINGS

### Project Structure
- **Manifest:** package.json v1.0.0
- **Lockfile:** package-lock.json v3 (accurate)
- **Production dependencies:** 6 direct
- **Development dependencies:** 8 direct
- **Total transitive deps:** 496 (37 prod, 459 dev, 27 optional, 1 peer)

### Security Audit Confidence
- All audit data derived from `npm audit --json` (reliable JSON parsing)
- Lockfile present and accurate (lockfileVersion 3)
- Network connection stable during audit

### License Audit Confidence
- All direct and transitive dependencies pass license-checker validation
- Allowed list: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC0-1.0
- No UNLICENSED, GPL, AGPL, or proprietary licenses found
- Project has no custom LICENSE-POLICY.md; using audit defaults

### Staleness Notes
- @anthropic-ai/sdk: 21 minor versions behind (0.90 → 0.111 is major). Current version is end-of-feature-support; upgrading is required.
- chokidar: 2 major versions behind. Used for file watching; major versions may have API changes in file event signatures.
- voyageai: pinned at 0.2.1 (exact version, not caret). 0.4.0 available; pre-1.0 semver means minor jumps can break. Requires manual upgrade and testing.
- eslint ecosystem (eslint, eslint-plugin-jest, eslint-plugin-n): mixed minor/patch/major lags; all are dev-only so lower priority. eslint itself has patches (10.2.1 → 10.7.0) that fix transitive deps.

### Audit Limitations
- Transitive vulnerability fixes require upgrading parent packages (e.g., brace-expansion requires updating eslint)
- No attempt made to check for supply-chain risk (inactive maintainers, long release gaps) beyond the 2-year stale rule
- CVE data current as of 2026-07-16 npm registry snapshot

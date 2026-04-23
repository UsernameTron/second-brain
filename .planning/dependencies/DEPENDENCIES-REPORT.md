=== GSD DEPENDENCY AUDIT REPORT ===
Generated: 2026-04-23T00:00:00Z
Scope: npm
Project root: /Users/cpconnor/projects/second-brain

--- SUMMARY ---
Overall verdict: FLAG
Security: PASS — 0 critical, 0 high, 0 moderate, 0 low
Staleness: FLAG — 1 package flagged
Licenses:  PASS — 0 packages flagged

--- SECURITY FINDINGS ---
(none)

--- STALENESS FINDINGS ---
chokidar@3.6.0 → 5.0.0 (major) — prod dep, major version behind
  Latest release: 2025-11-25
  Prod/Dev: prod
  Reason: 2 major versions available (4.0.0 released 2024-09-13, 5.0.0 released 2025-11-25)

--- LICENSE FINDINGS ---
(none)

--- TOOL STATUS ---
(all tools present)

--- RECOMMENDATIONS ---
1. Evaluate chokidar@5.0.0 for compatibility. Breaking changes from v3→v4 and v4→v5 require review before upgrade.
2. @anthropic-ai/sdk@0.90.0 is current (released 2026-04-16). No action needed.
3. gray-matter@4.0.3 is stable. Last major release was 4.0.0 in 2018; this is expected for mature packages.
4. ajv@8.18.0 is correctly scoped to devDependencies only.

=== END REPORT ===

## DETAILED FINDINGS

### Project Structure
- **Lockfile**: present (package-lock.json v3)
- **Production dependencies**: 3 direct, 30 total including transitive
- **Development dependencies**: 2 direct, 315 total including transitive (heavy test stack)
- **Overall dependency tree**: 345 packages total (dev includes jest and its ecosystem)

### Direct Dependencies Status

#### Production
| Package | Current | Latest | Status | License |
|---------|---------|--------|--------|---------|
| @anthropic-ai/sdk | 0.90.0 | 0.90.0 | Current | MIT |
| chokidar | 3.6.0 | 5.0.0 | MAJOR behind | MIT |
| gray-matter | 4.0.3 | 4.0.3 | Current | MIT |

#### Development
| Package | Current | Latest | Status | License |
|---------|---------|--------|--------|---------|
| ajv | 8.18.0 | Latest | Current | MIT |
| jest | 30.3.0 | Latest | Current | MIT |

### Audit Confidence
- **Security audit**: `npm audit --json` reports 0 vulnerabilities (info: 0, low: 0, moderate: 0, high: 0, critical: 0)
- **Lockfile**: Present and up-to-date (lockfileVersion 3)
- **Network**: Stable (registry queries successful)

### Chokidar Major Version Consideration
Chokidar went through 2 major version bumps in the past 18 months:
- v3.6.0 (current) → v4.0.0 (Sept 2024) — likely includes breaking API changes
- v4.0.3 (Dec 2024) → v5.0.0 (Nov 2025) — another breaking cycle

Before upgrading, verify:
1. Vault-gateway.js or any code that uses chokidar's watch API remains compatible
2. Test with v4 first, then v5 (staged rollout)
3. Check chokidar GitHub changelog for specific breaking changes

### License Compatibility
All direct dependencies (production and dev) use MIT license:
- @anthropic-ai/sdk: MIT
- chokidar: MIT
- gray-matter: MIT
- ajv: MIT
- jest: MIT

No strong copyleft, proprietary, or custom EULA licenses detected. No license policy file found; applying default permissive classification. All packages compatible with ISC project license.

### Transitive Dependencies
npm audit detected 30 production and 315 development transitive dependencies with no vulnerabilities. The large dev count is expected for jest (test framework) and its ecosystem of plugins, preprocessors, and reporters.

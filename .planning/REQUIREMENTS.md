# Requirements: Second Brain

**Defined:** 2026-04-22
**Core Value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

## v1.1 Requirements

Requirements for go-live. No new features — defect fixes, integration wiring, validation, and hardening.

### Integration Wiring

- [ ] **INTEG-01**: gmail-mcp-pete OAuth wired with real credentials (gmail.readonly + gmail.compose scopes, VIP filtering active)
- [ ] **INTEG-02**: RemoteTrigger enabled on real pre-morning cron schedule for /today execution
- [ ] **INTEG-03**: Excluded terms expanded from 3 seed entries to 15-20 covering former employers, project codenames, client names, internal tools

### Defect Fixes

- [ ] **FIX-01**: In-batch dedup in promote-memories — track Set of promoted contentHashes within batch loop, prevent duplicate promotion
- [ ] **FIX-02**: Config hot-reload — diagnose and fix fs.watch / cache invalidation so config changes take effect without Node restart

### Validation

- [ ] **UAT-01**: LLM classification accuracy spot-check on real captures (minimum 10 diverse inputs, >80% correct routing)
- [ ] **UAT-02**: Wikilink relevance review — promoted memories produce meaningful cross-references against existing vault content
- [ ] **UAT-03**: Obsidian UX walkthrough — capture → classify → propose → promote flow works end-to-end in vault UI

### Hardening

- [ ] **CI-01**: GitHub Actions pipeline that runs full test suite on push to master and on PRs

## Future Requirements

Deferred to v1.2+ after living with the system.

- **FEAT-01**: New capabilities TBD after 2+ weeks of daily use
- **EXCL-01**: Expand excluded terms beyond 20 based on real-world captures

## Out of Scope

| Feature | Reason |
|---------|--------|
| New commands or features | v1.1 is go-live hardening only; new capabilities after real-world use |
| Gmail send capability | Zero-trust: draft-only, never send |
| Autonomous memory promotion | Human review gate is non-negotiable |
| Mobile app | Obsidian desktop/sync is the interface |
| Vector store / ChromaDB | Premature optimization at personal scale |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INTEG-01 | Phase 5 | Pending |
| INTEG-02 | Phase 5 | Pending |
| INTEG-03 | Phase 5 | Pending |
| FIX-01 | Phase 6 | Pending |
| FIX-02 | Phase 6 | Pending |
| UAT-01 | Phase 6 | Pending |
| UAT-02 | Phase 6 | Pending |
| UAT-03 | Phase 6 | Pending |
| CI-01 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-22*
*Last updated: 2026-04-22 after initial definition*

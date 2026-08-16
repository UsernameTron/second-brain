# Agent Canvas — Claude Code Project

Multi-agent canvas workspace for cloudtechgurus.com. Subproject of the
second-brain repo; the repo-root CLAUDE.md governs workflow.

- **Orientation:** read [docs/README.md](docs/README.md) first. It classifies
  current, reference, and historical artifacts.
- **Current state:** [docs/HANDOFF.md](docs/HANDOFF.md) is the current-state
  block and nothing else — it is authoritative for repository and deployment
  status. Its former tail lives in
  [docs/HANDOFF-HISTORY.md](docs/HANDOFF-HISTORY.md), which is history, not
  instruction.
- **Roadmap:** [docs/ROADMAP.md](docs/ROADMAP.md) separates phase intent from
  implementation, deployment, and live acceptance.
- **Deploy:** [docs/DEPLOY.md](docs/DEPLOY.md); ops runbook pointers in
  [docs/DEVOPS-HANDOFF.md](docs/DEVOPS-HANDOFF.md).
- **Verification gate:** `npm run verify` — backend `node:test`, frontend
  vitest, the frontend production build, `deploy.sh` syntax, and the deploy
  preflight self-test. `npm test` alone is the BACKEND only and has never been
  the gate; a change can pass it while the frontend suite or the build is red.
  Add `npm audit --omit=dev` (root and `frontend/`) before proposing a commit.
- **House rules:** read broadly, write reasonably, destroy never; lamps never
  fake green; every claim verified against a tool result.

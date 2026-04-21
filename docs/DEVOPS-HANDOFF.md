# DevOps Handoff — Second Brain

## Project Summary

Obsidian vault serving as a personal knowledge management system. No deployment infrastructure — runs locally via Obsidian desktop app.

## Environment Requirements

- Obsidian (latest)
- Claude Code CLI
- Git

## How to Run

Open the vault directory in Obsidian. Claude Code sessions operate from the vault root.

## Configuration

No external services. No API keys. No deployment targets.

## Security Notes

- `context/` and `state/` directories are gitignored (private identity data)
- No secrets stored in vault

## Deployment Maturity

Local-only. No CI/CD. No hosting.

## Known Tech Debt

None — project is in bootstrap phase.

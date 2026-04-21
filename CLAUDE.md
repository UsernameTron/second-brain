# Second Brain — Claude Code Project

## Project Overview

Obsidian vault serving as Pete Connor's second brain. Hybrid architecture inspired by Cole Medin + Eric Michaud: memory layer, proactive heartbeat, left/right vault split.

## Architecture

- **Left vault**: Identity, context, reference material (ABOUT ME/)
- **Right vault**: Active work, memory promotion, daily output
- **Memory layer**: Compounding `memory.md` updated daily
- **Heartbeat**: `/today` produces daily prep list

## Vault Rules

- This is a vault-as-project: Obsidian content IS the project
- Never surface ISPN, Genesys, or Asana content in memory promotion
- All executive deliverables use Obsidian dark-mode aesthetic
- Follow anti-AI writing style guide in all vault content

## Commands

| Command | Purpose |
|---------|---------|
| `/today` | Daily prep list |
| `/new` | Route mixed input to correct location |

## Tech Stack

- Obsidian vault (markdown)
- Claude Code for orchestration
- GSD framework for project management

## Test Coverage

N/A — knowledge project, not code project.

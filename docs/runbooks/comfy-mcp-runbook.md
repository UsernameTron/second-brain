# Comfy MCP Local Runbook

Operational runbook for running Comfy workflows via `comfy-mcp` on the M4 Pro / 48 GB machine, alongside the existing second-brain stack (LM Studio, launchd jobs, Docker MCP Gateway).

**Scope:** local ComfyUI + comfy-mcp only. Comfy Cloud is out of scope. Nothing here touches the vault, the memory pipeline, or repo `.mcp.json` — comfy-mcp registers at **user scope**, by design (repo `.mcp.json` stays context7-only).

---

## 1. System layout

| Component | Location | Notes |
|-----------|----------|-------|
| Python venv | `~/comfy-venv` | Python ≥ 3.10; holds `comfy-cli` + `comfy-mcp` |
| ComfyUI workspace | `~/comfy` (created by `comfy install`) | models under `models/checkpoints`, `models/loras`, etc. |
| ComfyUI server | `127.0.0.1:8188` | MPS backend; started manually, **not** via launchd |
| MCP server | `comfy-mcp` (stdio, spawned by Claude) | shells out to `comfy --where local` |
| Client registration | Claude Code user scope + Claude Desktop | see §3 |

**Memory budget (48 GB unified):** LM Studio qwen3.6-27b ≈ 16.3 GB resident when loaded. SDXL ≈ 8–10 GB, Flux-dev ≈ 20–24 GB, video models ≈ 25 GB+. Rule of thumb:

- SDXL-class work: fine with LM Studio loaded.
- Flux / video: **eject the LM Studio model first** (LM Studio → My Models → Eject, or `lms unload --all`). Reload after.

---

## 2. Install (one-time)

```bash
python3 -m venv ~/comfy-venv
source ~/comfy-venv/bin/activate
pip install --upgrade pip
pip install comfy-mcp "comfy-cli>=1.14.0"

comfy install          # creates the ComfyUI workspace; accept MPS/Apple Silicon defaults
```

Verify:

```bash
~/comfy-venv/bin/comfy --version        # must be >= 1.14.0
~/comfy-venv/bin/comfy-mcp --help
```

Pull at least one checkpoint before first use (example — SDXL base):

```bash
comfy model download --url https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors --relative-path models/checkpoints
```

## 3. Client registration (one-time)

**Claude Code (user scope — deliberately not project scope):**

```bash
claude mcp add comfy-mcp \
  -e COMFY_BIN=$HOME/comfy-venv/bin/comfy \
  -- $HOME/comfy-venv/bin/comfy-mcp
```

**Claude Desktop:** add to `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart Desktop:

```json
{
  "mcpServers": {
    "comfy-mcp": {
      "command": "/Users/<you>/comfy-venv/bin/comfy-mcp",
      "env": { "COMFY_BIN": "/Users/<you>/comfy-venv/bin/comfy" }
    }
  }
}
```

Do **not** add comfy-mcp to the second-brain repo `.mcp.json`.

## 4. Start / stop

comfy-mcp itself is spawned on demand by the client — you only manage ComfyUI.

**Start (before any Comfy session):**

```bash
source ~/comfy-venv/bin/activate
comfy launch -- --listen 127.0.0.1 --port 8188
```

Leave it in its own terminal tab (or `comfy launch --background`). Confirm: open http://127.0.0.1:8188 or `curl -s 127.0.0.1:8188/system_stats | head -c 200`.

**Stop:** Ctrl-C in the launch tab (or `comfy stop` if launched with `--background`). Stop ComfyUI when done — idle it still holds model weights in memory, which competes with LM Studio and the 23:45 daily-sweep window.

**Boot order for a Comfy session:**
1. Decide model class → eject LM Studio model if Flux/video (§1).
2. `comfy launch`.
3. Open Claude Code/Desktop and use the comfy-mcp tools (generate, search models/nodes/templates, run workflows).
4. When done: stop ComfyUI, reload LM Studio model if the memory pipeline needs it.

## 5. Health checks

Run when things look off, or before a heavy session:

```bash
curl -s 127.0.0.1:8188/system_stats | python3 -m json.tool   # ComfyUI up, VRAM/RAM view
~/comfy-venv/bin/comfy --where local node ls | head           # comfy-cli ↔ ComfyUI path works
claude mcp list                                               # comfy-mcp registered & healthy
memory_pressure | tail -3                                     # macOS memory headroom
```

Green = all four return cleanly. If `system_stats` fails, ComfyUI isn't running → §4.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| comfy-mcp tools missing in Claude | Registration or spawn failure | `claude mcp list`; re-add with **absolute** paths (§3); check `COMFY_BIN` points into the venv |
| Tools present, every call errors | ComfyUI not running | `comfy launch` (§4) |
| `comfy: command not found` from MCP | `COMFY_BIN` unset/wrong — comfy-mcp uses PATH otherwise | Set `COMFY_BIN` to `~/comfy-venv/bin/comfy` in the registration |
| Generation extremely slow / mac swapping | Model too big with LM Studio co-resident | Eject LM Studio model; prefer SDXL over Flux; check `memory_pressure` |
| Workflow fails on missing node | Custom node not installed | `comfy node install <name>` then restart ComfyUI |
| Workflow fails on missing checkpoint | Model not downloaded | `comfy model download …` into `models/checkpoints` |
| Port 8188 in use | Stale ComfyUI | `lsof -i :8188` → kill it, relaunch |
| Broke after upgrade | Version mismatch | Rollback (§8) |

## 7. Upgrade

```bash
source ~/comfy-venv/bin/activate
pip index versions comfy-mcp                  # note current + latest
pip install -U comfy-mcp "comfy-cli>=1.14.0"
comfy update                                  # updates ComfyUI itself
```

Then run §5 health checks and one known-good SDXL generation before trusting it. Upgrade **between** sessions, never mid-workflow.

## 8. Rollback / uninstall

Rollback a bad upgrade (pin to the previously noted version):

```bash
pip install comfy-mcp==<last-good> comfy-cli==<last-good>
```

Full uninstall:

```bash
claude mcp remove comfy-mcp
# remove the comfy-mcp block from claude_desktop_config.json
rm -rf ~/comfy-venv ~/comfy        # workspace holds models — confirm nothing to keep first
```

Nothing else in the second-brain stack references comfy-mcp, so removal is side-effect-free.

## 9. Guardrails

- **Never** schedule ComfyUI via launchd — manual start only; it must not collide with `com.secondbrain.today` (06:45) or `daily-sweep` (23:45) memory windows.
- **Never** register comfy-mcp in repo `.mcp.json` or route vault writes through it. Generated assets land in `~/comfy/output/`; anything promoted into the vault goes through `/new` like any other input.
- Flux/video runs: LM Studio model ejected first, always.

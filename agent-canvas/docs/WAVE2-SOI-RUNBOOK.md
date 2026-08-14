# Wave 2 — SOI (`org_knowledge_search`) deploy runbook

Everything needed to land the SOI connector, written because this session
could **not** land it. Status in the ledger: **BLOCKED**, not skipped.

## Why it is blocked (verified, not assumed)

- **The service is LIVE.** `GET https://soi-query-931330808000.us-central1
  .run.app/` returns `Invalid IAP credentials: Invalid bearer token. Invalid
  JWT audience.` — IAP answering proves both that `soi-query` exists and that
  it sits behind IAP, which is exactly why a second, IAP-free `soi-mcp`
  service is required rather than optional.
- **The deploy cannot run from here.** `gcloud run services list --project
  ctg-workspace-dev` and `gcloud services list --project ctg-workspace-dev`
  are both denied for **both** identities (pete@cloudtechgurus.com and
  cpeteconnor@gmail.com), while `gcloud projects get-iam-policy` on the same
  project succeeds. That is the same CLI-denied-but-console-fine pattern
  recorded as HANDOFF open item 8 for `ctg-hs-exec-tool` — an org policy or
  context-aware-access rule, not a missing role.
- **The code change lands in another GitHub account.** The SOI service lives
  in `peteconnorCTG/ctg-system-of-intelligence`, not `UsernameTron/second-brain`.
  `gh auth switch` is machine-wide and needs Pete's approval, so this session
  deliberately did not push there.

So the canvas side of this wave is a runbook, and there is no connector row:
seeding a URL that does not exist yet would be a red lamp, which the seed
file's own comment forbids.

## Step 1 — add `POST /mcp` to the SOI service

In `peteconnorCTG/ctg-system-of-intelligence`, `service/main.py`, after the
existing `/query` route. It reuses `query()` wholesale — the double gate
(distance floor + grounding judge) and the honest `"Not found in the corpus."`
refusal are the point, and re-implementing them here would fork them.

```python
# ---- MCP (Streamable HTTP) for Agent Canvas. One tool, read-only, and every
#      answer still passes the floor gate and the grounding judge below. ----
MCP_TOOLS = [{
    "name": "org_knowledge_search",
    "description": (
        "Search CTG's internal Drive corpus (strategy, governance, and operating "
        "documents) and return a grounded answer with citations. Returns "
        "'Not found in the corpus.' when the corpus does not support an answer — "
        "that is a valid, correct result, not a failure. Does NOT cover email or "
        "meetings; only the three indexed Shared Drives."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "question": {"type": "string"},
            "asked_by": {
                "type": "string",
                "description": "email of the human directing this run, for the audit line",
            },
        },
        "required": ["question"],
    },
}]


@app.post("/mcp")
async def mcp(request: Request):
    msg = await request.json()
    mid = msg.get("id")
    method = msg.get("method")
    if method == "notifications/initialized":
        return Response(status_code=202)

    def ok(result):
        return JSONResponse({"jsonrpc": "2.0", "id": mid, "result": result})

    if method == "initialize":
        return ok({
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "soi-mcp", "version": "1.0.0"},
        })
    if method == "tools/list":
        return ok({"tools": MCP_TOOLS})
    if method == "tools/call":
        params = msg.get("params") or {}
        if params.get("name") != "org_knowledge_search":
            return JSONResponse({"jsonrpc": "2.0", "id": mid,
                                 "error": {"code": -32601, "message": "unknown tool"}})
        args = params.get("arguments") or {}
        # The service identity is the same for every canvas agent, so the
        # directing user is passed as an argument and logged — without it the
        # audit line would say "the canvas" for every question anyone asks.
        _log("mcp_call", user=args.get("asked_by") or "agent-canvas",
             question=args.get("question", "")[:200])
        body = query(Q(question=str(args.get("question") or "")), request)
        return ok({"content": [{"type": "text", "text": json.dumps(body)}]})
    return JSONResponse({"jsonrpc": "2.0", "id": mid,
                         "error": {"code": -32601, "message": f"unknown method {method}"}})
```

Needs `import json` and `Response` on the FastAPI import line if not already
present. No new dependency.

## Step 2 — deploy it as a SECOND service, no IAP

Same image, different service. `soi-query` keeps IAP and its human users;
`soi-mcp` is IAM-gated with the canvas service account as sole invoker.

```bash
gcloud run deploy soi-mcp --source service/ --project ctg-workspace-dev --region us-central1 --no-allow-unauthenticated
```

```bash
gcloud run services add-iam-policy-binding soi-mcp --project ctg-workspace-dev --region us-central1 --member serviceAccount:agent-canvas-run@agent-canvas-ctg-0811.iam.gserviceaccount.com --role roles/run.invoker
```

## Step 3 — wire the connector, tools UNTICKED

Admin → Connectors → add:

| field | value |
|---|---|
| name | `soi` |
| url | `<soi-mcp URL>/mcp` |
| header | `authorization` = `${GCP_IDTOKEN}` |
| access | **owner** |
| roles | `strategic`, `commercial`, `operational` |
| enabled tools | **none — leave every box unticked** |

Then Probe. It should report **1 tool**. Stop there.

## Step 4 — the access decision is Pete's, and ticking the box IS the sign-off

A service-identity call bypasses the per-user IAP gate: every canvas agent
would see `soi-users@`-level content (exec briefs, ARR targets, funding
thesis) regardless of who is directing the run. That is why the row ships
owner-access with nothing ticked. **Never tick a tool on this connector on
someone's behalf.**

Rate-limit note before enabling: each answer is 2 Gemini calls against a
~60 req/min RAG ceiling with no service-side limiter. Keep it owner-scoped
until there is usage data.

## Step 5 — record the grant in the SOI repo

Append to `GOVERNANCE.md` in `peteconnorCTG/ctg-system-of-intelligence`, in
the same PR as the route:

```markdown
### 2026-08-14 — Agent Canvas service-identity grant (soi-mcp)

`agent-canvas-run@agent-canvas-ctg-0811.iam.gserviceaccount.com` holds
`roles/run.invoker` on the `soi-mcp` Cloud Run service in `ctg-workspace-dev`.

- **What it bypasses:** the per-user IAP gate on `soi-query`. Calls arrive as
  the canvas service account, so corpus content is not filtered by the human's
  own Drive access.
- **Compensating controls:** the connector is owner-access with every tool
  unticked (inert by default); the canvas re-checks access at call time and
  audits every call; the directing user's email is passed as `asked_by` and
  written to this service's log line.
- **Scope:** read-only. `soi-mcp` exposes exactly one tool,
  `org_knowledge_search`, which calls the same double-gated `/query` path as
  the human surface. No write path exists.
- **Not covered:** email and meetings are not indexed (M03 mail ingest never
  shipped and is governance-gated).
```

## Verification bar for this wave

1. `gcloud run services describe soi-mcp` shows the revision serving.
2. Connector probe in Admin → Connectors returns **1 tool** plus a latency.
3. One owner-directed agent run asks a question the corpus answers, and one
   asks a question it does not — the second must return
   `"Not found in the corpus."` and the agent must treat it as an answer.
4. The `asked_by` email appears in the SOI service log for both.
5. Ledger row flips `BLOCKED` → `DONE` only after all four.

#!/usr/bin/env bash
# Deploy hubspot-mcp-bridge (Phase 3, /crm). Ops-runner pattern: IAM-gated,
# read-only private-app token from Secret Manager, canvas SA is sole invoker.
#
# One-time before first deploy — store the EXISTING "CTG Ops Automation"
# read-only service key (Pete holds it; do NOT mint a new one). Prompted so
# the token never enters shell history:
#   read -rs -p "token: " T && printf '%s' "$T" | gcloud secrets create \
#     hubspot-mcp-token --project agent-canvas-ctg-0811 \
#     --replication-policy=automatic --data-file=- && unset T
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-agent-canvas-ctg-0811}"
REGION="${REGION:-us-central1}"
SERVICE=hubspot-mcp-bridge
CANVAS_SA="agent-canvas-run@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUM="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
# the bridge runs as the default compute SA (no --service-account below), so
# that is the identity that must be able to READ the secret at boot
RUNTIME_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

# paste-guard (the 2026-08-13 lesson): token must exist and be pat-shaped
TOKEN="$(gcloud secrets versions access latest --secret hubspot-mcp-token --project "$PROJECT_ID")"
case "$TOKEN" in
  pat-*) ;;
  *) echo "FATAL: hubspot-mcp-token latest is not shaped like a private-app token (pat-*)"; exit 1 ;;
esac

gcloud secrets add-iam-policy-binding hubspot-mcp-token \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor >/dev/null

gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --source "$(cd "$(dirname "$0")" && pwd)" \
  --no-allow-unauthenticated \
  --min-instances 0 --max-instances 1 --memory 512Mi \
  --set-secrets "HUBSPOT_MCP_TOKEN=hubspot-mcp-token:latest"

gcloud run services add-iam-policy-binding "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --member "serviceAccount:${CANVAS_SA}" --role roles/run.invoker

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"
echo "Bridge URL: ${URL}/crm"
echo "Next: Admin → Connectors → add server 'hubspot-crm' at ${URL}/crm with"
echo "header authorization = \${GCP_IDTOKEN}, access=owner, then Probe and tick tools."

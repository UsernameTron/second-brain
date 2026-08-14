#!/usr/bin/env bash
# Deploy gtm-mcp-bridge. IAM-gated Cloud Run, canvas SA is sole invoker.
# Runs as a DEDICATED runtime SA (explicit --service-account — the
# hubspot-mcp-bridge's default-compute-SA shape is open finding F-03; do not
# repeat it). The runtime SA needs:
#   1. roles/bigquery.jobUser on ${PROJECT_ID} (granted below — query jobs
#      run and bill here, per the PORTFOLIO-FOLD-IN spec)
#   2. dataset-scoped READER on ctg-hs-exec-tool:ctg_gtm_marts — NEVER a
#      project-level grant (the project-level version reads ctg_gtm_raw,
#      which holds 44k people's emails and phones). Granted by a dataset
#      Data Owner (pete@) outside this script:
#        bq show --format=prettyjson ctg-hs-exec-tool:ctg_gtm_marts > /tmp/ds.json
#        # append {"role":"READER","userByEmail":"<RUNTIME_SA>"} to .access
#        bq update --source /tmp/ds.json ctg-hs-exec-tool:ctg_gtm_marts
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-agent-canvas-ctg-0811}"
REGION="${REGION:-us-central1}"
SERVICE=gtm-mcp-bridge
CANVAS_SA="agent-canvas-run@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="gtm-bridge-run@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts describe "$RUNTIME_SA" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam service-accounts create gtm-bridge-run --project "$PROJECT_ID" \
       --display-name "gtm-mcp-bridge runtime (BigQuery named-query reader)"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${RUNTIME_SA}" --role roles/bigquery.jobUser \
  --condition=None >/dev/null

gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --source "$(cd "$(dirname "$0")" && pwd)" \
  --service-account "$RUNTIME_SA" \
  --no-allow-unauthenticated \
  --min-instances 0 --max-instances 1 --memory 256Mi

gcloud run services add-iam-policy-binding "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --member "serviceAccount:${CANVAS_SA}" --role roles/run.invoker

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"
echo "Bridge URL: ${URL}/gtm"
echo "The seed row (server/mcp/seed.js gtm-marts) must match this URL exactly."
echo "Remember the dataset READER grant for ${RUNTIME_SA} (header of this script)."

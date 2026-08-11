#!/usr/bin/env bash
# One-command deploy of the Agent Canvas Workspace to Google Cloud Run, inside
# a NEW dedicated project in the cloudtechgurus.com organization.
#
# Prerequisites (run once, interactively, as a cloudtechgurus.com admin):
#   gcloud auth login                      # keyless user credentials — never a service-account key
#   gcloud auth application-default login  # ADC for local tools if needed
#   gcloud billing accounts list           # note the open billing account ID
#
# Required environment:
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX   # from `gcloud billing accounts list`
#   ANTHROPIC_API_KEY=sk-ant-...           # Console API key for agent runs (stored in Secret Manager)
# Optional:
#   GOOGLE_CLIENT_ID=....apps.googleusercontent.com   # OAuth web client (see step 2 of docs/DEPLOY.md);
#                                                      # can be added later with a `gcloud run services update`
#   PROJECT_ID (default agent-canvas-ctg), REGION (default us-central1), OWNER_EMAIL
#
# Everything here is idempotent: re-running updates in place.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-agent-canvas-ctg}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-agent-canvas}"
OWNER_EMAIL="${OWNER_EMAIL:-pete@cloudtechgurus.com}"
BUCKET="gs://${PROJECT_ID}-db"
REPO="app"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:latest"
SA_NAME="agent-canvas-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

: "${BILLING_ACCOUNT:?Set BILLING_ACCOUNT (see: gcloud billing accounts list)}"
: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY (create one at console.anthropic.com)}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Deploying ${APP_DIR} to project ${PROJECT_ID} (${REGION})"

# 1. Dedicated project inside the cloudtechgurus.com organization.
ORG_ID="$(gcloud organizations list --format='value(ID)' --filter='displayName=cloudtechgurus.com' | head -1)"
if [ -z "${ORG_ID}" ]; then
  echo "!! Could not find the cloudtechgurus.com organization for this gcloud account." >&2
  echo "   gcloud organizations list  — and pass ORG_ID explicitly if needed." >&2
  exit 1
fi
if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud projects create "${PROJECT_ID}" --organization="${ORG_ID}" --name="Agent Canvas Workspace"
fi
gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}"

# 2. APIs.
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com --project "${PROJECT_ID}"

# 3. Artifact Registry + database bucket.
gcloud artifacts repositories describe "${REPO}" --location="${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${REPO}" --repository-format=docker --location="${REGION}" --project "${PROJECT_ID}"
gcloud storage buckets describe "${BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud storage buckets create "${BUCKET}" --project "${PROJECT_ID}" --location="${REGION}" --uniform-bucket-level-access

# 4. Secrets (Anthropic key + JWT signing secret).
create_or_update_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "${name}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    printf '%s' "${value}" | gcloud secrets versions add "${name}" --project "${PROJECT_ID}" --data-file=-
  else
    printf '%s' "${value}" | gcloud secrets create "${name}" --project "${PROJECT_ID}" --data-file=-
  fi
}
create_or_update_secret anthropic-api-key "${ANTHROPIC_API_KEY}"
gcloud secrets describe jwt-secret --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  create_or_update_secret jwt-secret "$(head -c 32 /dev/urandom | xxd -p -c 64)"

# 5. Runtime service account (least privilege: bucket objects + the two secrets).
gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${SA_NAME}" --project "${PROJECT_ID}" --display-name="Agent Canvas Cloud Run"
gcloud storage buckets add-iam-policy-binding "${BUCKET}" --member="serviceAccount:${SA_EMAIL}" --role=roles/storage.objectAdmin >/dev/null
for secret in anthropic-api-key jwt-secret; do
  gcloud secrets add-iam-policy-binding "${secret}" --project "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/secretmanager.secretAccessor >/dev/null
done

# 6. Build the image with Cloud Build (no local docker needed).
gcloud builds submit "${APP_DIR}" --tag "${IMAGE}" --project "${PROJECT_ID}"

# 7. Deploy. max-instances=1 because SQLite is single-writer (Litestream replicates
#    to the bucket; a cold start restores it). The app enforces sign-in itself, so
#    the service is publicly reachable but every API call requires an allowlisted
#    cloudtechgurus.com Google account.
ENV_VARS="NODE_ENV=production,OWNER_EMAIL=${OWNER_EMAIL},LITESTREAM_REPLICA_URL=gcs://${PROJECT_ID}-db/agent-canvas"
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then ENV_VARS="${ENV_VARS},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"; fi
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 1 \
  --memory 1Gi --cpu 1 \
  --set-env-vars "${ENV_VARS}" \
  --set-secrets "ANTHROPIC_API_KEY=anthropic-api-key:latest,JWT_SECRET=jwt-secret:latest"

URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
echo
echo "==> Deployed: ${URL}"
echo
if [ -z "${GOOGLE_CLIENT_ID:-}" ]; then
  echo "NEXT (required for sign-in): create the OAuth client for ${URL} — see docs/DEPLOY.md step 2, then:"
  echo "  gcloud run services update ${SERVICE} --project ${PROJECT_ID} --region ${REGION} --update-env-vars GOOGLE_CLIENT_ID=<client-id>"
else
  echo "Confirm ${URL} is listed as an authorized JavaScript origin on the OAuth client."
fi

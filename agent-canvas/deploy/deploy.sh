#!/usr/bin/env bash
# One-command deploy of the Agent Canvas Workspace to Google Cloud Run, inside
# the dedicated Agent Canvas project in the cloudtechgurus.com organization.
#
# Prerequisites (run once, interactively, as a cloudtechgurus.com admin):
#   gcloud auth login                      # keyless user credentials — never a service-account key
#   gcloud auth application-default login  # ADC for local tools if needed
#   gcloud billing accounts list           # note the open billing account ID
#
# Required environment:
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX   # from `gcloud billing accounts list`
# Model provider (default: vertex — Claude on Vertex AI, inside the Google
# perimeter, keyless via the runtime service account; no model API key exists):
#   MODEL_PROVIDER=vertex|gemini|anthropic   (vertex = Claude on Vertex; gemini = Gemini on Vertex)
#   FAST_PROVIDER / STRONG_PROVIDER          # optional per-tier override for mixed fleets
#   ANTHROPIC_API_KEY=sk-ant-...           # required ONLY when MODEL_PROVIDER=anthropic
# Optional:
#   GOOGLE_CLIENT_ID=....apps.googleusercontent.com   # OAuth web client (see step 2 of docs/DEPLOY.md);
#                                                      # can be added later with a `gcloud run services update`
#   PROJECT_ID (default agent-canvas-ctg-0811), REGION (default us-central1), OWNER_EMAIL
#   DEPLOY_PROVIDER_CHANGE=1  # required to MOVE a live service to a different
#                             # MODEL_PROVIDER; without it a provider change aborts
#   DEPLOY_DRY_RUN=1          # run every check and print the configuration diff,
#                             # then stop before `gcloud run deploy`
#
# Everything here is idempotent: re-running updates in place.
#
# Preservation-first, as of the 2026-08-16 truth-up. Environment variables and
# secret bindings are applied ADDITIVELY (--update-env-vars / --update-secrets),
# and MODEL_PROVIDER is inherited from the running revision unless explicitly
# overridden. A redeploy can no longer drop a variable or move the model
# provider as a side effect of an unset shell variable. Removing a variable is
# now a deliberate, separate act:
#   gcloud run services update SERVICE --region REGION --remove-env-vars NAME
set -euo pipefail

# Names of the NAME=VALUE pairs in a comma-joined gcloud flag argument, one per
# line, sorted. Used only to compare the computed configuration against the live
# one; values are discarded here and never printed anywhere. Split out as a
# function so `deploy.sh --selftest` can prove it against fixtures without
# touching a cloud project.
flag_names() {
  printf '%s' "$1" | tr ',' '\n' | sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | sort -u
}

if [ "${1:-}" = "--selftest" ]; then
  fail=0
  check() { # check <label> <expected> <actual>
    if [ "$2" = "$3" ]; then echo "ok   — $1"; else
      echo "FAIL — $1"; echo "  expected: [$2]"; echo "  actual:   [$3]"; fail=1
    fi
  }
  check "plain env pairs" "$(printf 'B\nNODE_ENV')" \
    "$(flag_names 'NODE_ENV=production,B=2')"
  check "values containing = and : survive without leaking into names" "$(printf 'LITESTREAM_REPLICA_URL\nMCP_SERVERS')" \
    "$(flag_names 'LITESTREAM_REPLICA_URL=gcs://p-db/agent-canvas,MCP_SERVERS=[{"a":"b=c"}]')"
  check "secret flag form" "$(printf 'ANTHROPIC_API_KEY\nJWT_SECRET')" \
    "$(flag_names "$(printf '%s' '--update-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest,JWT_SECRET=jwt-secret:latest' | sed 's/--update-secrets //')")"
  # The whole point of the preflight: a name that is live but not recomputed is
  # reported, and one that is present in either computed list is not.
  live="$(printf 'ED_DISPATCH_URL\nJWT_SECRET\nNODE_ENV\nTICK_AUDIENCE')"
  computed="$(printf '%s\n' "$(flag_names 'NODE_ENV=production')" "$(flag_names 'JWT_SECRET=jwt-secret:latest')" | sort -u)"
  check "live-only names are the ones surfaced" "$(printf 'ED_DISPATCH_URL\nTICK_AUDIENCE')" \
    "$(comm -23 <(printf '%s\n' "${live}") <(printf '%s\n' "${computed}"))"
  check "no live-only names when everything is recomputed" "" \
    "$(comm -23 <(printf '%s\n' "${live}") <(printf '%s\n' "${live}"))"
  [ "${fail}" = "0" ] && echo "deploy.sh preflight self-test: PASS" || echo "deploy.sh preflight self-test: FAIL" >&2
  exit "${fail}"
fi

PROJECT_ID="${PROJECT_ID:-agent-canvas-ctg-0811}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-agent-canvas}"
OWNER_EMAIL="${OWNER_EMAIL:-pete@cloudtechgurus.com}"
BUCKET="gs://${PROJECT_ID}-db"
REPO="app"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:latest"
SA_NAME="agent-canvas-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Which model serves every agent conversation is the single most consequential
# setting on the service, and it used to be decided by a bare `:-vertex`
# default. A redeploy that forgot to export MODEL_PROVIDER therefore MOVED the
# whole fleet to another provider silently — no prompt, no diff, nothing in the
# output to read. The value is now resolved against the LIVE service further
# down (step 2b) and only an explicit request may change it. Record here whether
# the caller actually asked for a provider, because "unset" and "the same value
# the default happens to be" are different intentions.
MODEL_PROVIDER_EXPLICIT=0
if [ -n "${MODEL_PROVIDER+x}" ]; then MODEL_PROVIDER_EXPLICIT=1; fi
MODEL_PROVIDER="${MODEL_PROVIDER:-vertex}"
case "${MODEL_PROVIDER}" in vertex|gemini|anthropic) ;; *) echo "MODEL_PROVIDER must be vertex|gemini|anthropic" >&2; exit 1;; esac
VERTEX_REGION="${VERTEX_REGION:-global}"
# An EXPLICIT anthropic request must carry the key. An INHERITED one must not
# demand it: the running service already has the secret bound, and additive
# --update-secrets keeps that binding, so a plain redeploy of an anthropic
# service needs no credential in the operator's shell at all.
if [ "${MODEL_PROVIDER}" = "anthropic" ] && [ "${MODEL_PROVIDER_EXPLICIT}" = "1" ]; then
  : "${ANTHROPIC_API_KEY:?MODEL_PROVIDER=anthropic requires ANTHROPIC_API_KEY (console.anthropic.com)}"
fi

# Paste guards. Twice now a mangled paste has been stored as a REAL secret
# version and served to the live revision (U+2022 bullets from a masking
# terminal; a literal '<current key - ...>' runbook placeholder). Refuse
# anything not shaped like the actual credential BEFORE it can reach Secret
# Manager — a wrong secret version is far more expensive than a failed deploy.
if [ "${MODEL_PROVIDER}" = "anthropic" ]; then
  case "${ANTHROPIC_API_KEY}" in
    sk-ant-*) ;;
    *) echo "ANTHROPIC_API_KEY does not start with sk-ant- — that is a placeholder or a mangled paste, not the key. Nothing was deployed or stored." >&2; exit 1;;
  esac
fi
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  case "${GOOGLE_CLIENT_SECRET}" in
    GOCSPX-*) ;;
    *) echo "GOOGLE_CLIENT_SECRET does not start with GOCSPX- — that is a placeholder or a mangled paste, not the client secret. Nothing was deployed or stored." >&2; exit 1;;
  esac
fi

# gcloud must never stop to ask a question mid-deploy, and it must never bill
# API quota to a stale project the caller cannot access. A leftover quota
# project in the caller's config or ADC is what produces the
# "API [cloudbilling.googleapis.com] not enabled on project <numeric id>.
# Would you like to enable and retry?" prompt that hangs an unattended run on a
# project the caller has no rights to. Pin quota to the project we are building.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export CLOUDSDK_BILLING_QUOTA_PROJECT="${PROJECT_ID}"

ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || echo unknown)"
echo "==> Authenticated as ${ACTIVE_ACCOUNT}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Deploying ${APP_DIR} to project ${PROJECT_ID} (${REGION})"

# 1. Dedicated project inside the cloudtechgurus.com organization.
# An organization is preferred (the project lands under cloudtechgurus.com
# governance) but is not required: a Workspace domain only has a Cloud
# organization once someone sets Cloud up for it. Without one, create a
# standalone project so the deploy still works.
ORG_ID="${ORG_ID:-$(gcloud organizations list --format='value(ID)' --filter='displayName=cloudtechgurus.com' 2>/dev/null | head -1)}"
if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  if [ -n "${ORG_ID}" ]; then
    gcloud projects create "${PROJECT_ID}" --organization="${ORG_ID}" --name="Agent Canvas Workspace"
  else
    echo "!! No cloudtechgurus.com Cloud organization visible to this account."
    echo "   Creating a standalone project instead. To place it under the org later,"
    echo "   an Organization Administrator can move it (gcloud beta projects move)."
    gcloud projects create "${PROJECT_ID}" --name="Agent Canvas Workspace"
  fi
fi
# Bootstrap APIs, before anything that depends on them. Cloud Resource Manager
# backs every `gcloud projects add-iam-policy-binding` call -- step 5 uses one to
# grant the runtime service account Vertex AI access -- and Service Usage backs
# every `services enable`. Neither is reliably on in a brand-new project, and a
# missing Resource Manager API does not fail here: it fails much later, as an
# opaque SERVICE_DISABLED on the IAM binding, after the image has already built.
for api in cloudresourcemanager.googleapis.com serviceusage.googleapis.com cloudbilling.googleapis.com; do
  gcloud services enable "${api}" --project "${PROJECT_ID}" >/dev/null 2>&1 || true
done

# Billing. Already-linked is the common case on a re-run, and it needs no
# BILLING_ACCOUNT at all, so check before asking for one.
CURRENT_BILLING="$(gcloud beta billing projects describe "${PROJECT_ID}" \
  --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||' || true)"
if [ -n "${CURRENT_BILLING}" ]; then
  echo "==> Billing already linked (${CURRENT_BILLING})."
else
  # Resolve the account: explicit wins; otherwise auto-select only when the
  # choice is unambiguous. Guessing which account to spend from is not ours.
  if [ -z "${BILLING_ACCOUNT:-}" ]; then
    OPEN_ACCOUNTS="$(gcloud billing accounts list --filter='open=true' \
      --format='value(name)' 2>/dev/null | sed 's|billingAccounts/||' | grep '[^[:space:]]' || true)"
    OPEN_COUNT="$(printf '%s\n' "${OPEN_ACCOUNTS}" | grep -c '[^[:space:]]' || true)"
    if [ "${OPEN_COUNT}" = "1" ]; then
      BILLING_ACCOUNT="$(printf '%s' "${OPEN_ACCOUNTS}" | tr -d '[:space:]')"
      echo "==> Using the only open billing account visible to ${ACTIVE_ACCOUNT}: ${BILLING_ACCOUNT}"
    else
      echo "!! Set BILLING_ACCOUNT -- ${ACTIVE_ACCOUNT} can see ${OPEN_COUNT} open billing accounts:" >&2
      printf '%s\n' "${OPEN_ACCOUNTS}" >&2
      exit 1
    fi
  fi
  if ! gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" >/dev/null 2>&1; then
    echo "!! Could not link billing from the CLI." >&2
    echo "   Linking needs two permissions held by two different resources:" >&2
    echo "     - on the project ${PROJECT_ID}: resourcemanager.projects.createBillingAssignment" >&2
    echo "     - on the billing account ${BILLING_ACCOUNT}: billing.resourceAssociations.create" >&2
    echo "   If one identity does not hold both, link it in the browser (2 clicks) and re-run:" >&2
    echo "   https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}" >&2
    exit 1
  fi
  echo "==> Billing linked."
fi

# 2. APIs.
# Infra APIs plus the Workspace DATA APIs the agents' tools call — scopes and
# Model Garden are separate switches; without these the first live probe fails
# with "Gmail API has not been used in project … or it is disabled".
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com aiplatform.googleapis.com \
  cloudresourcemanager.googleapis.com cloudscheduler.googleapis.com \
  gmail.googleapis.com drive.googleapis.com sheets.googleapis.com calendar-json.googleapis.com \
  --project "${PROJECT_ID}"

# 2b. Read the LIVE service before deciding anything that could overwrite it.
# Everything below this point used to be computed from the operator's shell
# alone, which is how a redeploy could change the model provider or drop an
# environment variable without anyone typing the change. Read the running
# revision first; treat it as the baseline; require an explicit flag to depart
# from it. NAMES ONLY are ever read or printed here — never a value, never a
# secret version. An absent service is a first deploy, and there is no baseline
# to protect.
# A secret-backed variable is an entry in this same env list (its value simply
# comes from a secretKeyRef), so ONE list of names covers both plain vars and
# secret bindings: whichever kind goes missing, the name goes missing with it.
LIVE_EXISTS=0
LIVE_ENV_NAMES=""
LIVE_PROVIDER=""
DESCRIBE_ERR="$(mktemp)"
if LIVE_ENV_NAMES="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
     --format='value[delimiter="\n"](spec.template.spec.containers[0].env.name)' 2>"${DESCRIBE_ERR}")"; then
  LIVE_EXISTS=1
  LIVE_ENV_NAMES="$(printf '%s\n' "${LIVE_ENV_NAMES}" | sed '/^$/d' | sort -u)"
  LIVE_PROVIDER="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
    --format='value(spec.template.spec.containers[0].env.filter("name:MODEL_PROVIDER").extract("value").flatten())' \
    2>/dev/null | tr -d "[]'\" " || true)"
elif grep -qiE 'not found|does not exist|NOT_FOUND' "${DESCRIBE_ERR}"; then
  echo "==> No existing ${SERVICE} service — treating this as a first deploy."
else
  # Anything that is NOT "the service is absent" means we could not establish
  # the baseline: expired credentials, a wrong project, a revoked role. Refusing
  # is the whole point — proceeding would deploy a computed configuration over a
  # live one we were unable to read.
  echo "ERROR: could not read the live ${SERVICE} service, and the failure is not 'service absent'." >&2
  sed 's/^/    /' "${DESCRIBE_ERR}" >&2
  echo "    Refusing to deploy over a configuration this script could not read." >&2
  echo "    Fix the access (often: gcloud auth login) and re-run." >&2
  rm -f "${DESCRIBE_ERR}"; exit 1
fi
rm -f "${DESCRIBE_ERR}"

# Provider: inherit the live value unless the caller explicitly asked otherwise.
if [ "${LIVE_EXISTS}" = "1" ] && [ -n "${LIVE_PROVIDER}" ]; then
  if [ "${MODEL_PROVIDER_EXPLICIT}" = "0" ]; then
    if [ "${LIVE_PROVIDER}" != "${MODEL_PROVIDER}" ]; then
      echo "==> MODEL_PROVIDER not set; inheriting the live value '${LIVE_PROVIDER}' (script default is '${MODEL_PROVIDER}')."
    fi
    MODEL_PROVIDER="${LIVE_PROVIDER}"
    case "${MODEL_PROVIDER}" in vertex|gemini|anthropic) ;; *) echo "live MODEL_PROVIDER '${MODEL_PROVIDER}' is not one of vertex|gemini|anthropic — set MODEL_PROVIDER explicitly" >&2; exit 1;; esac
  elif [ "${LIVE_PROVIDER}" != "${MODEL_PROVIDER}" ] && [ "${DEPLOY_PROVIDER_CHANGE:-0}" != "1" ]; then
    echo "ERROR: this deploy would move the model provider from '${LIVE_PROVIDER}' to '${MODEL_PROVIDER}'." >&2
    echo "    That re-points every agent conversation at a different model and billing surface." >&2
    echo "    Re-run with DEPLOY_PROVIDER_CHANGE=1 if the change is intended." >&2
    exit 1
  fi
fi
echo "==> Model provider: ${MODEL_PROVIDER} (live: ${LIVE_PROVIDER:-none})"

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
# Only write a key that was actually supplied. An inherited anthropic provider
# redeploys against the secret version already in Secret Manager; adding a
# version from an empty shell variable would serve an empty credential.
if [ "${MODEL_PROVIDER}" = "anthropic" ] && [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  create_or_update_secret anthropic-api-key "${ANTHROPIC_API_KEY}"
fi
gcloud secrets describe jwt-secret --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  create_or_update_secret jwt-secret "$(head -c 32 /dev/urandom | xxd -p -c 64)"
# Workspace OAuth client secret (enables the agents' Google Workspace tools;
# optional — without it the app runs with canvas-only capabilities).
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  create_or_update_secret google-oauth-secret "${GOOGLE_CLIENT_SECRET}"
fi

# MCP connector credentials (optional): RapidAPI key for the LinkedIn
# connectors. Referenced from mcp_servers rows as ${ENV:RAPIDAPI_KEY} —
# resolved per request by the MCP client, never stored in the DB.
if [ -n "${RAPIDAPI_KEY:-}" ]; then
  create_or_update_secret rapidapi-key "${RAPIDAPI_KEY}"
fi

# 5. Runtime service account (least privilege: bucket objects + the two secrets).
gcloud iam service-accounts describe "${SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${SA_NAME}" --project "${PROJECT_ID}" --display-name="Agent Canvas Cloud Run"
gcloud storage buckets add-iam-policy-binding "${BUCKET}" --member="serviceAccount:${SA_EMAIL}" --role=roles/storage.objectAdmin >/dev/null
SECRETS_TO_GRANT="jwt-secret"
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then SECRETS_TO_GRANT="${SECRETS_TO_GRANT} google-oauth-secret"; fi
if [ -n "${RAPIDAPI_KEY:-}" ]; then SECRETS_TO_GRANT="${SECRETS_TO_GRANT} rapidapi-key"; fi
if [ "${MODEL_PROVIDER}" = "anthropic" ]; then SECRETS_TO_GRANT="anthropic-api-key jwt-secret"; fi
for secret in ${SECRETS_TO_GRANT}; do
  gcloud secrets add-iam-policy-binding "${secret}" --project "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/secretmanager.secretAccessor >/dev/null
done
# Vertex modes (claude-on-vertex or gemini): the runtime service account calls
# Vertex AI directly — keyless, no model API key anywhere in the system.
if [ "${MODEL_PROVIDER}" != "anthropic" ]; then
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/aiplatform.user >/dev/null
fi

# 6. Build the image with Cloud Build (no local docker needed).
# Projects created recently do not get the legacy Cloud Build service account
# (PROJECT_NUMBER@cloudbuild.gserviceaccount.com), and they only have a Compute
# Engine default service account if the Compute API happens to be on. When
# neither exists, `builds submit` fails with a bare "PERMISSION_DENIED: The
# caller does not have permission" that names no principal and misleadingly
# implicates the human caller, who is usually a project Owner. Rather than
# depend on whichever default a given project happens to have, build as a
# service account we create and grant explicitly.
BUILD_SA_NAME="agent-canvas-build"
BUILD_SA_EMAIL="${BUILD_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "${BUILD_SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${BUILD_SA_NAME}" --project "${PROJECT_ID}" --display-name="Agent Canvas Cloud Build"
# builds.builder bundles what a build needs: write logs, pull/push Artifact
# Registry, read the source bucket.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" --role=roles/cloudbuild.builds.builder >/dev/null

submit_build() {
  # --config, not --tag: the build must run under cloudbuild.yaml so BuildKit is
  # on (the Dockerfile's optional build_ca secret mount is BuildKit-only syntax).
  # A user-specified build service account also requires an explicit bucket
  # policy; without it Cloud Build refuses to write logs to a Google-owned bucket.
  gcloud builds submit "${APP_DIR}" --project "${PROJECT_ID}" \
    --config "${APP_DIR}/cloudbuild.yaml" --substitutions=_IMAGE="${IMAGE}" \
    --service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA_EMAIL}" \
    --default-buckets-behavior=regional-user-owned-bucket
}

# Enabling cloudbuild.googleapis.com provisions a service agent asynchronously,
# so the first submit after a fresh enable can lose a race it will win a minute
# later. Retry before concluding anything is actually wrong.
BUILD_OK=0
for attempt in 1 2 3; do
  if submit_build; then BUILD_OK=1; break; fi
  if [ "${attempt}" -lt 3 ]; then
    echo "==> Build attempt ${attempt} failed; waiting 45s for API/service-agent propagation and retrying." >&2
    sleep 45
  fi
done
if [ "${BUILD_OK}" -ne 1 ]; then
  # Older gcloud releases do not know --service-account/--default-buckets-behavior
  # on `builds submit`. Fall back to project defaults before giving up, so an
  # out-of-date CLI is not mistaken for a permissions problem.
  echo "==> Retrying the build with project default service accounts." >&2
  gcloud builds submit "${APP_DIR}" --project "${PROJECT_ID}" \
    --config "${APP_DIR}/cloudbuild.yaml" --substitutions=_IMAGE="${IMAGE}"
fi

# 7. Deploy. max-instances=1 because SQLite is single-writer (Litestream replicates
#    to the bucket; a cold start restores it). The app enforces sign-in itself, so
#    the service is publicly reachable but every API call requires an allowlisted
#    cloudtechgurus.com Google account.
ENV_VARS="NODE_ENV=production,OWNER_EMAIL=${OWNER_EMAIL},LITESTREAM_REPLICA_URL=gcs://${PROJECT_ID}-db/agent-canvas,MODEL_PROVIDER=${MODEL_PROVIDER}"
if [ "${MODEL_PROVIDER}" != "anthropic" ]; then
  ENV_VARS="${ENV_VARS},VERTEX_PROJECT_ID=${PROJECT_ID},VERTEX_REGION=${VERTEX_REGION}"
  if [ -n "${FAST_PROVIDER:-}" ]; then ENV_VARS="${ENV_VARS},FAST_PROVIDER=${FAST_PROVIDER}"; fi
  if [ -n "${STRONG_PROVIDER:-}" ]; then ENV_VARS="${ENV_VARS},STRONG_PROVIDER=${STRONG_PROVIDER}"; fi
  SECRET_FLAGS="--update-secrets JWT_SECRET=jwt-secret:latest"
else
  SECRET_FLAGS="--update-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest,JWT_SECRET=jwt-secret:latest"
fi
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  SECRET_FLAGS="${SECRET_FLAGS},GOOGLE_CLIENT_SECRET=google-oauth-secret:latest"
fi
if [ -n "${RAPIDAPI_KEY:-}" ]; then
  SECRET_FLAGS="${SECRET_FLAGS},RAPIDAPI_KEY=rapidapi-key:latest"
fi
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then ENV_VARS="${ENV_VARS},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"; fi
# HubSpot Ops Runner (optional): agents become IAM-authenticated clients of the
# policy-gated sandbox runner. No HubSpot credential enters this service.
if [ -n "${HS_OPS_RUNNER_URL:-}" ]; then ENV_VARS="${ENV_VARS},HS_OPS_RUNNER_URL=${HS_OPS_RUNNER_URL}"; fi
# Enrichment dispatch (optional, lit by Pete 2026-08-14 after F-01 sign-off):
# same IAM-client pattern as the ops runner. Passing it through re-asserts the
# value from this shell; leaving it unset now PRESERVES whatever the service
# already has, because the update is additive.
if [ -n "${ED_DISPATCH_URL:-}" ]; then ENV_VARS="${ENV_VARS},ED_DISPATCH_URL=${ED_DISPATCH_URL}"; fi
# P5 standing-rule scheduler tick (optional): the OIDC lane verifies the caller
# against TICK_AUDIENCE and requires it to BE TICK_INVOKER_SA. Either var
# missing → the lane 503s and NOTHING scheduled ever runs, while the rules UI
# still activates rules. The systems board shows STANDING RULES · TICK dark
# whenever they are absent. Additive update means an unset var here no longer
# darkens a lane that was already lit.
if [ -n "${TICK_AUDIENCE:-}" ]; then ENV_VARS="${ENV_VARS},TICK_AUDIENCE=${TICK_AUDIENCE}"; fi
if [ -n "${TICK_INVOKER_SA:-}" ]; then ENV_VARS="${ENV_VARS},TICK_INVOKER_SA=${TICK_INVOKER_SA}"; fi

# Last gate before the only irreversible step in this script. --update-env-vars
# cannot drop a name on its own, so a name that is live but absent from the
# computed set is simply preserved — which is the desired behaviour and worth
# SAYING, because the previous wholesale --set-env-vars silently deleted exactly
# those. Anything the operator genuinely wants gone goes through an explicit
# `gcloud run services update --remove-env-vars NAME`. Names only: no value from
# either side is read, compared, or printed here.
if [ "${LIVE_EXISTS}" = "1" ]; then
  NEW_ENV_NAMES="$(flag_names "${ENV_VARS}")"
  NEW_SECRET_NAMES="$(flag_names "$(printf '%s' "${SECRET_FLAGS}" | sed 's/--update-secrets //')")"
  PRESERVED="$(comm -23 <(printf '%s\n' "${LIVE_ENV_NAMES}") <(printf '%s\n' "${NEW_ENV_NAMES}" "${NEW_SECRET_NAMES}" | sort -u) || true)"
  if [ -n "${PRESERVED}" ]; then
    echo "==> Live-only variables this deploy does NOT re-assert (preserved, not dropped):"
    printf '%s\n' "${PRESERVED}" | sed 's/^/      /'
    echo "    To remove any of them, do it explicitly:"
    echo "      gcloud run services update ${SERVICE} --project ${PROJECT_ID} --region ${REGION} --remove-env-vars NAME"
  fi
  if [ "${DEPLOY_DRY_RUN:-0}" = "1" ]; then
    echo "==> DEPLOY_DRY_RUN=1 — configuration preflight only, nothing deployed."
    exit 0
  fi
fi

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 1 \
  --memory 1Gi --cpu 1 \
  --update-env-vars "${ENV_VARS}" \
  ${SECRET_FLAGS}

URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
# Cloud Run issues TWO hostnames for one service: the deterministic
# service-projectnumber.region.run.app form and a legacy service-hash-code.a.run.app
# form. `status.url` reports only one, and which one differs by service age. OAuth
# origins must match the browsed host character for character, so a deploy that
# advertises one hostname while the console hands the user the other produces a
# silent origin mismatch at sign-in. Compute both; register both.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null || echo '')"
URL_ALT=""
if [ -n "${PROJECT_NUMBER}" ]; then
  CANDIDATE="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
  if [ "${CANDIDATE}" != "${URL}" ]; then URL_ALT="${CANDIDATE}"; fi
fi
ACCOUNT_Q="$(printf '%s' "${ACTIVE_ACCOUNT}" | sed 's/@/%40/')"

echo
echo "============================================================"
echo "  DEPLOYED: ${URL}"
if [ -n "${URL_ALT}" ]; then echo "       ALSO: ${URL_ALT}"; echo "             (same service, second hostname — both work)"; fi
echo "  model provider: ${MODEL_PROVIDER}"
echo "============================================================"
echo

# Everything below needs a browser, so print it as an ordered checklist with
# the URLs already filled in. Hunting for the right console page across five
# tabs is where a deploy actually loses its afternoon.
STEP=1
if [ "${MODEL_PROVIDER}" = "vertex" ]; then
  echo "STEP ${STEP} — enable the Claude models (one-time, ~2 min)"
  echo "  https://console.cloud.google.com/vertex-ai/model-garden?project=${PROJECT_ID}&authuser=${ACCOUNT_Q}"
  echo "  Search 'Claude' -> Enable: claude-sonnet-5, claude-haiku-4-5, claude-opus-4-8."
  echo "  Until this is done every agent run fails with 403/404 and the MODEL lamp stays red."
  echo
  STEP=$((STEP + 1))
fi

if [ -z "${GOOGLE_CLIENT_ID:-}" ]; then
  echo "STEP ${STEP} — OAuth consent screen (required before anyone can sign in)"
  echo "  https://console.cloud.google.com/apis/credentials/consent?project=${PROJECT_ID}&authuser=${ACCOUNT_Q}"
  echo "  App name 'Agent Canvas', support email ${OWNER_EMAIL}."
  echo "  If 'Internal' is greyed out, this project is outside the Workspace org — choose"
  echo "  External, and ADD EVERY TEAM MEMBER AS A TEST USER. In Testing mode a person who"
  echo "  is not a listed test user cannot sign in at all, whatever the app allowlist says."
  echo
  STEP=$((STEP + 1))
  echo "STEP ${STEP} — OAuth client (Web application)"
  echo "  https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}&authuser=${ACCOUNT_Q}"
  echo "  Authorized JavaScript origins — ADD BOTH (same service, two hostnames):"
  echo "      ${URL}"
  if [ -n "${URL_ALT}" ]; then echo "      ${URL_ALT}"; fi
  echo "  Authorized redirect URIs — ADD BOTH:"
  echo "      ${URL}/api/google/oauth/callback"
  if [ -n "${URL_ALT}" ]; then echo "      ${URL_ALT}/api/google/oauth/callback"; fi
  echo "  Registering one and browsing to the other fails sign-in with an origin"
  echo "  mismatch and no useful error. Adding both costs nothing."
  echo "  Copy the client ID and the client secret, then run STEP $((STEP + 1))."
  echo
  STEP=$((STEP + 1))
  echo "STEP ${STEP} — attach the credentials (copy-paste, fill in the two values)"
  echo
  echo "    CLIENT_ID=<paste>.apps.googleusercontent.com"
  echo "    CLIENT_SECRET=<paste>"
  echo
  echo "    printf '%s' \"\${CLIENT_SECRET}\" | gcloud secrets create google-oauth-secret \\"
  echo "      --project ${PROJECT_ID} --data-file=- 2>/dev/null \\"
  echo "      || printf '%s' \"\${CLIENT_SECRET}\" | gcloud secrets versions add google-oauth-secret \\"
  echo "      --project ${PROJECT_ID} --data-file=-"
  echo
  echo "    gcloud secrets add-iam-policy-binding google-oauth-secret --project ${PROJECT_ID} \\"
  echo "      --member=serviceAccount:${SA_EMAIL} --role=roles/secretmanager.secretAccessor"
  echo
  echo "    gcloud run services update ${SERVICE} --project ${PROJECT_ID} --region ${REGION} \\"
  echo "      --update-env-vars GOOGLE_CLIENT_ID=\"\${CLIENT_ID}\" \\"
  echo "      --update-secrets GOOGLE_CLIENT_SECRET=google-oauth-secret:latest"
  echo
  STEP=$((STEP + 1))
else
  echo "STEP ${STEP} — confirm the OAuth client lists ALL of these (sign-in fails silently otherwise):"
  echo "  Origins:   ${URL}${URL_ALT:+   ${URL_ALT}}"
  echo "  Redirects: ${URL}/api/google/oauth/callback${URL_ALT:+   ${URL_ALT}/api/google/oauth/callback}"
  echo
  STEP=$((STEP + 1))
fi

echo "STEP ${STEP} — OPTIONAL: light the HUBSPOT lamp (Ops Runner client)"
echo "  The canvas talks to ctg-hs-ops-runner via Cloud Run IAM — no HubSpot key here."
echo "  a) Grant the canvas permission to call the runner (you own ctg-hs-exec-tool):"
echo "     gcloud run services add-iam-policy-binding ctg-hs-ops-runner \\"
echo "       --project ctg-hs-exec-tool --region us-central1 \\"
echo "       --member serviceAccount:${SA_EMAIL} --role roles/run.invoker"
echo "  b) Re-run this deploy with HS_OPS_RUNNER_URL=\$(gcloud run services describe \\"
echo "       ctg-hs-ops-runner --region us-central1 --project ctg-hs-exec-tool \\"
echo "       --format='value(status.url)'), or attach it directly:"
echo "     gcloud run services update ${SERVICE} --project ${PROJECT_ID} --region ${REGION} \\"
echo "       --update-env-vars HS_OPS_RUNNER_URL=<runner-url>"
echo
STEP=$((STEP + 1))
echo "STEP ${STEP} — go live"
echo "  1. Open ${URL} and sign in as ${OWNER_EMAIL}."
if [ -n "${URL_ALT}" ]; then echo "     (or ${URL_ALT} — both reach the same service)"; fi
echo "  2. Open Capabilities. Every lamp should be green except HUBSPOT and MCP,"
echo "     which are dark by design (not wired yet)."
echo "  3. Click 'Connect Google Workspace' and grant the six scopes."
echo "  4. CHECK THE ALLOWLIST before inviting anyone: top-bar avatar -> Admin."
echo "     It is seeded with first-name@ addresses (fred@, darren@, jessica@)."
echo "     If a real mailbox differs, fix it there or that person cannot sign in."
echo "  5. Probe one agent: command bar -> \"have Scout confirm the model connection\""
echo "     works with one short memory entry\". A completed run proves the model path."
echo
echo "Deployment is idempotent: re-run this script any time to repair or update."

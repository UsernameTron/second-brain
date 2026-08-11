# Agent Canvas Workspace — single Cloud Run service (API + WS + static frontend).
# SQLite lives on local disk (WAL); when LITESTREAM_REPLICA_URL is set, Litestream
# restores it from Cloud Storage on boot and replicates continuously (keyless via
# the Cloud Run service account's Application Default Credentials).

# BASE_IMAGE lets restricted environments substitute a mirror of the official
# image (e.g. mirror.gcr.io/library/node:22-slim); Cloud Build uses the default.
ARG BASE_IMAGE=node:22-slim

# ---- Stage 1: build the frontend ----
FROM ${BASE_IMAGE} AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
# The optional build_ca secret lets TLS-intercepting build environments supply
# their CA (docker build --secret id=build_ca,src=...); absent on Cloud Build.
RUN --mount=type=secret,id=build_ca \
    sh -c 'if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm install --no-audit --no-fund' 
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: server dependencies ----
FROM ${BASE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=secret,id=build_ca \
    sh -c 'if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; npm ci --omit=dev --no-audit --no-fund' 

# ---- Stage 3: runtime ----
# No apt/curl needed in the image: Litestream comes in via BuildKit ADD and the
# Mozilla CA bundle (needed for Litestream→GCS TLS; node:22-slim ships no system
# CAs, Node itself uses its own bundled roots) is vendored in the build context.
FROM ${BASE_IMAGE}
ARG LITESTREAM_URL=https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb
# Vendored Mozilla CA bundle (deploy/cacert.pem, from python-certifi) — refresh
# occasionally; see docs/DEPLOY.md.
COPY deploy/cacert.pem /etc/ssl/certs/ca-certificates.crt
ADD ${LITESTREAM_URL} /tmp/litestream.deb
RUN dpkg -i /tmp/litestream.deb && rm /tmp/litestream.deb && chmod 644 /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    DB_PATH=/data/agent-canvas.db \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY --from=frontend /build/frontend/dist ./frontend/dist
COPY deploy/start.sh ./start.sh
RUN chmod +x ./start.sh && mkdir -p /data && useradd -r -u 1001 appuser && chown -R appuser /data /app
USER appuser

EXPOSE 8080
CMD ["./start.sh"]

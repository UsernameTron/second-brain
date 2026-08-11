# Agent Canvas Workspace — single Cloud Run service (API + WS + static frontend).
# SQLite lives on local disk (WAL); when LITESTREAM_REPLICA_URL is set, Litestream
# restores it from Cloud Storage on boot and replicates continuously (keyless via
# the Cloud Run service account's Application Default Credentials).

# ---- Stage 1: build the frontend ----
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: server dependencies ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Stage 3: runtime ----
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /tmp/litestream.deb https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb \
  && dpkg -i /tmp/litestream.deb && rm /tmp/litestream.deb \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    DB_PATH=/data/agent-canvas.db

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY --from=frontend /build/frontend/dist ./frontend/dist
COPY deploy/start.sh ./start.sh
RUN chmod +x ./start.sh && mkdir -p /data && useradd -r -u 1001 appuser && chown -R appuser /data /app
USER appuser

EXPOSE 8080
CMD ["./start.sh"]

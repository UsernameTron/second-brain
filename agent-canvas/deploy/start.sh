#!/bin/sh
# Container entrypoint. With LITESTREAM_REPLICA_URL set (production), restore
# the SQLite database from Cloud Storage if the local disk is empty, then run
# the server under continuous replication. Without it (local/dev), run plain.
set -e

DB_PATH="${DB_PATH:-/data/agent-canvas.db}"

if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  if [ ! -f "$DB_PATH" ]; then
    echo "restoring database from $LITESTREAM_REPLICA_URL (if a replica exists)"
    litestream restore -if-replica-exists -o "$DB_PATH" "$LITESTREAM_REPLICA_URL"
  fi
  exec litestream replicate -exec "node server/index.js" "$DB_PATH" "$LITESTREAM_REPLICA_URL"
else
  exec node server/index.js
fi

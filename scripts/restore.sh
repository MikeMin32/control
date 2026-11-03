#!/usr/bin/env bash
set -euo pipefail
# Restore Postgres for VM Control from a gzipped SQL dump.
# Usage: ./scripts/restore.sh ./backups/file.sql.gz

IN="${1:-}"
if [[ -z "$IN" || ! -f "$IN" ]]; then
  echo "Usage: ./scripts/restore.sh <backup.sql.gz>" >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

echo "Restoring $IN into DATABASE_URL …"
gunzip -c "$IN" | psql "$DATABASE_URL"
echo "Restore complete."

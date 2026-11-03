#!/usr/bin/env bash
set -euo pipefail
# Backup Postgres for VM Control.
# Usage: ./scripts/backup.sh [output.sql.gz]

OUT="${1:-./backups/vmcontrol-$(date -u +%Y%m%dT%H%M%SZ).sql.gz}"
mkdir -p "$(dirname "$OUT")"

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Prefer pg_dump with URL
  pg_dump "$DATABASE_URL" | gzip > "$OUT"
else
  echo "DATABASE_URL is required" >&2
  exit 1
fi

echo "Wrote $OUT"

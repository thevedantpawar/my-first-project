#!/usr/bin/env bash
#
# Runs the database-level compliance suite against a throwaway database.
#
# These tests deliberately write rows that violate constraints, so they must
# never touch the real database. This script builds a scratch database from the
# migration history, runs the suite, and drops it again.
#
# Usage: npm run test:constraints

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    set -a && source .env && set +a
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Copy .env.example to .env first." >&2
  exit 1
fi

SCRATCH_DB="ashirwad_constraint_test_$$"

# Prisma keeps the query string (?schema=public); psql rejects it as an invalid
# URI parameter, so it gets two different forms of the same URL.
BASE_URL="${DATABASE_URL%%\?*}"
QUERY=""
[[ "$DATABASE_URL" == *\?* ]] && QUERY="?${DATABASE_URL#*\?}"

SCRATCH_URL="$(printf '%s' "$BASE_URL" | sed -E "s#/[^/]+\$#/${SCRATCH_DB}#")"
ADMIN_URL="$(printf '%s' "$BASE_URL" | sed -E "s#/[^/]+\$#/postgres#")"
SCRATCH_URL_PRISMA="${SCRATCH_URL}${QUERY}"

cleanup() {
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating scratch database ${SCRATCH_DB}…"
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"${SCRATCH_DB}\";"

echo "Applying migrations…"
DATABASE_URL="$SCRATCH_URL_PRISMA" npx prisma migrate deploy >/dev/null

echo "Running constraint suite…"
psql "$SCRATCH_URL" -q -v ON_ERROR_STOP=1 -f prisma/sql/constraint_tests.sql

echo
echo "All database-level compliance constraints hold."

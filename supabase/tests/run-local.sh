#!/usr/bin/env bash
# Run the migrations and the SQL security tests against a throwaway plain
# PostgreSQL database (CI service container or a local server).
#
#   PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres supabase/tests/run-local.sh
#
# The script creates (and drops) a database named sasu_test on that server.
# It emulates Supabase's auth/storage schemas with supabase_stub.sql, so NEVER
# point it at a real Supabase project.
set -euo pipefail

cd "$(dirname "$0")/../.."
: "${PG_ADMIN_URL:?Set PG_ADMIN_URL to an admin connection string for a scratch server}"
DB_URL="${PG_ADMIN_URL%/*}/sasu_test"

psql "$PG_ADMIN_URL" -v ON_ERROR_STOP=1 -q -c 'drop database if exists sasu_test' -c 'create database sasu_test'

run() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q -X -o /dev/null -f "$1"; }

run supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "migrate: $f"
  run "$f"
done
for f in supabase/tests/sql/*.sql; do
  echo "test:    $f"
  run "$f"
done
echo "All database tests passed."

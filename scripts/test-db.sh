#!/usr/bin/env bash
# Applies the schema to a scratch database and runs the logic tests.
#
#   PGDATABASE=xctest ./scripts/test-db.sh
#
# Uses harness.sql to stand in for the parts of a Supabase project the
# migrations depend on (auth.users, storage.buckets, the anon /
# authenticated / service_role roles), so this runs against stock
# Postgres with pgcrypto and pg_trgm available.
set -euo pipefail

DB="${PGDATABASE:-xctest}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -d "$DB")

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f supabase/tests/harness.sql
for f in supabase/migrations/*.sql; do
  echo "  applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo
psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/logic_tests.sql 2>&1 \
  | sed -n 's/^psql:[^ ]* NOTICE:  //p'

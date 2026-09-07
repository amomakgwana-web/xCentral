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
# Both suites. pipefail is set above, so a raised assertion propagates
# as a non-zero exit rather than being swallowed by the formatting pipe.
for suite in supabase/tests/logic_tests.sql supabase/tests/lifecycle_tests.sql; do
  echo "  --- $(basename "$suite") ---"
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$suite" 2>&1 \
    | sed -n 's/^psql:[^ ]* NOTICE:  //p'
done

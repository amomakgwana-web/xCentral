#!/usr/bin/env bash
# Loads the demonstration dataset into a Supabase project, in order.
#
#   DATABASE_URL="postgresql://postgres:…@db.<project>.supabase.co:5432/postgres" \
#     ./scripts/seed-demo.sh
#
# Or against a local stack:
#
#   DATABASE_URL="$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
#     ./scripts/seed-demo.sh
#
# The three files must run in this order and each expects a schema that
# is already up to date (`supabase db push`, or apply
# supabase/migrations in filename order):
#
#   seed.sql            the calling platforms, consent wording, the
#                       screening lists, and four worked cases
#   seed_lifecycle.sql  the lending policies and the three customers the
#                       lifecycle tests were written against
#   seed_demo.sql       the demonstration cohort — twenty more people,
#                       their agreements, payments, captures, agent
#                       adjudications, API traffic and audit trail
#
# None of them is idempotent. They insert; they do not upsert. Run them
# once against an empty schema, and use `supabase db reset` to start over.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  echo >&2
  echo "  Supabase → Project Settings → Database → Connection string → URI" >&2
  echo "  export DATABASE_URL='postgresql://postgres:…@db.<project>.supabase.co:5432/postgres'" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

for f in supabase/seed.sql supabase/seed_lifecycle.sql supabase/seed_demo.sql; do
  echo "── $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo
psql "$DATABASE_URL" -A -t -F' ' -c "
  select 'cases', count(*) from public.verification_cases
  union all select 'customers',  count(*) from public.customers
  union all select 'contracts',  count(*) from public.contracts
  union all select 'payments',   count(*) from public.payments
  union all select 'fraud alerts', count(*) from public.fraud_alerts
  union all select 'agent runs', count(*) from public.agent_runs
  union all select 'audit entries', count(*) from public.audit_log"

echo
echo "Loaded. Point the console at this project and every page has data."

#!/usr/bin/env bash
# Build a throwaway local PostGIS database, apply migrations + seed, run schema tests,
# load a synthetic week through the real worker, cross-check PostGIS against Python,
# then prove the rollback scripts work.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-airwatch_test}
PSQL="psql -v ON_ERROR_STOP=1 -q -d $DB"
dropdb --if-exists "$DB" && createdb "$DB"
psql -q -d "$DB" -c "alter database $DB set search_path = public, extensions"
$PSQL -f supabase/tests/00_local_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "apply $f"; $PSQL -f "$f"; done
$PSQL -f supabase/seed.sql
$PSQL -f supabase/tests/schema_test.sql
# A login role that inherits the worker grants, exactly like production.
$PSQL -c "drop role if exists worker_test; create role worker_test login password 'worker_test' in role airwatch_worker"
export DATABASE_URL="postgresql://worker_test:worker_test@localhost/$DB"
(cd worker && python3 -m airwatch load-demo --store postgres --days 3)
(cd worker && python3 -m pytest -q tests_db)
for f in $(ls supabase/rollback/*.down.sql | sort -r); do echo "rollback $f"; $PSQL -f "$f"; done
$PSQL -c "do \$\$ begin assert not exists (select 1 from pg_namespace where nspname = 'airwatch'), 'rollback left schema'; end \$\$"
echo "database tests passed"

#!/usr/bin/env bash
#
# Repairs a DeployKit database whose drizzle.__drizzle_migrations table is empty
# while the schema already exists -- the state left behind by the `drizzle-kit
# push` fallback that older entrypoint.sh versions ran when a migration failed.
#
# Symptom: the API container dies on every boot with
#     Migration failed: PostgresError: relation "users" already exists  (42P07)
#
# The fix is to stamp the migrations the schema already reflects, so the migrator
# resumes at the first one that is genuinely missing. Everything is read from the
# migration journal inside the API image, so this works against any version.
#
# Usage:
#   scripts/repair-migration-state.sh [--through <tag>] [--yes]
#                                     [--api <container>] [--db <container>]
#
# Run it with the same privileges you use for docker (usually `sudo`).
set -euo pipefail

API_CONTAINER=${DK_API_CONTAINER:-deploykit-api}
DB_CONTAINER=${DK_DB_CONTAINER:-deploykit-postgres}
THROUGH=0002
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --through) THROUGH=$2; shift 2 ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    --api)     API_CONTAINER=$2; shift 2 ;;
    --db)      DB_CONTAINER=$2; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not found in PATH."
command -v sha256sum >/dev/null || die "sha256sum not found (coreutils)."
docker inspect "$API_CONTAINER" >/dev/null 2>&1 || die "no container named '$API_CONTAINER' (override with --api)."
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "no container named '$DB_CONTAINER' (override with --db)."
[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" = "true" ] \
  || die "'$DB_CONTAINER' is not running; start the database first."

# The API's own DATABASE_URL, used from inside the database container so the
# service name in that URL resolves exactly as it does for the API.
DBURL=$(docker inspect "$API_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' \
        | sed -n 's/^DATABASE_URL=//p' | head -1)
[ -n "$DBURL" ] || die "could not read DATABASE_URL from '$API_CONTAINER'."

# Reads SQL on stdin, prints unaligned rows.
psql_q() {
  docker exec -i -e DKURL="$DBURL" "$DB_CONTAINER" \
    sh -c 'psql "$DKURL" -v ON_ERROR_STOP=1 -tA'
}

echo "==> Database: $(printf '%s' "$DBURL" | sed 's#//[^@]*@#//***@#')"

# to_regclass keeps this from erroring when the objects are not there yet.
present=$(psql_q <<'SQL'
select (to_regclass('drizzle.__drizzle_migrations') is not null)::text
    || '|' || (to_regclass('public.users') is not null)::text;
SQL
)
has_table=${present%%|*}
has_users=${present#*|}

if [ "$has_users" != "true" ]; then
  echo "Nothing to repair: this database has no schema yet, so a normal start migrates it."
  exit 0
fi

rows=0
maxwhen=
if [ "$has_table" = "true" ]; then
  counts=$(psql_q <<'SQL'
select count(*)::text || '|' || coalesce(max(created_at)::text, '')
  from drizzle.__drizzle_migrations;
SQL
)
  rows=${counts%%|*}
  maxwhen=${counts#*|}
fi

echo "==> Recorded migrations: ${rows}   highest created_at: ${maxwhen:-<none>}"

if [ "$rows" != "0" ]; then
  if [ "$maxwhen" = "1781099247999" ]; then
    cat <<'MSG'

Nothing to stamp, but this database carries the withdrawn 0014_add_webhook_secret
timestamp (1781099247999). Every later migration is being skipped in silence,
because the migrator only applies entries whose `when` is greater than the newest
recorded one. Update to a DeployKit version whose journal was renumbered above
that value -- the migrations replay idempotently and the gap closes by itself.
MSG
    exit 1
  fi
  echo "Nothing to stamp: this database already has migration bookkeeping."
  exit 0
fi

# Empty bookkeeping over an existing schema: the push-created case.
# 0001 and 0002 must be genuinely applied for stamping them to be honest.
check=$(psql_q <<'SQL'
select (select count(*) from information_schema.columns
         where table_schema='public' and table_name='users' and column_name='role')
    || '|' ||
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='users' and column_name='is_admin');
SQL
)
[ "${check%%|*}" = "1" ] || die "users.role is missing -- this schema predates 0001, and stamping would skip a migration it still needs."
[ "${check#*|}" = "0" ] || die "users.is_admin is still present -- 0001 never completed, and stamping would skip a migration it still needs."

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
docker cp "$API_CONTAINER:/app/apps/api/src/db/migrations" "$workdir/migrations" >/dev/null \
  || die "could not copy the migrations out of '$API_CONTAINER'."
journal="$workdir/migrations/meta/_journal.json"
[ -f "$journal" ] || die "no meta/_journal.json inside '$API_CONTAINER'."

# "<when> <tag>" per entry, in journal order.
entries=$(awk -F'"' '
  /"when"/ { split($0, a, ":"); w = a[2]; gsub(/[ ,]/, "", w) }
  /"tag"/  { print w, $4 }
' "$journal")
[ -n "$entries" ] || die "could not parse the journal."

# Everything up to and including --through.
stamp=$(echo "$entries" | awk -v through="$THROUGH" '{ print } $2 ~ "^" through { exit }')
echo "$stamp" | grep -q "^[0-9]* ${THROUGH}" \
  || die "no migration matching '--through $THROUGH' in this image's journal."

# The migrator gates on the highest recorded created_at, so entries whose `when`
# sits below the highest one we stamp are skipped as well. Say so out loud.
stamp_max=$(echo "$stamp" | awk '{ if ($1+0 > m) m = $1+0 } END { print m }')
collateral=$(echo "$entries" | awk -v m="$stamp_max" -v through="$THROUGH" '
  after && $1+0 <= m { print "     - " $2 }
  $2 ~ "^" through   { after = 1 }
')

echo
echo "==> Will stamp as already applied:"
echo "$stamp" | awk '{ print "     - " $2 "  (when " $1 ")" }'
if [ -n "$collateral" ]; then
  echo "==> Also skipped, because their journal timestamp is below the highest stamped"
  echo "    one (all of these are idempotent and already present in the schema):"
  echo "$collateral"
fi
echo "==> Everything after that replays normally on the next start."
echo

if [ "$ASSUME_YES" != "1" ]; then
  printf 'Proceed? [y/N] '
  read -r answer
  case "$answer" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac
fi

{
  echo "create schema if not exists drizzle;"
  echo "create table if not exists drizzle.__drizzle_migrations"
  echo "  (id serial primary key, hash text not null, created_at bigint);"
  echo "$stamp" | while read -r when tag; do
    [ -n "$tag" ] || continue
    hash=$(sha256sum "$workdir/migrations/$tag.sql" | cut -d' ' -f1)
    echo "insert into drizzle.__drizzle_migrations (hash, created_at)"
    echo "select '$hash', $when"
    echo " where not exists (select 1 from drizzle.__drizzle_migrations where hash = '$hash');"
  done
} | psql_q >/dev/null

echo "==> Done. Recorded migrations now:"
psql_q <<'SQL'
select count(*) || ' rows, highest created_at ' || max(created_at)
  from drizzle.__drizzle_migrations;
SQL

echo
echo "Start the API:  docker start $API_CONTAINER"
echo "Then watch it:  docker logs --since 10s --timestamps -f $API_CONTAINER"

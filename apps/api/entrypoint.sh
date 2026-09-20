#!/bin/sh
set -e

echo "Running database migrations..."
cd /app/apps/api

if ! tsx src/db/migrate.ts 2>&1; then
  cat >&2 <<'MSG'

===============================================================================
  Migrations failed. The API will not start.

  DeployKit deliberately does NOT fall back to `drizzle-kit push`:

    * push records nothing in drizzle.__drizzle_migrations, so the next upgrade
      starts again from the first migration and fails the same way;
    * push is interactive whenever a column rename is ambiguous, and there is no
      TTY here, so it hangs forever instead of failing;
    * push drops columns the schema no longer declares -- including
      servers.ssh_key_content, which holds encrypted private keys until the
      ssh-keys backfill moves them into the ssh_keys catalogue.

  If the error above is `relation "users" already exists` (42P07), this database
  was built by that old fallback and has no migration bookkeeping. Repair it with

      scripts/repair-migration-state.sh

  which stamps the migrations already reflected in the schema. Never run push.
===============================================================================

MSG
  exit 1
fi

echo "Starting API server..."
cd /app
exec tsx apps/api/src/index.ts

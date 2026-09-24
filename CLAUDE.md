# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is DeployKit

A self-hosted PaaS (open-source Vercel/Heroku alternative) for deploying applications and databases on your own infrastructure. MIT licensed.

## Architecture

**Monorepo** (pnpm workspaces) with three packages:

- **`apps/api`** — Fastify 5 backend with tRPC 11 RPC layer, Drizzle ORM (PostgreSQL), BullMQ workers (Redis), Socket.IO for real-time logs, Dockerode for container management
- **`apps/web`** — React 19 SPA with TanStack Router (file-based), TanStack React Query, Zustand auth store, Tailwind CSS 4, Vite 6
- **`packages/shared`** — Zod validation schemas and TypeScript types shared between API and web

### Backend structure (`apps/api/src/`)

- **`index.ts`** — Server entry: Fastify setup, CORS, security headers, rate limiting, tRPC adapter, Socket.IO, webhook routes, worker startup
- **`trpc.ts`** — tRPC context (db, user, ip) and middleware: `publicProcedure`, `protectedProcedure`, `adminProcedure`, `operatorProcedure`
- **`routers/`** — tRPC routers (auth, project, application, database, compose, template, server, user, audit, metrics, notification, dashboard, projectMember)
- **`db/schema/`** — Drizzle table definitions with relations
- **`services/`** — Business logic: build orchestration (Nixpacks/Dockerfile/Buildpacks), Docker operations, SSH, git, webhook processing, log streaming, metrics collection, notifications
- **`workers/`** — BullMQ workers: deploy, compose-deploy, backup, and scheduled jobs (metrics, image cleanup, audit cleanup)
- **`lib/`** — Utilities: AES-256-GCM encryption, audit logging, permissions, Redis client, Socket.IO init

### Authorization & RBAC (READ BEFORE TOUCHING ANY ROUTER)

DeployKit has **two independent authorization layers**. Getting this wrong causes
privilege escalation or cross-project data leaks (IDOR), so follow it exactly.

**1. Global role** (`users.role`: `admin` | `operator` | `viewer`) — enforced by the
procedure builder in `trpc.ts`:
- `adminProcedure` → global admins only (user management, servers, audit log, project delete).
- `operatorProcedure` → operator+ (instance-level actions like creating projects).
- `protectedProcedure` → **only checks that the request is authenticated.** It does NOT
  check any role.
- The role is loaded from the DB in `createContext` using the JWT's `userId` only — the
  token never carries the role, so it can't be forged. **Never accept `role` (or any
  privilege field) from client input** (e.g. `auth.updateProfile` accepts `email` only).

**2. Project role** (`project_members.role`, per-project) — enforced **inside the handler**
via helpers in `lib/permissions.ts`:
- `getProjectRole(user, projectId)` / `getProjectRoleByAppId(user, appId)` /
  `getProjectRoleByDbId(user, dbId)` / `getProjectRoleByComposeId(user, stackId)` →
  returns the effective role or `null` (no access).
  Global admins always resolve to `admin`.
- Gate with `canView` (any member), `canOperate` (operator+), `isAdmin`, `canViewSecrets`
  (decrypt env vars / connection strings). For `serviceId`-keyed endpoints
  (metrics/logs) use `canViewService` from `lib/socket-auth.ts`.

**THE CRITICAL RULE:** almost every `application.*`, `database.*`, `compose.*`, and
`projectMember.*` procedure is a `protectedProcedure`, so the real authorization lives **inside the handler**.
Any such procedure that touches a project-scoped resource MUST resolve the caller's project
role and reject when it's `null` — **including read-only queries** (logs, stats, deployments,
backups all leak data). A missing check = IDOR: any logged-in user reads/acts on another
project's resources by ID. Mirror the pattern in `application.byId`:

```ts
const role = await getProjectRoleByAppId(ctx.user, input.id);
if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
// for operator-only actions: if (!canOperate(role)) throw FORBIDDEN
```

Return **`NOT_FOUND`** (not `FORBIDDEN`) to non-members so existence isn't revealed; use
`FORBIDDEN` only when the caller IS a member but lacks the required level. When adding or
reviewing a router procedure, the checklist is: (1) correct procedure builder, (2) project-role
resolved and rejected on `null`, (3) right level (`canOperate`/`isAdmin`/`canViewSecrets`),
(4) secrets never returned to non-`canViewSecrets` callers, (5) the same applies to queries,
not just mutations.

### Compose stacks & templates

Two kinds of service exist side by side: an **application** (one container, built
from Git or pulled as an image) and a **Compose stack** (`compose_services`) — a whole
`docker-compose.yml` deployed as a unit under the Compose project name `dk-<name>`.

**One-click templates are stacks.** A blueprint is a directory in the template
catalogue holding `docker-compose.yml` + `template.json` (+ an optional logo):

- `template.json` never contains a secret. It *declares* how to derive one —
  `"secret": "${base64:64}"` — and `services/template-variables.ts` generates a fresh
  value per deployment. Helpers: `domain`, `password:N`, `base64:N`, `hash:N`, `uuid`,
  `randomPort`, `email`, `username`, `timestamp`, `jwt:<secretVar>[:<role>]`.
- **Two different `${}` syntaxes, deliberately.** DeployKit's generator syntax exists
  only in `template.json`. Inside `docker-compose.yml`, `${VAR}` is *Compose's own*
  interpolation, fed by the `.env` DeployKit writes next to it from the resolved `env`.
  Never resolve template variables inside the Compose file.
- **Blueprints do not live in this repository.** They live in
  `deploykithq/deploykit-templates`, and DeployKit fetches them at runtime from
  `TEMPLATES_REGISTRY_URL` (default: that repo's raw URL). Nothing is bundled
  into the image, so `services/template-catalog.ts` is the only path by which a
  template reaches the UI. Publishing a template is a commit there — no
  DeployKit release.
- **The cache is therefore load-bearing, not an optimisation.** It is
  stale-while-error: a Redis entry lives 30 days but the registry is re-read
  after an hour, and a failed read keeps serving the last copy that validated.
  `listTemplates()` never throws; it reports `source` as `remote`, `stale` (an
  outage, serving the cached copy) or `unavailable` (an outage with nothing
  cached), and the Templates page renders each differently. Only an install that
  has never reached the registry shows an empty catalogue.
- The blueprint contract has one definition, `templateSpecSchema` in
  `packages/shared`. The catalogue repo validates contributions against a JSON
  Schema derived from it; re-emit it there after changing the Zod schema:
  ```
  pnpm --filter @deploykit/shared schema:emit -- --out ../deploykit-templates/schema/template.schema.json
  ```

`services/compose.ts` injects, at deploy time only, the `deploykit.*` ownership labels
(which is how logs, metrics and the terminal find a stack's containers), the Traefik
labels for routed services, and the shared network. The user's Compose file is never
rewritten on disk.

**The same-path rule (`COMPOSE_ROOT`).** The API runs in a container with the *host's*
Docker socket, so the daemon executing everything is the host's. Compose resolves a
stack's relative binds into absolute paths and sends them to that daemon. The stack
directory (default `/var/lib/deploykit/compose`) is therefore bind-mounted at the
**same absolute path** on both sides in `docker-compose.prod.yml`. Break that and
mounted config files silently arrive as empty directories.

Deployments are shared: `deployments.application_id` is nullable and
`deployments.compose_service_id` is its counterpart, with a CHECK that exactly one is
set. Any code reading `application_id` must handle a stack deployment.

### Scheduled tasks & one-off commands

A **task** is a named command on exactly one service, with an **optional** cron:
`scheduled_tasks.cron IS NULL` means a saved command that only ever runs when
somebody presses Run. `scheduled_tasks` and `task_runs` both carry the
polymorphic owner columns `application_id` / `compose_service_id` /
`database_id` under a CHECK that exactly one is set — the same shape
`deployments` uses — plus `service_name`, which a stack task must have and no
other kind may.

`task_runs` keeps its own owner columns *as well as* `task_id`, so an ad-hoc
run (which has no task) is still attributable to a service, and history
survives the deletion of the task that produced it (`task_id` is SET NULL,
`task_name` and `command` are snapshots). So is `timeout_seconds`: editing a
task must not retime a run already in flight. `services/task-runner.ts` keeps
the 50 newest runs per task, or per service for ad-hoc runs.

**Every run is a new container from the service's image** — never a `docker
exec` into the live one — so a command works with the app stopped, keeps a long
job off the container serving traffic, and needs no choice between replicas.
Applications and databases go through `runOneOff` (dockerode locally, `docker
run --rm --env-file` over SSH); stack services go through `docker compose run
--rm --no-deps -T`. A database command runs in the *client* image for its type
with `DK_DB_*` exported and the tool's own password variable (`PGPASSWORD`,
`MYSQL_PWD`, `REDISCLI_AUTH`) set, and the data volume is deliberately not
mounted.

**Three invariants to check on any change here.** A one-off container (a)
never carries the `deploykit.service` label — that label is how
`listServiceContainers`, the autoscaler, the metrics scheduler and the log
collector find a service's replicas, so a one-off wearing it would be scaled or
scraped; (b) never publishes ports, which would collide with the app's own host
port; (c) always sets `RestartPolicy: no`, since `createAndStart` defaults to
`unless-stopped` and a finished command must not be restarted. Secrets never
travel as `-e KEY=VALUE`: locally env goes through the dockerode API, remotely
through a 0600 temp file passed with `--env-file` and deleted afterwards.

**All cron in DeployKit is BullMQ job schedulers** (`lib/task-scheduler.ts`),
database backups included — there is no polling scheduler left.
`reconcileSchedules()` runs at boot and makes Redis match the DB, but every
mutation that changes a schedule must call `upsertTaskSchedule` /
`upsertBackupSchedule` itself, or the change only lands after a restart.
Scheduler ids are namespaced `task:<id>` / `backup:<id>` so the two can be
reconciled independently. Backups intentionally pass no `tz`, preserving the
process-local semantics the old matcher had. Validation uses `lib/cron.ts`,
which wraps **cron-parser 4.x — the exact version BullMQ resolves** — so a
pattern the API accepts is one the scheduler will really run; it is imported by
default and destructured, because its named exports are not statically
detectable under Node ESM.

**Authorization: both layers, always.** Defining or running a command is
`operatorProcedure` **and** project `canOperate` — running an arbitrary command
in a container is the web terminal in power, and `services/terminal.ts` gates
that on the *global* role, so gating only on the project role would hand
arbitrary execution to a global viewer who is operator of one project. Run
metadata is `canView`; run **output** is `canViewSecrets`, because a migration
can print a connection string — which is also why the Socket.IO room
`task-run:<id>` is gated on `canViewTaskRun`, not plain membership.

Only local runs stream line by line; a remote (SSH) run delivers its output
when the command finishes, exactly as remote image builds already behave.

### GitHub App

An application reaches a private repository one of **two ways**, and both stay
supported: a **pasted PAT** (`applications.source_token`, encrypted) or the
instance's **GitHub App** (`applications.github_installation_id`). The PAT is
what GitLab, Gitea and self-hosted git use; the App is preferred for github.com.
`services/source-credentials.ts` picks between them at deploy time — it is the
only place that decides, and `deploy.worker.ts` just asks it.

- **The App is registered per install, through the manifest flow**
  (`services/github-manifest.ts`). A self-hosted PaaS cannot share a central
  App: the webhook has to reach *this* instance. The manifest freezes the
  webhook and redirect URLs into the App, both derived from **`WEB_URL` and
  never from the `Host` header** — a forged header would redirect GitHub's
  one-time code elsewhere. `WEB_URL` is therefore load-bearing here, and
  `startManifest` refuses a URL GitHub could not deliver to.
- **Installation tokens expire in an hour**, so they are cached in Redis
  (encrypted, like every other secret) and the in-process promise map in
  `services/github-app.ts` gives single-flight: N concurrent deploys of one
  installation mint once. That map is registered *before* the function's first
  `await` — checking it after one lets every caller race past.
- **Repositories are identified by GitHub's numeric id**, not by URL.
  `matchApplications` in `services/webhook.ts` matches a connected app on
  installation + repo id and an unconnected one on the normalized URL, and the
  two rules are deliberately disjoint: a connected app is never matched by URL,
  so a repository webhook left over from the old setup cannot deploy it twice.
- **Signature verification accepts either secret** — the App's own, or the
  instance-wide `WEBHOOK_SECRET` — computed over the **raw request bytes**
  (`index.ts` retains them for `/api/webhooks/*` only). Hashing a re-serialized
  body silently dropped deliveries whose JSON escaping differed.
- **`deployments.commit_hash` holds the full 40-character SHA**, because
  GitHub's statuses API rejects an abbreviated one. Everything a human or
  Docker sees shortens it with `shortSha()` from `services/git.ts` — including
  the image tag, which would otherwise be 40 characters long.
- **Nothing in `services/github-status.ts` may fail a deploy.** Every entry
  point swallows its errors, and callers use `void`: GitHub being unreachable
  must never turn a deployment that worked into a failed one. Previews report
  under the *parent's* context name, so branch protection sees one stable check
  per application rather than one per pull request.
- A preview inherits the parent's installation instead of copying its encrypted
  token, so with the App a preview stores no secret at all.
- The App itself is **never exported** by the configuration manifest (it is
  instance credentials bound to a webhook URL). Applications export
  `github.repoId` / `repoFullName`, and an import re-links them to whichever
  local installation can see that repository — or warns when none or several can.

### Frontend structure (`apps/web/src/`)

- **`router.tsx`** — Route definitions with lazy loading and auth guards via `beforeLoad`
- **`features/`** — 12 feature modules (auth, dashboard, project, application, database, server, users, settings, audit, metrics, layout, shared)
- **`lib/trpc.ts`** — tRPC client with React Query integration
- **`lib/auth.ts`** — Zustand store for JWT auth state

### Key data flow

1. Web calls API via tRPC (proxied through Vite in dev: `/trpc` → `:3001`)
2. Deploy/backup operations are queued via BullMQ (Redis) and processed by workers
3. Real-time container logs stream via Socket.IO
4. GitHub/GitLab webhooks hit `POST /api/webhooks/{github,gitlab,generic}` and trigger deploy jobs

### Environment

Requires: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`.
Compose stacks add `COMPOSE_ROOT` (see the same-path rule above) and, optionally,
`TEMPLATES_BASE_DOMAIN` / `PUBLIC_IP` (where a template's generated hostname comes from)
and `TEMPLATES_REGISTRY_URL`. See `.env` for dev defaults, `.env.production` for the
production template.

### Database migrations

Schema lives in `apps/api/src/db/schema/`. Migrations are **hand-written SQL** in
`apps/api/src/db/migrations/`, applied by `src/db/migrate.ts` (`pnpm db:migrate`).
Drizzle config is at `apps/api/drizzle.config.ts`.

**Never run `pnpm db:generate`.** The drizzle-kit snapshots under `meta/` were only
ever tracked up to `0001_snapshot.json`, so `generate` diffs the schema against a
stale baseline and emits a migration that recreates tables which already exist —
and it prompts interactively for every ambiguous rename.

To add a change, write `NNNN_description.sql` by hand plus a matching entry in
`meta/_journal.json` (`tag` = filename without `.sql`). Two rules, both load-bearing:

1. **Every statement must be idempotent** — `CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`, and foreign keys wrapped in
   `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`. The whole folder
   is replayed from `0000` against databases that already have the schema (an
   install that lost its bookkeeping, or any install after a journal renumbering),
   and a single bare `CREATE TABLE` aborts the entire run with 42P07.
2. **`when` must be strictly greater than every entry before it.** Drizzle applies
   an entry only when its `when` exceeds the newest `created_at` in
   `drizzle.__drizzle_migrations` (see `migrate` in `drizzle-orm/pg-core/dialect.js`);
   `idx` and `tag` are never consulted. A lower or equal `when` is skipped
   **silently** while `migrate()` still prints "Migrations complete". A `when` far
   in the future is just as bad: it gates out everything written afterwards.

Every pending migration runs in one transaction, so a failure rolls back the
bookkeeping as well and the next boot starts over from `0000`. `entrypoint.sh`
therefore fails loudly instead of falling back to `drizzle-kit push`: push records
nothing in the migrations table, hangs on rename prompts when there is no TTY, and
drops columns the schema no longer declares (including `servers.ssh_key_content`,
which holds encrypted keys until the backfill moves them). A database whose
bookkeeping was lost is repaired with `scripts/repair-migration-state.sh`.

Data migrations that need application-level crypto cannot be SQL — they live in
`db/backfill/` and run from `migrate.ts` after `migrate()` returns.

### Production

Multi-stage Dockerfile builds both apps into a single container (Node 20 Alpine + Docker
CLI + the Compose plugin + Nixpacks). Traefik v3 handles reverse proxy and automatic Let's Encrypt SSL. See `docker-compose.prod.yml`.

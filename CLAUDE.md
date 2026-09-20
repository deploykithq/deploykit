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

Schema lives in `apps/api/src/db/schema/`. After changing schema files, run `pnpm db:generate` to create a migration, then `pnpm db:migrate` to apply it. Drizzle config is at `apps/api/drizzle.config.ts`.

### Production

Multi-stage Dockerfile builds both apps into a single container (Node 20 Alpine + Docker
CLI + the Compose plugin + Nixpacks). Traefik v3 handles reverse proxy and automatic Let's Encrypt SSL. See `docker-compose.prod.yml`.
